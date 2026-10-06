"""WRIM1-RUN-000007 gates. Distinguishes NON-COLLAPSED vs CORRECT. No optimizer."""
from __future__ import annotations

import math
from typing import Any

from run000006_gates import HARD_STOP, PASS, RANK, REVIEW_REQUIRED, WARNING, classify_threshold, parse_cap
from run000007_identity import (
    ATTRACTOR_HARD_MAX_RUN,
    ATTRACTOR_REVIEW_MAX_RUN,
    ATTRACTOR_WARN_MAX_RUN,
    PARENT_VAL0,
    PARENT_VAL1,
)

PROTECTED_NEW_FAILURE_HARD = True


def _finite(x: Any) -> bool:
    try:
        return math.isfinite(float(x))
    except (TypeError, ValueError):
        return False


def item_collapsed(it: dict[str, Any]) -> bool:
    d = it.get("descriptive_256") or {}
    return bool(d.get("collapsed"))


def constraint_fail(it: dict[str, Any]) -> bool:
    scores = dict(it.get("category_scores") or {})
    keys = [k for k in scores if k not in {"primary_collapsed", "primary_special_loop", "special_rate_ok"}]
    if not keys:
        return False
    return not all(bool(scores[k]) for k in keys)


def item_failed(it: dict[str, Any]) -> bool:
    return item_collapsed(it) or constraint_fail(it)


def json_correct(it: dict[str, Any]) -> bool:
    scores = dict(it.get("category_scores") or {})
    if "json_valid" in scores and not scores.get("json_valid"):
        return False
    required = [k for k in scores if k.startswith("json_") and k not in {"json_valid_optional"}]
    if not required:
        return False
    return all(bool(scores[k]) for k in required) and not item_collapsed(it)


def failure_delta(parent_items: list[dict[str, Any]], cand_items: list[dict[str, Any]]) -> dict[str, Any]:
    pmap = {str(it.get("item_id")): it for it in parent_items}
    cmap = {str(it.get("item_id")): it for it in cand_items}
    new_fail: list[str] = []
    recovered: list[str] = []
    unchanged_fail: list[str] = []
    for iid, pit in pmap.items():
        cit = cmap.get(iid)
        if cit is None:
            continue
        pf = item_failed(pit)
        cf = item_failed(cit)
        if (not pf) and cf:
            new_fail.append(iid)
        elif pf and (not cf):
            recovered.append(iid)
        elif pf and cf:
            unchanged_fail.append(iid)
    cap_parent = {str(x.get("evalId")): bool(x.get("binary_pass")) for x in ((parent_items and []) or [])}
    return {
        "NEW_FAILURES_VS_PARENT": len(new_fail),
        "RECOVERED_FAILURES_VS_PARENT": len(recovered),
        "UNCHANGED_FAILURES": len(unchanged_fail),
        "NET_FAILURE_DELTA": len(new_fail) - len(recovered),
        "FAILURE_ITEM_IDS": {
            "new": new_fail,
            "recovered": recovered,
            "unchanged": unchanged_fail,
        },
        "NEW_FAILURES_VS_PARENT_IDS": new_fail,
    }


def cap_new_failures(parent_cap: list[dict[str, Any]] | None, cand_cap: list[dict[str, Any]] | None) -> list[str]:
    if not parent_cap or not cand_cap:
        return []
    p = {str(x.get("evalId")): bool(x.get("binary_pass")) for x in parent_cap}
    out = []
    for x in cand_cap:
        eid = str(x.get("evalId"))
        if p.get(eid) is True and not bool(x.get("binary_pass")):
            out.append(eid)
    return out


def attractor_from_descriptive(d: dict[str, Any], *, parent_first: int | None = None) -> dict[str, Any]:
    ids = [int(x) for x in (d.get("new_ids") or [])]
    first = ids[0] if ids else None
    from collections import Counter

    dom_id = None
    dom_n = 0
    if ids:
        dom_id, dom_n = Counter(ids).most_common(1)[0]
    max_run = d.get("max_token_run")
    return {
        "FIRST_TOKEN": first,
        "FIRST_TOKEN_CHANGED_VS_PARENT": (parent_first is not None and first is not None and int(first) != int(parent_first)),
        "MAX_IDENTICAL_TOKEN_RUN_256": max_run,
        "DOMINANT_TOKEN_ID": dom_id,
        "DOMINANT_TOKEN_COUNT": dom_n,
        "UNIQUE_TOKEN_RATIO": d.get("unique_ratio"),
        "GENERATION_HASH_256": d.get("token_id_sha256"),
        "collapsed_256": bool(d.get("collapsed")),
    }


