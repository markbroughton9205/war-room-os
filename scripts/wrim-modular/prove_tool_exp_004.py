#!/usr/bin/env python3
"""Proofs for WR-TOOL-EXP-004 training artifacts."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.resolve().parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

from paths import (  # noqa: E402
    EXP002_DIR,
    EXP003_DIR,
    EXP004_DIR,
    EXP004_HEAD_ID,
    EXP004_LORA_ID,
    EXP004_RUN_ID,
    FROZEN_V4_TRAIN_HASH,
    PRODUCTION_ROOT,
    TOOL_EVAL_2_ITEMS,
    TOOL_EVAL_3_DIR,
    TOOL_EVAL_4_DIR,
    V4_CANDIDATE_DIR,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_WEIGHTS,
)

EXPECTED = 22


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    work = EXP004_DIR
    results = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        results.append({"name": name, "ok": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + (f": {detail}" if not ok else ""))

    summary = json.loads((work / "experiment-summary.json").read_text())
    verdict = json.loads((work / "final-verdict.json").read_text())
    proofs = json.loads((work / "pre-training-proofs.json").read_text())
    corep = json.loads((work / "core-immutability-proof.json").read_text())
    reloadp = json.loads((work / "reload-proof.json").read_text())
    hashes = json.loads((work / "HASHES.json").read_text())
    gates = json.loads((work / "success-gate-report.json").read_text())
    cmap = json.loads((work / "class-map.json").read_text())
    dist = json.loads((work / "train-class-distribution.json").read_text())

    check("run dir exists", work.is_dir())
    check("run id", summary.get("run_id") == EXP004_RUN_ID)
    check("WRIM-0 file SHA", sha256_file(WRIM0_WEIGHTS) == WRIM0_CHECKPOINT_SHA256)
    check("train hash frozen", sha256_file(V4_CANDIDATE_DIR / "train.jsonl") == FROZEN_V4_TRAIN_HASH)
    eval4 = json.loads((TOOL_EVAL_4_DIR / "HASHES.json").read_text())
    check("EVAL-4 bundle", eval4["combined_bundle"] == hashes["eval4"])
    check("class map 6", cmap["order"] == ["NO_TOOL", "WEB", "MEMORY", "FILES", "RESEARCH", "SHA256"])
    check("lora/head/total", summary["lora_params"] == 36864 and summary["head_params"] == 1542 and summary["total_trainable_params"] == 38406)
    check("core trainable 0", summary["core_trainable_params"] == 0)
    check("core max_abs_diff 0", corep["max_abs_diff_after_training"] == 0)
    check("reload ok", reloadp.get("reload_ok") is True)
    check("active modules empty", summary.get("active_modules") == [])
    check("no promotion", verdict.get("do_not_promote") is True)
    check("standard CE", dist.get("class_weighting", "").startswith("NONE"))
    check("EVAL-2 still 115", sum(1 for line in TOOL_EVAL_2_ITEMS.read_text().splitlines() if line.strip()) == 115)
    check("EVAL-3 still 13", json.loads((TOOL_EVAL_3_DIR / "suite.json").read_text())["item_count"] == 13)
    check("EXP002 present", EXP002_DIR.is_dir())
    check("EXP003 present", EXP003_DIR.is_dir())
    check("not production path", str(PRODUCTION_ROOT) not in str(work))
    check("lora artifact", (work / "module" / EXP004_LORA_ID / "weights.safetensors").is_file())
    check("head artifact", (work / "module" / EXP004_HEAD_ID / "weights.safetensors").is_file())
    check("pre-training proofs passed", proofs.get("passed") is True)
    check("gates recorded", "primary_test_accuracy" in gates)

    passed = sum(1 for r in results if r["ok"])
    payload = {"expected": EXPECTED, "total": len(results), "passed": passed, "all_ok": passed == EXPECTED and len(results) == EXPECTED, "results": results}
    (work / "python-proof.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    (work / "validator.json").write_text(
        json.dumps(
            {
                "n_pass": passed,
                "n_total": len(results),
                "passed": payload["all_ok"],
                "checks": [{"name": r["name"], "ok": r["ok"], "detail": r["detail"]} for r in results],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"EXP004 training proofs TOTAL={len(results)} PASS={passed}")
    return 0 if payload["all_ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
