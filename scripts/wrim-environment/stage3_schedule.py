"""Exact WRIM1-RUN-000003 LR schedules.

STAGE3A is 1-indexed steps 1–50.
STAGE3B is 1-indexed global steps 51–250 and is DESIGN ONLY until Commander authorization.
This module never trains and never constructs an optimizer.
"""
from __future__ import annotations

import argparse
import json
import math
from typing import Any

PEAK_LR = 2e-5
STAGE3A_MIN_LR = 2e-6
STAGE3A_WARMUP_STEPS = 25
STAGE3A_STEPS = 50
STAGE3B_STEPS = 200
STAGE3B_START_STEP = 51
STAGE3B_END_STEP = 250
STAGE3B_START_LR = 2e-6
STAGE3B_MIN_LR = 2e-7
LR_ABS_TOL = 1e-15


def lr_stage3a(step: int) -> float:
    """Official STAGE3A LR. 1-indexed. step in [1, 50]."""
    if not isinstance(step, int) or isinstance(step, bool) or step < 1 or step > STAGE3A_STEPS:
        raise ValueError(f"STAGE3A step must be int in 1..50, got {step!r}")
    if 1 <= step <= STAGE3A_WARMUP_STEPS:
        return PEAK_LR * step / STAGE3A_WARMUP_STEPS
    progress = (step - STAGE3A_WARMUP_STEPS) / STAGE3A_WARMUP_STEPS
    return STAGE3A_MIN_LR + 0.5 * (PEAK_LR - STAGE3A_MIN_LR) * (1.0 + math.cos(math.pi * progress))


def lr_stage3b(step: int) -> float:
    """Official STAGE3B cosine continuation. 1-indexed global step in [51, 250].

    No warmup. No LR reset. No return to peak.
    """
    if not isinstance(step, int) or isinstance(step, bool) or step < STAGE3B_START_STEP or step > STAGE3B_END_STEP:
        raise ValueError(f"STAGE3B step must be int in 51..250, got {step!r}")
    progress = (step - 50) / STAGE3B_STEPS
    return STAGE3B_MIN_LR + 0.5 * (STAGE3B_START_LR - STAGE3B_MIN_LR) * (1.0 + math.cos(math.pi * progress))


def lr_stage3b_conceptual_boundary_step50() -> float:
    """Plug global step 50 into the STAGE3B formula (progress=0). Must equal 2e-6."""
    progress = 0.0
    return STAGE3B_MIN_LR + 0.5 * (STAGE3B_START_LR - STAGE3B_MIN_LR) * (1.0 + math.cos(math.pi * progress))


def stage3a_table() -> list[dict[str, float | int]]:
    return [{"step": s, "lr": lr_stage3a(s)} for s in range(1, STAGE3A_STEPS + 1)]


def stage3b_table() -> list[dict[str, float | int]]:
    return [{"step": s, "lr": lr_stage3b(s)} for s in range(STAGE3B_START_STEP, STAGE3B_END_STEP + 1)]


def _close(a: float, b: float, tol: float = LR_ABS_TOL) -> bool:
    return abs(float(a) - float(b)) <= tol


def run_schedule_unit_tests() -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"id": name, "ok": bool(ok), "detail": detail})

    a1 = lr_stage3a(1)
    a25 = lr_stage3a(25)
    a26 = lr_stage3a(26)
    a50 = lr_stage3a(50)
    warmup = [lr_stage3a(s) for s in range(1, 26)]
    decay = [lr_stage3a(s) for s in range(25, 51)]
    add("a_step1_warmup", _close(a1, PEAK_LR / 25), f"{a1}")
    add("a_step25_peak", _close(a25, PEAK_LR), f"{a25}")
    add("a_step26_below_peak", a26 < PEAK_LR and not _close(a26, PEAK_LR, 1e-18), f"{a26}")
    add("a_step50_min", _close(a50, STAGE3A_MIN_LR), f"{a50}")
    add("a_warmup_monotonic", all(warmup[i] < warmup[i + 1] for i in range(len(warmup) - 1)), "warmup 1..25")
    add("a_decay_monotonic", all(decay[i] >= decay[i + 1] - 1e-18 for i in range(len(decay) - 1)), "decay 25..50")
    add("a_no_above_peak", all(lr_stage3a(s) <= PEAK_LR + 1e-18 for s in range(1, 51)), "cap")

    b50 = lr_stage3b_conceptual_boundary_step50()
    b51 = lr_stage3b(51)
    b250 = lr_stage3b(250)
    b_all = [lr_stage3b(s) for s in range(51, 251)]
    add("b_boundary_step50", _close(b50, STAGE3B_START_LR), f"{b50}")
    add("b_step51_le_start", b51 <= STAGE3B_START_LR + 1e-18, f"{b51}")
    add("b_step51_below_or_equal_defined", b51 < STAGE3B_START_LR or _close(b51, STAGE3B_START_LR), f"{b51}")
    add("b_step250_min", _close(b250, STAGE3B_MIN_LR), f"{b250}")
    add("b_no_warmup", b51 <= STAGE3B_START_LR + 1e-18 and b_all[0] == b51, "no warmup")
    add("b_no_increase", all(b_all[i] >= b_all[i + 1] - 1e-18 for i in range(len(b_all) - 1)), "monotonic down")
    add("b_no_peak_reset", all(x <= STAGE3B_START_LR + 1e-18 for x in b_all) and max(b_all) < PEAK_LR, "no peak")
    add("b_length_200", len(b_all) == 200, str(len(b_all)))

    failed = [c for c in checks if not c["ok"]]
    return {
        "ok": len(failed) == 0,
        "passed": len(checks) - len(failed),
        "failed": len(failed),
        "checks": checks,
        "stage3a": {
            "step_1": a1,
            "step_25": a25,
            "step_26": a26,
            "step_50": a50,
            "formula": {
                "warmup": "lr(step)=peak_lr*step/25 for 1<=step<=25",
                "cosine": "progress=(step-25)/25; lr=min_lr+0.5*(peak_lr-min_lr)*(1+cos(pi*progress)) for 25<step<=50",
                "peak_lr": PEAK_LR,
                "min_lr": STAGE3A_MIN_LR,
            },
        },
        "stage3b": {
            "conceptual_step_50": b50,
            "step_51": b51,
            "step_250": b250,
            "formula": {
                "progress": "(s-50)/200",
                "lr": "stage3b_min_lr+0.5*(stage3b_start_lr-stage3b_min_lr)*(1+cos(pi*progress))",
                "start_lr": STAGE3B_START_LR,
                "min_lr": STAGE3B_MIN_LR,
                "range": "51<=s<=250",
                "no_warmup": True,
                "no_lr_reset": True,
                "no_return_to_peak": True,
                "status": "FROZEN_FOR_REVIEW",
                "authorized": False,
            },
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    out = run_schedule_unit_tests()
    print(json.dumps(out, indent=2))
    if args.self_test and not out["ok"]:
        return 1
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
