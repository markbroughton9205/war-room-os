"""Isolated WRIM-0 numpy forward. Read-only. No pickle. No optimizer. No training.
Loads only model.* F32 tensors from a safetensors file. Does not write weights.
"""
from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np

EPS = 1e-5
D_MODEL = 256
N_HEADS = 4
HEAD_DIM = 64
N_LAYERS = 18
D_FF = 768
ROPE_THETA = 10000.0


def read_safetensors_model(path: Path) -> dict[str, np.ndarray]:
    data = path.read_bytes()
    header_len = struct.unpack_from("<Q", data, 0)[0]
    header = json.loads(data[8 : 8 + header_len].decode("utf-8"))
    body = memoryview(data)[8 + header_len :]
    out: dict[str, np.ndarray] = {}
    for name, info in header.items():
        if name == "__metadata__":
            continue
        if not name.startswith("model."):
            continue
        dtype = info["dtype"]
        if dtype != "F32":
            raise SystemExit(f"unsupported dtype {dtype} for {name}")
        shape = tuple(info["shape"])
        start, end = info["data_offsets"]
        arr = np.frombuffer(body[start:end], dtype=np.float32).reshape(shape).copy()
        out[name[len("model.") :]] = arr
    return out


def rmsnorm(x: np.ndarray, w: np.ndarray) -> np.ndarray:
    var = np.mean(x * x, axis=-1, keepdims=True)
    return x * np.reciprocal(np.sqrt(var + EPS)) * w


def silu(x: np.ndarray) -> np.ndarray:
    return x / (1.0 + np.exp(-x))


def rope(q: np.ndarray, k: np.ndarray, theta: float) -> tuple[np.ndarray, np.ndarray]:
    # MLX RoPE traditional=False: rotate pairs along last dim.
    seq = q.shape[2]
    dim = q.shape[3]
    half = dim // 2
    positions = np.arange(seq, dtype=np.float32)
    freqs = 1.0 / (theta ** (np.arange(0, dim, 2, dtype=np.float32) / dim))
    angles = positions[:, None] * freqs[None, :]
    cos = np.cos(angles)
    sin = np.sin(angles)

    def apply(x: np.ndarray) -> np.ndarray:
        x1 = x[..., :half]
        x2 = x[..., half:]
        cos_b = cos[None, None, :, :]
        sin_b = sin[None, None, :, :]
        rot0 = x1 * cos_b - x2 * sin_b
        rot1 = x2 * cos_b + x1 * sin_b
        return np.concatenate([rot0, rot1], axis=-1)

    return apply(q), apply(k)


def linear(x: np.ndarray, w: np.ndarray) -> np.ndarray:
    return x @ w.T


def attn(x: np.ndarray, tensors: dict[str, np.ndarray], layer: int) -> np.ndarray:
    p = f"layers.{layer}.attn."
    q = linear(x, tensors[p + "q.weight"])
    k = linear(x, tensors[p + "k.weight"])
    v = linear(x, tensors[p + "v.weight"])
    b, s, _ = x.shape
    q = q.reshape(b, s, N_HEADS, HEAD_DIM).transpose(0, 2, 1, 3)
    k = k.reshape(b, s, N_HEADS, HEAD_DIM).transpose(0, 2, 1, 3)
    v = v.reshape(b, s, N_HEADS, HEAD_DIM).transpose(0, 2, 1, 3)
    q, k = rope(q, k, ROPE_THETA)
    scale = 1.0 / math.sqrt(HEAD_DIM)
    scores = (q @ k.transpose(0, 1, 3, 2)) * scale
    mask = np.triu(np.ones((s, s), dtype=np.float32), k=1) * -1e9
    scores = scores + mask
    scores = scores - np.max(scores, axis=-1, keepdims=True)
    weights = np.exp(scores)
    weights = weights / np.sum(weights, axis=-1, keepdims=True)
    out = (weights @ v).transpose(0, 2, 1, 3).reshape(b, s, N_HEADS * HEAD_DIM)
    return linear(out, tensors[p + "o.weight"])


def swiglu(x: np.ndarray, tensors: dict[str, np.ndarray], layer: int) -> np.ndarray:
    p = f"layers.{layer}.ffn."
    gate = silu(linear(x, tensors[p + "gate.weight"]))
    up = linear(x, tensors[p + "up.weight"])
    return linear(gate * up, tensors[p + "down.weight"])


def forward(ids: list[int], tensors: dict[str, np.ndarray]) -> np.ndarray:
    x = tensors["tok_emb.weight"][np.array(ids, dtype=np.int64)]
    x = x[None, :, :]
    for i in range(N_LAYERS):
        x = x + attn(rmsnorm(x, tensors[f"layers.{i}.attn_norm.weight"]), tensors, i)
        x = x + swiglu(rmsnorm(x, tensors[f"layers.{i}.ffn_norm.weight"]), tensors, i)
    x = rmsnorm(x, tensors["norm_f.weight"])
    return x[0] @ tensors["tok_emb.weight"].T


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--ids", required=True, help="comma-separated token ids including BOS")
    ap.add_argument("--new-tokens", type=int, default=8)
    args = ap.parse_args()
    path = Path(args.weights)
    tensors = read_safetensors_model(path)
    expected = [
        "tok_emb.weight",
        "norm_f.weight",
        "layers.0.attn.q.weight",
        "layers.17.ffn.down.weight",
    ]
    missing = [k for k in expected if k not in tensors]
    if missing:
        print(json.dumps({"ok": False, "error": "missing_tensors", "missing": missing}))
        return 1
    ids = [int(x) for x in args.ids.split(",") if x.strip() != ""]
    generated = list(ids)
    for _ in range(args.new_tokens):
        logits = forward(generated, tensors)
        nxt = int(np.argmax(logits[-1]))
        generated.append(nxt)
        if nxt == 2:
            break
    first_logits = forward(ids, tensors)[-1]
    entropy = float(-np.sum(np.exp(first_logits - first_logits.max()) / np.sum(np.exp(first_logits - first_logits.max())) * ((first_logits - first_logits.max()) - np.log(np.sum(np.exp(first_logits - first_logits.max()))))))
    print(
        json.dumps(
            {
                "ok": True,
                "framework": "numpy-isolated",
                "wrote_weights": False,
                "loaded_tensors": len(tensors),
                "prompt_ids": ids,
                "generated_ids": generated,
                "new_ids": generated[len(ids) :],
                "argmax_id": int(np.argmax(first_logits)),
                "entropy": entropy,
                "finite": bool(np.isfinite(first_logits).all()),
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
