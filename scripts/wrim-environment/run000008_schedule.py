"""WRIM1-RUN-000008 LR schedule. Freeze before optimizer construction."""
from __future__ import annotations

import math
from typing import Any

from run000008_identity import MIN_LR, PEAK_LR, STEPS, WARMUP_STEPS

LR_ABS_TOL = 1e-15


def lr_run000008(step: int) -> float:
    if not isinstance(step, int) or isinstance(step, bool) or step < 1 or step > STEPS:
        raise ValueError(f"RUN-000008 step must be int in 1..{STEPS}, got {step!r}")
    if 1 <= step <= WARMUP_STEPS:
        return PEAK_LR * step / WARMUP_STEPS
    progress = (step - WARMUP_STEPS) / (STEPS - WARMUP_STEPS)
    return MIN_LR + 0.5 * (PEAK_LR - MIN_LR) * (1.0 + math.cos(math.pi * progress))


def schedule_table() -> list[dict[str, float | int]]:
    return [{"step": s, "lr": lr_run000008(s)} for s in range(1, STEPS + 1)]


def freeze_schedule() -> dict[str, float]:
    return {str(s): lr_run000008(s) for s in range(1, STEPS + 1)}


def _close(a: float, b: float, tol: float = 1e-12) -> bool:
    return abs(float(a) - float(b)) <= tol


def self_test() -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"id": name, "ok": bool(ok), "detail": detail})

    table = {s: lr_run000008(s) for s in range(1, STEPS + 1)}
    add("step1", _close(table[1], PEAK_LR / 6), str(table[1]))
    add("step6_peak", _close(table[6], PEAK_LR), str(table[6]))
    add("step20_final", _close(table[20], MIN_LR), str(table[20]))
    add("never_above_peak", all(v <= PEAK_LR + 1e-18 for v in table.values()), "cap")
    add("never_1e-5", all(v < 1e-5 for v in table.values()), "stay under 1e-5")
    warmup = [table[s] for s in range(1, 7)]
    decay = [table[s] for s in range(6, 21)]
    add("warmup_monotonic", all(warmup[i] < warmup[i + 1] for i in range(len(warmup) - 1)), "1..6")
    add("decay_monotonic", all(decay[i] >= decay[i + 1] - 1e-18 for i in range(len(decay) - 1)), "6..20")
    try:
        lr_run000008(21)
        add("no_step_21", False, "should reject")
    except ValueError:
        add("no_step_21", True, "rejected")
    failed = [c for c in checks if not c["ok"]]
    return {"ok": len(failed) == 0, "passed": len(checks) - len(failed), "failed": len(failed), "checks": checks, "table": table}
