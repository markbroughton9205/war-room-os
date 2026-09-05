"""WRIM-0 model architecture — decoder-only, pre-RMSNorm, RoPE, SwiGLU, tied embeddings, no bias,
no dropout, multi-head attention. Config = G-20M family per the Kimi Genesis research
(cross_verification.md "Decisions the report must make" #1), vocab sized to the real trained
WR-TOKENIZER-0 artifact rather than a hardcoded nominal value.

This module defines architecture only — no training loop, no I/O, no checkpoint logic. Imported by
init_wrim0.py, train_wrim0.py, and generate_wrim0.py so all three always share one definition.
"""
from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass

import mlx.core as mx
import mlx.nn as nn
import mlx.utils


@dataclass(frozen=True)
class WRIM0Config:
    vocab_size: int
    d_model: int = 256
    n_layers: int = 18
    n_heads: int = 4
    head_dim: int = 64
    d_ff: int = 768
    rope_theta: float = 10000.0
    context_length: int = 512

    def config_hash(self) -> str:
        canonical = json.dumps(asdict(self), sort_keys=True)
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class RMSNorm(nn.Module):
    def __init__(self, dims: int, eps: float = 1e-5):
        super().__init__()
        self.weight = mx.ones((dims,))
        self.eps = eps

    def __call__(self, x):
        return mx.fast.rms_norm(x, self.weight, self.eps)


class SwiGLU(nn.Module):
    def __init__(self, dim: int, hidden: int):
        super().__init__()
        self.gate = nn.Linear(dim, hidden, bias=False)
        self.up = nn.Linear(dim, hidden, bias=False)
        self.down = nn.Linear(hidden, dim, bias=False)

    def __call__(self, x):
        return self.down(nn.silu(self.gate(x)) * self.up(x))


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
        self.rope = nn.RoPE(head_dim, traditional=False, base=theta)

    def __call__(self, x, mask, cache=None):
        B, S, _ = x.shape
        q = self.q(x).reshape(B, S, self.n_heads, self.head_dim).transpose(0, 2, 1, 3)
        k = self.k(x).reshape(B, S, self.n_heads, self.head_dim).transpose(0, 2, 1, 3)
        v = self.v(x).reshape(B, S, self.n_heads, self.head_dim).transpose(0, 2, 1, 3)

        if cache is not None:
            past_k, past_v, offset = cache
            q = self.rope(q, offset=offset)
            k = self.rope(k, offset=offset)
            if past_k is not None:
                k = mx.concatenate([past_k, k], axis=2)
                v = mx.concatenate([past_v, v], axis=2)
            new_cache = (k, v, offset + S)
        else:
            q = self.rope(q)
            k = self.rope(k)
            new_cache = None

        scale = 1.0 / math.sqrt(self.head_dim)
        out = mx.fast.scaled_dot_product_attention(q, k, v, scale=scale, mask=mask)
        out = out.transpose(0, 2, 1, 3).reshape(B, S, -1)
        return self.o(out), new_cache


class Block(nn.Module):
    def __init__(self, dim: int, n_heads: int, head_dim: int, d_ff: int, theta: float):
        super().__init__()
        self.attn_norm = RMSNorm(dim)
        self.attn = Attention(dim, n_heads, head_dim, theta)
        self.ffn_norm = RMSNorm(dim)
        self.ffn = SwiGLU(dim, d_ff)

    def __call__(self, x, mask, cache=None):
        attn_out, new_cache = self.attn(self.attn_norm(x), mask, cache)
        x = x + attn_out
        x = x + self.ffn(self.ffn_norm(x))
        return x, new_cache


class WRIM0Model(nn.Module):
    """Causal decoder-only transformer. Logits use the tied token-embedding matrix — no separate
    output projection exists (no untied lm_head parameters anywhere in this model)."""

    def __init__(self, config: WRIM0Config):
        super().__init__()
        self.config = config
        self.tok_emb = nn.Embedding(config.vocab_size, config.d_model)
        self.layers = [
            Block(config.d_model, config.n_heads, config.head_dim, config.d_ff, config.rope_theta)
            for _ in range(config.n_layers)
        ]
        self.norm_f = RMSNorm(config.d_model)

    def __call__(self, idx, cache=None):
        B, S = idx.shape
        x = self.tok_emb(idx)
        if cache is None:
            mask = nn.MultiHeadAttention.create_additive_causal_mask(S).astype(x.dtype)
            layer_caches = [None] * len(self.layers)
        else:
            mask = None if S == 1 else nn.MultiHeadAttention.create_additive_causal_mask(S).astype(x.dtype)
            layer_caches = cache

        new_caches = []
        for layer, layer_cache in zip(self.layers, layer_caches):
            x, new_cache = layer(x, mask, layer_cache)
            new_caches.append(new_cache)
        x = self.norm_f(x)
        logits = x @ self.tok_emb.weight.T
        if cache is None:
            return logits
        return logits, new_caches

    def forward_hidden(self, idx, cache=None):
        """Inference path that also returns post-final-norm hidden states for capability modules.

        Hidden is the last transformer residual after ``norm_f`` and *before* the tied
        embedding projection. This does not add an ``lm_head``; WRIM-0 remains tied.
        Return shapes:
          cache is None -> (logits, hidden)
          cache set     -> (logits, new_caches, hidden)
        """
        B, S = idx.shape
        x = self.tok_emb(idx)
        if cache is None:
            mask = nn.MultiHeadAttention.create_additive_causal_mask(S).astype(x.dtype)
            layer_caches = [None] * len(self.layers)
        else:
            mask = None if S == 1 else nn.MultiHeadAttention.create_additive_causal_mask(S).astype(x.dtype)
            layer_caches = cache

        new_caches = []
        for layer, layer_cache in zip(self.layers, layer_caches):
            x, new_cache = layer(x, mask, layer_cache)
            new_caches.append(new_cache)
        hidden = self.norm_f(x)
        logits = hidden @ self.tok_emb.weight.T
        if cache is None:
            return logits, hidden
        return logits, new_caches, hidden

    def fresh_cache(self):
        return [(None, None, 0) for _ in self.layers]


def count_parameters(model: nn.Module) -> int:
    leaves = mlx.utils.tree_flatten(model.parameters())
    return int(sum(v.size for _, v in leaves))


def build_model(config: WRIM0Config, seed: int) -> tuple[WRIM0Model, int]:
    mx.random.seed(seed)
    model = WRIM0Model(config)
    mx.eval(model.parameters())
    return model, count_parameters(model)
