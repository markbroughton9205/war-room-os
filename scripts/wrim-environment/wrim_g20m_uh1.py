"""Experimental WRIM-G-20M-v1-option-A-UH1: untied output head.

Does not replace WRIM0Model. Canonical architecture remains tied option-A.
lm_head is clone-initialized from tok_emb at conversion; never tied by pointer.
Optional AC1: zero-init assistant-position control vector.
"""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from wrim_cpt_identity import ASSISTANT_ID, BOS_ID, COMMANDER_ID, EOS_ID, SYSTEM_ID
from wrim_g20m import (
    D_FF,
    D_MODEL,
    HEAD_DIM,
    N_HEADS,
    N_LAYERS,
    ROPE_THETA,
    VOCAB_SIZE,
    Block,
    RMSNorm,
    WRIM0Model,
)

ARCH_ID_UH1 = "WRIM-G-20M-v1-option-A-UH1"
ARCH_ID_UH1_AC1 = "WRIM-G-20M-v1-option-A-UH1-AC1"
ARCH_ID_UH1_AC2 = "WRIM-G-20M-v1-option-A-UH1-AC2"
TIED_PARAM_COUNT = 19_217_152
UH1_ADDED = VOCAB_SIZE * D_MODEL  # 3_872_256
UH1_PARAM_COUNT = TIED_PARAM_COUNT + UH1_ADDED  # 23_089_408
AC1_ADDED = D_MODEL  # 256
UH1_AC1_PARAM_COUNT = UH1_PARAM_COUNT + AC1_ADDED
AC2_SPAN_ADDED = D_MODEL  # 256
UH1_AC2_PARAM_COUNT = UH1_AC1_PARAM_COUNT + AC2_SPAN_ADDED  # 23_089_920
AC2_STOP_ADDED = D_MODEL  # 256
UH1_AC2_STOP_PARAM_COUNT = UH1_AC2_PARAM_COUNT + AC2_STOP_ADDED


class WRIMUH1Model(nn.Module):
    """Tied option-A body + separate lm_head Parameter (vocab, d_model)."""

    def __init__(
        self,
        *,
        assistant_control: bool = False,
        span_control: bool = False,
        stop_control: bool = False,
    ) -> None:
        super().__init__()
        if stop_control and not span_control:
            raise ValueError("stop_control requires span_control")
        if span_control and not assistant_control:
            raise ValueError("span_control requires assistant_control")
        if stop_control:
            self.architecture_id = ARCH_ID_UH1_AC2 + "-STOP"
        elif span_control:
            self.architecture_id = ARCH_ID_UH1_AC2
        elif assistant_control:
            self.architecture_id = ARCH_ID_UH1_AC1
        else:
            self.architecture_id = ARCH_ID_UH1
        self.assistant_control = bool(assistant_control)
        self.span_control = bool(span_control)
        self.stop_control = bool(stop_control)
        self.tok_emb = nn.Embedding(VOCAB_SIZE, D_MODEL)
        self.layers = nn.ModuleList(
            [Block(D_MODEL, N_HEADS, HEAD_DIM, D_FF, ROPE_THETA) for _ in range(N_LAYERS)]
        )
        self.norm_f = RMSNorm(D_MODEL)
        self.lm_head = nn.Linear(D_MODEL, VOCAB_SIZE, bias=False)
        if self.assistant_control:
            self.assistant_ctrl = nn.Parameter(torch.zeros(D_MODEL))
        else:
            self.register_parameter("assistant_ctrl", None)
        if self.span_control:
            self.assistant_span_ctrl = nn.Parameter(torch.zeros(D_MODEL))
        else:
            self.register_parameter("assistant_span_ctrl", None)
        if self.stop_control:
            self.assistant_stop_ctrl = nn.Parameter(torch.zeros(D_MODEL))
        else:
            self.register_parameter("assistant_stop_ctrl", None)

    def control_masks(self, idx: torch.Tensor) -> dict[str, torch.Tensor]:
        """Teacher-forced and generation-time masks from token identity.

        Entry: current token is <|assistant|> (predicts first response token).
        Span: after <|assistant|> and before EOS / next role delimiter.
        Stop: span positions whose next token is EOS.
        """
        is_ast = idx == ASSISTANT_ID
        is_eos = idx == EOS_ID
        is_reset = (idx == EOS_ID) | (idx == COMMANDER_ID) | (idx == BOS_ID) | (idx == SYSTEM_ID)
        bsz, seq = idx.shape
        in_resp = torch.zeros(bsz, dtype=torch.bool, device=idx.device)
        span = torch.zeros_like(is_ast)
        for t in range(seq):
            span[:, t] = in_resp & ~is_ast[:, t] & ~is_eos[:, t]
            in_resp = torch.where(is_ast[:, t], torch.ones_like(in_resp), in_resp)
            in_resp = torch.where(is_reset[:, t], torch.zeros_like(in_resp), in_resp)
        nxt_eos = torch.zeros_like(is_ast)
        nxt_eos[:, :-1] = is_eos[:, 1:]
        stop = span & nxt_eos
        return {"entry": is_ast, "span": span, "stop": stop}

    def hidden(self, idx: torch.Tensor) -> torch.Tensor:
        x = self.tok_emb(idx)
        for layer in self.layers:
            x = layer(x)
        x = self.norm_f(x)
        if self.assistant_control and self.assistant_ctrl is not None:
            masks = self.control_masks(idx)
            is_ast = masks["entry"].unsqueeze(-1).to(dtype=x.dtype)
            x = x + is_ast * self.assistant_ctrl
            if self.span_control and self.assistant_span_ctrl is not None:
                span = masks["span"].unsqueeze(-1).to(dtype=x.dtype)
                if self.stop_control and self.assistant_stop_ctrl is not None:
                    stop = masks["stop"].unsqueeze(-1).to(dtype=x.dtype)
                    span_only = span * (1.0 - stop)
                    x = x + span_only * self.assistant_span_ctrl
                    x = x + stop * self.assistant_stop_ctrl
                else:
                    x = x + span * self.assistant_span_ctrl
        return x

    def forward(self, idx: torch.Tensor) -> torch.Tensor:
        return F.linear(self.hidden(idx), self.lm_head.weight)

    def freeze_inference(self) -> None:
        self.eval()
        for p in self.parameters():
            p.requires_grad_(False)

    def enable_training(self) -> None:
        self.train()
        for p in self.parameters():
            p.requires_grad_(True)


