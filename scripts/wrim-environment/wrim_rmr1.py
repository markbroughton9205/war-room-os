"""RMR1: tiny learned response-mode router. Linear(256→2)+bias only.

Does not train WRIM. Does not route to NA1. Does not implement NE1.
Fail-closed default is STRUCTURED (EA1+RA1).
"""
from __future__ import annotations

from typing import Any

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from wrim_g20m import D_MODEL

RMR1_ARCH_ID = "RMR1"
RMR1_VERSION = "RMR1-v1"
RMR1_INPUT_TYPE = "pre_ea1"
RMR1_INPUT_DIM = D_MODEL
RMR1_N_CLASSES = 2
RMR1_PARAM_EXPECTED = D_MODEL * RMR1_N_CLASSES + RMR1_N_CLASSES  # 514
RMR1_PARAM_CEILING = 4096
RMR1_PREFIX = "rmr1."
CLASS_STRUCTURED = 0
CLASS_NATURAL = 1
MODE_STRUCTURED = "STRUCTURED"
MODE_NATURAL = "NATURAL"
FALLBACK_MODE = MODE_STRUCTURED
SAFE_NATURAL_BIAS = -20.0


class ResponseModeRouter(nn.Module):
    """Linear classifier over assistant-entry pre_ea1 hidden state."""

    def __init__(self, d_model: int = D_MODEL) -> None:
        super().__init__()
        if int(d_model) != RMR1_INPUT_DIM:
            raise ValueError(f"RMR1 input dim must be {RMR1_INPUT_DIM}, got {d_model}")
        self.d_model = int(d_model)
        self.proj = nn.Linear(self.d_model, RMR1_N_CLASSES, bias=True)
        self.reset_safe_init()
        n = self.param_count()
        if n != RMR1_PARAM_EXPECTED:
            raise RuntimeError(f"RMR1 param count {n} != expected {RMR1_PARAM_EXPECTED}")
        if n > RMR1_PARAM_CEILING:
            raise RuntimeError(f"RMR1 param count {n} exceeds ceiling {RMR1_PARAM_CEILING}")

    def reset_safe_init(self) -> None:
        """Untrained inference must not emit NATURAL. Zero weight, NATURAL bias << 0."""
        nn.init.zeros_(self.proj.weight)
        nn.init.zeros_(self.proj.bias)
        with torch.no_grad():
            self.proj.bias[CLASS_NATURAL] = float(SAFE_NATURAL_BIAS)

    def forward(self, h: torch.Tensor) -> torch.Tensor:
        return self.proj(h)

    def param_count(self) -> int:
        return int(sum(p.numel() for p in self.parameters()))


def softmax_natural_prob(logits: torch.Tensor) -> torch.Tensor:
    return F.softmax(logits.float(), dim=-1)[..., CLASS_NATURAL]


def decide_from_logits(
    logits: torch.Tensor,
    *,
    threshold: float | None,
    version: str | None = RMR1_VERSION,
) -> tuple[str, float | None, str]:
    """NATURAL only if P(NATURAL) >= threshold. Anything untrusted → STRUCTURED."""
    if version not in {None, RMR1_VERSION}:
        return MODE_STRUCTURED, None, "unsupported_version"
    if threshold is None or not np.isfinite(float(threshold)):
        return MODE_STRUCTURED, None, "threshold_missing"
    if logits is None:
        return MODE_STRUCTURED, None, "missing_logits"
    vec = logits.reshape(-1)
    if vec.numel() < 2 or not torch.isfinite(vec[-2:]).all():
        return MODE_STRUCTURED, None, "nan_logits"
    p_nat = float(F.softmax(vec[-2:].float(), dim=-1)[CLASS_NATURAL].item())
    if not np.isfinite(p_nat):
        return MODE_STRUCTURED, None, "nan_prob"
    if p_nat >= float(threshold):
        return MODE_NATURAL, p_nat, "ok"
    return MODE_STRUCTURED, p_nat, "low_confidence"


