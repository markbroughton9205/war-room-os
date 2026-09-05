"""Detachable neural capability modules. Isolated parameters; never merged into WRIM-0."""
from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import mlx.core as mx
import mlx.nn as nn
import mlx.utils
import numpy as np
from safetensors.numpy import load_file, save_file

from paths import (
    ARCHITECTURE_CONFIG_SHA256,
    ARCHITECTURE_ID,
    CAPABILITIES_ROOT,
    SOVEREIGN,
    TOKENIZER_SHA256,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_ID,
    WRIM1,
)
from frozen_core import FrozenWRIMCore, numpy_params

sys.path.insert(0, str(WRIM1))
from hashes import sha256_file, sha256_json, tensor_tree_sha256  # noqa: E402

ModuleType = Literal["LORA", "ADAPTER", "CLASSIFIER_HEAD", "ROUTER_HEAD"]
ModuleState = Literal["DESIGN", "SHADOW", "CANDIDATE", "PROMOTED", "REJECTED", "ARCHIVED"]


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _count(tree) -> int:
    return int(sum(v.size for _, v in mlx.utils.tree_flatten(tree)))


class CompatibilityError(ValueError):
    pass


@dataclass
class CapabilityManifest:
    capability_id: str
    module_id: str
    version: str
    base_model_id: str
    base_checkpoint_sha: str
    tokenizer_sha: str
    architecture_id: str
    architecture_config_sha: str
    module_type: ModuleType
    target_layers: list[str]
    d_model: int
    n_layers: int
    n_classes: int | None
    trainable_parameter_count: int
    state: ModuleState
    created_at: str
    provenance: dict[str, Any]
    eval_identity: str | None
    training_dataset_identity: str | None
    artifact_hash: str | None
    test_only: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class CapabilityModule(nn.Module):
    """Contract: attach/detach/forward/save/load/validateCompatibility/describeTrainableParameters."""

    manifest: CapabilityManifest

    def describe_trainable_parameters(self) -> dict[str, Any]:
        leaves = mlx.utils.tree_flatten(self.trainable_parameters())
        return {
            "keys": [k for k, _ in leaves],
            "count": _count(self.trainable_parameters()),
            "total_including_frozen": _count(self.parameters()),
        }

    def validate_compatibility(self, core: FrozenWRIMCore) -> None:
        m = self.manifest
        errors: list[str] = []
        if m.base_model_id != core.core_id and core.lineage_role == "OFFICIAL_FROZEN_CORE":
            errors.append(f"wrong base model: module={m.base_model_id} core={core.core_id}")
        if core.lineage_role == "OFFICIAL_FROZEN_CORE" and m.base_checkpoint_sha != WRIM0_CHECKPOINT_SHA256:
            errors.append("wrong base checkpoint SHA")
        if m.architecture_config_sha != core.config.config_hash():
            errors.append("wrong architecture config hash")
        if m.d_model != core.config.d_model:
            errors.append(f"wrong dimension d_model module={m.d_model} core={core.config.d_model}")
        if m.n_layers != core.config.n_layers:
            errors.append("wrong layer mapping / n_layers")
        if m.tokenizer_sha != TOKENIZER_SHA256:
            errors.append("wrong tokenizer SHA")
        if m.version.split(".")[0] != "1":
            errors.append(f"unsupported module version {m.version}")
        if errors:
            raise CompatibilityError("; ".join(errors))

    def attach(self, core: FrozenWRIMCore) -> "AttachedCapability":
        self.validate_compatibility(core)
        return AttachedCapability(core=core, module=self)

    def detach(self) -> None:
        return None

    def save_artifact(self, dest_dir: Path) -> dict[str, Any]:
        dest_dir.mkdir(parents=True, exist_ok=True)
        weights_path = dest_dir / "weights.safetensors"
        tensors = numpy_params(self)
        save_file(tensors, str(weights_path))
        config = {
            "module_type": self.manifest.module_type,
            "d_model": self.manifest.d_model,
            "n_classes": self.manifest.n_classes,
            "target_layers": self.manifest.target_layers,
            "version": self.manifest.version,
        }
        compatibility = {
            "base_model_id": self.manifest.base_model_id,
            "base_checkpoint_sha": self.manifest.base_checkpoint_sha,
            "tokenizer_sha": self.manifest.tokenizer_sha,
            "architecture_id": self.manifest.architecture_id,
            "architecture_config_sha": self.manifest.architecture_config_sha,
            "d_model": self.manifest.d_model,
            "n_layers": self.manifest.n_layers,
        }
        provenance = self.manifest.provenance
        eval_meta = {
            "eval_identity": self.manifest.eval_identity,
            "training_dataset_identity": self.manifest.training_dataset_identity,
        }
        hashes = {
            "weights_sha256": sha256_file(weights_path),
            "weight_tree_sha256": tensor_tree_sha256(tensors),
        }
        self.manifest.artifact_hash = hashes["weight_tree_sha256"]
        manifest = self.manifest.to_dict()
        (dest_dir / "config.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        (dest_dir / "compatibility.json").write_text(json.dumps(compatibility, indent=2) + "\n", encoding="utf-8")
        (dest_dir / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
        (dest_dir / "eval.json").write_text(json.dumps(eval_meta, indent=2) + "\n", encoding="utf-8")
        (dest_dir / "hashes.json").write_text(json.dumps(hashes, indent=2) + "\n", encoding="utf-8")
        (dest_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        if (dest_dir / "wrim0-weights.safetensors").exists():
            raise RuntimeError("capability artifact must not embed WRIM-0 weights")
        return {"dir": str(dest_dir), "manifest": manifest, "hashes": hashes}

    @classmethod
    def load_artifact(cls, dest_dir: Path) -> "DummyClassifierHead":
        manifest = json.loads((dest_dir / "manifest.json").read_text(encoding="utf-8"))
        hashes = json.loads((dest_dir / "hashes.json").read_text(encoding="utf-8"))
        weights_path = dest_dir / "weights.safetensors"
        actual = sha256_file(weights_path)
        if actual != hashes.get("weights_sha256"):
            raise CompatibilityError("artifact hash invalid (weights file SHA)")
        tensors = load_file(str(weights_path))
        tree = tensor_tree_sha256(tensors)
        if tree != hashes.get("weight_tree_sha256") or tree != manifest.get("artifact_hash"):
            raise CompatibilityError("artifact hash invalid (weight tree)")
        module_type = manifest["module_type"]
        if module_type != "CLASSIFIER_HEAD":
            raise CompatibilityError(f"Phase 1 loader supports CLASSIFIER_HEAD only, got {module_type}")
        manifest["target_layers"] = list(manifest["target_layers"])
        mod = DummyClassifierHead.from_manifest(manifest_from_dict(manifest), seed=0)
        params = {k: mx.array(v) for k, v in tensors.items()}
        tree_params = mlx.utils.tree_unflatten(list(params.items()))
        mod.update(tree_params)
        mx.eval(mod.parameters())
        return mod


class AttachedCapability:
    def __init__(self, core: FrozenWRIMCore, module: CapabilityModule):
        self.core = core
        self.module = module

    def detach(self) -> CapabilityModule:
        mod = self.module
        self.module = None  # type: ignore[assignment]
        return mod

    def forward(self, idx: mx.array):
        logits, hidden = self.core.forward_hidden(idx)
        last = hidden[:, -1, :]
        return logits, self.module(last)


class DummyClassifierHead(CapabilityModule):
    """TEST_ONLY tiny head. Not WR-Tool. Isolated Linear on last hidden state."""

    def __init__(self, manifest: CapabilityManifest, seed: int = 7):
        super().__init__()
        self.manifest = manifest
        mx.random.seed(seed)
        n_classes = int(manifest.n_classes or 4)
        self.proj = nn.Linear(manifest.d_model, n_classes, bias=True)
        mx.eval(self.parameters())
        self.manifest.trainable_parameter_count = _count(self.trainable_parameters())

    def __call__(self, hidden_last: mx.array):
        return self.proj(hidden_last)

    @classmethod
    def from_manifest(cls, manifest: CapabilityManifest, seed: int = 7) -> "DummyClassifierHead":
        return cls(manifest, seed=seed)


def manifest_from_dict(raw: dict[str, Any]) -> CapabilityManifest:
    allowed = {f.name for f in CapabilityManifest.__dataclass_fields__.values()}  # type: ignore[attr-defined]
    return CapabilityManifest(**{k: v for k, v in raw.items() if k in allowed})


def make_tool_head_manifest(
    *,
    module_id: str = "WR-TOOL-HEAD-001",
    n_classes: int = 3,
    state: ModuleState = "SHADOW",
    training_dataset_identity: str | None = None,
    eval_identity: str | None = None,
    experiment_id: str = "WR-TOOL-PI-EXP-001",
    kind: str = "WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_001",
    extra_provenance: dict[str, Any] | None = None,
) -> CapabilityManifest:
    provenance = {
        "kind": kind,
        "experiment_id": experiment_id,
        "not_official_lineage": True,
        "auto_promote": False,
    }
    if extra_provenance:
        provenance.update(extra_provenance)
    return CapabilityManifest(
        capability_id="CAP-WR-TOOL-HEAD",
        module_id=module_id,
        version="1.0.0",
        base_model_id=WRIM0_ID,
        base_checkpoint_sha=WRIM0_CHECKPOINT_SHA256,
        tokenizer_sha=TOKENIZER_SHA256,
        architecture_id=ARCHITECTURE_ID,
        architecture_config_sha=ARCHITECTURE_CONFIG_SHA256,
        module_type="CLASSIFIER_HEAD",
        target_layers=["norm_f", "last_hidden", "assistant_boundary"],
        d_model=256,
        n_layers=18,
        n_classes=n_classes,
        trainable_parameter_count=0,
        state=state,
        created_at=_utcnow(),
        provenance=provenance,
        eval_identity=eval_identity,
        training_dataset_identity=training_dataset_identity,
        artifact_hash=None,
        test_only=True,
    )


def make_dummy_manifest(
    *,
    module_id: str = "WR-DUMMY-CAP-001",
    base_model_id: str = WRIM0_ID,
    base_checkpoint_sha: str = WRIM0_CHECKPOINT_SHA256,
    d_model: int = 256,
    n_layers: int = 18,
    n_classes: int = 4,
    architecture_config_sha: str = ARCHITECTURE_CONFIG_SHA256,
    tokenizer_sha: str = TOKENIZER_SHA256,
    state: ModuleState = "DESIGN",
) -> CapabilityManifest:
    return CapabilityManifest(
        capability_id="CAP-DUMMY-ISOLATION",
        module_id=module_id,
        version="1.0.0",
        base_model_id=base_model_id,
        base_checkpoint_sha=base_checkpoint_sha,
        tokenizer_sha=tokenizer_sha,
        architecture_id=ARCHITECTURE_ID,
        architecture_config_sha=architecture_config_sha,
        module_type="CLASSIFIER_HEAD",
        target_layers=["norm_f", "last_hidden"],
        d_model=d_model,
        n_layers=n_layers,
        n_classes=n_classes,
        trainable_parameter_count=0,
        state=state,
        created_at=_utcnow(),
        provenance={
            "kind": "TEST_ONLY_DUMMY",
            "not_wr_tool": True,
            "not_official_lineage": True,
        },
        eval_identity=None,
        training_dataset_identity=None,
        artifact_hash=None,
        test_only=True,
    )


class LoRALinear(nn.Module):
    """Custom LoRA (MLX has no built-in LoRA). Frozen base weight + trainable A/B.

    y = W x + scale * B(A(x)) with scale = alpha / rank.
    Initialization: A ~ N(0, 1/sqrt(in_features)), B = 0 so the module starts
    as the frozen base (delta is identically zero at step 0). Dropout: none.
    """

    def __init__(
        self,
        in_features: int,
        out_features: int,
        rank: int,
        *,
        alpha: float = 2.0,
        seed: int | None = None,
    ):
        super().__init__()
        self.in_features = in_features
        self.out_features = out_features
        self.rank = rank
        self.alpha = float(alpha)
        self.scale = self.alpha / float(rank)
        self.base = nn.Linear(in_features, out_features, bias=False)
        self.base.freeze()
        if seed is not None:
            mx.random.seed(seed)
        import math

        self.lora_a = mx.random.normal((in_features, rank)) * (1.0 / math.sqrt(in_features))
        self.lora_b = mx.zeros((rank, out_features))
        self.unfreeze(keys=["lora_a", "lora_b"], recurse=False)
        mx.eval(self.parameters())

    def __call__(self, x: mx.array):
        return self.base(x) + self.scale * (x @ self.lora_a @ self.lora_b)


def lora_param_count(in_features: int, out_features: int, rank: int) -> int:
    return int(rank * (in_features + out_features))


def make_lora_manifest(
    *,
    module_id: str = "WR-TOOL-LORA-R2-001",
    rank: int = 2,
    alpha: float = 2.0,
    target_layers: list[str] | None = None,
    state: ModuleState = "SHADOW",
    training_dataset_identity: str | None = None,
    eval_identity: str | None = None,
    experiment_id: str = "WR-TOOL-PI-EXP-002",
    kind: str = "WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_002",
) -> CapabilityManifest:
    return CapabilityManifest(
        capability_id="CAP-WR-TOOL-LORA",
        module_id=module_id,
        version="1.0.0",
        base_model_id=WRIM0_ID,
        base_checkpoint_sha=WRIM0_CHECKPOINT_SHA256,
        tokenizer_sha=TOKENIZER_SHA256,
        architecture_id=ARCHITECTURE_ID,
        architecture_config_sha=ARCHITECTURE_CONFIG_SHA256,
        module_type="LORA",
        target_layers=target_layers or [],
        d_model=256,
        n_layers=18,
        n_classes=None,
        trainable_parameter_count=0,
        state=state,
        created_at=_utcnow(),
        provenance={
            "kind": kind,
            "experiment_id": experiment_id,
            "rank": rank,
            "alpha": alpha,
            "scale": alpha / rank,
            "targets": ["attn.q", "attn.v"],
            "init": "lora_a_gaussian_lora_b_zero",
            "dropout": 0.0,
            "not_official_lineage": True,
            "auto_promote": False,
        },
        eval_identity=eval_identity,
        training_dataset_identity=training_dataset_identity,
        artifact_hash=None,
        test_only=True,
    )
