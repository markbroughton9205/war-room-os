"""Hard-stop training-control contract for WRIM optimizer runs.

Does not construct a real WRIM optimizer. Does not train WRIM weights.
A confirmed hard gate must terminate optimizer progression; status fields alone are not enough.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

STOPPED_BY_GATE_FILENAME = "STOPPED_BY_GATE.json"
MAX_CONFIRMATION_RERUNS = 1


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class TrainingGateDecision:
    gate: str
    status: str  # PASS | FIRE | ERROR
    confirmed: bool
    severity: str  # HARD | SOFT
    stopTraining: bool
    reason: str
    checkpointId: str | None
    step: int
    newTokens: int
    evidenceIds: list[str] = field(default_factory=list)
    classification: str = "NONE"  # MODEL_REGRESSION | EVALUATOR_FAILURE | RESOURCE_FAILURE | ENVIRONMENT_FAILURE | TRAINING_INSTABILITY | NONE

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class TrainingState:
    stopRequested: bool = False
    stoppedByGate: bool = False
    stopReason: str | None = None
    confirmationRerunCount: int = 0
    optimizerStepCount: int = 0
    lastDecision: TrainingGateDecision | None = None
    lockReleased: bool = False
    metricsFlushed: bool = False
    classification: str | None = None
    lastCompletedStep: int = 0
    newTokens: int = 0
    checkpointId: str | None = None


class OptimizerStepRefused(RuntimeError):
    pass


def guard_optimizer_step(state: TrainingState) -> bool:
    """Immediately before every optimizer step."""
    return state.stopRequested is False


def record_optimizer_step(state: TrainingState, *, step: int, tokens_per_step: int) -> None:
    if not guard_optimizer_step(state):
        raise OptimizerStepRefused(
            f"OPTIMIZER_STEP_REFUSED_STOP_REQUESTED step={step} reason={state.stopReason}"
        )
    state.optimizerStepCount += 1
    state.lastCompletedStep = step
    state.newTokens += int(tokens_per_step)


def apply_hard_stop(
    state: TrainingState,
    decision: TrainingGateDecision,
) -> TrainingGateDecision:
    decision.stopTraining = True
    decision.severity = "HARD"
    state.stopRequested = True
    state.stoppedByGate = True
    state.stopReason = decision.reason
    state.classification = decision.classification
    state.lastDecision = decision
    state.checkpointId = decision.checkpointId
    return decision


def confirm_hard_failure(
    state: TrainingState,
    suspected: TrainingGateDecision,
    rerun: Callable[[], TrainingGateDecision],
    *,
    max_confirmations: int = MAX_CONFIRMATION_RERUNS,
) -> TrainingGateDecision:
    """Pause optimizer. Rerun evaluation once. Confirmed FIRE => stopTraining=true.

    Optimizer progression is already paused: caller must not step between suspected and return.
    """
    if suspected.severity != "HARD" or suspected.status != "FIRE":
        suspected.confirmed = False
        suspected.stopTraining = False
        state.lastDecision = suspected
        return suspected
    if state.confirmationRerunCount >= max_confirmations:
        suspected.reason = "CONFIRMATION_BUDGET_EXHAUSTED_FAIL_CLOSED"
        suspected.classification = suspected.classification or "MODEL_REGRESSION"
        return apply_hard_stop(state, suspected)
    state.confirmationRerunCount += 1
    try:
        second = rerun()
    except Exception as exc:
        err = TrainingGateDecision(
            gate=suspected.gate,
            status="ERROR",
            confirmed=True,
            severity="HARD",
            stopTraining=True,
            reason=f"EVALUATOR_FAILURE:{type(exc).__name__}:{exc}",
            checkpointId=suspected.checkpointId,
            step=suspected.step,
            newTokens=suspected.newTokens,
            evidenceIds=list(suspected.evidenceIds) + ["confirmation_exception"],
            classification="EVALUATOR_FAILURE",
        )
        return apply_hard_stop(state, err)
    if second.status == "ERROR":
        second.confirmed = True
        second.severity = "HARD"
        second.classification = second.classification or "EVALUATOR_FAILURE"
        return apply_hard_stop(state, second)
    if second.status == "FIRE":
        second.confirmed = True
        second.severity = "HARD"
        second.classification = second.classification or suspected.classification or "MODEL_REGRESSION"
        second.reason = second.reason or suspected.reason
        return apply_hard_stop(state, second)
    # not confirmed — continue within authorization
    second.confirmed = False
    second.stopTraining = False
    state.lastDecision = second
    return second


def classify_infrastructure_failure(
    state: TrainingState,
    *,
    kind: str,
    step: int,
    new_tokens: int,
    reason: str,
    checkpoint_id: str | None = None,
) -> TrainingGateDecision:
    """OOM / environment interruption is not model regression. Fail-closed."""
    decision = TrainingGateDecision(
        gate="INFRASTRUCTURE",
        status="ERROR",
        confirmed=True,
        severity="HARD",
        stopTraining=True,
        reason=reason,
        checkpointId=checkpoint_id,
        step=step,
        newTokens=new_tokens,
        evidenceIds=[kind],
        classification=kind,
    )
    return apply_hard_stop(state, decision)


def persist_stopped_by_gate(run_root: Path, state: TrainingState) -> Path:
    run_root.mkdir(parents=True, exist_ok=True)
    payload = {
        "kind": "STOPPED_BY_GATE",
        "STOPPED_BY_GATE": True,
        "gate": state.lastDecision.gate if state.lastDecision else None,
        "step": state.lastCompletedStep,
        "newTokens": state.newTokens,
        "checkpoint": state.checkpointId,
        "confirmationRerunCount": state.confirmationRerunCount,
        "confirmationResult": state.lastDecision.to_dict() if state.lastDecision else None,
        "classification": state.classification,
        "stopReason": state.stopReason,
        "RESUME_WITHOUT_NEW_AUTHORIZATION": False,
        "created_at": utc_now(),
    }
    path = run_root / STOPPED_BY_GATE_FILENAME
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def check_resume_allowed(
    run_root: Path,
    expected_identity: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """STOPPED_BY_GATE runs require a new Commander authorization id, distinct from the original."""
    stop_path = Path(run_root) / STOPPED_BY_GATE_FILENAME
    if not stop_path.is_file():
        return {"ok": True, "STOPPED_BY_GATE": False}
    rec = json.loads(stop_path.read_text(encoding="utf-8"))
    override = (expected_identity or {}).get("COMMANDER_RESUME_AFTER_HARD_STOP")
    new_auth = (expected_identity or {}).get("NEW_TRAINING_AUTHORIZATION_ID")
    original = rec.get("stopReason")
    if override is True and new_auth and new_auth != rec.get("originalAuthorizationId"):
        return {"ok": True, "STOPPED_BY_GATE": True, "override": True, "NEW_TRAINING_AUTHORIZATION_ID": new_auth}
    return {
        "ok": False,
        "reason": "STOPPED_BY_GATE",
        "REFUSE_RESUME": True,
        "detail": "Run marked STOPPED_BY_GATE. New explicit Commander authorization required.",
        "record": rec,
        "original_stop": original,
    }


def flush_metrics(metrics_path: Path, rows: list[dict[str, Any]]) -> None:
    metrics_path.parent.mkdir(parents=True, exist_ok=True)
    with metrics_path.open("a", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row) + "\n")


def close_training(
    state: TrainingState,
    *,
    run_root: Path | None,
    lock_release: Callable[[], Any] | None,
    pending_metrics: list[dict[str, Any]] | None = None,
    metrics_path: Path | None = None,
) -> dict[str, Any]:
    if pending_metrics and metrics_path is not None:
        flush_metrics(metrics_path, pending_metrics)
        state.metricsFlushed = True
    elif pending_metrics is not None:
        state.metricsFlushed = True
    if state.stoppedByGate and run_root is not None:
        persist_stopped_by_gate(run_root, state)
    released = None
    if lock_release is not None:
        released = lock_release()
        state.lockReleased = True
    else:
        state.lockReleased = True
    return {
        "stopRequested": state.stopRequested,
        "stoppedByGate": state.stoppedByGate,
        "optimizerStepCount": state.optimizerStepCount,
        "confirmationRerunCount": state.confirmationRerunCount,
        "lockReleased": state.lockReleased,
        "metricsFlushed": state.metricsFlushed,
        "classification": state.classification,
        "lock_release": released,
    }


def process_exit_code(state: TrainingState, *, training_ok: bool) -> int:
    """Hard stop is a completed controlled stop, not a silent success that drivers may resume.

    Exit 2 = STOPPED_BY_GATE (do not auto-resume).
    Exit 0 = authorized slice completed without hard gate.
    Exit 1 = failure.
    """
    if state.stoppedByGate or state.stopRequested:
        return 2
    return 0 if training_ok else 1
