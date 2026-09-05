"""WRIM-0 checkpoint I/O — atomic (tmp-write-then-rename) safetensors weights + a JSON sidecar
carrying everything needed to resume or audit: step, tokens_seen, optimizer state, RNG seed,
architecture config, tokenizer/corpus hashes, and a lineage record. Weights and optimizer state are
both stored in the same safetensors file (distinguished by a `model.` / `opt.` key prefix) since
MLX optimizer state is itself a tree of mx.array leaves with the same shape discipline as model
parameters — no separate ad hoc pickle format is introduced.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import asdict
from pathlib import Path

import mlx.core as mx
import mlx.utils
import numpy as np
from safetensors.numpy import save_file, load_file

from wrim0_architecture import WRIM0Config, WRIM0Model


def _flatten_prefixed(tree, prefix: str) -> dict:
    flat = mlx.utils.tree_flatten(tree)
    out = {}
    for key, value in flat:
        out[f"{prefix}.{key}"] = value
    return out


def _unflatten_prefixed(flat: dict, prefix: str):
    items = [(k[len(prefix) + 1:], v) for k, v in flat.items() if k.startswith(prefix + ".")]
    return mlx.utils.tree_unflatten(items)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def atomic_write_json(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def save_checkpoint(
    out_dir: Path,
    name: str,
    model: WRIM0Model,
    optimizer_state,
    metadata: dict,
) -> dict:
    """Atomic tmp-write-then-rename for both the weights file and the sidecar. Returns the sidecar
    dict actually written (including the freshly computed weights-file hash)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    weights_path = out_dir / f"{name}.safetensors"
    sidecar_path = out_dir / f"{name}.json"

    tensors = {}
    for key, arr in mlx.utils.tree_flatten(model.parameters()):
        tensors[f"model.{key}"] = np.array(mx.stop_gradient(arr).astype(mx.float32))
    if optimizer_state is not None:
        for key, arr in mlx.utils.tree_flatten(optimizer_state):
            if isinstance(arr, mx.array):
                tensors[f"opt.{key}"] = np.array(arr.astype(mx.float32))

    fd, tmp_weights = tempfile.mkstemp(dir=str(out_dir), prefix=".tmp-", suffix=".safetensors")
    os.close(fd)
    save_file(tensors, tmp_weights)
    os.replace(tmp_weights, weights_path)

    weights_hash = sha256_file(weights_path)
    sidecar = {**metadata, "weightsFile": weights_path.name, "weightsSha256": weights_hash}
    atomic_write_json(sidecar_path, sidecar)
    return sidecar


def load_checkpoint(out_dir: Path, name: str, config: WRIM0Config):
    weights_path = out_dir / f"{name}.safetensors"
    sidecar_path = out_dir / f"{name}.json"
    with open(sidecar_path, "r", encoding="utf-8") as f:
        sidecar = json.load(f)

    actual_hash = sha256_file(weights_path)
    if actual_hash != sidecar.get("weightsSha256"):
        raise ValueError(
            f"Checkpoint hash mismatch for {weights_path}: sidecar says "
            f"{sidecar.get('weightsSha256')}, actual file hash is {actual_hash}. Refusing to load."
        )

    flat_np = load_file(str(weights_path))
    flat_mx = {k: mx.array(v) for k, v in flat_np.items()}

    model = WRIM0Model(config)
    model_params = _unflatten_prefixed(flat_mx, "model")
    model.update(model_params)
    mx.eval(model.parameters())

    opt_state = None
    opt_keys = [k for k in flat_mx if k.startswith("opt.")]
    if opt_keys:
        opt_state = _unflatten_prefixed(flat_mx, "opt")

    return model, opt_state, sidecar
