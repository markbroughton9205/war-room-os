"""Attach/detach LoRA r on WRIM Attention q and v. Does not write WRIM-0 base weights into artifacts."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import mlx.core as mx
import mlx.nn as nn
import mlx.utils
import numpy as np
from safetensors.numpy import load_file, save_file

from capability_module import LoRALinear, CapabilityManifest
from hashes import sha256_file, tensor_tree_sha256  # type: ignore

TARGET_SUFFIXES = ("attn.q", "attn.v")
RANK = 2
ALPHA = 2.0
LORA_INIT_SEED = 20260831


def _is_lora_key(key: str) -> bool:
    return key.endswith("lora_a") or key.endswith("lora_b") or ".lora_a" in key or ".lora_b" in key


def core_param_view(model: nn.Module) -> dict[str, np.ndarray]:
    """Map LoRA-wrapped linears back to original WRIM-0 key names (exclude A/B)."""
    out: dict[str, np.ndarray] = {}
    for key, arr in mlx.utils.tree_flatten(model.parameters()):
        if _is_lora_key(key):
            continue
        mapped = key.replace(".base.weight", ".weight").replace(".base.bias", ".bias")
        out[mapped] = np.array(mx.stop_gradient(arr).astype(mx.float32))
    return out


def lora_param_view(model: nn.Module) -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {}
    for key, arr in mlx.utils.tree_flatten(model.parameters()):
        if _is_lora_key(key):
            out[key] = np.array(mx.stop_gradient(arr).astype(mx.float32))
    return out


def count_lora_params(model: nn.Module) -> int:
    return int(sum(v.size for v in lora_param_view(model).values()))


def count_base_trainable(model: nn.Module) -> int:
    n = 0
    for key, arr in mlx.utils.tree_flatten(model.trainable_parameters()):
        if _is_lora_key(key):
            continue
        n += int(arr.size)
    return n


def verified_qv_sites(model: nn.Module) -> list[str]:
    sites: list[str] = []
    for i, layer in enumerate(model.layers):
        for attr in ("q", "v"):
            mod = getattr(layer.attn, attr)
            cls = type(mod).__name__
            if cls not in ("Linear", "LoRALinear"):
                raise RuntimeError(f"unexpected module at layers.{i}.attn.{attr}: {cls}")
            w = mod.base.weight if cls == "LoRALinear" else mod.weight
            if tuple(w.shape) != (256, 256):
                raise RuntimeError(f"bad q/v shape {w.shape} at layers.{i}.attn.{attr}")
            sites.append(f"layers.{i}.attn.{attr}")
    if len(sites) != 36:
        raise RuntimeError(f"expected 36 q/v sites, got {len(sites)}")
    return sites


def inject_lora_qv(
    model: nn.Module,
    *,
    rank: int = RANK,
    alpha: float = ALPHA,
    seed: int = LORA_INIT_SEED,
) -> dict[str, Any]:
    """Replace attn.q and attn.v with LoRALinear, copying frozen base weights."""
    mx.random.seed(seed)
    targets: list[str] = []
    for i, layer in enumerate(model.layers):
        for attr in ("q", "v"):
            lin = getattr(layer.attn, attr)
            if type(lin).__name__ == "LoRALinear":
                raise RuntimeError(f"LoRA already attached at layers.{i}.attn.{attr}")
            w = lin.weight
            out_f, in_f = int(w.shape[0]), int(w.shape[1])
            adapter = LoRALinear(in_f, out_f, rank, alpha=alpha, seed=None)
            adapter.base.weight = w
            adapter.base.freeze()
            adapter.unfreeze(keys=["lora_a", "lora_b"], recurse=False)
            setattr(layer.attn, attr, adapter)
            targets.append(f"layers.{i}.attn.{attr}")
    model.freeze()
    for i, layer in enumerate(model.layers):
        for attr in ("q", "v"):
            mod = getattr(layer.attn, attr)
            mod.base.freeze()
            mod.unfreeze(keys=["lora_a", "lora_b"], recurse=False)
    mx.eval(model.parameters())
    n_lora = count_lora_params(model)
    return {
        "rank": rank,
        "alpha": alpha,
        "scale": alpha / rank,
        "targets": targets,
        "target_suffixes": list(TARGET_SUFFIXES),
        "matched_modules": len(targets),
        "lora_parameter_count": n_lora,
        "init": "lora_a ~ N(0, 1/sqrt(in_features)); lora_b = 0; dropout=0",
        "dropout": 0.0,
    }


def detach_lora_qv(model: nn.Module) -> None:
    """Restore plain Linear modules from LoRALinear.base (frozen WRIM weights)."""
    for layer in model.layers:
        for attr in ("q", "v"):
            mod = getattr(layer.attn, attr)
            if type(mod).__name__ != "LoRALinear":
                continue
            lin = nn.Linear(mod.in_features, mod.out_features, bias=False)
            lin.weight = mod.base.weight
            lin.freeze()
            setattr(layer.attn, attr, lin)
    model.freeze()
    mx.eval(model.parameters())


def freeze_backbone_unfreeze_lora(model: nn.Module) -> None:
    model.freeze()
    for layer in model.layers:
        for attr in ("q", "v"):
            mod = getattr(layer.attn, attr)
            if type(mod).__name__ == "LoRALinear":
                mod.base.freeze()
                mod.unfreeze(keys=["lora_a", "lora_b"], recurse=False)
    mx.eval(model.parameters())


def save_lora_artifact(
    model: nn.Module,
    dest_dir: Path,
    manifest: CapabilityManifest,
    extra_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    dest_dir.mkdir(parents=True, exist_ok=True)
    tensors = lora_param_view(model)
    if not tensors:
        raise RuntimeError("no LoRA tensors to save")
    if any("base.weight" in k or k.endswith(".weight") and "lora" not in k for k in tensors):
        raise RuntimeError("refusing to save base WRIM weights in LoRA artifact")
    weights_path = dest_dir / "weights.safetensors"
    save_file(tensors, str(weights_path))
    if (dest_dir / "wrim0-weights.safetensors").exists():
        raise RuntimeError("capability artifact must not embed WRIM-0 weights")
    hashes = {
        "weights_sha256": sha256_file(weights_path),
        "weight_tree_sha256": tensor_tree_sha256(tensors),
    }
    manifest.artifact_hash = hashes["weight_tree_sha256"]
    manifest.trainable_parameter_count = int(sum(v.size for v in tensors.values()))
    config = {
        "module_type": "LORA",
        "rank": RANK,
        "alpha": ALPHA,
        "scale": ALPHA / RANK,
        "target_layers": manifest.target_layers,
        "init": "lora_a_gaussian_lora_b_zero",
        "dropout": 0.0,
        **(extra_config or {}),
    }
    compatibility = {
        "base_model_id": manifest.base_model_id,
        "base_checkpoint_sha": manifest.base_checkpoint_sha,
        "tokenizer_sha": manifest.tokenizer_sha,
        "architecture_id": manifest.architecture_id,
        "architecture_config_sha": manifest.architecture_config_sha,
        "d_model": manifest.d_model,
        "n_layers": manifest.n_layers,
    }
    (dest_dir / "config.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    (dest_dir / "compatibility.json").write_text(json.dumps(compatibility, indent=2) + "\n", encoding="utf-8")
    (dest_dir / "provenance.json").write_text(json.dumps(manifest.provenance, indent=2) + "\n", encoding="utf-8")
    (dest_dir / "eval.json").write_text(
        json.dumps(
            {
                "eval_identity": manifest.eval_identity,
                "training_dataset_identity": manifest.training_dataset_identity,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (dest_dir / "hashes.json").write_text(json.dumps(hashes, indent=2) + "\n", encoding="utf-8")
    (dest_dir / "manifest.json").write_text(json.dumps(manifest.to_dict(), indent=2) + "\n", encoding="utf-8")
    return {"dir": str(dest_dir), "hashes": hashes, "n_tensors": len(tensors), "n_params": manifest.trainable_parameter_count}


def load_lora_into_model(model: nn.Module, dest_dir: Path) -> dict[str, Any]:
    hashes = json.loads((dest_dir / "hashes.json").read_text(encoding="utf-8"))
    weights_path = dest_dir / "weights.safetensors"
    actual = sha256_file(weights_path)
    if actual != hashes.get("weights_sha256"):
        raise RuntimeError("LoRA artifact hash invalid (weights file SHA)")
    tensors = load_file(str(weights_path))
    tree = tensor_tree_sha256(tensors)
    if tree != hashes.get("weight_tree_sha256"):
        raise RuntimeError("LoRA artifact hash invalid (weight tree)")
    if any(not _is_lora_key(k) for k in tensors):
        raise RuntimeError("LoRA artifact contains non-LoRA keys")
    current = dict(mlx.utils.tree_flatten(model.parameters()))
    updates = []
    for k, v in tensors.items():
        if k not in current:
            raise RuntimeError(f"LoRA key missing in model: {k}")
        updates.append((k, mx.array(v)))
    model.update(mlx.utils.tree_unflatten(updates))
    freeze_backbone_unfreeze_lora(model)
    mx.eval(model.parameters())
    return hashes


class IsolatedLoRAHeadRuntime(nn.Module):
    """Frozen WRIM + LoRA q/v + classifier head. Optimizer may only see LoRA A/B and head."""

    def __init__(self, backbone: nn.Module, head: nn.Module):
        super().__init__()
        self.backbone = backbone
        self.head = head

    def __call__(self, idx: mx.array):
        logits, hidden = self.backbone.forward_hidden(idx)
        return logits, self.head(hidden[:, -1, :])


def optimizer_key_partition(runtime: IsolatedLoRAHeadRuntime) -> dict[str, Any]:
    train_keys = [k for k, _ in mlx.utils.tree_flatten(runtime.trainable_parameters())]
    all_keys = [k for k, _ in mlx.utils.tree_flatten(runtime.parameters())]
    lora_train = [k for k in train_keys if _is_lora_key(k)]
    head_train = [k for k in train_keys if k.startswith("head.")]
    other_train = [k for k in train_keys if k not in lora_train and k not in head_train]
    base_train = [
        k
        for k in train_keys
        if not _is_lora_key(k) and not k.startswith("head.")
    ]
    n_lora = int(sum(v.size for k, v in mlx.utils.tree_flatten(runtime.trainable_parameters()) if _is_lora_key(k)))
    n_head = int(sum(v.size for k, v in mlx.utils.tree_flatten(runtime.trainable_parameters()) if k.startswith("head.")))
    return {
        "trainable_keys": train_keys,
        "lora_trainable_keys": lora_train,
        "head_trainable_keys": head_train,
        "other_trainable_keys": other_train,
        "base_trainable_keys": base_train,
        "lora_trainable_count": n_lora,
        "head_trainable_count": n_head,
        "total_trainable_count": n_lora + n_head,
        "parameter_key_count": len(all_keys),
    }


def assert_optimizer_lora_and_head_only(runtime: IsolatedLoRAHeadRuntime) -> None:
    part = optimizer_key_partition(runtime)
    if part["base_trainable_keys"] or part["other_trainable_keys"]:
        raise RuntimeError(f"optimizer includes core/base keys: {part['base_trainable_keys'][:8]}")
    if part["lora_trainable_count"] <= 0 or part["head_trainable_count"] <= 0:
        raise RuntimeError("expected both LoRA and head trainable parameters")
