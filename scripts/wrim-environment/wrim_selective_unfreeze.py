"""Selective upper-layer unfreeze masks for WRIM UH1-AC2. Does not train."""
from __future__ import annotations

from typing import Any

import torch

from wrim_g20m_uh1 import UH1_AC2_PARAM_COUNT, WRIMUH1Model
from wrim_hvu_identity import GRAD_HARD, GRAD_REVIEW, GRAD_WARN

STAGE_FROM_LAYER = {"U1": 17, "U2": 16, "U4": 14, "U6": 12}
N_LAYERS = 18
HEAD_KEYS = ("lm_head.weight",)
CTRL_KEYS = ("assistant_ctrl", "assistant_span_ctrl")


def from_layer_for_stage(stage: str) -> int:
    if stage not in STAGE_FROM_LAYER:
        raise ValueError(f"unauthorized unfreeze stage {stage}")
    return STAGE_FROM_LAYER[stage]


def is_trainable_name(name: str, *, from_layer: int, lm_head: bool = True, ctrl: bool = True) -> bool:
    if lm_head and name.startswith("lm_head"):
        return True
    if ctrl and name in CTRL_KEYS:
        return True
    if name.startswith("layers."):
        idx = int(name.split(".")[1])
        return idx >= from_layer
    return False


def freeze_u_stage(
    model: WRIMUH1Model,
    *,
    stage: str,
    lm_head: bool = True,
    ctrl: bool = True,
) -> dict[str, Any]:
    from_layer = from_layer_for_stage(stage)
    model.train()
    trainable_names: list[str] = []
    frozen_layer_hits = 0
    for name, p in model.named_parameters():
        train = is_trainable_name(name, from_layer=from_layer, lm_head=lm_head, ctrl=ctrl)
        p.requires_grad_(train)
        if train:
            trainable_names.append(name)
        elif name.startswith("layers."):
            frozen_layer_hits += 1
    n_train = int(sum(p.numel() for p in model.parameters() if p.requires_grad))
    n_total = int(sum(p.numel() for p in model.parameters()))
    if n_total != UH1_AC2_PARAM_COUNT:
        raise RuntimeError(f"param count {n_total} != {UH1_AC2_PARAM_COUNT}")
    if any(n.startswith("tok_emb") for n in trainable_names):
        raise RuntimeError("tok_emb must stay frozen")
    if any(n.startswith("norm_f") for n in trainable_names):
        raise RuntimeError("norm_f is not authorized in this unfreeze stage")
    for name in trainable_names:
        if name.startswith("layers."):
            idx = int(name.split(".")[1])
            if idx < from_layer:
                raise RuntimeError(f"layer {idx} trainable below floor {from_layer}")
    return {
        "UNFREEZE_STAGE": stage,
        "FROM_LAYER": from_layer,
        "TRAINABLE_NAMES": trainable_names,
        "TRAINABLE_PARAMETER_COUNT": n_train,
        "TOTAL_PARAMETER_COUNT": n_total,
        "TRAINABLE_PERCENT": 100.0 * n_train / n_total,
        "N_FROZEN_LAYER_TENSORS": frozen_layer_hits,
        "LM_HEAD_TRAINABLE": lm_head,
        "CTRL_TRAINABLE": ctrl,
        "TOK_EMB_FROZEN": True,
        "NORM_F_FROZEN": True,
        "LAYERS_FROZEN": list(range(0, from_layer)),
        "LAYERS_TRAINABLE": list(range(from_layer, N_LAYERS)),
    }


def group_params(model: WRIMUH1Model) -> dict[str, list[torch.nn.Parameter]]:
    head: list[torch.nn.Parameter] = []
    body: list[torch.nn.Parameter] = []
    ctrl: list[torch.nn.Parameter] = []
    for name, p in model.named_parameters():
        if not p.requires_grad:
            continue
        if name.startswith("lm_head"):
            head.append(p)
        elif name in CTRL_KEYS:
            ctrl.append(p)
        else:
            body.append(p)
    return {"lm_head": head, "body": body, "ctrl": ctrl}


def layer_grads(model: WRIMUH1Model) -> dict[str, float]:
    out: dict[str, float] = {}
    trainable_sq = 0.0
    head = entry = span = body = 0.0
    by_layer: dict[int, float] = {}
    for name, p in model.named_parameters():
        if p.grad is None:
            continue
        n = float(p.grad.detach().float().norm(2).item())
        if p.requires_grad:
            trainable_sq += n * n
        if name.startswith("lm_head"):
            head = n
        elif name == "assistant_ctrl":
            entry = n
        elif name == "assistant_span_ctrl":
            span = n
        elif name.startswith("layers."):
            idx = int(name.split(".")[1])
            by_layer[idx] = by_layer.get(idx, 0.0) + n * n
            if p.requires_grad:
                body += n * n
    g = trainable_sq ** 0.5
    if g < GRAD_REVIEW:
        gate = "SAFE"
    elif g < GRAD_HARD:
        gate = "REVIEW"
    else:
        gate = "HARD"
    if g >= GRAD_WARN and gate == "SAFE":
        gate = "WARN"
    out.update(
        {
            "TOTAL_TRAINABLE_GRAD": g,
            "LM_HEAD_GRAD": head,
            "ENTRY_CTRL_GRAD": entry,
            "SPAN_CTRL_GRAD": span,
            "BODY_GRAD": body ** 0.5,
            "GRAD_GATE": gate,
            **{f"LAYER_{i}_GRAD": (by_layer[i] ** 0.5) for i in sorted(by_layer)},
        }
    )
    return out


def tensor_l2(a: torch.Tensor, b: torch.Tensor) -> float:
    return float((a.detach().float().cpu() - b.detach().float().cpu()).norm(2).item())


def distance_from_parent(model: WRIMUH1Model, parent: dict[str, torch.Tensor], *, from_layer: int) -> dict[str, float]:
    cur = {k: v.detach().cpu() for k, v in model.state_dict().items()}
    parent_cpu = {k: v.detach().cpu() for k, v in parent.items()}
    head = tensor_l2(cur["lm_head.weight"], parent_cpu["lm_head.weight"])
    body_sq = 0.0
    train_body_sq = 0.0
    for k, v in cur.items():
        if k.startswith("lm_head") or k in CTRL_KEYS:
            continue
        d = (v.float() - parent_cpu[k].float()).pow(2).sum().item()
        body_sq += d
        if k.startswith("layers.") and int(k.split(".")[1]) >= from_layer:
            train_body_sq += d
    ctrl_sq = 0.0
    for k in CTRL_KEYS:
        if k in cur and k in parent_cpu:
            ctrl_sq += (cur[k].float() - parent_cpu[k].float()).pow(2).sum().item()
    return {
        "LM_HEAD_DISTANCE_FROM_START": head,
        "BODY_DISTANCE_FROM_START": body_sq ** 0.5,
        "TRAINABLE_BODY_DISTANCE_FROM_START": train_body_sq ** 0.5,
        "CTRL_DISTANCE_FROM_START": ctrl_sq ** 0.5,
    }
