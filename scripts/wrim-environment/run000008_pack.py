"""BALANCED_GENESIS + capability packer for WRIM1-RUN-000008.

Does not mutate jsonl/npy/tokenizer. Does not construct an optimizer.
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
from run000007_pack import encode_corpus1_filtered, mix_within_tolerance, prefix_bucket_counts, scan_corpus1_filter, shares_from_counts
from run000008_dataset import DATASET_DIRNAME, TRAIN_NAME, load_jsonl as load_cap_jsonl
from run000008_identity import (
    ADDENDUM_NEEDLES,
    FILTER_VERSION,
    GENERAL_RATIO,
    KNOWN_EVAL_DUMP_CHUNK_IDS,
    LINUX_DATA_ROOT,
    LOCKED_MIX,
    MAX_TOKENS,
    MIX_TOLERANCE,
    OVERALL_MIX_TOLERANCE,
    PACK_TARGET_TOKENS,
    PACKER_VERSION,
    REHEARSAL_RATIO,
    CAPABILITY_RATIO,
    SEED,
)

CAP_BUCKETS = ("cap_instruction", "cap_json", "cap_code", "cap_stopping")
GENERAL_BUCKETS = ("prose", "code", "json", "behavior")


def family_budgets() -> dict[str, int]:
    return {fam: int(PACK_TARGET_TOKENS * frac) for fam, frac in LOCKED_MIX.items()}


def overall_shares(actual: dict[str, float]) -> dict[str, float]:
    rehearsal = float(actual.get("wr_corpus_0") or 0.0)
    capability = float(sum(float(actual.get(b) or 0.0) for b in CAP_BUCKETS))
    general = float(sum(float(actual.get(b) or 0.0) for b in GENERAL_BUCKETS))
    return {"rehearsal": rehearsal, "general": general, "capability": capability}


def overall_within_tolerance(shares: dict[str, float]) -> dict[str, Any]:
    targets = {"rehearsal": REHEARSAL_RATIO, "general": GENERAL_RATIO, "capability": CAPABILITY_RATIO}
    reasons = []
    ok = True
    deltas = {}
    for k, target in targets.items():
        got = float(shares.get(k) or 0.0)
        allowed = float(OVERALL_MIX_TOLERANCE.get(k) or 0.03)
        delta = abs(got - target)
        deltas[k] = round(delta, 6)
        if delta > allowed:
            ok = False
            reasons.append(f"{k} actual={got:.6f} target={target:.6f} delta={delta:.6f} > {allowed}")
    return {"ok": ok, "deltas": deltas, "reasons": reasons, "targets": targets, "actual": shares}


def default_cap_train_path() -> Path:
    return Path(LINUX_DATA_ROOT) / DATASET_DIRNAME / TRAIN_NAME


def encode_capability_units(tokenizer, records: list[dict[str, Any]]) -> dict[str, list[Any]]:
    import numpy as np

    from stage1_pack import BOS_ID, EOS_ID, PackedUnit, wrap_lm_tokens

    by: dict[str, list] = defaultdict(list)
    for rec in records:
        cat = str(rec.get("category") or "")
        bucket = {
            "instruction": "cap_instruction",
            "json": "cap_json",
            "code": "cap_code",
            "stopping": "cap_stopping",
        }.get(cat)
        if not bucket:
            continue
        text = str(rec.get("text") or "")
        if not text.strip():
            continue
        body = tokenizer.encode(text, add_special_tokens=False).ids
        if not body:
            continue
        ids = wrap_lm_tokens(body)
        unit = PackedUnit(
            unit_id=str(rec.get("example_id")),
            bucket=bucket,
            origin="WR-CORPUS-CAPABILITY-1",
            tokens=ids if hasattr(ids, "dtype") else np.array(ids, dtype=np.int32),
            source_path=f"WR-CORPUS-CAPABILITY-1/{cat}",
            n_eos=int((ids == EOS_ID).sum()) if hasattr(ids, "__eq__") else 0,
            n_bos=int((ids == BOS_ID).sum()) if hasattr(ids, "__eq__") else 0,
        )
        by[bucket].append(unit)
    return dict(by)


def shuffle_units(units: list[Any], seed: int) -> list[Any]:
    from stage1_pack import shuffle_unit_order

    return shuffle_unit_order(units, seed)


def capability_needle_hits(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    hits = []
    for rec in records:
        blob = str(rec.get("text") or "")
        found = [n for n in ADDENDUM_NEEDLES if n and n in blob]
        if found:
            hits.append({"example_id": rec.get("example_id"), "needles": found})
    return hits


def pack_run000008_stream(
    dump_root: Path,
    tokenizer_path: Path | None = None,
    *,
    capability_train_path: Path | None = None,
) -> dict[str, Any]:
    import numpy as np
    from tokenizers import Tokenizer

    from experiment_pack import _wr_corpus_1_families, encode_behavior_units
    from run000006_pack import Unit
    from stage1_pack import PackedUnit
    from stage2_pack import _pack_selected, take_until_budget

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

    cap_path = Path(capability_train_path or default_cap_train_path())
    cap_records = load_cap_jsonl(cap_path) if cap_path.is_file() else []
    cap_needles = capability_needle_hits(cap_records)
    cap_units = encode_capability_units(tokenizer, cap_records)
    cap_units = {k: shuffle_units(v, SEED + 17 + i) for i, (k, v) in enumerate(sorted(cap_units.items()))}

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
        elif fam in CAP_BUCKETS:
            taken = take_until_budget(cap_units.get(fam, []), budget)
        else:
            taken = take_until_budget(c1.get(fam, []), budget)
        selected.extend(taken)
        selected_counts[fam] = int(sum(int(u.tokens.size) for u in taken))
    stream, meta = _pack_selected(selected, MAX_TOKENS + 1)
    interleaved = meta["interleaved_units"]
    prefix_counts = prefix_bucket_counts(interleaved, MAX_TOKENS)
    actual_mix = shares_from_counts(prefix_counts)
    mix_check = mix_within_tolerance(actual_mix, LOCKED_MIX, MIX_TOLERANCE)
    overall = overall_shares(actual_mix)
    overall_check = overall_within_tolerance(overall)

    used = 0
    by_doc: dict[str, int] = {}
    from run000006_pack import genesis_doc_id
    from run000006_coverage import rehearsal_coverage_report

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
    if not overall_check["ok"]:
        decision = {
            **decision,
            "ok": False,
            "PACKING_PREFLIGHT": "FAIL",
            "abort_before_optimizer": True,
            "decision": "PRETRAIN_ABORT",
            "reasons": list(decision.get("reasons") or []) + overall_check["reasons"],
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
    if cap_needles:
        addendum_leakage = cap_needles if addendum_leakage == "NONE" else list(addendum_leakage) + cap_needles
    if eval_dump_leakage != "NONE":
        decision = {**decision, "ok": False, "PACKING_PREFLIGHT": "FAIL", "abort_before_optimizer": True, "decision": "PRETRAIN_ABORT"}
    if addendum_leakage != "NONE":
        decision = {**decision, "ok": False, "PACKING_PREFLIGHT": "FAIL", "abort_before_optimizer": True, "decision": "PRETRAIN_ABORT"}
    if not cap_records:
        decision = {
            **decision,
            "ok": False,
            "PACKING_PREFLIGHT": "FAIL",
            "abort_before_optimizer": True,
            "decision": "PRETRAIN_ABORT",
            "reasons": list(decision.get("reasons") or []) + ["capability_train_missing"],
        }
    stream_sha = None
    if stream is not None and getattr(stream, "size", 0):
        import hashlib

        stream_sha = hashlib.sha256(np.asarray(stream[:MAX_TOKENS], dtype=np.int32).tobytes()).hexdigest()
    cap_within = {}
    cap_total = float(sum(float(actual_mix.get(b) or 0.0) for b in CAP_BUCKETS) or 1.0)
    for b in CAP_BUCKETS:
        cap_within[b] = round(float(actual_mix.get(b) or 0.0) / cap_total, 6)
    return {
        "packer": PACKER_VERSION,
        "FILTER_VERSION": FILTER_VERSION,
        "seed": SEED,
        "strategy": "BALANCED_GENESIS_PLUS_CAPABILITY",
        "MIX_TARGETS": dict(LOCKED_MIX),
        "FAMILY_TOKEN_BUDGETS": budgets,
        "selected_token_counts": selected_counts,
        "ACTUAL_PACKED_MIX": {k: round(v, 6) for k, v in actual_mix.items()},
        "TRAINING_MIX": overall,
        "CAPABILITY_MIX": cap_within,
        "overall_check": overall_check,
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
        "capability_train_path": str(cap_path),
        "capability_train_count": len(cap_records),
        "capability_selected_counts": {k: selected_counts.get(k, 0) for k in CAP_BUCKETS},
        "dump_source_in_stream": dump_source_in_stream,
        "ADDENDUM_NEEDLES": list(ADDENDUM_NEEDLES),
        "corpus_mutated": False,
        "tokenizer_mutated": False,
        "optimizer_constructed": False,
        "PACKING_PREFLIGHT": decision["PACKING_PREFLIGHT"],
        "_stream": stream,
        "_interleaved": interleaved,
        "_selected": selected,
    }
