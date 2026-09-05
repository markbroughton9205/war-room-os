from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
from safetensors.numpy import load_file, save_file

from hashes import sha256_file, tensor_tree_sha256
from rng_state import scheduler_state


BUNDLE_FILES = [
    "model.safetensors",
    "optimizer.safetensors",
    "rng-state.json",
    "training-state.json",
    "run-manifest.json",
    "dataset-state.json",
    "optimizer-config.json",
    "scheduler-state.json",
    "metrics-snapshot.json",
    "checkpoint-manifest.json",
]


def _flatten(tree) -> dict:
    import mlx.utils
    return {k: v for k, v in mlx.utils.tree_flatten(tree)}


def _unflatten(flat: dict):
    import mlx.utils
    items = list(flat.items())
    return mlx.utils.tree_unflatten(items)


def materialize_mlx(*trees) -> None:
    import mlx.core as mx
    mx.eval(*trees)


def model_to_numpy(model) -> dict[str, np.ndarray]:
    import mlx.core as mx
    import mlx.utils
    out = {}
    for key, arr in mlx.utils.tree_flatten(model.parameters()):
        out[key] = np.array(mx.stop_gradient(arr).astype(mx.float32))
    return out


def optimizer_to_numpy(optimizer_state) -> dict[str, np.ndarray]:
    import mlx.core as mx
    import mlx.utils
    out = {}
    if optimizer_state is None:
        return out
    for key, arr in mlx.utils.tree_flatten(optimizer_state):
        if isinstance(arr, mx.array):
            out[key] = np.array(arr.astype(mx.float32))
    return out


def load_parent_wrim0_weights(model, path: Path, expected_sha256: str) -> dict:
    actual = sha256_file(path)
    if actual != expected_sha256:
        raise ValueError(f"parent checkpoint hash mismatch expected={expected_sha256} actual={actual}")
    raw = load_file(str(path))
    tensors = {k[6:]: v for k, v in raw.items() if k.startswith("model.")}
    if not tensors:
        raise ValueError("parent checkpoint has no model.* tensors")
    load_model_weights(model, tensors, strict=True)
    return {"parent_sha256": actual, "tensor_count": len(tensors)}


def load_model_weights(model, tensors: dict[str, np.ndarray], strict: bool = True) -> None:
    import mlx.core as mx
    import mlx.utils
    current = dict(mlx.utils.tree_flatten(model.parameters()))
    if strict:
        missing = set(current) - set(tensors)
        extra = set(tensors) - set(current)
        if missing or extra:
            raise ValueError(f"strict model load failed missing={sorted(missing)[:8]} extra={sorted(extra)[:8]}")
        for key, arr in current.items():
            got = tensors[key]
            if tuple(got.shape) != tuple(arr.shape):
                raise ValueError(f"shape mismatch {key}: {got.shape} vs {arr.shape}")
            if str(got.dtype) not in ("float32", "float16", "bfloat16"):
                raise ValueError(f"unexpected dtype {key} {got.dtype}")
    params = _unflatten({k: mx.array(v) for k, v in tensors.items() if k in current})
    model.update(params)
    mx.eval(model.parameters())


