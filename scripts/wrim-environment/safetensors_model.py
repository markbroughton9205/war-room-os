"""Header-only safetensors model.* loader. No unpickle. No opt.* . Does not write the source file."""
from __future__ import annotations

import json
import struct
from pathlib import Path

import torch

EXPECTED_SHAPES: dict[str, tuple[int, ...]] = {}


def _build_expected_shapes() -> dict[str, tuple[int, ...]]:
    from wrim_g20m import D_FF, D_MODEL, INNER, N_LAYERS, VOCAB_SIZE

    shapes: dict[str, tuple[int, ...]] = {
        "tok_emb.weight": (VOCAB_SIZE, D_MODEL),
        "norm_f.weight": (D_MODEL,),
    }
    for i in range(N_LAYERS):
        shapes[f"layers.{i}.attn_norm.weight"] = (D_MODEL,)
        shapes[f"layers.{i}.ffn_norm.weight"] = (D_MODEL,)
        shapes[f"layers.{i}.attn.q.weight"] = (INNER, D_MODEL)
        shapes[f"layers.{i}.attn.k.weight"] = (INNER, D_MODEL)
        shapes[f"layers.{i}.attn.v.weight"] = (INNER, D_MODEL)
        shapes[f"layers.{i}.attn.o.weight"] = (D_MODEL, INNER)
        shapes[f"layers.{i}.ffn.gate.weight"] = (D_FF, D_MODEL)
        shapes[f"layers.{i}.ffn.up.weight"] = (D_FF, D_MODEL)
        shapes[f"layers.{i}.ffn.down.weight"] = (D_MODEL, D_FF)
    return shapes


def load_model_state_from_safetensors(path: Path) -> tuple[dict[str, torch.Tensor], dict]:
    """Read only model.* F32 tensors. Ignore opt.*. Never unpickle."""
    data = path.read_bytes()
    header_len = struct.unpack_from("<Q", data, 0)[0]
    header = json.loads(data[8 : 8 + header_len].decode("utf-8"))
    body = memoryview(data)[8 + header_len :]
    expected = _build_expected_shapes()
    state: dict[str, torch.Tensor] = {}
    skipped_opt = 0
    unexpected: list[str] = []
    missing: list[str] = []
    mapped: list[str] = []
    lm_head = False
    for name, info in header.items():
        if name == "__metadata__":
            continue
        if name.startswith("opt."):
            skipped_opt += 1
            continue
        if not name.startswith("model."):
            unexpected.append(name)
            continue
        if "lm_head" in name:
            lm_head = True
        dtype = info["dtype"]
        if dtype != "F32":
            raise RuntimeError(f"unsupported dtype {dtype} for {name}")
        torch_key = name[len("model.") :]
        shape = tuple(info["shape"])
        start, end = info["data_offsets"]
        arr = torch.frombuffer(bytearray(body[start:end]), dtype=torch.float32).reshape(shape).clone()
        state[torch_key] = arr
        mapped.append(torch_key)
        if torch_key not in expected:
            unexpected.append(name)
        elif expected[torch_key] != shape:
            raise RuntimeError(f"shape mismatch {torch_key}: expected {expected[torch_key]} got {shape}")
    for key in expected:
        if key not in state:
            missing.append(key)
    coverage = {
        "expected": len(expected),
        "mapped": len(mapped),
        "missing": missing,
        "unexpected": unexpected,
        "skipped_opt": skipped_opt,
        "lm_head_present": lm_head,
        "pickle_used": False,
        "source_written": False,
    }
    return state, coverage
