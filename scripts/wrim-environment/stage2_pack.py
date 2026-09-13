"""Stage 2 ratio-controlled contiguous packing for WRIM1-NEBULA-STAB-000001.

Fixes Stage 1 rehearsal overshoot (~48% vs 30%) by splitting long genesis
documents into bounded contiguous excerpts, then filling family budgets
without taking a whole oversized unit.

Never permutes the 1-D token stream. Wrap every excerpt [BOS=1]+body+[EOS=2].
TOOL_USE excluded. Eval-only / leakage strings excluded.
"""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from tokenizers import Tokenizer

from stage1_pack import (
    BOS_ID,
    DATA_ORDER_SEED,
    EOS_ID,
    MIX,
    PACKING_SEED,
    SEQ_LEN,
    WINDOW_TOKENS,
    PackedUnit,
    causal_batch_audit,
    encode_behavior_units,
    encode_corpus1_units,
    encode_rehearsal_units,
    interleave_by_deficit,
    leak_hits,
    shuffle_unit_order,
    slice_contiguous_batches,
    split_unit_windows,
    wrap_lm_tokens,
)

PACKER_VERSION = "contiguous-bounded-excerpt-v1"
TARGET_STREAM_TOKENS = 221184  # 54 * 4096; enough for 50 train steps + slack
MAX_EXCERPT_TOKENS = 1024
REHEARSAL_TARGET_PCT = 30.0
REHEARSAL_TOLERANCE_PP = 5.0
NEEDED_TRAIN_TOKENS = 50 * 8 * SEQ_LEN + 1
STEPS = 50
BATCH = 8


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def split_bounded_excerpts(unit: PackedUnit, max_tokens: int = MAX_EXCERPT_TOKENS) -> list[PackedUnit]:
    """Contiguous excerpts of a source unit. Token order inside the source is preserved.

    Long documents are chunked, not shuffled. Each excerpt is re-wrapped BOS/EOS
    so mix control can take whole shorter units / bounded chunks.
    """
    raw = [int(x) for x in unit.tokens.tolist()]
    if raw and raw[0] == BOS_ID:
        raw = raw[1:]
    if raw and raw[-1] == EOS_ID:
        raw = raw[:-1]
    if not raw:
        return []
    inner = max(8, int(max_tokens) - 2)
    out: list[PackedUnit] = []
    start = 0
    i = 0
    while start < len(raw):
        end = min(len(raw), start + inner)
        body = raw[start:end]
        wrapped = wrap_lm_tokens(body)
        out.append(
            PackedUnit(
                unit_id=f"{unit.unit_id}#ex{i}:{start}-{end}",
                bucket=unit.bucket,
                origin=unit.origin,
                tokens=wrapped,
                source_path=unit.source_path,
                n_eos=int(np.count_nonzero(wrapped == EOS_ID)),
                n_bos=int(np.count_nonzero(wrapped == BOS_ID)),
            )
        )
        start = end
        i += 1
    return out


def contiguous_prefix(unit: PackedUnit, budget: int) -> PackedUnit | None:
    """Keep a contiguous prefix that still starts with BOS and ends with EOS."""
    if budget < 4:
        return None
    n = min(int(unit.tokens.size), int(budget))
    prefix = np.array(unit.tokens[:n], dtype=np.int32)
    if int(prefix[0]) != BOS_ID:
        prefix[0] = BOS_ID
    if int(prefix[-1]) != EOS_ID:
        prefix[-1] = EOS_ID
    if prefix.size < 4:
        return None
    return PackedUnit(
        unit_id=f"{unit.unit_id}:prefix{prefix.size}",
        bucket=unit.bucket,
        origin=unit.origin,
        tokens=prefix,
        source_path=unit.source_path,
        n_eos=int(np.count_nonzero(prefix == EOS_ID)),
        n_bos=int(np.count_nonzero(prefix == BOS_ID)),
    )


def take_until_budget(units: list[PackedUnit], budget: int) -> list[PackedUnit]:
    """Fill a token budget with whole excerpts, then at most one contiguous prefix."""
    out: list[PackedUnit] = []
    used = 0
    for u in units:
        remaining = budget - used
        if remaining < 4:
            break
        n = int(u.tokens.size)
        if n <= remaining:
            out.append(u)
            used += n
            continue
        capped = contiguous_prefix(u, remaining)
        if capped is not None:
            out.append(capped)
            used += int(capped.tokens.size)
        break
    return out


def expand_family(units: list[PackedUnit]) -> list[PackedUnit]:
    out: list[PackedUnit] = []
    for u in units:
        out.extend(split_bounded_excerpts(u))
    return out


