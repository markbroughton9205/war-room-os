"""Exact WRIM1-RUN-000005 P2 LR schedule.

1-indexed steps 1..1000. Does not train. Does not construct an optimizer.
"""
from __future__ import annotations

import argparse
import json
import math
from typing import Any

PEAK_LR = 1e-5
MIN_LR = 1e-6
WARMUP_STEPS = 25
TOTAL_STEPS = 1000
LR_ABS_TOL = 1e-15
FORMULA = (
    "1-indexed warmup-cosine: "
    "lr(step)=1e-5*step/25 for 1<=step<=25; "
    "progress=(step-25)/(1000-25); "
    "lr=1e-6+0.5*(1e-5-1e-6)*(1+cos(pi*progress)) for 25<step<=1000 "
    "(step 25 = 1e-5; step 1000 = 1e-6)"
)


def lr_p2(step: int) -> float:
    if not isinstance(step, int) or isinstance(step, bool) or step < 1 or step > TOTAL_STEPS:
        raise ValueError(f"P2 step must be int in 1..{TOTAL_STEPS}, got {step!r}")
    if 1 <= step <= WARMUP_STEPS:
        return PEAK_LR * step / WARMUP_STEPS
    progress = (step - WARMUP_STEPS) / (TOTAL_STEPS - WARMUP_STEPS)
    return MIN_LR + 0.5 * (PEAK_LR - MIN_LR) * (1.0 + math.cos(math.pi * progress))


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= LR_ABS_TOL


def self_test() -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str) -> None:
        checks.append({"name": name, "ok": ok, "detail": detail})

    a1 = lr_p2(1)
    a5 = lr_p2(5)
    a10 = lr_p2(10)
    a25 = lr_p2(25)
    a26 = lr_p2(26)
    a50 = lr_p2(50)
    a100 = lr_p2(100)
    a500 = lr_p2(500)
    a1000 = lr_p2(1000)
    warmup = [lr_p2(s) for s in range(1, WARMUP_STEPS + 1)]
    add("step1_warmup", _close(a1, PEAK_LR / WARMUP_STEPS), f"{a1}")
    add("step5", _close(a5, PEAK_LR * 5 / WARMUP_STEPS), f"{a5}")
    add("step10", _close(a10, PEAK_LR * 10 / WARMUP_STEPS), f"{a10}")
    add("step25_peak", _close(a25, PEAK_LR), f"{a25}")
    add("step26_below_peak", a26 < PEAK_LR, f"{a26}")
    add("step1000_min", _close(a1000, MIN_LR), f"{a1000}")
    add("warmup_monotonic", all(warmup[i] < warmup[i + 1] for i in range(len(warmup) - 1)), "1..25")
    add("never_above_peak", all(lr_p2(s) <= PEAK_LR + 1e-18 for s in range(1, TOTAL_STEPS + 1)), "cap")
    add("not_2e-5", PEAK_LR < 2e-5 - 1e-18, str(PEAK_LR))
    add("not_3e-5", PEAK_LR < 3e-5 - 1e-18, str(PEAK_LR))
    add("min_is_peak_over_10", _close(MIN_LR, PEAK_LR / 10.0), str(MIN_LR))
    add("early_evals_nonzero", a5 > 0 and a10 > 0 and a25 == PEAK_LR, f"5={a5} 10={a10}")
    table = {
        "1": a1,
        "5": a5,
        "10": a10,
        "25": a25,
        "26": a26,
        "50": a50,
        "100": a100,
        "500": a500,
        "1000": a1000,
    }
    failed = [c for c in checks if not c["ok"]]
    return {
        "ok": len(failed) == 0,
        "passed": sum(1 for c in checks if c["ok"]),
        "failed": failed,
        "checks": checks,
        "table": table,
        "formula": FORMULA,
        "peak_lr": PEAK_LR,
        "min_lr": MIN_LR,
        "warmup_steps": WARMUP_STEPS,
        "total_steps": TOTAL_STEPS,
        "warmup_fraction": WARMUP_STEPS / TOTAL_STEPS,
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--json", action="store_true")
    args = p.parse_args()
    out = self_test()
    if args.json:
        print(json.dumps(out, indent=2))
    else:
        print(f"ok={out['ok']} passed={out['passed']} formula={out['formula']}")
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
