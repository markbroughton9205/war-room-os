"""WRIM1-RUN-000004 STAGE3A corrective pilot LR schedule.

1-indexed steps 1–25. Does not train. Does not construct an optimizer.
"""
from __future__ import annotations

import argparse
import json
import math
from typing import Any

PEAK_LR = 1e-5
MIN_LR = 1e-6
WARMUP_STEPS = 8
STEPS = 25
LR_ABS_TOL = 1e-15


def lr_corrective(step: int) -> float:
    if not isinstance(step, int) or isinstance(step, bool) or step < 1 or step > STEPS:
        raise ValueError(f"corrective step must be int in 1..25, got {step!r}")
    if 1 <= step <= WARMUP_STEPS:
        return PEAK_LR * step / WARMUP_STEPS
    progress = (step - WARMUP_STEPS) / (STEPS - WARMUP_STEPS)
    return MIN_LR + 0.5 * (PEAK_LR - MIN_LR) * (1.0 + math.cos(math.pi * progress))


def _close(a: float, b: float, tol: float = LR_ABS_TOL) -> bool:
    return abs(float(a) - float(b)) <= tol


def run_schedule_unit_tests() -> dict[str, Any]:
    checks = []

    def add(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"id": name, "ok": bool(ok), "detail": detail})

    a1 = lr_corrective(1)
    a8 = lr_corrective(8)
    a9 = lr_corrective(9)
    a25 = lr_corrective(25)
    warmup = [lr_corrective(s) for s in range(1, 9)]
    decay = [lr_corrective(s) for s in range(8, 26)]
    add("step1", _close(a1, PEAK_LR / WARMUP_STEPS), f"{a1}")
    add("step8_peak", _close(a8, PEAK_LR), f"{a8}")
    add("step9_below_peak", a9 < PEAK_LR, f"{a9}")
    add("step25_min", _close(a25, MIN_LR), f"{a25}")
    add("warmup_up", all(warmup[i] < warmup[i + 1] for i in range(len(warmup) - 1)), "1..8")
    add("decay_down", all(decay[i] >= decay[i + 1] - 1e-18 for i in range(len(decay) - 1)), "8..25")
    add("no_above_peak", all(lr_corrective(s) <= PEAK_LR + 1e-18 for s in range(1, 26)), "cap")
    add("not_2e-5", PEAK_LR < 2e-5 - 1e-18, str(PEAK_LR))
    failed = [c for c in checks if not c["ok"]]
    return {
        "ok": len(failed) == 0,
        "passed": len(checks) - len(failed),
        "failed": len(failed),
        "checks": checks,
        "table": [{"step": s, "lr": lr_corrective(s)} for s in range(1, STEPS + 1)],
        "formula": {
            "warmup": "lr(step)=1e-5*step/8 for 1<=step<=8",
            "cosine": "progress=(step-8)/17; lr=1e-6+0.5*(1e-5-1e-6)*(1+cos(pi*progress)) for 8<step<=25",
            "peak_lr": PEAK_LR,
            "min_lr": MIN_LR,
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
