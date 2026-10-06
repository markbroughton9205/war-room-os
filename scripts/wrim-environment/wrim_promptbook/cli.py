"""CLI for wrim-foundation. No optimizer construction."""
from __future__ import annotations

import argparse
import json
from typing import Any

from wrim_promptbook.engine import Engine, ReturnBoundary
from wrim_promptbook.store import read_json, read_jsonl
from wrim_promptbook.tests import run_all_tests


def _print(obj: Any) -> None:
    print(json.dumps(obj, indent=2, default=str))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="wrim-foundation", description="WRIM Genesis Foundation Promptbook runner")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in (
        "status",
        "plan",
        "run-current-stage",
        "resume",
        "evaluate",
        "verify",
        "report",
        "pause",
        "abort-safe",
        "show-ledger",
        "show-capability",
        "show-next-boundary",
        "dry-run",
        "test",
        "bootstrap",
        "crash-recover",
        "authorize-foundation",
    ):
        sp = sub.add_parser(name)
        if name == "evaluate":
            sp.add_argument("--suite", default="status")
        if name == "bootstrap":
            sp.add_argument("--force", action="store_true")
        if name == "authorize-foundation":
            sp.add_argument("--ceiling", type=int, required=True)
            sp.add_argument("--commander", default="MARK")
    args = p.parse_args(argv)
    eng = Engine()
    try:
        if args.cmd == "bootstrap":
            _print(eng.bootstrap())
        elif args.cmd == "status":
            _print(eng.status())
        elif args.cmd == "plan":
            _print(eng.plan())
        elif args.cmd == "run-current-stage":
            _print(eng.run_current_stage(dry=False))
        elif args.cmd == "resume":
            _print(eng.resume())
        elif args.cmd == "evaluate":
            _print(eng.evaluate(args.suite))
        elif args.cmd == "verify":
            _print(eng.verify_truth())
        elif args.cmd == "report":
            _print(eng.report())
        elif args.cmd == "pause":
            _print(eng.pause())
        elif args.cmd == "abort-safe":
            _print(eng.abort_safe())
        elif args.cmd == "show-ledger":
            _print(read_jsonl(eng.paths()["ledger"]))
        elif args.cmd == "show-capability":
            _print(read_json(eng.paths()["matrix"]))
        elif args.cmd == "show-next-boundary":
            from wrim_promptbook.identity import RETURN_BOUNDARIES
            _print({"return_to_commander": RETURN_BOUNDARIES, "current": None})
        elif args.cmd == "dry-run":
            _print(eng.dry_run())
        elif args.cmd == "crash-recover":
            _print(eng.crash_recover())
        elif args.cmd == "authorize-foundation":
            _print(eng.authorize_foundation_execution(ceiling=args.ceiling, commander=args.commander))
        elif args.cmd == "test":
            _print(run_all_tests())
        else:
            raise SystemExit(f"unknown {args.cmd}")
    except ReturnBoundary as e:
        _print({"ok": False, "return_boundary": e.code, "detail": e.detail})
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
