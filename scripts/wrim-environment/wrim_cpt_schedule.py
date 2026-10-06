"""WRIM1-CPT-000001 LR schedule. Does not train."""
from __future__ import annotations

import math
from typing import Any

from wrim_cpt_identity import MIN_LR, PEAK_LR, STEPS, WARMUP_STEPS


def lr_cpt_000001(step: int) -> float:
    if step < 1:
        return float(PEAK_LR) * (1.0 / max(1, WARMUP_STEPS))
    if step <= WARMUP_STEPS:
        return float(PEAK_LR) * (float(step) / float(WARMUP_STEPS))
    t = (step - WARMUP_STEPS) / max(1, STEPS - WARMUP_STEPS)
    t = min(1.0, max(0.0, t))
    cosine = 0.5 * (1.0 + math.cos(math.pi * t))
    return float(MIN_LR) + (float(PEAK_LR) - float(MIN_LR)) * cosine


def freeze_schedule() -> dict[str, float]:
    return {str(s): lr_cpt_000001(s) for s in range(1, STEPS + 1)}


def self_test() -> dict[str, Any]:
    table = freeze_schedule()
    warmup = [table[str(s)] for s in range(1, WARMUP_STEPS + 1)]
    peak = table[str(WARMUP_STEPS)]
    final = table[str(STEPS)]
    checks = []

    def add(name: str, ok: bool, detail: Any = None) -> None:
        checks.append({"name": name, "ok": bool(ok), "detail": detail})

    add("warmup_len", len(warmup) == WARMUP_STEPS)
    add("warmup_monotonic", all(warmup[i] < warmup[i + 1] for i in range(len(warmup) - 1)))
    add("peak_at_warmup_end", abs(peak - PEAK_LR) < 1e-12, peak)
    add("final_near_min", abs(final - MIN_LR) < 1e-8, final)
    add("never_exceeds_peak", max(table.values()) <= PEAK_LR + 1e-15)
    add("n_steps", len(table) == STEPS)
    return {"ok": all(c["ok"] for c in checks), "checks": checks, "peak": peak, "final": final}
