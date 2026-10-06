"""WRIM1-RUN-000010 post-training diagnosis and commander report. Does not train."""
from __future__ import annotations

from typing import Any

from run000010_identity import PARENT_VAL0, PARENT_VAL1

RUN000007_STEP10_DISP = 0.000329
RUN000008_STEP15_DISP = 0.000587
RUN000009_STEP15_DISP = 0.001018


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


def _me_pass(ev: dict[str, Any] | None) -> int:
    if not ev:
        return 0
    me = ev.get("mode_entry_validation") or {}
    return int(me.get("PASS_COUNT") or 0)


def _cat_correct(ev: dict[str, Any] | None, block: str, key: str) -> int:
    row = ((ev or {}).get(block) or {}).get(key) or {}
    return int(row.get("correct") or 0)


def rank_score(ev: dict[str, Any]) -> tuple:
    inst_n = _cat_correct(ev, "capability_validation", "INSTRUCTION_VALIDATION")
    stop_n = _cat_correct(ev, "capability_validation", "STOPPING_VALIDATION")
    me_n = _me_pass(ev)
    me_inst = _cat_correct(ev, "mode_entry_validation", "INSTRUCTION_VALIDATION")
    me_stop = _cat_correct(ev, "mode_entry_validation", "STOPPING_VALIDATION")
    new_fail = int(ev.get("NEW_FAILURES_VS_PARENT") or 0)
    basins = ev.get("basin_counts") or {}
    attractor = int(basins.get("COLON_UNDERSCORE_ATTRACTOR") or 0) + int(basins.get("REPETITION_LOOP") or 0)
    max_run = _num(ev.get("S3_INST_02_MAX_RUN_256")) or 999
    tf = ((ev.get("teacher_forced_mode_entry") or ev.get("teacher_forced") or {}).get("instruction_stopping") or ((ev.get("teacher_forced") or {}).get("overall") or {}))
    eos = _num(tf.get("EOS_PROBABILITY_AT_CORRECT_STOP")) or 0.0
    tf_rank = _num(tf.get("TARGET_FIRST_TOKEN_RANK")) or 9999.0
    tf_nll = _num(tf.get("TARGET_SEQUENCE_AVG_NLL")) or 99.0
    dnll = _num(ev.get("mean_wrim0_anchor_nll_delta")) or 9.0
    kl = _num(ev.get("mean_kl_wrim0_to_candidate")) or 9.0
    cap_hist = int(ev.get("historical_pass_count") or 0)
    disp = _num(((ev.get("parameter_displacement") or {}).get("total"))) or 0.0
    val0 = _num(ev.get("val_loss_corpus0")) or 99.0
    return (
        inst_n,
        stop_n,
        me_n,
        me_inst + me_stop,
        -new_fail,
        -max_run,
        -attractor,
        eos,
        -tf_rank,
        -tf_nll,
        cap_hist,
        -dnll,
        -kl,
        -abs(disp),
        -val0,
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
        f"instruction_greedy={_cat_correct(ev, 'capability_validation', 'INSTRUCTION_VALIDATION')}",
        f"stopping_greedy={_cat_correct(ev, 'capability_validation', 'STOPPING_VALIDATION')}",
        f"mode_entry={_me_pass(ev)}",
        f"new_failures={ev.get('NEW_FAILURES_VS_PARENT')}",
        f"s3_inst_02_max_run={ev.get('S3_INST_02_MAX_RUN_256')}",
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


def diagnose(evals: dict[str, dict[str, Any]], metrics: list[dict[str, Any]], peak_passed: bool) -> dict[str, Any]:
    parent = evals.get("0") or {}
    last_key = max((int(k) for k in evals), default=0)
    last = evals.get(str(last_key)) or {}
    best = select_best(evals)
    best_ev = best.get("eval") or last
    parent_inst = _cat_correct(parent, "capability_validation", "INSTRUCTION_VALIDATION")
    parent_stop = _cat_correct(parent, "capability_validation", "STOPPING_VALIDATION")
    best_inst = _cat_correct(best_ev, "capability_validation", "INSTRUCTION_VALIDATION")
    best_stop = _cat_correct(best_ev, "capability_validation", "STOPPING_VALIDATION")
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
    tf_delta = (best_ev.get("teacher_forced_delta") or last.get("teacher_forced_delta") or {})
    tf_moved = False
    substantial = False
    for key, lower_better in (
        ("TARGET_FIRST_TOKEN_PROBABILITY", False),
        ("TARGET_FIRST_TOKEN_RANK", True),
        ("TARGET_SEQUENCE_AVG_NLL", True),
        ("EOS_PROBABILITY_AT_CORRECT_STOP", False),
        ("TARGET_STOP_TOKEN_RANK", True),
    ):
        row = tf_delta.get(key) or {}
        if row.get("improved"):
            tf_moved = True
            dlt = abs(_num(row.get("delta")) or 0.0)
            if key == "TARGET_FIRST_TOKEN_PROBABILITY" and dlt >= 0.01:
                substantial = True
            if key == "TARGET_FIRST_TOKEN_RANK" and dlt >= 20:
                substantial = True
            if key == "TARGET_SEQUENCE_AVG_NLL" and dlt >= 0.05:
                substantial = True
            if key == "EOS_PROBABILITY_AT_CORRECT_STOP" and dlt >= 0.02:
                substantial = True
            if key == "TARGET_STOP_TOKEN_RANK" and dlt >= 20:
                substantial = True

    parent_basin = parent.get("basin_counts") or {}
    best_basin = best_ev.get("basin_counts") or {}
    attractor_drop = int(parent_basin.get("COLON_UNDERSCORE_ATTRACTOR") or 0) - int(best_basin.get("COLON_UNDERSCORE_ATTRACTOR") or 0)
    chatter_drop = (
        int(parent_basin.get("LITERARY_CONTINUATION") or 0)
        + int(parent_basin.get("TOKENIZER_CHATTER") or 0)
        - int(best_basin.get("LITERARY_CONTINUATION") or 0)
        - int(best_basin.get("TOKENIZER_CHATTER") or 0)
    )
    max_run = _num(best_ev.get("S3_INST_02_MAX_RUN_256"))
    parent_run = _num(parent.get("S3_INST_02_MAX_RUN_256"))
    attractor_reentry = bool(max_run is not None and max_run >= 85)
    hash137 = False
    hashes = []
    for ev in evals.values():
        h = str(ev.get("S3_INST_02_GENERATION_HASH") or "")
        hashes.append(h)
        if int(ev.get("S3_INST_02_MAX_RUN_256") or 0) >= 137:
            hash137 = True

    protected_ok = new_fail == 0 and retention_ok and "6/6" in cap_txt
    greedy_gain = inst_gain > 0 or stop_gain > 0 or me_gain > 0
    greedy_nonzero_me = best_me > 0

    if attractor_reentry or hash137:
        signal = "ATTRACTOR_REENTRY"
        disposition = "ROLLBACK_REJECT"
        mode_result = "ATTRACTOR_REENTRY"
        stop_result = "ATTRACTOR_REENTRY"
    elif greedy_gain and greedy_nonzero_me and protected_ok:
        signal = "MODE_ENTRY_BREAKTHROUGH"
        disposition = "MODE_ENTRY_BREAKTHROUGH"
        mode_result = "GAIN"
        stop_result = "GAIN" if stop_gain > 0 else "UNCHANGED"
    elif greedy_gain and protected_ok:
        signal = "EARLY_MODE_ENTRY_SIGNAL"
        disposition = "EARLY_MODE_ENTRY_SIGNAL"
        mode_result = "GAIN" if (inst_gain > 0 or me_gain > 0) else "UNCHANGED"
        stop_result = "GAIN" if stop_gain > 0 else "UNCHANGED"
    elif not retention_ok or new_fail > 0:
        signal = "CAPABILITY_RETENTION_TRADEOFF"
        disposition = "ROLLBACK_REJECT"
        mode_result = "TRADEOFF"
        stop_result = "TRADEOFF"
    elif tf_moved and substantial:
        signal = "TEACHER_FORCED_SIGNAL_ONLY"
        disposition = "TEACHER_FORCED_SIGNAL_ONLY"
        mode_result = "TEACHER_FORCED_ONLY"
        stop_result = "TEACHER_FORCED_ONLY"
    elif tf_moved:
        signal = "TEACHER_FORCED_SIGNAL_ONLY"
        disposition = "TEACHER_FORCED_SIGNAL_ONLY"
        mode_result = "TEACHER_FORCED_ONLY"
        stop_result = "TEACHER_FORCED_ONLY"
    else:
        signal = "NO_ACQUISITION_SIGNAL"
        disposition = "RETRAIN_REQUIRED"
        mode_result = "NO_GAIN"
        stop_result = "NO_GAIN"

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

    disp = _num(((best_ev.get("parameter_displacement") or {}).get("total")))
    meaningful_disp = disp is not None and disp >= 0.0002
    tf_flat = not tf_moved
    greedy_flat = not greedy_gain
    plateau = bool(tf_flat and greedy_flat and meaningful_disp and protected_ok and not attractor_reentry)
    if plateau:
        disposition = "PLATEAU_REVIEW_REQUIRED"

    greedy_threshold = "CROSSED" if greedy_gain else "NOT_CROSSED"
    if tf_moved and not greedy_gain:
        greedy_threshold = "APPROACHING" if substantial else "NOT_CROSSED"
    attractor_status = "REENTRY" if attractor_reentry or hash137 else ("REDUCED" if attractor_drop > 0 or chatter_drop > 0 else "UNCHANGED")
    if max_run is not None and parent_run is not None and max_run > parent_run + 5:
        attractor_status = "WORSENED" if attractor_status != "REENTRY" else attractor_status
    retention_status = "INSIDE_LIMITS" if retention_ok else "EXCEEDED"
    tf_status = "SUBSTANTIAL" if substantial else ("PRESENT" if tf_moved else "FLAT")

    return {
        "best": best,
        "CAPABILITY_SIGNAL_CLASSIFICATION": signal,
        "disposition": disposition,
        "MODE_ENTRY_RESULT": mode_result,
        "STOPPING_RESULT": stop_result,
        "TEACHER_FORCED_SIGNAL_STATUS": tf_status,
        "GREEDY_THRESHOLD_STATUS": greedy_threshold,
        "ATTRACTOR_STATUS": attractor_status,
        "RETENTION_STATUS": retention_status,
        "CATASTROPHIC_FORGETTING": forgetting,
        "OVERFITTING": overfitting,
        "INSTABILITY": instability,
        "WRIM_CAPABILITY_PLATEAU_REVIEW_REQUIRED": "YES" if plateau else "NO",
        "TOKENIZER_REVIEW_REQUIRED": "YES" if plateau else "NO",
        "MODEL_CAPACITY_REVIEW_REQUIRED": "YES" if plateau else "NO",
        "ARCHITECTURE_REVIEW_REQUIRED": "YES" if plateau else "NO",
        "protected_ok": protected_ok,
        "new_fail": new_fail,
        "dnll": dnll,
        "kl": kl,
        "teacher_forced_moved": tf_moved,
        "teacher_forced_substantial": substantial,
        "instruction_gain": inst_gain,
        "stopping_gain": stop_gain,
        "mode_entry_gain": me_gain,
        "attractor_drop": attractor_drop,
        "chatter_drop": chatter_drop,
        "peak_passed": peak_passed,
        "PARENT_VAL0": PARENT_VAL0,
        "PARENT_VAL1": PARENT_VAL1,
        "RUN000007_STEP10_DISP": RUN000007_STEP10_DISP,
        "RUN000008_STEP15_DISP": RUN000008_STEP15_DISP,
        "RUN000009_STEP15_DISP": RUN000009_STEP15_DISP,
        "parameter_displacement": disp,
    }


def engineer_diagnosis(diag: dict[str, Any]) -> str:
    parts = [
        f"Capability signal: {diag.get('CAPABILITY_SIGNAL_CLASSIFICATION')}.",
        f"Mode-entry result: {diag.get('MODE_ENTRY_RESULT')}; stopping result: {diag.get('STOPPING_RESULT')}.",
        f"Teacher-forced: {diag.get('TEACHER_FORCED_SIGNAL_STATUS')}; greedy threshold: {diag.get('GREEDY_THRESHOLD_STATUS')}.",
        f"Attractor: {diag.get('ATTRACTOR_STATUS')}; retention: {diag.get('RETENTION_STATUS')}.",
        f"Instruction gain={diag.get('instruction_gain')}; stopping gain={diag.get('stopping_gain')}; mode-entry gain={diag.get('mode_entry_gain')}.",
        f"Plateau review required: {diag.get('WRIM_CAPABILITY_PLATEAU_REVIEW_REQUIRED')}.",
    ]
    return " ".join(parts)