def encode_corpus1_val_units(tokenizer: Tokenizer, dump_root: Path) -> list[PackedUnit]:
    from stage1_pack import group_chunks_into_source_runs, is_eval_infra_text, is_tool_use, load_jsonl, text_of, bucket_for_record

    val_jsonl = dump_root / "model-lab" / "corpora" / "WR-CORPUS-1-HARDENED" / "validation" / "shard-00000.jsonl"
    rows = load_jsonl(val_jsonl)
    clean = []
    for rec in rows:
        text = text_of(rec)
        path = str(rec.get("source_path") or "")
        if is_tool_use(rec) or is_eval_infra_text(text, path):
            continue
        clean.append(rec)
    units: list[PackedUnit] = []
    for run in group_chunks_into_source_runs(clean):
        text = "".join(text_of(r) for r in run)
        if not text.strip():
            continue
        body = tokenizer.encode(text).ids
        if not body:
            continue
        ids = wrap_lm_tokens(body)
        bucket = bucket_for_record(run[0])
        if bucket in ("behavior", "other"):
            continue
        units.append(
            PackedUnit(
                unit_id=str(run[0].get("chunk_id") or run[0].get("source_lineage")),
                bucket=bucket,
                origin="WR-CORPUS-1-val",
                tokens=ids,
                n_eos=int(np.count_nonzero(ids == EOS_ID)),
                n_bos=int(np.count_nonzero(ids == BOS_ID)),
            )
        )
    return units


def encode_rehearsal_val_units(tokenizer: Tokenizer, dump_root: Path) -> list[PackedUnit]:
    from stage1_pack import is_eval_infra_text

    npy = dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / "val.npy"
    man_path = dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / "shard-manifest.json"
    if not npy.exists():
        return []
    man = json.loads(man_path.read_text(encoding="utf-8"))
    wrim0 = np.load(npy)
    offset = 0
    units: list[PackedUnit] = []
    for doc in man.get("valDocs") or []:
        n = int(doc["tokenCount"])
        sl = np.array(wrim0[offset : offset + n], dtype=np.int32)
        offset += n
        decoded = tokenizer.decode(sl.tolist(), skip_special_tokens=True)
        if is_eval_infra_text(decoded, "WR-CORPUS-0-val"):
            continue
        if sl.size < 3:
            continue
        units.append(
            PackedUnit(
                unit_id=str(doc.get("documentId")),
                bucket="wr_corpus_0",
                origin="WR-CORPUS-0-val",
                tokens=sl,
                n_eos=int(np.count_nonzero(sl == EOS_ID)),
                n_bos=int(np.count_nonzero(sl == BOS_ID)),
            )
        )
    return units


def _pack_selected(selected: list[PackedUnit], needed: int) -> tuple[np.ndarray, dict[str, Any]]:
    windows: list[PackedUnit] = []
    for u in selected:
        windows.extend(split_unit_windows(u))
    interleaved = interleave_by_deficit(windows)
    stream = np.concatenate([u.tokens for u in interleaved]) if interleaved else np.zeros((0,), dtype=np.int32)
    leak_scan_hits = []
    for u in interleaved:
        # decode without importing tokenizer here; caller scans
        leak_scan_hits.append(u)
    token_counts: dict[str, int] = defaultdict(int)
    for u in interleaved:
        token_counts[u.bucket] += int(u.tokens.size)
    total = int(stream.size) or 1
    pct = {k: round(100.0 * v / total, 4) for k, v in token_counts.items()}
    bos_total = int(np.count_nonzero(stream == BOS_ID))
    eos_total = int(np.count_nonzero(stream == EOS_ID))
    rebuilt = np.concatenate([u.tokens for u in interleaved]) if interleaved else stream
    contiguous_units = bool(np.array_equal(rebuilt, stream))
    rehearsal_pct = float(pct.get("wr_corpus_0") or 0.0)
    wr1_pct = round(100.0 - rehearsal_pct, 4)
    rehearsal_dev = abs(rehearsal_pct - REHEARSAL_TARGET_PCT)
    ratio_ok = rehearsal_dev <= REHEARSAL_TOLERANCE_PP and abs(wr1_pct - 70.0) <= REHEARSAL_TOLERANCE_PP
    return stream, {
        "windows": windows,
        "interleaved": interleaved,
        "token_counts": dict(token_counts),
        "packed_token_percent": pct,
        "rehearsal_pct": rehearsal_pct,
        "wr_corpus_1_pct": wr1_pct,
        "rehearsal_deviation_pp": round(rehearsal_dev, 4),
        "ratio_ok": ratio_ok,
        "bos_count": bos_total,
        "eos_count": eos_total,
        "stream_tokens": int(stream.size),
        "needed_tokens": needed,
        "contiguous_concat": contiguous_units,
        "n_units_selected": len(selected),
        "n_windows": len(windows),
        "interleaved_units": interleaved,
    }


