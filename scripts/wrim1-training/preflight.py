from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

from constants import (
    ARCHITECTURE_CONFIG_SHA256,
    CORPUS_SHA256,
    HELDOUT_MANIFEST_SHA256,
    PARENT_CHECKPOINT_REL,
    PARENT_CHECKPOINT_SHA256,
    TEST_TOKENS,
    TOKENIZER_REL,
    TOKENIZER_SHA256,
    TRAIN_TOKENS,
    TRAINING_CONFIG_SHA256,
    VAL_TOKENS,
)
from hashes import sha256_file, sha256_json
from paths import official_ckpt_dir, repo_root, wave9_dir
from fingerprints import hardware_fingerprint, software_fingerprint
from recover_frozen_corpus import verify_bundle, worktree_drift_report
from training_config import official_training_config


def _ok(name: str, passed: bool, detail: str, critical: bool = True) -> dict:
    return {"name": name, "passed": passed, "detail": detail, "critical": critical}


def _scan_text(text: str) -> tuple[bool, bool]:
    secret = bool(re.search(
        r"(?:api[_-]?key|token|secret|password|authorization|cookie)\s*[=:]\s*[^\s,;]+|Bearer\s+[A-Za-z0-9._~+\/-]+",
        text,
        re.I,
    ))
    hidden = bool(
        re.search(r"</?(?:think|scratchpad|hidden_cot)\b", text, re.I)
        or re.search(r"(?:chain[-_ ]of[-_ ]thought|hidden[_-]reasoning|reasoning[_-]trace)\s*[:=]", text, re.I)
    )
    return secret, hidden


def _conflicting_train_process() -> list[str]:
    try:
        proc = subprocess.run(["pgrep", "-fl", "train_wrim1.py"], capture_output=True, text=True)
    except OSError:
        return []
    lines = [ln for ln in (proc.stdout or "").splitlines() if ln.strip() and "--mode official" in ln]
    return lines