def atomic_write_json(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def _fsync_dir(path: Path) -> None:
    fd = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_checkpoint_bundle(
    *,
    dest_dir: Path,
    checkpoint_id: str,
    run_id: str,
    step: int,
    epoch: int,
    tokens_seen: int,
    model,
    optimizer_state,
    optimizer_config: dict,
    rng_blob: dict,
    training_state: dict,
    dataset_state: dict,
    run_manifest: dict,
    metrics_snapshot: dict,
    parent_checkpoint: str | None,
    identities: dict,
    validate_reload: bool = True,
) -> dict:
    """Atomic checkpoint: tmp dir → write → fsync → hash → optional reload → rename."""
    dest_dir.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest_dir.parent / f".tmp-{checkpoint_id}-{os.getpid()}"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)

    import mlx.core as mx
    materialize_mlx(model.parameters(), optimizer_state if optimizer_state is not None else mx.array(0))

    model_np = model_to_numpy(model)
    opt_np = optimizer_to_numpy(optimizer_state)
    save_file(model_np, str(tmp / "model.safetensors"))
    save_file(opt_np, str(tmp / "optimizer.safetensors"))
    atomic_write_json(tmp / "rng-state.json", rng_blob)
    atomic_write_json(tmp / "training-state.json", training_state)
    atomic_write_json(tmp / "run-manifest.json", run_manifest)
    atomic_write_json(tmp / "dataset-state.json", dataset_state)
    atomic_write_json(tmp / "optimizer-config.json", optimizer_config)
    atomic_write_json(tmp / "scheduler-state.json", scheduler_state(step, optimizer_config))
    atomic_write_json(tmp / "metrics-snapshot.json", metrics_snapshot)

    files: dict[str, dict] = {}
    for name in BUNDLE_FILES:
        if name == "checkpoint-manifest.json":
            continue
        p = tmp / name
        files[name] = {"size": p.stat().st_size, "sha256": sha256_file(p)}

    manifest = {
        "checkpoint_id": checkpoint_id,
        "run_id": run_id,
        "step": step,
        "epoch": epoch,
        "tokens_seen": tokens_seen,
        "created_at": training_state.get("updated_at"),
        "parent_checkpoint": parent_checkpoint,
        "dataset_sha256": identities.get("corpus_sha256"),
        "tokenizer_sha256": identities.get("tokenizer_sha256"),
        "architecture_sha256": identities.get("architecture_config_sha256"),
        "training_config_sha256": identities.get("training_config_sha256"),
        "files": files,
        "model_tensor_sha256": tensor_tree_sha256(model_np),
        "optimizer_tensor_sha256": tensor_tree_sha256(opt_np),
        "complete": False,
        "validation_status": "not_run",
        "status": "incomplete",
        "promotable": False,
        "test_only": identities.get("test_only", False),
        "lineage": identities.get("lineage", "WRIM-1-candidate"),
    }
    atomic_write_json(tmp / "checkpoint-manifest.json", {
        **manifest,
        "complete": False,
        "status": "incomplete",
        "files": files,
    })

    if validate_reload:
        loaded_model = load_file(str(tmp / "model.safetensors"))
        loaded_opt = load_file(str(tmp / "optimizer.safetensors"))
        if tensor_tree_sha256(loaded_model) != manifest["model_tensor_sha256"]:
            shutil.rmtree(tmp, ignore_errors=True)
            raise ValueError("reload validation failed for model.safetensors")
        if tensor_tree_sha256(loaded_opt) != manifest["optimizer_tensor_sha256"]:
            shutil.rmtree(tmp, ignore_errors=True)
            raise ValueError("reload validation failed for optimizer.safetensors")
        for name, meta in files.items():
            actual = sha256_file(tmp / name)
            if actual != meta["sha256"]:
                shutil.rmtree(tmp, ignore_errors=True)
                raise ValueError(f"hash mismatch after write: {name}")

    manifest["complete"] = True
    manifest["status"] = "complete"
    manifest["files"] = files
    atomic_write_json(tmp / "checkpoint-manifest.json", manifest)

    for name in BUNDLE_FILES:
        with open(tmp / name, "rb") as f:
            os.fsync(f.fileno())
    _fsync_dir(tmp)

    if dest_dir.exists():
        raise ValueError(f"checkpoint destination already exists: {dest_dir}")
    os.rename(tmp, dest_dir)
    _fsync_dir(dest_dir.parent)
    return json.loads((dest_dir / "checkpoint-manifest.json").read_text(encoding="utf-8"))


def load_bundle(path: Path) -> dict[str, Any]:
    manifest = json.loads((path / "checkpoint-manifest.json").read_text(encoding="utf-8"))
    if not manifest.get("complete"):
        raise ValueError(f"refusing incomplete checkpoint {path}")
    for name, meta in manifest["files"].items():
        if name == "checkpoint-manifest.json":
            continue
        actual = sha256_file(path / name)
        if actual != meta["sha256"]:
            raise ValueError(f"checkpoint file hash mismatch: {name}")
    model = load_file(str(path / "model.safetensors"))
    opt = load_file(str(path / "optimizer.safetensors"))
    if tensor_tree_sha256(model) != manifest["model_tensor_sha256"]:
        raise ValueError("model tensor hash mismatch")
    if tensor_tree_sha256(opt) != manifest["optimizer_tensor_sha256"]:
        raise ValueError("optimizer tensor hash mismatch")
    return {
        "manifest": manifest,
        "model": model,
        "optimizer": opt,
        "rng": json.loads((path / "rng-state.json").read_text(encoding="utf-8")),
        "training_state": json.loads((path / "training-state.json").read_text(encoding="utf-8")),
        "run_manifest": json.loads((path / "run-manifest.json").read_text(encoding="utf-8")),
        "dataset_state": json.loads((path / "dataset-state.json").read_text(encoding="utf-8")),
        "optimizer_config": json.loads((path / "optimizer-config.json").read_text(encoding="utf-8")),
        "scheduler_state": json.loads((path / "scheduler-state.json").read_text(encoding="utf-8")),
        "metrics_snapshot": json.loads((path / "metrics-snapshot.json").read_text(encoding="utf-8")),
    }


def latest_known_good(registry_path: Path) -> Path | None:
    if not registry_path.is_file():
        return None
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    goods = [e for e in registry.get("checkpoints", []) if e.get("status") == "complete" and not e.get("corrupted")]
    if not goods:
        return None
    goods.sort(key=lambda e: (e.get("step", -1), e.get("created_at", "")))
    return Path(goods[-1]["path"])


def register_checkpoint(registry_path: Path, entry: dict) -> dict:
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry = {"checkpoints": []}
    if registry_path.is_file():
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
    registry.setdefault("checkpoints", [])
    registry["checkpoints"] = [c for c in registry["checkpoints"] if c.get("checkpoint_id") != entry["checkpoint_id"]]
    registry["checkpoints"].append(entry)
    atomic_write_json(registry_path, registry)
    return registry


def retention_plan() -> dict:
    return {
        "preserve": [
            "latest_known_good",
            "best_validation",
            "major_milestones",
            "final_candidate",
            "root_parent_lineage",
        ],
        "never_delete": ["WRIM-0", "WRX-000001"],
        "newest_is_not_automatically_best": True,
        "official_wrim1_dir_untouched_until_authorized_run": True,
        "milestone_steps": [500, 1000, 1500, 1893],
    }
