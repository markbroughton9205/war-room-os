"""WRIM1-RUN-000011 diagnosis and combined resilience report. Does not train."""
from __future__ import annotations

from typing import Any

from run000010_report import PARENT_VAL0, PARENT_VAL1, _cap_pass, _cat_correct, _me_pass, _num, traj
from run000011_identity import OLD_TRAINER_PROVENANCE_HASH


def rank_score(ev: dict[str, Any]) -> tuple:
    me_n = _me_pass(ev)
    me_inst = _cat_correct(ev, "mode_entry_validation", "INSTRUCTION_VALIDATION")
    me_stop = _cat_correct(ev, "mode_entry_validation", "STOPPING_VALIDATION")
    inst_n = _cat_correct(ev, "capability_validation", "INSTRUCTION_VALIDATION")
    stop_n = _cat_correct(ev, "capability_validation", "STOPPING_VALIDATION")
    new_fail = int(ev.get("NEW_FAILURES_VS_PARENT") or 0)
    basins = ev.get("basin_counts") or {}
    attractor = int(basins.get("COLON_UNDERSCORE_ATTRACTOR") or 0) + int(basins.get("REPETITION_LOOP") or 0)
    max_run = _num(ev.get("S3_INST_02_MAX_RUN_256")) or 999
    rd = ev.get("rank_diagnostics") or {}
    topk = rd.get("TARGET_TOPK") or ((ev.get("teacher_forced_mode_entry") or {}).get("instruction_stopping") or {}).get("TARGET_TOPK") or {}
    top1 = int(topk.get("TARGET_IN_TOP_1") or 0)
    top5 = int(topk.get("TARGET_IN_TOP_5") or 0)
    top10 = int(topk.get("TARGET_IN_TOP_10") or 0)
    top50 = int(topk.get("TARGET_IN_TOP_50") or 0)
    top100 = int(topk.get("TARGET_IN_TOP_100") or 0)
    top500 = int(topk.get("TARGET_IN_TOP_500") or 0)
    margin = _num(((rd.get("TARGET_LOGIT_MARGIN_STATS") or {}).get("mean"))) or -99.0
    tf = ((ev.get("teacher_forced_mode_entry") or {}).get("instruction_stopping") or ((ev.get("teacher_forced") or {}).get("overall") or {}))
    eos = _num(tf.get("EOS_PROBABILITY_AT_CORRECT_STOP")) or 0.0
    tf_rank = _num(tf.get("TARGET_FIRST_TOKEN_RANK")) or 9999.0
    tf_nll = _num(tf.get("TARGET_SEQUENCE_AVG_NLL")) or 99.0
    dnll = _num(ev.get("mean_wrim0_anchor_nll_delta")) or 9.0
    kl = _num(ev.get("mean_kl_wrim0_to_candidate")) or 9.0
    cap_hist = int(ev.get("historical_pass_count") or 0)
    grad = _num(ev.get("grad_norm")) or 0.0
    return (
        me_n,
        me_inst,
        inst_n,
        me_stop,
        stop_n,
        -new_fail,
        -max_run,
        -attractor,
        top1,
        top5,
        top10,
        top50,
        top100,
        top500,
        margin,
        eos,
        -tf_rank,
        -tf_nll,
        -dnll,
        -kl,
        cap_hist,
        -abs(grad) if grad >= 5 else 0.0,
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
    rd = ev.get("rank_diagnostics") or {}
    topk = rd.get("TARGET_TOPK") or {}
    reasons = [
        f"mode_entry_greedy={_me_pass(ev)}",
        f"instruction_greedy={_cat_correct(ev, 'mode_entry_validation', 'INSTRUCTION_VALIDATION')}",
        f"stopping_greedy={_cat_correct(ev, 'mode_entry_validation', 'STOPPING_VALIDATION')}",
        f"new_failures={ev.get('NEW_FAILURES_VS_PARENT')}",
        f"s3_inst_02_max_run={ev.get('S3_INST_02_MAX_RUN_256')}",
        f"top10={topk.get('TARGET_IN_TOP_10')}",
        f"top100={topk.get('TARGET_IN_TOP_100')}",
        f"dnll={ev.get('mean_wrim0_anchor_nll_delta')}",
        f"kl={ev.get('mean_kl_wrim0_to_candidate')}",
        f"cap={ev.get('historical_binary')}",
    ]
    return {"step": step, "reason": "; ".join(reasons), "eval": ev}


def _topk(ev: dict[str, Any], key: str) -> int | None:
    rd = ev.get("rank_diagnostics") or {}
    topk = rd.get("TARGET_TOPK") or ((ev.get("teacher_forced_mode_entry") or {}).get("instruction_stopping") or {}).get("TARGET_TOPK") or {}
    v = topk.get(key)
    return int(v) if v is not None else None


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

    max_run = _num(best_ev.get("S3_INST_02_MAX_RUN_256"))
    parent_run = _num(parent.get("S3_INST_02_MAX_RUN_256"))
    attractor_reentry = bool(max_run is not None and max_run >= 85)
    hash137 = any(int(ev.get("S3_INST_02_MAX_RUN_256") or 0) >= 137 for ev in evals.values())
    parent_basin = parent.get("basin_counts") or {}
    best_basin = best_ev.get("basin_counts") or {}
    attractor_drop = int(parent_basin.get("COLON_UNDERSCORE_ATTRACTOR") or 0) - int(best_basin.get("COLON_UNDERSCORE_ATTRACTOR") or 0)

    protected_ok = new_fail == 0 and retention_ok and "6/6" in cap_txt
    greedy_gain = inst_gain > 0 or stop_gain > 0 or me_gain > 0
    greedy_nonzero_me = best_me > 0
    top10 = _topk(best_ev, "TARGET_IN_TOP_10") or 0
    top50 = _topk(best_ev, "TARGET_IN_TOP_50") or 0
    top100 = _topk(best_ev, "TARGET_IN_TOP_100") or 0
    buckets = (best_ev.get("rank_diagnostics") or {}).get("TARGET_FIRST_TOKEN_RANK_BUCKETS") or {}
    n_inst = int(buckets.get("n") or 0) or 1
    gt1000 = int(buckets.get("rank_gt_1000") or 0)
    far = (gt1000 / n_inst) >= 0.90 and top100 == 0

    if attractor_reentry or hash137:
        signal = "ATTRACTOR_REENTRY"
        disposition = "ATTRACTOR_REENTRY"
    elif greedy_nonzero_me and protected_ok:
        signal = "MODE_ENTRY_BREAKTHROUGH"
        disposition = "MODE_ENTRY_BREAKTHROUGH"
    elif greedy_gain and protected_ok:
        signal = "MODE_ENTRY_BREAKTHROUGH" if greedy_nonzero_me else "STRONG_PRE_GREEDY_SIGNAL"
        disposition = signal
    elif not greedy_gain and (top10 > 0 or top50 > 0 or top100 > 0) and protected_ok:
        signal = "STRONG_PRE_GREEDY_SIGNAL"
        disposition = "STRONG_PRE_GREEDY_SIGNAL"
    elif not greedy_gain and tf_moved and far:
        signal = "WEAK_DISTRIBUTED_SIGNAL"
        disposition = "WEAK_DISTRIBUTED_SIGNAL"
    elif not retention_ok or new_fail > 0:
        signal = "ROLLBACK_REJECT"
        disposition = "ROLLBACK_REJECT"
    elif tf_moved:
        signal = "TEACHER_FORCED_SIGNAL_ONLY"
        disposition = "TEACHER_FORCED_SIGNAL_ONLY"
    else:
        signal = "PLATEAU_REVIEW_REQUIRED"
        disposition = "PLATEAU_REVIEW_REQUIRED"

    completed_40 = last_key >= 40
    plateau_rule = bool(
        completed_40
        and best_me == 0
        and inst_gain <= 0
        and stop_gain <= 0
        and far
        and not attractor_reentry
    )
    if plateau_rule:
        signal = "PLATEAU_REVIEW_REQUIRED"
        disposition = "PLATEAU_REVIEW_REQUIRED"

    grads = [m.get("grad_norm") for m in metrics if m.get("grad_norm") is not None]
    finite_grads = [g for g in grads if _num(g) is not None]
    instability = "NOT_DETECTED"
    if any((_num(g) or 0) >= 50 for g in finite_grads):
        instability = "DETECTED"
    elif any((_num(g) or 0) >= 5 for g in finite_grads):
        instability = "INCONCLUSIVE"

    greedy_threshold = "CROSSED" if greedy_gain else "NOT_CROSSED"
    if (top100 > 0 or top50 > 0 or top10 > 0) and not greedy_gain:
        greedy_threshold = "APPROACHING"
    attractor_status = "REENTRY" if attractor_reentry or hash137 else ("REDUCED" if attractor_drop > 0 else "UNCHANGED")
    if max_run is not None and parent_run is not None and max_run > parent_run + 5 and attractor_status != "REENTRY":
        attractor_status = "WORSENED"
    retention_status = "INSIDE_LIMITS" if retention_ok else "EXCEEDED"
    tf_status = "SUBSTANTIAL" if substantial else ("PRESENT" if tf_moved else "FLAT")

    return {
        "best": best,
        "CAPABILITY_SIGNAL_CLASSIFICATION": signal,
        "disposition": disposition,
        "MODE_ENTRY_RESULT": "GAIN" if me_gain > 0 else "UNCHANGED",
        "STOPPING_RESULT": "GAIN" if stop_gain > 0 else "UNCHANGED",
        "TEACHER_FORCED_SIGNAL_STATUS": tf_status,
        "GREEDY_THRESHOLD_STATUS": greedy_threshold,
        "ATTRACTOR_STATUS": attractor_status,
        "RETENTION_STATUS": retention_status,
        "INSTABILITY": instability,
        "WRIM_CAPABILITY_PLATEAU_REVIEW_REQUIRED": "YES" if plateau_rule or disposition == "PLATEAU_REVIEW_REQUIRED" else "NO",
        "TOKENIZER_REVIEW_REQUIRED": "YES" if plateau_rule else "NO",
        "MODEL_CAPACITY_REVIEW_REQUIRED": "YES" if plateau_rule else "NO",
        "ARCHITECTURE_REVIEW_REQUIRED": "YES" if plateau_rule else "NO",
        "protected_ok": protected_ok,
        "new_fail": new_fail,
        "dnll": dnll,
        "kl": kl,
        "teacher_forced_moved": tf_moved,
        "instruction_gain": inst_gain,
        "stopping_gain": stop_gain,
        "mode_entry_gain": me_gain,
        "top10": top10,
        "top50": top50,
        "top100": top100,
        "far_from_topk": far,
        "peak_passed": peak_passed,
        "PARENT_VAL0": PARENT_VAL0,
        "PARENT_VAL1": PARENT_VAL1,
        "OLD_TRAINER_PROVENANCE_HASH": OLD_TRAINER_PROVENANCE_HASH,
    }


def engineer_diagnosis(diag: dict[str, Any]) -> str:
    parts = [
        f"Capability signal: {diag.get('CAPABILITY_SIGNAL_CLASSIFICATION')}.",
        f"Disposition: {diag.get('disposition')}.",
        f"Mode-entry greedy gain={diag.get('mode_entry_gain')}; instruction gain={diag.get('instruction_gain')}; stopping gain={diag.get('stopping_gain')}.",
        f"Teacher-forced: {diag.get('TEACHER_FORCED_SIGNAL_STATUS')}; greedy threshold: {diag.get('GREEDY_THRESHOLD_STATUS')}.",
        f"Top-k instruction targets: top10={diag.get('top10')} top50={diag.get('top50')} top100={diag.get('top100')}.",
        f"Attractor: {diag.get('ATTRACTOR_STATUS')}; retention: {diag.get('RETENTION_STATUS')}.",
        f"Plateau review required: {diag.get('WRIM_CAPABILITY_PLATEAU_REVIEW_REQUIRED')}.",
    ]
    return " ".join(parts)
