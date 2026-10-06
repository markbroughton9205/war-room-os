#!/usr/bin/env python3
"""Deterministic trainer-control validation. Fake optimizer only. Does not train WRIM."""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from wrim_trainer_hard_stop import (
    OptimizerStepRefused,
    TrainingGateDecision,
    TrainingState,
    check_resume_allowed,
    classify_infrastructure_failure,
    close_training,
    confirm_hard_failure,
    guard_optimizer_step,
    persist_stopped_by_gate,
    process_exit_code,
    record_optimizer_step,
)


class FakeOptimizer:
    def __init__(self) -> None:
        self.step_count = 0
        self.executed_steps: list[int] = []

    def step(self, state: TrainingState, training_step: int, tokens: int = 4096) -> None:
        record_optimizer_step(state, step=training_step, tokens_per_step=tokens)
        self.step_count += 1
        self.executed_steps.append(training_step)


def fire_at_50(step: int) -> TrainingGateDecision:
    status = "FIRE" if step >= 50 else "PASS"
    return TrainingGateDecision(
        gate="COLLAPSE_GATE+PARENT_REGRESSION_GATE",
        status=status,
        confirmed=False,
        severity="HARD",
        stopTraining=False,
        reason="synthetic_hard_gate" if status == "FIRE" else "ok",
        checkpointId=f"synthetic/step-{step}",
        step=step,
        newTokens=step * 4096,
        evidenceIds=["synthetic"],
        classification="MODEL_REGRESSION" if status == "FIRE" else "NONE",
    )


def run_loop(
    *,
    eval_at: set[int],
    eval_fn,
    interrupt_at: int | None = None,
    oom_at: int | None = None,
    authorized_steps: int = 196,
    lock: dict | None = None,
) -> tuple[TrainingState, FakeOptimizer, Path]:
    tmp = Path(tempfile.mkdtemp(prefix="wrim-hard-stop-"))
    state = TrainingState()
    opt = FakeOptimizer()
    pending: list[dict] = []
    lock_box = lock if lock is not None else {"held": True}

    def release() -> dict:
        lock_box["held"] = False
        return {"released": True}

    try:
        for step in range(1, authorized_steps + 1):
            if not guard_optimizer_step(state):
                break
            if oom_at is not None and step == oom_at:
                classify_infrastructure_failure(
                    state, kind="RESOURCE_FAILURE", step=step - 1, new_tokens=state.newTokens, reason="synthetic_OOM"
                )
                break
            try:
                opt.step(state, step)
            except OptimizerStepRefused:
                break
            pending.append({"step": step, "loss": 0.0})
            if interrupt_at is not None and step == interrupt_at:
                # ordinary interruption: no STOPPED_BY_GATE
                break
            if step in eval_at:
                try:
                    suspected = eval_fn(step)
                except Exception as exc:
                    classify_infrastructure_failure(
                        state,
                        kind="EVALUATOR_FAILURE",
                        step=step,
                        new_tokens=state.newTokens,
                        reason=f"EVALUATOR_FAILURE:{type(exc).__name__}:{exc}",
                        checkpoint_id=f"synthetic/step-{step}",
                    )
                    break
                if suspected.status == "ERROR":
                    classify_infrastructure_failure(
                        state,
                        kind=suspected.classification or "EVALUATOR_FAILURE",
                        step=step,
                        new_tokens=state.newTokens,
                        reason=suspected.reason,
                        checkpoint_id=suspected.checkpointId,
                    )
                    break
                if suspected.status == "FIRE" and suspected.severity == "HARD":
                    confirmed = confirm_hard_failure(state, suspected, lambda s=step: eval_fn(s))
                    if confirmed.stopTraining:
                        state.checkpointId = f"synthetic/step-{step}"
                        break
        close_training(
            state,
            run_root=tmp,
            lock_release=release,
            pending_metrics=pending,
            metrics_path=tmp / "metrics.jsonl",
        )
        return state, opt, tmp
    except Exception:
        close_training(state, run_root=tmp, lock_release=release, pending_metrics=pending, metrics_path=tmp / "metrics.jsonl")
        raise


