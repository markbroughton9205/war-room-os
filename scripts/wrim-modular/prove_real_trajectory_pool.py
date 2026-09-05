#!/usr/bin/env python3
"""Prove WR-TOOL REAL TRAJECTORY ACQUISITION artifacts."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from paths import (
    EXP004_DESIGN_DIR,
    PRODUCTION_ROOT,
    ROOT,
    TOOL_EVAL_3_DIR,
    TRAJECTORY_POOL_DIR,
    V4_DESIGN_DIR,
)


def main() -> int:
    validator_path = TRAJECTORY_POOL_DIR / "validator.json"
    if not validator_path.exists():
        print("run build_real_trajectory_pool.py first")
        return 1
    validator = json.loads(validator_path.read_text(encoding="utf-8"))
    print(json.dumps({"n_pass": validator["n_pass"], "n_total": validator["n_total"], "verdict": validator["verdict"]}, indent=2))
    if PRODUCTION_ROOT.exists() and str(Path(__file__).resolve()).startswith(str(PRODUCTION_ROOT)):
        print("refusing to run from production tree")
        return 1
    required = [
        TRAJECTORY_POOL_DIR / "normalized-trajectories.jsonl",
        TRAJECTORY_POOL_DIR / "MANIFEST.json",
        TRAJECTORY_POOL_DIR / "source-inventory.json",
        V4_DESIGN_DIR / "MANIFEST.json",
        TOOL_EVAL_3_DIR / "suite.json",
        EXP004_DESIGN_DIR / "MANIFEST.json",
        ROOT / "docs" / "WR_TOOL_REAL_TRAJECTORY_ACQUISITION_REPORT.md",
        ROOT / "docs" / "WR_TOOL_CURRICULUM_V4_DESIGN.md",
        ROOT / "docs" / "WR_TOOL_EVAL_3_DESIGN.md",
        ROOT / "docs" / "WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_004_DESIGN.md",
    ]
    missing = [str(p) for p in required if not p.exists()]
    if missing:
        print("missing", missing)
        return 1
    if not validator.get("passed"):
        print(json.dumps([c for c in validator["checks"] if not c["ok"]], indent=2))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
