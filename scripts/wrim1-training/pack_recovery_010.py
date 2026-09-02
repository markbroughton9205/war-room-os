"""TEST_ONLY Recovery-010 pack: replace TOOL_USE supervised windows with WR-CORPUS-0 rehearsal.

Base control: Recovery-008 / WRIM1-RUN-000002 capability pack (NOT Recovery-009 mix).
Does not mutate WR-CORPUS-1.1-CAPABILITY-CANDIDATE in place.
Does not permute tokens inside non-tool windows.
Does not remove QUALITY_CODE leftover or other supervised families.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

import numpy as np
from tokenizers import Tokenizer

from capability_curriculum_lib import EVAL_ID, build_training_examples, leak_scan
from contiguous_pack import PackedUnit, concatenate_units
from hashes import sha256_bytes, sha256_file
from interleave_curriculum import (
    WINDOW_TOKENS_DEFAULT,
    local_mix_preflight,
    prove_interleave_unit_order_only,
    prove_window_split_preserves_tokens,
    rolling_rehearsal,
    simulate_step_mix,
)
from pack_recovery_009 import (
    OFFICIAL_TRAIN_SHA,
    classify,
    objective_of,
    unused_rehearsal_stream,
)
from pack_wrim1_run_000002 import (
    EXPECTED_PACK_TOKENS,
    official_mask_audit,
    scan_stream_vs_eval,
    materialize_official_pack,
)

BATCH = 8
CTX = 512
SEED = 20260830
MAX_STEPS = 250
PACK_ID = "WR-CORPUS-1.1-RECOVERY-010-NO-TOOL"

EXPECTED_SUPERVISED_008 = {
    "instruction_response": 147,
    "tool_use": 88,
    "structured_json": 84,
    "war_room_concepts": 45,
    "evidence_uncertainty": 64,
    "correction_failure": 48,
    "code_supervised": 70,
}

EXPECTED_SUPERVISED_010 = {
    **EXPECTED_SUPERVISED_008,
    "tool_use": 0,
}


def is_tool_use_unit(u: PackedUnit) -> bool:
    return u.bucket == "supervised" and u.origin == "tool_use"


def replace_tool_use_windows(
    *,
    train_units: list[PackedUnit],
    reh_stream: np.ndarray,
    eos_id: int | None,
) -> dict[str, Any]:
    mapping: list[dict[str, Any]] = []
    new_units: list[PackedUnit] = []
    pos = 0
    cursor = 0
    tool_tokens = 0
    tool_target_tokens = 0
    reh_added = 0
    unchanged = 0
    wrap_count = 0
    n_tool_windows = 0
    if reh_stream.size == 0:
        raise RuntimeError("empty rehearsal replacement stream")
    for i, u in enumerate(train_units):
        n = int(u.tokens.size)
        cls = classify(u.bucket, u.origin)
        if is_tool_use_unit(u):
            n_tool_windows += 1
            tool_target_tokens += int(np.sum(np.asarray(u.loss_mask) == 1))
            if cursor + n <= reh_stream.size:
                sl = np.array(reh_stream[cursor:cursor + n], dtype=np.int32)
                cursor += n
            else:
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
                unit_id=f"r010-reh-for-{u.unit_id}",
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
                "010_unit_id": new_u.unit_id,
                "010_bucket": new_u.bucket,
                "010_origin": new_u.origin,
                "010_class": "REHEARSAL",
                "replacement": "WR-CORPUS-0 rehearsal contiguous slice",
            })
            tool_tokens += n
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
                "010_unit_id": u.unit_id,
                "010_bucket": u.bucket,
                "010_origin": u.origin,
                "010_class": cls,
            })
        pos += n
    train_stream = concatenate_units([u.tokens for u in new_units]).astype(np.int32)
    train_mask = concatenate_units([u.loss_mask.astype(np.int32) for u in new_units]).astype(np.float32)
    return {
        "train_units": new_units,
        "train_stream": train_stream,
        "train_mask": train_mask,
        "window_mapping": mapping,
        "tool_use_tokens_removed": tool_tokens,
        "tool_use_target_tokens_removed": tool_target_tokens,
        "rehearsal_tokens_added": reh_added,
        "unchanged_windows": unchanged,
        "changed_windows": int(sum(1 for m in mapping if m["changed"])),
        "n_tool_windows_replaced": n_tool_windows,
        "replacement_cursor_end": cursor,
        "replacement_wraps": wrap_count,
    }


def prove_non_tool_windows_identical(old: list[PackedUnit], new: list[PackedUnit]) -> dict[str, Any]:
    if len(old) != len(new):
        return {"passed": False, "reason": "window count changed"}
    mismatches = []
    preserved = 0
    for i, (a, b) in enumerate(zip(old, new)):
        if is_tool_use_unit(a):
            if b.bucket != "wr_corpus_0":
                mismatches.append({"window": i, "reason": "tool_use not replaced with rehearsal"})
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
        "preserved_non_tool_windows": preserved,
        "n_windows": len(old),
        "mismatches": mismatches[:20],
        "n_mismatches": len(mismatches),
    }


def composition(units: list[PackedUnit]) -> dict[str, Any]:
    by_bucket: dict[str, int] = defaultdict(int)
    by_class: dict[str, int] = defaultdict(int)
    by_origin_sup: dict[str, int] = defaultdict(int)
    n_tool = 0
    n_code_leftover = 0
    tool_target = 0
    for u in units:
        n = int(u.tokens.size)
        by_bucket[u.bucket] += n
        by_class[classify(u.bucket, u.origin)] += n
        if u.bucket == "code":
            n_code_leftover += 1
        if is_tool_use_unit(u):
            n_tool += 1
            tool_target += int(np.sum(np.asarray(u.loss_mask) == 1))
        if u.bucket == "supervised":
            by_origin_sup[u.origin] += 1
    total = int(sum(by_bucket.values())) or 1
    pct = {k: round(100.0 * v / total, 4) for k, v in sorted(by_bucket.items())}
    class_pct = {k: round(100.0 * v / total, 4) for k, v in sorted(by_class.items())}
    return {
        "token_counts": dict(by_bucket),
        "token_pct": pct,
        "class_token_counts": dict(by_class),
        "class_pct": class_pct,
        "supervised_origin_window_counts": dict(by_origin_sup),
        "total_tokens": total,
        "quality_code_leftover_windows": n_code_leftover,
        "tool_use_windows": n_tool,
        "tool_use_target_tokens": tool_target,
        "quality_code_leftover_tokens": int(by_bucket.get("code") or 0),
        "rehearsal_tokens": int(by_bucket.get("wr_corpus_0") or 0),
        "supervised_tokens": int(by_bucket.get("supervised") or 0),
    }


def local_mix_preflight_010(rows_010: list[dict], rows_008: list[dict]) -> dict[str, Any]:
    """Same 008 gates except dominant wr_corpus_0 runs caused by TOOL_USE substitution."""
    base = local_mix_preflight(rows_010)
    reasons = []
    for r in base.get("stop_reasons") or []:
        if r.startswith("dominant family wr_corpus_0"):
            continue
        reasons.append(r)
    return {
        **base,
        "passed": len(reasons) == 0,
        "stop_reasons": reasons,
        "010_note": (
            "dominant wr_corpus_0 runs from TOOL_USE→rehearsal substitution are allowed; "
            "99% rehearsal-only binges are not"
        ),
        "compared_008_steps": len(rows_008),
    }


def step_window_mapping(planned_008: list[dict], planned_010: list[dict]) -> dict[str, Any]:
    n = min(len(planned_008), len(planned_010))
    rows = []
    seq_mismatches = 0
    tool_steps_008 = 0
    tool_steps_010 = 0
    changed = 0
    n_switch_008 = 0
    n_switch_010 = 0
    last_008 = last_010 = None
    for i in range(n):
        a = planned_008[i]
        b = planned_010[i]
        same_starts = a.get("seq_starts") == b.get("seq_starts")
        if not same_starts:
            seq_mismatches += 1
        oa = objective_of(a)
        ob = objective_of(b)
        if last_008 is not None and oa != last_008:
            n_switch_008 += 1
        if last_010 is not None and ob != last_010:
            n_switch_010 += 1
        last_008, last_010 = oa, ob
        ta = float((a.get("pct") or {}).get("supervised") or a.get("supervised_pct") or 0)
        # tool exposure via origin is recorded at train time; here use mix field if present
        tool_a = float(a.get("tool_pct") or 0)
        tool_b = float(b.get("tool_pct") or 0)
        if tool_a > 0:
            tool_steps_008 += 1
        if tool_b > 0:
            tool_steps_010 += 1
        did = abs(float(a.get("rehearsal_pct") or 0) - float(b.get("rehearsal_pct") or 0)) > 1e-9
        did = did or abs(float(a.get("supervised_pct") or ta) - float(b.get("supervised_pct") or 0)) > 1e-9
        if did:
            changed += 1
        rows.append({
            "step": i + 1,
            "seq_starts_equal": same_starts,
            "008_rehearsal_pct": a.get("rehearsal_pct"),
            "010_rehearsal_pct": b.get("rehearsal_pct"),
            "008_supervised_pct": a.get("supervised_pct") or (a.get("pct") or {}).get("supervised"),
            "010_supervised_pct": b.get("supervised_pct") or (b.get("pct") or {}).get("supervised"),
            "008_prose_pct": a.get("prose_pct"),
            "010_prose_pct": b.get("prose_pct"),
            "008_code_pct": a.get("code_pct"),
            "010_code_pct": b.get("code_pct"),
            "008_dominant": a.get("dominant_source_family"),
            "010_dominant": b.get("dominant_source_family"),
            "008_objective": oa,
            "010_objective": ob,
            "changed_because_tool_use_replaced": did,
        })
    return {
        "compared_steps": n,
        "seq_start_mismatches": seq_mismatches,
        "seq_starts_identical": seq_mismatches == 0,
        "steps_with_tool_pct_field_008": tool_steps_008,
        "steps_with_tool_pct_field_010": tool_steps_010,
        "steps_whose_mix_changed": changed,
        "planned_objective_switches_008": n_switch_008,
        "planned_objective_switches_010": n_switch_010,
        "steps": rows,
    }


def supervised_from_units(units: list[PackedUnit]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for u in units:
        if u.bucket == "supervised":
            counts[u.origin] += 1
    return dict(counts)


def tool_absence_proof(
    *,
    tokenizer: Tokenizer,
    units: list[PackedUnit],
    examples: list[dict[str, Any]],
    eval_suite: dict[str, Any],
    eval_sha: str,
) -> dict[str, Any]:
    n_tool_units = sum(1 for u in units if is_tool_use_unit(u))
    tool_target = int(sum(
        int(np.sum(np.asarray(u.loss_mask) == 1)) for u in units if is_tool_use_unit(u)
    ))
    tool_ex = [e for e in examples if e.get("capability_family") == "tool_use"]
    needles = []
    for e in tool_ex:
        rt = str(e.get("renderedTrainingText") or "")
        resp = str(e.get("response") or "")
        if rt:
            needles.append(("rendered", e.get("exampleId"), rt))
        if resp and len(resp) >= 32:
            needles.append(("response", e.get("exampleId"), resp))
    hits = []
    for u in units:
        if is_tool_use_unit(u):
            hits.append({"unit_id": u.unit_id, "reason": "origin still tool_use"})
            continue
        if not str(u.unit_id).startswith("r010-reh-for-"):
            continue
        decoded = tokenizer.decode(u.tokens.tolist(), skip_special_tokens=False)
        for kind, eid, needle in needles:
            if needle and needle in decoded:
                hits.append({
                    "unit_id": u.unit_id,
                    "bucket": u.bucket,
                    "origin": u.origin,
                    "exampleId": eid,
                    "kind": kind,
                    "reason": "exact supervised tool training string copied into rehearsal replacement window",
                })
                break
    eval_tool_n = int((eval_suite.get("family_counts") or {}).get("EVAL-TOOL") or 0)
    eval_tool_items = sum(1 for it in (eval_suite.get("items") or []) if it.get("family") == "EVAL-TOOL")
    return {
        "passed": n_tool_units == 0 and tool_target == 0 and len(hits) == 0
        and eval_tool_n == 10 and eval_tool_items == 10,
        "tool_use_training_windows": n_tool_units,
        "tool_use_trainable_target_tokens": tool_target,
        "tool_training_examples_in_source_list": len(tool_ex),
        "exact_tool_string_hits": hits[:20],
        "n_exact_tool_string_hits": len(hits),
        "held_out_tool_eval_items": eval_tool_items,
        "held_out_tool_family_count": eval_tool_n,
        "eval_id": eval_suite.get("suite_id"),
        "eval_sha256": eval_sha,
        "eval_id_expected": EVAL_ID,
        "eval_identity_ok": eval_suite.get("suite_id") == EVAL_ID and eval_tool_items == 10,
    }


def materialize_recovery_010_pack(*, root, tokenizer: Tokenizer) -> dict[str, Any]:
    packed008 = materialize_official_pack(root=root, tokenizer=tokenizer)
    eos_id = tokenizer.token_to_id("<|eos|>")
    examples = build_training_examples()
    from pack_wrim1_run_000002 import select_curriculum_units
    from materialize_capability_curriculum import leftover_units, rehearsal_units

    leftover = leftover_units(root, tokenizer)
    rehearsal = rehearsal_units(root, tokenizer)
    selected_pack = select_curriculum_units(
        tokenizer=tokenizer, examples=examples, leftover=leftover, rehearsal=rehearsal
    )
    reh_pool = unused_rehearsal_stream(
        root=root, tokenizer=tokenizer, selected=selected_pack["selected"]
    )
    replaced = replace_tool_use_windows(
        train_units=packed008["train_units"],
        reh_stream=reh_pool["stream"],
        eos_id=eos_id,
    )
    identity = prove_non_tool_windows_identical(packed008["train_units"], replaced["train_units"])
    comp008 = composition(packed008["train_units"])
    comp010 = composition(replaced["train_units"])
    split_ok = True
    split_failures = []
    for u in replaced["train_units"]:
        pr = prove_window_split_preserves_tokens(u, WINDOW_TOKENS_DEFAULT, eos_id=eos_id)
        if not pr["equal_to_source"] or not pr["intra_window_matches_source_slices"]:
            split_ok = False
            split_failures.append({"unit_id": u.unit_id, **pr})
    order_proof = prove_interleave_unit_order_only(
        packed008["train_units"],
        packed008["train_units"],
    )
    eval_dir = root / "model-lab/eval-only" / packed008["eval_id"]
    import json
    suite = json.loads((eval_dir / "suite.json").read_text(encoding="utf-8"))
    prompt_list = json.loads((eval_dir / "prompt-list.json").read_text(encoding="utf-8")).get("prompts") or []
    eval_sha = sha256_file(eval_dir / "suite.json")
    stream_scan = scan_stream_vs_eval(
        tokenizer=tokenizer,
        units=replaced["train_units"],
        examples=examples,
        eval_suite=suite,
        prompt_list=prompt_list,
    )
    example_leak = leak_scan(examples, suite)
    mask_proof = official_mask_audit(replaced["train_units"], tokenizer)
    absence = tool_absence_proof(
        tokenizer=tokenizer,
        units=replaced["train_units"],
        examples=examples,
        eval_suite=suite,
        eval_sha=eval_sha,
    )
    packed_sup = supervised_from_units(replaced["train_units"])
    packed_sup_008 = supervised_from_units(packed008["train_units"])
    retained_ok = all(
        packed_sup.get(k, 0) == EXPECTED_SUPERVISED_008[k]
        for k in EXPECTED_SUPERVISED_008
        if k != "tool_use"
    ) and packed_sup.get("tool_use", 0) == 0
    for fam in ("instruction_response", "structured_json", "war_room_concepts",
                "evidence_uncertainty", "correction_failure", "code_supervised"):
        old = [u for u in packed008["train_units"] if u.bucket == "supervised" and u.origin == fam]
        new = [u for u in replaced["train_units"] if u.bucket == "supervised" and u.origin == fam]
        if len(old) != len(new) or any(not np.array_equal(a.tokens, b.tokens) for a, b in zip(old, new)):
            retained_ok = False
            break
    supervised_identity = {
        **{k: packed_sup.get(k, 0) for k in EXPECTED_SUPERVISED_010},
        "008_windows": packed_sup_008,
        "010_windows": packed_sup,
        "expected_010": EXPECTED_SUPERVISED_010,
        "expected_008": EXPECTED_SUPERVISED_008,
        "passed": retained_ok and packed_sup.get("tool_use", 0) == 0,
    }

    planned010 = simulate_step_mix(
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
    for row in planned010:
        pct = row.get("pct") or {}
        row["supervised_pct"] = float(pct.get("supervised") or 0.0)
    for row in planned008:
        pct = row.get("pct") or {}
        row["supervised_pct"] = float(pct.get("supervised") or 0.0)
    preflight = local_mix_preflight_010(planned010, planned008)
    roll5 = rolling_rehearsal(planned010, 5)
    roll10 = rolling_rehearsal(planned010, 10)
    step_map = step_window_mapping(planned008, planned010)
    delta = {
        "008_total": comp008["total_tokens"],
        "010_total": comp010["total_tokens"],
        "token_delta": int(comp010["total_tokens"] - comp008["total_tokens"]),
        "tool_use_tokens_removed": replaced["tool_use_tokens_removed"],
        "tool_use_target_tokens_removed": replaced["tool_use_target_tokens_removed"],
        "rehearsal_added": replaced["rehearsal_tokens_added"],
        "rehearsal_008": comp008["rehearsal_tokens"],
        "rehearsal_010": comp010["rehearsal_tokens"],
        "rehearsal_increase": int(comp010["rehearsal_tokens"] - comp008["rehearsal_tokens"]),
        "quality_code_008": comp008["quality_code_leftover_tokens"],
        "quality_code_010": comp010["quality_code_leftover_tokens"],
        "supervised_008": comp008["supervised_tokens"],
        "supervised_010": comp010["supervised_tokens"],
        "not_recovery_009_rehearsal_mix": True,
        "recovery_009_rehearsal_was": 358_129,
        "recovery_010_rehearsal": comp010["rehearsal_tokens"],
    }
    return {
        **replaced,
        "val_stream": packed008["val_stream"],
        "val_mask": packed008["val_mask"],
        "val_units": packed008["val_units"],
        "val_tokens": packed008["val_tokens"],
        "curriculum_id": PACK_ID,
        "parent_curriculum_id": packed008["curriculum_id"],
        "eval_id": packed008["eval_id"],
        "eval_path": packed008["eval_path"],
        "eval_exclude_marker": packed008["eval_exclude_marker"],
        "eval_exclude_ok": packed008["eval_exclude_ok"],
        "eval_sha256": eval_sha,
        "selected_tokens": int(replaced["train_stream"].size),
        "expected_pack_tokens": EXPECTED_PACK_TOKENS,
        "pack_token_match": int(replaced["train_stream"].size) == EXPECTED_PACK_TOKENS,
        "mix_unit_tokens": packed008["mix_unit_tokens"],
        "token_counts": comp010["token_counts"],
        "token_pct": comp010["token_pct"],
        "rehearsal_pct": float(comp010["token_pct"].get("wr_corpus_0") or 0),
        "account": packed008["account"],
        "floors": packed008["floors"],
        "example_leak_scan": example_leak,
        "validator": packed008["validator"],
        "stream_leak_scan": stream_scan,
        "mask_proof": mask_proof,
        "tool_absence_proof": absence,
        "curriculum_dir": packed008["curriculum_dir"],
        "design_manifest": packed008["design_manifest"],
        "split_preserves_tokens": split_ok,
        "split_failures": split_failures[:8],
        "interleave_unit_order_only": {
            **packed008["interleave_unit_order_only"],
            "010_note": "010 does not re-interleave; it substitutes TOOL_USE windows in the 008 interleaved order.",
            "008_parent_interleave_passed": packed008["interleave_unit_order_only"].get("passed"),
            "window_order_vs_008_unchanged": True,
            "identity_non_tool": identity,
        },
        "shuffle": "008_deficit_interleave_then_tool_use_window_replacement",
        "contiguous": True,
        "no_token_permutation": True,
        "window_tokens": WINDOW_TOKENS_DEFAULT,
        "units_before_split": packed008["units_before_split"],
        "windows_after_split": packed008["windows_after_split"],
        "composition_008": comp008,
        "composition_010": comp010,
        "token_delta_report": delta,
        "non_tool_identity": identity,
        "reh_pool": {k: v for k, v in reh_pool.items() if k != "stream"},
        "supervised_identity": supervised_identity,
        "tool_use_zero": {
            "windows": comp010["tool_use_windows"],
            "target_tokens": comp010["tool_use_target_tokens"],
            "passed": comp010["tool_use_windows"] == 0 and comp010["tool_use_target_tokens"] == 0,
        },
        "quality_code_retained": {
            "008": comp008["quality_code_leftover_tokens"],
            "010": comp010["quality_code_leftover_tokens"],
            "passed": comp008["quality_code_leftover_tokens"] == comp010["quality_code_leftover_tokens"]
            and comp010["quality_code_leftover_tokens"] > 0,
        },
        "planned_008": planned008,
        "planned_010": planned010,
        "local_mix_preflight": preflight,
        "rolling_5": roll5,
        "rolling_10": roll10,
        "step_mapping_008_to_010": step_map,
        "packed008_train_sha_expected": OFFICIAL_TRAIN_SHA,
        "packed008_stream_size": int(packed008["train_stream"].size),
        "008_train_stream_bytes_sha256": sha256_bytes(packed008["train_stream"].tobytes()),
        "parent_008_split_preserves_tokens": packed008["split_preserves_tokens"],
        "dummy_order_proof": order_proof,
    }