def main() -> int:
    checks: list[dict] = []

    def add(name: str, ok: bool, detail=None) -> None:
        checks.append({"name": name, "ok": bool(ok), "detail": detail})

    # 16-18 confirmed hard gate: steps 1-49 PASS, 50 FIRE + confirm FIRE, no step 51
    state, opt, tmp = run_loop(eval_at={50}, eval_fn=fire_at_50)
    post = [s for s in opt.executed_steps if s > 50]
    add("confirmed_gate_optimizer_steps_eq_50", opt.step_count == 50, opt.step_count)
    add("POST_CONFIRMED_GATE_OPTIMIZER_STEP_COUNT_0", len(post) == 0, post)
    add("CONFIRMATION_RERUN_COUNT_1", state.confirmationRerunCount == 1, state.confirmationRerunCount)
    add("STOPPED_BY_GATE_STATE", state.stoppedByGate and (tmp / "STOPPED_BY_GATE.json").is_file())
    add("lock_released", state.lockReleased is True)
    add("metrics_flushed", state.metricsFlushed and (tmp / "metrics.jsonl").is_file())
    add("no_duplicate_steps", len(opt.executed_steps) == len(set(opt.executed_steps)))
    add("process_exit_2", process_exit_code(state, training_ok=True) == 2)
    shutil.rmtree(tmp, ignore_errors=True)

    # hard gate not confirmed → continue
    def pass_on_confirm(step: int) -> TrainingGateDecision:
        d = fire_at_50(step)
        if getattr(pass_on_confirm, "n", 0) == 0 and d.status == "FIRE":
            pass_on_confirm.n = 1
            return d
        return TrainingGateDecision(
            gate=d.gate, status="PASS", confirmed=False, severity="HARD", stopTraining=False,
            reason="not_confirmed", checkpointId=d.checkpointId, step=step, newTokens=d.newTokens,
            classification="NONE",
        )
    pass_on_confirm.n = 0
    state2, opt2, tmp2 = run_loop(eval_at={50}, eval_fn=pass_on_confirm, authorized_steps=60)
    add("unconfirmed_gate_continues", 51 in opt2.executed_steps and opt2.step_count == 60, opt2.executed_steps[-3:])
    add("unconfirmed_not_stopped_by_gate", state2.stoppedByGate is False)
    shutil.rmtree(tmp2, ignore_errors=True)

    # evaluator failure classification, fail-closed, not MODEL_REGRESSION
    def eval_error(step: int) -> TrainingGateDecision:
        raise RuntimeError("harness_corrupt")
    state3, opt3, tmp3 = run_loop(eval_at={10}, eval_fn=eval_error, authorized_steps=20)
    add("EVALUATOR_FAILURE_class", state3.classification == "EVALUATOR_FAILURE", state3.classification)
    add("evaluator_fail_closed_stop", state3.stopRequested is True)
    add("evaluator_not_model_regression", state3.classification != "MODEL_REGRESSION")
    add("evaluator_no_step_after_fail", max(opt3.executed_steps) == 10, opt3.executed_steps)
    shutil.rmtree(tmp3, ignore_errors=True)

    # resource failure
    state4, opt4, tmp4 = run_loop(eval_at=set(), eval_fn=fire_at_50, oom_at=7, authorized_steps=20)
    add("RESOURCE_FAILURE_class", state4.classification == "RESOURCE_FAILURE", state4.classification)
    add("resource_not_model_regression", state4.classification != "MODEL_REGRESSION")
    add("oom_no_step_7", 7 not in opt4.executed_steps, opt4.executed_steps)
    shutil.rmtree(tmp4, ignore_errors=True)

    # normal interruption resume (no STOPPED_BY_GATE)
    state5, opt5, tmp5 = run_loop(eval_at=set(), eval_fn=fire_at_50, interrupt_at=12, authorized_steps=40)
    add("ordinary_interrupt_no_stopped_by_gate", not (tmp5 / "STOPPED_BY_GATE.json").is_file())
    allow = check_resume_allowed(tmp5)
    add("ordinary_interrupt_resume_allowed", allow["ok"] is True)
    # simulate resume continuing
    state_r = TrainingState()
    opt_r = FakeOptimizer()
    for step in range(13, 16):
        opt_r.step(state_r, step)
    add("ordinary_resume_continues", opt_r.executed_steps == [13, 14, 15])
    shutil.rmtree(tmp5, ignore_errors=True)

    # STOPPED_BY_GATE resume protection
    tmp6 = Path(tempfile.mkdtemp(prefix="wrim-hard-stop-sg-"))
    st = TrainingState()
    d = fire_at_50(50)
    d.status = "FIRE"
    confirm_hard_failure(st, d, lambda: fire_at_50(50))
    persist_stopped_by_gate(tmp6, st)
    refuse = check_resume_allowed(tmp6)
    add("STOPPED_BY_GATE_resume_refused", refuse["ok"] is False and refuse.get("REFUSE_RESUME") is True)
    still = check_resume_allowed(tmp6, {"COMMANDER_RESUME_AFTER_HARD_STOP": True})
    add("override_without_new_auth_id_refused", still["ok"] is False)
    ok_new = check_resume_allowed(
        tmp6,
        {"COMMANDER_RESUME_AFTER_HARD_STOP": True, "NEW_TRAINING_AUTHORIZATION_ID": "MISSION_99_NEW"},
    )
    add("new_commander_auth_can_override", ok_new["ok"] is True)
    shutil.rmtree(tmp6, ignore_errors=True)

    # step 51 never executes even if driver asks to continue after stopRequested
    state7 = TrainingState()
    opt7 = FakeOptimizer()
    for step in range(1, 51):
        opt7.step(state7, step)
    confirm_hard_failure(state7, fire_at_50(50), lambda: fire_at_50(50))
    refused = False
    try:
        opt7.step(state7, 51)
    except OptimizerStepRefused:
        refused = True
    add("driver_cannot_force_step_51", refused and 51 not in opt7.executed_steps)

    ok = all(c["ok"] for c in checks)
    report = {
        "ok": ok,
        "kind": "WRIM_TRAINER_HARD_STOP_VALIDATOR",
        "REAL_OPTIMIZER_STEP_COUNT": 0,
        "WRIM_WEIGHT_MUTATION": False,
        "checks": checks,
        "failed": [c for c in checks if not c["ok"]],
    }
    out = Path("/home/chosenone/Codex/war-room-os/tmp/wrim-cpt-stop-repair")
    out.mkdir(parents=True, exist_ok=True)
    (out / "hard-stop-validator.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"ok": ok, "n": len(checks), "failed": report["failed"]}, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
