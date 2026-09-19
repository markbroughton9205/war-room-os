"""Controlled-stability packing: NATURAL_BASELINE vs BALANCED_GENESIS.

WR-CORPUS-0 = 30%, WR-CORPUS-1 = 70%, TOOL_USE = 0%.
WR-CORPUS-1 family proportions are IDENTICAL across all experimental cells
(Stage 2 MIX: prose 34.1 / code 25.6 / json 8.6 / behavior 1.7).
The only packing factor is how WR-CORPUS-0 genesis documents are ordered.

SKEWED_BASELINE is SUPERSEDED terminology. NATURAL_BASELINE is the STAB-000001-style
natural source-selection behavior; realized Alice/document concentration is observed,
not forced.
gradient_accumulation = 1 (accum=4 packs are SUPERSEDED / not comparability evidence).
"""
from __future__ import annotations

import hashlib
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from tokenizers import Tokenizer

from stage1_pack import (
    BOS_ID,
    EOS_ID,
    MIX,
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
)
from stage2_pack import (
    MAX_EXCERPT_TOKENS,
    contiguous_prefix,
    encode_corpus1_val_units,
    encode_rehearsal_val_units,
    expand_family,
    sha256_file,
    take_until_budget,
    _pack_selected,
)

PACKER_NATURAL = "natural-baseline-excerpt-v1"
PACKER_BALANCED = "balanced-genesis-excerpt-v1"
PACKER_SKEWED = "superseded-skewed-baseline-excerpt-v1"
MICRO_BATCH = 8
GRAD_ACCUM = 1
STEPS = 50
TOKENS_PER_STEP = MICRO_BATCH * SEQ_LEN * GRAD_ACCUM  # 4096
NEEDED_TRAIN_TOKENS = STEPS * TOKENS_PER_STEP + 1  # 204801
TARGET_STREAM_TOKENS = 54 * TOKENS_PER_STEP  # 221184; slack past 50 steps
REHEARSAL_TARGET_PCT = 30.0
REHEARSAL_TOLERANCE_PP = 2.0  # abs(share - 0.30) <= 0.02
VAL_PACK_SEED = 20260912
DOC_MAJORITY_CAP = 0.50
CODE_SHARE_TARGET = 0.256
CODE_SHARE_TOL = 0.01
CORPUS0_SHARE_TARGET = 0.30
CORPUS0_SHARE_TOL = 0.02
TRAIN_PREFIX_TOKENS = STEPS * TOKENS_PER_STEP  # 204800
MAX_TOKENS_PER_RUN = TRAIN_PREFIX_TOKENS

# Locked WR-CORPUS-1 mix — do not change between cells.
LOCKED_MIX = dict(MIX)

# Authoritative WRIM-0 genesis train document pool. Coverage accounting must
# start from this set so zero-token documents are reported as starved.
from run000006_coverage import FROZEN_GENESIS_TRAIN_IDS, rehearsal_coverage_report  # noqa: E402


def genesis_doc_id(unit: PackedUnit) -> str:
    return str(unit.unit_id).split("#", 1)[0].split(":", 1)[0]


def all_genesis_doc_ids(units: list[PackedUnit]) -> list[str]:
    return sorted({genesis_doc_id(u) for u in units if u.bucket == "wr_corpus_0"})


def gini_coefficient(values: list[float]) -> float:
    xs = sorted(float(v) for v in values)
    n = len(xs)
    s = sum(xs)
    if n == 0 or s <= 0:
        return 0.0
    acc = 0.0
    for i, x in enumerate(xs, start=1):
        acc += i * x
    return float((2.0 * acc) / (n * s) - (n + 1) / n)


def normalized_shannon_entropy(values: list[float]) -> float:
    total = float(sum(values))
    k = len(values)
    if total <= 0 or k <= 1:
        return 0.0
    h = 0.0
    for v in values:
        if v <= 0:
            continue
        p = v / total
        h -= p * math.log(p)
    return float(h / math.log(k))


def prefix_bucket_counts(units: list[PackedUnit], prefix_tokens: int) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    used = 0
    for u in units:
        n = int(u.tokens.size)
        take = n if used + n <= prefix_tokens else max(0, prefix_tokens - used)
        if take <= 0:
            break
        counts[u.bucket] += take
        used += take
        if used >= prefix_tokens:
            break
    return dict(counts)


def shares_from_counts(counts: dict[str, int]) -> dict[str, float]:
    total = float(sum(counts.values()) or 1)
    return {k: float(v) / total for k, v in counts.items()}


