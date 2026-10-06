"""WRIM1-RUN-000009 LR schedule. Freeze before optimizer construction."""
from __future__ import annotations

import math
from typing import Any

from run000009_identity import LR_HARD_CAP, MIN_LR, PEAK_LR, STEPS, WARMUP_STEPS


def lr_run000009(step: int) -> float:
    if not isinstance(step, int) or isinstance(step, bool) or step < 1 or step > STEPS:
        raise ValueError(f"RUN-000009 step must be int in 1..{STEPS}, got {step!r}")
    if 1 <= step <= WARMUP_STEPS:
        lr = PEAK_LR * step / WARMUP_STEPS
    else:
        progress = (step - WARMUP_STEPS) / (STEPS - WARMUP_STEPS)
        lr = MIN_LR + 0.5 * (PEAK_LR - MIN_LR) * (1.0 + math.cos(math.pi * progress))
    if lr > LR_HARD_CAP + 1e-18:
        raise ValueError(f"LR {lr} exceeds hard cap {LR_HARD_CAP}")
    return lr


def freeze_schedule() -> dict[str, float]:
    return {str(s): lr_run000009(s) for s in range(1, STEPS + 1)}


def schedule_table() -> list[dict[str, float | int]]:
    return [{"step": s, "lr": lr_run000009(s)} for s in range(1, STEPS + 1)]


def _close(a: float, b: float, tol: float = 4e-7) -> bool:
    return abs(float(a) - float(b)) <= tol


def self_test() -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"id": name, "ok": bool(ok), "detail": detail})

    table = {s: lr_run000009(s) for s in range(1, STEPS + 1)}
    add("step1", _close(table[1], PEAK_LR / 8, 1e-12), str(table[1]))
    add("step8_peak", _close(table[8], PEAK_LR, 1e-12), str(table[8]))
    add("step20_near_6e-6", _close(table[20], 6e-6, 5e-7), str(table[20]))
    add("step35_near_3e-6", _close(table[35], 3e-6, 5e-7), str(table[35]))
    add("step50_final", _close(table[50], MIN_LR, 1e-12), str(table[50]))
    add("never_above_hard_cap", all(v <= LR_HARD_CAP + 1e-18 for v in table.values()), str(max(table.values())))
    add("never_above_peak", all(v <= PEAK_LR + 1e-18 for v in table.values()), "cap")
    warmup = [table[s] for s in range(1, 9)]
    add("warmup_monotonic", all(warmup[i] < warmup[i + 1] for i in range(len(warmup) - 1)), "1..8")
    decay = [table[s] for s in range(8, 51)]
    add("decay_monotonic", all(decay[i] >= decay[i + 1] - 1e-18 for i in range(len(decay) - 1)), "8..50")
    try:
        lr_run000009(51)
        add("no_step_51", False, "should reject")
    except ValueError:
        add("no_step_51", True, "rejected")
    failed = [c for c in checks if not c["ok"]]
    return {"ok": len(failed) == 0, "passed": len(checks) - len(failed), "failed": len(failed), "checks": checks, "table": table}
