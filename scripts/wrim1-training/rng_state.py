from __future__ import annotations

import math
from typing import Any

import numpy as np


def lr_at_step(step: int, total_steps: int, peak_lr: float, warmup_steps: int, floor_ratio: float) -> float:
    if step < warmup_steps:
        return peak_lr * (step + 1) / max(1, warmup_steps)
    progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
    progress = min(1.0, progress)
    cosine = 0.5 * (1 + math.cos(math.pi * progress))
    return peak_lr * (floor_ratio + (1 - floor_ratio) * cosine)


def scheduler_state(step: int, cfg: dict) -> dict:
    sched = cfg if "type" in cfg else cfg.get("scheduler", cfg)
    if isinstance(sched, str):
        raise ValueError("scheduler config must be a mapping, not a defaulted string")
    total = int(sched["total_steps"])
    warmup = int(sched["warmup_steps"])
    base = float(sched["base_lr"])
    floor = float(sched["floor_ratio"])
    lr = lr_at_step(step, total, base, warmup, floor)
    return {
        "type": sched["type"],
        "warmup_steps": warmup,
        "total_steps": total,
        "global_step": step,
        "scheduler_position": step,
        "current_lr": lr,
        "base_lr": base,
        "floor_ratio": floor,
    }


def capture_rng(np_rng: np.random.Generator) -> dict[str, Any]:
    import random

    mlx_state = None
    try:
        import mlx.core as mx
        raw = mx.random.state
        if hasattr(raw, "tolist"):
            mlx_state = {"kind": "mlx.random.state", "value": np.array(raw).tolist(), "dtype": str(np.array(raw).dtype)}
        else:
            mlx_state = {"kind": "mlx.random.state", "repr": str(raw)}
    except Exception as exc:  # noqa: BLE001
        mlx_state = {"kind": "unavailable", "error": type(exc).__name__}
    py_state = random.getstate()
    return {
        "python_random": {"version": py_state[0], "mt": list(py_state[1]), "gauss": py_state[2]},
        "numpy": np_rng.bit_generator.state,
        "mlx": mlx_state,
        "note": "Continuation state, not merely the initial seed.",
    }


def restore_rng(blob: dict, np_rng: np.random.Generator) -> None:
    import random

    py = blob["python_random"]
    random.setstate((py["version"], tuple(py["mt"]), py["gauss"]))
    np_rng.bit_generator.state = blob["numpy"]
    mlx = blob.get("mlx") or {}
    if mlx.get("kind") == "mlx.random.state" and "value" in mlx:
        import mlx.core as mx
        mx.random.state = mx.array(np.array(mlx["value"], dtype=np.dtype(mlx.get("dtype", "uint32"))))
