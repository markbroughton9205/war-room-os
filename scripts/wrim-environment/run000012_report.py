"""WRIM1-RUN-000012 diagnosis. Does not train."""
from __future__ import annotations

from typing import Any

from run000010_report import _cat_correct, _me_pass, _num, traj
from run000011_report import engineer_diagnosis, rank_score, select_best
from run000012_compare import compare_matched_steps, objective_benefit
from run000012_identity import OLD_TRAINER_PROVENANCE_HASH


def diagnose(evals: dict[str, dict[str, Any]], metrics: list[dict[str, Any]], peak_passed: bool) -> dict[str, Any]:
    parent = evals.get("0") or {}
    last_key = max((int(k) for k in evals), default=0)
    last = evals.get(str(last_key)) or {}
    best = select_best(evals)
    best_ev = best.get("eval") or last
    parent_inst = _cat_correct(parent, "mode_entry_validation", "INSTRUCTION_VALIDATION")
    parent_stop = _cat_correct(parent, "mode_entry_validation", "STOPPING_VALIDATION")
    best_inst = _cat_correct(best_ev, "mode_entry_validation", "INSTRUCTION_VALIDATION")
    best_stop = _cat_correct(best_ev, "mode_entry_validation", "STOPPING_VALIDATION")
    parent_me = _me_pass(parent)
    best_me = _me_pass(best_ev)
    inst_gain = best_inst - parent_inst
    stop_gain = best_stop - parent_stop
    me_gain = best_me - parent_me
    new_fail = int(best_ev.get("NEW_FAILURES_VS_PARENT") or last.get("NEW_FAILURES_VS_PARENT") or 0)
    cap_txt = str(best_ev.get("historical_binary") or last.get("historical_binary") or "")
    dnll = _num(best_ev.get("mean_wrim0_anchor_nll_delta"))
    kl = _num(best_ev.get("mean_kl_wrim0_to_candidate"))
    retention_ok = (dnll is None or dnll < 0.105) and (kl is None or kl < 0.022)
    max_run = _num(best_ev.get("S3_INST_02_MAX_RUN_256"))
    parent_run = _num(parent.get("S3_INST_02_MAX_RUN_256"))
    attractor_reentry = bool(max_run is not None and max_run >= 85)
    hash137 = any(int(ev.get("S3_INST_02_MAX_RUN_256") or 0) >= 137 for ev in evals.values())
    cmp = compare_matched_steps(evals)
    benefit = objective_benefit(cmp.get("rows") or [])
    benefit_status = benefit.get("status") or "NO_OBJECTIVE_BENEFIT"
    greedy_breakthrough = best_me > 0 or best_inst > 0 or best_stop > 0

    if attractor_reentry or hash137:
        signal = "ATTRACTOR_REENTRY"
        disposition = "ATTRACTOR_REENTRY"
    elif greedy_breakthrough and retention_ok and new_fail == 0:
        signal = "GREEDY_MODE_ENTRY_BREAKTHROUGH"
        disposition = "GREEDY_MODE_ENTRY_BREAKTHROUGH"
        benefit_status = "GREEDY_MODE_ENTRY_BREAKTHROUGH"
    elif benefit_status == "STRONG_OBJECTIVE_IMPROVEMENT" and retention_ok and new_fail == 0:
        signal = "STRONG_OBJECTIVE_IMPROVEMENT"
        disposition = "STRONG_OBJECTIVE_IMPROVEMENT"
    elif benefit_status == "MODEST_OBJECTIVE_IMPROVEMENT" and retention_ok and new_fail == 0:
        signal = "MODEST_OBJECTIVE_IMPROVEMENT"
        disposition = "MODEST_OBJECTIVE_IMPROVEMENT"
    elif benefit_status == "OBJECTIVE_REGRESSION":
        signal = "OBJECTIVE_REGRESSION"
        disposition = "OBJECTIVE_REGRESSION"
    else:
        signal = "NO_OBJECTIVE_BENEFIT"
        disposition = "NO_OBJECTIVE_BENEFIT"

    completed = last_key >= 30
    plateau = bool(
        completed
        and best_me == 0
        and inst_gain <= 0
        and stop_gain <= 0
        and benefit_status in {"NO_OBJECTIVE_BENEFIT", "OBJECTIVE_REGRESSION", "MODEST_OBJECTIVE_IMPROVEMENT"}
        and benefit_status != "STRONG_OBJECTIVE_IMPROVEMENT"
        and not attractor_reentry
        and not greedy_breakthrough
    )
    if plateau and benefit_status == "NO_OBJECTIVE_BENEFIT":
        signal = "NO_OBJECTIVE_BENEFIT"
        disposition = "NO_OBJECTIVE_BENEFIT"

    grads = [m.get("grad_norm") for m in metrics if m.get("grad_norm") is not None]
    finite_grads = [g for g in grads if _num(g) is not None]
    instability = "NOT_DETECTED"
    if any((_num(g) or 0) >= 50 for g in finite_grads):
        instability = "DETECTED"
    elif any((_num(g) or 0) >= 5 for g in finite_grads):
        instability = "INCONCLUSIVE"

    return {
        "best": best,
        "CAPABILITY_SIGNAL_CLASSIFICATION": signal,
        "disposition": disposition,
        "OBJECTIVE_BENEFIT_STATUS": benefit_status,
        "OBJECTIVE_BENEFIT_DETAIL": benefit,
        "RUN011_MATCHED_STEP_COMPARISON": cmp,
        "MODE_ENTRY_RESULT": "GAIN" if me_gain > 0 else "UNCHANGED",
        "STOPPING_RESULT": "GAIN" if stop_gain > 0 else "UNCHANGED",
        "ATTRACTOR_STATUS": "REENTRY" if attractor_reentry or hash137 else "UNCHANGED",
        "RETENTION_STATUS": "INSIDE_LIMITS" if retention_ok else "EXCEEDED",
        "INSTABILITY": instability,
        "WRIM_CAPABILITY_PLATEAU_REVIEW_REQUIRED": "YES" if plateau else "NO",
        "TOKENIZER_REVIEW_REQUIRED": "YES" if plateau else "NO",
        "MODEL_CAPACITY_REVIEW_REQUIRED": "YES" if plateau else "NO",
        "ARCHITECTURE_REVIEW_REQUIRED": "YES" if plateau else "NO",
        "protected_ok": new_fail == 0 and retention_ok,
        "new_fail": new_fail,
        "dnll": dnll,
        "kl": kl,
        "instruction_gain": inst_gain,
        "stopping_gain": stop_gain,
        "mode_entry_gain": me_gain,
        "peak_passed": peak_passed,
        "OLD_TRAINER_PROVENANCE_HASH": OLD_TRAINER_PROVENANCE_HASH,
        "parent_run": parent_run,
        "max_run": max_run,
    }


def engineer_diagnosis_012(diag: dict[str, Any]) -> str:
    base = engineer_diagnosis(diag)
    return (
        base
        + f" Objective benefit vs RUN-000011: {diag.get('OBJECTIVE_BENEFIT_STATUS')}."
        + f" Plateau review required: {diag.get('WRIM_CAPABILITY_PLATEAU_REVIEW_REQUIRED')}."
    )
