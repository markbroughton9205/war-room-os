"""PLM-000003 encoding: Policy A plus first-target mask id. Weight 2.0.

Reuses PLM-000001/000002 boundary. Does not train. Does not rewrite the corpus.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from wrim_plm1_encode import (
    RAW_TEMPLATE,
    boundary_fixtures,
    encode_example as encode_base,
    pack_train_stream,
    prefix_ids_for_inference,
    raw_string,
    slice_batches,
    validate_inference_match,
)
from wrim_plm3_identity import (
    EOS_LOSS_WEIGHT,
    FIRST_TOKEN_LOSS_WEIGHT,
    LATER_TOKEN_LOSS_WEIGHT,
)
from wrim_target_only_loss import MASK_CAP_EOS, MASK_CAP_TARGET, MASK_IGNORE

MASK_CAP_FIRST = 4


def encode_example(tokenizer: Any, rec: dict[str, Any]) -> dict[str, Any]:
    enc = encode_base(tokenizer, rec)
    fi = int(enc["first_target_index"])
    if int(enc["mask"][fi]) == MASK_IGNORE:
        # Gold-prefix continuation: early target tokens stay context. No first-token upweight.
        enc["mask"] = np.array(enc["mask"], dtype=np.int8, copy=True)
        enc["first_token_class"] = rec.get("first_token_class")
        return enc
    if int(enc["mask"][fi]) != MASK_CAP_TARGET:
        raise ValueError("first target was not marked TARGET before upgrade")
    enc["mask"] = np.array(enc["mask"], dtype=np.int8, copy=True)
    enc["mask"][fi] = MASK_CAP_FIRST
    enc["first_token_class"] = rec.get("first_token_class")
    return enc


def mask_report(mask: np.ndarray, *, first_w: float | None = None) -> dict[str, Any]:
    m = np.asarray(mask, dtype=np.int8)
    w_first = float(FIRST_TOKEN_LOSS_WEIGHT if first_w is None else first_w)
    w_later = float(LATER_TOKEN_LOSS_WEIGHT)
    w_eos = float(EOS_LOSS_WEIGHT)
    n_prompt = int(np.count_nonzero(m == MASK_IGNORE))
    n_first = int(np.count_nonzero(m == MASK_CAP_FIRST))
    n_later = int(np.count_nonzero(m == MASK_CAP_TARGET))
    n_eos = int(np.count_nonzero(m == MASK_CAP_EOS))
    w_sum = n_first * w_first + n_later * w_later + n_eos * w_eos
    return {
        "PROMPT_TOKENS_SUPERVISED": False,
        "TARGET_TOKENS_SUPERVISED": True,
        "EOS_SUPERVISED": True,
        "FIRST_TOKEN_LOSS_WEIGHT": w_first,
        "LATER_TOKEN_LOSS_WEIGHT": w_later,
        "EOS_LOSS_WEIGHT": w_eos,
        "n_prompt_masked": n_prompt,
        "n_first_supervised": n_first,
        "n_later_supervised": n_later,
        "n_eos_supervised": n_eos,
        "n_total": int(m.size),
        "weight_mass_first": n_first * w_first / w_sum if w_sum else None,
        "weight_mass_later": n_later * w_later / w_sum if w_sum else None,
        "weight_mass_eos": n_eos * w_eos / w_sum if w_sum else None,
        "ok": n_first > 0 and n_eos > 0 and n_prompt > 0 and abs(w_first - 2.0) < 1e-12,
    }


def weight_tensor_from_mask(y_mask, *, first_w: float | None = None, later_w: float | None = None, eos_w: float | None = None):
    import torch

    w_first = float(FIRST_TOKEN_LOSS_WEIGHT if first_w is None else first_w)
    w_later = float(LATER_TOKEN_LOSS_WEIGHT if later_w is None else later_w)
    w_eos = float(EOS_LOSS_WEIGHT if eos_w is None else eos_w)
    w = torch.zeros_like(y_mask, dtype=torch.float32)
    w = w.masked_fill(y_mask == MASK_CAP_FIRST, w_first)
    w = w.masked_fill(y_mask == MASK_CAP_TARGET, w_later)
    w = w.masked_fill(y_mask == MASK_CAP_EOS, w_eos)
    return w


def weighted_split_losses(logits, y, y_mask, *, first_w: float | None = None, later_w: float | None = None, eos_w: float | None = None):
    import torch
    import torch.nn.functional as F

    from wrim_target_only_loss import IGNORE_INDEX

    labels = y.clone()
    labels = labels.masked_fill(y_mask == MASK_IGNORE, IGNORE_INDEX)
    nll = F.cross_entropy(
        logits.reshape(-1, logits.size(-1)),
        labels.reshape(-1),
        reduction="none",
        ignore_index=IGNORE_INDEX,
    ).view_as(y)
    w = weight_tensor_from_mask(y_mask, first_w=first_w, later_w=later_w, eos_w=eos_w)
    mass = w.sum().clamp_min(1.0)
    loss = (nll * w).sum() / mass

    def mean_where(flag) -> float | None:
        sel = flag
        if int(sel.sum().item()) == 0:
            return None
        return float(nll[sel].mean().item())

    n_first = int((y_mask == MASK_CAP_FIRST).sum().item())
    n_later = int((y_mask == MASK_CAP_TARGET).sum().item())
    n_eos = int((y_mask == MASK_CAP_EOS).sum().item())
    n_ign = int((y_mask == MASK_IGNORE).sum().item())
    return {
        "loss": loss,
        "FIRST_TOKEN_CE": mean_where(y_mask == MASK_CAP_FIRST),
        "LATER_TOKEN_CE": mean_where(y_mask == MASK_CAP_TARGET),
        "EOS_CE": mean_where(y_mask == MASK_CAP_EOS),
        "n_first_supervised": n_first,
        "n_later_supervised": n_later,
        "n_eos_supervised": n_eos,
        "n_ignored": n_ign,
        "weight_sum": float(mass.item()),
        "logits": logits,
        "nll": nll,
    }


__all__ = [
    "MASK_CAP_FIRST",
    "RAW_TEMPLATE",
    "boundary_fixtures",
    "encode_example",
    "mask_report",
    "pack_train_stream",
    "prefix_ids_for_inference",
    "raw_string",
    "slice_batches",
    "validate_inference_match",
    "weight_tensor_from_mask",
    "weighted_split_losses",
]
