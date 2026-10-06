"""Process liveness / heartbeat helpers. Does not train."""
from __future__ import annotations

import json
import os
import signal
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_heartbeat(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rec = {"timestamp": utc_now(), **row}
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())


def ram_rss_bytes() -> int | None:
    try:
        with open("/proc/self/status", encoding="utf-8") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) * 1024
    except OSError:
        return None
    return None


def vram_free_mib() -> int | None:
    try:
        import torch

        if not torch.cuda.is_available():
            return None
        free, _total = torch.cuda.mem_get_info()
        return int(free / (1024 * 1024))
    except Exception:
        return None


def disk_free_bytes(path: Path) -> int | None:
    try:
        usage = os.statvfs(str(path))
        return int(usage.f_bavail * usage.f_frsize)
    except OSError:
        return None


def oom_kill_evidence() -> dict[str, Any]:
    hits = []
    dmesg = Path("/var/log/kern.log")
    for p in (Path("/proc/self/oom_score"),):
        try:
            hits.append({"path": str(p), "value": p.read_text(encoding="utf-8").strip()[:80]})
        except OSError:
            continue
    return {"oom_score": hits, "kernel_oom_log_scanned": dmesg.is_file()}


class TerminationCapture:
    def __init__(self) -> None:
        self.signal: int | None = None
        self.python_exception: str | None = None
        self.exit_code: int | None = None

    def install(self) -> None:
        def handler(signum, _frame):
            self.signal = int(signum)
            # Log only. The controlling agent shell sends SIGTERM when a
            # poll times out; treating that as fatal recreated the RUN-000010
            # incomplete-eval failure. SIGINT still raises below.

        signal.signal(signal.SIGTERM, handler)
        signal.signal(signal.SIGHUP, handler)
        signal.signal(signal.SIGINT, signal.default_int_handler)
