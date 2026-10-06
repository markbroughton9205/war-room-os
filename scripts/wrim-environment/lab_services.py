"""Start/stop WRIM lab loopback services. No Windows auto-start. Commander-managed."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from sovereign_lab import BIND, SVC, paths, start_services, stop_services, lab_env  # noqa: F401


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["start", "stop", "status"])
    args = parser.parse_args()
    p = paths()
    pids_path = p["pids"]
    if args.action == "status":
        print(pids_path.read_text(encoding="utf-8") if pids_path.exists() else "{}")
        return 0
    if args.action == "stop":
        if not pids_path.exists():
            print("{}")
            return 0
        import os, signal
        data = json.loads(pids_path.read_text(encoding="utf-8"))
        for name, pid in data.items():
            try:
                os.kill(int(pid), signal.SIGTERM)
            except OSError:
                continue
        pids_path.write_text("{}", encoding="utf-8")
        print(json.dumps({"stopped": list(data)}))
        return 0
    handle = start_services(p, {})
    print(json.dumps(handle.get("status"), indent=2))
    print("Services left running on 127.0.0.1. They are NOT registered as Windows startup services.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
