"""WRIM-G-20M-v1-option-A PyTorch port. Inference-only. No optimizer. No training.

Semantics match recovered MLX wrim0_architecture.py and isolated numpy smoke:
pre-RMSNorm decoder, SwiGLU, RoPE traditional=False rotate-half, tied embeddings,
reference attention (explicit scores + causal mask + softmax). Not PyTorch SDPA.
"""
from __future__ import annotations

import math
import torch
import torch.nn as nn
import torch.nn.functional as F

VOCAB_SIZE = 15126
D_MODEL = 256
N_LAYERS = 18
N_HEADS = 4
HEAD_DIM = 64
D_FF = 768
ROPE_THETA = 10000.0
CONTEXT_LENGTH = 512
RMSNORM_EPS = 1e-5
INNER = N_HEADS * HEAD_DIM


class RMSNorm(nn.Module):
    def __init__(self, dim: int, eps: float = RMSNORM_EPS):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim), requires_grad=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Historical numpy: var = mean(x*x); x * rsqrt(var+eps) * w
        var = x.pow(2).mean(dim=-1, keepdim=True)
        return x * torch.rsqrt(var + self.eps) * self.weight


class SwiGLU(nn.Module):
    def __init__(self, dim: int, hidden: int):
        super().__init__()
        self.gate = nn.Linear(dim, hidden, bias=False)
        self.up = nn.Linear(dim, hidden, bias=False)
        self.down = nn.Linear(hidden, dim, bias=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.down(F.silu(self.gate(x)) * self.up(x))


def apply_rope_rotate_half(q: torch.Tensor, k: torch.Tensor, theta: float = ROPE_THETA) -> tuple[torch.Tensor, torch.Tensor]:
    """MLX RoPE traditional=False: split last dim in half, rotate-half."""
    seq = q.size(2)
    dim = q.size(3)
    half = dim // 2
    device = q.device
    pos = torch.arange(seq, device=device, dtype=torch.float32)
    freqs = 1.0 / (theta ** (torch.arange(0, dim, 2, device=device, dtype=torch.float32) / dim))
    angles = pos[:, None] * freqs[None, :]
    cos = torch.cos(angles)
    sin = torch.sin(angles)

    def apply(x: torch.Tensor) -> torch.Tensor:
        x1 = x[..., :half]
        x2 = x[..., half:]
        cos_b = cos[None, None, :, :].to(dtype=x.dtype)
        sin_b = sin[None, None, :, :].to(dtype=x.dtype)
        rot0 = x1 * cos_b - x2 * sin_b
        rot1 = x2 * cos_b + x1 * sin_b
        return torch.cat([rot0, rot1], dim=-1)

    return apply(q), apply(k)


def reference_attention(q: torch.Tensor, k: torch.Tensor, v: torch.Tensor, scale: float) -> torch.Tensor:
    """Explicit causal attention matching isolated numpy (not SDPA). q/k/v: B,H,S,D."""
    scores = torch.matmul(q, k.transpose(-2, -1)) * scale
    seq = q.size(-2)
    mask = torch.triu(torch.ones(seq, seq, device=q.device, dtype=q.dtype), diagonal=1) * (-1e9)
    scores = scores + mask
    weights = torch.softmax(scores, dim=-1)
    return torch.matmul(weights, v)


class Attention(nn.Module):
    def __init__(self, dim: int, n_heads: int, head_dim: int, theta: float):
        super().__init__()
        self.n_heads = n_heads
        self.head_dim = head_dim
        inner = n_heads * head_dim
        self.q = nn.Linear(dim, inner, bias=False)
        self.k = nn.Linear(dim, inner, bias=False)
        self.v = nn.Linear(dim, inner, bias=False)
        self.o = nn.Linear(inner, dim, bias=False)
        self.theta = theta

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, s, _ = x.shape
        q = self.q(x).view(b, s, self.n_heads, self.head_dim).transpose(1, 2)
        k = self.k(x).view(b, s, self.n_heads, self.head_dim).transpose(1, 2)
        v = self.v(x).view(b, s, self.n_heads, self.head_dim).transpose(1, 2)
        q, k = apply_rope_rotate_half(q, k, self.theta)
        scale = 1.0 / math.sqrt(self.head_dim)
        out = reference_attention(q, k, v, scale)
        out = out.transpose(1, 2).contiguous().view(b, s, self.n_heads * self.head_dim)
        return self.o(out)


class Block(nn.Module):
    def __init__(self, dim: int, n_heads: int, head_dim: int, d_ff: int, theta: float):
        super().__init__()
        self.attn_norm = RMSNorm(dim)
        self.attn = Attention(dim, n_heads, head_dim, theta)
        self.ffn_norm = RMSNorm(dim)
        self.ffn = SwiGLU(dim, d_ff)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(self.attn_norm(x))
        x = x + self.ffn(self.ffn_norm(x))
        return x


class WRIM0Model(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.tok_emb = nn.Embedding(VOCAB_SIZE, D_MODEL)
        self.layers = nn.ModuleList(
            [Block(D_MODEL, N_HEADS, HEAD_DIM, D_FF, ROPE_THETA) for _ in range(N_LAYERS)]
        )
        self.norm_f = RMSNorm(D_MODEL)

    def forward(self, idx: torch.Tensor) -> torch.Tensor:
        x = self.tok_emb(idx)
        for layer in self.layers:
            x = layer(x)
        x = self.norm_f(x)
        # Tied embeddings: logits = hidden @ tok_emb.weight.T — no lm_head Parameter.
        return F.linear(x, self.tok_emb.weight)

    def freeze_inference(self) -> None:
        self.eval()
        for p in self.parameters():
            p.requires_grad_(False)


def expected_torch_keys() -> list[str]:
    keys = ["tok_emb.weight", "norm_f.weight"]
    for i in range(N_LAYERS):
        keys.extend(
            [
                f"layers.{i}.attn_norm.weight",
                f"layers.{i}.ffn_norm.weight",
                f"layers.{i}.attn.q.weight",
                f"layers.{i}.attn.k.weight",
                f"layers.{i}.attn.v.weight",
                f"layers.{i}.attn.o.weight",
                f"layers.{i}.ffn.gate.weight",
                f"layers.{i}.ffn.up.weight",
                f"layers.{i}.ffn.down.weight",
            ]
        )
    return keys