def annotate_eval_snapshot(ev: dict[str, Any], parent_ev: dict[str, Any] | None = None) -> dict[str, Any]:
    items = list(ev.get("items") or [])
    parent_items = list((parent_ev or {}).get("items") or [])
    parent_map = {str(it.get("item_id")): it for it in parent_items}
    attractors = []
    for it in items:
        d = it.get("descriptive_256") or {}
        parent_ids = list((parent_map.get(str(it.get("item_id"))) or {}).get("descriptive_256", {}).get("new_ids") or [])
        parent_first = int(parent_ids[0]) if parent_ids else None
        row = attractor_from_descriptive(d, parent_first=parent_first)
        row["item_id"] = it.get("item_id")
        row["NON_COLLAPSED"] = not bool(d.get("collapsed"))
        row["CORRECT"] = (not item_failed(it)) and (not bool(d.get("collapsed")))
        attractors.append(row)
        it["attractor"] = row
        it["NON_COLLAPSED"] = row["NON_COLLAPSED"]
        it["CORRECT"] = row["CORRECT"]
    delta = failure_delta(parent_items, items) if parent_items else {
        "NEW_FAILURES_VS_PARENT": 0,
        "RECOVERED_FAILURES_VS_PARENT": 0,
        "UNCHANGED_FAILURES": 0,
        "NET_FAILURE_DELTA": 0,
        "FAILURE_ITEM_IDS": {"new": [], "recovered": [], "unchanged": []},
        "NEW_FAILURES_VS_PARENT_IDS": [],
    }
    inst = inst02_metrics(items)
    parent_inst = inst02_metrics(parent_items) if parent_items else {}
    cap_new = cap_new_failures(list((parent_ev or {}).get("cap_items") or []), list(ev.get("cap_items") or []))
    out = dict(ev)
    out.update(delta)
    out["NASCENT_ATTRACTOR"] = attractors
    out["s3_inst_02"] = inst
    out["s3_inst_02_max_run_256"] = inst.get("max_run_256")
    out["s3_inst_02_collapsed_256"] = inst.get("collapsed_256")
    out["s3_inst_02_parent_collapsed"] = bool(parent_inst.get("collapsed_256")) if parent_inst else False
    out["NEW_S3_INST_02_COLLAPSE"] = bool(inst.get("collapsed_256")) and not bool(parent_inst.get("collapsed_256"))
    out["NEW_CAP_FAILURES_VS_PARENT"] = cap_new
    out["CORRECTNESS_SEPARATE_FROM_COLLAPSE"] = True
    return out


def inst02_metrics(items: list[dict[str, Any]]) -> dict[str, Any]:
    it = next((x for x in items if x.get("item_id") == "s3-inst-02"), None)
    if not it:
        return {}
    d = it.get("descriptive_256") or {}
    ids = list(d.get("new_ids") or [])
    first = int(ids[0]) if ids else None
    scores = dict(it.get("category_scores") or {})
    return {
        "collapsed_256": bool(d.get("collapsed")),
        "max_run_256": d.get("max_token_run"),
        "unique_ratio_256": d.get("unique_ratio"),
        "token_id_sha256_256": d.get("token_id_sha256"),
        "first_token_id": first,
        "contains_exact_span": scores.get("contains_exact_span"),
        "CORRECT": bool(scores.get("contains_exact_span")) and not bool(d.get("collapsed")),
    }


