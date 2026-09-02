#!/usr/bin/env python3
"""Double-fork detach of official WRIM1-RUN-000001. Token is env-only, never argv/log."""
from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from authorization import token_path  # noqa: E402
from constants import RUN_ID  # noqa: E402
from hashes import sha256_file  # noqa: E402
from paths import repo_root, wave9_dir  # noqa: E402


TRAINER = SCRIPT_DIR / "train_wrim1.py"
ARGV = [
    "--mode", "official",
    "--run-manifest", "model-lab/manifests/wave9/WRIM1-RUN-000001.json",
    "--require-authorization-state", "AUTHORIZED",
]


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    root = repo_root()
    os.chdir(str(root))
    log_dir = wave9_dir(root) / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "WRIM1-RUN-000001-training.log"
    status_path = log_dir / "WRIM1-RUN-000001-runtime-status.json"
    token = token_path(root)
    if not token.is_file():
        print("detached launch blocked: authorization token file missing", file=sys.stderr)
        return 2
    fingerprint = hashlib.sha256(
        (sha256_file(TRAINER) + " " + " ".join(ARGV)).encode("utf-8")
    ).hexdigest()
    if os.fork() > 0:
        return 0
    os.setsid()
    if os.fork() > 0:
        os._exit(0)
    os.chdir(str(root))
    os.umask(0)
    fd = os.open(str(log_path), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    os.dup2(fd, 1)
    os.dup2(fd, 2)
    os.close(fd)
    null = os.open(os.devnull, os.O_RDONLY)
    os.dup2(null, 0)
    os.close(null)
    os.environ["PYTHONUNBUFFERED"] = "1"
    os.environ["WRIM1_COMMANDER_AUTHORIZATION_TOKEN"] = token.read_text(encoding="utf-8").strip()
    pid = os.getpid()
    status = {
        "run_id": RUN_ID,
        "pid": pid,
        "launch_mode": "durable_background_double_fork",
        "started_at": iso_now(),
        "log_path": str(log_path),
        "status": "TRAINING_BACKGROUND",
        "last_observed_step": 0,
        "last_observed_at": iso_now(),
        "command_fingerprint": fingerprint,
        "command_argv": ["python3", str(TRAINER.relative_to(root)), *ARGV],
        "restart_source": "WRIM-0 parent / step 0",
        "attempt": 2,
        "token_on_argv": False,
    }
    status_path.write_text(json.dumps(status, indent=2) + "\n", encoding="utf-8")
    os.execv(sys.executable, [sys.executable, str(TRAINER), *ARGV])
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
