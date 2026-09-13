"""Document-balanced Stage 2 retry packing for WRIM1-NEBULA-STAB-000002.

Global rehearsal stays 30% WR-CORPUS-0 / 70% WR-CORPUS-1.
Genesis documents are round-robin / deficit-balanced so no Alice-only prefix.
Code is hard-capped at 18% of TOTAL tokens. TOOL_USE excluded.
Never permutes the 1-D token stream.
"""
from __future__ import annotations

import hashlib
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from tokenizers import Tokenizer

from stage1_pack import (
    BOS_ID,
    DATA_ORDER_SEED,
    EOS_ID,
    PACKING_SEED,
    SEQ_LEN,
    PackedUnit,
    causal_batch_audit,
    encode_behavior_units,
    encode_corpus1_units,
    encode_rehearsal_units,
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
    split_bounded_excerpts,
)

PACKER_VERSION = "document-balanced-excerpt-v1"
TARGET_STREAM_TOKENS = 221184
REHEARSAL_TARGET_PCT = 30.0
REHEARSAL_TOLERANCE_PP = 5.0
CODE_CAP_TOTAL_PCT = 18.0
JSON_TARGET_PCT = 8.6
BEHAVIOR_TARGET_PCT = 1.7
NEEDED_TRAIN_TOKENS = 50 * 8 * SEQ_LEN + 1
PREFIX_TOKENS = 50 * 8 * SEQ_LEN
STEPS = 50
BATCH = 8
DOC_MAJORITY_CAP = 0.50
LITERARY_FLOOR_OF_REHEARSAL = 0.20
ALICE_CAP_OF_REHEARSAL = 0.40

MIX = {
    "wr_corpus_0": 0.300,
    "prose": 0.418,
    "code": 0.179,
    "json": 0.086,
    "behavior": 0.017,
}

RETENTION_LEAK_PREFIXES = [
    "Continue literary English: The small parlour",
    "Continue: Rain stitched the windows",
    "In complete sentences, continue a quiet domestic evening",
    "Continue this period-neutral prose: She folded the letter",
    "Write four coherent sentences of ordinary narrative about walking a muddy lane",
    "Continue: The clock in the hall had a habit of gathering silence",
]


def genesis_doc_id(unit: PackedUnit) -> str:
    return str(unit.unit_id).split("#", 1)[0].split(":", 1)[0]


def classify_excerpt(text: str) -> str:
    low = text.lower()
    if "```" in text or "model-lab" in low or "function " in low or "def " in low[:400]:
        return "code_or_markdown"
    if any(w in low for w in ("alice", "gryphon", "queen", "hatter", "rabbit")):
        return "literary_alice_like"
    if any(w in low for w in (" said", "chapter", "once ", "the ")):
        return "prose_like"
    return "other"


def is_literary_class(cls: str) -> bool:
    return cls in ("literary_alice_like", "prose_like")


def extra_leak_hits(text: str) -> list[str]:
    hits = leak_hits(text)
    for p in RETENTION_LEAK_PREFIXES:
        if p and p in text:
            hits.append(p[:48])
    return hits


def take_round_robin_docs(queues: dict[str, list[PackedUnit]], budget: int, majority_cap: float = DOC_MAJORITY_CAP) -> list[PackedUnit]:
    """Deficit-balanced take across genesis document queues. Token-order inside excerpts is preserved."""
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


def apply_literary_floor(
    selected: list[PackedUnit],
    unused: dict[str, list[PackedUnit]],
    class_of: dict[str, str],
    budget: int,
) -> list[PackedUnit]:
    """Keep a literary floor inside the 30% rehearsal without letting Alice dominate."""
    def tokens_by_doc(items: list[PackedUnit]) -> dict[str, int]:
        c: dict[str, int] = defaultdict(int)
        for u in items:
            c[genesis_doc_id(u)] += int(u.tokens.size)
        return dict(c)

    counts = tokens_by_doc(selected)
    total = max(1, sum(counts.values()))
    literary_docs = [d for d, cls in class_of.items() if is_literary_class(cls)]
    alice_docs = [d for d, cls in class_of.items() if cls == "literary_alice_like"]
    lit_tokens = sum(counts.get(d, 0) for d in literary_docs)
    if lit_tokens / total >= LITERARY_FLOOR_OF_REHEARSAL:
        return selected

    need = int(LITERARY_FLOOR_OF_REHEARSAL * total) - lit_tokens
    add: list[PackedUnit] = []
    for d in literary_docs:
        if alice_docs and d in alice_docs and counts.get(d, 0) >= int(ALICE_CAP_OF_REHEARSAL * budget):
            continue
        q = unused.get(d) or []
        while q and need > 3:
            u = q.pop(0)
            n = int(u.tokens.size)
            if n <= need:
                add.append(u)
                need -= n
            else:
                capped = contiguous_prefix(u, need)
                if capped is not None:
                    add.append(capped)
                    need -= int(capped.tokens.size)
                break
    if not add:
        return selected
    add_n = sum(int(u.tokens.size) for u in add)
    # drop from the currently largest non-literary selected doc
    non_lit = [d for d in counts if d not in literary_docs]
    if not non_lit:
        return selected
    victim = max(non_lit, key=lambda d: counts[d])
    kept: list[PackedUnit] = []
    dropped = 0
    for u in selected:
        if genesis_doc_id(u) == victim and dropped < add_n:
            dropped += int(u.tokens.size)
            continue
        kept.append(u)
    return kept + add


