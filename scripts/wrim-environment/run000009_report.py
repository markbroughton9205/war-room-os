"""WRIM1-RUN-000009 post-training diagnosis and commander report. Does not train."""
from __future__ import annotations

from typing import Any

from run000009_identity import PARENT_VAL0, PARENT_VAL1, STAGES

RUN000007_STEP10_DISP = 0.000329
RUN000008_STEP15_DISP = 0.000587


def _num(x: Any) -> float | None:
    try:
        if x is None:
            return None
        return float(x)
    except (TypeError, ValueError):
        return None


def _cap_pass(ev: dict[str, Any] | None) -> int:
    if not ev:
        return 0
    cap = ev.get("capability_validation") or {}
    return int(cap.get("PASS_COUNT") or 0)


def _cat_correct(ev: dict[str, Any] | None, key: str) -> int:
    cap = (ev or {}).get("capability_validation") or {}
    row = cap.get(key) or {}
    return int(row.get("correct") or 0)


def rank_score(ev: dict[str, Any]) -> tuple:
    cap_val = _cap_pass(ev)
    new_fail = int(ev.get("NEW_FAILURES_VS_PARENT") or 0)
    recovered = int(ev.get("RECOVERED_FAILURES_VS_PARENT") or 0)
    corr = ev.get("stage3_correctness") or {}
    stop_n = int(corr.get("STOPPING_CORRECT_COUNT") or 0)
    json_n = int(corr.get("JSON_CORRECT_COUNT") or 0)
    code_n = int(corr.get("CODE_CORRECT_COUNT") or 0)
    inst_n = int(corr.get("INSTRUCTION_CORRECT_COUNT") or 0)
    max_run = _num((ev.get("s3_inst_02") or {}).get("max_run_256")) or 999
    dnll = _num(ev.get("mean_wrim0_anchor_nll_delta")) or 9.0
    kl = _num(ev.get("mean_kl_wrim0_to_candidate")) or 9.0
    cap_hist = int(ev.get("historical_pass_count") or 0)
    tf = ((ev.get("teacher_forced") or {}).get("overall") or {})
    tf_nll = _num(tf.get("TARGET_SEQUENCE_AVG_NLL"))
    tf_rank = _num(tf.get("TARGET_FIRST_TOKEN_RANK"))
    disp = _num(((ev.get("parameter_displacement") or {}).get("total"))) or 0.0
    # higher tuple is better except we invert some via negatives
    return (
        cap_val,
        inst_n + json_n + code_n,
        stop_n,
        -new_fail,
        recovered,
        cap_hist,
        -max_run,
        -dnll,
        -kl,
        -(tf_nll if tf_nll is not None else 99.0),
        -(tf_rank if tf_rank is not None else 9999.0),
        -abs(disp),
    )


def select_best(evals: dict[str, dict[str, Any]]) -> dict[str, Any]:
    candidates = []
    for k, ev in evals.items():
        step = int(ev.get("step") if ev.get("step") is not None else k)
        if step == 0:
            continue
        candidates.append((rank_score(ev), step, ev))
    if not candidates:
        ev0 = evals.get("0") or evals.get(0)
        return {"step": 0, "reason": "no_trained_checkpoints", "eval": ev0}
    candidates.sort(key=lambda x: x[0], reverse=True)
    _score, step, ev = candidates[0]
    reasons = [
        f"held_out_capability={_cap_pass(ev)}",
        f"new_failures={ev.get('NEW_FAILURES_VS_PARENT')}",
        f"recovered={ev.get('RECOVERED_FAILURES_VS_PARENT')}",
        f"stage3_json={(ev.get('stage3_correctness') or {}).get('JSON_CORRECTNESS')}",
        f"stage3_code={(ev.get('stage3_correctness') or {}).get('CODE_CORRECTNESS')}",
        f"stage3_inst={(ev.get('stage3_correctness') or {}).get('INSTRUCTION_CORRECTNESS')}",
        f"dnll={ev.get('mean_wrim0_anchor_nll_delta')}",
        f"kl={ev.get('mean_kl_wrim0_to_candidate')}",
        f"cap={ev.get('historical_binary')}",
    ]
    return {"step": step, "reason": "; ".join(reasons), "eval": ev}


def traj(evals: dict[str, dict[str, Any]], getter) -> dict[str, Any]:
    out = {}
    for k in sorted(evals, key=lambda x: int(x)):
        out[str(k)] = getter(evals[k])
    return out


