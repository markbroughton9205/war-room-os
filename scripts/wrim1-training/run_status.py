from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from hashes import sha256_json
from paths import official_ckpt_dir, wave9_dir
from training_config import official_training_config


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def atomic_write(path: Path, obj: dict) -> None:
    from checkpoint_io import atomic_write_json
    atomic_write_json(path, obj)


def persist_run_fields(root: Path, **fields) -> dict:
    path = wave9_dir(root) / "WRIM1-RUN-000001.json"
    run = json.loads(path.read_text(encoding="utf-8"))
    identity_keys = {
        "run_id", "run_version", "model_lineage", "parent_model_id", "parent_checkpoint_sha256",
        "corpus_id", "corpus_sha256", "dataset_manifest_sha256", "tokenizer_id", "tokenizer_sha256",
        "architecture_id", "architecture_config_sha256", "training_config_sha256",
        "heldout_manifest_sha256", "created_at", "identity_immutable",
        "material_change_requires_new_run_id",
    }
    for key, value in fields.items():
        if key in identity_keys and key in run and run[key] != value:
            raise RuntimeError(f"refusing to mutate immutable identity field {key}")
        run[key] = value
    if sha256_json(official_training_config()) != run["training_config_sha256"]:
        raise RuntimeError("training config hash drifted from official run identity")
    atomic_write(path, run)
    return run


def persist_authorization(root: Path, **fields) -> dict:
    path = wave9_dir(root) / "authorization.json"
    auth = json.loads(path.read_text(encoding="utf-8"))
    if auth.get("run_id") != "WRIM1-RUN-000001":
        raise RuntimeError("authorization.json is not scoped to WRIM1-RUN-000001")
    auth.update(fields)
    auth["run_id"] = "WRIM1-RUN-000001"
    if "commander_authorization_token" in auth:
        raise RuntimeError("refusing to persist authorization token value")
    atomic_write(path, auth)
    return auth


def persist_promotion(root: Path, state: str, **extra) -> dict:
    payload = {"run_id": "WRIM1-RUN-000001", "state": state, "updated_at": iso_now(), "promoted": False, **extra}
    if payload.get("promoted") is True:
        raise RuntimeError("refusing to persist PROMOTED without separate Commander promotion instruction")
    if state == "PROMOTED":
        raise RuntimeError("refusing to persist PROMOTED")
    atomic_write(wave9_dir(root) / "promotion-state.json", payload)
    return payload


def write_pid(root: Path) -> Path:
    path = official_ckpt_dir(root) / "train.pid"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(__import__("os").getpid()), encoding="utf-8")
    return path


def clear_pid(root: Path) -> None:
    path = official_ckpt_dir(root) / "train.pid"
    if path.is_file():
        path.unlink()