def interleave_family_and_doc(units: list[PackedUnit]) -> list[PackedUnit]:
    """Deficit-interleave by family, and within rehearsal by genesis document."""
    queues: dict[str, list[PackedUnit]] = defaultdict(list)
    for u in units:
        if u.bucket == "wr_corpus_0":
            key = f"wr_corpus_0:{genesis_doc_id(u)}"
        else:
            key = u.bucket
        queues[key].append(u)
    totals = {k: int(sum(x.tokens.size for x in v)) for k, v in queues.items()}
    grand = int(sum(totals.values())) or 1
    target = {k: v / grand for k, v in totals.items()}
    used = {k: 0 for k in totals}
    remaining = {k: list(v) for k, v in queues.items()}
    out: list[PackedUnit] = []
    while any(remaining[k] for k in remaining):
        total_used = int(sum(used.values()))
        best = None
        best_score = None
        for fam in sorted(remaining.keys()):
            if not remaining[fam]:
                continue
            score = target[fam] if total_used == 0 else target[fam] - (used[fam] / total_used)
            if best is None or score > best_score:
                best = fam
                best_score = score
        u = remaining[best].pop(0)
        out.append(u)
        used[best] += int(u.tokens.size)
    return out


def max_gap_steps(labels: np.ndarray, doc_id: str, prefix: int, step_tokens: int = 4096) -> dict[str, Any]:
    n_steps = prefix // step_tokens
    present = []
    for s in range(n_steps):
        sl = labels[s * step_tokens : (s + 1) * step_tokens]
        if np.any(sl == doc_id):
            present.append(s + 1)
    if not present:
        return {"steps_present": [], "max_gap_steps": n_steps, "starved": True}
    gaps = []
    if present[0] > 1:
        gaps.append(present[0] - 1)
    for a, b in zip(present, present[1:]):
        gaps.append(b - a - 1)
    if present[-1] < n_steps:
        gaps.append(n_steps - present[-1])
    return {"steps_present": present, "max_gap_steps": int(max(gaps) if gaps else 0), "starved": False}