def class_report(y: np.ndarray, pred: np.ndarray) -> dict[str, Any]:
    y = np.asarray(y, dtype=np.int64)
    pred = np.asarray(pred, dtype=np.int64)
    nat_t = int((y == CLASS_NATURAL).sum())
    str_t = int((y == CLASS_STRUCTURED).sum())
    tp_n = int(((pred == CLASS_NATURAL) & (y == CLASS_NATURAL)).sum())
    tp_s = int(((pred == CLASS_STRUCTURED) & (y == CLASS_STRUCTURED)).sum())
    fp_n = int(((pred == CLASS_NATURAL) & (y == CLASS_STRUCTURED)).sum())
    fp_s = int(((pred == CLASS_STRUCTURED) & (y == CLASS_NATURAL)).sum())
    return {
        "n": int(len(y)),
        "n_structured": str_t,
        "n_natural": nat_t,
        "accuracy": float((pred == y).mean()) if len(y) else 0.0,
        "natural_recall": float(tp_n / max(1, nat_t)),
        "structured_recall": float(tp_s / max(1, str_t)),
        "false_natural_rate": float(fp_n / max(1, str_t)),
        "false_structured_rate": float(fp_s / max(1, nat_t)),
        "confusion": {
            "structured_as_structured": tp_s,
            "structured_as_natural": fp_n,
            "natural_as_structured": fp_s,
            "natural_as_natural": tp_n,
        },
        "correct": int((pred == y).sum()),
    }


def calibrate_threshold(p_nat: np.ndarray, y: np.ndarray) -> dict[str, Any]:
    """Choose threshold on validation only. Prioritize very low false-NATURAL rate."""
    p_nat = np.asarray(p_nat, dtype=np.float64)
    y = np.asarray(y, dtype=np.int64)
    struct_p = np.sort(p_nat[y == CLASS_STRUCTURED])
    grid = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.92, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99, 0.995, 1.0]
    if len(struct_p):
        grid.extend(float(x + 1e-6) for x in struct_p)
        grid.append(float(struct_p.max() + 1e-4))
    grid = sorted({min(1.0, max(0.0, float(t))) for t in grid})
    rows = []
    best = None
    best_key = None
    n_struct = max(1, int((y == CLASS_STRUCTURED).sum()))
    for t in grid:
        pred = (p_nat >= t).astype(np.int64)
        rep = class_report(y, pred)
        fn = float(rep["false_natural_rate"])
        rec_n = float(rep["natural_recall"])
        rows.append({"threshold": t, **rep})
        # Min false-NATURAL, then max natural recall, then higher (safer) threshold.
        key = (fn, -rec_n, -t)
        if best_key is None or key < best_key:
            best_key = key
            best = {"threshold": t, **rep}
    # If the safest FN=0 gate kills all natural recall, allow at most one structured miss.
    if best is not None and float(best["natural_recall"]) == 0.0:
        alt = None
        alt_key = None
        cap = 1.0 / float(n_struct)
        for row in rows:
            if float(row["false_natural_rate"]) > cap + 1e-12:
                continue
            key = (-float(row["natural_recall"]), float(row["false_natural_rate"]), -float(row["threshold"]))
            if alt_key is None or key < alt_key:
                alt_key = key
                alt = row
        if alt is not None and float(alt["natural_recall"]) > 0.0:
            best = alt
    return {
        "selected": best,
        "grid": rows,
        "selection_data": "VALIDATION_ONLY",
        "objective": "min_false_natural then max_natural_recall then safer_threshold",
    }


def calibration_bins(p_nat: np.ndarray, y: np.ndarray, n_bins: int = 5) -> list[dict[str, Any]]:
    p_nat = np.asarray(p_nat, dtype=np.float64)
    y = np.asarray(y, dtype=np.int64)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    out = []
    for i in range(n_bins):
        lo, hi = float(edges[i]), float(edges[i + 1])
        if i == n_bins - 1:
            m = (p_nat >= lo) & (p_nat <= hi)
        else:
            m = (p_nat >= lo) & (p_nat < hi)
        n = int(m.sum())
        out.append({
            "lo": lo,
            "hi": hi,
            "n": n,
            "mean_p_natural": float(p_nat[m].mean()) if n else None,
            "empirical_natural_rate": float(y[m].mean()) if n else None,
        })
    return out