def run_preflight(root: Path | None = None, *, require_mlx: bool = True, mode: str = "start", require_corpus_bytes: bool = False, require_materialized: bool = True) -> dict:
    root = root or repo_root()
    checks = []

    parent = root / PARENT_CHECKPOINT_REL
    checks.append(_ok("parent_checkpoint_exists", parent.is_file(), str(parent)))
    parent_sha = sha256_file(parent) if parent.is_file() else None
    checks.append(_ok("parent_checkpoint_sha", parent_sha == PARENT_CHECKPOINT_SHA256, parent_sha or "missing"))

    corpus = root / "model-lab/manifests/wave8_1/corpus-manifest.json"
    checks.append(_ok("hardened_corpus_exists", corpus.is_file(), str(corpus)))
    corpus_id_hash = None
    token_counts = {}
    if corpus.is_file():
        parsed = json.loads(corpus.read_text(encoding="utf-8"))
        corpus_id_hash = parsed.get("contentHash")
        token_counts = {
            "train": parsed.get("uniqueNewTrainTokens"),
            "validation": parsed.get("uniqueNewValidationTokens"),
            "test": parsed.get("uniqueNewTestTokens"),
        }
    checks.append(_ok("corpus_sha", corpus_id_hash == CORPUS_SHA256, corpus_id_hash or "missing"))

    bundle = verify_bundle(root)
    checks.append(_ok(
        "corpus_materialized_integrity",
        bool(bundle.get("ok")),
        bundle.get("detail") or "missing",
        critical=require_materialized or require_corpus_bytes,
    ))
    man = bundle.get("manifest") or {}
    checks.append(_ok(
        "materialized_bundle_hash",
        bool(man.get("materializedBundleHash")) and man.get("corpusIdentityHash") == CORPUS_SHA256,
        man.get("materializedBundleHash") or "missing",
        critical=require_materialized or require_corpus_bytes,
    ))
    source_ok = bool(bundle.get("ok"))
    token_ok = bool(bundle.get("ok"))
    checks.append(_ok("source_shard_hashes", source_ok, f"sourceShards={len(man.get('sourceShards') or [])}", critical=require_materialized or require_corpus_bytes))
    checks.append(_ok("token_shard_hashes", token_ok, f"tokenShards={len(man.get('tokenShards') or [])}", critical=require_materialized or require_corpus_bytes))
    drift = worktree_drift_report(root)
    checks.append(_ok(
        "source_worktree_drift",
        True,
        f"status={drift['status']} detected={drift['detected']} mismatches={drift['mismatches']} paths={drift['paths'][:10]}",
        critical=False,
    ))
    # Historical name retained as an alias of materialized integrity so older reports remain comparable.
    checks.append(_ok(
        "corpus_bytes_reconstructable",
        bool(bundle.get("ok")),
        "replaced_by=corpus_materialized_integrity " + (bundle.get("detail") or ""),
        critical=require_corpus_bytes,
    ))

    tokenizer = root / TOKENIZER_REL
    checks.append(_ok("tokenizer_exists", tokenizer.is_file(), str(tokenizer)))
    tok_sha = sha256_file(tokenizer) if tokenizer.is_file() else None
    checks.append(_ok("tokenizer_sha", tok_sha == TOKENIZER_SHA256, tok_sha or "missing"))

    parent_json = root / "model-lab/manifests/wrim0_checkpoints/checkpoint-final.json"
    arch_ok = False
    if parent_json.is_file():
        meta = json.loads(parent_json.read_text(encoding="utf-8"))
        arch_ok = meta.get("architectureConfigHash") == ARCHITECTURE_CONFIG_SHA256
    checks.append(_ok("architecture_matches_parent", arch_ok, ARCHITECTURE_CONFIG_SHA256))

    heldout = root / "model-lab/manifests/wave8_1/held-out-eval-suite.json"
    checks.append(_ok("heldout_exists", heldout.is_file(), str(heldout)))
    held_hash = sha256_file(heldout) if heldout.is_file() else None
    frozen = root / "model-lab/manifests/wave9/held-out-fingerprint.json"
    if frozen.is_file():
        expected = json.loads(frozen.read_text(encoding="utf-8")).get("heldout_manifest_sha256")
        checks.append(_ok("heldout_hash", held_hash == expected, held_hash or "missing"))
    else:
        checks.append(_ok("heldout_hash", held_hash is not None, held_hash or "missing", critical=False))

    behavior = root / "model-lab/manifests/wave8_1/behavior-examples.json"
    examples = 0
    if behavior.is_file():
        examples = json.loads(behavior.read_text(encoding="utf-8")).get("count", 0)
    checks.append(_ok("behavior_examples_exist", examples >= 20, f"count={examples}"))
    checks.append(_ok(
        "token_counts",
        token_counts.get("train") == TRAIN_TOKENS
        and token_counts.get("validation") == VAL_TOKENS
        and token_counts.get("test") == TEST_TOKENS,
        json.dumps(token_counts),
    ))
    checks.append(_ok("train_val_test_payloads", corpus.is_file() and heldout.is_file() and behavior.is_file(), "wave8_1 manifests"))

    hw = hardware_fingerprint()
    disk_free = hw.get("disk_free_bytes") or 0
    ram = hw.get("ram_bytes") or 0
    checks.append(_ok("disk_free", disk_free > 8 * 1024 ** 3, f"free={disk_free}"))
    checks.append(_ok("ram", ram >= 8 * 1024 ** 3 or ram == 8589934592, f"ram={ram}"))
    mlx = hw.get("mlx") or {}
    mlx_ok = bool(mlx.get("imported")) and bool(mlx.get("has_set_cache_limit")) and bool(mlx.get("has_set_memory_limit"))
    checks.append(_ok("mlx_available", mlx_ok if require_mlx else True, json.dumps({k: mlx.get(k) for k in ("imported", "has_set_cache_limit", "has_set_memory_limit", "error")})))
    py = sys.version_info
    checks.append(_ok("python_version", py >= (3, 9), sys.version.split()[0]))

    out_dir = wave9_dir(root)
    checks.append(_ok("output_writable", os.access(out_dir.parent, os.W_OK), str(out_dir.parent)))
    checks.append(_ok("metrics_writable", os.access(out_dir.parent, os.W_OK), str(out_dir.parent)))

    official = official_ckpt_dir(root)
    existing_weights = official.exists() and any(official.rglob("model.safetensors"))
    run_path = wave9_dir(root) / "WRIM1-RUN-000001.json"
    run = json.loads(run_path.read_text(encoding="utf-8")) if run_path.is_file() else {}
    checks.append(_ok("official_run_id", run.get("run_id") == "WRIM1-RUN-000001", str(run.get("run_id"))))
    cfg_path = wave9_dir(root) / "training-config.json"
    cfg_ok = False
    cfg_hash = None
    if cfg_path.is_file():
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        cfg_hash = sha256_json(cfg)
        live_hash = sha256_json(official_training_config())
        cfg_ok = cfg_hash == TRAINING_CONFIG_SHA256 == live_hash == run.get("training_config_sha256")
    checks.append(_ok("training_config_hash", cfg_ok, cfg_hash or "missing"))
    checks.append(_ok(
        "heldout_manifest_integrity",
        held_hash == HELDOUT_MANIFEST_SHA256 and run.get("heldout_manifest_sha256") == HELDOUT_MANIFEST_SHA256,
        held_hash or "missing",
    ))

    secret_hit = False
    hidden_hit = False
    w9 = wave9_dir(root)
    if w9.is_dir():
        for path in w9.rglob("*"):
            if not path.is_file():
                continue
            if "test-only" in path.parts or path.name.endswith(".token") or path.suffix in {".npy", ".safetensors"}:
                continue
            if path.suffix not in {".json", ".txt", ".jsonl", ".md"}:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            s, h = _scan_text(text)
            secret_hit = secret_hit or s
            hidden_hit = hidden_hit or h
    if behavior.is_file():
        for example in json.loads(behavior.read_text(encoding="utf-8")).get("examples", []):
            s, h = _scan_text(example.get("renderedTrainingText") or "")
            secret_hit = secret_hit or s
            hidden_hit = hidden_hit or h
    checks.append(_ok("secret_scan", not secret_hit, "wave9+wave8.1 behavior"))
    checks.append(_ok("hidden_cot_scan", not hidden_hit, "wave9+wave8.1 behavior"))

    leakage_ok = False
    if corpus.is_file():
        leakage = parsed.get("leakage") or {}
        leakage_ok = leakage.get("passed") is True and not leakage.get("heldOutCollisions")
    checks.append(_ok("leakage_lineage_gate", leakage_ok, "wave8_1 leakage.passed"))

    live_procs = _conflicting_train_process()
    pid_path = official / "train.pid"
    pid_conflict = False
    if pid_path.is_file():
        try:
            old = int(pid_path.read_text(encoding="utf-8").strip())
            os.kill(old, 0)
            pid_conflict = True
        except (ValueError, OSError, ProcessLookupError):
            pid_conflict = False
    checks.append(_ok("no_conflicting_process", not live_procs and not pid_conflict, f"procs={len(live_procs)} pid_live={pid_conflict}"))

    completed = run.get("training_status") in {"COMPLETED", "TRAINED", "EVALUATED", "EVALUATING"}
    auth_path = wave9_dir(root) / "authorization.json"
    auth = json.loads(auth_path.read_text(encoding="utf-8")) if auth_path.is_file() else {}
    completed = completed or auth.get("authorization_state") in {"COMPLETED"}
    if mode == "start":
        checks.append(_ok("no_conflicting_active_run", not existing_weights, str(official)))
        checks.append(_ok("no_completed_wrim1_run", not completed and not existing_weights, str(run.get("training_status"))))
    else:
        checks.append(_ok("no_conflicting_active_run", True, "resume mode"))
        checks.append(_ok("no_completed_wrim1_run", not completed, str(run.get("training_status"))))

    lineage_conflict = False
    if official.exists():
        for manifest_path in official.rglob("checkpoint-manifest.json"):
            try:
                man = json.loads(manifest_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                lineage_conflict = True
                continue
            if man.get("run_id") not in (None, "WRIM1-RUN-000001"):
                lineage_conflict = True
            if man.get("test_only") is True:
                lineage_conflict = True
    checks.append(_ok("no_lineage_conflict", not lineage_conflict, str(official)))
    checks.append(_ok("no_pretend_official_checkpoint", not (mode == "start" and existing_weights), "wrim1_checkpoints"))

    sw = software_fingerprint(root)
    critical_fail = [c for c in checks if c["critical"] and not c["passed"]]
    return {
        "passed": len(critical_fail) == 0,
        "checks": checks,
        "hardware": hw,
        "software": sw,
        "disk_free_bytes": disk_free,
        "ram_bytes": ram,
        "failures": [c["name"] for c in critical_fail],
    }
