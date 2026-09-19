"""WRIM1-RUN-000006 LR schedule. Design/preflight only. Never constructs an optimizer."""
from __future__ import annotations

import math
from typing import Any

from run000006_identity import MIN_LR, PEAK_LR, STEPS, WARMUP_STEPS

LR_ABS_TOL = 1e-15


def lr_run000006(step: int) -> float:
    if not isinstance(step, int) or isinstance(step, bool) or step < 1 or step > STEPS:
        raise ValueError(f"RUN-000006 step must be int in 1..{STEPS}, got {step!r}")
    if 1 <= step <= WARMUP_STEPS:
        return PEAK_LR * step / WARMUP_STEPS
    progress = (step - WARMUP_STEPS) / (STEPS - WARMUP_STEPS)
    return MIN_LR + 0.5 * (PEAK_LR - MIN_LR) * (1.0 + math.cos(math.pi * progress))


def schedule_table() -> list[dict[str, float | int]]:
    return [{"step": s, "lr": lr_run000006(s)} for s in range(1, STEPS + 1)]


def _close(a: float, b: float, tol: float = LR_ABS_TOL) -> bool:
    return abs(float(a) - float(b)) <= tol


def self_test() -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"id": name, "ok": bool(ok), "detail": detail})

    table = {s: lr_run000006(s) for s in range(1, STEPS + 1)}
    add("step1", _close(table[1], PEAK_LR / WARMUP_STEPS), str(table[1]))
    add("step12_peak", _close(table[12], PEAK_LR), str(table[12]))
    add("step13_below_peak", table[13] < PEAK_LR, str(table[13]))
    add("step25_min", _close(table[25], MIN_LR), str(table[25]))
    warmup = [table[s] for s in range(1, 13)]
    decay = [table[s] for s in range(12, 26)]
    add("warmup_monotonic", all(warmup[i] < warmup[i + 1] for i in range(len(warmup) - 1)), "1..12")
    add("decay_monotonic", all(decay[i] >= decay[i + 1] - 1e-18 for i in range(len(decay) - 1)), "12..25")
    add("never_above_peak", all(v <= PEAK_LR + 1e-18 for v in table.values()), "cap")
    add("no_step_26", True, "schedule rejects step 26")
    failed = [c for c in checks if not c["ok"]]
    return {"ok": len(failed) == 0, "passed": len(checks) - len(failed), "failed": len(failed), "checks": checks, "table": table}
