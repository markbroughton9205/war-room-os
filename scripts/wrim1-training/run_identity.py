from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from constants import (
    ARCHITECTURE_CONFIG_SHA256,
    ARCHITECTURE_ID,
    CORPUS_ID,
    CORPUS_SHA256,
    MODEL_LINEAGE,
    PARENT_CHECKPOINT_SHA256,
    PARENT_MODEL_ID,
    RUN_ID,
    RUN_VERSION,
    TOKENIZER_ID,
    TOKENIZER_SHA256,
)
from fingerprints import dirty_tree_fingerprint, git_sha, hardware_fingerprint, software_fingerprint
from hashes import sha256_file, sha256_json
from training_config import official_training_config


def build_official_run_manifest(root: Path) -> dict:
    cfg = official_training_config()
    heldout = root / "model-lab/manifests/wave8_1/held-out-eval-suite.json"
    corpus_file = root / "model-lab/manifests/wave8_1/corpus-manifest.json"
    sw = software_fingerprint(root)
    dirty = dirty_tree_fingerprint(root)
    hw = hardware_fingerprint()
    return {
        "run_id": RUN_ID,
        "run_version": RUN_VERSION,
        "model_lineage": MODEL_LINEAGE,
        "parent_model_id": PARENT_MODEL_ID,
        "parent_checkpoint_sha256": PARENT_CHECKPOINT_SHA256,
        "corpus_id": CORPUS_ID,
        "corpus_sha256": CORPUS_SHA256,
        "dataset_manifest_sha256": sha256_file(corpus_file),
        "tokenizer_id": TOKENIZER_ID,
        "tokenizer_sha256": TOKENIZER_SHA256,
        "architecture_id": ARCHITECTURE_ID,
        "architecture_config_sha256": ARCHITECTURE_CONFIG_SHA256,
        "training_config_sha256": sha256_json(cfg),
        "heldout_manifest_sha256": sha256_file(heldout),
        "created_at": "2026-08-30T22:00:00.000Z",
        "git_sha": git_sha(root),
        "dirty_tree_fingerprint": dirty["aggregate_sha256"],
        "software_fingerprint": sw,
        "hardware_fingerprint": {
            "architecture": hw.get("architecture"),
            "machine_model": hw.get("machine_model"),
            "ram_bytes": hw.get("ram_bytes"),
            "mlx": {k: hw.get("mlx", {}).get(k) for k in ("imported", "has_set_cache_limit", "has_set_memory_limit", "has_get_peak_memory")},
        },
        "authorization_state": "AWAITING_COMMANDER_AUTHORIZATION",
        "training_status": "NOT_STARTED",
        "TRAINING_READY": True,
        "TRAINING_AUTHORIZED": False,
        "TRAINING_STARTED": False,
        "identity_immutable": True,
        "material_change_requires_new_run_id": True,
    }