def stage_window(name: str) -> tuple[int, int]:
    for st in STAGES:
        if st["name"] == name:
            start = 0 if int(st["first_step"]) == 1 else int(st["first_step"]) - 1
            # compare last completed boundary at or before last_step vs prior boundary
            return start, int(st["last_step"])
    return 0, 0


def nearest_eval(evals: dict[str, dict[str, Any]], step: int) -> dict[str, Any] | None:
    if str(step) in evals:
        return evals[str(step)]
    keys = sorted(int(k) for k in evals)
    at_or_below = [k for k in keys if k <= step]
    if not at_or_below:
        return None
    return evals[str(at_or_below[-1])]


def stage_result(evals: dict[str, dict[str, Any]], start_step: int, end_step: int) -> dict[str, Any]:
    a = nearest_eval(evals, start_step)
    b = nearest_eval(evals, end_step)
    if not a or not b:
        return {"status": "INCONCLUSIVE", "reason": "missing_eval"}
    cats = ["INSTRUCTION_VALIDATION", "JSON_VALIDATION", "CODE_VALIDATION", "STOPPING_VALIDATION"]
    greedy = {c: {"start": _cat_correct(a, c), "end": _cat_correct(b, c)} for c in cats}
    greedy_gain = {c: greedy[c]["end"] - greedy[c]["start"] for c in cats}
    tf_a = ((a.get("teacher_forced") or {}).get("overall") or {})
    tf_b = ((b.get("teacher_forced") or {}).get("overall") or {})
    nll_a = _num(tf_a.get("TARGET_SEQUENCE_AVG_NLL"))
    nll_b = _num(tf_b.get("TARGET_SEQUENCE_AVG_NLL"))
    rank_a = _num(tf_a.get("TARGET_FIRST_TOKEN_RANK"))
    rank_b = _num(tf_b.get("TARGET_FIRST_TOKEN_RANK"))
    tf_improved = False
    if nll_a is not None and nll_b is not None and (nll_a - nll_b) >= 0.03:
        tf_improved = True
    if rank_a is not None and rank_b is not None and (rank_a - rank_b) >= 3:
        tf_improved = True
    greedy_any = any(v > 0 for v in greedy_gain.values())
    greedy_loss = any(v < 0 for v in greedy_gain.values())
    if greedy_any and not greedy_loss:
        status = "GAIN"
        support = "SUPPORTED"
    elif greedy_any and greedy_loss:
        status = "MIXED"
        support = "POSSIBLE"
    elif tf_improved:
        status = "TEACHER_FORCED_ONLY"
        support = "SUPPORTED"
    else:
        status = "NO_GREEDY_GAIN"
        support = "NOT_SUPPORTED"
    return {
        "status": status,
        "support": support,
        "greedy": greedy,
        "greedy_gain": greedy_gain,
        "teacher_forced_nll": {"start": nll_a, "end": nll_b},
        "teacher_forced_rank": {"start": rank_a, "end": rank_b},
        "start_step": a.get("step"),
        "end_step": b.get("step"),
    }


