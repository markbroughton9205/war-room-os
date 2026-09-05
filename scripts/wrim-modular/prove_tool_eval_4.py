#!/usr/bin/env python3
"""Proofs for WR-TOOL-EVAL-4-CANDIDATE. Does not rematerialize. No training."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from paths import (  # noqa: E402
    FROZEN_V4_TRAIN_HASH,
    PRODUCTION_ROOT,
    ROOT,
    TOOL_EVAL_2_ITEMS,
    TOOL_EVAL_3_DIR,
    TOOL_EVAL_4_DIR,
    V4_CANDIDATE_DIR,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_WEIGHTS,
)

EXPECTED = 18


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Harness:
    def __init__(self, expected: int):
        self.expected = expected
        self.results: list[dict] = []

    def check(self, name: str, fn) -> None:
        try:
            fn()
            self.results.append({"name": name, "ok": True})
            print(f"PASS {name}")
        except Exception as exc:  # noqa: BLE001
            self.results.append({"name": name, "ok": False, "detail": str(exc)})
            print(f"FAIL {name}: {exc}")

    def finish(self) -> int:
        passed = sum(1 for r in self.results if r["ok"])
        failed = [r for r in self.results if not r["ok"]]
        print(
            f"EVAL-4 Python proofs: TOTAL={len(self.results)} EXPECTED={self.expected} "
            f"PASS={passed} FAIL={len(failed)}"
        )
        (TOOL_EVAL_4_DIR / "python-proof.json").write_text(
            json.dumps(
                {
                    "expected": self.expected,
                    "total": len(self.results),
                    "passed": passed,
                    "failed": failed,
                    "results": self.results,
                    "official_training_started": False,
                    "experiment_004_started": False,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        if failed or len(self.results) != self.expected:
            return 1
        return 0


def main() -> int:
    h = Harness(EXPECTED)
    summary = json.loads((TOOL_EVAL_4_DIR / "session-summary.json").read_text())
    hashes = json.loads((TOOL_EVAL_4_DIR / "HASHES.json").read_text())
    proof = json.loads((TOOL_EVAL_4_DIR / "determinism-proof.json").read_text())
    validator = json.loads((TOOL_EVAL_4_DIR / "validator.json").read_text())
    e3 = json.loads((TOOL_EVAL_3_DIR / "suite.json").read_text())

    def train_freeze() -> None:
        got = sha256_file(V4_CANDIDATE_DIR / "train.jsonl")
        if got != FROZEN_V4_TRAIN_HASH:
            raise AssertionError(got)

    def train_n() -> None:
        n = sum(1 for line in (V4_CANDIDATE_DIR / "train.jsonl").read_text().splitlines() if line.strip())
        if n != 26:
            raise AssertionError(n)

    def wrim0() -> None:
        if sha256_file(WRIM0_WEIGHTS) != WRIM0_CHECKPOINT_SHA256:
            raise AssertionError("WRIM-0 hash changed")

    def eval2() -> None:
        n = sum(1 for line in TOOL_EVAL_2_ITEMS.read_text().splitlines() if line.strip())
        if n != 115:
            raise AssertionError(n)

    def eval3() -> None:
        if e3.get("suite_id") != "WR-TOOL-EVAL-3" or e3.get("item_count") != 13:
            raise AssertionError("EVAL-3 mutated")

    def leaks() -> None:
        leak = summary["leakage"]
        for key in ("train", "EVAL-2", "EVAL-3"):
            if leak[key]["exact_n"] or leak[key]["normalized_n"] or leak[key]["family_n"]:
                raise AssertionError(key)

    def six() -> None:
        if not (summary["all_six_heldout"] and summary["all_six_test"] and summary["all_six_validation"]):
            raise AssertionError("missing class coverage")

    def sizes() -> None:
        if summary["final_eval_rows"] != 32 or summary["validation_n"] != 16 or summary["test_n"] != 16:
            raise AssertionError("unexpected sizes")

    def det() -> None:
        if not proof.get("hashes_identical"):
            raise AssertionError("determinism failed")

    def val_pass() -> None:
        if not validator.get("passed") or validator.get("n_pass") != 37:
            raise AssertionError(validator)

    def no_exp004() -> None:
        if summary["experiment_004"] or summary["training_invoked"]:
            raise AssertionError("training/exp started")
        weights = ROOT / "model-lab/manifests/modular-intelligence/WR-TOOL-PI-EXP-004/weights"
        if weights.exists():
            raise AssertionError("exp004 weights exist")

    def prod() -> None:
        if str(PRODUCTION_ROOT) in str(TOOL_EVAL_4_DIR):
            raise AssertionError("eval4 inside production")

    def hashes_match() -> None:
        if sha256_file(TOOL_EVAL_4_DIR / "rows.jsonl") != hashes["rows.jsonl"]:
            raise AssertionError("rows hash drift")
        if hashes["v4_train.jsonl_before"] != hashes["v4_train.jsonl_after"]:
            raise AssertionError("train hash drift")

    def memory_distinct() -> None:
        if summary["MEMORY_overlap_with_train_families"]:
            raise AssertionError(summary["MEMORY_overlap_with_train_families"])

    def exclude_train() -> None:
        man = json.loads((TOOL_EVAL_4_DIR / "MANIFEST.json").read_text())
        if not man.get("EXCLUDE_FROM_TRAINING"):
            raise AssertionError("missing EXCLUDE_FROM_TRAINING")

    def modules() -> None:
        if summary["active_modules"] != []:
            raise AssertionError(summary["active_modules"])

    def provenance() -> None:
        n_synth = summary["provenance_counts"].get("EVAL_SYNTHETIC", 0)
        n_rt = summary["provenance_counts"].get("REAL_RUNTIME", 0)
        if n_rt != 0:
            raise AssertionError("unexpected REAL_RUNTIME in designed package")
        if n_synth < 1:
            raise AssertionError("MEMORY synthetic missing")

    def prod_flag() -> None:
        if not summary["production_untouched"]:
            raise AssertionError("production_untouched false")

    h.check("train freeze hash", train_freeze)
    h.check("train n=26", train_n)
    h.check("WRIM-0 hash", wrim0)
    h.check("EVAL-2 n=115", eval2)
    h.check("EVAL-3 n=13 identity", eval3)
    h.check("leaks zero", leaks)
    h.check("six-class coverage", six)
    h.check("sizes 32/16/16", sizes)
    h.check("determinism", det)
    h.check("builder validator 37/37", val_pass)
    h.check("no EXP-004 / no training", no_exp004)
    h.check("not in production tree", prod)
    h.check("artifact hashes", hashes_match)
    h.check("MEMORY families vs train", memory_distinct)
    h.check("EXCLUDE_FROM_TRAINING", exclude_train)
    h.check("active modules empty", modules)
    h.check("provenance mix honest", provenance)
    h.check("production flag", prod_flag)

    return h.finish()


if __name__ == "__main__":
    raise SystemExit(main())
