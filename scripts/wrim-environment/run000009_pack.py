"""Staged BALANCED_GENESIS + capability packer for WRIM1-RUN-000009.

Does not mutate jsonl/npy/tokenizer/capability dataset. Does not construct an optimizer.
"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

from run000006_coverage import rehearsal_coverage_report
from run000006_pack import (
    balanced_genesis_units,
    genesis_doc_id,
    load_frozen_genesis_train_units,
)
from run000007_gates import packing_preflight_decision
from run000007_pack import encode_corpus1_filtered, mix_within_tolerance, prefix_bucket_counts, scan_corpus1_filter, shares_from_counts
from run000008_dataset import DATASET_DIRNAME, TRAIN_NAME, load_jsonl as load_cap_jsonl
from run000008_pack import capability_needle_hits, encode_capability_units, overall_shares, shuffle_units
from run000009_identity import (
    ADDENDUM_NEEDLES,
    CAPABILITY_HARD_CAP,
    CAPABILITY_RATIO,
    FILTER_VERSION,
    GENERAL_RATIO,
    KNOWN_EVAL_DUMP_CHUNK_IDS,
    LINUX_DATA_ROOT,
    MAX_TOKENS,
    MIX_TOLERANCE,
    OVERALL_MIX_TOLERANCE,
    PACKER_VERSION,
    REHEARSAL_RATIO,
    SEED,
    STAGES,
    TOKENS_PER_STEP,
    stage_locked_mix,
)

CAP_BUCKETS = ("cap_instruction", "cap_json", "cap_code", "cap_stopping")
GENERAL_BUCKETS = ("prose", "code", "json", "behavior")
def integer_budgets(locked: dict[str, float], needed: int) -> dict[str, int]:
    raw = {fam: float(needed) * float(frac) for fam, frac in locked.items()}
    floors = {fam: int(v) for fam, v in raw.items()}
    rem = int(needed) - int(sum(floors.values()))
    order = sorted(locked, key=lambda f: (raw[f] - floors[f], f), reverse=True)
    i = 0
    while rem > 0 and order:
        floors[order[i % len(order)]] += 1
        rem -= 1
        i += 1
    return floors


def default_cap_train_path() -> Path:
    return Path(LINUX_DATA_ROOT) / DATASET_DIRNAME / TRAIN_NAME


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


def clone_unit(src: Any, cycle_i: int):
    import numpy as np

    from stage1_pack import PackedUnit

    return PackedUnit(
        unit_id=f"{src.unit_id}#c{cycle_i}",
        bucket=src.bucket,
        origin=src.origin,
        tokens=np.array(src.tokens, dtype=np.int32),
        source_path=getattr(src, "source_path", "") or "",
        n_eos=int(getattr(src, "n_eos", 0) or 0),
        n_bos=int(getattr(src, "n_bos", 0) or 0),
    )


def cycle_take_until_budget(units: list[Any], budget: int, seed: int) -> list[Any]:
    import numpy as np

    from stage1_pack import PackedUnit
    from stage2_pack import contiguous_prefix

    if budget <= 0 or not units:
        return []
    shuffled = shuffle_units(list(units), seed)
    out: list[Any] = []
    used = 0
    i = 0
    max_iter = max(len(shuffled) * 80, 16)
    while used < budget and i < max_iter:
        src = shuffled[i % len(shuffled)]
        remaining = budget - used
        if remaining < 4:
            break
        n = int(src.tokens.size)
        if n <= remaining:
            out.append(clone_unit(src, i))
            used += n
            i += 1
            continue
        capped = contiguous_prefix(src, remaining)
        if capped is not None:
            out.append(
                PackedUnit(
                    unit_id=f"{capped.unit_id}#c{i}",
                    bucket=capped.bucket,
                    origin=capped.origin,
                    tokens=np.array(capped.tokens, dtype=np.int32),
                    source_path=getattr(capped, "source_path", "") or "",
                    n_eos=int(getattr(capped, "n_eos", 0) or 0),
                    n_bos=int(getattr(capped, "n_bos", 0) or 0),
                )
            )
        break
    return out


def fill_budget(units: list[Any], budget: int, seed: int) -> list[Any]:
    from stage2_pack import take_until_budget

    taken = take_until_budget(list(units), budget)
    got = int(sum(int(u.tokens.size) for u in taken))
    if got >= max(0, budget - 3) or not units:
        return taken
    return cycle_take_until_budget(units, budget, seed)


def cap_within_from_mix(actual: dict[str, float]) -> dict[str, float]:
    cap_total = float(sum(float(actual.get(b) or 0.0) for b in CAP_BUCKETS))
    denom = cap_total if cap_total > 0 else 1.0
    return {b: round(float(actual.get(b) or 0.0) / denom, 6) for b in CAP_BUCKETS}


def named_cap_within(raw: dict[str, float]) -> dict[str, float]:
    return {
        "INSTRUCTION": float(raw.get("cap_instruction") or 0.0),
        "STOPPING": float(raw.get("cap_stopping") or 0.0),
        "JSON": float(raw.get("cap_json") or 0.0),
        "CODE": float(raw.get("cap_code") or 0.0),
    }


def genesis_to_packed(taken_u: list[Any]) -> list[Any]:
    import numpy as np

    from stage1_pack import PackedUnit

    out = []
    for u in taken_u:
        toks = np.array(u.tokens, dtype=np.int32)
        out.append(
            PackedUnit(
                unit_id=u.unit_id,
                bucket=u.bucket,
                origin=u.origin,
                tokens=toks,
                n_eos=int(sum(1 for t in list(u.tokens) if int(t) == 2)),
                n_bos=int(sum(1 for t in list(u.tokens) if int(t) == 1)),
            )
        )
    return out


def leak_scan_units(interleaved: list[Any]) -> list[str]:
    hits = []
    for u in interleaved:
        sp = str(getattr(u, "source_path", "") or "").replace("\\", "/")
        if "wrim0_eval_results.json" in sp or "GENESIS_REPORT.md" in sp:
            hits.append(u.unit_id)
        uid = str(u.unit_id)
        if any(cid in uid for cid in KNOWN_EVAL_DUMP_CHUNK_IDS):
            hits.append(uid)
    return hits


def pack_stage(
    *,
    stage: dict[str, Any],
    stage_index: int,
    genesis_raw: list[Any],
    c1: dict[str, list[Any]],
    cap_units: dict[str, list[Any]],
    extra_tokens: int,
) -> dict[str, Any]:
    from stage2_pack import _pack_selected

    n_steps = int(stage["n_steps"])
    stage_tokens = n_steps * TOKENS_PER_STEP
    needed = stage_tokens + extra_tokens
    locked = stage_locked_mix(dict(stage["cap_within"]))
    budgets = integer_budgets(locked, needed)
    selected = []
    selected_counts: dict[str, int] = {}
    stage_seed = SEED + 100 * (stage_index + 1)
    surplus = 16
    for fam, _frac in locked.items():
        budget = int(budgets[fam]) + surplus
        if fam == "wr_corpus_0":
            taken = genesis_to_packed(balanced_genesis_units(genesis_raw, stage_seed, budget))
            got = int(sum(int(u.tokens.size) for u in taken))
            if got < max(0, budget - 3):
                taken = cycle_take_until_budget(taken or genesis_to_packed(genesis_raw), budget, stage_seed + 7)
        elif fam in CAP_BUCKETS:
            taken = cycle_take_until_budget(cap_units.get(fam, []), budget, stage_seed + 17 + list(CAP_BUCKETS).index(fam))
        else:
            fam_off = {"prose": 1, "code": 2, "json": 3, "behavior": 4}.get(fam, 9)
            taken = fill_budget(c1.get(fam, []), budget, stage_seed + 31 + fam_off)
        selected.extend(taken)
        selected_counts[fam] = int(sum(int(u.tokens.size) for u in taken))
    stream, meta = _pack_selected(selected, needed)
    interleaved = meta["interleaved_units"]
    prefix_counts = prefix_bucket_counts(interleaved, stage_tokens)
    actual_mix = shares_from_counts(prefix_counts)
    mix_check = mix_within_tolerance(actual_mix, locked, MIX_TOLERANCE)
    overall = overall_shares(actual_mix)
    cap_within = cap_within_from_mix(actual_mix)
    import numpy as np

    arr = np.asarray(stream, dtype=np.int32)
    if int(arr.size) < needed:
        mix_check = {
            **mix_check,
            "ok": False,
            "reasons": list(mix_check.get("reasons") or []) + [f"stage {stage['name']} packed {int(arr.size)} < needed {needed}"],
        }
        take_n = min(int(arr.size), stage_tokens)
        prefix = arr[:take_n]
        leftover = arr[take_n:needed] if extra_tokens else arr[0:0]
    else:
        prefix = arr[:stage_tokens]
        leftover = arr[stage_tokens:needed] if extra_tokens else arr[0:0]
    return {
        "name": stage["name"],
        "first_step": int(stage["first_step"]),
        "last_step": int(stage["last_step"]),
        "n_steps": n_steps,
        "stage_tokens": stage_tokens,
        "MIX_TARGETS": dict(locked),
        "FAMILY_TOKEN_BUDGETS": budgets,
        "selected_token_counts": selected_counts,
        "ACTUAL_PACKED_MIX": {k: round(v, 6) for k, v in actual_mix.items()},
        "TRAINING_MIX": overall,
        "CAPABILITY_MIX": cap_within,
        "CAPABILITY_MIX_NAMED": named_cap_within(cap_within),
        "mix_check": mix_check,
        "prefix_family_tokens": prefix_counts,
        "stream_tokens": int(arr.size),
        "_prefix": prefix,
        "_leftover": leftover,
        "_interleaved": interleaved,
        "_selected": selected,
    }


def pack_run000009_stream(
    dump_root: Path,
    tokenizer_path: Path | None = None,
    *,
    capability_train_path: Path | None = None,
) -> dict[str, Any]:
    import hashlib

    import numpy as np
    from tokenizers import Tokenizer

    from experiment_pack import _wr_corpus_1_families, encode_behavior_units
    from run000006_pack import Unit

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

    cap_path = Path(capability_train_path or default_cap_train_path())
    cap_records = load_cap_jsonl(cap_path) if cap_path.is_file() else []
    cap_needles = capability_needle_hits(cap_records)
    cap_units = encode_capability_units(tokenizer, cap_records)
    cap_units = {k: shuffle_units(v, SEED + 17 + i) for i, (k, v) in enumerate(sorted(cap_units.items()))}

    genesis_raw = load_frozen_genesis_train_units(dump_root)
    stages_out = []
    all_interleaved = []
    prefixes = []
    leftover = None
    for i, st in enumerate(STAGES):
        extra = 1 if i == len(STAGES) - 1 else 0
        packed = pack_stage(
            stage=st,
            stage_index=i,
            genesis_raw=genesis_raw,
            c1=c1,
            cap_units=cap_units,
            extra_tokens=extra,
        )
        prefixes.append(packed.pop("_prefix"))
        leftover = packed.pop("_leftover")
        all_interleaved.extend(packed.pop("_interleaved"))
        packed.pop("_selected", None)
        stages_out.append(packed)
    stream = np.concatenate(prefixes) if prefixes else np.zeros((0,), dtype=np.int32)
    if leftover is not None and int(getattr(leftover, "size", 0) or 0) > 0:
        stream = np.concatenate([stream, leftover])
    stream_short = int(stream.size) < MAX_TOKENS + 1

    prefix_counts = prefix_bucket_counts(all_interleaved, MAX_TOKENS)
    actual_mix = shares_from_counts(prefix_counts)
    overall = overall_shares(actual_mix)
    overall_check = overall_within_tolerance(overall)
    mix_reasons = []
    mix_ok = True
    for st in stages_out:
        if not st["mix_check"]["ok"]:
            mix_ok = False
            mix_reasons.extend([f"{st['name']}: {r}" for r in st["mix_check"]["reasons"]])

    used = 0
    by_doc: dict[str, int] = {}
    for u in all_interleaved:
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
    if not mix_ok:
        decision = {
            **decision,
            "ok": False,
            "PACKING_PREFLIGHT": "FAIL",
            "abort_before_optimizer": True,
            "decision": "PRETRAIN_ABORT",
            "reasons": list(decision.get("reasons") or []) + mix_reasons,
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
    dump_source_in_stream = leak_scan_units(all_interleaved)
    eval_dump_leakage: Any = "NONE" if not dump_source_in_stream and scan["dump_gate"]["ok"] else (dump_source_in_stream or scan["dump_gate"]["EVAL_DUMP_LEAKAGE"])
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
    if stream_short:
        decision = {
            **decision,
            "ok": False,
            "PACKING_PREFLIGHT": "FAIL",
            "abort_before_optimizer": True,
            "decision": "PRETRAIN_ABORT",
            "reasons": list(decision.get("reasons") or []) + [f"concatenated stream {int(stream.size)} < {MAX_TOKENS + 1}"],
        }
    stream_sha = hashlib.sha256(np.asarray(stream[: MAX_TOKENS + 1], dtype=np.int32).tobytes()).hexdigest()
    cap_within = cap_within_from_mix(actual_mix)
    stage_named = {st["name"]: st["CAPABILITY_MIX_NAMED"] for st in stages_out}
    return {
        "packer": PACKER_VERSION,
        "FILTER_VERSION": FILTER_VERSION,
        "seed": SEED,
        "strategy": "STAGED_BALANCED_GENESIS_PLUS_CAPABILITY",
        "STAGES": stages_out,
        "STAGE_A_CAPABILITY_MIX": stage_named.get("A_MODE_ENTRY"),
        "STAGE_B_CAPABILITY_MIX": stage_named.get("B_STRUCTURE"),
        "STAGE_C_CAPABILITY_MIX": stage_named.get("C_CODE_ACQUISITION"),
        "STAGE_D_CAPABILITY_MIX": stage_named.get("D_CONSOLIDATION"),
        "ACTUAL_PACKED_MIX": {k: round(v, 6) for k, v in actual_mix.items()},
        "TRAINING_MIX": overall,
        "TRAINING_MIX_ACTUAL": overall,
        "CAPABILITY_MIX": cap_within,
        "overall_check": overall_check,
        "prefix_family_tokens": prefix_counts,
        "mix_tolerance": MIX_TOLERANCE,
        "stream_tokens": int(stream.size),
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
        "capability_train_path": str(cap_path),
        "capability_train_count": len(cap_records),
        "dump_source_in_stream": dump_source_in_stream,
        "ADDENDUM_NEEDLES": list(ADDENDUM_NEEDLES),
        "corpus_mutated": False,
        "tokenizer_mutated": False,
        "capability_dataset_mutated": False,
        "optimizer_constructed": False,
        "PACKING_PREFLIGHT": decision["PACKING_PREFLIGHT"],
        "_stream": stream,
        "_interleaved": all_interleaved,
    }