def diagnose(evals: dict[str, dict[str, Any]], metrics: list[dict[str, Any]], peak_passed: bool) -> dict[str, Any]:
    parent = evals.get("0") or {}
    last_key = max((int(k) for k in evals), default=0)
    last = evals.get(str(last_key)) or {}
    best = select_best(evals)
    best_ev = best.get("eval") or last
    parent_pass = _cap_pass(parent)
    best_pass = _cap_pass(best_ev)
    last_pass = _cap_pass(last)
    s3p = parent.get("stage3_correctness") or {}
    s3b = best_ev.get("stage3_correctness") or {}

    def s3gain(key: str) -> int:
        return int(s3b.get(key) or 0) - int(s3p.get(key) or 0)

    inst_gain = s3gain("INSTRUCTION_CORRECT_COUNT") or (_cat_correct(best_ev, "INSTRUCTION_VALIDATION") - _cat_correct(parent, "INSTRUCTION_VALIDATION"))
    json_gain = s3gain("JSON_CORRECT_COUNT") or (_cat_correct(best_ev, "JSON_VALIDATION") - _cat_correct(parent, "JSON_VALIDATION"))
    code_gain = s3gain("CODE_CORRECT_COUNT") or (_cat_correct(best_ev, "CODE_VALIDATION") - _cat_correct(parent, "CODE_VALIDATION"))
    stop_gain = s3gain("STOPPING_CORRECT_COUNT") or (_cat_correct(best_ev, "STOPPING_VALIDATION") - _cat_correct(parent, "STOPPING_VALIDATION"))
    greedy_gains = [g for g in (inst_gain, json_gain, code_gain, stop_gain, best_pass - parent_pass) if g > 0]
    new_fail = int(best_ev.get("NEW_FAILURES_VS_PARENT") or last.get("NEW_FAILURES_VS_PARENT") or 0)
    cap_txt = str(best_ev.get("historical_binary") or last.get("historical_binary") or "")
    dnll = _num(best_ev.get("mean_wrim0_anchor_nll_delta"))
    kl = _num(best_ev.get("mean_kl_wrim0_to_candidate"))
    retention_ok = (dnll is None or dnll < 0.105) and (kl is None or kl < 0.022)
    tf_delta = (best_ev.get("teacher_forced_delta") or last.get("teacher_forced_delta") or {})
    tf_moved = False
    substantial = False
    for key, spec in (
        ("TARGET_FIRST_TOKEN_PROBABILITY", False),
        ("TARGET_FIRST_TOKEN_RANK", True),
        ("TARGET_SEQUENCE_AVG_NLL", True),
        ("EOS_PROBABILITY_AT_CORRECT_STOP", False),
    ):
        row = tf_delta.get(key) or {}
        if row.get("improved"):
            tf_moved = True
            dlt = abs(_num(row.get("delta")) or 0.0)
            if key == "TARGET_FIRST_TOKEN_PROBABILITY" and dlt >= 0.01:
                substantial = True
            if key == "TARGET_FIRST_TOKEN_RANK" and dlt >= 5:
                substantial = True
            if key == "TARGET_SEQUENCE_AVG_NLL" and dlt >= 0.05:
                substantial = True
            if key == "EOS_PROBABILITY_AT_CORRECT_STOP" and dlt >= 0.02:
                substantial = True

    learning_signal = "INCONCLUSIVE"
    if best_pass == parent_pass == 0 and not tf_moved:
        learning_signal = "ACQUISITION_SIGNAL_INSUFFICIENT"
    elif best_pass == parent_pass == 0 and substantial:
        learning_signal = "LEARNING_SIGNAL_PRESENT_GREEDY_THRESHOLD_NOT_CROSSED"
    elif best_pass == parent_pass == 0 and tf_moved:
        learning_signal = "LEARNING_SIGNAL_PRESENT_GREEDY_THRESHOLD_NOT_CROSSED"
    elif last_pass < best_pass and peak_passed:
        learning_signal = "CURRICULUM_INTERFERENCE"
    elif (not retention_ok) and greedy_gains:
        learning_signal = "CAPABILITY_RETENTION_TRADEOFF"
    elif greedy_gains and retention_ok and new_fail == 0:
        learning_signal = "CAPABILITY_ACQUISITION_SUCCESS"
    elif tf_moved:
        learning_signal = "LEARNING_SIGNAL_PRESENT_GREEDY_THRESHOLD_NOT_CROSSED"

    multi_cat = sum(1 for g in (inst_gain, json_gain, code_gain, stop_gain) if g > 0) >= 2
    broad = best_pass >= 5
    protected_ok = new_fail == 0 and retention_ok and "6/6" in cap_txt
    if multi_cat or broad:
        if protected_ok:
            acquisition = "CAPABILITY_BREAKTHROUGH"
            disposition = "CAPABILITY_BREAKTHROUGH"
        else:
            acquisition = "CAPABILITY_RETENTION_TRADEOFF"
            disposition = "ROLLBACK_REJECT"
    elif greedy_gains or (tf_moved and substantial):
        acquisition = "EARLY_CAPABILITY_SIGNAL"
        disposition = "EARLY_CAPABILITY_SIGNAL"
    elif not retention_ok or new_fail > 0:
        acquisition = "NO_CAPABILITY_ACQUISITION"
        disposition = "ROLLBACK_REJECT"
    else:
        acquisition = "NO_CAPABILITY_ACQUISITION"
        disposition = "RETRAIN_REQUIRED"

    grads = [m.get("grad_norm") for m in metrics if m.get("grad_norm") is not None]
    finite_grads = [g for g in grads if _num(g) is not None]
    instability = "NOT_DETECTED"
    if any((_num(g) or 0) >= 50 for g in finite_grads):
        instability = "DETECTED"
    elif any((_num(g) or 0) >= 5 for g in finite_grads):
        instability = "INCONCLUSIVE"

    dnlls = [_num(ev.get("mean_wrim0_anchor_nll_delta")) for ev in evals.values()]
    forgetting = "NOT_DETECTED"
    if any(d is not None and d >= 0.105 for d in dnlls):
        forgetting = "DETECTED"
    elif any(d is not None and d >= 0.070 for d in dnlls):
        forgetting = "INCONCLUSIVE"

    losses = [m.get("loss") for m in metrics]
    val0s = [_num(ev.get("val_loss_corpus0")) for ev in evals.values()]
    overfitting = "INCONCLUSIVE"
    if losses and val0s and val0s[-1] is not None and losses[-1] is not None:
        if float(losses[-1]) + 0.15 < float(val0s[-1]) and (val0s[-1] or 0) > (val0s[0] or 0) + 0.05:
            overfitting = "POSSIBLE"
        else:
            overfitting = "NOT_DETECTED"

    data_bn = "POSSIBLE"
    opt_bn = "POSSIBLE"
    if learning_signal == "ACQUISITION_SIGNAL_INSUFFICIENT":
        data_bn = "POSSIBLE"
        opt_bn = "SUPPORTED"
    if learning_signal == "LEARNING_SIGNAL_PRESENT_GREEDY_THRESHOLD_NOT_CROSSED":
        opt_bn = "SUPPORTED"
        data_bn = "WEAK"
    if acquisition in {"CAPABILITY_BREAKTHROUGH", "EARLY_CAPABILITY_SIGNAL"}:
        data_bn = "NOT_SUPPORTED"
        opt_bn = "NOT_SUPPORTED"

    mode = stage_result(evals, 0, 10)
    structure = stage_result(evals, 10, 20)
    code = stage_result(evals, 20, 35)
    consol = stage_result(evals, 35, 50)
    interference = "DETECTED" if peak_passed or (best_pass > last_pass and last_pass < best_pass) else "NOT_DETECTED"
    if last_pass < best_pass:
        interference = "POSSIBLE" if not peak_passed else "DETECTED"

    tradeoff = "DETECTED" if (greedy_gains and not retention_ok) else "NOT_DETECTED"

    return {
        "best": best,
        "learning_signal": learning_signal,
        "acquisition": acquisition,
        "disposition": disposition,
        "MODE_ENTRY_STAGE_RESULT": mode,
        "STRUCTURE_STAGE_RESULT": structure,
        "CODE_STAGE_RESULT": code,
        "CONSOLIDATION_STAGE_RESULT": consol,
        "CURRICULUM_INTERFERENCE_STATUS": interference,
        "CAPABILITY_RETENTION_TRADEOFF": tradeoff,
        "DATA_BOTTLENECK_STATUS": data_bn,
        "OPTIMIZATION_BOTTLENECK_STATUS": opt_bn,
        "CATASTROPHIC_FORGETTING": forgetting,
        "OVERFITTING": overfitting,
        "INSTABILITY": instability,
        "greedy_gains": {
            "instruction": inst_gain,
            "json": json_gain,
            "code": code_gain,
            "stopping": stop_gain,
            "capability_validation": best_pass - parent_pass,
        },
        "protected_ok": protected_ok,
        "new_fail": new_fail,
        "dnll": dnll,
        "kl": kl,
        "teacher_forced_moved": tf_moved,
        "teacher_forced_substantial": substantial,
        "PARENT_VAL0": PARENT_VAL0,
        "PARENT_VAL1": PARENT_VAL1,
        "RUN000007_STEP10_DISP": RUN000007_STEP10_DISP,
        "RUN000008_STEP15_DISP": RUN000008_STEP15_DISP,
    }


def engineer_diagnosis(diag: dict[str, Any]) -> str:
    parts = []
    parts.append(f"Learning signal: {diag.get('learning_signal')}.")
    parts.append(f"Acquisition status: {diag.get('acquisition')}.")
    for name, key in (
        ("MODE ENTRY", "MODE_ENTRY_STAGE_RESULT"),
        ("STRUCTURE", "STRUCTURE_STAGE_RESULT"),
        ("CODE", "CODE_STAGE_RESULT"),
        ("CONSOLIDATION", "CONSOLIDATION_STAGE_RESULT"),
    ):
        st = diag.get(key) or {}
        parts.append(f"{name}: {st.get('status')} ({st.get('support')}); greedy_gain={st.get('greedy_gain')}.")
    parts.append(f"Curriculum interference: {diag.get('CURRICULUM_INTERFERENCE_STATUS')}.")
    parts.append(f"Retention tradeoff: {diag.get('CAPABILITY_RETENTION_TRADEOFF')}.")
    parts.append(f"Data bottleneck: {diag.get('DATA_BOTTLENECK_STATUS')}; optimization bottleneck: {diag.get('OPTIMIZATION_BOTTLENECK_STATUS')}.")
    return " ".join(parts)
