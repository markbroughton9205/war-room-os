"""Parameterized from-scratch WRIM-1 pilot decoder. No Genesis weights."""
from __future__ import annotations

import math
from typing import Any

import torch
import torch.nn as nn
import torch.nn.functional as F

from wrim_g20m import RMSNorm, apply_rope_rotate_half, reference_attention
from wrim_pilot_ab_identity import ROPE_THETA


class PilotAttention(nn.Module):
    def __init__(self, dim: int, n_heads: int, head_dim: int, *, use_sdpa: bool):
        super().__init__()
        self.n_heads = n_heads
        self.head_dim = head_dim
        inner = n_heads * head_dim
        self.q = nn.Linear(dim, inner, bias=False)
        self.k = nn.Linear(dim, inner, bias=False)
        self.v = nn.Linear(dim, inner, bias=False)
        self.o = nn.Linear(inner, dim, bias=False)
        self.use_sdpa = bool(use_sdpa)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, s, _ = x.shape
        q = self.q(x).view(b, s, self.n_heads, self.head_dim).transpose(1, 2)
        k = self.k(x).view(b, s, self.n_heads, self.head_dim).transpose(1, 2)
        v = self.v(x).view(b, s, self.n_heads, self.head_dim).transpose(1, 2)
        q, k = apply_rope_rotate_half(q, k, ROPE_THETA)
        if self.use_sdpa:
            out = F.scaled_dot_product_attention(q, k, v, dropout_p=0.0, is_causal=True)
        else:
            out = reference_attention(q, k, v, 1.0 / math.sqrt(self.head_dim))
        out = out.transpose(1, 2).contiguous().view(b, s, self.n_heads * self.head_dim)
        return self.o(out)


class PilotSwiGLU(nn.Module):
    def __init__(self, dim: int, hidden: int):
        super().__init__()
        self.gate = nn.Linear(dim, hidden, bias=False)
        self.up = nn.Linear(dim, hidden, bias=False)
        self.down = nn.Linear(hidden, dim, bias=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.down(F.silu(self.gate(x)) * self.up(x))


class PilotBlock(nn.Module):
    def __init__(self, dim: int, n_heads: int, head_dim: int, d_ff: int, *, use_sdpa: bool):
        super().__init__()
        self.attn_norm = RMSNorm(dim)
        self.attn = PilotAttention(dim, n_heads, head_dim, use_sdpa=use_sdpa)
        self.ffn_norm = RMSNorm(dim)
        self.ffn = PilotSwiGLU(dim, d_ff)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(self.attn_norm(x))
        x = x + self.ffn(self.ffn_norm(x))
        return x


class WRIM1PilotModel(nn.Module):
    def __init__(
        self,
        *,
        vocab_size: int,
        d_model: int,
        n_layers: int,
        n_heads: int,
        head_dim: int,
        d_ff: int,
        untied: bool = True,
        use_sdpa: bool = True,
    ) -> None:
        super().__init__()
        if n_heads * head_dim != d_model:
            raise ValueError("n_heads * head_dim must equal d_model")
        self.vocab_size = int(vocab_size)
        self.d_model = int(d_model)
        self.n_layers = int(n_layers)
        self.untied = bool(untied)
        self.tok_emb = nn.Embedding(vocab_size, d_model)
        self.layers = nn.ModuleList(
            [PilotBlock(d_model, n_heads, head_dim, d_ff, use_sdpa=use_sdpa) for _ in range(n_layers)]
        )
        self.norm_f = RMSNorm(d_model)
        self.lm_head = nn.Linear(d_model, vocab_size, bias=False) if untied else None
        self.apply(self._init)

    def _init(self, module: nn.Module) -> None:
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)

    def forward(self, idx: torch.Tensor, *, return_hidden: bool = False) -> torch.Tensor | tuple[torch.Tensor, torch.Tensor]:
        x = self.tok_emb(idx)
        for layer in self.layers:
            x = layer(x)
        x = self.norm_f(x)
        if self.lm_head is None:
            logits = F.linear(x, self.tok_emb.weight)
        else:
            logits = self.lm_head(x)
        if return_hidden:
            return logits, x
        return logits

    def count_params(self) -> int:
        return int(sum(p.numel() for p in self.parameters()))


def spec_param_count(vocab: int, arch: dict[str, Any]) -> int:
    d = int(arch["d_model"])
    layers = int(arch["n_layers"])
    d_ff = int(arch["d_ff"])
    emb = vocab * d
    head = vocab * d if arch.get("untied", True) else 0
    block = 4 * d * d + 3 * d * d_ff + 2 * d
    return emb + head + layers * block + d
