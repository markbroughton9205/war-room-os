"""STAGE3A post-review candidate selection. ZERO optimizer steps.

Step25 interpolation vs WRIM-0, comparison with stored step50 interpolation,
expanded retention + structured-output review, cap0-ret-02 inspection.
Does not train. Does not start STAGE3B. Does not promote.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import torch
from safetensors.torch import load_file
from tokenizers import Tokenizer

from phase2_grid import FROZEN_NLL_SHA, parameter_displacement, sha256_json_text
from phase3a_interpolation import ALPHAS, lerp_state, load_into_model, pareto_analysis, strip_item_ids, tensors_sha256, verify_endpoint_keys
from stage2_eval import EVAL_SEED, greedy_generate, load_retention_items, score_retention
from stage2_pack import encode_corpus1_val_units, encode_rehearsal_val_units
from stage2_retention_diag import first_token_stats
from stage3_eval_baseline import concat_units, continuation_metrics, duplication_audit, leakage_audit, score_item
from stage3_eval_items import ITEMS as STAGE3_ITEMS
from stage3_runtime import (
    BASELINE_SHA,
    PARENT_SHA,
    REVIEW_BANDS,
    RUN_ID,
    SEED,
    STAGE3B_AUTHORIZATION,
    STAGE3_AUTHORIZATION,
    SUITE_SHA,
    TOKENIZER_SHA,
    TRAINING_AUTHORIZATION,
    authorization_gate,
    utc_now,
    write_json,
)
from stage3_schedule import lr_stage3a
from stage3a_review import EXPECTED_STEP25_SHA, EXPECTED_STEP50_SHA, VAL0_PARENT, VAL1_PARENT, load_frozen_inference, summarize_eval
from stage3a_review_sets import (
    RETENTION_ITEMS,
    RETENTION_SUITE_ID,
    STRUCT_ITEMS,
    STRUCT_SUITE_ID,
    assert_inventory,
    freeze_payload,
)
from stage3a_run import disable_tf32, evaluate_candidate, load_baseline, load_suite, review_band_crossings, sha256_file

COMPARE_ALPHAS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5]


def freeze_sets(eval_dir: Path) -> dict[str, Any]:
    assert_inventory()
    ret_path = eval_dir / f"{RETENTION_SUITE_ID}.json"
    struct_path = eval_dir / f"{STRUCT_SUITE_ID}.json"
    write_json(ret_path, freeze_payload(RETENTION_SUITE_ID, RETENTION_ITEMS))
    write_json(struct_path, freeze_payload(STRUCT_SUITE_ID, STRUCT_ITEMS))
    return {
        "retention_path": str(ret_path),
        "structured_path": str(struct_path),
        "retention_sha256": sha256_json_text(ret_path),
        "structured_sha256": sha256_json_text(struct_path),
        "retention_n": len(RETENTION_ITEMS),
        "structured_n": len(STRUCT_ITEMS),
        "frozen_before_evaluation": True,
        "training_use": "FORBIDDEN",
        "replaces_cap_eval_0": False,
    }


def audit_sets(tokenizer: Tokenizer, dump_root: Path) -> dict[str, Any]:
    combined = RETENTION_ITEMS + STRUCT_ITEMS
    leak = leakage_audit(combined, tokenizer, dump_root)
    dup_internal = duplication_audit(combined)
    cross = []
    blocking_cross = []
    from stage3_eval_baseline import char_ngrams, normalize_ws, NGRAM

    for a in combined:
        ga = set(char_ngrams(a["prompt_text"], NGRAM))
        na = normalize_ws(a["prompt_text"])
        for b in STAGE3_ITEMS:
            gb = set(char_ngrams(b["prompt_text"], NGRAM))
            union = ga | gb
            jac = (len(ga & gb) / len(union)) if union else 0.0
            exact = a["prompt_text"] == b["prompt_text"] or na == normalize_ws(b["prompt_text"])
            block = exact or jac >= 0.70
            if jac >= 0.18 or block:
                row = {"new": a["item_id"], "stage3": b["item_id"], "char13_jaccard": round(jac, 6), "blocking": block}
                cross.append(row)
                if block:
                    blocking_cross.append(a["item_id"])
    return {
        "ok": bool(leak.get("ok")) and bool(dup_internal.get("ok")) and not blocking_cross,
        "leakage": leak,
        "duplication_internal": dup_internal,
        "duplication_vs_stage3": {"ok": not blocking_cross, "blocking_item_ids": blocking_cross, "pairs": cross[:40]},
        "note": "Evaluation-only. Not used for training. CAP-EVAL-0 unmodified.",
    }


def interp_row(ev: dict[str, Any], *, source: str, alpha: float) -> dict[str, Any]:
    aggs = ev.get("category_aggregates") or {}
    return {
        "run_id": source,
        "source": source,
        "alpha": float(alpha),
        "candidate_id": "WRIM-0" if abs(float(alpha) - 1.0) < 1e-12 else f"{source}_A{alpha:.1f}" if alpha else f"{source}_RAW",
        "mean_wrim0_anchor_nll_delta": ev.get("mean_wrim0_anchor_nll_delta"),
        "mean_kl_wrim0_to_candidate": ev.get("mean_kl_wrim0_to_candidate"),
        "val_loss_corpus0": ev.get("val_loss_corpus0"),
        "val_loss_corpus1": ev.get("val_loss_corpus1"),
        "historical_binary": ev.get("historical_binary"),
        "historical_pass_count": ev.get("historical_pass_count"),
        "n_collapsed": ev.get("n_collapsed"),
        "special_token_mean_rate": ev.get("special_token_mean_rate"),
        "json_valid_count": (aggs.get("JSON_STRUCTURED_OUTPUT") or {}).get("json_valid_count"),
        "json_n": (aggs.get("JSON_STRUCTURED_OUTPUT") or {}).get("json_n"),
        "instruction": aggs.get("INSTRUCTION_FOLLOWING"),
        "long_form": aggs.get("LONG_FORM_CONTINUITY"),
        "review_band_crossings": None,
    }


def constraint_bools(scores: dict[str, Any]) -> list[tuple[str, bool]]:
    skip = {"primary_collapsed", "primary_special_loop"}
    out = []
    for k, v in scores.items():
        if k in skip or not isinstance(v, bool):
            continue
        out.append((k, v))
    return out


def evaluate_item_set(model, tokenizer, device, items: list[dict[str, Any]]) -> dict[str, Any]:
    rows = []
    for it in items:
        max_new = int(it.get("max_new_tokens") or 32)
        gen = greedy_generate(model, tokenizer, it["prompt_text"], device, max_new=max_new)
        scores = score_item(it, gen, gen, gen)
        metrics = continuation_metrics(gen)
        flags = constraint_bools(scores)
        constraint_ok = all(v for _k, v in flags) if flags else True
        uniq = float(gen.get("unique_ratio") or 0.0)
        descriptive_pass = (
            (not bool(gen.get("collapsed")))
            and (not bool(gen.get("special_loop")))
            and uniq >= 0.35
            and constraint_ok
        )
        rows.append(
            {
                "item_id": it["item_id"],
                "category": it["category"],
                "suite_id": it["suite_id"],
                "max_new_tokens": max_new,
                "descriptive_pass": descriptive_pass,
                "constraint_ok": constraint_ok,
                "constraint_flags": {k: v for k, v in flags},
                "json_valid": scores.get("json_valid"),
                "collapsed": gen.get("collapsed"),
                "special_loop": gen.get("special_loop"),
                "unique_ratio": gen.get("unique_ratio"),
                "entropy": gen.get("entropy"),
                "max_run": gen.get("max_run"),
                "special_rate_0_8": metrics.get("special_rate_0_8"),
                "token_id_sha256": metrics.get("token_id_sha256"),
                "continuation_prefix": (gen.get("continuation") or "")[:240],
            }
        )
    by_cat: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_cat.setdefault(row["category"], []).append(row)

    def agg(cat_rows: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "n": len(cat_rows),
            "descriptive_pass_count": int(sum(1 for r in cat_rows if r["descriptive_pass"])),
            "constraint_ok_count": int(sum(1 for r in cat_rows if r["constraint_ok"])),
            "n_collapsed": int(sum(1 for r in cat_rows if r.get("collapsed"))),
            "n_special_loop": int(sum(1 for r in cat_rows if r.get("special_loop"))),
            "json_valid_count": int(sum(1 for r in cat_rows if r.get("json_valid") is True)),
            "json_n": int(sum(1 for r in cat_rows if r.get("json_valid") is not None)),
            "mean_unique_ratio": float(sum(float(r.get("unique_ratio") or 0.0) for r in cat_rows) / max(1, len(cat_rows))),
            "mean_entropy": float(sum(float(r.get("entropy") or 0.0) for r in cat_rows) / max(1, len(cat_rows))),
            "mean_max_run": float(sum(float(r.get("max_run") or 0.0) for r in cat_rows) / max(1, len(cat_rows))),
            "mean_special_rate": float(sum(float(r.get("special_rate_0_8") or 0.0) for r in cat_rows) / max(1, len(cat_rows))),
        }

    return {
        "n_items": len(rows),
        "descriptive_pass_count": int(sum(1 for r in rows if r["descriptive_pass"])),
        "constraint_ok_count": int(sum(1 for r in rows if r["constraint_ok"])),
        "n_collapsed": int(sum(1 for r in rows if r.get("collapsed"))),
        "n_special_loop": int(sum(1 for r in rows if r.get("special_loop"))),
        "json_valid_count": int(sum(1 for r in rows if r.get("json_valid") is True)),
        "json_n": int(sum(1 for r in rows if r.get("json_valid") is not None)),
        "mean_unique_ratio": float(sum(float(r.get("unique_ratio") or 0.0) for r in rows) / max(1, len(rows))),
        "mean_entropy": float(sum(float(r.get("entropy") or 0.0) for r in rows) / max(1, len(rows))),
        "mean_max_run": float(sum(float(r.get("max_run") or 0.0) for r in rows) / max(1, len(rows))),
        "mean_special_rate": float(sum(float(r.get("special_rate_0_8") or 0.0) for r in rows) / max(1, len(rows))),
        "by_category": {k: agg(v) for k, v in by_cat.items()},
        "items": rows,
    }


def inspect_cap02(model, tokenizer, device, dump_root: Path, parent_argmax: int | None) -> dict[str, Any]:
    items = load_retention_items(dump_root)
    it = next((x for x in items if (x.get("evalId") or x.get("id")) == "cap0-ret-02"), None)
    if not it:
        return {"ok": False, "missing": True, "evalId": "cap0-ret-02"}
    prompt = it.get("prompt") or it.get("input") or it.get("generation_prompt") or ""
    gen = greedy_generate(model, tokenizer, prompt, device, max_new=32)
    metrics = continuation_metrics(gen)
    binary = score_retention(gen, it.get("expected") or {})
    first = first_token_stats(model, tokenizer, prompt, device, parent_argmax=parent_argmax)
    return {
        "ok": True,
        "evalId": "cap0-ret-02",
        "status": "COMPATIBILITY_ONLY",
        "evaluator_unmodified": True,
        "catastrophic_forgetting_label": False,
        "prompt_chars": len(prompt),
        "prompt_prefix": prompt[:180],
        "continuation": gen.get("continuation"),
        "binary_pass": binary,
        "unique_ratio": gen.get("unique_ratio"),
        "entropy": gen.get("entropy"),
        "max_run": gen.get("max_run"),
        "collapsed": gen.get("collapsed"),
        "special_loop": gen.get("special_loop"),
        "token_id_sha256": metrics.get("token_id_sha256"),
        "first_token": first,
    }


def inside_review_bands(row: dict[str, Any]) -> bool:
    bands = REVIEW_BANDS["stage3a_step_50"]
    dnll = float(row.get("mean_wrim0_anchor_nll_delta") or 0.0)
    kl = float(row.get("mean_kl_wrim0_to_candidate") or 0.0)
    v0 = float(row.get("val_loss_corpus0") or 0.0)
    v1 = float(row.get("val_loss_corpus1") or 0.0)
    return (
        dnll < bands["anchor_dnll_review_at_or_above"]
        and kl < bands["kl_review_at_or_above"]
        and v0 < bands["val0_review_at_or_above"]
        and v1 < bands["val1_review_at_or_above"]
    )


def select_candidates(points: list[dict[str, Any]]) -> dict[str, Any]:
    usable = [p for p in points if p.get("mean_kl_wrim0_to_candidate") is not None]
    if not usable:
        return {"ok": False}
    best_retention = max(
        usable,
        key=lambda p: (
            int(p.get("expanded_retention_pass") or 0),
            int(p.get("historical_pass_count") or 0),
            -float(p.get("mean_kl_wrim0_to_candidate") or 99),
        ),
    )
    best_adaptation = min(usable, key=lambda p: (float(p.get("val_loss_corpus1") or 99), float(p.get("val_loss_corpus0") or 99)))
    best_balanced = min(
        usable,
        key=lambda p: (
            float(p.get("pareto_zsum") if p.get("pareto_zsum") is not None else 99),
            float(p.get("mean_kl_wrim0_to_candidate") or 99),
        ),
    )
    best_stability = min(
        usable,
        key=lambda p: (
            int(p.get("expanded_n_collapsed") or 0) + int(p.get("n_collapsed") or 0),
            float(p.get("expanded_mean_special_rate") or 0.0),
            -float(p.get("expanded_mean_unique_ratio") or 0.0),
        ),
    )
    best_struct = max(
        usable,
        key=lambda p: (
            int(p.get("expanded_struct_constraint") or 0),
            int(p.get("expanded_struct_json_valid") or 0),
            -int(p.get("expanded_struct_collapsed") or 0),
        ),
    )
    preferred = best_balanced
    votes = [best_retention["candidate_id"], best_balanced["candidate_id"], best_stability["candidate_id"]]
    if votes.count(best_retention["candidate_id"]) >= 2:
        preferred = best_retention
    elif votes.count(best_balanced["candidate_id"]) >= 2:
        preferred = best_balanced
    raw50 = next((p for p in usable if p.get("candidate_id") == "STEP50_RAW"), None)
    raw50_unsuitable = True
    if raw50 is not None:
        raw50_unsuitable = (not inside_review_bands(raw50)) or int(raw50.get("historical_pass_count") or 0) < 6
    healthy_future = bool(inside_review_bands(preferred) and int(preferred.get("expanded_retention_pass") or 0) >= int(best_retention.get("expanded_retention_pass") or 0) * 0.8)
    # Stage3B is never granted. Recommendation is review-only.
    if not any(inside_review_bands(p) for p in usable if p.get("candidate_id") != "WRIM-0"):
        rec = "A. STAGE3B_NOT_JUSTIFIED"
    elif str(preferred["candidate_id"]).startswith("STEP25_A") and preferred["candidate_id"] != "STEP25_RAW":
        rec = "E. STEP25_INTERPOLATED_CANDIDATE_PREFERRED_FOR_FUTURE_REVIEW"
    elif preferred["candidate_id"] == "STEP25_RAW":
        rec = "C. STEP25_BRANCH_PREFERRED_FOR_FUTURE_REVIEW"
    elif str(preferred["candidate_id"]).startswith("STEP50_A"):
        rec = "D. STEP50_INTERPOLATED_CANDIDATE_PREFERRED_FOR_FUTURE_REVIEW"
    else:
        rec = "B. MORE_EVALUATION_REQUIRED"
    if rec != "A. STAGE3B_NOT_JUSTIFIED":
        # Continuous drift still present on raw step50; interpolated candidates remain TEST_ONLY_MERGE.
        # Prefer more evaluation unless a non-parent candidate is inside bands AND retention is not worse than parent.
        parent = next((p for p in usable if p.get("candidate_id") == "WRIM-0"), None)
        if parent and int(preferred.get("expanded_retention_pass") or 0) + 2 < int(parent.get("expanded_retention_pass") or 0):
            rec = "B. MORE_EVALUATION_REQUIRED"
        if not inside_review_bands(preferred) and preferred.get("candidate_id") != "WRIM-0":
            rec = "B. MORE_EVALUATION_REQUIRED"
    return {
        "BEST_RETENTION": {"candidate_id": best_retention["candidate_id"], "reason": "highest expanded retention descriptive pass; tie CAP then lowest KL"},
        "BEST_ADAPTATION": {"candidate_id": best_adaptation["candidate_id"], "reason": "lowest val_loss_corpus1; not assumed globally better"},
        "BEST_BALANCED": {"candidate_id": best_balanced["candidate_id"], "reason": "combined Pareto z-sum on ΔNLL, KL, val0, val1"},
        "BEST_GENERATION_STABILITY": {"candidate_id": best_stability["candidate_id"], "reason": "fewest collapses, then lowest special rate, then highest unique ratio"},
        "BEST_STRUCTURED_OUTPUT": {"candidate_id": best_struct["candidate_id"], "reason": "highest expanded structured constraint satisfaction; JSON 0/5 is not treated as a new Stage3A validity regression"},
        "PREFERRED_STAGE3A_EVALUATION_CANDIDATE": {
            "candidate_id": preferred["candidate_id"],
            "promotion": False,
            "kind": "EVALUATION_CANDIDATE" if preferred.get("candidate_id") != "WRIM-0" else "PARENT_REFERENCE",
            "test_only_merge": str(preferred.get("candidate_id") or "").startswith("STEP") and "_A" in str(preferred.get("candidate_id")),
        },
        "raw_step50_remains_unsuitable": raw50_unsuitable,
        "healthy_enough_for_future_stage3b_review": False,
        "STAGE3B_RECOMMENDATION": rec,
        "STAGE3B_AUTHORIZATION": "NO",
        "note": "No recommendation grants STAGE3B or training authorization.",
    }


def attach_zsum(points: list[dict[str, Any]]) -> None:
    keys = ("mean_wrim0_anchor_nll_delta", "mean_kl_wrim0_to_candidate", "val_loss_corpus0", "val_loss_corpus1")
    cols = {k: [float(p[k]) for p in points if p.get(k) is not None] for k in keys}
    means = {k: (sum(v) / len(v) if v else 0.0) for k, v in cols.items()}
    def sd(xs: list[float]) -> float:
        if len(xs) < 2:
            return 1.0
        m = sum(xs) / len(xs)
        var = sum((x - m) ** 2 for x in xs) / (len(xs) - 1)
        return math.sqrt(var) if var > 1e-18 else 1.0
    sds = {k: sd(v) for k, v in cols.items()}
    for p in points:
        acc = 0.0
        ok = True
        for k in keys:
            if p.get(k) is None:
                ok = False
                break
            acc += (float(p[k]) - means[k]) / (sds[k] if sds[k] > 1e-12 else 1.0)
        p["pareto_zsum"] = acc if ok else None


def run_selection(
    *,
    weights: Path,
    tokenizer_path: Path,
    dump_root: Path,
    suite_path: Path,
    baseline_path: Path,
    nll_anchor_path: Path,
    ckpt_root: Path,
    review_path: Path,
    eval_dir: Path,
    report_path: Path,
    freeze_only: bool,
) -> dict[str, Any]:
    if TRAINING_AUTHORIZATION != "OFF":
        raise SystemExit("TRAINING_AUTHORIZATION must remain OFF")
    gate = authorization_gate(requested_mode="stage3a")
    if gate.get("allowed"):
        raise SystemExit("STAGE3A training gate must stay closed")
    if STAGE3B_AUTHORIZATION != "NO":
        raise SystemExit("STAGE3B must remain unauthorized")

    step25 = ckpt_root / "step-25" / "model.safetensors"
    step50 = ckpt_root / "step-50" / "model.safetensors"
    missing = [str(p) for p in (weights, tokenizer_path, dump_root, suite_path, baseline_path, nll_anchor_path, step25, step50, review_path) if not p.exists()]
    if missing:
        payload = {"ok": False, "kind": "STAGE3A_CANDIDATE_SELECTION_BLOCKED", "reason": "missing_required_path", "missing": missing, "TRAINING_AUTHORIZATION": "OFF"}
        write_json(report_path, payload)
        return payload

    freeze = freeze_sets(eval_dir)
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    audit = audit_sets(tokenizer, dump_root)
    selection_dir = ckpt_root / "selection"
    selection_dir.mkdir(parents=True, exist_ok=True)
    write_json(selection_dir / "leakage.json", audit)
    if not audit["ok"]:
        payload = {
            "ok": False,
            "kind": "STAGE3A_CANDIDATE_SELECTION_BLOCKED",
            "reason": "leakage_or_duplication",
            "audit": {"ok": False, "blocking_leakage": (audit.get("leakage") or {}).get("blocking_item_ids"), "blocking_dup": (audit.get("duplication_internal") or {}).get("blocking_pairs"), "blocking_vs_stage3": (audit.get("duplication_vs_stage3") or {}).get("blocking_item_ids")},
            "freeze": freeze,
            "TRAINING_AUTHORIZATION": "OFF",
            "optimizer_steps_this_pass": 0,
        }
        write_json(report_path, payload)
        print(json.dumps({"ok": False, "reason": "leakage_or_duplication", "audit": payload["audit"]}, indent=2), flush=True)
        return payload
    if freeze_only:
        payload = {"ok": True, "kind": "STAGE3A_REVIEW_SETS_FROZEN", "freeze": freeze, "audit": {"ok": True, "n_haystacks": (audit.get("leakage") or {}).get("n_haystacks")}, "TRAINING_AUTHORIZATION": "OFF", "optimizer_steps_this_pass": 0}
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2), flush=True)
        return payload

    disable_tf32()
    torch.manual_seed(EVAL_SEED)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cuda":
        torch.cuda.manual_seed_all(EVAL_SEED)

    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tokenizer_path)
    suite = load_suite(suite_path)
    baseline = load_baseline(baseline_path)
    nll_sha = sha256_json_text(nll_anchor_path)
    s25_sha = sha256_file(step25)
    s50_sha = sha256_file(step50)
    sha_block = {
        "parent": {"got": parent_sha, "expected": PARENT_SHA, "ok": parent_sha == PARENT_SHA},
        "tokenizer": {"got": tok_sha, "expected": TOKENIZER_SHA, "ok": tok_sha == TOKENIZER_SHA},
        "suite": {"got": suite["stored_hash"], "expected": SUITE_SHA, "ok": suite["hash_ok"]},
        "baseline": {"got": baseline["sha256"], "expected": BASELINE_SHA, "ok": baseline["hash_ok"]},
        "historical_nll_anchor": {"got": nll_sha, "expected": FROZEN_NLL_SHA, "ok": nll_sha == FROZEN_NLL_SHA},
        "step25_model": {"got": s25_sha, "expected": EXPECTED_STEP25_SHA, "ok": s25_sha == EXPECTED_STEP25_SHA},
        "step50_model": {"got": s50_sha, "expected": EXPECTED_STEP50_SHA, "ok": s50_sha == EXPECTED_STEP50_SHA},
    }
    if not all(v["ok"] for v in sha_block.values()):
        payload = {"ok": False, "kind": "STAGE3A_CANDIDATE_SELECTION_BLOCKED", "reason": "sha_mismatch", "sha": sha_block, "TRAINING_AUTHORIZATION": "OFF"}
        write_json(report_path, payload)
        return payload

    review = json.loads(review_path.read_text(encoding="utf-8"))
    stored50 = list(review.get("interpolation") or [])
    if len(stored50) != 7:
        payload = {"ok": False, "kind": "STAGE3A_CANDIDATE_SELECTION_BLOCKED", "reason": "missing_step50_interpolation", "n": len(stored50)}
        write_json(report_path, payload)
        return payload

    parent_model, parent_cpu = load_frozen_inference(weights, device)
    cand25_state = {k: v.contiguous() for k, v in load_file(str(step25)).items()}
    cand50_state = {k: v.contiguous() for k, v in load_file(str(step50)).items()}
    keys_ok, key_reasons = verify_endpoint_keys(cand25_state, parent_cpu)
    keys_ok50, key_reasons50 = verify_endpoint_keys(cand50_state, parent_cpu)
    lerp0 = lerp_state(cand25_state, parent_cpu, 0.0)
    lerp1 = lerp_state(cand25_state, parent_cpu, 1.0)
    endpoint = {
        "step25_lerp0_matches_candidate": tensors_sha256(lerp0) == tensors_sha256(cand25_state),
        "step25_lerp1_matches_parent": tensors_sha256(lerp1) == tensors_sha256(parent_cpu),
        "step25_keys_ok": keys_ok,
        "step50_keys_ok": keys_ok50,
        "step25_key_reasons": key_reasons,
        "step50_key_reasons": key_reasons50,
    }
    if not endpoint["step25_lerp0_matches_candidate"] or not endpoint["step25_lerp1_matches_parent"] or not keys_ok or not keys_ok50:
        payload = {"ok": False, "kind": "STAGE3A_CANDIDATE_SELECTION_BLOCKED", "reason": "interpolation_endpoint", "endpoint": endpoint, "TRAINING_AUTHORIZATION": "OFF"}
        write_json(report_path, payload)
        return payload

    c0 = concat_units(encode_rehearsal_val_units(tokenizer, dump_root))
    c1 = concat_units(encode_corpus1_val_units(tokenizer, dump_root))
    suite_items = suite["obj"]["items"]
    frozen_items = baseline["obj"]["items"]
    frozen_special = float((baseline["obj"].get("special_token_baseline") or {}).get("mean_special_rate_256") or 0.0)
    wrim0_logp: dict[str, torch.Tensor] = {}

    print("[select] parent compact eval for logp cache", flush=True)
    parent_eval = evaluate_candidate(
        model=parent_model, tokenizer=tokenizer, device=device, dump_root=dump_root,
        suite_items=suite_items, frozen_items=frozen_items, wrim0_logp=wrim0_logp,
        parent_cpu=parent_cpu, c0=c0, c1=c1, greedy_256=False, step=0, train_loss=None, tokens=0, lr=None,
    )

    print("[select] STEP25 interpolation alphas", ALPHAS, flush=True)
    step25_interp = []
    for alpha in ALPHAS:
        merged = lerp_state(cand25_state, parent_cpu, float(alpha))
        model = load_into_model(merged, device)
        ev = evaluate_candidate(
            model=model, tokenizer=tokenizer, device=device, dump_root=dump_root,
            suite_items=suite_items, frozen_items=frozen_items, wrim0_logp=wrim0_logp,
            parent_cpu=parent_cpu, c0=c0, c1=c1, greedy_256=False, step=25, train_loss=None,
            tokens=102400, lr=lr_stage3a(25) if abs(alpha) < 1e-12 else None,
        )
        row = interp_row(ev, source="STEP25", alpha=float(alpha))
        row["displacement"] = parameter_displacement(model, parent_cpu)
        row["review_band_crossings"] = review_band_crossings(ev, frozen_special)
        step25_interp.append(row)
        write_json(selection_dir / f"step25-interp-alpha-{alpha:.1f}.json", {**row, "eval": strip_item_ids(ev)})
        print(json.dumps({"source": "STEP25", "alpha": alpha, "dnll": row["mean_wrim0_anchor_nll_delta"], "kl": row["mean_kl_wrim0_to_candidate"], "cap": row["historical_binary"]}), flush=True)
        del model

    step50_interp = []
    for row in stored50:
        mapped = {
            "run_id": "STEP50",
            "source": "STEP50",
            "alpha": float(row["alpha"]),
            "candidate_id": "WRIM-0" if abs(float(row["alpha"]) - 1.0) < 1e-12 else (f"STEP50_A{float(row['alpha']):.1f}" if float(row["alpha"]) else "STEP50_RAW"),
            "mean_wrim0_anchor_nll_delta": row.get("mean_wrim0_anchor_nll_delta"),
            "mean_kl_wrim0_to_candidate": row.get("mean_kl_wrim0_to_candidate"),
            "val_loss_corpus0": row.get("val_loss_corpus0"),
            "val_loss_corpus1": row.get("val_loss_corpus1"),
            "historical_binary": row.get("historical_binary"),
            "historical_pass_count": row.get("historical_pass_count"),
            "n_collapsed": row.get("n_collapsed"),
            "special_token_mean_rate": row.get("special_token_mean_rate"),
            "json_valid_count": row.get("json_valid_count"),
            "review_band_crossings": row.get("review_band_crossings"),
            "reused_from": "stage3a-review.json",
        }
        step50_interp.append(mapped)

    compare_specs = [{"candidate_id": "WRIM-0", "source": "parent", "alpha": 1.0}]
    for a in COMPARE_ALPHAS:
        compare_specs.append({"candidate_id": "STEP25_RAW" if a == 0.0 else f"STEP25_A{a:.1f}", "source": "step25", "alpha": a})
        compare_specs.append({"candidate_id": "STEP50_RAW" if a == 0.0 else f"STEP50_A{a:.1f}", "source": "step50", "alpha": a})

    metric_by_id = {"WRIM-0": interp_row(parent_eval, source="WRIM-0", alpha=1.0)}
    metric_by_id["WRIM-0"]["candidate_id"] = "WRIM-0"
    for row in step25_interp:
        if row["candidate_id"] != "WRIM-0":
            metric_by_id[row["candidate_id"]] = row
    for row in step50_interp:
        if row["candidate_id"] != "WRIM-0":
            metric_by_id[row["candidate_id"]] = row

    parent_argmax = None
    cap02 = {}
    print("[select] expanded retention + structured output on comparison candidates", flush=True)
    for spec in compare_specs:
        cid = spec["candidate_id"]
        print(f"[select] expanded {cid}", flush=True)
        if spec["source"] == "parent":
            model = parent_model
        elif spec["source"] == "step25":
            model = load_into_model(lerp_state(cand25_state, parent_cpu, float(spec["alpha"])), device)
        else:
            model = load_into_model(lerp_state(cand50_state, parent_cpu, float(spec["alpha"])), device)
        ret = evaluate_item_set(model, tokenizer, device, RETENTION_ITEMS)
        struct = evaluate_item_set(model, tokenizer, device, STRUCT_ITEMS)
        write_json(selection_dir / f"expanded-{cid}.json", {"retention": ret, "structured": struct})
        target = metric_by_id[cid]
        target["expanded_retention_pass"] = ret["descriptive_pass_count"]
        target["expanded_retention_n"] = ret["n_items"]
        target["expanded_n_collapsed"] = int(ret["n_collapsed"]) + int(struct["n_collapsed"])
        target["expanded_mean_unique_ratio"] = ret["mean_unique_ratio"]
        target["expanded_mean_entropy"] = ret["mean_entropy"]
        target["expanded_mean_max_run"] = ret["mean_max_run"]
        target["expanded_mean_special_rate"] = ret["mean_special_rate"]
        target["expanded_struct_constraint"] = struct["constraint_ok_count"]
        target["expanded_struct_n"] = struct["n_items"]
        target["expanded_struct_json_valid"] = struct["json_valid_count"]
        target["expanded_struct_collapsed"] = struct["n_collapsed"]
        target["expanded_retention"] = {k: ret[k] for k in ret if k != "items"}
        target["expanded_structured"] = {k: struct[k] for k in struct if k != "items"}
        if cid in ("WRIM-0", "STEP25_RAW", "STEP50_RAW", "STEP50_A0.5"):
            if cid == "WRIM-0":
                probe = inspect_cap02(model, tokenizer, device, dump_root, None)
                parent_argmax = (probe.get("first_token") or {}).get("argmax_id")
            else:
                probe = inspect_cap02(model, tokenizer, device, dump_root, parent_argmax)
            cap02[cid] = probe
            write_json(selection_dir / f"cap0-ret-02-{cid}.json", probe)
        if spec["source"] != "parent":
            del model

    compare_points = [metric_by_id[s["candidate_id"]] for s in compare_specs]
    attach_zsum(compare_points)
    combined_pareto = pareto_analysis(compare_points)
    step25_pareto = pareto_analysis(step25_interp)
    step50_pareto = pareto_analysis(step50_interp)

    # Best step25 interpolation among COMPARE_ALPHAS for cap0-ret-02 if not already captured.
    step25_only = [p for p in compare_points if str(p.get("candidate_id")).startswith("STEP25")]
    best_step25 = min(step25_only, key=lambda p: float(p.get("pareto_zsum") or 99)) if step25_only else None
    if best_step25 and best_step25["candidate_id"] not in cap02:
        alpha = float(str(best_step25["candidate_id"]).split("A")[-1]) if "_A" in best_step25["candidate_id"] else 0.0
        model = load_into_model(lerp_state(cand25_state, parent_cpu, alpha), device)
        cap02[best_step25["candidate_id"]] = inspect_cap02(model, tokenizer, device, dump_root, parent_argmax)
        write_json(selection_dir / f"cap0-ret-02-{best_step25['candidate_id']}.json", cap02[best_step25["candidate_id"]])
        del model
    cap02["best_step25_interpolation"] = None if not best_step25 else {"candidate_id": best_step25["candidate_id"], **cap02.get(best_step25["candidate_id"], {})}

    selection = select_candidates(compare_points)
    preferred_id = (selection.get("PREFERRED_STAGE3A_EVALUATION_CANDIDATE") or {}).get("candidate_id")

    payload = {
        "ok": True,
        "kind": "STAGE3A_CANDIDATE_SELECTION",
        "run_id": RUN_ID,
        "optimizer_steps_this_pass": 0,
        "parameter_update_count_this_pass": 0,
        "TRAINING_AUTHORIZATION": "OFF",
        "STAGE3_AUTHORIZATION": STAGE3_AUTHORIZATION,
        "STAGE3B_AUTHORIZATION": "NO",
        "STAGE3B_EXECUTION_READINESS": False,
        "promotion_candidate": False,
        "interpolation_auto_promoted": False,
        "sha": sha_block,
        "endpoint": endpoint,
        "freeze": freeze,
        "leakage_audit": {"ok": True, "n_haystacks": (audit.get("leakage") or {}).get("n_haystacks"), "blocking_item_ids": []},
        "raw_stage3a_status": "REVIEWED",
        "raw_step50_classification": "B. REVIEW_REQUIRED_CONTINUOUS_DRIFT",
        "HEALTHY_FOR_CONTINUATION": False,
        "parent_eval_compact": summarize_eval(parent_eval),
        "step25_interpolation": step25_interp,
        "step50_interpolation": step50_interp,
        "step25_pareto": step25_pareto,
        "step50_pareto": step50_pareto,
        "combined_pareto": combined_pareto,
        "comparison": [{k: p.get(k) for k in p if k not in ("instruction", "long_form")} for p in compare_points],
        "cap0_ret_02": cap02,
        "selection": selection,
        "PREFERRED_STAGE3A_EVALUATION_CANDIDATE": preferred_id,
        "candidate_state": "EVALUATION_CANDIDATE",
        "review_bands": REVIEW_BANDS["stage3a_step_50"],
        "seed": SEED,
        "eval_seed": EVAL_SEED,
        "device": str(device),
        "utc": utc_now(),
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "QWEN": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "RAEL": "NOT_IMPLEMENTED",
        "ROADMAP_22": "CLOSED",
        "ROADMAP_23": "ACTIVE",
    }
    write_json(report_path, payload)
    write_json(selection_dir / "STAGE3A_CANDIDATE_SELECTION.json", payload)
    print(json.dumps({
        "ok": True,
        "preferred": preferred_id,
        "recommendation": selection.get("STAGE3B_RECOMMENDATION"),
        "optimizer_steps_this_pass": 0,
        "TRAINING_AUTHORIZATION": "OFF",
    }, indent=2), flush=True)
    return payload


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--dump-root", required=True)
    ap.add_argument("--suite", required=True)
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--nll-anchor", required=True)
    ap.add_argument("--ckpt-dir", required=True)
    ap.add_argument("--review", required=True)
    ap.add_argument("--eval-dir", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--freeze-only", action="store_true")
    args = ap.parse_args()
    out = run_selection(
        weights=Path(args.weights),
        tokenizer_path=Path(args.tokenizer),
        dump_root=Path(args.dump_root),
        suite_path=Path(args.suite),
        baseline_path=Path(args.baseline),
        nll_anchor_path=Path(args.nll_anchor),
        ckpt_root=Path(args.ckpt_dir),
        review_path=Path(args.review),
        eval_dir=Path(args.eval_dir),
        report_path=Path(args.report),
        freeze_only=bool(args.freeze_only),
    )
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
