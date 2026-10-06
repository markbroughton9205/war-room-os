"""WRIM1-RUN-000007 LR schedule. Design/preflight only. Never constructs an optimizer."""
from __future__ import annotations

import math
from typing import Any

from run000007_identity import MIN_LR, PEAK_LR, STEPS, WARMUP_STEPS

LR_ABS_TOL = 1e-15
EXPECTED = {
    1: 8.333333333333334e-7,
    2: 1.6666666666666669e-6,
    3: 2.5e-6,
    4: 3.3333333333333337e-6,
    5: 4.166666666666667e-6,
    6: 5.0e-6,
    7: 4.414213562373096e-6,
    8: 3.0e-6,
    9: 1.5857864376269051e-6,
    10: 1.0e-6,
}


def lr_run000007(step: int) -> float:
    if not isinstance(step, int) or isinstance(step, bool) or step < 1 or step > STEPS:
        raise ValueError(f"RUN-000007 step must be int in 1..{STEPS}, got {step!r}")
    if 1 <= step <= WARMUP_STEPS:
        return PEAK_LR * step / WARMUP_STEPS
    progress = (step - WARMUP_STEPS) / (STEPS - WARMUP_STEPS)
    return MIN_LR + 0.5 * (PEAK_LR - MIN_LR) * (1.0 + math.cos(math.pi * progress))


def schedule_table() -> list[dict[str, float | int]]:
    return [{"step": s, "lr": lr_run000007(s)} for s in range(1, STEPS + 1)]


def _close(a: float, b: float, tol: float = 1e-12) -> bool:
    return abs(float(a) - float(b)) <= tol


def self_test() -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"id": name, "ok": bool(ok), "detail": detail})

    table = {s: lr_run000007(s) for s in range(1, STEPS + 1)}
    for s, expected in EXPECTED.items():
        add(f"step{s}", _close(table[s], expected), str(table[s]))
    add("never_above_peak", all(v <= PEAK_LR + 1e-18 for v in table.values()), "cap")
    add("below_run000006_step10_lr", all(v < 8.333333333333334e-6 for v in table.values()), "stay under 8.33e-6")
    warmup = [table[s] for s in range(1, 7)]
    decay = [table[s] for s in range(6, 11)]
    add("warmup_monotonic", all(warmup[i] < warmup[i + 1] for i in range(len(warmup) - 1)), "1..6")
    add("decay_monotonic", all(decay[i] >= decay[i + 1] - 1e-18 for i in range(len(decay) - 1)), "6..10")
    try:
        lr_run000007(11)
        add("no_step_11", False, "should reject")
    except ValueError:
        add("no_step_11", True, "rejected")
    failed = [c for c in checks if not c["ok"]]
    return {"ok": len(failed) == 0, "passed": len(checks) - len(failed), "failed": len(failed), "checks": checks, "table": table}
