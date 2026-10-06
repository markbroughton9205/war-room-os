"""WRIM_GPU_QUIET_MODE design.

Temporary user-Ollama quiet mode for WRIM training. Does not disable the unit.
Does not change Ollama startup policy. Importing this module does not stop Ollama.

Proven 2026-09-23 on Nebula-Genesis:
  llama-server is a child of `ollama serve` under user systemd ollama.service.
  Pattern B: daemon stays; localhost POST /api/generate reloads llama-server.
  GET /api/tags and GET /api/ps do not load a model.
  `systemctl --user stop ollama.service` (not disable) is reversible quiet mode.
  A runtime-only mask blocks user-systemd restarts until cleanup.
  Restore only the captured activity and preserve prior masks/enablement.
  An external client may start the service again during a run; trainers must
  re-check exclusivity, not assume stop is globally sticky.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

UNIT = "ollama.service"
XDG = "/run/user/1000"
PROOF_SECONDS = (0, 10, 20, 30, 45, 60)
FREE_MIN_MIB = 8000
PREFERRED_FREE_MIB = 12000


def _user_env() -> dict[str, str]:
    env = dict(os.environ)
    env.setdefault("XDG_RUNTIME_DIR", XDG)
    return env


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def snapshot_prior_state() -> dict[str, Any]:
    state = _service_state()
    if state["is_active"] not in {"active", "inactive"}:
        raise RuntimeError(f"Cannot restore initial Ollama state exactly: {state}")
    if state["is_active"] == "active" and state["is_enabled"].startswith("masked"):
        raise RuntimeError("Cannot restore an initially active, masked Ollama safely")
    return {**state, "unit": UNIT, "scope": "user", "snapshotted_at": utc_now(),
            "runtime_mask_owned": False}


def _service_state() -> dict[str, str]:
    proc = subprocess.run(
        ["systemctl", "--user", "show", UNIT, "--property=ActiveState,UnitFileState,LoadState"],
        capture_output=True, text=True, env=_user_env(), check=True,
    )
    props = dict(line.split("=", 1) for line in proc.stdout.splitlines() if "=" in line)
    if props.get("LoadState") not in {"loaded", "masked"} or not props.get("UnitFileState"):
        raise RuntimeError(f"Cannot inspect Ollama service: {props}")
    return {"is_active": props["ActiveState"], "is_enabled": props["UnitFileState"]}


def _runtime_mask_path() -> Path:
    return Path(_user_env()["XDG_RUNTIME_DIR"]) / "systemd/user" / UNIT


def runtime_mask_user_ollama(prior: dict[str, Any]) -> None:
    """Own only a newly created runtime mask; never replace a unit or prior mask."""
    path = _runtime_mask_path()
    if prior["is_enabled"].startswith("masked"):
        return
    if path.exists() or path.is_symlink():
        raise RuntimeError(f"Refusing to replace existing runtime unit: {path}")
    try:
        subprocess.run(["systemctl", "--user", "mask", "--runtime", UNIT],
                       capture_output=True, text=True, env=_user_env(), check=True)
    finally:
        # Record partial success too, so a failed reload can still be unwound.
        if path.is_symlink() and os.readlink(path) == "/dev/null":
            prior["runtime_mask_owned"] = True
            prior["runtime_mask_inode"] = path.lstat().st_ino
    # On this systemd build, a valid --runtime mask may coexist with
    # UnitFileState=enabled in `systemctl show`. Verify the runtime mask
    # directly instead of requiring the misleading masked-runtime state.
    if not prior["runtime_mask_owned"]:
        raise RuntimeError("Runtime Ollama mask was not created")
    path = _runtime_mask_path()
    if not path.is_symlink() or os.readlink(path) != "/dev/null":
        raise RuntimeError("Runtime Ollama mask is not effective")
    if path.lstat().st_ino != prior["runtime_mask_inode"]:
        raise RuntimeError("Runtime Ollama mask ownership changed")


def runtime_unmask_user_ollama(prior: dict[str, Any]) -> None:
    if not prior.get("runtime_mask_owned"):
        return
    path = _runtime_mask_path()
    if (not path.is_symlink() or os.readlink(path) != "/dev/null"
            or path.lstat().st_ino != prior["runtime_mask_inode"]):
        raise RuntimeError("Runtime mask changed ownership; refusing to remove it")
    subprocess.run(["systemctl", "--user", "unmask", "--runtime", UNIT],
                   capture_output=True, text=True, env=_user_env(), check=True)
    prior["runtime_mask_owned"] = False


def restore_ollama_prior_state(prior: dict[str, Any]) -> dict[str, Any]:
    """Remove only our mask, restore activity, and verify unchanged enablement."""
    try:
        runtime_unmask_user_ollama(prior)
        current = _service_state()
        if current["is_enabled"] != prior["is_enabled"]:
            raise RuntimeError(f"Ollama enablement changed: {current}")
        action = "start" if prior["is_active"] == "active" else "stop"
        subprocess.run(["systemctl", "--user", action, UNIT],
                       capture_output=True, text=True, env=_user_env(), check=True)
        current = _service_state()
        matches = all(current[key] == prior[key] for key in ("is_active", "is_enabled"))
        return {"ok": matches, "matches_prior": matches, "action": action, **current}
    except Exception as exc:
        return {"ok": False, "matches_prior": False, "error": str(exc)}


def assert_gpu_quiet() -> None:
    """Synchronous check; query failures and loss of the mask fail closed."""
    state = _service_state()
    if state["is_active"] != "inactive":
        raise RuntimeError(f"Ollama quiet boundary violated: {state}")
    path = _runtime_mask_path()
    if not path.is_symlink() or os.readlink(path) != "/dev/null":
        raise RuntimeError(f"Ollama runtime mask missing at quiet boundary: {path}")
    # Bracket both patterns so pgrep -f cannot match its own argv.
    for pattern in (r"[o]llama serve", r"[l]lama-server"):
        proc = subprocess.run(
            ["pgrep", "-a", "-f", pattern],
            capture_output=True,
            text=True,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            raise RuntimeError(f"Ollama process present: {proc.stdout}")
        if proc.returncode not in {0, 1}:
            raise RuntimeError(
                f"Ollama process query failed rc={proc.returncode}: {proc.stderr}"
            )


def stop_user_ollama(*, prior: dict[str, Any] | None = None) -> dict[str, Any]:
    """Temporary stop. Does not disable. Does not kill Cursor/desktop."""
    env = _user_env()
    prior = prior or _service_state()
    proc = subprocess.run(["systemctl", "--user", "stop", UNIT], capture_output=True, text=True, env=env)
    leaked = stop_leaked_ollama_serve()
    return {"ok": proc.returncode == 0, "prior": prior, "stderr": proc.stderr[-500:], "leaked": leaked}


def leaked_ollama_pids() -> list[dict[str, Any]]:
    """ollama serve / llama-server only. Never Cursor or desktop processes."""
    rows = []
    for pattern in (r"[o]llama serve", "llama-server"):
        proc = subprocess.run(["pgrep", "-a", "-f", pattern], capture_output=True, text=True)
        for line in proc.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            pid_s, _, cmd = line.partition(" ")
            try:
                pid = int(pid_s)
            except ValueError:
                continue
            if "cursor" in cmd.lower() or "xdg-desktop" in cmd.lower():
                continue
            if "ollama" not in cmd and "llama-server" not in cmd:
                continue
            rows.append({"pid": pid, "cmd": cmd})
    uniq = {r["pid"]: r for r in rows}
    return list(uniq.values())


def stop_leaked_ollama_serve() -> dict[str, Any]:
    """SIGTERM leaked ollama serve / llama-server that survive unit stop. Does not disable."""
    found = leaked_ollama_pids()
    sent = []
    for row in found:
        try:
            os.kill(row["pid"], 15)
            sent.append(row)
        except ProcessLookupError:
            continue
    deadline = time.time() + 8
    while time.time() < deadline and leaked_ollama_pids():
        time.sleep(0.4)
    leftover = leaked_ollama_pids()
    for row in leftover:
        try:
            os.kill(row["pid"], 9)
        except ProcessLookupError:
            continue
    time.sleep(0.4)
    return {
        "found": found,
        "sigterm": sent,
        "leftover_after_term": leftover,
        "remaining": leaked_ollama_pids(),
    }


def start_user_ollama() -> dict[str, Any]:
    env = _user_env()
    proc = subprocess.run(["systemctl", "--user", "start", UNIT], capture_output=True, text=True, env=env)
    time.sleep(1)
    active = subprocess.run(
        ["systemctl", "--user", "is-active", UNIT], capture_output=True, text=True, env=env
    )
    enabled = subprocess.run(
        ["systemctl", "--user", "is-enabled", UNIT], capture_output=True, text=True, env=env
    )
    return {
        "ok": proc.returncode == 0 and active.stdout.strip() == "active",
        "is_active": active.stdout.strip(),
        "is_enabled": enabled.stdout.strip(),
    }


def gpu_snapshot() -> dict[str, Any]:
    gpu = subprocess.check_output(
        ["nvidia-smi", "--query-gpu=memory.used,memory.total,memory.free,utilization.gpu", "--format=csv,noheader,nounits"],
        text=True,
    ).strip()
    used, total, free, util = [p.strip() for p in gpu.split(",")]
    apps = subprocess.check_output(
        ["nvidia-smi", "--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader"],
        text=True,
    ).strip()
    llama = subprocess.run(["pgrep", "-a", "llama-server"], capture_output=True, text=True)
    return {
        "used_mib": float(used),
        "total_mib": float(total),
        "free_mib": float(free),
        "util_pct": float(util),
        "llama_server": llama.stdout.strip() or None,
        "apps": apps,
        "utc": utc_now(),
    }


def prove_exclusivity(offsets: tuple[int, ...] = PROOF_SECONDS, free_min: float = FREE_MIN_MIB) -> dict[str, Any]:
    samples = []
    t0 = time.perf_counter()
    ok = True
    min_free = 1e18
    for off in offsets:
        wait = t0 + off - time.perf_counter()
        if wait > 0:
            time.sleep(wait)
        snap = gpu_snapshot()
        min_free = min(min_free, snap["free_mib"])
        row_ok = snap["llama_server"] is None and snap["free_mib"] >= free_min
        ok = ok and row_ok
        samples.append({**snap, "offset_s": off, "ok": row_ok})
    return {
        "stable": ok,
        "min_free_mib": min_free,
        "preferred_12000": min_free >= PREFERRED_FREE_MIB,
        "samples": samples,
    }


def run_with_quiet(fn: Callable[[], Any], *, proof_path: Path | None = None) -> dict[str, Any]:
    """Stop user Ollama, prove 60s, run fn, restore even on failure."""
    prior = snapshot_prior_state()
    try:
        runtime_mask_user_ollama(prior)
        stopped = stop_user_ollama(prior=prior)
        if not stopped["ok"]:
            raise RuntimeError("Failed to stop Ollama")
        assert_gpu_quiet()
        proof = prove_exclusivity()
        if proof_path is not None:
            proof_path.write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
        if not proof["stable"]:
            return {"ok": False, "reason": "GPU_RESPAWN_OWNER_NOT_RESOLVED", "proof": proof, "prior": prior}
        assert_gpu_quiet()
        result = fn()
        return {"ok": True, "result": result, "proof": proof, "prior": prior, "stopped": stopped}
    finally:
        restored = restore_ollama_prior_state(prior)
        if not restored["ok"]:
            raise RuntimeError(f"Ollama restoration failed: {restored}")
