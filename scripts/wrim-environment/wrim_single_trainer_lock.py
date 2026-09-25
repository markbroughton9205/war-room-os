"""Fail-closed single-trainer lock for optimizer-backed WRIM runs.

A second process is refused before it can construct an optimizer.
A stale lock is cleared only when its PID is gone and no WRIM trainer process remains.
"""
from __future__ import annotations

import fcntl
import json
import os
import socket
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from wrim_hvu_identity import DATA_ROOT

LOCK_PATH = Path(DATA_ROOT) / "WRIM_SINGLE_TRAINER_LOCK.json"
FLOCK_PATH = Path(DATA_ROOT) / "WRIM_SINGLE_TRAINER_LOCK.flock"
MAX_ACTIVE_WRIM_TRAINERS = 1
TRAINER_SCRIPTS = {
    "wrim_ra1_train.py",
    "wrim_ra1_phrase_school.py",
    "wrim_ra1_grad_program.py",
    "wrim_ra1_final_program.py",
    "wrim_ra1_bridge_program.py",
    "wrim_ea1_consol.py",
    "wrim_ra1_continue.py",
    "wrim_ra1_continue2.py",
    "wrim_ra1_program.py",
    "wrim_ra1_curriculum_program.py",
    "wrim_ea1_program.py",
    "wrim_ea1_train.py",
    "wrim_ea1_parity.py",
    "wrim_ea1_consol.py",
    "wrim_ra1_pcgrad_train.py",
    "wrim_ra1_conflict_program.py",
    "wrim_ra1_pcgrad_horizon.py",
    "wrim_ra1_pcgrad_300k.py",
    "wrim_na1_mod01.py",
    "wrim_na1_validate.py",
    "wrim_na1_mod01b.py",
    "wrim_rmr1_mod02a.py",
    "wrim_ne1_mod03.py",
    "wrim_s09_instruction.py",
    "wrim_ir1_mod04.py",
    "wrim_iia1_mod05.py",
    "wrim_br1_mod06.py",
    "wrim_pilot_ab_10m.py",
    "wrim1_ab50m_train.py",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def active_wrim_trainers(*, exclude: set[int] | None = None) -> list[str]:
    skip = exclude or set()
    hits: list[str] = []
    proc = Path("/proc")
    if not proc.is_dir():
        return hits
    for pid_s in proc.iterdir():
        if not pid_s.name.isdigit():
            continue
        pid = int(pid_s.name)
        if pid in skip:
            continue
        try:
            parts = (pid_s / "cmdline").read_bytes().split(b"\x00")
        except OSError:
            continue
        args = [p.decode("utf-8", "replace") for p in parts if p]
        if not args or "python" not in Path(args[0]).name:
            continue
        names = {Path(a).name for a in args}
        if names & TRAINER_SCRIPTS:
            hits.append(f"{pid} {' '.join(args)[:180]}")
    return hits


def _read_lock() -> dict[str, Any] | None:
    if not LOCK_PATH.is_file():
        return None
    try:
        return json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"PID": -1, "CORRUPT": True}


def _write_lock(rec: dict[str, Any]) -> None:
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = LOCK_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(rec, indent=2), encoding="utf-8")
    os.replace(tmp, LOCK_PATH)


def _refuse(existing: dict[str, Any] | None, active: list[str]) -> dict[str, Any]:
    return {
        "ok": False,
        "reason": "WRIM_TRAINER_ALREADY_ACTIVE",
        "MAX_ACTIVE_WRIM_TRAINERS": MAX_ACTIVE_WRIM_TRAINERS,
        "LOCK": existing,
        "ACTIVE_TRAINERS": active,
        "OPTIMIZER_STEPS": 0,
        "TOKENS_USED": 0,
        "OPTIMIZER_CONSTRUCTED": "NO",
    }


def acquire_trainer_lock(
    *,
    run_id: str,
    authorization_id: str,
    checkpoint_parent: str,
    token_budget: int,
) -> dict[str, Any]:
    """Check-and-set under an exclusive flock. Nested acquire by the same PID is allowed."""
    FLOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with FLOCK_PATH.open("a+", encoding="utf-8") as fh:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        me = os.getpid()
        existing = _read_lock()
        others = active_wrim_trainers(exclude={me})
        if existing:
            owner = int(existing.get("PID") or -1)
            if owner == me and pid_alive(owner):
                existing["DEPTH"] = int(existing.get("DEPTH") or 1) + 1
                _write_lock(existing)
                return {"ok": True, "nested": True, "lock": existing}
            owner_alive = pid_alive(owner)
            if owner_alive or others:
                return _refuse(existing, others if others else [f"{owner} lock-owner-alive"])
            # Stale: recorded PID is gone and no other WRIM trainer process exists.
            existing = None
        if others:
            return _refuse(None, others)
        rec = {
            "RUN_ID": run_id,
            "PID": me,
            "START_TIME": _now(),
            "TRAINING_AUTHORIZATION_ID": authorization_id,
            "CHECKPOINT_PARENT": checkpoint_parent,
            "TOKEN_BUDGET": int(token_budget),
            "HOST": socket.gethostname(),
            "LOCK_OWNER": f"{socket.gethostname()}:{me}:{run_id}",
            "DEPTH": 1,
        }
        _write_lock(rec)
        return {"ok": True, "nested": False, "lock": rec}


def release_trainer_lock(run_id: str) -> dict[str, Any]:
    """Release one nest level. Only the owning PID may release."""
    if not FLOCK_PATH.parent.is_dir():
        return {"released": False, "reason": "no_lock_dir"}
    with FLOCK_PATH.open("a+", encoding="utf-8") as fh:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        existing = _read_lock()
        if not existing:
            return {"released": True, "reason": "already_clear"}
        if int(existing.get("PID") or -1) != os.getpid():
            return {"released": False, "reason": "not_owner", "lock": existing}
        depth = int(existing.get("DEPTH") or 1) - 1
        if depth > 0:
            existing["DEPTH"] = depth
            _write_lock(existing)
            return {"released": False, "nested_remaining": depth, "lock": existing}
        LOCK_PATH.unlink(missing_ok=True)
        return {"released": True, "run_id": run_id}