def mix_assertions(shares: dict[str, float], leak_hits_n: int) -> dict[str, Any]:
    code_share = float(shares.get("code") or 0.0)
    corpus0_share = float(shares.get("wr_corpus_0") or 0.0)
    tool_share = float(shares.get("tool_use") or 0.0)
    reasons = []
    code_ok = abs(code_share - CODE_SHARE_TARGET) <= CODE_SHARE_TOL
    c0_ok = abs(corpus0_share - CORPUS0_SHARE_TARGET) <= CORPUS0_SHARE_TOL
    tool_ok = tool_share == 0.0
    leak_ok = leak_hits_n == 0
    if not code_ok:
        reasons.append(f"code_share {code_share:.6f} outside {CODE_SHARE_TARGET}+/-{CODE_SHARE_TOL}")
    if not c0_ok:
        reasons.append(f"corpus0_share {corpus0_share:.6f} outside {CORPUS0_SHARE_TARGET}+/-{CORPUS0_SHARE_TOL}")
    if not tool_ok:
        reasons.append(f"tool_use_share {tool_share} != 0")
    if not leak_ok:
        reasons.append(f"leakage hits {leak_hits_n} != 0")
    return {
        "ok": bool(code_ok and c0_ok and tool_ok and leak_ok),
        "code_share": code_share,
        "corpus0_share": corpus0_share,
        "tool_use_share": tool_share,
        "leak_hits": leak_hits_n,
        "reasons": reasons,
    }


