"""Frozen WRIM core: exact WRIM-0 load, SHA proofs, MLX freeze, no core optimizer state."""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import mlx.core as mx
import mlx.nn as nn
import mlx.utils
import numpy as np
from safetensors.numpy import load_file

from paths import (
    ARCHITECTURE_CONFIG_SHA256,
    TOKENIZER_JSON,
    TOKENIZER_SHA256,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_CKPT_DIR,
    WRIM0_ID,
    WRIM0_SIDECAR,
    WRIM0_WEIGHTS,
    WRIM1,
    SOVEREIGN,
)

sys.path.insert(0, str(SOVEREIGN))
sys.path.insert(0, str(WRIM1))

from hashes import sha256_file, tensor_tree_sha256  # noqa: E402
from wrim0_architecture import WRIM0Config, WRIM0Model, count_parameters  # noqa: E402
from wrim0_checkpoint import load_checkpoint  # noqa: E402
from checkpoint_io import load_model_weights, load_parent_wrim0_weights  # noqa: E402


LineageRole = Literal["OFFICIAL_FROZEN_CORE", "TEST_ONLY_COMPARISON"]


def _count_leaves(tree) -> int:
    leaves = mlx.utils.tree_flatten(tree)
    return int(sum(v.size for _, v in leaves))


def numpy_params(model: nn.Module) -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {}
    for key, arr in mlx.utils.tree_flatten(model.parameters()):
        out[key] = np.array(mx.stop_gradient(arr).astype(mx.float32))
    return out


def max_abs_diff(a: dict[str, np.ndarray], b: dict[str, np.ndarray]) -> float:
    if set(a) != set(b):
        extra = sorted(set(a) ^ set(b))
        raise ValueError(f"parameter key mismatch: {extra[:12]}")
    peak = 0.0
    for key in a:
        peak = max(peak, float(np.max(np.abs(a[key] - b[key]))))
    return peak


def named_module_inventory(model: nn.Module) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for name, mod in model.named_modules():
        cls = type(mod).__name__
        if cls == "Linear":
            w = mod.weight
            rows.append({
                "path": name or "<root>",
                "type": cls,
                "in_features": int(w.shape[1]),
                "out_features": int(w.shape[0]),
                "bias": hasattr(mod, "bias") and mod.bias is not None,
            })
        elif cls not in ("WRIM0Model",):
            rows.append({"path": name or "<root>", "type": cls})
    return rows


@dataclass(frozen=True)
class FrozenCoreProof:
    core_id: str
    lineage_role: LineageRole
    file_sha256: str
    expected_file_sha256: str
    tokenizer_sha256: str
    expected_tokenizer_sha256: str
    architecture_config_sha256: str
    weight_tree_sha256: str
    core_total_parameters: int
    core_trainable_parameters: int
    optimizer_state_attached: bool
    freeze_mechanism: str


class FrozenWRIMCore:
    """Immutable WRIM backbone. Capability training must never create an optimizer over these leaves."""

    def __init__(
        self,
        model: WRIM0Model,
        *,
        core_id: str,
        lineage_role: LineageRole,
        file_sha256: str,
        expected_file_sha256: str,
        tokenizer_sha256: str,
        sidecar: dict[str, Any],
        weight_tree_sha256: str,
        snapshot: dict[str, np.ndarray],
    ):
        self.model = model
        self.core_id = core_id
        self.lineage_role = lineage_role
        self.file_sha256 = file_sha256
        self.expected_file_sha256 = expected_file_sha256
        self.tokenizer_sha256 = tokenizer_sha256
        self.sidecar = sidecar
        self._weight_tree_sha256 = weight_tree_sha256
        self._snapshot = snapshot
        self._isolate()

    def _isolate(self) -> None:
        self.model.freeze(recurse=True)
        mx.eval(self.model.parameters())
        trainable = _count_leaves(self.model.trainable_parameters())
        if trainable != 0:
            raise RuntimeError(
                f"MLX freeze failed: trainable_parameters still has {trainable} scalars"
            )

    @property
    def config(self) -> WRIM0Config:
        return self.model.config

    def core_total_parameters(self) -> int:
        return count_parameters(self.model)

    def core_trainable_parameters(self) -> int:
        return _count_leaves(self.model.trainable_parameters())

    def weight_tree_hash(self) -> str:
        return tensor_tree_sha256(numpy_params(self.model))

    def snapshot_params(self) -> dict[str, np.ndarray]:
        return numpy_params(self.model)

    def max_abs_diff_from_load(self) -> float:
        return max_abs_diff(self._snapshot, self.snapshot_params())

    def proof(self) -> FrozenCoreProof:
        return FrozenCoreProof(
            core_id=self.core_id,
            lineage_role=self.lineage_role,
            file_sha256=self.file_sha256,
            expected_file_sha256=self.expected_file_sha256,
            tokenizer_sha256=self.tokenizer_sha256,
            expected_tokenizer_sha256=TOKENIZER_SHA256,
            architecture_config_sha256=self.config.config_hash(),
            weight_tree_sha256=self.weight_tree_hash(),
            core_total_parameters=self.core_total_parameters(),
            core_trainable_parameters=self.core_trainable_parameters(),
            optimizer_state_attached=False,
            freeze_mechanism="mlx.nn.Module.freeze + trainable_parameters() empty",
        )

    def logits(self, idx: mx.array):
        return self.model(idx)

    def forward_hidden(self, idx: mx.array, cache=None):
        return self.model.forward_hidden(idx, cache=cache)

    def eligible_linear_modules(self) -> list[dict[str, Any]]:
        return [row for row in named_module_inventory(self.model) if row.get("type") == "Linear"]


