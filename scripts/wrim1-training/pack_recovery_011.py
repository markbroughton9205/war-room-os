"""TEST_ONLY Recovery-011 pack: compact TOOL_USE V2 in Recovery-010's former V1 tool slots.

Base control: Recovery-010 (which is Recovery-008 with V1 TOOL_USE replaced by rehearsal).
Replaces only those 88 rehearsal control windows with V2 compact intent + WR-CORPUS-0 pad.
Does not reintroduce V1 <tool_call> JSON. Does not re-interleave. Does not grow the pack.
"""
from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

import numpy as np
from tokenizers import Tokenizer

from capability_curriculum_lib import EVAL_ID, build_training_examples, leak_scan, token_counts_for_example
from contiguous_pack import PackedUnit, concatenate_units
from forensic_tool_use_curriculum import (
    V2_CURRICULUM_ID,
    V2_EVAL_ID,
    build_v2_examples,
    parse_compact,
    validate_v2,
)
from hashes import sha256_bytes, sha256_file
from interleave_curriculum import (
    WINDOW_TOKENS_DEFAULT,
    local_mix_preflight,
    prove_interleave_unit_order_only,
    prove_window_split_preserves_tokens,
    rolling_rehearsal,
    simulate_step_mix,
)
from materialize_capability_curriculum import supervised_units
from pack_recovery_009 import OFFICIAL_TRAIN_SHA, classify as classify_base, objective_of
from pack_recovery_010 import (
    EXPECTED_SUPERVISED_008,
    PACK_ID as PACK_ID_010,
    composition as composition_generic,
    is_tool_use_unit,
    materialize_recovery_010_pack,
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
PACK_ID = "WR-CORPUS-1.1-RECOVERY-011-COMPACT-TOOL"
EXPECTED_V2_EXAMPLES = 88
EXPECTED_V2_TARGET_TOKENS = 1694

EXPECTED_SUPERVISED_011 = {
    **EXPECTED_SUPERVISED_008,
    "tool_use": EXPECTED_V2_EXAMPLES,
}


def classify(bucket: str, origin: str) -> str:
    if bucket == "supervised" and origin == "tool_use":
        return "TOOL_V2"
    return classify_base(bucket, origin)


def composition(units: list[PackedUnit]) -> dict[str, Any]:
    base = composition_generic(units)
    by_class: dict[str, int] = defaultdict(int)
    n_v2 = 0
    v2_target = 0
    v2_prompt = 0
    v2_unit = 0
    for u in units:
        n = int(u.tokens.size)
        by_class[classify(u.bucket, u.origin)] += n
        if is_tool_use_unit(u):
            n_v2 += 1
            mask = np.asarray(u.loss_mask)
            v2_target += int(np.sum(mask == 1))
            v2_prompt += int(np.sum(mask == 0))
            v2_unit += n
    total = int(sum(by_class.values())) or 1
    base["class_token_counts"] = dict(by_class)
    base["class_pct"] = {k: round(100.0 * v / total, 4) for k, v in sorted(by_class.items())}
    base["tool_v2_windows"] = n_v2
    base["tool_v2_unit_tokens"] = v2_unit
    base["tool_v2_prompt_tokens"] = v2_prompt
    base["tool_v2_target_tokens"] = v2_target
    return base


def encode_v2_units(examples: list[dict[str, Any]], tokenizer: Tokenizer) -> list[PackedUnit]:
    units = supervised_units(examples, tokenizer)
    for u, ex in zip(units, examples):
        u.unit_id = f"r011-v2-{ex.get('exampleId')}"
        u.origin = "tool_use"
        u.bucket = "supervised"
        u.source_path = V2_CURRICULUM_ID
    return units


def pair_v2_to_windows(
    *,
    tool_windows: list[tuple[int, PackedUnit]],
    v2_units: list[PackedUnit],
) -> list[dict[str, Any]]:
    """Deterministic longest-window-first pairing so V2 always fits when the budget allows."""
    if len(tool_windows) != len(v2_units):
        raise RuntimeError(f"window/example count mismatch {len(tool_windows)} vs {len(v2_units)}")
    wins = sorted(tool_windows, key=lambda t: (-int(t[1].tokens.size), t[0]))
    v2s = sorted(v2_units, key=lambda u: (-int(u.tokens.size), u.unit_id))
    pairs = []
    overflows = []
    for (widx, win), v2 in zip(wins, v2s):
        n = int(win.tokens.size)
        v2n = int(v2.tokens.size)
        if v2n > n:
            overflows.append({"window_index": widx, "window_n": n, "v2_n": v2n, "v2_id": v2.unit_id})
        pairs.append({"window_index": widx, "window": win, "v2": v2, "fits": v2n <= n})
    pairs.sort(key=lambda p: p["window_index"])
    return pairs, overflows


def replace_010_tool_slots_with_v2(
    *,
    units_008: list[PackedUnit],
    units_010: list[PackedUnit],
    v2_units: list[PackedUnit],
    eos_id: int | None,
) -> dict[str, Any]:
    if len(units_008) != len(units_010):
        raise RuntimeError("008/010 window counts differ")
    tool_windows = [(i, units_008[i]) for i, u in enumerate(units_008) if is_tool_use_unit(u)]
    pairs, overflows = pair_v2_to_windows(tool_windows=tool_windows, v2_units=v2_units)
    pair_by_i = {p["window_index"]: p for p in pairs}
    mapping: list[dict[str, Any]] = []
    new_units: list[PackedUnit] = []
    pos = 0
    unchanged = 0
    v2_tool_windows = 0
    rehearsal_pad_windows = 0
    rehearsal_pad_tokens = 0
    v2_unit_tokens = 0
    v2_target_tokens = 0
    v2_prompt_tokens = 0
    for i, (u008, u010) in enumerate(zip(units_008, units_010)):
        n = int(u008.tokens.size)
        cls = classify_base(u008.bucket, u008.origin)
        if not is_tool_use_unit(u008):
            new_units.append(u010)
            unchanged += 1
            mapping.append({
                "window_index": i,
                "stream_start": pos,
                "stream_end": pos + n,
                "n_tokens": n,
                "changed": False,
                "kind": "unchanged",
                "008_unit_id": u008.unit_id,
                "010_unit_id": u010.unit_id,
                "011_unit_id": u010.unit_id,
                "011_bucket": u010.bucket,
                "011_origin": u010.origin,
                "011_class": classify(u010.bucket, u010.origin),
            })
            pos += n
            continue
        p = pair_by_i[i]
        v2: PackedUnit = p["v2"]
        v2n = int(v2.tokens.size)
        if v2n > n:
            raise RuntimeError(f"V2 unit {v2.unit_id} length {v2n} exceeds window {i} length {n}")
        pad_n = n - v2n
        pad_tok = np.array(u010.tokens[v2n:n], dtype=np.int32)
        if int(pad_tok.size) != pad_n:
            raise RuntimeError("pad slice length mismatch")
        new_units.append(v2)
        v2_tool_windows += 1
        v2_unit_tokens += v2n
        mask = np.asarray(v2.loss_mask)
        v2_target_tokens += int(np.sum(mask == 1))
        v2_prompt_tokens += int(np.sum(mask == 0))
        mapping.append({
            "window_index": i,
            "stream_start": pos,
            "stream_end": pos + n,
            "n_tokens": n,
            "changed": True,
            "kind": "v2_tool",
            "v2_unit_id": v2.unit_id,
            "v2_n_tokens": v2n,
            "v2_target_tokens": int(np.sum(mask == 1)),
            "v2_prompt_tokens": int(np.sum(mask == 0)),
            "rehearsal_pad_tokens": pad_n,
            "008_unit_id": u008.unit_id,
            "010_unit_id": u010.unit_id,
            "011_v2_unit_id": v2.unit_id,
            "pad_matches_010_tail": True,
        })
        if pad_n > 0:
            pad_u = PackedUnit(
                unit_id=f"r011-reh-pad-for-{u008.unit_id}",
                bucket="wr_corpus_0",
                origin="WR-CORPUS-0",
                tokens=pad_tok,
                loss_mask=np.ones(pad_n, dtype=np.asarray(u010.loss_mask).dtype),
                source_path="WR-CORPUS-0",
                n_eos=int(np.count_nonzero(pad_tok == eos_id)) if eos_id is not None else 0,
                truncated=False,
            )
            new_units.append(pad_u)
            rehearsal_pad_windows += 1
            rehearsal_pad_tokens += pad_n
        pos += n
    train_stream = concatenate_units([u.tokens for u in new_units]).astype(np.int32)
    train_mask = concatenate_units([u.loss_mask.astype(np.int32) for u in new_units]).astype(np.float32)
    return {
        "train_units": new_units,
        "train_stream": train_stream,
        "train_mask": train_mask,
        "window_mapping": mapping,
        "unchanged_windows": unchanged,
        "changed_windows": int(sum(1 for m in mapping if m["changed"])),
        "v2_tool_windows": v2_tool_windows,
        "rehearsal_padding_windows": rehearsal_pad_windows,
        "rehearsal_pad_tokens": rehearsal_pad_tokens,
        "v2_unit_tokens": v2_unit_tokens,
        "v2_target_tokens": v2_target_tokens,
        "v2_prompt_tokens": v2_prompt_tokens,
        "pairing_overflows": overflows,
        "n_logical_windows": len(units_008),
        "n_physical_units": len(new_units),
    }


def prove_non_tool_windows_identical(old010: list[PackedUnit], new_units: list[PackedUnit], units_008: list[PackedUnit]) -> dict[str, Any]:
    """Non-tool 010 windows appear unchanged, in the same stream order, inside 011."""
    mismatches = []
    preserved = 0
    new_i = 0
    for i, (a008, a010) in enumerate(zip(units_008, old010)):
        n = int(a008.tokens.size)
        if is_tool_use_unit(a008):
            consumed = 0
            while new_i < len(new_units) and consumed < n:
                consumed += int(new_units[new_i].tokens.size)
                new_i += 1
            if consumed != n:
                mismatches.append({"window": i, "reason": "v2+pad length != 010 window", "consumed": consumed, "n": n})
            continue
        if new_i >= len(new_units):
            mismatches.append({"window": i, "reason": "011 units exhausted"})
            break
        b = new_units[new_i]
        same_tok = bool(np.array_equal(a010.tokens, b.tokens))
        same_mask = bool(np.array_equal(np.asarray(a010.loss_mask), np.asarray(b.loss_mask)))
        same_id = a010.unit_id == b.unit_id
        if not (same_tok and same_mask and same_id):
            mismatches.append({"window": i, "unit_id": a010.unit_id, "same_tok": same_tok, "same_mask": same_mask, "same_id": same_id})
        else:
            preserved += 1
        new_i += 1
    return {
        "passed": len(mismatches) == 0,
        "preserved_non_tool_windows": preserved,
        "n_008_windows": len(units_008),
        "mismatches": mismatches[:20],
        "n_mismatches": len(mismatches),
    }


def v1_absence_proof(*, tokenizer: Tokenizer, units: list[PackedUnit], v1_examples: list[dict[str, Any]]) -> dict[str, Any]:
    v1_tools = [e for e in v1_examples if e.get("capability_family") == "tool_use"]
    hits_wrapper = []
    hits_exact = []
    needles = []
    for e in v1_tools:
        resp = str(e.get("response") or "")
        if resp and "<tool_call>" in resp:
            needles.append((e.get("exampleId"), resp))
    for u in units:
        decoded = tokenizer.decode(u.tokens.tolist(), skip_special_tokens=False)
        if is_tool_use_unit(u) and "<tool_call>" in decoded:
            hits_wrapper.append({"unit_id": u.unit_id, "reason": "V2 unit contains <tool_call>"})
        if str(u.unit_id).startswith("r011-v2-") or is_tool_use_unit(u):
            for eid, needle in needles:
                if needle and needle in decoded:
                    hits_exact.append({"unit_id": u.unit_id, "exampleId": eid})
                    break
    n_v2 = sum(1 for u in units if is_tool_use_unit(u))
    return {
        "passed": n_v2 == EXPECTED_V2_EXAMPLES and len(hits_wrapper) == 0 and len(hits_exact) == 0,
        "v2_tool_use_windows": n_v2,
        "v1_wrapper_hits_in_v2_units": hits_wrapper[:20],
        "v1_exact_response_hits_in_v2_units": hits_exact[:20],
        "n_v1_wrapper_hits": len(hits_wrapper),
        "n_v1_exact_hits": len(hits_exact),
        "note": "Correction-family JSON may still contain <tool_call>; this proof only inspects V2 tool units.",
    }


def v2_gradient_proof(units: list[PackedUnit], tokenizer: Tokenizer) -> dict[str, Any]:
    assistant_id = tokenizer.token_to_id("<|assistant|>")
    n = 0
    bad = 0
    n_target = 0
    compact_ok = 0
    json_hits = 0
    for u in units:
        if not is_tool_use_unit(u):
            continue
        n += 1
        ids = u.tokens.tolist()
        mask = np.asarray(u.loss_mask).tolist()
        decoded = tokenizer.decode(ids, skip_special_tokens=False)
        if assistant_id is None or assistant_id not in ids:
            bad += 1
            continue
        apos = ids.index(assistant_id)
        after = mask[apos + 1 :]
        if not after or any(int(m) != 1 for m in after):
            bad += 1
        n_target += int(sum(int(m) == 1 for m in mask))
        atext = decoded.find("<|assistant|>")
        tgt = decoded[atext + len("<|assistant|>"):] if atext >= 0 else ""
        tgt = tgt.replace("<|eos|>", "").strip()
        if "<tool_call>" in tgt or tgt.startswith("{"):
            json_hits += 1
        try:
            parse_compact(tgt)
            compact_ok += 1
        except Exception:
            bad += 1
    return {
        "passed": n == EXPECTED_V2_EXAMPLES and bad == 0 and n_target > 0 and json_hits == 0 and compact_ok == n,
        "v2_units": n,
        "mask_or_parse_failures": bad,
        "target_tokens": n_target,
        "compact_parse_ok": compact_ok,
        "json_or_wrapper_in_target": json_hits,
        "note": "Assistant-span tokens (compact TOOL=) receive gradient; prompts are masked.",
    }


def scan_stream_vs_tool_eval1(*, tokenizer: Tokenizer, units: list[PackedUnit], eval1: dict[str, Any]) -> dict[str, Any]:
    extra = [tokenizer.decode(u.tokens.tolist(), skip_special_tokens=True) for u in units]
    leak = leak_scan([], eval1, extra_texts=extra)
    prompt_hits = []
    for u, decoded in zip(units, extra):
        for it in eval1.get("items") or []:
            p = str(it.get("prompt") or "")
            if p and p in decoded:
                prompt_hits.append({"unit_id": u.unit_id, "evalId": it.get("evalId")})
                break
    known = int(leak.get("known_eval_leakage") or 0) + len(prompt_hits)
    return {
        "known_eval_leakage": known,
        "passed": known == 0 and leak.get("passed") and not prompt_hits,
        "leak_scan": leak,
        "prompt_hits": prompt_hits[:20],
        "eval_id": eval1.get("suite_id"),
        "EXCLUDE_FROM_TRAINING": True,
    }


def step_window_mapping(planned_010: list[dict], planned_011: list[dict]) -> dict[str, Any]:
    n = min(len(planned_010), len(planned_011))
    rows = []
    seq_mismatches = 0
    changed = 0
    n_switch_010 = n_switch_011 = 0
    last_010 = last_011 = None
    for i in range(n):
        a = planned_010[i]
        b = planned_011[i]
        same_starts = a.get("seq_starts") == b.get("seq_starts")
        if not same_starts:
            seq_mismatches += 1
        oa = objective_of(a)
        ob = objective_of(b)
        if last_010 is not None and oa != last_010:
            n_switch_010 += 1
        if last_011 is not None and ob != last_011:
            n_switch_011 += 1
        last_010, last_011 = oa, ob
        did = abs(float(a.get("rehearsal_pct") or 0) - float(b.get("rehearsal_pct") or 0)) > 1e-9
        did = did or abs(float(a.get("supervised_pct") or 0) - float(b.get("supervised_pct") or 0)) > 1e-9
        if did:
            changed += 1
        rows.append({
            "step": i + 1,
            "seq_starts_equal": same_starts,
            "010_rehearsal_pct": a.get("rehearsal_pct"),
            "011_rehearsal_pct": b.get("rehearsal_pct"),
            "010_supervised_pct": a.get("supervised_pct") or (a.get("pct") or {}).get("supervised"),
            "011_supervised_pct": b.get("supervised_pct") or (b.get("pct") or {}).get("supervised"),
            "010_objective": oa,
            "011_objective": ob,
            "changed_because_v2_replaced_rehearsal_slot": did,
        })
    return {
        "compared_steps": n,
        "seq_start_mismatches": seq_mismatches,
        "seq_starts_identical": seq_mismatches == 0,
        "steps_whose_mix_changed": changed,
        "planned_objective_switches_010": n_switch_010,
        "planned_objective_switches_011": n_switch_011,
        "steps": rows,
    }


def supervised_from_units(units: list[PackedUnit]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for u in units:
        if u.bucket == "supervised":
            counts[u.origin] += 1
    return dict(counts)


def local_mix_preflight_011(rows_011: list[dict]) -> dict[str, Any]:
    return local_mix_preflight(rows_011)


def materialize_recovery_011_pack(*, root, tokenizer: Tokenizer) -> dict[str, Any]:
    packed010 = materialize_recovery_010_pack(root=root, tokenizer=tokenizer)
    packed008 = materialize_official_pack(root=root, tokenizer=tokenizer)
    eos_id = tokenizer.token_to_id("<|eos|>")
    v1_examples = build_training_examples()
    v1_tools = [e for e in v1_examples if e.get("capability_family") == "tool_use"]
    v2_examples = build_v2_examples()
    v2_units = encode_v2_units(v2_examples, tokenizer)
    tcounts = [token_counts_for_example(tokenizer, e) for e in v2_examples]
    v2_target_sum = int(sum(c["target_tokens"] for c in tcounts))
    eval1_dir = root / "model-lab/eval-only" / V2_EVAL_ID
    eval1 = json.loads((eval1_dir / "suite.json").read_text(encoding="utf-8"))
    v2_validator = validate_v2(v2_examples, eval1, tokenizer, v1_tools)

    replaced = replace_010_tool_slots_with_v2(
        units_008=packed008["train_units"],
        units_010=packed010["train_units"],
        v2_units=v2_units,
        eos_id=eos_id,
    )
    identity = prove_non_tool_windows_identical(
        packed010["train_units"], replaced["train_units"], packed008["train_units"]
    )
    comp008 = composition_generic(packed008["train_units"])
    comp010 = composition_generic(packed010["train_units"])
    comp011 = composition(replaced["train_units"])
    split_ok = True
    split_failures = []
    for u in replaced["train_units"]:
        pr = prove_window_split_preserves_tokens(u, WINDOW_TOKENS_DEFAULT, eos_id=eos_id)
        if not pr["equal_to_source"] or not pr["intra_window_matches_source_slices"]:
            split_ok = False
            split_failures.append({"unit_id": u.unit_id, **pr})

    eval_dir = root / "model-lab/eval-only" / packed008["eval_id"]
    suite = json.loads((eval_dir / "suite.json").read_text(encoding="utf-8"))
    prompt_list = json.loads((eval_dir / "prompt-list.json").read_text(encoding="utf-8")).get("prompts") or []
    eval_sha = sha256_file(eval_dir / "suite.json")
    eval1_sha = sha256_file(eval1_dir / "suite.json")

    stream_scan_cap = scan_stream_vs_eval(
        tokenizer=tokenizer,
        units=replaced["train_units"],
        examples=v1_examples + v2_examples,
        eval_suite=suite,
        prompt_list=prompt_list,
    )
    stream_scan_tool1 = scan_stream_vs_tool_eval1(
        tokenizer=tokenizer, units=replaced["train_units"], eval1=eval1
    )
    example_leak_cap = leak_scan(v2_examples, suite)
    example_leak_tool1 = leak_scan(v2_examples, eval1)
    mask_proof = official_mask_audit(replaced["train_units"], tokenizer)
    absence_v1 = v1_absence_proof(tokenizer=tokenizer, units=replaced["train_units"], v1_examples=v1_examples)
    grad_proof = v2_gradient_proof(replaced["train_units"], tokenizer)

    packed_sup = supervised_from_units(replaced["train_units"])
    packed_sup_010 = supervised_from_units(packed010["train_units"])
    packed_sup_008 = supervised_from_units(packed008["train_units"])
    retained_ok = all(
        packed_sup.get(k, 0) == EXPECTED_SUPERVISED_008[k]
        for k in EXPECTED_SUPERVISED_008
        if k != "tool_use"
    ) and packed_sup.get("tool_use", 0) == EXPECTED_V2_EXAMPLES
    for fam in ("instruction_response", "structured_json", "war_room_concepts",
                "evidence_uncertainty", "correction_failure", "code_supervised"):
        old = [u for u in packed010["train_units"] if u.bucket == "supervised" and u.origin == fam]
        new = [u for u in replaced["train_units"] if u.bucket == "supervised" and u.origin == fam]
        if len(old) != len(new) or any(not np.array_equal(a.tokens, b.tokens) for a, b in zip(old, new)):
            retained_ok = False
            break
    supervised_identity = {
        **{k: packed_sup.get(k, 0) for k in EXPECTED_SUPERVISED_011},
        "008_windows": packed_sup_008,
        "010_windows": packed_sup_010,
        "011_windows": packed_sup,
        "expected_011": EXPECTED_SUPERVISED_011,
        "passed": retained_ok,
    }

    planned011 = simulate_step_mix(
        train_stream=replaced["train_stream"],
        train_mask=replaced["train_mask"],
        units=replaced["train_units"],
        ctx=CTX,
        batch=BATCH,
        seed=SEED,
        n_steps=MAX_STEPS,
    )
    planned010 = packed010["planned_010"]
    for row in planned011:
        pct = row.get("pct") or {}
        row["supervised_pct"] = float(pct.get("supervised") or 0.0)
    preflight = local_mix_preflight_011(planned011)
    roll5 = rolling_rehearsal(planned011, 5)
    roll10 = rolling_rehearsal(planned011, 10)
    step_map = step_window_mapping(planned010, planned011)
    delta = {
        "008_total": comp008["total_tokens"],
        "010_total": comp010["total_tokens"],
        "011_total": comp011["total_tokens"],
        "token_delta_vs_010": int(comp011["total_tokens"] - comp010["total_tokens"]),
        "v1_tool_target_tokens_historical": 6098,
        "v2_tool_target_tokens": replaced["v2_target_tokens"],
        "v2_target_vs_v1_pct": round(100.0 * replaced["v2_target_tokens"] / 6098.0, 2),
        "v2_unit_tokens": replaced["v2_unit_tokens"],
        "rehearsal_pad_tokens": replaced["rehearsal_pad_tokens"],
        "rehearsal_008": comp008["rehearsal_tokens"],
        "rehearsal_010": comp010["rehearsal_tokens"],
        "rehearsal_011": comp011["rehearsal_tokens"],
        "quality_code_010": comp010["quality_code_leftover_tokens"],
        "quality_code_011": comp011["quality_code_leftover_tokens"],
        "supervised_010": comp010["supervised_tokens"],
        "supervised_011": comp011["supervised_tokens"],
    }
    target_density = {
        "v2_prompt_tokens": replaced["v2_prompt_tokens"],
        "v2_target_tokens": replaced["v2_target_tokens"],
        "v2_unit_tokens": replaced["v2_unit_tokens"],
        "target_density": (replaced["v2_target_tokens"] / replaced["v2_unit_tokens"]) if replaced["v2_unit_tokens"] else 0.0,
        "v2_share_of_supervised_targets_011": None,
    }
    sup_targets_011 = int(sum(
        int(np.sum(np.asarray(u.loss_mask) == 1))
        for u in replaced["train_units"] if u.bucket == "supervised"
    ))
    if sup_targets_011:
        target_density["v2_share_of_supervised_targets_011"] = replaced["v2_target_tokens"] / sup_targets_011
        target_density["supervised_target_tokens_011"] = sup_targets_011
    eval1_exclude = all(bool(it.get("EXCLUDE_FROM_TRAINING")) for it in (eval1.get("items") or []))
    cap_exclude = packed008["eval_exclude_ok"]
    return {
        **replaced,
        "val_stream": packed010["val_stream"],
        "val_mask": packed010["val_mask"],
        "val_units": packed010["val_units"],
        "val_tokens": packed010["val_tokens"],
        "curriculum_id": PACK_ID,
        "parent_curriculum_id_010": PACK_ID_010,
        "parent_curriculum_id_008": packed008["curriculum_id"],
        "v2_curriculum_id": V2_CURRICULUM_ID,
        "eval_id": packed008["eval_id"],
        "eval_path": packed008["eval_path"],
        "eval_exclude_marker": packed008["eval_exclude_marker"],
        "eval_exclude_ok": cap_exclude,
        "eval_sha256": eval_sha,
        "tool_eval_id": V2_EVAL_ID,
        "tool_eval_sha256": eval1_sha,
        "tool_eval_exclude_ok": eval1_exclude and eval1.get("suite_id") == V2_EVAL_ID,
        "tool_eval_item_count": len(eval1.get("items") or []),
        "selected_tokens": int(replaced["train_stream"].size),
        "expected_pack_tokens": EXPECTED_PACK_TOKENS,
        "pack_token_match": int(replaced["train_stream"].size) == EXPECTED_PACK_TOKENS,
        "mix_unit_tokens": packed008["mix_unit_tokens"],
        "token_counts": comp011["token_counts"],
        "token_pct": comp011["token_pct"],
        "rehearsal_pct": float(comp011["token_pct"].get("wr_corpus_0") or 0),
        "account": packed008["account"],
        "floors": packed008["floors"],
        "example_leak_scan": example_leak_cap,
        "example_leak_scan_tool_eval_1": example_leak_tool1,
        "validator": packed008["validator"],
        "v2_validator": v2_validator,
        "stream_leak_scan": stream_scan_cap,
        "stream_leak_scan_tool_eval_1": stream_scan_tool1,
        "mask_proof": mask_proof,
        "v1_absence_proof": absence_v1,
        "v2_gradient_proof": grad_proof,
        "curriculum_dir": packed008["curriculum_dir"],
        "design_manifest": packed008["design_manifest"],
        "split_preserves_tokens": split_ok,
        "split_failures": split_failures[:8],
        "interleave_unit_order_only": {
            **packed008["interleave_unit_order_only"],
            "011_note": "011 does not re-interleave; it substitutes V2+pad into 010's former V1 tool slots.",
            "window_order_vs_010_unchanged": True,
            "identity_non_tool": identity,
        },
        "shuffle": "010_rehearsal_tool_slots_then_v2_compact_plus_rehearsal_pad",
        "contiguous": True,
        "no_token_permutation": True,
        "window_tokens": WINDOW_TOKENS_DEFAULT,
        "units_before_split": packed008["units_before_split"],
        "windows_after_split": packed008["windows_after_split"],
        "composition_008": packed010["composition_008"],
        "composition_010": packed010["composition_010"],
        "composition_011": comp011,
        "token_delta_report": delta,
        "v2_target_density": target_density,
        "non_tool_identity": identity,
        "supervised_identity": supervised_identity,
        "v2_counts": {
            "examples": len(v2_examples),
            "expected_examples": EXPECTED_V2_EXAMPLES,
            "target_tokens_from_examples": v2_target_sum,
            "expected_target_tokens": EXPECTED_V2_TARGET_TOKENS,
            "packed_target_tokens": replaced["v2_target_tokens"],
            "packed_unit_tokens": replaced["v2_unit_tokens"],
            "example_target_match": v2_target_sum == EXPECTED_V2_TARGET_TOKENS,
            "packed_target_match": replaced["v2_target_tokens"] == EXPECTED_V2_TARGET_TOKENS
            or replaced["v2_target_tokens"] == v2_target_sum + EXPECTED_V2_EXAMPLES,
            "note": "packed target tokens include trailing <|eos|> if wrap_behavior added it after encode counts",
        },
        "quality_code_retained": {
            "010": packed010["composition_010"]["quality_code_leftover_tokens"],
            "011": comp011["quality_code_leftover_tokens"],
            "passed": packed010["composition_010"]["quality_code_leftover_tokens"] == comp011["quality_code_leftover_tokens"]
            and comp011["quality_code_leftover_tokens"] > 0,
        },
        "planned_010": planned010,
        "planned_011": planned011,
        "local_mix_preflight": preflight,
        "rolling_5": roll5,
        "rolling_10": roll10,
        "step_mapping_010_to_011": step_map,
        "packed008_train_sha_expected": OFFICIAL_TRAIN_SHA,
        "packed010_stream_size": int(packed010["train_stream"].size),
        "010_train_stream_bytes_sha256": sha256_bytes(packed010["train_stream"].tobytes()),
        "dummy_order_proof": prove_interleave_unit_order_only(packed008["train_units"], packed008["train_units"]),
        "v2_examples": v2_examples,
        "packed010_train_units": packed010["train_units"],
        "packed008_train_units": packed008["train_units"],
        "eval1_suite": eval1,
    }