def seed_offset(seed: int, tag: str) -> int:
    digest = hashlib.sha256(f"{seed}:{tag}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "little") % (2**31)


def take_round_robin_docs(queues: dict[str, list[PackedUnit]], budget: int, majority_cap: float = DOC_MAJORITY_CAP) -> list[PackedUnit]:
    remaining = {k: list(v) for k, v in queues.items()}
    used = {k: 0 for k in remaining}
    out: list[PackedUnit] = []
    filled = 0
    cap = int(budget * majority_cap)
    while filled < budget - 3 and any(remaining[k] for k in remaining):
        active = [k for k in sorted(remaining) if remaining[k] and used[k] < cap]
        if not active:
            active = [k for k in sorted(remaining) if remaining[k]]
            if not active:
                break
        total_used = max(1, filled)
        best = min(active, key=lambda k: used[k] / total_used)
        u = remaining[best].pop(0)
        n = int(u.tokens.size)
        room = budget - filled
        if n <= room:
            out.append(u)
            used[best] += n
            filled += n
            continue
        capped = contiguous_prefix(u, room)
        if capped is not None:
            out.append(capped)
            used[best] += int(capped.tokens.size)
            filled += int(capped.tokens.size)
        break
    return out


def encode_raw_families(dump_root: Path, tokenizer: Tokenizer) -> dict[str, list[PackedUnit]]:
    c1 = encode_corpus1_units(tokenizer, dump_root)
    return {
        "wr_corpus_0": encode_rehearsal_units(tokenizer, dump_root),
        "prose": list(c1.get("prose") or []),
        "code": list(c1.get("code") or []),
        "json": list(c1.get("json") or []),
        "behavior": encode_behavior_units(tokenizer, dump_root),
    }


def _wr_corpus_1_families(raw: dict[str, list[PackedUnit]], seed: int) -> dict[str, list[PackedUnit]]:
    """Same family proportions and excerpt expansion for every experimental cell."""
    return {
        "prose": expand_family(shuffle_unit_order(raw["prose"], seed_offset(seed, "prose"))),
        "code": expand_family(shuffle_unit_order(raw["code"], seed_offset(seed, "code"))),
        "json": expand_family(shuffle_unit_order(raw["json"], seed_offset(seed, "json"))),
        "behavior": expand_family(shuffle_unit_order(raw["behavior"], seed_offset(seed, "behavior"))),
    }


def _natural_rehearsal(raw_genesis: list[PackedUnit], seed: int) -> list[PackedUnit]:
    """STAB-000001-style natural source selection. Concentration is observed, not forced."""
    shuffled_docs = shuffle_unit_order(raw_genesis, seed_offset(seed, "genesis-docs"))
    return expand_family(shuffled_docs)


def _balanced_rehearsal(raw_genesis: list[PackedUnit], seed: int, budget: int) -> list[PackedUnit]:
    """Document-balanced / deficit-balanced WR-CORPUS-0. Global 30% budget unchanged."""
    queues: dict[str, list[PackedUnit]] = {}
    for doc in raw_genesis:
        excerpts = expand_family([doc])
        doc_id = genesis_doc_id(doc)
        queues[doc_id] = shuffle_unit_order(excerpts, seed_offset(seed, f"genesis-excerpts:{doc_id}"))
    return take_round_robin_docs(queues, budget)


def _select_families(
    raw: dict[str, list[PackedUnit]],
    *,
    strategy: str,
    seed: int,
    target_tokens: int,
) -> tuple[list[PackedUnit], dict[str, int], str]:
    c1 = _wr_corpus_1_families(raw, seed)
    families: dict[str, list[PackedUnit]] = dict(c1)
    packer = PACKER_NATURAL
    if strategy == "SKEWED_BASELINE":
        raise ValueError("SKEWED_BASELINE is SUPERSEDED. Use NATURAL_BASELINE.")
    if strategy == "NATURAL_BASELINE":
        families["wr_corpus_0"] = _natural_rehearsal(raw["wr_corpus_0"], seed)
        packer = PACKER_NATURAL
    elif strategy == "BALANCED_GENESIS":
        families["wr_corpus_0"] = []  # filled via round-robin below
        packer = PACKER_BALANCED
    else:
        raise ValueError(f"unknown rehearsal strategy {strategy}")

    selected: list[PackedUnit] = []
    selected_counts: dict[str, int] = {}
    for fam, frac in LOCKED_MIX.items():
        budget = int(target_tokens * frac)
        if fam == "wr_corpus_0" and strategy == "BALANCED_GENESIS":
            taken = _balanced_rehearsal(raw["wr_corpus_0"], seed, budget)
        else:
            taken = take_until_budget(families.get(fam, []), budget)
        selected.extend(taken)
        selected_counts[fam] = int(sum(u.tokens.size for u in taken))
    return selected, selected_counts, packer


def genesis_token_audit(units: list[PackedUnit], prefix_tokens: int, all_doc_ids: list[str] | None = None) -> dict[str, Any]:
    used = 0
    by_doc: dict[str, int] = defaultdict(int)
    for u in units:
        n = int(u.tokens.size)
        take = n if used + n <= prefix_tokens else max(0, prefix_tokens - used)
        if take <= 0:
            break
        if u.bucket == "wr_corpus_0":
            by_doc[genesis_doc_id(u)] += take
        used += take
        if used >= prefix_tokens:
            break
    coverage = rehearsal_coverage_report(dict(by_doc), all_doc_ids=all_doc_ids)
    docs = coverage["ALL_DOC_IDS"]
    counts = [float(coverage["DOC_TOKEN_COUNTS"][d]) for d in docs]
    total_reh = float(sum(counts)) or 1.0
    shares = coverage["DOC_TOKEN_SHARES"]
    share_vals = list(shares.values())
    return {
        "prefix_tokens": prefix_tokens,
        "rehearsal_tokens_in_prefix": int(sum(by_doc.values())),
        "n_genesis_docs_in_prefix": coverage["n_genesis_docs_in_prefix"],
        "tokens_per_genesis_doc": {d: int(coverage["DOC_TOKEN_COUNTS"][d]) for d in docs},
        "share_per_genesis_doc": {d: round(float(shares[d]), 8) for d in docs},
        "tokens_by_doc": dict(by_doc),
        "pct_of_rehearsal_by_doc": {k: round(100.0 * v / total_reh, 4) for k, v in by_doc.items()},
        "max_doc_share_of_rehearsal": coverage["MAX_DOC_SHARE"],
        "normalized_shannon_entropy": round(normalized_shannon_entropy(counts), 8),
        "gini_coefficient": round(gini_coefficient(counts), 8),
        "maximum_exposure_gap": round((max(share_vals) - min(share_vals)) if share_vals else 0.0, 8),
        "starved_docs": coverage["STARVED_DOC_IDS"],
        "ALL_DOC_IDS": coverage["ALL_DOC_IDS"],
        "CONSUMED_DOC_IDS": coverage["CONSUMED_DOC_IDS"],
        "STARVED_DOC_IDS": coverage["STARVED_DOC_IDS"],
        "DOC_TOKEN_COUNTS": coverage["DOC_TOKEN_COUNTS"],
        "DOC_TOKEN_SHARES": coverage["DOC_TOKEN_SHARES"],
        "MAX_DOC_SHARE": coverage["MAX_DOC_SHARE"],
        "EFFECTIVE_DOCUMENT_N": coverage["EFFECTIVE_DOCUMENT_N"],
        "note": "Document-level rehearsal statistics only. Retention probes are synthetic/unmapped. Coverage pool always includes FROZEN_GENESIS_TRAIN_IDS.",
    }


def pack_train_stream(
    raw: dict[str, list[PackedUnit]],
    tokenizer: Tokenizer,
    *,
    strategy: str,
    seed: int,
    dump_root: Path,
) -> dict[str, Any]:
    selected, selected_counts, packer = _select_families(
        raw, strategy=strategy, seed=seed, target_tokens=TARGET_STREAM_TOKENS
    )
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

    prefix_tokens = TRAIN_PREFIX_TOKENS
    all_docs = all_genesis_doc_ids(raw["wr_corpus_0"])
    gen_audit = genesis_token_audit(meta["interleaved_units"], prefix_tokens, all_docs)
    early_audit = genesis_token_audit(meta["interleaved_units"], 10 * TOKENS_PER_STEP, all_docs)
    mid_audit = genesis_token_audit(meta["interleaved_units"], 30 * TOKENS_PER_STEP, all_docs)

    prefix_counts = prefix_bucket_counts(meta["interleaved_units"], prefix_tokens)
    prefix_shares = shares_from_counts(prefix_counts)
    mix_gate = mix_assertions(prefix_shares, len(leak_scan_hits))

    packing_ok = (
        int(stream.size) >= NEEDED_TRAIN_TOKENS
        and meta["bos_count"] > 0
        and meta["eos_count"] > 0
        and meta["contiguous_concat"]
        and no_token_shuffle
        and not leak_scan_hits
        and meta["eos_count"] >= meta["bos_count"]
        and mix_gate["ok"]
    )
    if strategy == "BALANCED_GENESIS":
        packing_ok = packing_ok and gen_audit["n_genesis_docs_in_prefix"] >= 5

    corpus_hashes = {
        "wr_corpus_1_train": sha256_file(dump_root / "model-lab" / "corpora" / "WR-CORPUS-1-HARDENED" / "train" / "shard-00000.jsonl"),
        "wr_corpus_1_validation": sha256_file(dump_root / "model-lab" / "corpora" / "WR-CORPUS-1-HARDENED" / "validation" / "shard-00000.jsonl"),
        "wr_corpus_0_train_npy": sha256_file(dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / "train.npy"),
    }
    audit = {
        "method": "CONTIGUOUS_UNIT_PACK_DEFICIT_INTERLEAVE",
        "packer_version": packer,
        "rehearsal_strategy": strategy,
        "historical_shuffle": "FORBIDDEN",
        "max_excerpt_tokens": MAX_EXCERPT_TOKENS,
        "bos_id": BOS_ID,
        "eos_id": EOS_ID,
        "bos_count": meta["bos_count"],
        "eos_count": meta["eos_count"],
        "stream_tokens": meta["stream_tokens"],
        "needed_tokens": NEEDED_TRAIN_TOKENS,
        "tokens_per_step": TOKENS_PER_STEP,
        "window_tokens": WINDOW_TOKENS,
        "seq_len": SEQ_LEN,
        "selected_token_counts": selected_counts,
        "packed_token_percent": meta["packed_token_percent"],
        "target_mix": {
            "wr_corpus_0_rehearsal": REHEARSAL_TARGET_PCT,
            "wr_corpus_1": 70.0,
            "tolerance_pp": REHEARSAL_TOLERANCE_PP,
            **{k: round(v * 100.0, 2) for k, v in LOCKED_MIX.items()},
        },
        "actual_mix": meta["packed_token_percent"],
        "rehearsal_pct": meta["rehearsal_pct"],
        "wr_corpus_1_pct": meta["wr_corpus_1_pct"],
        "rehearsal_deviation_pp": meta["rehearsal_deviation_pp"],
        "ratio_ok": meta["ratio_ok"],
        "train_prefix_tokens": prefix_tokens,
        "train_prefix_bucket_counts": prefix_counts,
        "train_prefix_shares": prefix_shares,
        "mix_assertions": mix_gate,
        "n_units_selected": meta["n_units_selected"],
        "n_windows": meta["n_windows"],
        "leak_scan_hits": leak_scan_hits,
        "contiguous_concat": meta["contiguous_concat"],
        "unit_token_order_preserved": no_token_shuffle,
        "tool_use": "EXCLUDED",
        "tool_use_pct": 0.0,
        "packing_ok": packing_ok,
        "seed_data_order": seed,
        "seed_packing": seed,
        "corpus_hashes": corpus_hashes,
        "genesis_prefix_audit": gen_audit,
        "genesis_step10_audit": early_audit,
        "genesis_step30_audit": mid_audit,
        "locked_wr_corpus_1_mix": True,
    }
    return {"stream": stream, "audit": audit, "interleaved": meta["interleaved_units"]}


def pack_val_stream(dump_root: Path, tokenizer: Tokenizer) -> dict[str, Any]:
    val_units = []
    val_units.extend(expand_family(encode_rehearsal_val_units(tokenizer, dump_root)))
    val_units.extend(expand_family(encode_corpus1_val_units(tokenizer, dump_root)))
    val_units = shuffle_unit_order(val_units, VAL_PACK_SEED)
    val_selected = take_until_budget(val_units, 32768)
    val_stream, val_meta = _pack_selected(val_selected, MICRO_BATCH * SEQ_LEN + 1)
    return {
        "val_stream": val_stream,
        "val_bos": val_meta["bos_count"],
        "val_eos": val_meta["eos_count"],
        "val_stream_tokens": val_meta["stream_tokens"],
        "seed": VAL_PACK_SEED,
    }
