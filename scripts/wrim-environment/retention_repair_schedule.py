"""Retention-repair LR schedules.

Design only. Does not construct an optimizer. Does not train.
RB-EXP-B_FROZEN_WRIM0_KL reuses p2_schedule.lr_p2 (1000-step cosine, unchanged).
RB-EXP-A_COSINE_HORIZON_25 is the REVISED 50-step schedule: warmup 25 then cosine 26-50.
RB-EXP-C_PEAK_LR_3E-6 keeps peak 3e-6 on a 1000-step cosine.
"""
from __future__ import annotations

import argparse
import json
import math
from typing import Any

PEAK_LR_P2 = 1e-5
MIN_LR_P2 = 1e-6
WARMUP_STEPS = 25
HORIZON_P2 = 1000
HORIZON_B = 50
COSINE_DECAY_STEPS_B = HORIZON_B - WARMUP_STEPS
PEAK_LR_C = 3e-6
MIN_LR_C = 3e-7
HORIZON_C = 1000
LR_ABS_TOL = 1e-15
LR_TABLE_STEPS = (1, 5, 10, 25, 26, 30, 35, 40, 45, 50)

FORMULA_B = (
    "1-indexed warmup-cosine over 50 steps: "
    "lr(step)=1e-5*step/25 for 1<=step<=25 (identical to RUN-000005 warmup); "
    "progress=(step-25)/(50-25); "
    "lr=1e-6+0.5*(1e-5-1e-6)*(1+cos(pi*progress)) for 25<step<=50 "
    "(step 25 = 1e-5; step 50 = 1e-6). "
    "Cosine decay length = 25 steps. Warmup < total_steps."
)
FORMULA_C = (
    "1-indexed warmup-cosine: "
    "lr(step)=3e-6*step/25 for 1<=step<=25; "
    "progress=(step-25)/(1000-25); "
    "lr=3e-7+0.5*(3e-6-3e-7)*(1+cos(pi*progress)) for 25<step<=1000 "
    "(step 25 = 3e-6; step 1000 = 3e-7). Peak/min are 3/10 of the P2 recipe."
)


def lr_schedule_decay_50(step: int) -> float:
    if not isinstance(step, int) or isinstance(step, bool) or step < 1 or step > HORIZON_B:
        raise ValueError(f"schedule-decay-50 step must be int in 1..{HORIZON_B}, got {step!r}")
    if 1 <= step <= WARMUP_STEPS:
        return PEAK_LR_P2 * step / WARMUP_STEPS
    progress = (step - WARMUP_STEPS) / (HORIZON_B - WARMUP_STEPS)
    return MIN_LR_P2 + 0.5 * (PEAK_LR_P2 - MIN_LR_P2) * (1.0 + math.cos(math.pi * progress))


def lr_peak_3e6(step: int) -> float:
    if not isinstance(step, int) or isinstance(step, bool) or step < 1 or step > HORIZON_C:
        raise ValueError(f"peak-3e-6 step must be int in 1..{HORIZON_C}, got {step!r}")
    if 1 <= step <= WARMUP_STEPS:
        return PEAK_LR_C * step / WARMUP_STEPS
    progress = (step - WARMUP_STEPS) / (HORIZON_C - WARMUP_STEPS)
    return MIN_LR_C + 0.5 * (PEAK_LR_C - MIN_LR_C) * (1.0 + math.cos(math.pi * progress))


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= LR_ABS_TOL


def sum_lr(fn, start: int, end: int) -> float:
    return float(sum(fn(s) for s in range(start, end + 1)))