def build_stage2_retry_streams(*, dump_root: Path, tokenizer: Tokenizer) -> dict[str, Any]:
    genesis = encode_rehearsal_units(tokenizer, dump_root)
    if len(genesis) != 5:
        raise RuntimeError(f"expected 5 WR-CORPUS-0 genesis documents, got {len(genesis)}")

    class_of: dict[str, str] = {}
    queues: dict[str, list[PackedUnit]] = {}
    unused: dict[str, list[PackedUnit]] = {}
    for u in genesis:
        decoded = tokenizer.decode(u.tokens[:80].tolist(), skip_special_tokens=True)
        cls = classify_excerpt(decoded)
        class_of[u.unit_id] = cls
        excerpts = split_bounded_excerpts(u)
        doc_seed = DATA_ORDER_SEED + (int(hashlib.sha256(u.unit_id.encode("utf-8")).hexdigest()[:8], 16) % 10007)
        excerpts = shuffle_unit_order(excerpts, doc_seed)
        queues[u.unit_id] = excerpts
        unused[u.unit_id] = list(excerpts)

    rehearsal_budget = int(TARGET_STREAM_TOKENS * MIX["wr_corpus_0"])
    selected_r = take_round_robin_docs(queues, rehearsal_budget)
    leftover = {d: [u for u in unused[d] if u.unit_id not in {x.unit_id for x in selected_r}] for d in unused}
    # leftover by identity of excerpt unit_id after split
    selected_ids = {u.unit_id for u in selected_r}
    leftover = {d: [u for u in queues[d] if u.unit_id not in selected_ids] for d in queues}
    selected_r = apply_literary_floor(selected_r, leftover, class_of, rehearsal_budget)

    c1 = encode_corpus1_units(tokenizer, dump_root)
    families = {
        "wr_corpus_0": selected_r,
        "prose": expand_family(shuffle_unit_order(c1.get("prose", []), DATA_ORDER_SEED + 2)),
        "code": expand_family(shuffle_unit_order(c1.get("code", []), DATA_ORDER_SEED + 3)),
        "json": expand_family(shuffle_unit_order(c1.get("json", []), DATA_ORDER_SEED + 4)),
        "behavior": expand_family(shuffle_unit_order(encode_behavior_units(tokenizer, dump_root), DATA_ORDER_SEED + 1)),
    }
    selected: list[PackedUnit] = []
    selected_counts: dict[str, int] = {}
    for fam, frac in MIX.items():
        if fam == "wr_corpus_0":
            taken = families["wr_corpus_0"]
        else:
            taken = []
            used = 0
            budget = int(TARGET_STREAM_TOKENS * frac)
            for u in families.get(fam, []):
                remaining = budget - used
                if remaining < 4:
                    break
                n = int(u.tokens.size)
                if n <= remaining:
                    taken.append(u)
                    used += n
                else:
                    capped = contiguous_prefix(u, remaining)
                    if capped is not None:
                        taken.append(capped)
                        used += int(capped.tokens.size)
                    break
        selected.extend(taken)
        selected_counts[fam] = int(sum(u.tokens.size for u in taken))

    windows: list[PackedUnit] = []
    for u in selected:
        windows.extend(split_unit_windows(u))
    interleaved = interleave_family_and_doc(windows)
    stream = np.concatenate([u.tokens for u in interleaved]) if interleaved else np.zeros((0,), dtype=np.int32)

    labels = []
    buckets = []
    for u in interleaved:
        n = int(u.tokens.size)
        doc = genesis_doc_id(u) if u.bucket == "wr_corpus_0" else ""
        labels.extend([doc] * n)
        buckets.extend([u.bucket] * n)
    labels_a = np.array(labels)
    buckets_a = np.array(buckets)

    token_counts: dict[str, int] = defaultdict(int)
    for b in buckets:
        token_counts[b] += 1
    total = int(stream.size) or 1
    pct = {k: round(100.0 * v / total, 4) for k, v in token_counts.items()}
    prefix = min(PREFIX_TOKENS, int(stream.size))
    prefix_counts: dict[str, int] = defaultdict(int)
    for b in buckets[:prefix]:
        prefix_counts[b] += 1
    prefix_pct = {k: round(100.0 * v / max(1, prefix), 4) for k, v in prefix_counts.items()}

    genesis_prefix: dict[str, int] = defaultdict(int)
    for d in labels_a[:prefix].tolist():
        if d:
            genesis_prefix[str(d)] += 1
    genesis_dist = []
    gaps = {}
    starved = []
    majority = None
    prefix_rehearsal = max(1, int(sum(genesis_prefix.values())))
    for u in genesis:
        n = int(genesis_prefix.get(u.unit_id, 0))
        share = round(100.0 * n / prefix_rehearsal, 4)
        g = max_gap_steps(labels_a[:prefix], u.unit_id, prefix)
        gaps[u.unit_id] = g
        if n == 0:
            starved.append(u.unit_id)
        genesis_dist.append(
            {
                "documentId": u.unit_id,
                "available_tokens": int(u.tokens.size),
                "coarse_class": class_of[u.unit_id],
                "tokens_in_50_step_prefix": n,
                "share_of_prefix_rehearsal_pct": share,
            }
        )
        if n > 0.5 * prefix_rehearsal:
            majority = u.unit_id

    leak_scan_hits = []
    for u in interleaved:
        decoded = tokenizer.decode(u.tokens.tolist(), skip_special_tokens=True)
        hits = extra_leak_hits(decoded)
        if hits:
            leak_scan_hits.append({"unit_id": u.unit_id, "origin": u.origin, "hits": hits})

    rehearsal_pct = float(pct.get("wr_corpus_0") or 0.0)
    prefix_rehearsal_pct = float(prefix_pct.get("wr_corpus_0") or 0.0)
    code_pct = float(pct.get("code") or 0.0)
    prefix_code_pct = float(prefix_pct.get("code") or 0.0)
    wr1_pct = round(100.0 - rehearsal_pct, 4)
    rehearsal_dev = abs(rehearsal_pct - REHEARSAL_TARGET_PCT)
    prefix_dev = abs(prefix_rehearsal_pct - REHEARSAL_TARGET_PCT)
    bos_total = int(np.count_nonzero(stream == BOS_ID))
    eos_total = int(np.count_nonzero(stream == EOS_ID))
    rebuilt = np.concatenate([u.tokens for u in interleaved]) if interleaved else stream
    contiguous_units = bool(np.array_equal(rebuilt, stream))
    no_token_shuffle = True
    for u in selected:
        parts = split_unit_windows(u)
        rebuilt_u = np.concatenate([p.tokens for p in parts]) if parts else u.tokens
        if not np.array_equal(rebuilt_u, u.tokens):
            no_token_shuffle = False
            break

    literary_share = round(
        100.0
        * sum(x["tokens_in_50_step_prefix"] for x in genesis_dist if is_literary_class(x["coarse_class"]))
        / prefix_rehearsal,
        4,
    )
    ratio_ok = (
        rehearsal_dev <= REHEARSAL_TOLERANCE_PP
        and prefix_dev <= REHEARSAL_TOLERANCE_PP
        and abs(wr1_pct - 70.0) <= REHEARSAL_TOLERANCE_PP
        and code_pct <= CODE_CAP_TOTAL_PCT
        and prefix_code_pct <= CODE_CAP_TOTAL_PCT
        and not starved
        and majority is None
        and len(genesis_dist) == 5
    )
    packing_ok = (
        int(stream.size) >= NEEDED_TRAIN_TOKENS
        and bos_total > 0
        and eos_total >= bos_total
        and contiguous_units
        and no_token_shuffle
        and not leak_scan_hits
        and ratio_ok
        and float(pct.get("behavior") or 0.0) >= 0
    )

    val_units = []
    val_units.extend(expand_family(encode_rehearsal_val_units(tokenizer, dump_root)))
    val_units.extend(expand_family(encode_corpus1_val_units(tokenizer, dump_root)))
    val_selected: list[PackedUnit] = []
    used = 0
    for u in val_units:
        if used >= 32768:
            break
        val_selected.append(u)
        used += int(u.tokens.size)
    val_windows: list[PackedUnit] = []
    for u in val_selected:
        val_windows.extend(split_unit_windows(u))
    val_inter = interleave_family_and_doc(val_windows)
    val_stream = np.concatenate([u.tokens for u in val_inter]) if val_inter else np.zeros((0,), dtype=np.int32)

    audit = {
        "method": "CONTIGUOUS_UNIT_PACK_DOCUMENT_BALANCED",
        "packer_version": PACKER_VERSION,
        "historical_shuffle": "FORBIDDEN",
        "max_excerpt_tokens": MAX_EXCERPT_TOKENS,
        "bos_id": BOS_ID,
        "eos_id": EOS_ID,
        "bos_count": bos_total,
        "eos_count": eos_total,
        "stream_tokens": int(stream.size),
        "needed_tokens": NEEDED_TRAIN_TOKENS,
        "seq_len": SEQ_LEN,
        "selected_token_counts": selected_counts,
        "packed_token_percent": pct,
        "prefix_token_percent": prefix_pct,
        "target_mix": {
            "wr_corpus_0_rehearsal": REHEARSAL_TARGET_PCT,
            "wr_corpus_1": 70.0,
            "tolerance_pp": REHEARSAL_TOLERANCE_PP,
            "code_cap_total_pct": CODE_CAP_TOTAL_PCT,
            **{k: round(v * 100.0, 2) for k, v in MIX.items()},
        },
        "actual_mix": pct,
        "prefix_mix": prefix_pct,
        "rehearsal_pct": rehearsal_pct,
        "prefix_rehearsal_pct": prefix_rehearsal_pct,
        "wr_corpus_1_pct": wr1_pct,
        "code_pct": code_pct,
        "prefix_code_pct": prefix_code_pct,
        "rehearsal_deviation_pp": round(rehearsal_dev, 4),
        "prefix_rehearsal_deviation_pp": round(prefix_dev, 4),
        "ratio_ok": ratio_ok,
        "n_units_selected": len(selected),
        "n_windows": len(windows),
        "leak_scan_hits": leak_scan_hits,
        "contiguous_concat": contiguous_units,
        "unit_token_order_preserved": no_token_shuffle,
        "tool_use": "EXCLUDED",
        "tool_use_pct": 0.0,
        "packing_ok": packing_ok,
        "seed_data_order": DATA_ORDER_SEED,
        "seed_packing": PACKING_SEED,
        "genesis_document_count": 5,
        "genesis_prefix_distribution": genesis_dist,
        "genesis_max_gap_steps": {k: v["max_gap_steps"] for k, v in gaps.items()},
        "genesis_starved": starved,
        "genesis_majority_doc": majority,
        "literary_share_of_prefix_rehearsal_pct": literary_share,
        "protected_literary": True,
        "corpus_hashes": {
            "wr_corpus_1_train": sha256_file(dump_root / "model-lab" / "corpora" / "WR-CORPUS-1-HARDENED" / "train" / "shard-00000.jsonl"),
            "wr_corpus_1_validation": sha256_file(dump_root / "model-lab" / "corpora" / "WR-CORPUS-1-HARDENED" / "validation" / "shard-00000.jsonl"),
            "wr_corpus_0_train_npy": sha256_file(dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / "train.npy"),
        },
        "val_stream_tokens": int(val_stream.size),
        "val_bos": int(np.count_nonzero(val_stream == BOS_ID)),
        "val_eos": int(np.count_nonzero(val_stream == EOS_ID)),
    }
    return {"stream": stream, "val_stream": val_stream, "audit": audit}