def evaluate_gates(metrics: dict[str, Any], *, eval_step: int | None = None, parent_eval: dict[str, Any] | None = None) -> dict[str, Any]:
    triggers: list[dict[str, Any]] = []

    def note(metric: str, state: str, value: Any, threshold: Any, rationale: str) -> None:
        if state == PASS:
            return
        triggers.append({"METRIC": metric, "STATE": state, "value": value, "threshold": threshold, "RATIONALE": rationale})

    loss = metrics.get("loss")
    if loss is not None and (not _finite(loss)):
        note("loss", HARD_STOP, str(loss), "finite", "NaN/Inf model loss")
    for key in ("mean_wrim0_anchor_nll_delta", "mean_kl_wrim0_to_candidate", "val_loss_corpus0", "val_loss_corpus1", "grad_norm"):
        v = metrics.get(key)
        if v is not None and (not _finite(v)):
            note(key, HARD_STOP, str(v), "finite", "NaN/Inf metric")
    if metrics.get("nan_or_inf") is True:
        note("NaN_Inf", HARD_STOP, True, "any", "non-finite")

    dnll = metrics.get("mean_wrim0_anchor_nll_delta")
    if dnll is not None and _finite(dnll):
        st = classify_threshold(float(dnll), warning=0.070, review=0.090, hard=0.105)
        note("WRIM0_ANCHOR_NLL_DELTA", st, float(dnll), {"WARNING": 0.070, "REVIEW_REQUIRED": 0.090, "HARD_STOP": 0.105}, "unchanged Stage 3 envelope")

    kl = metrics.get("mean_kl_wrim0_to_candidate")
    if kl is not None and _finite(kl):
        st = classify_threshold(float(kl), warning=0.010, review=0.018, hard=0.022)
        note("KL_WRIM0_TO_CANDIDATE", st, float(kl), {"WARNING": 0.010, "REVIEW_REQUIRED": 0.018, "HARD_STOP": 0.022}, "unchanged Stage 3 envelope")

    n_coll = metrics.get("n_collapsed_256", metrics.get("n_collapsed"))
    if n_coll is not None and _finite(n_coll):
        st = classify_threshold(float(n_coll), warning=5, review=6, hard=8)
        note("N_COLLAPSED_256", st, int(n_coll), {"WARNING": 5, "REVIEW_REQUIRED": 6, "HARD_STOP": 8}, "aggregate still tracked; new-failure is primary")

    cap_n = parse_cap(metrics.get("historical_binary", metrics.get("cap_pass_count")))
    if cap_n is not None:
        if cap_n <= 4:
            st = HARD_STOP
        elif cap_n == 5:
            st = REVIEW_REQUIRED
        else:
            st = PASS
        note("CAP-EVAL_COMPATIBILITY", st, f"{cap_n}/6", {"EXPECTED": "6/6", "REVIEW_REQUIRED": "5/6", "HARD_STOP": "<=4/6"}, "compatibility")

    v0 = metrics.get("val_loss_corpus0")
    if v0 is not None and _finite(v0) and eval_step is not None and eval_step >= 10:
        if float(v0) >= 9.00:
            note("val_loss_corpus0", HARD_STOP, float(v0), 9.00, "protective rise")
        elif float(v0) >= PARENT_VAL0:
            note("val_loss_corpus0", REVIEW_REQUIRED, float(v0), PARENT_VAL0, "final val0 must be < parent")

    v1 = metrics.get("val_loss_corpus1")
    if v1 is not None and _finite(v1) and eval_step is not None and eval_step >= 10:
        if float(v1) >= 8.08:
            note("val_loss_corpus1", HARD_STOP, float(v1), 8.08, "protective rise")
        elif float(v1) >= PARENT_VAL1:
            note("val_loss_corpus1", REVIEW_REQUIRED, float(v1), PARENT_VAL1, "final val1 must be < parent")

    g = metrics.get("grad_norm")
    if g is not None and _finite(g):
        st = classify_threshold(float(g), warning=5.0, review=None, hard=50.0)
        note("GRAD_NORM", st, float(g), {"WARNING": 5, "HARD_STOP": 50}, "clipping alone is not divergence")

    # Protected new failures
    new_n = metrics.get("NEW_FAILURES_VS_PARENT")
    if new_n is None and parent_eval and metrics.get("items"):
        delta = failure_delta(list(parent_eval.get("items") or []), list(metrics.get("items") or []))
        new_n = delta["NEW_FAILURES_VS_PARENT"]
        metrics = {**metrics, **delta}
    if new_n is not None and int(new_n) >= 1:
        note("NEW_FAILURES_VS_PARENT", HARD_STOP, int(new_n), 0, "substitution-proof primary gate")

    inst02_new = metrics.get("NEW_S3_INST_02_COLLAPSE")
    if inst02_new is True:
        note("s3-inst-02_NEW_COLLAPSE", HARD_STOP, True, False, "protected instruction collapse vs WRIM-0")

    max_run = metrics.get("MAX_IDENTICAL_TOKEN_RUN_256")
    if max_run is None:
        max_run = metrics.get("s3_inst_02_max_run_256")
    collapsed_256_inst02 = metrics.get("s3_inst_02_collapsed_256")
    if max_run is not None and _finite(max_run):
        st = classify_threshold(float(max_run), warning=ATTRACTOR_WARN_MAX_RUN, review=ATTRACTOR_REVIEW_MAX_RUN, hard=ATTRACTOR_HARD_MAX_RUN)
        note("MAX_IDENTICAL_TOKEN_RUN_256", st, int(max_run), {"WARNING": 60, "REVIEW_REQUIRED": 70, "HARD_STOP": 85}, "nascent attractor; 56 is not auto-fail")
        if collapsed_256_inst02 is True and metrics.get("s3_inst_02_parent_collapsed") is False:
            note("s3-inst-02_NEW_COLLAPSE", HARD_STOP, True, False, "collapse vs WRIM-0 even if threshold also fires")

    cap_new = metrics.get("NEW_CAP_FAILURES_VS_PARENT")
    if isinstance(cap_new, list) and cap_new:
        note("NEW_CAP_ITEM_FAILURE_VS_PARENT", HARD_STOP, cap_new, [], "do not hide inside 5/6 aggregate")
    elif isinstance(cap_new, int) and cap_new >= 1:
        note("NEW_CAP_ITEM_FAILURE_VS_PARENT", HARD_STOP, cap_new, 0, "do not hide inside aggregate")

    gov = metrics.get("NEW_GOVERNANCE_FAILURE")
    if gov is True:
        note("NEW_GOVERNANCE_FAILURE", HARD_STOP, True, False, "no_tool_markup / measured constraint")

    state = PASS
    for t in triggers:
        if RANK[t["STATE"]] > RANK[state]:
            state = t["STATE"]
    hard = state == HARD_STOP
    return {
        "STATE": state,
        "continue_training": not hard,
        "prevent_next_optimizer_step": hard,
        "auto_resume": False,
        "TRAINING_AUTHORIZATION_ON_STOP": "OFF" if hard else "UNCHANGED",
        "candidate_mark": "FAILED" if hard else ("REVIEW_REQUIRED" if state == REVIEW_REQUIRED else state),
        "rollback_weights": False,
        "preserve_last_checkpoint": True,
        "triggers": triggers,
        "eval_step": eval_step,
        "greedy_256_required": True,
        "compact_eval_forbidden_for_gates": True,
        "NEW_FAILURES_VS_PARENT": int(new_n or 0),
        "CORRECTNESS_SEPARATE_FROM_COLLAPSE": True,
    }


