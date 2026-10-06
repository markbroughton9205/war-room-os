"""Proven parent-weight load contract used by WRIM1-RUN-000006 execution.

RUN-000006 was produced with:
  disable_tf32() after seeding
  state, _coverage = load_model_state_from_safetensors(weights)
  model.load_state_dict(state, strict=True)

This helper is the dedicated RUN-000007 import path so training does not depend
on an unexplained dirty working-tree copy of run000006_train.py.
Does not construct an optimizer. Does not train.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any


def disable_tf32() -> None:
    import torch

    if torch.cuda.is_available():
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.backends.cudnn.benchmark = False
        torch.backends.cudnn.deterministic = True
    if hasattr(torch, "set_float32_matmul_precision"):
        torch.set_float32_matmul_precision("highest")


def load_parent_state(weights: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    from safetensors_model import load_model_state_from_safetensors

    state, coverage = load_model_state_from_safetensors(weights)
    return state, coverage


def load_parent_into_model(model: Any, weights: Path) -> dict[str, Any]:
    state, coverage = load_parent_state(weights)
    model.load_state_dict(state, strict=True)
    return coverage
