from __future__ import annotations

import json
import math
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

from hashes import sha256_file
from paths import repo_root

TRAINING_CODE_FILES = [
    "scripts/wrim1-training/constants.py",
    "scripts/wrim1-training/hashes.py",
    "scripts/wrim1-training/paths.py",
    "scripts/wrim1-training/training_config.py",
    "scripts/wrim1-training/fingerprints.py",
    "scripts/wrim1-training/rng_state.py",
    "scripts/wrim1-training/dataset_cursor.py",
    "scripts/wrim1-training/checkpoint_io.py",
    "scripts/wrim1-training/authorization.py",
    "scripts/wrim1-training/preflight.py",
    "scripts/wrim1-training/run_identity.py",
    "scripts/wrim1-training/run_status.py",
    "scripts/wrim1-training/materialize_shards.py",
    "scripts/wrim1-training/authorize_run.py",
    "scripts/wrim1-training/evaluate_wrim1.py",
    "scripts/wrim1-training/trainer_core.py",
    "scripts/wrim1-training/train_wrim1.py",
    "scripts/wrim1-training/prove_wave9.py",
    "scripts/sovereign-model-lab/wrim0_architecture.py",
    "lib/wrim1-training/types.ts",
    "lib/wrim1-training/integrity.ts",
    "lib/wrim1-training/authorization.ts",
    "lib/wrim1-training/comparison.ts",
    "lib/wrim1-training/promotion.ts",
    "lib/wrim1-training/gate.ts",
    "lib/wrim1-training/wave9.validation.ts",
]


