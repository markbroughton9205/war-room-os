"""WRIM1-RUN-000004 document-major packer. ZERO optimizer steps.

Does not mutate corpora. Does not train. Used to freeze the 25-step stream plan.
"""
from __future__ import annotations

import hashlib
from collections import defaultdict
from dataclasses import replace
from typing import Any

import numpy as np
from tokenizers import Tokenizer

from stage1_pack import PackedUnit, encode_behavior_units, encode_corpus1_units, encode_rehearsal_units, shuffle_unit_order
from stage2_pack import split_bounded_excerpts, take_until_budget

SEQ_LEN = 512
MICRO_BATCH = 8
STEPS = 25
TOKENS_PER_STEP = MICRO_BATCH * SEQ_LEN
TOTAL_PILOT_TOKENS = STEPS * TOKENS_PER_STEP
NEEDED_TRAIN_TOKENS = TOTAL_PILOT_TOKENS + 1
DATA_ORDER_SEED = 4004
ALICE_MARKERS = (
    "Alice was beginning",
    "White Rabbit",
    "Gryphon",
    "Mock Turtle",
    "Queen of Hearts",
    "ALICE’S ADVENTURES",
    "ALICE'S ADVENTURES",
)

CORRECTIVE_MIX = {
    "wr_corpus_0": 0.15,
    "prose": 0.40,
    "code": 0.20,
    "json": 0.21,
    "behavior": 0.04,
}
ALICE_CAP_FRAC = 0.03
MAX_EXCERPT = {
    "wr_corpus_0": 2048,
    "prose": 2048,
    "json": 2048,
    "code": 1024,
    "behavior": 512,
}


def is_alice_unit(tokenizer: Tokenizer, unit: PackedUnit) -> bool:
    text = tokenizer.decode(unit.tokens.tolist(), skip_special_tokens=True)
    return any(m in text for m in ALICE_MARKERS)


def backtick_heavy(tokenizer: Tokenizer, unit: PackedUnit) -> bool:
    sample = unit.tokens[:800].tolist()
    text = tokenizer.decode(sample, skip_special_tokens=True)
    return text.count("`") > 30


def expand(units: list[PackedUnit], family: str) -> list[PackedUnit]:
    cap = MAX_EXCERPT[family]
    out: list[PackedUnit] = []
    for u in units:
        out.extend(split_bounded_excerpts(u, max_tokens=cap))
    return out


def document_major_interleave(selected: list[PackedUnit]) -> list[PackedUnit]:
    """Keep excerpts from the same source document contiguous; interleave documents by family deficit."""
    groups: dict[tuple[str, str], list[PackedUnit]] = defaultdict(list)
    for u in selected:
        key = (u.bucket, str(u.unit_id).split("#")[0])
        groups[key].append(u)
    doc_units: list[tuple[str, list[PackedUnit]]] = []
    for excerpts in groups.values():
        doc_units.append((excerpts[0].bucket, excerpts))
    queues: dict[str, list[list[PackedUnit]]] = defaultdict(list)
    for fam, excerpts in doc_units:
        queues[fam].append(excerpts)
    totals = {k: int(sum(int(e.tokens.size) for ex in v for e in ex)) for k, v in queues.items()}
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
            score = target[fam] if total_used == 0 else target[fam] - (used[fam] / max(1, total_used))
            if best is None or score > best_score:
                best = fam
                best_score = score
        excerpts = remaining[best].pop(0)
        out.extend(excerpts)
        used[best] += int(sum(int(e.tokens.size) for e in excerpts))
    return out


