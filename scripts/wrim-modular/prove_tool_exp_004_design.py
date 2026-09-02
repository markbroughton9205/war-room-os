#!/usr/bin/env python3
"""Proofs for WR-TOOL-EXP-004-DESIGN. Does not train."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.resolve().parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

from paths import (  # noqa: E402
    EXP004_DESIGN_PKG_DIR,
    FROZEN_V4_TRAIN_HASH,
    PRODUCTION_ROOT,
    TOOL_EVAL_2_ITEMS,
    TOOL_EVAL_3_DIR,
    V4_CANDIDATE_DIR,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_WEIGHTS,
)

EXPECTED = 12


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    work = EXP004_DESIGN_PKG_DIR
    summary = json.loads((work / "session-summary.json").read_text())
    dry = json.loads((work / "dry-run-proof.json").read_text())
    val = json.loads((work / "validator.json").read_text())
    results = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        results.append({"name": name, "ok": ok, "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + (f": {detail}" if not ok else ""))

    check("design dir exists", work.is_dir())
    check("validator 25/25", val.get("passed") is True and val.get("n_pass") == 25)
    check("train hash", sha256_file(V4_CANDIDATE_DIR / "train.jsonl") == FROZEN_V4_TRAIN_HASH)
    check("WRIM-0 file", sha256_file(WRIM0_WEIGHTS) == WRIM0_CHECKPOINT_SHA256)
    check("no optimizer step", dry["optimizer_step_invoked"] is False)
    check("core diff 0", dry["core_max_abs_diff_after_forward"] == 0.0)
    check("params 36864/1542/38406", dry["n_lora"] == 36864 and dry["n_head"] == 1542)
    check("EVAL-2 115", sum(1 for line in TOOL_EVAL_2_ITEMS.read_text().splitlines() if line.strip()) == 115)
    check("EVAL-3 13", json.loads((TOOL_EVAL_3_DIR / "suite.json").read_text())["item_count"] == 13)
    check(
        "no weights experiment dir",
        not (ROOT / "model-lab/manifests/modular-intelligence/WR-TOOL-PI-EXP-004/weights").exists(),
    )
    check("not in production", str(PRODUCTION_ROOT) not in str(work))
    check("EXP004 not started flag", summary["experiment_004_started"] is False)

    passed = sum(1 for r in results if r["ok"])
    (work / "python-proof.json").write_text(
        json.dumps({"expected": EXPECTED, "total": len(results), "passed": passed, "results": results}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    print(f"EXP004 design proofs TOTAL={len(results)} PASS={passed}")
    return 0 if passed == EXPECTED and len(results) == EXPECTED else 1


if __name__ == "__main__":
    raise SystemExit(main())
