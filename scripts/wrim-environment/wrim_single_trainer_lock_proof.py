"""Prove the single-trainer lock. No authorized optimizer steps."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

from wrim_hvu_identity import CKPT_BASE, DATA_ROOT
from wrim_single_trainer_lock import (
    LOCK_PATH,
    acquire_trainer_lock,
    active_wrim_trainers,
    pid_alive,
    release_trainer_lock,
)

PROOF_PATH = Path(DATA_ROOT) / "WRIM_SINGLE_TRAINER_LOCK_PROOF.json"
HOLDER = r"""
import json, os, sys, time
from pathlib import Path
sys.path.insert(0, sys.argv[1])
os.chdir(sys.argv[1])
from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock
ready = Path(sys.argv[2])
stop = Path(sys.argv[3])
lock = acquire_trainer_lock(
    run_id="WRIM-LOCK-PROOF-HOLDER",
    authorization_id="WRIM_SINGLE_TRAINER_LOCK_PROOF",
    checkpoint_parent="NONE",
    token_budget=0,
)
ready.write_text(json.dumps({"pid": os.getpid(), "ok": bool(lock.get("ok"))}), encoding="utf-8")
while not stop.is_file():
    time.sleep(0.05)
release_trainer_lock("WRIM-LOCK-PROOF-HOLDER")
"""


def main() -> dict:
    here = Path(__file__).resolve().parent
    work = Path(DATA_ROOT) / "lock-proof"
    work.mkdir(parents=True, exist_ok=True)
    ready = work / "holder-ready.json"
    stop = work / "holder-stop"
    for p in (ready, stop):
        if p.is_file():
            p.unlink()
    if LOCK_PATH.is_file():
        existing = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
        owner = int(existing.get("PID") or -1)
        if pid_alive(owner) or active_wrim_trainers(exclude={os.getpid()}):
            raise RuntimeError(f"live trainer lock, not cleared: {existing}")
        LOCK_PATH.unlink()
    # Stale lock: dead PID and no trainer. Must be clearable.
    stale_pid = 2**22
    assert not pid_alive(stale_pid)
    LOCK_PATH.write_text(json.dumps({
        "RUN_ID": "STALE",
        "PID": stale_pid,
        "START_TIME": "stale",
        "TRAINING_AUTHORIZATION_ID": "STALE",
        "CHECKPOINT_PARENT": "NONE",
        "TOKEN_BUDGET": 0,
        "HOST": "stale",
        "LOCK_OWNER": "stale",
        "DEPTH": 1,
    }), encoding="utf-8")
    stale = acquire_trainer_lock(
        run_id="WRIM-LOCK-PROOF-STALE-CLEAR",
        authorization_id="WRIM_SINGLE_TRAINER_LOCK_PROOF",
        checkpoint_parent="NONE",
        token_budget=0,
    )
    stale_ok = bool(stale.get("ok")) and int((stale.get("lock") or {}).get("PID") or -1) == os.getpid()
    release_trainer_lock("WRIM-LOCK-PROOF-STALE-CLEAR")
    assert not LOCK_PATH.is_file()

    holder_py = work / "holder.py"
    holder_py.write_text(HOLDER, encoding="utf-8")
    proc = subprocess.Popen(
        [sys.executable, str(holder_py), str(here), str(ready), str(stop)],
        cwd=str(here),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    deadline = time.time() + 20
    while time.time() < deadline and not ready.is_file():
        if proc.poll() is not None:
            err = proc.stderr.read() if proc.stderr else ""
            raise RuntimeError(f"holder exited early {proc.returncode} {err}")
        time.sleep(0.05)
    holder = json.loads(ready.read_text(encoding="utf-8"))
    assert holder["ok"] is True
    assert pid_alive(int(holder["pid"]))

    from wrim_ra1_train import train_ra1

    refused_id = "WRIM-LOCK-PROOF-REFUSED"
    refused_root = Path(CKPT_BASE) / refused_id
    if refused_root.exists():
        raise RuntimeError("refused run dir already exists")
    refused = train_ra1(
        run_id=refused_id,
        corpus_dir=Path(DATA_ROOT) / "WR-CORPUS-PLM-SHORT-PHRASE-ALIGN-1-v1.0.0",
        parent_ckpt=Path(CKPT_BASE) / "WRIM1-UH1-AC2-RA1-PS-000004" / "step-12",
        steps=5,
        reset_adapter=False,
        authorization_id="WRIM_SINGLE_TRAINER_LOCK_PROOF",
    )
    refused_ok = (
        refused.get("reason") == "WRIM_TRAINER_ALREADY_ACTIVE"
        and int(refused.get("OPTIMIZER_STEPS", -1)) == 0
        and int(refused.get("TOKENS_USED", -1)) == 0
        and refused.get("OPTIMIZER_CONSTRUCTED") == "NO"
        and not refused_root.exists()
        and not (refused_root / "metrics.jsonl").is_file()
    )
    stop.write_text("stop", encoding="utf-8")
    proc.wait(timeout=20)
    holder_released = not LOCK_PATH.is_file() and proc.returncode == 0

    later = acquire_trainer_lock(
        run_id="WRIM-LOCK-PROOF-LATER",
        authorization_id="WRIM_SINGLE_TRAINER_LOCK_PROOF",
        checkpoint_parent="NONE",
        token_budget=0,
    )
    later_ok = bool(later.get("ok")) and int((later.get("lock") or {}).get("PID") or -1) == os.getpid()
    release_trainer_lock("WRIM-LOCK-PROOF-LATER")
    later_released = not LOCK_PATH.is_file()

    report = {
        "PROOF_ID": "WRIM_SINGLE_TRAINER_LOCK_PROOF",
        "1_AUTHORIZED_TRAINER_OBTAINS_LOCK": "PASS" if holder["ok"] else "FAIL",
        "2_SECOND_TRAINER_REFUSED": "PASS" if refused.get("reason") == "WRIM_TRAINER_ALREADY_ACTIVE" else "FAIL",
        "3_REFUSED_TRAINER_ZERO_OPTIMIZER_STEPS": "PASS" if refused_ok else "FAIL",
        "4_FIRST_TRAINER_EXITS": "PASS" if proc.returncode == 0 else "FAIL",
        "5_LOCK_RELEASES_CLEANLY": "PASS" if holder_released else "FAIL",
        "6_LATER_TRAINER_ACQUIRES": "PASS" if later_ok and later_released else "FAIL",
        "STALE_LOCK_CLEARED_ONLY_AFTER_DEAD_PID": "PASS" if stale_ok else "FAIL",
        "ACTIVE_TRAINERS_AT_END": active_wrim_trainers(exclude={os.getpid()}),
        "REFUSED_RETURN": refused,
        "SINGLE_TRAINER_LOCK_PROOF": "PASS" if all((
            holder["ok"], refused_ok, proc.returncode == 0, holder_released, later_ok, later_released, stale_ok,
        )) else "FAIL",
    }
    PROOF_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in report if k != "REFUSED_RETURN"}, indent=2))
    if report["SINGLE_TRAINER_LOCK_PROOF"] != "PASS":
        raise SystemExit(1)
    return report


if __name__ == "__main__":
    main()