def build_corrective_stream(*, dump_root, tokenizer: Tokenizer) -> dict[str, Any]:
    c1 = encode_corpus1_units(tokenizer, dump_root)
    reh = encode_rehearsal_units(tokenizer, dump_root)
    beh = encode_behavior_units(tokenizer, dump_root)
    alice_flags = [is_alice_unit(tokenizer, u) for u in reh]
    alice = [replace(u, origin="c0_alice") for u, flag in zip(reh, alice_flags) if flag]
    non_alice = [replace(u, origin="c0_non_alice") for u, flag in zip(reh, alice_flags) if not flag]
    code_raw = [u for u in (c1.get("code") or []) if not backtick_heavy(tokenizer, u)]
    families = {
        "wr_corpus_0_non_alice": expand(shuffle_unit_order(non_alice, DATA_ORDER_SEED), "wr_corpus_0"),
        "wr_corpus_0_alice": expand(shuffle_unit_order(alice, DATA_ORDER_SEED + 1), "wr_corpus_0"),
        "prose": expand(shuffle_unit_order(c1.get("prose") or [], DATA_ORDER_SEED + 2), "prose"),
        "code": expand(shuffle_unit_order(code_raw, DATA_ORDER_SEED + 3), "code"),
        "json": expand(shuffle_unit_order(c1.get("json") or [], DATA_ORDER_SEED + 4), "json"),
        "behavior": expand(shuffle_unit_order(beh, DATA_ORDER_SEED + 5), "behavior"),
    }
    selected: list[PackedUnit] = []
    counts: dict[str, int] = {}
    total_budget = NEEDED_TRAIN_TOKENS + 4096
    alice_budget = int(total_budget * ALICE_CAP_FRAC)
    non_alice_budget = int(total_budget * CORRECTIVE_MIX["wr_corpus_0"]) - alice_budget
    if non_alice_budget < 0:
        non_alice_budget = 0
    taken_na = take_until_budget(families["wr_corpus_0_non_alice"], max(4, non_alice_budget))
    taken_al = take_until_budget(families["wr_corpus_0_alice"], max(4, alice_budget))
    selected.extend(taken_na)
    selected.extend(taken_al)
    counts["wr_corpus_0_non_alice"] = int(sum(int(u.tokens.size) for u in taken_na))
    counts["wr_corpus_0_alice"] = int(sum(int(u.tokens.size) for u in taken_al))
    counts["wr_corpus_0"] = counts["wr_corpus_0_non_alice"] + counts["wr_corpus_0_alice"]
    for fam in ("prose", "code", "json", "behavior"):
        budget = int(total_budget * CORRECTIVE_MIX[fam])
        taken = take_until_budget(families[fam], budget)
        selected.extend(taken)
        counts[fam] = int(sum(int(u.tokens.size) for u in taken))

    ordered = document_major_interleave(selected)
    raw = np.concatenate([u.tokens for u in ordered]) if ordered else np.zeros((0,), dtype=np.int32)
    if int(raw.size) < NEEDED_TRAIN_TOKENS:
        raise ValueError(f"corrective stream too short: {raw.size} < {NEEDED_TRAIN_TOKENS}")
    stream = np.array(raw[:NEEDED_TRAIN_TOKENS], dtype=np.int32)
    token_counts: dict[str, int] = defaultdict(int)
    alice_packed = 0
    used = 0
    packed_ids = []
    unit_spans: list[dict[str, Any]] = []
    for u in ordered:
        n = int(u.tokens.size)
        if used >= NEEDED_TRAIN_TOKENS:
            break
        take = min(n, NEEDED_TRAIN_TOKENS - used)
        token_counts[u.bucket] += take
        if u.origin == "c0_alice":
            alice_packed += take
        packed_ids.append(str(u.unit_id).split("#")[0])
        used += take
        unit_spans.append({"bucket": u.bucket, "origin": u.origin, "n": take, "unit_id": str(u.unit_id).split("#")[0]})
    total = int(sum(token_counts.values())) or 1
    pct = {k: round(100.0 * v / total, 2) for k, v in sorted(token_counts.items())}
    return {
        "needed": NEEDED_TRAIN_TOKENS,
        "tokens_per_step": TOKENS_PER_STEP,
        "total_pilot_tokens": TOTAL_PILOT_TOKENS,
        "selected_counts": counts,
        "packed_token_counts": dict(token_counts),
        "packed_token_percent": pct,
        "packed_source_id_count": len(set(packed_ids)),
        "packed_source_ids_sha256": hashlib.sha256("\n".join(sorted(set(packed_ids))).encode("utf-8")).hexdigest(),
        "stream_sha256": hashlib.sha256(stream.tobytes()).hexdigest(),
        "stream_n_tokens": int(stream.size),
        "n_c0_docs": len(reh),
        "n_alice_docs": len(alice),
        "n_non_alice_docs": len(non_alice),
        "alice_tokens_packed": alice_packed,
        "alice_frac_packed": round(alice_packed / total, 4),
        "n_units_selected": len(ordered),
        "unit_spans": unit_spans,
        "packing": "DOCUMENT_MAJOR_CONTIGUOUS",
        "mix_target": CORRECTIVE_MIX,
        "max_excerpt": MAX_EXCERPT,
        "seed": DATA_ORDER_SEED,
        "code_backtick_filter": True,
        "corpus_mutated": False,
        "stream_persisted": False,
        "eval_suites_in_stream": False,
        "stream": stream,
    }
