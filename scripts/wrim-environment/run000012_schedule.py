"""WRIM1-RUN-000012 LR schedule. Peak 4e-6. Freeze before optimizer construction."""
from __future__ import annotations

import math
from typing import Any

from run000012_identity import LR_HARD_CAP, MIN_LR, PEAK_LR, STEPS, WARMUP_STEPS

KNOTS = (
    (6, 4.0e-6),
    (15, 3.5e-6),
    (20, 2.75e-6),
    (25, 1.75e-6),
    (30, 1.0e-6),
)


def _cosine(start: float, end: float, progress: float) -> float:
    p = min(1.0, max(0.0, float(progress)))
    return end + 0.5 * (start - end) * (1.0 + math.cos(math.pi * p))


def lr_run000012(step: int) -> float:
    if not isinstance(step, int) or isinstance(step, bool) or step < 1 or step > STEPS:
        raise ValueError(f"RUN-000012 step must be int in 1..{STEPS}, got {step!r}")
    if 1 <= step <= WARMUP_STEPS:
        lr = PEAK_LR * step / WARMUP_STEPS
    else:
        lr = None
        for (s0, v0), (s1, v1) in zip(KNOTS, KNOTS[1:]):
            if step <= s1:
                lr = _cosine(v0, v1, (step - s0) / (s1 - s0))
                break
        if lr is None:
            lr = MIN_LR
    if lr > LR_HARD_CAP + 1e-18:
        raise ValueError(f"LR {lr} exceeds hard cap {LR_HARD_CAP}")
    return lr


def freeze_schedule() -> dict[str, float]:
    return {str(s): lr_run000012(s) for s in range(1, STEPS + 1)}


def _close(a: float, b: float, tol: float) -> bool:
    return abs(float(a) - float(b)) <= tol


def self_test() -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"id": name, "ok": bool(ok), "detail": detail})

    table = {s: lr_run000012(s) for s in range(1, STEPS + 1)}
    add("step1", _close(table[1], PEAK_LR / 6, 1e-12), str(table[1]))
    add("step6_peak", _close(table[6], PEAK_LR, 1e-12), str(table[6]))
    add("step15", _close(table[15], 3.5e-6, 1e-18), str(table[15]))
    add("step20", _close(table[20], 2.75e-6, 1e-18), str(table[20]))
    add("step25", _close(table[25], 1.75e-6, 1e-18), str(table[25]))
    add("step30_final", _close(table[30], MIN_LR, 1e-12), str(table[30]))
    add("never_above_hard_cap", all(v <= LR_HARD_CAP + 1e-18 for v in table.values()), str(max(table.values())))
    add("never_above_4e-6", all(v <= 4e-6 + 1e-18 for v in table.values()), str(max(table.values())))
    warmup = [table[s] for s in range(1, 7)]
    add("warmup_monotonic", all(warmup[i] < warmup[i + 1] for i in range(len(warmup) - 1)), "1..6")
    decay = [table[s] for s in range(6, 31)]
    add("decay_nonincreasing", all(decay[i] >= decay[i + 1] - 1e-18 for i in range(len(decay) - 1)), "6..30")
    try:
        lr_run000012(31)
        add("no_step_31", False, "should reject")
    except ValueError:
        add("no_step_31", True, "rejected")
    failed = [c for c in checks if not c["ok"]]
    return {
        "ok": len(failed) == 0,
        "passed": len(checks) - len(failed),
        "failed": len(failed),
        "checks": checks,
        "table": table,
        "FROZEN_LR_TABLE": {str(s): table[s] for s in range(1, STEPS + 1)},
    }