def self_test() -> dict[str, Any]:
    from p2_schedule import lr_p2
    from stage3a_corrective_schedule import lr_corrective

    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str) -> None:
        checks.append({"name": name, "ok": ok, "detail": detail})

    add("warmup_lt_total", WARMUP_STEPS < HORIZON_B, f"{WARMUP_STEPS}<{HORIZON_B}")
    add("cosine_decay_steps_25", COSINE_DECAY_STEPS_B == 25, str(COSINE_DECAY_STEPS_B))
    add("rejects_warmup_ge_total_design", WARMUP_STEPS < HORIZON_B, "decay experiment must have post-warmup steps")

    b_table = {str(s): lr_schedule_decay_50(s) for s in LR_TABLE_STEPS}
    add("b_step1", _close(b_table["1"], PEAK_LR_P2 / 25), str(b_table["1"]))
    add("b_step5", _close(b_table["5"], PEAK_LR_P2 * 5 / 25), str(b_table["5"]))
    add("b_step10", _close(b_table["10"], PEAK_LR_P2 * 10 / 25), str(b_table["10"]))
    add("b_step25_peak", _close(b_table["25"], PEAK_LR_P2), str(b_table["25"]))
    add("b_warmup_matches_p2", all(_close(lr_schedule_decay_50(s), lr_p2(s)) for s in range(1, 26)), "1..25")
    add("b_step26_descends", b_table["26"] < PEAK_LR_P2, str(b_table["26"]))
    add("b_monotonic_decay_26_50", all(lr_schedule_decay_50(s) > lr_schedule_decay_50(s + 1) for s in range(26, 50)), "26..50")
    add("b_step50_min", _close(b_table["50"], MIN_LR_P2), str(b_table["50"]))

    c1 = lr_peak_3e6(1)
    c25 = lr_peak_3e6(25)
    c26 = lr_peak_3e6(26)
    c50 = lr_peak_3e6(50)
    c1000 = lr_peak_3e6(1000)
    add("c_step25_peak", _close(c25, PEAK_LR_C), str(c25))
    add("c_step26_below_peak", c26 < PEAK_LR_C, str(c26))
    add("c_step50_still_near_peak", c50 > 0.9 * PEAK_LR_C, str(c50))
    add("c_step1000_min", _close(c1000, MIN_LR_C), str(c1000))

    sum_b_1_25 = sum_lr(lr_schedule_decay_50, 1, 25)
    sum_b_26_50 = sum_lr(lr_schedule_decay_50, 26, 50)
    sum_b_1_50 = sum_lr(lr_schedule_decay_50, 1, 50)
    sum_p2_1_25 = sum_lr(lr_p2, 1, 25)
    sum_p2_26_50 = sum_lr(lr_p2, 26, 50)
    sum_p2_1_50 = sum_lr(lr_p2, 1, 50)
    sum_000004_1_25 = sum_lr(lr_corrective, 1, 25)
    add("warmup_sum_matches_000005", _close(sum_b_1_25, sum_p2_1_25), str(sum_b_1_25))
    add("decay_reduces_26_50_vs_000005", sum_b_26_50 < 0.60 * sum_p2_26_50, f"{sum_b_26_50} vs {sum_p2_26_50}")

    failed = [c for c in checks if not c["ok"]]
    return {
        "ok": len(failed) == 0,
        "passed": sum(1 for c in checks if c["ok"]),
        "failed": failed,
        "checks": checks,
        "formula_b": FORMULA_B,
        "formula_c": FORMULA_C,
        "table": {
            "schedule_decay_50": b_table,
            "peak_3e-6": {"1": c1, "25": c25, "26": c26, "50": c50, "1000": c1000},
        },
        "cumulative": {
            "revised_schedule": {"1_25": sum_b_1_25, "26_50": sum_b_26_50, "1_50": sum_b_1_50},
            "RUN-000005": {"1_25": sum_p2_1_25, "26_50": sum_p2_26_50, "1_50": sum_p2_1_50},
            "RUN-000004": {
                "1_25": sum_000004_1_25,
                "26_50": None,
                "note": "RUN-000004 authorized only 25 steps (warmup 8, cosine 9-25 to min). No steps 26-50 exist.",
            },
            "ratio_26_50_revised_over_000005": sum_b_26_50 / sum_p2_26_50,
            "ratio_1_50_revised_over_000005": sum_b_1_50 / sum_p2_1_50,
        },
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--json", action="store_true")
    args = p.parse_args()
    out = self_test()
    if args.json:
        print(json.dumps(out, indent=2))
    else:
        print(f"ok={out['ok']} passed={out['passed']}")
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
