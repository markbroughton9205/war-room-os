"""BALANCED_GENESIS + mode-entry packer for WRIM1-RUN-000010.

Instruction/stopping capability only. JSON/code capability budgets are hard-zero.
Does not mutate jsonl/npy/tokenizer. Does not construct an optimizer.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from run000006_coverage import rehearsal_coverage_report
from run000006_pack import balanced_genesis_units, genesis_doc_id, load_frozen_genesis_train_units
from run000007_gates import packing_preflight_decision
from run000007_pack import encode_corpus1_filtered, mix_within_tolerance, prefix_bucket_counts, scan_corpus1_filter, shares_from_counts
from run000008_pack import capability_needle_hits, encode_capability_units, overall_shares, shuffle_units
from run000009_pack import (
    cap_within_from_mix,
    cycle_take_until_budget,
    fill_budget,
    genesis_to_packed,
    leak_scan_units,
    named_cap_within,
)
from run000010_dataset import DATASET_DIRNAME, TRAIN_NAME, load_jsonl as load_mode_jsonl
from run000010_identity import (
    ADDENDUM_NEEDLES,
    CAPABILITY_HARD_CAP,
    CAPABILITY_RATIO,
    FILTER_VERSION,
    GENERAL_RATIO,
    KNOWN_EVAL_DUMP_CHUNK_IDS,
    LINUX_DATA_ROOT,
    LOCKED_MIX,
    MAX_TOKENS,
    MIX_TOLERANCE,
    OVERALL_MIX_TOLERANCE,
    PACKER_VERSION,
    REHEARSAL_RATIO,
    SEED,
)

CAP_BUCKETS = ("cap_instruction", "cap_json", "cap_code", "cap_stopping")
GENERAL_BUCKETS = ("prose", "code", "json", "behavior")
ZERO_CAP_BUCKETS = ("cap_json", "cap_code")


def integer_budgets(locked: dict[str, float], needed: int) -> dict[str, int]:
    floors = {fam: 0 for fam in locked}
    positive = {fam: float(frac) for fam, frac in locked.items() if float(frac) > 0}
    raw = {fam: float(needed) * frac for fam, frac in positive.items()}
    for fam, v in raw.items():
        floors[fam] = int(v)
    rem = int(needed) - int(sum(floors.values()))
    order = sorted(positive, key=lambda f: (raw[f] - floors[f], f), reverse=True)
    i = 0
    while rem > 0 and order:
        floors[order[i % len(order)]] += 1
        rem -= 1
        i += 1
    for fam in ZERO_CAP_BUCKETS:
        floors[fam] = 0
    return floors


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
    cap = float(shares.get("capability") or 0.0)
    if cap > CAPABILITY_HARD_CAP + 1e-12:
        ok = False
        reasons.append(f"capability {cap:.6f} exceeds hard cap {CAPABILITY_HARD_CAP}")
    return {"ok": ok, "deltas": deltas, "reasons": reasons, "targets": targets, "actual": shares}


def default_mode_train_path() -> Path:
    return Path(LINUX_DATA_ROOT) / DATASET_DIRNAME / TRAIN_NAME


def pack_run000010_stream(
    dump_root: Path,
    tokenizer_path: Path | None = None,
    *,
    mode_entry_train_path: Path | None = None,
) -> dict[str, Any]:
    import hashlib

    import numpy as np
    from tokenizers import Tokenizer

    from experiment_pack import _wr_corpus_1_families, encode_behavior_units
    from run000006_pack import Unit
    from stage2_pack import _pack_selected

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
    c1 = _wr_corpus_1_families(
        {"prose": raw["prose"], "code": raw["code"], "json": raw["json"], "behavior": raw["behavior"]},
        SEED,
    )

    cap_path = Path(mode_entry_train_path or default_mode_train_path())
    cap_records = load_mode_jsonl(cap_path) if cap_path.is_file() else []
    json_code_train = [r for r in cap_records if str(r.get("category") or "") in {"json", "code"}]
    cap_needles = capability_needle_hits(cap_records)
    cap_units = encode_capability_units(tokenizer, cap_records)
    cap_units["cap_json"] = []
    cap_units["cap_code"] = []
    cap_units = {k: shuffle_units(v, SEED + 17 + i) for i, (k, v) in enumerate(sorted(cap_units.items()))}

    genesis_raw = load_frozen_genesis_train_units(dump_root)
    needed = MAX_TOKENS + 1
    budgets = integer_budgets(LOCKED_MIX, needed)
    selected = []
    selected_counts: dict[str, int] = {}
    surplus = 16
    for fam, _frac in LOCKED_MIX.items():
        budget = int(budgets[fam])
        if fam in ZERO_CAP_BUCKETS or budget <= 0:
            selected_counts[fam] = 0
            continue
        take_budget = budget + surplus
        if fam == "wr_corpus_0":
            taken = genesis_to_packed(balanced_genesis_units(genesis_raw, SEED, take_budget))
            got = int(sum(int(u.tokens.size) for u in taken))
            if got < max(0, take_budget - 3):
                taken = cycle_take_until_budget(taken or genesis_to_packed(genesis_raw), take_budget, SEED + 7)
        elif fam in CAP_BUCKETS:
            taken = cycle_take_until_budget(cap_units.get(fam, []), take_budget, SEED + 17 + list(CAP_BUCKETS).index(fam))
        else:
            fam_off = {"prose": 1, "code": 2, "json": 3, "behavior": 4}.get(fam, 9)
            taken = fill_budget(c1.get(fam, []), take_budget, SEED + 31 + fam_off)
        selected.extend(taken)
        selected_counts[fam] = int(sum(int(u.tokens.size) for u in taken))

    stream, meta = _pack_selected(selected, needed)
    interleaved = meta["interleaved_units"]
    prefix_counts = prefix_bucket_counts(interleaved, MAX_TOKENS)
    actual_mix = shares_from_counts(prefix_counts)
    mix_check = mix_within_tolerance(actual_mix, LOCKED_MIX, MIX_TOLERANCE)
    overall = overall_shares(actual_mix)
    overall_check = overall_within_tolerance(overall)
    cap_within = cap_within_from_mix(actual_mix)
    named = named_cap_within(cap_within)
    json_train_share = float(actual_mix.get("cap_json") or 0.0)
    code_train_share = float(actual_mix.get("cap_code") or 0.0)
    if json_train_share > 0 or code_train_share > 0 or json_code_train:
        mix_check = {
            **mix_check,
            "ok": False,
            "reasons": list(mix_check.get("reasons") or []) + ["json_or_code_capability_train_nonzero"],
        }

    arr = np.asarray(stream, dtype=np.int32)
    stream_short = int(arr.size) < needed

    used = 0
    by_doc: dict[str, int] = {}
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
    reasons = []
    if not mix_check["ok"]:
        reasons.extend(mix_check.get("reasons") or [])
    if not overall_check["ok"]:
        reasons.extend(overall_check.get("reasons") or [])
    if not scan["dump_gate"]["ok"] or not scan["addendum_gate"]["ok"] or scan["privilege_repair_false_positive"]:
        reasons.append("filter_gate_failed")
    dump_source_in_stream = leak_scan_units(interleaved)
    eval_dump_leakage: Any = "NONE" if not dump_source_in_stream and scan["dump_gate"]["ok"] else (dump_source_in_stream or scan["dump_gate"]["EVAL_DUMP_LEAKAGE"])
    addendum_leakage = scan["addendum_gate"]["INSTRUCTION_ADDENDUM_LEAKAGE"]
    if cap_needles:
        addendum_leakage = cap_needles if addendum_leakage == "NONE" else list(addendum_leakage) + cap_needles
    if eval_dump_leakage != "NONE":
        reasons.append("eval_dump_leakage")
    if addendum_leakage != "NONE":
        reasons.append("addendum_leakage")
    if not cap_records:
        reasons.append("mode_entry_train_missing")
    if stream_short:
        reasons.append(f"packed stream {int(arr.size)} < {needed}")
    if json_train_share > 0 or code_train_share > 0:
        reasons.append(f"JSON_TRAIN_SHARE={json_train_share} CODE_TRAIN_SHARE={code_train_share}")
    if reasons:
        decision = {
            **decision,
            "ok": False,
            "PACKING_PREFLIGHT": "FAIL",
            "abort_before_optimizer": True,
            "decision": "PRETRAIN_ABORT",
            "reasons": list(decision.get("reasons") or []) + reasons,
        }
    stream_sha = hashlib.sha256(np.asarray(arr[: MAX_TOKENS + 1], dtype=np.int32).tobytes()).hexdigest()
    inst_share = float(named.get("INSTRUCTION") or 0.0)
    stop_share = float(named.get("STOPPING") or 0.0)
    return {
        "packer": PACKER_VERSION,
        "FILTER_VERSION": FILTER_VERSION,
        "seed": SEED,
        "strategy": "BALANCED_GENESIS_PLUS_MODE_ENTRY_INSTRUCTION_STOPPING",
        "MIX_TARGETS": dict(LOCKED_MIX),
        "FAMILY_TOKEN_BUDGETS": budgets,
        "selected_token_counts": selected_counts,
        "ACTUAL_PACKED_MIX": {k: round(v, 6) for k, v in actual_mix.items()},
        "TRAINING_MIX": overall,
        "TRAINING_MIX_ACTUAL": overall,
        "CAPABILITY_MIX": cap_within,
        "CAPABILITY_MIX_NAMED": named,
        "INSTRUCTION_SHARE": inst_share,
        "STOPPING_SHARE": stop_share,
        "JSON_TRAIN_SHARE": json_train_share,
        "CODE_TRAIN_SHARE": code_train_share,
        "overall_check": overall_check,
        "mix_check": mix_check,
        "prefix_family_tokens": prefix_counts,
        "mix_tolerance": MIX_TOLERANCE,
        "stream_tokens": int(arr.size),
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
        "EVAL_DUMP_LEAKAGE": eval_dump_leakage,
        "INSTRUCTION_ADDENDUM_LEAKAGE": addendum_leakage,
        "FILTER_MANIFEST_VERIFIED": scan["FILTER_MANIFEST_VERIFIED"] and eval_dump_leakage == "NONE" and addendum_leakage == "NONE",
        "filter_scan": {k: v for k, v in scan.items() if k not in {"excluded"}},
        "mode_entry_train_path": str(cap_path),
        "mode_entry_train_count": len(cap_records),
        "dump_source_in_stream": dump_source_in_stream,
        "ADDENDUM_NEEDLES": list(ADDENDUM_NEEDLES),
        "KNOWN_EVAL_DUMP_CHUNK_IDS": list(KNOWN_EVAL_DUMP_CHUNK_IDS),
        "corpus_mutated": False,
        "tokenizer_mutated": False,
        "capability_dataset_mutated": False,
        "mode_entry_json_code_examples": len(json_code_train),
        "optimizer_constructed": False,
        "PACKING_PREFLIGHT": decision["PACKING_PREFLIGHT"],
        "_stream": arr,
        "_interleaved": interleaved,
        "_selected": selected,
    }
