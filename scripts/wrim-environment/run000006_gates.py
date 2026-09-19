"""Three-tier WRIM1-RUN-000006 gate controller. Pure functions. No optimizer."""
from __future__ import annotations

import math
from typing import Any

from run000006_identity import PARENT_VAL0, PARENT_VAL1

PASS = "PASS"
WARNING = "WARNING"
REVIEW_REQUIRED = "REVIEW_REQUIRED"
HARD_STOP = "HARD_STOP"
STATES = (PASS, WARNING, REVIEW_REQUIRED, HARD_STOP)
RANK = {PASS: 0, WARNING: 1, REVIEW_REQUIRED: 2, HARD_STOP: 3}


def _finite(x: Any) -> bool:
    try:
        return math.isfinite(float(x))
    except (TypeError, ValueError):
        return False


def parse_cap(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return int(value)
    s = str(value)
    if "/" in s:
        return int(s.split("/", 1)[0])
    try:
        return int(s)
    except ValueError:
        return None


def classify_threshold(value: float, *, warning: float | None, review: float | None, hard: float | None, direction: str = "ge") -> str:
    def hit(th: float | None) -> bool:
        if th is None:
            return False
        return value >= th if direction == "ge" else value <= th

    if hit(hard):
        return HARD_STOP
    if hit(review):
        return REVIEW_REQUIRED
    if hit(warning):
        return WARNING
    return PASS


def evaluate_gates(metrics: dict[str, Any], *, eval_step: int | None = None) -> dict[str, Any]:
    """Classify a full greedy-256 eval snapshot. Does not train."""
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

    dnll = metrics.get("mean_wrim0_anchor_nll_delta")
    if dnll is not None and _finite(dnll):
        st = classify_threshold(float(dnll), warning=0.070, review=0.090, hard=0.105)
        note("WRIM0_ANCHOR_NLL_DELTA", st, float(dnll), {"WARNING": 0.070, "REVIEW_REQUIRED": 0.090, "HARD_STOP": 0.105}, "Stage 3A crossed 0.105 by step 25")

    kl = metrics.get("mean_kl_wrim0_to_candidate")
    if kl is not None and _finite(kl):
        st = classify_threshold(float(kl), warning=0.010, review=0.018, hard=0.022)
        note("KL_WRIM0_TO_CANDIDATE", st, float(kl), {"WARNING": 0.010, "REVIEW_REQUIRED": 0.018, "HARD_STOP": 0.022}, "Stage 3A KL 0.037 at step 50")

    n_coll = metrics.get("n_collapsed_256", metrics.get("n_collapsed"))
    if n_coll is not None and _finite(n_coll):
        st = classify_threshold(float(n_coll), warning=5, review=6, hard=8)
        note("N_COLLAPSED_256", st, int(n_coll), {"WARNING": 5, "REVIEW_REQUIRED": 6, "HARD_STOP": 8}, "parent 4; Stage 3A 6")

    json_c = metrics.get("json_n_collapsed")
    if json_c is not None and _finite(json_c):
        st = classify_threshold(float(json_c), warning=2, review=3, hard=4)
        note("JSON_COLLAPSE", st, int(json_c), {"WARNING": 2, "REVIEW_REQUIRED": 3, "HARD_STOP": 4}, "parent 1; Stage 3A-final 4")

    code_c = metrics.get("code_n_collapsed")
    if code_c is not None and _finite(code_c):
        st = classify_threshold(float(code_c), warning=2, review=2, hard=3)
        note("CODE_COLLAPSE", st, int(code_c), {"WARNING": 2, "REVIEW_REQUIRED": 2, "HARD_STOP": 3}, "parent 1; Stage 3A-final 2")

    cap_n = parse_cap(metrics.get("historical_binary", metrics.get("cap_pass_count")))
    if cap_n is not None:
        if cap_n <= 4:
            st = HARD_STOP
        elif cap_n == 5:
            st = REVIEW_REQUIRED
        else:
            st = PASS
        note("CAP-EVAL_COMPATIBILITY", st, f"{cap_n}/6", {"EXPECTED": "6/6", "REVIEW_REQUIRED": "5/6", "HARD_STOP": "<=4/6"}, "compatibility only")

    v0 = metrics.get("val_loss_corpus0")
    if v0 is not None and _finite(v0):
        if float(v0) >= 9.00:
            note("val_loss_corpus0", HARD_STOP, float(v0), 9.00, "protective rise vs parent 8.890125")
        elif eval_step is not None and eval_step >= 10 and float(v0) >= PARENT_VAL0:
            note("val_loss_corpus0", WARNING, float(v0), PARENT_VAL0, "no improvement vs parent by early checkpoint")

    v1 = metrics.get("val_loss_corpus1")
    if v1 is not None and _finite(v1):
        if float(v1) >= 8.08:
            note("val_loss_corpus1", HARD_STOP, float(v1), 8.08, "protective rise vs parent 7.971308")
        elif eval_step is not None and eval_step >= 10 and float(v1) >= PARENT_VAL1:
            note("val_loss_corpus1", WARNING, float(v1), PARENT_VAL1, "no improvement vs parent by early checkpoint")

    g = metrics.get("grad_norm")
    if g is not None and _finite(g):
        st = classify_threshold(float(g), warning=5.0, review=10.0, hard=50.0)
        note("GRAD_NORM", st, float(g), {"WARNING": 5, "HARD_STOP": 50}, "clipping alone is not divergence")

    if metrics.get("nan_or_inf") is True:
        note("NaN_Inf", HARD_STOP, True, "any", "non-finite")

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
