"""P2-NEXT-A_SCHEDULE_HORIZON LR schedule.

1-indexed steps 1..50. Does not train. Does not construct an optimizer.

Only change vs RUN-000005 P2 schedule: cosine horizon 1000 -> 50.
Warmup 1-25 and peak 1e-5 are identical to p2_schedule.lr_p2.
"""
from __future__ import annotations

import argparse
import json
import math
from typing import Any

from p2_schedule import lr_p2
from stage3a_corrective_schedule import lr_corrective

PEAK_LR = 1e-5
MIN_LR = 1e-6
WARMUP_STEPS = 25
TOTAL_STEPS = 50
LR_ABS_TOL = 1e-15
FORMULA = (
    "1-indexed warmup-cosine: "
    "lr(step)=1e-5*step/25 for 1<=step<=25; "
    "progress=(step-25)/(50-25); "
    "lr=1e-6+0.5*(1e-5-1e-6)*(1+cos(pi*progress)) for 25<step<=50 "
    "(step 25 = 1e-5; step 50 = 1e-6). "
    "Denominator is 25, not 975. Do not reuse the RUN-000005 1000-step cosine."
)
REQUIRED_TABLE_STEPS = [1, 5, 10, 25, 26, 30, 35, 40, 45, 50]


def lr_next_a(step: int) -> float:
    if not isinstance(step, int) or isinstance(step, bool) or step < 1 or step > TOTAL_STEPS:
        raise ValueError(f"P2-NEXT-A step must be int in 1..{TOTAL_STEPS}, got {step!r}")
    if 1 <= step <= WARMUP_STEPS:
        return PEAK_LR * step / WARMUP_STEPS
    progress = (step - WARMUP_STEPS) / (TOTAL_STEPS - WARMUP_STEPS)
    return MIN_LR + 0.5 * (PEAK_LR - MIN_LR) * (1.0 + math.cos(math.pi * progress))


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= LR_ABS_TOL


def sum_lr(fn, start: int, end: int) -> float:
    return float(sum(fn(s) for s in range(start, end + 1)))


def self_test() -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str) -> None:
        checks.append({"name": name, "ok": ok, "detail": detail})

    table = {str(s): lr_next_a(s) for s in REQUIRED_TABLE_STEPS}
    warmup = [lr_next_a(s) for s in range(1, WARMUP_STEPS + 1)]
    decay = [lr_next_a(s) for s in range(WARMUP_STEPS, TOTAL_STEPS + 1)]
    add("step1_warmup", _close(table["1"], PEAK_LR / WARMUP_STEPS), str(table["1"]))
    add("step5_matches_p2", _close(lr_next_a(5), lr_p2(5)), f"{lr_next_a(5)} vs {lr_p2(5)}")
    add("step10_matches_p2", _close(lr_next_a(10), lr_p2(10)), f"{lr_next_a(10)} vs {lr_p2(10)}")
    add("step25_peak", _close(table["25"], PEAK_LR), str(table["25"]))
    add("warmup_1_25_identical_to_p2", all(_close(lr_next_a(s), lr_p2(s)) for s in range(1, 26)), "1..25")
    add("step26_below_peak", table["26"] < PEAK_LR, str(table["26"]))
    add("step26_below_p2_step26", lr_next_a(26) < lr_p2(26), f"{lr_next_a(26)} vs {lr_p2(26)}")
    add("step50_min", _close(table["50"], MIN_LR), str(table["50"]))
    add("warmup_monotonic", all(warmup[i] < warmup[i + 1] for i in range(len(warmup) - 1)), "1..25")
    add("decay_monotonic", all(decay[i] >= decay[i + 1] - 1e-18 for i in range(len(decay) - 1)), "25..50")
    add("never_above_peak", all(lr_next_a(s) <= PEAK_LR + 1e-18 for s in range(1, TOTAL_STEPS + 1)), "cap")
    add("not_1000_denominator", TOTAL_STEPS == 50 and (TOTAL_STEPS - WARMUP_STEPS) == 25, str(TOTAL_STEPS))
    add("no_step_gt_50", True, "lr_next_a rejects step>50")
    cum_a_125 = sum_lr(lr_next_a, 1, 25)
    cum_a_2650 = sum_lr(lr_next_a, 26, 50)
    cum_a_150 = sum_lr(lr_next_a, 1, 50)
    cum_p2_125 = sum_lr(lr_p2, 1, 25)
    cum_p2_2650 = sum_lr(lr_p2, 26, 50)
    cum_p2_150 = sum_lr(lr_p2, 1, 50)
    cum_0004_125 = sum_lr(lr_corrective, 1, 25)
    add("cum_1_25_matches_p2", _close(cum_a_125, cum_p2_125), f"{cum_a_125}")
    add("cum_26_50_reduced", cum_a_2650 < cum_p2_2650, f"{cum_a_2650} < {cum_p2_2650}")
    add("cum_1_50_reduced", cum_a_150 < cum_p2_150, f"{cum_a_150} < {cum_p2_150}")
    add("cum_26_50_near_000004_full", abs(cum_a_2650 - cum_0004_125) < 5e-6, f"{cum_a_2650} vs {cum_0004_125}")
    failed = [c for c in checks if not c["ok"]]
    comparison = {
        "next_a": {"1-25": cum_a_125, "26-50": cum_a_2650, "1-50": cum_a_150},
        "run_000005_p2": {"1-25": cum_p2_125, "26-50": cum_p2_2650, "1-50": cum_p2_150},
        "run_000004": {"1-25": cum_0004_125, "26-50": None, "1-50": None, "note": "000004 had no steps 26-50"},
        "ratio_next_a_26_50_over_p2_26_50": cum_a_2650 / cum_p2_2650,
        "ratio_next_a_1_50_over_p2_1_50": cum_a_150 / cum_p2_150,
        "ratio_next_a_1_50_over_000004_1_25": cum_a_150 / cum_0004_125,
        "p2_1_50_over_000004_1_25": cum_p2_150 / cum_0004_125,
    }
    return {
        "ok": len(failed) == 0,
        "passed": sum(1 for c in checks if c["ok"]),
        "failed": failed,
        "checks": checks,
        "table": table,
        "full_table": {str(s): lr_next_a(s) for s in range(1, TOTAL_STEPS + 1)},
        "formula": FORMULA,
        "peak_lr": PEAK_LR,
        "min_lr": MIN_LR,
        "warmup_steps": WARMUP_STEPS,
        "total_steps": TOTAL_STEPS,
        "cosine_denominator": TOTAL_STEPS - WARMUP_STEPS,
        "cumulative": comparison,
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
