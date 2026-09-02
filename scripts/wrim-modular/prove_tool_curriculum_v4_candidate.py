#!/usr/bin/env python3
"""Proofs for WR-TOOL-CURRICULUM-V4-CANDIDATE. No training."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from paths import PRODUCTION_ROOT, ROOT, TOOL_EVAL_3_DIR, V3_CURRICULUM_DIR, V4_CANDIDATE_DIR


def main() -> int:
    validator_path = V4_CANDIDATE_DIR / "validator.json"
    if not validator_path.exists():
        print("validator.json missing; run build_tool_curriculum_v4_candidate.py")
        return 1
    validator = json.loads(validator_path.read_text(encoding="utf-8"))
    print(json.dumps({"n_pass": validator["n_pass"], "n_total": validator["n_total"], "passed": validator["passed"]}, indent=2))
    if PRODUCTION_ROOT.exists() and str(PRODUCTION_ROOT) in str(Path(__file__).resolve()):
        print("refusing to run from production tree")
        return 1
    required = [
        V4_CANDIDATE_DIR / "MANIFEST.json",
        V4_CANDIDATE_DIR / "rows.jsonl",
        V4_CANDIDATE_DIR / "train.jsonl",
        V4_CANDIDATE_DIR / "validation.jsonl",
        V4_CANDIDATE_DIR / "test.jsonl",
        V4_CANDIDATE_DIR / "HASHES.json",
        V4_CANDIDATE_DIR / "dataset-card.json",
        V4_CANDIDATE_DIR / "readiness-verdict.json",
        ROOT / "docs" / "WR_TOOL_CURRICULUM_V4_MATERIALIZATION_REVIEW.md",
        V3_CURRICULUM_DIR / "supervised-examples.jsonl",
        TOOL_EVAL_3_DIR / "suite.json",
    ]
    missing = [str(p) for p in required if not p.exists()]
    if missing:
        print("missing", missing)
        return 1
    if not validator.get("passed"):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
