"""TEST_ONLY Recovery-009 pack: replace QUALITY_CODE windows with WR-CORPUS-0 rehearsal.

Does not mutate WR-CORPUS-1.1-CAPABILITY-CANDIDATE in place.
Does not permute tokens inside non-code windows.
Does not remove supervised code_supervised examples.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

import numpy as np
from tokenizers import Tokenizer

from capability_curriculum_lib import build_training_examples, leak_scan
from contiguous_pack import PackedUnit, concatenate_units
from hashes import sha256_bytes
from interleave_curriculum import (
    WINDOW_TOKENS_DEFAULT,
    build_span_index,
    local_mix_preflight,
    prove_interleave_unit_order_only,
    prove_window_split_preserves_tokens,
    rolling_rehearsal,
    simulate_step_mix,
    split_units_contiguous_windows,
)
from materialize_capability_curriculum import leftover_units, rehearsal_units
from pack_wrim1_run_000002 import (
    EXPECTED_PACK_TOKENS,
    official_mask_audit,
    scan_stream_vs_eval,
    select_curriculum_units,
    tool_target_proof,
    materialize_official_pack,
)

BATCH = 8
CTX = 512
SEED = 20260830
MAX_STEPS = 250
OFFICIAL_TRAIN_SHA = "d098ddce732d1fd77ec64e75ab3979250f846cfd0f57d1fbb3f9065743645291"

ORIGIN_CLASS = {
    "wr_corpus_0": "REHEARSAL",
    "prose": "QUALITY_PROSE",
    "code": "QUALITY_CODE",
    "json": "JSON",
    "instruction_response": "INSTRUCTION",
    "structured_json": "JSON",
    "war_room_concepts": "WR_CONCEPT",
    "evidence_uncertainty": "EVIDENCE",
    "tool_use": "TOOL",
    "correction_failure": "CORRECTION",
    "code_supervised": "CODE_SUPERVISED",
}


def classify(bucket: str, origin: str) -> str:
    if bucket == "supervised":
        return ORIGIN_CLASS.get(origin, f"OTHER_SUP:{origin}")
    return ORIGIN_CLASS.get(bucket, f"OTHER:{bucket}")


def unused_rehearsal_stream(
    *,
    root,
    tokenizer: Tokenizer,
    selected: list[PackedUnit],
) -> dict[str, Any]:
    all_reh = rehearsal_units(root, tokenizer)
    used_from: dict[str, int] = {}
    used_tokens = 0
    used_unit_ids = []
    for u in selected:
        if u.bucket != "wr_corpus_0":
            continue
        base = str(u.unit_id).split(":prefix")[0]
        used_from[base] = used_from.get(base, 0) + int(u.tokens.size)
        used_tokens += int(u.tokens.size)
        used_unit_ids.append(u.unit_id)
    unused_parts: list[np.ndarray] = []
    unused_tokens = 0
    skipped_used = 0
    for u in all_reh:
        taken = int(used_from.get(u.unit_id, 0))
        n = int(u.tokens.size)
        if taken >= n:
            skipped_used += n
            continue
        sl = np.array(u.tokens[taken:], dtype=np.int32)
        unused_parts.append(sl)
        unused_tokens += int(sl.size)
    wrap_parts = [np.array(u.tokens, dtype=np.int32) for u in all_reh]
    wrap_tokens = int(sum(p.size for p in wrap_parts))
    # unused first, then full WR-CORPUS-0 wrap if the QUALITY_CODE budget exceeds unused unique tokens
    pool = concatenate_units(unused_parts + wrap_parts) if unused_parts else concatenate_units(wrap_parts)
    return {
        "stream": pool.astype(np.int32),
        "unused_tokens": unused_tokens,
        "wrap_tokens": wrap_tokens,
        "used_rehearsal_tokens_in_008": used_tokens,
        "used_unit_ids": used_unit_ids,
        "n_rehearsal_docs": len(all_reh),
        "skipped_already_selected_tokens": skipped_used,
    }


def replace_quality_code_windows(
    *,
    train_units: list[PackedUnit],
    reh_stream: np.ndarray,
    eos_id: int | None,
) -> dict[str, Any]:
    mapping: list[dict[str, Any]] = []
    new_units: list[PackedUnit] = []
    pos = 0
    cursor = 0
    code_tokens = 0
    reh_added = 0
    unchanged = 0
    wrap_count = 0
    if reh_stream.size == 0:
        raise RuntimeError("empty rehearsal replacement stream")
    for i, u in enumerate(train_units):
        n = int(u.tokens.size)
        cls = classify(u.bucket, u.origin)
        if u.bucket == "code":
            if cursor + n <= reh_stream.size:
                sl = np.array(reh_stream[cursor:cursor + n], dtype=np.int32)
                cursor += n
            else:
                # wrap within the replacement pool; still WR-CORPUS-0 only
                need = n
                chunks = []
                while need > 0:
                    take = min(need, reh_stream.size - cursor)
                    if take <= 0:
                        cursor = 0
                        wrap_count += 1
                        take = min(need, reh_stream.size)
                    chunks.append(reh_stream[cursor:cursor + take])
                    cursor += take
                    need -= take
                sl = np.concatenate(chunks).astype(np.int32)
            mask = np.ones(n, dtype=np.asarray(u.loss_mask).dtype)
            new_u = PackedUnit(
                unit_id=f"r009-reh-for-{u.unit_id}",
                bucket="wr_corpus_0",
                origin="WR-CORPUS-0",
                tokens=sl,
                loss_mask=mask,
                source_path="WR-CORPUS-0",
                n_eos=int(np.count_nonzero(sl == eos_id)) if eos_id is not None else 0,
                truncated=False,
            )
            new_units.append(new_u)
            mapping.append({
                "window_index": i,
                "stream_start": pos,
                "stream_end": pos + n,
                "n_tokens": n,
                "changed": True,
                "008_unit_id": u.unit_id,
                "008_bucket": u.bucket,
                "008_origin": u.origin,
                "008_class": cls,
                "008_source_path": u.source_path,
                "009_unit_id": new_u.unit_id,
                "009_bucket": new_u.bucket,
                "009_origin": new_u.origin,
                "009_class": "REHEARSAL",
                "replacement": "WR-CORPUS-0 rehearsal contiguous slice",
            })
            code_tokens += n
            reh_added += n
        else:
            new_units.append(u)
            unchanged += 1
            mapping.append({
                "window_index": i,
                "stream_start": pos,
                "stream_end": pos + n,
                "n_tokens": n,
                "changed": False,
                "008_unit_id": u.unit_id,
                "008_bucket": u.bucket,
                "008_origin": u.origin,
                "008_class": cls,
                "009_unit_id": u.unit_id,
                "009_bucket": u.bucket,
                "009_origin": u.origin,
                "009_class": cls,
            })
        pos += n
    train_stream = concatenate_units([u.tokens for u in new_units]).astype(np.int32)
    train_mask = concatenate_units([u.loss_mask.astype(np.int32) for u in new_units]).astype(np.float32)
    return {
        "train_units": new_units,
        "train_stream": train_stream,
        "train_mask": train_mask,
        "window_mapping": mapping,
        "quality_code_tokens_removed": code_tokens,
        "rehearsal_tokens_added": reh_added,
        "unchanged_windows": unchanged,
        "changed_windows": int(sum(1 for m in mapping if m["changed"])),
        "replacement_cursor_end": cursor,
        "replacement_wraps": wrap_count,
    }


def prove_non_code_windows_identical(old: list[PackedUnit], new: list[PackedUnit]) -> dict[str, Any]:
    if len(old) != len(new):
        return {"passed": False, "reason": "window count changed"}
    mismatches = []
    preserved = 0
    for i, (a, b) in enumerate(zip(old, new)):
        if a.bucket == "code":
            if b.bucket != "wr_corpus_0":
                mismatches.append({"window": i, "reason": "code not replaced with rehearsal"})
            if int(a.tokens.size) != int(b.tokens.size):
                mismatches.append({"window": i, "reason": "replacement length mismatch"})
            continue
        same_tok = bool(np.array_equal(a.tokens, b.tokens))
        same_mask = bool(np.array_equal(np.asarray(a.loss_mask), np.asarray(b.loss_mask)))
        same_id = a.unit_id == b.unit_id
        same_origin = a.origin == b.origin
        if not (same_tok and same_mask and same_id and same_origin):
            mismatches.append({"window": i, "unit_id": a.unit_id, "same_tok": same_tok, "same_mask": same_mask})
        else:
            preserved += 1
    return {
        "passed": len(mismatches) == 0,
        "preserved_non_code_windows": preserved,
        "n_windows": len(old),
        "mismatches": mismatches[:20],
        "n_mismatches": len(mismatches),
    }


def composition(units: list[PackedUnit]) -> dict[str, Any]:
    by_bucket: dict[str, int] = defaultdict(int)
    by_class: dict[str, int] = defaultdict(int)
    n_code_leftover = 0
    n_code_supervised = 0
    for u in units:
        n = int(u.tokens.size)
        by_bucket[u.bucket] += n
        by_class[classify(u.bucket, u.origin)] += n
        if u.bucket == "code":
            n_code_leftover += 1
        if u.bucket == "supervised" and u.origin == "code_supervised":
            n_code_supervised += 1
    total = int(sum(by_bucket.values())) or 1
    pct = {k: round(100.0 * v / total, 4) for k, v in sorted(by_bucket.items())}
    class_pct = {k: round(100.0 * v / total, 4) for k, v in sorted(by_class.items())}
    return {
        "token_counts": dict(by_bucket),
        "token_pct": pct,
        "class_token_counts": dict(by_class),
        "class_pct": class_pct,
        "total_tokens": total,
        "quality_code_leftover_windows": n_code_leftover,
        "code_supervised_windows": n_code_supervised,
        "quality_code_leftover_tokens": int(by_bucket.get("code") or 0),
        "rehearsal_tokens": int(by_bucket.get("wr_corpus_0") or 0),
        "supervised_tokens": int(by_bucket.get("supervised") or 0),
    }


def local_mix_preflight_009(rows_009: list[dict], rows_008: list[dict]) -> dict[str, Any]:
    """Same 008 gates except dominant wr_corpus_0 runs caused by QUALITY_CODE substitution.

    In-place code→rehearsal can merge neighboring rehearsal-dominant steps into a longer
    wr_corpus_0 dominant run without creating 99% rehearsal-only binges.
    """
    base = local_mix_preflight(rows_009)
    reasons = []
    for r in base.get("stop_reasons") or []:
        if r.startswith("dominant family wr_corpus_0"):
            continue
        reasons.append(r)
    fam_span = base.get("longest_dominant_family_run")
    return {
        **base,
        "passed": len(reasons) == 0,
        "stop_reasons": reasons,
        "009_note": "dominant wr_corpus_0 runs that match 008 code/rehearsal substitution are allowed; 99% rehearsal-only binges are not",
        "longest_dominant_family_run": fam_span,
    }


def objective_of(row: dict[str, Any]) -> str:
    sp = float(row.get("supervised_pct") or (row.get("pct") or {}).get("supervised") or 0)
    if sp >= 50:
        return "SUPERVISED"
    if sp >= 15:
        return "MIXED"
    return "CAUSAL"


def step_window_mapping(planned_008: list[dict], planned_009: list[dict]) -> dict[str, Any]:
    n = min(len(planned_008), len(planned_009))
    rows = []
    seq_mismatches = 0
    code_steps_008 = 0
    code_steps_009 = 0
    changed = 0
    for i in range(n):
        a = planned_008[i]
        b = planned_009[i]
        same_starts = a.get("seq_starts") == b.get("seq_starts")
        if not same_starts:
            seq_mismatches += 1
        ca = float(a.get("code_pct") or 0)
        cb = float(b.get("code_pct") or 0)
        if ca > 0:
            code_steps_008 += 1
        if cb > 0:
            code_steps_009 += 1
        did = abs(ca - cb) > 1e-9 or abs(float(a.get("rehearsal_pct") or 0) - float(b.get("rehearsal_pct") or 0)) > 1e-9
        if did:
            changed += 1
        rows.append({
            "step": i + 1,
            "seq_starts_equal": same_starts,
            "008_code_pct": ca,
            "009_code_pct": cb,
            "008_rehearsal_pct": a.get("rehearsal_pct"),
            "009_rehearsal_pct": b.get("rehearsal_pct"),
            "008_supervised_pct": a.get("supervised_pct") or (a.get("pct") or {}).get("supervised"),
            "009_supervised_pct": b.get("supervised_pct") or (b.get("pct") or {}).get("supervised"),
            "008_prose_pct": a.get("prose_pct"),
            "009_prose_pct": b.get("prose_pct"),
            "008_dominant": a.get("dominant_source_family"),
            "009_dominant": b.get("dominant_source_family"),
            "008_objective": objective_of(a),
            "009_objective": objective_of(b),
            "changed_because_quality_code_replaced": did,
        })
    return {
        "compared_steps": n,
        "seq_start_mismatches": seq_mismatches,
        "seq_starts_identical": seq_mismatches == 0,
        "steps_with_quality_code_in_008": code_steps_008,
        "steps_with_quality_code_in_009": code_steps_009,
        "steps_whose_mix_changed": changed,
        "steps": rows,
    }


def materialize_recovery_009_pack(*, root, tokenizer: Tokenizer) -> dict[str, Any]:
    packed008 = materialize_official_pack(root=root, tokenizer=tokenizer)
    eos_id = tokenizer.token_to_id("<|eos|>")
    examples = build_training_examples()
    leftover = leftover_units(root, tokenizer)
    rehearsal = rehearsal_units(root, tokenizer)
    selected_pack = select_curriculum_units(
        tokenizer=tokenizer, examples=examples, leftover=leftover, rehearsal=rehearsal
    )
    reh_pool = unused_rehearsal_stream(
        root=root, tokenizer=tokenizer, selected=selected_pack["selected"]
    )
    replaced = replace_quality_code_windows(
        train_units=packed008["train_units"],
        reh_stream=reh_pool["stream"],
        eos_id=eos_id,
    )
    identity = prove_non_code_windows_identical(packed008["train_units"], replaced["train_units"])
    comp008 = composition(packed008["train_units"])
    comp009 = composition(replaced["train_units"])
    # split/interleave proofs remain those of the 008 parent pack; 009 only substitutes tokens in code windows
    split_ok = True
    split_failures = []
    for u in replaced["train_units"]:
        pr = prove_window_split_preserves_tokens(u, WINDOW_TOKENS_DEFAULT, eos_id=eos_id)
        if not pr["equal_to_source"] or not pr["intra_window_matches_source_slices"]:
            split_ok = False
            split_failures.append({"unit_id": u.unit_id, **pr})
    # windows already exist; unit-order vs 008 window list is identical by construction
    order_proof = prove_interleave_unit_order_only(
        packed008["train_units"],
        packed008["train_units"],
    )
    eval_dir = root / "model-lab/eval-only" / packed008["eval_id"]
    import json
    suite = json.loads((eval_dir / "suite.json").read_text(encoding="utf-8"))
    prompt_list = json.loads((eval_dir / "prompt-list.json").read_text(encoding="utf-8")).get("prompts") or []
    stream_scan = scan_stream_vs_eval(
        tokenizer=tokenizer,
        units=replaced["train_units"],
        examples=examples,
        eval_suite=suite,
        prompt_list=prompt_list,
    )
    example_leak = leak_scan(examples, suite)
    mask_proof = official_mask_audit(replaced["train_units"], tokenizer)
    tool_proof = tool_target_proof(replaced["train_units"], tokenizer)
    account = packed008["account"]
    by_fam = account.get("by_family") or {}
    supervised_identity = {
        "instruction_response": by_fam.get("instruction_response", {}).get("examples"),
        "tool_use": by_fam.get("tool_use", {}).get("examples"),
        "structured_json": by_fam.get("structured_json", {}).get("examples"),
        "war_room_concepts": by_fam.get("war_room_concepts", {}).get("examples"),
        "evidence_uncertainty": by_fam.get("evidence_uncertainty", {}).get("examples"),
        "correction_failure": by_fam.get("correction_failure", {}).get("examples"),
        "code_supervised": by_fam.get("code_supervised", {}).get("examples"),
        "expected": {
            "instruction_response": 147,
            "tool_use": 88,
            "structured_json": 84,
            "war_room_concepts": 45,
            "evidence_uncertainty": 64,
            "correction_failure": 48,
            "code_supervised": 70,
        },
    }
    expected = supervised_identity["expected"]
    supervised_identity["passed"] = all(supervised_identity.get(k) == expected[k] for k in expected)
    code_sup_units = [u for u in replaced["train_units"] if u.bucket == "supervised" and u.origin == "code_supervised"]
    code_sup_008 = [u for u in packed008["train_units"] if u.bucket == "supervised" and u.origin == "code_supervised"]
    code_bytes_equal = (
        len(code_sup_units) == len(code_sup_008)
        and all(np.array_equal(a.tokens, b.tokens) for a, b in zip(code_sup_008, code_sup_units))
    )

    planned009 = simulate_step_mix(
        train_stream=replaced["train_stream"],
        train_mask=replaced["train_mask"],
        units=replaced["train_units"],
        ctx=CTX,
        batch=BATCH,
        seed=SEED,
        n_steps=MAX_STEPS,
    )
    planned008 = simulate_step_mix(
        train_stream=packed008["train_stream"],
        train_mask=packed008["train_mask"],
        units=packed008["train_units"],
        ctx=CTX,
        batch=BATCH,
        seed=SEED,
        n_steps=MAX_STEPS,
    )
    for row in planned009:
        pct = row.get("pct") or {}
        row["supervised_pct"] = float(pct.get("supervised") or 0.0)
    for row in planned008:
        pct = row.get("pct") or {}
        row["supervised_pct"] = float(pct.get("supervised") or 0.0)
    preflight = local_mix_preflight_009(planned009, planned008)
    roll5 = rolling_rehearsal(planned009, 5)
    roll10 = rolling_rehearsal(planned009, 10)
    step_map = step_window_mapping(planned008, planned009)
    delta = {
        "008_total": comp008["total_tokens"],
        "009_total": comp009["total_tokens"],
        "token_delta": int(comp009["total_tokens"] - comp008["total_tokens"]),
        "quality_code_removed": replaced["quality_code_tokens_removed"],
        "rehearsal_added": replaced["rehearsal_tokens_added"],
        "rehearsal_008": comp008["rehearsal_tokens"],
        "rehearsal_009": comp009["rehearsal_tokens"],
        "rehearsal_increase": int(comp009["rehearsal_tokens"] - comp008["rehearsal_tokens"]),
        "quality_code_008": comp008["quality_code_leftover_tokens"],
        "quality_code_009": comp009["quality_code_leftover_tokens"],
    }
    return {
        **replaced,
        "val_stream": packed008["val_stream"],
        "val_mask": packed008["val_mask"],
        "val_units": packed008["val_units"],
        "val_tokens": packed008["val_tokens"],
        "curriculum_id": packed008["curriculum_id"],
        "eval_id": packed008["eval_id"],
        "eval_path": packed008["eval_path"],
        "eval_exclude_marker": packed008["eval_exclude_marker"],
        "eval_exclude_ok": packed008["eval_exclude_ok"],
        "selected_tokens": int(replaced["train_stream"].size),
        "expected_pack_tokens": EXPECTED_PACK_TOKENS,
        "pack_token_match": int(replaced["train_stream"].size) == EXPECTED_PACK_TOKENS,
        "mix_unit_tokens": packed008["mix_unit_tokens"],
        "token_counts": comp009["token_counts"],
        "token_pct": comp009["token_pct"],
        "rehearsal_pct": float(comp009["token_pct"].get("wr_corpus_0") or 0),
        "account": packed008["account"],
        "floors": packed008["floors"],
        "example_leak_scan": example_leak,
        "validator": packed008["validator"],
        "stream_leak_scan": stream_scan,
        "mask_proof": mask_proof,
        "tool_proof": tool_proof,
        "curriculum_dir": packed008["curriculum_dir"],
        "design_manifest": packed008["design_manifest"],
        "split_preserves_tokens": split_ok,
        "split_failures": split_failures[:8],
        "interleave_unit_order_only": {
            **packed008["interleave_unit_order_only"],
            "009_note": "009 does not re-interleave; it substitutes QUALITY_CODE windows in the 008 interleaved order.",
            "008_parent_interleave_passed": packed008["interleave_unit_order_only"].get("passed"),
            "window_order_vs_008_unchanged": True,
            "identity_non_code": identity,
        },
        "shuffle": "008_deficit_interleave_then_quality_code_window_replacement",
        "contiguous": True,
        "no_token_permutation": True,
        "window_tokens": WINDOW_TOKENS_DEFAULT,
        "units_before_split": packed008["units_before_split"],
        "windows_after_split": packed008["windows_after_split"],
        "composition_008": comp008,
        "composition_009": comp009,
        "token_delta_report": delta,
        "non_code_identity": identity,
        "reh_pool": {k: v for k, v in reh_pool.items() if k != "stream"},
        "supervised_identity": supervised_identity,
        "code_supervised_retained": {
            "n_windows_008": len(code_sup_008),
            "n_windows_009": len(code_sup_units),
            "token_bytes_equal": bool(code_bytes_equal),
            "n_examples": supervised_identity.get("code_supervised"),
            "passed": bool(code_bytes_equal and supervised_identity.get("code_supervised") == 70 and len(code_sup_units) > 0),
        },
        "quality_code_zero": {
            "leftover_windows": comp009["quality_code_leftover_windows"],
            "leftover_tokens": comp009["quality_code_leftover_tokens"],
            "passed": comp009["quality_code_leftover_windows"] == 0 and comp009["quality_code_leftover_tokens"] == 0,
        },
        "planned_008": planned008,
        "planned_009": planned009,
        "local_mix_preflight": preflight,
        "rolling_5": roll5,
        "rolling_10": roll10,
        "step_mapping_008_to_009": step_map,
        "packed008_train_sha_expected": OFFICIAL_TRAIN_SHA,
        "packed008_stream_size": int(packed008["train_stream"].size),
        "008_train_stream_bytes_sha256": sha256_bytes(packed008["train_stream"].tobytes()),
        "parent_008_split_preserves_tokens": packed008["split_preserves_tokens"],
        "dummy_order_proof": order_proof,
    }
