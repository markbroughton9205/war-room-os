"""WRIM-G-20M-v1-option-A-UH1-AC2-RA1: assistant-span residual adapter.

Base UH1-AC2 stays frozen. RA1 is zero-init, residual, span-gated, removable.
Does not train. Does not change canonical STEP_400.
"""
from __future__ import annotations

import hashlib
import math
from typing import Any

import torch
import torch.nn as nn
import torch.nn.functional as F

from wrim_cpt_identity import BOS_ID, COMMANDER_ID, EOS_ID, SYSTEM_ID
from wrim_g20m import D_MODEL, RMSNorm
from wrim_g20m_uh1 import WRIMUH1Model
from wrim_rmr1 import (
    FALLBACK_MODE,
    MODE_NATURAL,
    MODE_STRUCTURED,
    RMR1_ARCH_ID,
    RMR1_INPUT_DIM,
    RMR1_INPUT_TYPE,
    RMR1_PARAM_CEILING,
    RMR1_PARAM_EXPECTED,
    RMR1_PREFIX,
    RMR1_VERSION,
    ResponseModeRouter,
    decide_from_logits,
)

ARCH_ID_RA1 = "WRIM-G-20M-v1-option-A-UH1-AC2-RA1"
ARCH_ID_EA1_RA1 = "WRIM-G-20M-v1-option-A-UH1-AC2-EA1-RA1"
ARCH_ID_EA1_RA1_NA1 = "WRIM-G-20M-v1-option-A-UH1-AC2-EA1-RA1-NA1"
ARCH_ID_EA1_RA1_NE1 = "WRIM-G-20M-v1-option-A-UH1-AC2-EA1-RA1-NE1"
ARCH_ID_EA1_RA1_NE1_IR1 = "WRIM-G-20M-v1-option-A-UH1-AC2-EA1-RA1-NE1-IR1"
ARCH_ID_EA1_RA1_NE1_IIA1 = "WRIM-G-20M-v1-option-A-UH1-AC2-EA1-RA1-NE1-IIA1"
ARCH_ID_EA1_RA1_RMR1 = "WRIM-G-20M-v1-option-A-UH1-AC2-EA1-RA1-RMR1"
ARCH_ID_RA1B64 = "WRIM-G-20M-v1-option-A-UH1-AC2-RA1B64"
RA1_PARAM_CEILING = 40_000
EA1_PARAM_CEILING = 40_000
NA1_PARAM_CEILING = 40_000
NE1_PARAM_CEILING = 40_000
IR1_PARAM_CEILING = 40_000
IIA1_PARAM_CEILING = 50_000
IIA1_PARAM_PREFERRED = 25_000
IIA1_BOTTLENECK = 8
IIA1_LAYER_IDS = (14, 15, 16, 17)  # last 4 of 18; 0-based = 1-based 15–18
BR1_LAYER_IDS = (14, 15, 16, 17)
BR1_EXPECTED_PARAMS = 3_409_920  # 4 blocks * 852480 (attn 4x256^2 + SwiGLU 3x256*768 + 2 norms)
ADAPTER_PARAM_CEILING = 80_000
RA1_BOTTLENECK_DEFAULT = 32
RA1_BOTTLENECK_MAX = 64
PLACEMENT_B = "pre_lm_head"
PLACEMENT_A = "post_layers"
PLACEMENTS = (PLACEMENT_B, PLACEMENT_A)
RA1_PREFIX = "ra1."
EA1_PREFIX = "ea1."
NA1_PREFIX = "na1."
NE1_PREFIX = "ne1."
IR1_PREFIX = "ir1."
IIA1_PREFIX = "iia1."
ADAPTER_PREFIXES = (RA1_PREFIX, EA1_PREFIX, NA1_PREFIX, NE1_PREFIX, IR1_PREFIX, IIA1_PREFIX, RMR1_PREFIX)
ROUTE_RA1 = "ra1"
ROUTE_NA1 = "na1"
ROUTE_BYPASS = "bypass"
ROUTE_IR1 = "ir1"
ENTRY_EA1 = "ea1"
ENTRY_NE1 = "ne1"
ENTRY_IR1 = "ir1"
ENTRY_NONE = "none"
ORACLE_IR1_VERSION = "SCHOOL-09-IR1-ORACLE-FULL-RESPONSE-v1"
ORACLE_GATE_CLASS = "CAPACITY_PROOF_ONLY"
ORACLE_GATE_VERSION = "MOD-01-ORACLE-TASK-GROUP-v1"
ROUTING_VERSION_RMR1 = RMR1_VERSION