def verify_tokenizer_sha(path: Path | None = None) -> str:
    actual = sha256_file(path or TOKENIZER_JSON)
    if actual != TOKENIZER_SHA256:
        raise ValueError(f"tokenizer SHA mismatch expected={TOKENIZER_SHA256} actual={actual}")
    return actual


def load_frozen_wrim0(*, verify_tokenizer: bool = True) -> FrozenWRIMCore:
    tok_sha = verify_tokenizer_sha() if verify_tokenizer else sha256_file(TOKENIZER_JSON)
    with open(WRIM0_SIDECAR, encoding="utf-8") as f:
        sidecar = json.load(f)
    config = WRIM0Config(**sidecar["architectureConfig"])
    if config.config_hash() != ARCHITECTURE_CONFIG_SHA256:
        raise ValueError("architecture config hash mismatch vs WRIM-G-20M-v1-option-A")
    if sidecar.get("weightsSha256") != WRIM0_CHECKPOINT_SHA256:
        raise ValueError("sidecar weightsSha256 is not the Commander WRIM-0 SHA")

    model, opt_state, loaded_sidecar = load_checkpoint(WRIM0_CKPT_DIR, "checkpoint-final", config)
    if opt_state is not None:
        # Isolation: Genesis file may contain opt.* blobs; they must not attach to the frozen core.
        del opt_state
    file_sha = sha256_file(WRIM0_WEIGHTS)
    if file_sha != WRIM0_CHECKPOINT_SHA256:
        raise ValueError(f"WRIM-0 file SHA mismatch expected={WRIM0_CHECKPOINT_SHA256} actual={file_sha}")
    snap = numpy_params(model)
    tree_sha = tensor_tree_sha256(snap)
    core = FrozenWRIMCore(
        model,
        core_id=WRIM0_ID,
        lineage_role="OFFICIAL_FROZEN_CORE",
        file_sha256=file_sha,
        expected_file_sha256=WRIM0_CHECKPOINT_SHA256,
        tokenizer_sha256=tok_sha,
        sidecar=loaded_sidecar,
        weight_tree_sha256=tree_sha,
        snapshot=snap,
    )
    return core


def load_test_only_comparison_core(bundle_dir: Path) -> FrozenWRIMCore:
    """Load a TEST_ONLY checkpoint as a comparison core. Never writes ACTIVE lineage."""
    tok_sha = verify_tokenizer_sha()
    manifest_path = bundle_dir / "checkpoint-manifest.json"
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)
    if manifest.get("lineage") not in ("NOT_OFFICIAL_WRIM_LINEAGE", "TEST_ONLY"):
        if manifest.get("promotable") is True:
            raise ValueError("refusing to load a promotable checkpoint as TEST_ONLY comparison")
    weights = bundle_dir / "model.safetensors"
    actual = sha256_file(weights)
    expected = (manifest.get("files") or {}).get("model.safetensors", {}).get("sha256")
    if expected and actual != expected:
        raise ValueError(f"TEST_ONLY weights SHA mismatch expected={expected} actual={actual}")
    with open(WRIM0_SIDECAR, encoding="utf-8") as f:
        sidecar = json.load(f)
    config = WRIM0Config(**sidecar["architectureConfig"])
    model = WRIM0Model(config)
    raw = load_file(str(weights))
    load_model_weights(model, raw, strict=True)
    snap = numpy_params(model)
    return FrozenWRIMCore(
        model,
        core_id=str(manifest.get("run_id") or bundle_dir.name),
        lineage_role="TEST_ONLY_COMPARISON",
        file_sha256=actual,
        expected_file_sha256=expected or actual,
        tokenizer_sha256=tok_sha,
        sidecar=manifest,
        weight_tree_sha256=tensor_tree_sha256(snap),
        snapshot=snap,
    )


def load_wrim0_parent_tensors_only(model: WRIM0Model) -> dict[str, Any]:
    return load_parent_wrim0_weights(model, WRIM0_WEIGHTS, WRIM0_CHECKPOINT_SHA256)