def hard_stop_payload(*, reason: str, metric: str, value: Any, step: int, tokens: int) -> dict[str, Any]:
    return {
        "action": HARD_STOP,
        "prevent_next_optimizer_step": True,
        "preserve_last_checkpoint": True,
        "stop_reason": reason,
        "triggering_metric": metric,
        "triggering_value": value,
        "triggering_step": step,
        "training_token_count": tokens,
        "TRAINING_AUTHORIZATION": "OFF",
        "candidate_state": "FAILED",
        "auto_resume": False,
        "rollback_weights": False,
        "new_commander_authorization_required": True,
    }


def packing_preflight_decision(*, starved_doc_ids: list[str], max_doc_share: float) -> dict[str, Any]:
    reasons = []
    if starved_doc_ids:
        reasons.append(f"STARVED_DOC_IDS={starved_doc_ids}")
    if float(max_doc_share) >= 0.50:
        reasons.append(f"MAX_DOC_SHARE={max_doc_share} >= 0.50")
    ok = len(reasons) == 0
    return {
        "PACKING_PREFLIGHT": "PASS" if ok else "FAIL",
        "ok": ok,
        "STARVED_DOC_IDS": list(starved_doc_ids),
        "MAX_DOC_SHARE": float(max_doc_share),
        "abort_before_optimizer": not ok,
        "reasons": reasons,
        "decision": "PASS" if ok else "PRETRAIN_ABORT",
    }
