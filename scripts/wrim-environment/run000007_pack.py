"""BALANCED_GENESIS packer for WRIM1-RUN-000007 with packer-only eval-dump filter.

Does not mutate jsonl/npy/tokenizer. Does not construct an optimizer.
Genesis rehearsal uses frozen train.npy. Mixed WR-CORPUS-1 encoding requires the
Linux WRIM tokenizer at preflight time.
"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

from run000006_coverage import FROZEN_GENESIS_TRAIN_IDS
from run000006_pack import (
    balanced_genesis_units,
    coverage_from_units,
    load_frozen_genesis_train_units,
)
from run000007_filter import (
    assert_addendum_absent,
    assert_dump_excluded,
    filter_records,
    load_jsonl,
    text_of,
)
from run000007_gates import packing_preflight_decision
from run000007_identity import (
    ADDENDUM_NEEDLES,
    FILTER_VERSION,
    KNOWN_EVAL_DUMP_CHUNK_IDS,
    LOCKED_MIX,
    MAX_TOKENS,
    MIX_TOLERANCE,
    PACK_TARGET_TOKENS,
    PACKER_VERSION,
    SEED,
)

CORPUS1_JSONL = ("model-lab", "corpora", "WR-CORPUS-1-HARDENED", "train", "shard-00000.jsonl")


def mix_within_tolerance(actual: dict[str, float], targets: dict[str, float], tol: dict[str, float]) -> dict[str, Any]:
    reasons = []
    ok = True
    deltas = {}
    for fam, target in targets.items():
        got = float(actual.get(fam) or 0.0)
        allowed = float(tol.get(fam) or 0.02)
        delta = abs(got - float(target))
        deltas[fam] = round(delta, 6)
        if delta > allowed:
            ok = False
            reasons.append(f"{fam} actual={got:.6f} target={target:.6f} delta={delta:.6f} > {allowed}")
    return {"ok": ok, "deltas": deltas, "reasons": reasons}


def shares_from_counts(counts: dict[str, int]) -> dict[str, float]:
    total = float(sum(counts.values()) or 1)
    return {k: float(v) / total for k, v in counts.items()}


def prefix_bucket_counts(units: list[Any], prefix_tokens: int) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    used = 0
    for u in units:
        n = int(getattr(u, "size", None) or (u.tokens.size if hasattr(u, "tokens") else len(u.tokens)))
        take = n if used + n <= prefix_tokens else max(0, prefix_tokens - used)
        if take <= 0:
            break
        counts[u.bucket] += take
        used += take
        if used >= prefix_tokens:
            break
    return dict(counts)


def family_budgets() -> dict[str, int]:
    return {fam: int(PACK_TARGET_TOKENS * frac) for fam, frac in LOCKED_MIX.items()}


def scan_corpus1_filter(dump_root: Path) -> dict[str, Any]:
    jsonl = dump_root.joinpath(*CORPUS1_JSONL)
    rows = load_jsonl(jsonl)
    filt = filter_records(rows)
    dump_v = assert_dump_excluded(filt)
    add_v = assert_addendum_absent(filt)
    privilege_false_positive = bool(filt.get("privilege_repair_excluded"))
    kept = filt.pop("kept")
    return {
        **filt,
        "dump_gate": dump_v,
        "addendum_gate": add_v,
        "privilege_repair_false_positive": privilege_false_positive,
        "kept_count": len(kept),
        "source_file": str(jsonl),
        "corpus_rewritten": False,
        "FILTER_MANIFEST_VERIFIED": bool(dump_v["ok"] and add_v["ok"] and not privilege_false_positive),
        "_kept": kept,
    }


def encode_corpus1_filtered(tokenizer, dump_root: Path, kept_records: list[dict[str, Any]]) -> dict[str, list[Any]]:
    from collections import defaultdict as dd

    from stage1_pack import (
        BOS_ID,
        EOS_ID,
        PackedUnit,
        group_chunks_into_source_runs,
        is_eval_infra_text,
        is_tool_use,
        wrap_lm_tokens,
        bucket_for_record,
    )

    clean = []
    for rec in kept_records:
        text = text_of(rec)
        path = str(rec.get("source_path") or "")
        if is_tool_use(rec) or is_eval_infra_text(text, path):
            continue
        clean.append(rec)
    by_bucket: dict[str, list] = dd(list)
    for run in group_chunks_into_source_runs(clean, group_by="lineage"):
        text = "".join(text_of(r) for r in run)
        if not text.strip():
            continue
        body = tokenizer.encode(text).ids
        if not body:
            continue
        ids = wrap_lm_tokens(body)
        bucket = bucket_for_record(run[0])
        if bucket == "behavior":
            bucket = "other"
        if bucket == "other":
            continue
        unit_id = str(run[0].get("source_lineage") or run[0].get("chunk_id"))
        unit = PackedUnit(
            unit_id=unit_id,
            bucket=bucket,
            origin="WR-CORPUS-1",
            tokens=ids,
            source_path=str(run[0].get("source_path") or ""),
            n_eos=int((ids == EOS_ID).sum()) if hasattr(ids, "__eq__") else 0,
            n_bos=int((ids == BOS_ID).sum()) if hasattr(ids, "__eq__") else 0,
        )
        by_bucket[bucket].append(unit)
    return by_bucket


def pack_run000007_stream(dump_root: Path, tokenizer_path: Path | None = None) -> dict[str, Any]:
    """Exact proposed RUN-000007 training stream. Filter is packer-only."""
    import numpy as np
    from tokenizers import Tokenizer

    from experiment_pack import _wr_corpus_1_families, encode_behavior_units
    from run000006_pack import Unit
    from stage1_pack import PackedUnit
    from stage2_pack import _pack_selected, encode_behavior_units as _unused, take_until_budget

    del _unused
    scan = scan_corpus1_filter(dump_root)
    kept = scan.pop("_kept")
    tok_path = tokenizer_path or (dump_root / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json")
    tokenizer = Tokenizer.from_file(str(tok_path))
    c1_raw = encode_corpus1_filtered(tokenizer, dump_root, kept)
    behavior = encode_behavior_units(tokenizer, dump_root)
    raw = {
        "prose": list(c1_raw.get("prose") or []),
        "code": list(c1_raw.get("code") or []),
        "json": list(c1_raw.get("json") or []),
        "behavior": list(behavior),
    }
    c1 = _wr_corpus_1_families({"prose": raw["prose"], "code": raw["code"], "json": raw["json"], "behavior": raw["behavior"]}, SEED)
    genesis_raw = load_frozen_genesis_train_units(dump_root)
    selected: list[PackedUnit] = []
    selected_counts: dict[str, int] = {}
    budgets = family_budgets()
    for fam, frac in LOCKED_MIX.items():
        budget = budgets[fam]
        if fam == "wr_corpus_0":
            taken_u = balanced_genesis_units(genesis_raw, SEED, budget)
            taken = [
                PackedUnit(
                    unit_id=u.unit_id,
                    bucket=u.bucket,
                    origin=u.origin,
                    tokens=np.array(u.tokens, dtype=np.int32),
                    n_eos=int(sum(1 for t in u.tokens if t == 2)),
                    n_bos=int(sum(1 for t in u.tokens if t == 1)),
                )
                for u in taken_u
            ]
        else:
            taken = take_until_budget(c1.get(fam, []), budget)
        selected.extend(taken)
        selected_counts[fam] = int(sum(int(u.tokens.size) for u in taken))
    stream, meta = _pack_selected(selected, MAX_TOKENS + 1)
    interleaved = meta["interleaved_units"]
    prefix_counts = prefix_bucket_counts(interleaved, MAX_TOKENS)
    actual_mix = shares_from_counts(prefix_counts)
    mix_check = mix_within_tolerance(actual_mix, LOCKED_MIX, MIX_TOLERANCE)
    audit = coverage_from_units(
        [Unit(unit_id=u.unit_id, bucket=u.bucket, tokens=list(u.tokens.tolist()), origin=u.origin) for u in interleaved if u.bucket == "wr_corpus_0"],
        MAX_TOKENS,
    )
    # Recompute genesis coverage from interleaved prefix.
    used = 0
    by_doc: dict[str, int] = {}
    from run000006_pack import genesis_doc_id

    for u in interleaved:
        n = int(u.tokens.size)
        take = n if used + n <= MAX_TOKENS else max(0, MAX_TOKENS - used)
        if take <= 0:
            break
        if u.bucket == "wr_corpus_0":
            doc = genesis_doc_id(Unit(unit_id=u.unit_id, bucket=u.bucket, tokens=[], origin=u.origin))
            by_doc[doc] = int(by_doc.get(doc, 0)) + take
        used += take
        if used >= MAX_TOKENS:
            break
    from run000006_coverage import rehearsal_coverage_report

    audit = rehearsal_coverage_report(by_doc)
    decision = packing_preflight_decision(
        starved_doc_ids=list(audit["STARVED_DOC_IDS"]),
        max_doc_share=float(audit["MAX_DOC_SHARE"]),
    )
    if not mix_check["ok"]:
        decision = {
            **decision,
            "ok": False,
            "PACKING_PREFLIGHT": "FAIL",
            "abort_before_optimizer": True,
            "decision": "PRETRAIN_ABORT",
            "reasons": list(decision.get("reasons") or []) + mix_check["reasons"],
        }
    if not scan["dump_gate"]["ok"] or not scan["addendum_gate"]["ok"] or scan["privilege_repair_false_positive"]:
        decision = {
            **decision,
            "ok": False,
            "PACKING_PREFLIGHT": "FAIL",
            "abort_before_optimizer": True,
            "decision": "PRETRAIN_ABORT",
            "reasons": list(decision.get("reasons") or []) + ["filter_gate_failed"],
        }
    # Decode prefix for needle / dump-id leakage at stream level without writing corpus.
    decoded_hits = []
    dump_source_in_stream = []
    for u in interleaved:
        sp = str(getattr(u, "source_path", "") or "")
        if "wrim0_eval_results.json" in sp.replace("\\", "/") or "GENESIS_REPORT.md" in sp.replace("\\", "/"):
            dump_source_in_stream.append(u.unit_id)
        uid = str(u.unit_id)
        if any(cid in uid for cid in KNOWN_EVAL_DUMP_CHUNK_IDS):
            dump_source_in_stream.append(uid)
    eval_dump_leakage = "NONE" if not dump_source_in_stream and scan["dump_gate"]["ok"] else (dump_source_in_stream or scan["dump_gate"]["EVAL_DUMP_LEAKAGE"])
    addendum_leakage = scan["addendum_gate"]["INSTRUCTION_ADDENDUM_LEAKAGE"]
    if eval_dump_leakage != "NONE":
        decision = {**decision, "ok": False, "PACKING_PREFLIGHT": "FAIL", "abort_before_optimizer": True, "decision": "PRETRAIN_ABORT"}
    if addendum_leakage != "NONE":
        decision = {**decision, "ok": False, "PACKING_PREFLIGHT": "FAIL", "abort_before_optimizer": True, "decision": "PRETRAIN_ABORT"}
    stream_sha = None
    if stream is not None and getattr(stream, "size", 0):
        import hashlib

        stream_sha = hashlib.sha256(np.asarray(stream[:MAX_TOKENS], dtype=np.int32).tobytes()).hexdigest()
    return {
        "packer": PACKER_VERSION,
        "FILTER_VERSION": FILTER_VERSION,
        "seed": SEED,
        "strategy": "BALANCED_GENESIS",
        "MIX_TARGETS": dict(LOCKED_MIX),
        "FAMILY_TOKEN_BUDGETS": budgets,
        "selected_token_counts": selected_counts,
        "ACTUAL_PACKED_MIX": {k: round(v, 6) for k, v in actual_mix.items()},
        "prefix_family_tokens": prefix_counts,
        "mix_tolerance": MIX_TOLERANCE,
        "mix_check": mix_check,
        "stream_tokens": int(getattr(stream, "size", 0) or 0),
        "prefix_tokens": MAX_TOKENS,
        "stream_prefix_sha256": stream_sha,
        "audit": audit,
        "decision": decision,
        "ALL_REHEARSAL_DOCS": audit["ALL_DOC_IDS"],
        "REHEARSAL_TOKEN_ALLOCATION": audit["DOC_TOKEN_COUNTS"],
        "MAX_REHEARSAL_DOC_SHARE": audit["MAX_DOC_SHARE"],
        "EFFECTIVE_DOCUMENT_N": audit["EFFECTIVE_DOCUMENT_N"],
        "STARVED_DOC_IDS": audit["STARVED_DOC_IDS"],
        "TOTAL_SOURCE_RECORDS": scan["TOTAL_SOURCE_RECORDS"],
        "EXCLUDED_RECORDS": scan["EXCLUDED_RECORDS"],
        "EXCLUDED_RECORD_IDS": scan["EXCLUDED_RECORD_IDS"],
        "EXCLUDED_TOKEN_COUNT": scan["EXCLUDED_TOKEN_COUNT"],
        "FAMILY_COUNTS_BEFORE": scan["FAMILY_COUNTS_BEFORE"],
        "FAMILY_COUNTS_AFTER": scan["FAMILY_COUNTS_AFTER"],
        "EVAL_DUMP_LEAKAGE": eval_dump_leakage if eval_dump_leakage == "NONE" else eval_dump_leakage,
        "INSTRUCTION_ADDENDUM_LEAKAGE": addendum_leakage,
        "FILTER_MANIFEST_VERIFIED": scan["FILTER_MANIFEST_VERIFIED"] and eval_dump_leakage == "NONE" and addendum_leakage == "NONE",
        "filter_scan": {k: v for k, v in scan.items() if k not in {"excluded"}},
        "excluded_detail": scan.get("excluded"),
        "decoded_needle_hits": decoded_hits,
        "dump_source_in_stream": dump_source_in_stream,
        "ADDENDUM_NEEDLES": list(ADDENDUM_NEEDLES),
        "corpus_mutated": False,
        "tokenizer_mutated": False,
        "optimizer_constructed": False,
        "PACKING_PREFLIGHT": decision["PACKING_PREFLIGHT"],
    }


def pack_balanced_genesis(dump_root: Path, tokenizer_path: Path | None = None) -> dict[str, Any]:
    """Preflight entry: full filtered mixed stream when tokenizer is present."""
    return pack_run000007_stream(dump_root, tokenizer_path)


def self_test() -> dict[str, Any]:
    from run000006_coverage import rehearsal_coverage_report

    counts = {
        FROZEN_GENESIS_TRAIN_IDS[0]: 1000,
        FROZEN_GENESIS_TRAIN_IDS[1]: 1000,
        FROZEN_GENESIS_TRAIN_IDS[2]: 1000,
        FROZEN_GENESIS_TRAIN_IDS[3]: 1000,
    }
    omitted = rehearsal_coverage_report(counts)
    empty = rehearsal_coverage_report({})
    checks = [
        FROZEN_GENESIS_TRAIN_IDS[4] in omitted["STARVED_DOC_IDS"],
        len(omitted["ALL_DOC_IDS"]) == 5,
        empty["STARVED_DOC_IDS"] == list(FROZEN_GENESIS_TRAIN_IDS),
        omitted["MAX_DOC_SHARE"] == 0.25,
    ]
    return {"ok": all(checks), "checks": checks, "omitted_starved": omitted["STARVED_DOC_IDS"]}
