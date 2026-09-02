#!/usr/bin/env python3
"""Deterministic proofs for WR-TOOL-CURRICULUM-V3 / WR-TOOL-EVAL-2."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from paths import PRODUCTION_ROOT, ROOT, TOOL_EVAL_2_DIR, V3_CURRICULUM_DIR


def main() -> int:
    summary_path = V3_CURRICULUM_DIR / "build-summary.json"
    validator_path = V3_CURRICULUM_DIR / "validator.json"
    if not validator_path.exists():
        print("validator.json missing; run build_tool_curriculum_v3.py")
        return 1
    validator = json.loads(validator_path.read_text(encoding="utf-8"))
    print(json.dumps({"n_pass": validator["n_pass"], "n_total": validator["n_total"], "verdict": validator["verdict"]}, indent=2))
    if PRODUCTION_ROOT.exists():
        # do not write; only assert this script's path is not under production
        here = Path(__file__).resolve()
        if str(PRODUCTION_ROOT) in str(here):
            print("refusing to run from production tree")
            return 1
    if not validator.get("passed"):
        print(json.dumps([c for c in validator["checks"] if not c["ok"]], indent=2))
        return 1
    required = [
        V3_CURRICULUM_DIR / "supervised-examples.jsonl",
        V3_CURRICULUM_DIR / "MANIFEST.json",
        TOOL_EVAL_2_DIR / "suite.json",
        ROOT / "docs" / "WR_TOOL_CURRICULUM_V3_DESIGN.md",
        ROOT / "docs" / "WR_TOOL_EVAL_2_DESIGN.md",
        ROOT / "docs" / "WR_TOOL_EVIDENCE_EXPANSION_REPORT.md",
        ROOT / "docs" / "WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_003_DESIGN.md",
    ]
    missing = [str(p) for p in required if not p.exists()]
    if missing:
        print("missing artifacts", missing)
        return 1
    if summary_path.exists():
        print("summary", summary_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