class ResponseAdapter1(nn.Module):
    """Adapter(h) = W_up(SiLU(W_down(RMSNorm(h)))). W_up is zero at init."""

    def __init__(self, d_model: int = D_MODEL, bottleneck: int = RA1_BOTTLENECK_DEFAULT) -> None:
        super().__init__()
        if bottleneck < 1 or bottleneck > RA1_BOTTLENECK_MAX:
            raise ValueError(f"unauthorized bottleneck {bottleneck}")
        self.d_model = int(d_model)
        self.bottleneck = int(bottleneck)
        self.norm = RMSNorm(d_model)
        self.down = nn.Linear(d_model, bottleneck, bias=False)
        self.up = nn.Linear(bottleneck, d_model, bias=False)
        self.reset_zero_init()

    def reset_zero_init(self) -> None:
        nn.init.kaiming_uniform_(self.down.weight, a=math.sqrt(5))
        nn.init.zeros_(self.up.weight)
        with torch.no_grad():
            self.norm.weight.fill_(1.0)

    def delta(self, h: torch.Tensor) -> torch.Tensor:
        return self.up(F.silu(self.down(self.norm(h))))

    def param_count(self) -> int:
        return int(sum(p.numel() for p in self.parameters()))


class WRIMRA1Model(WRIMUH1Model):
    """UH1-AC2 plus a removable assistant-span residual adapter.

    Optional EA1 is a zero-init residual at the assistant entry position that
    predicts token 1. RA1 remains span-gated for token 2+.
    """

    def __init__(
        self,
        *,
        placement: str = PLACEMENT_B,
        bottleneck: int = RA1_BOTTLENECK_DEFAULT,
        ea1: bool = False,
        ea1_bottleneck: int = RA1_BOTTLENECK_DEFAULT,
        na1: bool = False,
        na1_bottleneck: int = RA1_BOTTLENECK_DEFAULT,
        ne1: bool = False,
        ne1_bottleneck: int = RA1_BOTTLENECK_DEFAULT,
        ir1: bool = False,
        ir1_bottleneck: int = RA1_BOTTLENECK_DEFAULT,
        iia1: bool = False,
        iia1_bottleneck: int = IIA1_BOTTLENECK,
        iia1_layer_ids: tuple[int, ...] = IIA1_LAYER_IDS,
        rmr1: bool = False,
    ) -> None:
        super().__init__(assistant_control=True, span_control=True, stop_control=False)
        if placement not in PLACEMENTS:
            raise ValueError(f"unauthorized placement {placement}")
        self.placement = str(placement)
        self.ra1 = ResponseAdapter1(D_MODEL, bottleneck)
        n = self.ra1.param_count()
        if n > RA1_PARAM_CEILING:
            raise RuntimeError(f"RA1 param count {n} exceeds ceiling {RA1_PARAM_CEILING}")
        self.ea1: ResponseAdapter1 | None = None
        self.na1: ResponseAdapter1 | None = None
        self.ne1: ResponseAdapter1 | None = None
        self.ir1: ResponseAdapter1 | None = None
        self.iia1: nn.ModuleDict | None = None
        self.iia1_layer_ids: tuple[int, ...] = ()
        self.iia1_active = False
        self.rmr1: ResponseModeRouter | None = None
        self.span_route = ROUTE_RA1
        self.span_route_schedule: list[str] | None = None
        self.entry_route = ENTRY_EA1
        self.last_route_fallbacks = 0
        self.last_entry_fallbacks = 0
        self.last_rmr_fallbacks = 0
        self.last_rmr_modes: list[str] = []
        self.last_rmr_p_natural: list[float | None] = []
        self.last_rmr_reasons: list[str] = []
        self._rmr_ra1_mask: torch.Tensor | None = None
        self.rmr_infer = False
        self.rmr_threshold: float | None = None
        self.rmr_version = RMR1_VERSION
        self.rmr_input_type = RMR1_INPUT_TYPE
        self.rmr_fallback = FALLBACK_MODE
        self.routing_policy = "FAIL_CLOSED_RA1"
        self.oracle_gate_class = ORACLE_GATE_CLASS
        self.oracle_gate_version = ORACLE_GATE_VERSION
        if ea1:
            self.ea1 = ResponseAdapter1(D_MODEL, ea1_bottleneck)
            n_ea1 = self.ea1.param_count()
            if n_ea1 > EA1_PARAM_CEILING:
                raise RuntimeError(f"EA1 param count {n_ea1} exceeds ceiling {EA1_PARAM_CEILING}")
        if na1:
            self.na1 = ResponseAdapter1(D_MODEL, na1_bottleneck)
            n_na1 = self.na1.param_count()
            if n_na1 > NA1_PARAM_CEILING:
                raise RuntimeError(f"NA1 param count {n_na1} exceeds ceiling {NA1_PARAM_CEILING}")
        if ne1:
            self.ne1 = ResponseAdapter1(D_MODEL, ne1_bottleneck)
            n_ne1 = self.ne1.param_count()
            if n_ne1 > NE1_PARAM_CEILING:
                raise RuntimeError(f"NE1 param count {n_ne1} exceeds ceiling {NE1_PARAM_CEILING}")
        if ir1:
            self.ir1 = ResponseAdapter1(D_MODEL, ir1_bottleneck)
            n_ir1 = self.ir1.param_count()
            if n_ir1 > IR1_PARAM_CEILING:
                raise RuntimeError(f"IR1 param count {n_ir1} exceeds ceiling {IR1_PARAM_CEILING}")
        if iia1:
            ids = tuple(int(i) for i in iia1_layer_ids)
            if any(i < 0 or i >= len(self.layers) for i in ids):
                raise ValueError(f"IIA1 layer ids {ids} out of range for {len(self.layers)} layers")
            self.iia1_layer_ids = ids
            self.iia1 = nn.ModuleDict({str(i): ResponseAdapter1(D_MODEL, int(iia1_bottleneck)) for i in ids})
            n_iia1 = int(sum(p.numel() for p in self.iia1.parameters()))
            if n_iia1 > IIA1_PARAM_CEILING:
                raise RuntimeError(f"IIA1 param count {n_iia1} exceeds ceiling {IIA1_PARAM_CEILING}")
        if rmr1:
            self.rmr1 = ResponseModeRouter(D_MODEL)
            n_rmr = self.rmr1.param_count()
            if n_rmr != RMR1_PARAM_EXPECTED:
                raise RuntimeError(f"RMR1 param count {n_rmr} != expected {RMR1_PARAM_EXPECTED}")
            if n_rmr > RMR1_PARAM_CEILING:
                raise RuntimeError(f"RMR1 param count {n_rmr} exceeds ceiling {RMR1_PARAM_CEILING}")
        if self.iia1 is not None:
            self.architecture_id = ARCH_ID_EA1_RA1_NE1_IIA1
            self.oracle_gate_version = "SCHOOL-09-IIA1-ORACLE-INTERNAL-v1"
            self.routing_policy = "ORACLE_INSTRUCTION_IIA1_INTERNAL"
        elif self.ir1 is not None:
            suffix = "" if self.ir1.bottleneck == 32 else f"B{self.ir1.bottleneck}"
            self.architecture_id = ARCH_ID_EA1_RA1_NE1_IR1 + suffix
            self.oracle_gate_version = ORACLE_IR1_VERSION
            self.routing_policy = "ORACLE_INSTRUCTION_IR1_FULL_RESPONSE"
        elif self.rmr1 is not None and self.ea1 is not None:
            self.architecture_id = ARCH_ID_EA1_RA1_RMR1
        elif self.ea1 is not None and self.ne1 is not None:
            self.architecture_id = ARCH_ID_EA1_RA1_NE1
        elif self.ea1 is not None and self.na1 is not None:
            self.architecture_id = ARCH_ID_EA1_RA1_NA1
        elif self.ea1 is not None:
            self.architecture_id = ARCH_ID_EA1_RA1
        elif bottleneck == 32:
            self.architecture_id = ARCH_ID_RA1
        else:
            self.architecture_id = f"WRIM-G-20M-v1-option-A-UH1-AC2-RA1B{bottleneck}"

    def _apply_controls(self, x: torch.Tensor, idx: torch.Tensor) -> torch.Tensor:
        if not (self.assistant_control and self.assistant_ctrl is not None):
            return x
        masks = self.control_masks(idx)
        is_ast = masks["entry"].unsqueeze(-1).to(dtype=x.dtype)
        x = x + is_ast * self.assistant_ctrl
        if self.span_control and self.assistant_span_ctrl is not None:
            span = masks["span"].unsqueeze(-1).to(dtype=x.dtype)
            x = x + span * self.assistant_span_ctrl
        return x

    def set_span_route(self, route: str, schedule: list[str] | None = None) -> None:
        """Per-response latch. Unknown routes fail closed to RA1.

        bypass is diagnostic-only: EA1 stays on, RA1 and NA1 both off.
        """
        self.span_route_schedule = list(schedule) if schedule else None
        if route == ROUTE_BYPASS:
            self.span_route = ROUTE_BYPASS
            return
        if route == ROUTE_IR1:
            if self.ir1 is None:
                self.span_route = ROUTE_RA1
                self.last_route_fallbacks += 1
                return
            self.span_route = ROUTE_IR1
            return
        if route not in {ROUTE_RA1, ROUTE_NA1}:
            self.span_route = ROUTE_RA1
            self.last_route_fallbacks += 1
            return
        if route == ROUTE_NA1 and self.na1 is None:
            self.span_route = ROUTE_RA1
            self.last_route_fallbacks += 1
            return
        self.span_route = route

    def set_entry_route(self, route: str) -> None:
        """Diagnostic/oracle entry policy. Unknown routes fail closed to EA1."""
        if route not in {ENTRY_EA1, ENTRY_NE1, ENTRY_IR1, ENTRY_NONE}:
            self.entry_route = ENTRY_EA1
            self.last_entry_fallbacks += 1
            return
        if route == ENTRY_IR1 and self.ir1 is None:
            self.entry_route = ENTRY_EA1 if self.ea1 is not None else ENTRY_NONE
            self.last_entry_fallbacks += 1
            return
        if route == ENTRY_NE1 and self.ne1 is None:
            self.entry_route = ENTRY_EA1 if self.ea1 is not None else ENTRY_NONE
            self.last_entry_fallbacks += 1
            return
        if route == ENTRY_EA1 and self.ea1 is None:
            self.entry_route = ENTRY_NONE
            self.last_entry_fallbacks += 1
            return
        self.entry_route = route

    def enable_learned_router(self, threshold: float, version: str = RMR1_VERSION) -> None:
        """Latch RMR1 at assistant entry. Disabled/untrusted states stay STRUCTURED."""
        self.rmr_version = str(version)
        self.rmr_threshold = float(threshold) if threshold is not None else None
        self.rmr_infer = True
        self._rmr_ra1_mask = None

    def disable_learned_router(self) -> None:
        self.rmr_infer = False
        self._rmr_ra1_mask = None
        self.last_rmr_modes = []
        self.last_rmr_p_natural = []
        self.last_rmr_reasons = []

    def _apply_rmr_from_pre(self, idx: torch.Tensor, pre: torch.Tensor) -> None:
        """Decide once per assistant entry from pre_ea1; latch until EOS. Fail closed STRUCTURED."""
        masks = self.control_masks(idx)
        span = masks["span"]
        is_ast = masks["entry"]
        is_reset = (idx == EOS_ID) | (idx == COMMANDER_ID) | (idx == BOS_ID) | (idx == SYSTEM_ID)
        ra1_m = torch.zeros_like(span)
        bsz, seq = idx.shape
        latch = [MODE_STRUCTURED] * bsz
        modes: list[str] = []
        probs: list[float | None] = []
        reasons: list[str] = []
        fallbacks = 0
        trusted = (
            self.rmr1 is not None
            and self.rmr_version == RMR1_VERSION
            and self.rmr_threshold is not None
            and math.isfinite(float(self.rmr_threshold))
        )
        if not trusted:
            fallbacks += 1
            ra1_m = span.clone()
            self._rmr_ra1_mask = ra1_m
            self.last_rmr_fallbacks = fallbacks
            self.last_rmr_modes = [MODE_STRUCTURED]
            self.last_rmr_p_natural = [None]
            self.last_rmr_reasons = ["untrusted_router"]
            return
        for t in range(seq):
            for b in range(bsz):
                if bool(is_ast[b, t].item()):
                    logits = self.rmr1(pre[b, t])
                    mode, p_nat, reason = decide_from_logits(
                        logits,
                        threshold=self.rmr_threshold,
                        version=self.rmr_version,
                    )
                    latch[b] = mode
                    modes.append(mode)
                    probs.append(p_nat)
                    reasons.append(reason)
                    if reason != "ok" and mode == MODE_STRUCTURED:
                        fallbacks += 1
                if bool(span[b, t].item()):
                    if latch[b] == MODE_STRUCTURED:
                        ra1_m[b, t] = True
                if bool(is_reset[b, t].item()):
                    latch[b] = MODE_STRUCTURED
        self._rmr_ra1_mask = ra1_m
        self.last_rmr_fallbacks = fallbacks
        self.last_rmr_modes = modes
        self.last_rmr_p_natural = probs
        self.last_rmr_reasons = reasons

    def _span_route_masks(self, idx: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """Top-1 RA1 xor NA1 on assistant span. Latch until EOS / role reset."""
        masks = self.control_masks(idx)
        span = masks["span"]
        is_ast = masks["entry"]
        use_na1 = self.na1 is not None
        if self.rmr_infer:
            if self._rmr_ra1_mask is not None and self._rmr_ra1_mask.shape == span.shape:
                return self._rmr_ra1_mask, torch.zeros_like(span)
            self.last_rmr_fallbacks += 1
            return span.clone(), torch.zeros_like(span)
        if self.span_route_schedule is None:
            # Constant per-batch oracle: every response in the sequence uses the same expert.
            self.last_route_fallbacks = 0
            if self.span_route == ROUTE_BYPASS or self.span_route == ROUTE_IR1:
                z = torch.zeros_like(span)
                return z, z
            if self.span_route == ROUTE_NA1 and use_na1:
                return torch.zeros_like(span), span
            return span.clone(), torch.zeros_like(span)
        is_reset = (idx == EOS_ID) | (idx == COMMANDER_ID) | (idx == BOS_ID) | (idx == SYSTEM_ID)
        bsz, seq = idx.shape
        ra1_m = torch.zeros_like(span)
        na1_m = torch.zeros_like(span)
        fallbacks = 0
        latch = [ROUTE_RA1] * bsz
        resp_i = [0] * bsz
        for t in range(seq):
            for b in range(bsz):
                if bool(is_ast[b, t].item()):
                    choice = self.span_route
                    if resp_i[b] < len(self.span_route_schedule):
                        choice = self.span_route_schedule[resp_i[b]]
                    else:
                        choice = ROUTE_RA1
                        fallbacks += 1
                    if choice == ROUTE_BYPASS:
                        latch[b] = ROUTE_BYPASS
                    elif choice == ROUTE_NA1 and use_na1:
                        latch[b] = ROUTE_NA1
                    elif choice == ROUTE_RA1:
                        latch[b] = ROUTE_RA1
                    else:
                        latch[b] = ROUTE_RA1
                        fallbacks += 1
                    resp_i[b] += 1
                if bool(span[b, t].item()):
                    if latch[b] == ROUTE_NA1 and use_na1:
                        na1_m[b, t] = True
                    elif latch[b] == ROUTE_RA1:
                        ra1_m[b, t] = True
                if bool(is_reset[b, t].item()):
                    latch[b] = ROUTE_RA1
        self.last_route_fallbacks = fallbacks
        if bool((ra1_m & na1_m).any().item()):
            raise RuntimeError("RA1 and NA1 activated on the same span position")
        return ra1_m, na1_m

    def _ra1_residual(self, x: torch.Tensor, idx: torch.Tensor) -> torch.Tensor:
        ra1_m, na1_m = self._span_route_masks(idx)
        out = x
        if bool(ra1_m.any().item()):
            out = out + ra1_m.unsqueeze(-1).to(dtype=x.dtype) * self.ra1.delta(x)
        if self.na1 is not None and bool(na1_m.any().item()):
            out = out + na1_m.unsqueeze(-1).to(dtype=x.dtype) * self.na1.delta(x)
        return out

    def _ea1_residual(self, x: torch.Tensor, idx: torch.Tensor) -> torch.Tensor:
        if self.entry_route in {ENTRY_NONE, ENTRY_IR1}:
            return x
        entry = self.control_masks(idx)["entry"].unsqueeze(-1).to(dtype=x.dtype)
        if self.entry_route == ENTRY_NE1:
            if self.ne1 is None:
                return x
            return x + entry * self.ne1.delta(x)
        if self.ea1 is None:
            return x
        return x + entry * self.ea1.delta(x)

    def _ir1_residual(self, x: torch.Tensor, idx: torch.Tensor) -> torch.Tensor:
        """Full assistant response: token1 through the last pre-EOS span position."""
        if self.ir1 is None:
            return x
        if self.entry_route != ENTRY_IR1 or self.span_route != ROUTE_IR1:
            return x
        masks = self.control_masks(idx)
        full = (masks["entry"] | masks["span"]).unsqueeze(-1).to(dtype=x.dtype)
        return x + full * self.ir1.delta(x)

    def set_instruction_oracle(self) -> None:
        self.set_entry_route(ENTRY_IR1)
        self.set_span_route(ROUTE_IR1)

    def set_iia1_active(self, active: bool) -> None:
        self.iia1_active = bool(active) and self.iia1 is not None

    def set_iia1_instruction_oracle(self, entry: str = ENTRY_NE1, span: str = ROUTE_BYPASS) -> None:
        """Instruction capacity route: IIA1 on in selected layers; frozen output adapters only."""
        self.set_iia1_active(True)
        self.set_entry_route(entry)
        self.set_span_route(span)

    def _run_layers(self, x: torch.Tensor) -> torch.Tensor:
        # Placement C: one residual adapter at each selected block output (after attn+FFN residuals).
        for i, layer in enumerate(self.layers):
            x = layer(x)
            if self.iia1 is not None and self.iia1_active and i in self.iia1_layer_ids:
                x = x + self.iia1[str(i)].delta(x)
        return x

    def hidden_pre_adapters(self, idx: torch.Tensor) -> torch.Tensor:
        """Hidden after layers/norm/UH1 controls, before RA1/EA1/NA1 at placement B."""
        x = self.tok_emb(idx)
        x = self._run_layers(x)
        x = self.norm_f(x)
        x = self._apply_controls(x, idx)
        return x

    def hidden(self, idx: torch.Tensor) -> torch.Tensor:
        x = self.tok_emb(idx)
        x = self._run_layers(x)
        if self.placement == PLACEMENT_A:
            x = self._ra1_residual(x, idx)
            x = self._ea1_residual(x, idx)
            x = self._ir1_residual(x, idx)
        x = self.norm_f(x)
        x = self._apply_controls(x, idx)
        if self.rmr_infer:
            self._apply_rmr_from_pre(idx, x)
        if self.placement == PLACEMENT_B:
            x = self._ra1_residual(x, idx)
            x = self._ea1_residual(x, idx)
            x = self._ir1_residual(x, idx)
        return x


def ra1_param_names(model: WRIMRA1Model) -> list[str]:
    return [n for n, _ in model.named_parameters() if n.startswith(RA1_PREFIX)]


def freeze_base_train_ra1(
    model: WRIMRA1Model,
    *,
    train_ea1: bool = False,
    train_ra1: bool = True,
    train_na1: bool = False,
    train_ne1: bool = False,
    train_ir1: bool = False,
    train_iia1: bool = False,
    train_rmr: bool = False,
) -> dict[str, Any]:
    model.train()
    if train_rmr and (train_ea1 or train_ra1 or train_na1 or train_ne1 or train_ir1 or train_iia1):
        raise RuntimeError("RMR1 cannot train with WRIM adapters")
    if train_ne1 and (train_ea1 or train_ra1 or train_na1 or train_rmr or train_ir1 or train_iia1):
        raise RuntimeError("NE1 trains alone")
    if train_ir1 and (train_ea1 or train_ra1 or train_na1 or train_ne1 or train_rmr or train_iia1):
        raise RuntimeError("IR1 trains alone")
    if train_iia1 and (train_ea1 or train_ra1 or train_na1 or train_ne1 or train_ir1 or train_rmr):
        raise RuntimeError("IIA1 trains alone")
    trainable: list[str] = []
    for n, p in model.named_parameters():
        train = (
            (train_ra1 and n.startswith(RA1_PREFIX))
            or (train_ea1 and n.startswith(EA1_PREFIX))
            or (train_na1 and n.startswith(NA1_PREFIX))
            or (train_ne1 and n.startswith(NE1_PREFIX))
            or (train_ir1 and n.startswith(IR1_PREFIX))
            or (train_iia1 and n.startswith(IIA1_PREFIX))
            or (train_rmr and n.startswith(RMR1_PREFIX))
        )
        p.requires_grad_(train)
        if train:
            trainable.append(n)
    n_train = int(sum(p.numel() for p in model.parameters() if p.requires_grad))
    n_total = int(sum(p.numel() for p in model.parameters()))
    n_ra1 = int(sum(p.numel() for n, p in model.named_parameters() if n.startswith(RA1_PREFIX)))
    n_ea1 = int(sum(p.numel() for n, p in model.named_parameters() if n.startswith(EA1_PREFIX)))
    n_na1 = int(sum(p.numel() for n, p in model.named_parameters() if n.startswith(NA1_PREFIX)))
    n_ne1 = int(sum(p.numel() for n, p in model.named_parameters() if n.startswith(NE1_PREFIX)))
    n_ir1 = int(sum(p.numel() for n, p in model.named_parameters() if n.startswith(IR1_PREFIX)))
    n_iia1 = int(sum(p.numel() for n, p in model.named_parameters() if n.startswith(IIA1_PREFIX)))
    n_rmr = int(sum(p.numel() for n, p in model.named_parameters() if n.startswith(RMR1_PREFIX)))
    if n_ra1 > RA1_PARAM_CEILING:
        raise RuntimeError(f"RA1 param count {n_ra1} exceeds ceiling {RA1_PARAM_CEILING}")
    if n_ea1 > EA1_PARAM_CEILING:
        raise RuntimeError(f"EA1 param count {n_ea1} exceeds ceiling {EA1_PARAM_CEILING}")
    if n_na1 > NA1_PARAM_CEILING:
        raise RuntimeError(f"NA1 param count {n_na1} exceeds ceiling {NA1_PARAM_CEILING}")
    if n_ne1 > NE1_PARAM_CEILING:
        raise RuntimeError(f"NE1 param count {n_ne1} exceeds ceiling {NE1_PARAM_CEILING}")
    if n_ir1 > IR1_PARAM_CEILING:
        raise RuntimeError(f"IR1 param count {n_ir1} exceeds ceiling {IR1_PARAM_CEILING}")
    if n_iia1 > IIA1_PARAM_CEILING:
        raise RuntimeError(f"IIA1 param count {n_iia1} exceeds ceiling {IIA1_PARAM_CEILING}")
    if n_rmr > RMR1_PARAM_CEILING:
        raise RuntimeError(f"RMR1 param count {n_rmr} exceeds ceiling {RMR1_PARAM_CEILING}")
    if train_rmr and n_rmr != RMR1_PARAM_EXPECTED:
        raise RuntimeError(f"RMR1 param count {n_rmr} != expected {RMR1_PARAM_EXPECTED}")
    if train_rmr:
        if n_train != n_rmr:
            raise RuntimeError(f"RMR1 training leaked non-router params: {n_train} vs {n_rmr}")
    elif train_ne1:
        if n_train != n_ne1:
            raise RuntimeError(f"NE1 training leaked non-NE1 params: {n_train} vs {n_ne1}")
    elif train_ir1:
        if n_train != n_ir1:
            raise RuntimeError(f"IR1 training leaked non-IR1 params: {n_train} vs {n_ir1}")
    elif train_iia1:
        if n_train != n_iia1:
            raise RuntimeError(f"IIA1 training leaked non-IIA1 params: {n_train} vs {n_iia1}")
    elif n_train > ADAPTER_PARAM_CEILING:
        raise RuntimeError(f"trainable adapters {n_train} exceed ceiling {ADAPTER_PARAM_CEILING}")
    leaked = [
        n
        for n, p in model.named_parameters()
        if p.requires_grad and not n.startswith(ADAPTER_PREFIXES)
    ]
    if leaked:
        raise RuntimeError(f"non-adapter trainable: {leaked}")
    return {
        "TRAINABLE_NAMES": trainable,
        "TRAINABLE_PARAMETER_COUNT": n_train,
        "TOTAL_PARAMETER_COUNT": n_total,
        "RA1_PARAMETER_COUNT": n_ra1,
        "EA1_PARAMETER_COUNT": n_ea1,
        "NA1_PARAMETER_COUNT": n_na1,
        "NE1_PARAMETER_COUNT": n_ne1,
        "IR1_PARAMETER_COUNT": n_ir1,
        "IIA1_PARAMETER_COUNT": n_iia1,
        "ROUTER_PARAMETER_COUNT": n_rmr,
        "RA1_BOTTLENECK": model.ra1.bottleneck,
        "EA1_BOTTLENECK": model.ea1.bottleneck if model.ea1 is not None else None,
        "NA1_BOTTLENECK": model.na1.bottleneck if model.na1 is not None else None,
        "NE1_BOTTLENECK": model.ne1.bottleneck if model.ne1 is not None else None,
        "IR1_BOTTLENECK": model.ir1.bottleneck if model.ir1 is not None else None,
        "IIA1_BOTTLENECK": next(iter(model.iia1.values())).bottleneck if model.iia1 else None,
        "IIA1_LAYER_IDS": list(model.iia1_layer_ids) if model.iia1 is not None else [],
        "RA1_PLACEMENT": model.placement,
        "ARCHITECTURE_ID": model.architecture_id,
        "BASE_FROZEN": True,
        "TRAIN_EA1": train_ea1,
        "TRAIN_RA1": train_ra1,
        "TRAIN_NA1": train_na1,
        "TRAIN_NE1": train_ne1,
        "TRAIN_IR1": train_ir1,
        "TRAIN_IIA1": train_iia1,
        "TRAIN_RMR": train_rmr,
        "ROUTING_POLICY": model.routing_policy,
        "ORACLE_GATE_CLASS": model.oracle_gate_class,
        "ORACLE_GATE_VERSION": model.oracle_gate_version,
        "RMR1_ARCH_ID": RMR1_ARCH_ID if model.rmr1 is not None else None,
        "RMR1_INPUT_TYPE": RMR1_INPUT_TYPE if model.rmr1 is not None else None,
        "RMR1_INPUT_DIM": RMR1_INPUT_DIM if model.rmr1 is not None else None,
    }


def adapter_prefixes(name: str) -> bool:
    return name.startswith(ADAPTER_PREFIXES)


def module_parameter_hash(model: nn.Module, prefix: str) -> str:
    h = hashlib.sha256()
    found = False
    for n, p in sorted(model.named_parameters(), key=lambda kv: kv[0]):
        if not n.startswith(prefix):
            continue
        found = True
        h.update(n.encode("utf-8"))
        h.update(p.detach().cpu().contiguous().numpy().tobytes())
    return h.hexdigest() if found else "ABSENT"


def frozen_parameter_hash(model: nn.Module) -> str:
    h = hashlib.sha256()
    for n, p in sorted(model.named_parameters(), key=lambda kv: kv[0]):
        if n.startswith(ADAPTER_PREFIXES):
            continue
        h.update(n.encode("utf-8"))
        h.update(p.detach().cpu().contiguous().numpy().tobytes())
    return h.hexdigest()


def ra1_l2(model: WRIMRA1Model, start: dict[str, torch.Tensor] | None = None) -> float:
    acc = 0.0
    for n, p in model.named_parameters():
        if not n.startswith(RA1_PREFIX):
            continue
        cur = p.detach().float().cpu()
        if start is None:
            ref = torch.zeros_like(cur)
        else:
            ref = start[n].detach().float().cpu()
        acc += float((cur - ref).pow(2).sum().item())
    return float(acc ** 0.5)


def global_weight_l2(model: nn.Module, parent: dict[str, torch.Tensor]) -> float:
    acc = 0.0
    for n, p in model.named_parameters():
        if n.startswith(ADAPTER_PREFIXES):
            continue
        if n not in parent:
            raise RuntimeError(f"frozen key missing from parent: {n}")
        acc += float((p.detach().float().cpu() - parent[n].detach().float().cpu()).pow(2).sum().item())
    return float(acc ** 0.5)


def is_br1_trainable_name(name: str, layer_ids: tuple[int, ...] = BR1_LAYER_IDS) -> bool:
    return any(name.startswith(f"layers.{i}.") for i in layer_ids)


def freeze_base_train_br1(
    model: WRIMRA1Model,
    *,
    layer_ids: tuple[int, ...] = BR1_LAYER_IDS,
) -> dict[str, Any]:
    """Train original parameters in selected upper transformer blocks only."""
    model.train()
    if getattr(model, "iia1", None) is not None:
        raise RuntimeError("BR1 must not install IIA1")
    if getattr(model, "ir1", None) is not None:
        raise RuntimeError("BR1 must not install IR1")
    if getattr(model, "rmr1", None) is not None:
        raise RuntimeError("BR1 must not install RMR1")
    trainable: list[str] = []
    leaked_adapter: list[str] = []
    for n, p in model.named_parameters():
        train = is_br1_trainable_name(n, layer_ids)
        if train and n.startswith(ADAPTER_PREFIXES):
            leaked_adapter.append(n)
        p.requires_grad_(train)
        if train:
            trainable.append(n)
    if leaked_adapter:
        raise RuntimeError(f"BR1 leaked adapter params: {leaked_adapter}")
    n_train = int(sum(p.numel() for p in model.parameters() if p.requires_grad))
    n_total = int(sum(p.numel() for p in model.parameters()))
    if set(layer_ids) != set(BR1_LAYER_IDS):
        raise RuntimeError(f"BR1 layer ids {layer_ids} != authorized {BR1_LAYER_IDS}")
    if n_train != BR1_EXPECTED_PARAMS:
        raise RuntimeError(f"BR1 trainable {n_train} != expected {BR1_EXPECTED_PARAMS}")
    leaked = [n for n, p in model.named_parameters() if p.requires_grad and not is_br1_trainable_name(n, layer_ids)]
    if leaked:
        raise RuntimeError(f"BR1 leaked non-upper-block params: {leaked}")
    forbidden = ("tok_emb", "lm_head", "norm_f", "assistant_ctrl", "assistant_span", "ea1.", "ra1.", "ne1.", "na1.")
    if any(n.startswith(forbidden) or n in {"assistant_ctrl", "assistant_span_ctrl"} for n in trainable):
        raise RuntimeError(f"BR1 trained frozen module: {trainable}")
    return {
        "TRAINABLE_NAMES": trainable,
        "TRAINABLE_PARAMETER_COUNT": n_train,
        "TOTAL_PARAMETER_COUNT": n_total,
        "TRAINABLE_PERCENT_MODEL": round(100.0 * n_train / max(1, n_total), 4),
        "BR1_LAYER_IDS": list(layer_ids),
        "EST_OPTIMIZER_STATE_BYTES": int(n_train * 4 * 3),
        "EST_PARAM_BYTES": int(n_train * 4),
        "BASE_FROZEN_EXCEPT_UPPER4": True,
        "TRAIN_IIA1": False,
        "TRAIN_IR1": False,
        "TRAIN_NE1": False,
        "TRAIN_EA1": False,
        "TRAIN_RA1": False,
        "LM_HEAD_TRAINED": False,
        "ARCHITECTURE_ID": model.architecture_id,
    }


def named_parameter_hash(model: nn.Module, pred) -> str:
    h = hashlib.sha256()
    found = False
    for n, p in sorted(model.named_parameters(), key=lambda kv: kv[0]):
        if not pred(n):
            continue
        found = True
        h.update(n.encode("utf-8"))
        h.update(p.detach().cpu().contiguous().numpy().tobytes())
    return h.hexdigest() if found else "ABSENT"


def frozen_except_br1_hash(model: nn.Module, layer_ids: tuple[int, ...] = BR1_LAYER_IDS) -> str:
    return named_parameter_hash(model, lambda n: not is_br1_trainable_name(n, layer_ids))


def layer_update_norms(model: nn.Module, parent: dict[str, torch.Tensor], layer_ids: tuple[int, ...] = BR1_LAYER_IDS) -> dict[str, Any]:
    per: dict[str, dict[str, float]] = {}
    max_rel = 0.0
    max_abs = 0.0
    for i in layer_ids:
        prefix = f"layers.{i}."
        acc = 0.0
        base = 0.0
        attn = 0.0
        ffn = 0.0
        for n, p in model.named_parameters():
            if not n.startswith(prefix):
                continue
            cur = p.detach().float().cpu()
            ref = parent[n].detach().float().cpu()
            d = float((cur - ref).pow(2).sum().item())
            b = float(ref.pow(2).sum().item())
            acc += d
            base += b
            if ".attn." in n and ".attn_norm" not in n:
                attn += d
            if ".ffn." in n and ".ffn_norm" not in n:
                ffn += d
        abs_n = float(acc ** 0.5)
        rel = abs_n / max(base ** 0.5, 1e-12)
        per[str(i)] = {"abs": abs_n, "rel": rel, "attn_abs": float(attn ** 0.5), "ffn_abs": float(ffn ** 0.5)}
        max_rel = max(max_rel, rel)
        max_abs = max(max_abs, abs_n)
    return {"per_layer": per, "max_rel": max_rel, "max_abs": max_abs}
