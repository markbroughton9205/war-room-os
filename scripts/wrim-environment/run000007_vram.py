"""PRETRAIN VRAM gate for WRIM1-RUN-000007. Does not kill processes. Does not train."""
from __future__ import annotations

import shutil
import subprocess
from typing import Any

from run000007_identity import REQUIRED_FREE_VRAM_MIB, RUN000006_OOM_FREE_MIB

OLLAMA_HINT = (
    "If nvidia-smi shows ollama / qwen2.5-coder:14b occupying VRAM, the proven "
    "operational action is to stop only the user ollama.service for the training "
    "window, then restore it after the run. This gate does not stop it."
)


def query_gpu() -> dict[str, Any]:
    if not shutil.which("nvidia-smi"):
        return {"ok": False, "reason": "nvidia-smi_missing", "gpus": []}
    try:
        out = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=index,name,compute_cap,memory.total,memory.used,memory.free",
                "--format=csv,noheader,nounits",
            ],
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "reason": f"nvidia-smi_failed:{exc}", "gpus": []}
    gpus = []
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 6:
            continue
        gpus.append(
            {
                "index": int(parts[0]),
                "name": parts[1],
                "compute_cap": parts[2],
                "memory_total_mib": float(parts[3]),
                "memory_used_mib": float(parts[4]),
                "memory_free_mib": float(parts[5]),
            }
        )
    return {"ok": bool(gpus), "gpus": gpus, "raw": out.strip()}


def ollama_vram_hint(smi_raw: str) -> dict[str, Any]:
    try:
        proc = subprocess.check_output(
            ["nvidia-smi", "--query-compute-apps=pid,process_name,used_gpu_memory", "--format=csv,noheader,nounits"],
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        proc = ""
    rows = []
    ollama = False
    for line in proc.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 3:
            name = parts[1].lower()
            rows.append({"pid": parts[0], "process_name": parts[1], "used_mib": parts[2]})
            if "ollama" in name:
                ollama = True
    return {"compute_apps": rows, "ollama_present": ollama, "kill_processes": False, "hint": OLLAMA_HINT if ollama else None}


def vram_preflight(*, required_free_mib: float = REQUIRED_FREE_VRAM_MIB, probe: dict[str, Any] | None = None) -> dict[str, Any]:
    info = probe if probe is not None else query_gpu()
    gpus = list(info.get("gpus") or [])
    free = max((float(g.get("memory_free_mib") or 0) for g in gpus), default=0.0)
    enough = bool(gpus) and free >= float(required_free_mib)
    apps = ollama_vram_hint(str(info.get("raw") or "")) if probe is None else {"compute_apps": [], "ollama_present": False, "kill_processes": False}
    decision = "PASS" if enough else "PRETRAIN_ABORT"
    return {
        "ok": enough,
        "decision": decision,
        "REQUIRED_FREE_VRAM_MIB": float(required_free_mib),
        "FREE_VRAM_MIB": free,
        "RUN000006_OOM_FREE_MIB": RUN000006_OOM_FREE_MIB,
        "gpus": gpus,
        "apps": apps,
        "abort_before_optimizer": not enough,
        "auto_kill": False,
        "prepared_ollama_stop": bool(apps.get("ollama_present")) and (not enough),
        "note": "RUN-000006 OOM occurred at ~340 MiB free while qwen2.5-coder:14b held ~9.7 GiB. Require 4096 MiB free before AdamW.",
    }


def ollama_user_active() -> bool:
    try:
        out = subprocess.check_output(["systemctl", "--user", "is-active", "ollama.service"], text=True, timeout=15)
        return out.strip() == "active"
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return False


def stop_user_ollama() -> dict[str, Any]:
    """Stop only user ollama.service. Does not kill unrelated processes."""
    active = ollama_user_active()
    if not active:
        return {"stopped": False, "was_active": False, "service": "ollama.service"}
    try:
        subprocess.check_call(["systemctl", "--user", "stop", "ollama.service"], timeout=60)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        return {"stopped": False, "was_active": True, "error": str(exc), "service": "ollama.service"}
    return {"stopped": True, "was_active": True, "service": "ollama.service"}


def start_user_ollama() -> dict[str, Any]:
    try:
        subprocess.check_call(["systemctl", "--user", "start", "ollama.service"], timeout=60)
        return {"restored": True, "service": "ollama.service", "active": ollama_user_active()}
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        return {"restored": False, "error": str(exc), "service": "ollama.service", "active": ollama_user_active()}


def ensure_vram_for_training(*, required_free_mib: float = REQUIRED_FREE_VRAM_MIB) -> dict[str, Any]:
    before = vram_preflight(required_free_mib=required_free_mib)
    ollama_before = bool(before.get("apps", {}).get("ollama_present")) or ollama_user_active()
    stopped = {"stopped": False, "was_active": ollama_user_active()}
    if (not before["ok"]) and ollama_before:
        stopped = stop_user_ollama()
        after = vram_preflight(required_free_mib=required_free_mib)
    else:
        after = before
    return {
        "OLLAMA_ACTIVE_BEFORE": ollama_before,
        "OLLAMA_STOPPED_FOR_TRAINING": bool(stopped.get("stopped")),
        "VRAM_FREE_BEFORE_TRAINING": after.get("FREE_VRAM_MIB"),
        "VRAM_FREE_BEFORE_OLLAMA_STOP": before.get("FREE_VRAM_MIB"),
        "ok": bool(after.get("ok")),
        "before": before,
        "after": after,
        "stop": stopped,
    }