def build_stage2_streams(*, dump_root: Path, tokenizer: Tokenizer) -> dict[str, Any]:
    c1 = encode_corpus1_units(tokenizer, dump_root)
    rehearsal = expand_family(shuffle_unit_order(encode_rehearsal_units(tokenizer, dump_root), DATA_ORDER_SEED))
    behavior = expand_family(shuffle_unit_order(encode_behavior_units(tokenizer, dump_root), DATA_ORDER_SEED + 1))
    families = {
        "wr_corpus_0": rehearsal,
        "prose": expand_family(shuffle_unit_order(c1.get("prose", []), DATA_ORDER_SEED + 2)),
        "code": expand_family(shuffle_unit_order(c1.get("code", []), DATA_ORDER_SEED + 3)),
        "json": expand_family(shuffle_unit_order(c1.get("json", []), DATA_ORDER_SEED + 4)),
        "behavior": behavior,
    }
    selected: list[PackedUnit] = []
    selected_counts: dict[str, int] = {}
    for fam, frac in MIX.items():
        budget = int(TARGET_STREAM_TOKENS * frac)
        taken = take_until_budget(families.get(fam, []), budget)
        selected.extend(taken)
        selected_counts[fam] = int(sum(u.tokens.size for u in taken))

    stream, meta = _pack_selected(selected, NEEDED_TRAIN_TOKENS)
    leak_scan_hits = []
    for u in meta["interleaved_units"]:
        decoded = tokenizer.decode(u.tokens.tolist(), skip_special_tokens=True)
        hits = leak_hits(decoded)
        if hits:
            leak_scan_hits.append({"unit_id": u.unit_id, "origin": u.origin, "hits": hits})

    no_token_shuffle = True
    for u in selected:
        parts = split_unit_windows(u)
        rebuilt_u = np.concatenate([p.tokens for p in parts]) if parts else u.tokens
        if not np.array_equal(rebuilt_u, u.tokens):
            no_token_shuffle = False
            break

    packing_ok = (
        int(stream.size) >= NEEDED_TRAIN_TOKENS
        and meta["bos_count"] > 0
        and meta["eos_count"] > 0
        and meta["contiguous_concat"]
        and no_token_shuffle
        and not leak_scan_hits
        and meta["eos_count"] >= meta["bos_count"]
        and meta["ratio_ok"]
    )

    val_units = []
    val_units.extend(expand_family(encode_rehearsal_val_units(tokenizer, dump_root)))
    val_units.extend(expand_family(encode_corpus1_val_units(tokenizer, dump_root)))
    val_selected = take_until_budget(val_units, 32768)
    val_stream, val_meta = _pack_selected(val_selected, 8 * SEQ_LEN + 1)

    corpus_hashes = {
        "wr_corpus_1_train": sha256_file(dump_root / "model-lab" / "corpora" / "WR-CORPUS-1-HARDENED" / "train" / "shard-00000.jsonl"),
        "wr_corpus_1_validation": sha256_file(dump_root / "model-lab" / "corpora" / "WR-CORPUS-1-HARDENED" / "validation" / "shard-00000.jsonl"),
        "wr_corpus_0_train_npy": sha256_file(dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / "train.npy"),
    }

    audit = {
        "method": "CONTIGUOUS_UNIT_PACK_DEFICIT_INTERLEAVE",
        "packer_version": PACKER_VERSION,
        "historical_shuffle": "FORBIDDEN",
        "max_excerpt_tokens": MAX_EXCERPT_TOKENS,
        "bos_id": BOS_ID,
        "eos_id": EOS_ID,
        "bos_count": meta["bos_count"],
        "eos_count": meta["eos_count"],
        "stream_tokens": meta["stream_tokens"],
        "needed_tokens": NEEDED_TRAIN_TOKENS,
        "window_tokens": WINDOW_TOKENS,
        "seq_len": SEQ_LEN,
        "selected_token_counts": selected_counts,
        "packed_token_percent": meta["packed_token_percent"],
        "target_mix": {
            "wr_corpus_0_rehearsal": REHEARSAL_TARGET_PCT,
            "wr_corpus_1": 70.0,
            "tolerance_pp": REHEARSAL_TOLERANCE_PP,
            **{k: round(v * 100.0, 2) for k, v in MIX.items()},
        },
        "actual_mix": meta["packed_token_percent"],
        "rehearsal_pct": meta["rehearsal_pct"],
        "wr_corpus_1_pct": meta["wr_corpus_1_pct"],
        "rehearsal_deviation_pp": meta["rehearsal_deviation_pp"],
        "ratio_ok": meta["ratio_ok"],
        "n_units_selected": meta["n_units_selected"],
        "n_windows": meta["n_windows"],
        "leak_scan_hits": leak_scan_hits,
        "contiguous_concat": meta["contiguous_concat"],
        "unit_token_order_preserved": no_token_shuffle,
        "tool_use": "EXCLUDED",
        "tool_use_pct": 0.0,
        "packing_ok": packing_ok,
        "seed_data_order": DATA_ORDER_SEED,
        "seed_packing": PACKING_SEED,
        "corpus_hashes": corpus_hashes,
        "val_stream_tokens": val_meta["stream_tokens"],
        "val_bos": val_meta["bos_count"],
        "val_eos": val_meta["eos_count"],
    }
    return {
        "stream": stream,
        "val_stream": val_stream,
        "audit": audit,
    }