def _sysctl(key: str) -> str | None:
    r = subprocess.run(["sysctl", "-n", key], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    return r.stdout.strip()


def git_sha(root: Path) -> str:
    r = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else "UNKNOWN"


def git_dirty(root: Path) -> dict:
    r = subprocess.run(["git", "status", "--porcelain"], cwd=root, capture_output=True, text=True)
    lines = [ln for ln in (r.stdout or "").splitlines() if ln.strip()]
    return {"dirty": len(lines) > 0, "porcelain_count": len(lines), "status_ok": r.returncode == 0}


def file_hashes(root: Path) -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    for rel in TRAINING_CODE_FILES:
        path = root / rel
        out[rel] = sha256_file(path) if path.is_file() else None
    return out


def dirty_tree_fingerprint(root: Path) -> dict:
    hashes = file_hashes(root)
    payload = json.dumps(hashes, sort_keys=True).encode("utf-8")
    import hashlib
    return {
        "kind": "training-code-fingerprint",
        "dirty_worktree": git_dirty(root),
        "file_sha256": hashes,
        "aggregate_sha256": hashlib.sha256(payload).hexdigest(),
        "note": "Dirty tree is not committed. This fingerprint identifies the implementation that would produce a future run.",
    }


def software_fingerprint(root: Path | None = None) -> dict:
    root = root or repo_root()
    py_pkgs = {}
    for name in ("mlx", "numpy", "safetensors", "tokenizers"):
        try:
            mod = __import__(name)
            py_pkgs[name] = getattr(mod, "__version__", "present-unknown-version")
        except Exception as exc:  # noqa: BLE001
            py_pkgs[name] = f"unavailable:{type(exc).__name__}"
    node = subprocess.run(["node", "-v"], capture_output=True, text=True)
    pnpm = subprocess.run(["pnpm", "-v"], capture_output=True, text=True)
    return {
        "macos_version": _sysctl("kern.osproductversion"),
        "darwin_version": platform.release(),
        "python_version": sys.version.split()[0],
        "python_implementation": platform.python_implementation(),
        "mlx_version": py_pkgs.get("mlx"),
        "node_version": node.stdout.strip() if node.returncode == 0 else None,
        "pnpm_version": pnpm.stdout.strip() if pnpm.returncode == 0 else None,
        "python_packages": py_pkgs,
        "git_sha": git_sha(root),
        "secrets_recorded": False,
    }


def hardware_fingerprint() -> dict:
    mem = _sysctl("hw.memsize")
    model = _sysctl("hw.model")
    machine = platform.machine()
    disk = shutil.disk_usage("/")
    swap = None
    vm = subprocess.run(["sysctl", "vm.swapusage"], capture_output=True, text=True)
    if vm.returncode == 0:
        swap = vm.stdout.strip()
    mlx_caps = {"imported": False}
    try:
        import mlx.core as mx
        mlx_caps = {
            "imported": True,
            "has_set_cache_limit": hasattr(mx, "set_cache_limit"),
            "has_set_memory_limit": hasattr(mx, "set_memory_limit"),
            "has_get_peak_memory": hasattr(mx, "get_peak_memory"),
            "has_get_active_memory": hasattr(mx, "get_active_memory"),
            "has_clear_cache": hasattr(mx, "clear_cache"),
            "default_device": str(getattr(mx, "default_device", lambda: None)()),
        }
        if hasattr(mx, "get_active_memory"):
            mlx_caps["active_memory_bytes"] = int(mx.get_active_memory())
        if hasattr(mx, "get_peak_memory"):
            mlx_caps["peak_memory_bytes"] = int(mx.get_peak_memory())
    except Exception as exc:  # noqa: BLE001
        mlx_caps = {"imported": False, "error": type(exc).__name__, "detail": str(exc)[:200]}
    return {
        "architecture": machine,
        "machine_model": model,
        "ram_bytes": int(mem) if mem and mem.isdigit() else None,
        "cuda_assumed": False,
        "disk_free_bytes": int(disk.free),
        "disk_total_bytes": int(disk.total),
        "swap": swap,
        "mlx": mlx_caps,
        "logical_cpus": os.cpu_count(),
    }


def resource_plan() -> dict:
    params = 19_217_152
    model_bytes = params * 4
    optimizer_bytes = params * 4 * 2
    sidecar_overhead = 2 * 1024 * 1024
    bundle_bytes = model_bytes + optimizer_bytes + sidecar_overhead
    retained = 6
    genesis_peak_low = 3_280_000_000
    genesis_peak_high = 3_430_000_000
    genesis_seconds = 2293.99
    genesis_steps = 500
    sec_per_step = genesis_seconds / genesis_steps
    steps = 1893
    runtime_sec = sec_per_step * steps
    return {
        "planned_steps": {"value": steps, "class": "DERIVED", "from": "ceil(7749800 / (8*512))"},
        "planned_tokens": {"value": 7_749_800, "class": "DERIVED", "from": "3874900 unique train * 2 epochs"},
        "expected_model_checkpoint_bytes": {"value": model_bytes, "class": "DERIVED", "from": "19217152 params * 4 bytes fp32"},
        "expected_optimizer_state_bytes": {"value": optimizer_bytes, "class": "DERIVED", "from": "AdamW first+second moment, fp32"},
        "expected_bundle_bytes": {"value": bundle_bytes, "class": "DERIVED"},
        "wrim0_combined_safetensors_bytes": {
            "value": 230_655_880,
            "class": "MEASURED",
            "from": "checkpoint-final.safetensors on disk (model+optimizer combined Genesis format)",
        },
        "temporary_checkpoint_overhead_bytes": {"value": bundle_bytes, "class": "DERIVED", "from": "one extra incomplete tmp bundle"},
        "retained_checkpoint_storage_bytes": {"value": bundle_bytes * retained, "class": "DERIVED", "from": "latest+best+4 milestones"},
        "metrics_log_overhead_bytes": {"value": 2_000_000, "class": "SPECULATIVE", "from": "~1KB/step * 1893 plus validation records"},
        "minimum_free_disk_bytes": {
            "value": bundle_bytes * (retained + 2) + 2_000_000 + 5 * 1024 * 1024 * 1024,
            "class": "DERIVED",
            "from": "retained bundles + tmp + metrics + 5GiB headroom",
        },
        "ram_safety_headroom_bytes": {
            "value": 8_589_934_592 - genesis_peak_high,
            "class": "DERIVED",
            "from": "8GiB unified minus Genesis MEASURED peak high",
        },
        "genesis_peak_memory_bytes": {"low": genesis_peak_low, "high": genesis_peak_high, "class": "MEASURED"},
        "runtime_seconds": {
            "best": 2.4 * 3600,
            "expected": runtime_sec,
            "high": 3.12 * 3600,
            "class": "DERIVED",
            "from": f"Genesis {genesis_seconds}s / {genesis_steps} steps * {steps}",
        },
        "runtime_hours_expected": {"value": runtime_sec / 3600, "class": "DERIVED"},
        "sec_per_step_genesis": {"value": sec_per_step, "class": "MEASURED"},
    }
