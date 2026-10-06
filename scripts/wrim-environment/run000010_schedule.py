"""WRIM1-RUN-000010 LR schedule. Freeze before optimizer construction."""
from __future__ import annotations

import math
from typing import Any

from run000010_identity import LR_HARD_CAP, MIN_LR, PEAK_LR, PLATEAU_END, STEPS, WARMUP_STEPS


def _cosine(start: float, end: float, progress: float) -> float:
    p = min(1.0, max(0.0, float(progress)))
    return end + 0.5 * (start - end) * (1.0 + math.cos(math.pi * p))


def lr_run000010(step: int) -> float:
    if not isinstance(step, int) or isinstance(step, bool) or step < 1 or step > STEPS:
        raise ValueError(f"RUN-000010 step must be int in 1..{STEPS}, got {step!r}")
    if 1 <= step <= WARMUP_STEPS:
        lr = PEAK_LR * step / WARMUP_STEPS
    elif WARMUP_STEPS < step <= PLATEAU_END:
        lr = PEAK_LR
    elif PLATEAU_END < step <= 25:
        lr = _cosine(PEAK_LR, 3e-6, (step - PLATEAU_END) / (25 - PLATEAU_END))
    elif 25 < step <= 35:
        lr = _cosine(3e-6, 1.5e-6, (step - 25) / 10)
    else:
        lr = _cosine(1.5e-6, MIN_LR, (step - 35) / (STEPS - 35))
    if lr > LR_HARD_CAP + 1e-18:
        raise ValueError(f"LR {lr} exceeds hard cap {LR_HARD_CAP}")
    return lr


def freeze_schedule() -> dict[str, float]:
    return {str(s): lr_run000010(s) for s in range(1, STEPS + 1)}


def _close(a: float, b: float, tol: float) -> bool:
    return abs(float(a) - float(b)) <= tol


def self_test() -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"id": name, "ok": bool(ok), "detail": detail})

    table = {s: lr_run000010(s) for s in range(1, STEPS + 1)}
    add("step1", _close(table[1], PEAK_LR / 6, 1e-12), str(table[1]))
    add("step6_peak", _close(table[6], PEAK_LR, 1e-12), str(table[6]))
    add("step15_plateau", _close(table[15], PEAK_LR, 1e-12), str(table[15]))
    add("step25_near_3e-6", _close(table[25], 3e-6, 2e-7), str(table[25]))
    add("step35_near_1.5e-6", _close(table[35], 1.5e-6, 2e-7), str(table[35]))
    add("step40_final", _close(table[40], MIN_LR, 1e-12), str(table[40]))
    add("never_above_hard_cap", all(v <= LR_HARD_CAP + 1e-18 for v in table.values()), str(max(table.values())))
    warmup = [table[s] for s in range(1, 7)]
    add("warmup_monotonic", all(warmup[i] < warmup[i + 1] for i in range(len(warmup) - 1)), "1..6")
    plateau = [table[s] for s in range(6, 16)]
    add("plateau_flat", all(_close(v, PEAK_LR, 1e-18) for v in plateau), "6..15")
    decay = [table[s] for s in range(15, 41)]
    add("decay_nonincreasing", all(decay[i] >= decay[i + 1] - 1e-18 for i in range(len(decay) - 1)), "15..40")
    try:
        lr_run000010(41)
        add("no_step_41", False, "should reject")
    except ValueError:
        add("no_step_41", True, "rejected")
    failed = [c for c in checks if not c["ok"]]
    return {"ok": len(failed) == 0, "passed": len(checks) - len(failed), "failed": len(failed), "checks": checks, "table": table}