def clone_init_from_tied(tied: WRIM0Model, *, assistant_control: bool = False) -> WRIMUH1Model:
    dest = WRIMUH1Model(assistant_control=assistant_control)
    missing, unexpected = dest.load_state_dict(tied.state_dict(), strict=False)
    if unexpected:
        raise ValueError(f"unexpected tied keys: {unexpected}")
    extra = set(missing) - {"lm_head.weight", "assistant_ctrl"}
    if extra:
        raise ValueError(f"missing body keys: {sorted(extra)}")
    with torch.no_grad():
        dest.lm_head.weight.copy_(dest.tok_emb.weight)
        if dest.assistant_ctrl is not None:
            dest.assistant_ctrl.zero_()
    if dest.tok_emb.weight.data_ptr() == dest.lm_head.weight.data_ptr():
        raise RuntimeError("tok_emb and lm_head still share storage")
    if id(dest.tok_emb.weight) == id(dest.lm_head.weight):
        raise RuntimeError("tok_emb and lm_head are the same Parameter")
    return dest


def clone_ac1_from_uh1(uh1: WRIMUH1Model) -> WRIMUH1Model:
    """Zero-init assistant_ctrl on a clone of an existing UH1 model."""
    dest = WRIMUH1Model(assistant_control=True)
    missing, unexpected = dest.load_state_dict(uh1.state_dict(), strict=False)
    if unexpected:
        raise ValueError(f"unexpected UH1 keys: {unexpected}")
    extra = set(missing) - {"assistant_ctrl"}
    if extra:
        raise ValueError(f"missing UH1 keys: {sorted(extra)}")
    with torch.no_grad():
        dest.assistant_ctrl.zero_()
    return dest


def freeze_body_train_ctrl(model: WRIMUH1Model) -> None:
    if not model.assistant_control or model.assistant_ctrl is None:
        raise ValueError("AC1 not present")
    model.train()
    for p in model.parameters():
        p.requires_grad_(False)
    model.assistant_ctrl.requires_grad_(True)


def clone_ac2_from_ac1(ac1: WRIMUH1Model, *, stop_control: bool = False) -> WRIMUH1Model:
    """Keep trained entry vector. Zero-init span (and optional stop)."""
    dest = WRIMUH1Model(assistant_control=True, span_control=True, stop_control=stop_control)
    missing, unexpected = dest.load_state_dict(ac1.state_dict(), strict=False)
    if unexpected:
        raise ValueError(f"unexpected AC1 keys: {unexpected}")
    extra = set(missing) - {"assistant_span_ctrl", "assistant_stop_ctrl"}
    if extra:
        raise ValueError(f"missing AC1 keys: {sorted(extra)}")
    with torch.no_grad():
        dest.assistant_span_ctrl.zero_()
        if dest.assistant_stop_ctrl is not None:
            dest.assistant_stop_ctrl.zero_()
    return dest


def freeze_body_train_ac2(
    model: WRIMUH1Model,
    *,
    lm_head: bool = False,
    stop: bool | None = None,
    ctrl: bool = True,
) -> None:
    if not model.span_control or model.assistant_span_ctrl is None:
        raise ValueError("AC2 not present")
    model.train()
    for p in model.parameters():
        p.requires_grad_(False)
    if ctrl:
        model.assistant_ctrl.requires_grad_(True)
        model.assistant_span_ctrl.requires_grad_(True)
    use_stop = model.stop_control if stop is None else bool(stop)
    if use_stop:
        if model.assistant_stop_ctrl is None:
            raise ValueError("stop_control requested but parameter missing")
        model.assistant_stop_ctrl.requires_grad_(True)
    if lm_head:
        model.lm_head.weight.requires_grad_(True)


def trainable_param_names(model: WRIMUH1Model) -> list[str]:
    return [n for n, p in model.named_parameters() if p.requires_grad]


def assert_untied(model: WRIMUH1Model) -> dict:
    te = model.tok_emb.weight
    lh = model.lm_head.weight
    return {
        "tok_emb_data_ptr": int(te.data_ptr()),
        "lm_head_data_ptr": int(lh.data_ptr()),
        "ptrs_differ": int(te.data_ptr()) != int(lh.data_ptr()),
        "param_ids_differ": id(te) != id(lh),
        "same_shape": tuple(te.shape) == tuple(lh.shape),
        "values_equal_at_init": bool(torch.equal(te.detach(), lh.detach())),
        "n_params": int(sum(p.numel() for p in model.parameters())),
        "architecture_id": model.architecture_id,
        "assistant_control": model.assistant_control,
    }
