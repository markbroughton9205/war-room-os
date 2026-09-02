#!/usr/bin/env python3
"""Class-diverse REAL_RUNTIME collection proofs. No training."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from paths import PRODUCTION_ROOT, ROOT, WRIM0_CHECKPOINT_SHA256, WRIM0_WEIGHTS  # noqa: E402

LEDGER = ROOT / "model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-CLASS-DIVERSITY-V1"
OBSERVER = ROOT / "model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-OBSERVER-DEV-V1"
EVAL3 = ROOT / "model-lab/eval-only/WR-TOOL-EVAL-3/suite.json"
EXPECTED = 10


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
            f"Class-diverse runtime Python proofs: TOTAL={len(self.results)} EXPECTED={self.expected} "
            f"PASS={passed} FAIL={len(failed)}"
        )
        LEDGER.mkdir(parents=True, exist_ok=True)
        (LEDGER / "python-proof.json").write_text(
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

    def wrim0_hash() -> None:
        if not WRIM0_WEIGHTS.exists():
            raise AssertionError(f"missing {WRIM0_WEIGHTS}")
        got = sha256_file(WRIM0_WEIGHTS)
        if got != WRIM0_CHECKPOINT_SHA256:
            raise AssertionError("WRIM-0 hash changed")

    def observer_proof_intact() -> None:
        summary = json.loads((OBSERVER / "session-summary.json").read_text(encoding="utf-8"))
        if summary.get("REAL_RUNTIME") != 11:
            raise AssertionError("observer-dev session-summary overwritten")

    def ledger_exists() -> None:
        for name in (
            "raw-trajectories.jsonl",
            "normalized-trajectories.jsonl",
            "quality-results.jsonl",
            "session-summary.json",
            "v4-readiness.json",
        ):
            if not (LEDGER / name).exists():
                raise AssertionError(f"missing {name}")

    def all_real_runtime_raw() -> None:
        n = 0
        for line in (LEDGER / "raw-trajectories.jsonl").read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            n += 1
            if rec.get("source_type") != "REAL_RUNTIME":
                raise AssertionError(f"{rec.get('trajectory_id')} not REAL_RUNTIME")
            if rec.get("review_state") != "RAW":
                raise AssertionError("review_state not RAW")
            if rec.get("auto_verified") or rec.get("auto_curriculum"):
                raise AssertionError("auto promotion")
            blob = json.dumps(rec)
            if "Bearer " in blob:
                raise AssertionError("bearer leak")
        if n < 10:
            raise AssertionError(f"too few records {n}")

    def eval3_not_overwritten() -> None:
        suite = json.loads(EVAL3.read_text(encoding="utf-8"))
        if suite.get("suite_id") != "WR-TOOL-EVAL-3":
            raise AssertionError("EVAL-3 identity changed")
        if suite.get("item_count") != 13:
            raise AssertionError("EVAL-3 size changed")
        summary = json.loads((LEDGER / "session-summary.json").read_text(encoding="utf-8"))
        if summary.get("eval3_leaks"):
            raise AssertionError(f"eval3 leaks {summary['eval3_leaks']}")

    def no_training_in_collector() -> None:
        src = (ROOT / "scripts/wrim-modular/collect_class_diverse_runtime.ts").read_text(encoding="utf-8")
        for needle in ("run_lora", "ModelLabOptimizer", "WRIM1-RUN-000003", "promote_checkpoint"):
            if needle in src:
                raise AssertionError(needle)

    def production_path_unwritten() -> None:
        if not PRODUCTION_ROOT.exists():
            return
        marker = PRODUCTION_ROOT / "THIS_COLLECTION_MUST_NOT_EXIST.json"
        if marker.exists():
            raise AssertionError("collection wrote production marker")

    def memory_not_fabricated() -> None:
        summary = json.loads((LEDGER / "session-summary.json").read_text(encoding="utf-8"))
        if summary["per_class_runtime"]["MEMORY"] != 0:
            raise AssertionError("unexpected MEMORY rows without service role")
        if summary["per_class_gold"]["MEMORY"] != 0:
            raise AssertionError("MEMORY gold fabricated")

    def v4_not_ready_without_memory() -> None:
        summary = json.loads((LEDGER / "session-summary.json").read_text(encoding="utf-8"))
        if "MEMORY" not in " ".join(summary.get("v4_class_gaps") or []):
            raise AssertionError("V4 gaps omitted MEMORY")
        if summary.get("v4_readiness") != "WR-TOOL V4 — MORE REAL EXPERIENCE REQUIRED":
            raise AssertionError("V4 readiness too optimistic")

    def no_experiment_004() -> None:
        summary = json.loads((LEDGER / "session-summary.json").read_text(encoding="utf-8"))
        if summary["optimizer_training"]["experiment_004"]:
            raise AssertionError("experiment 004 started")

    h.check("01 WRIM-0 checkpoint hash unchanged", wrim0_hash)
    h.check("02 original observer-dev proof intact", observer_proof_intact)
    h.check("03 class-diversity ledger files present", ledger_exists)
    h.check("04 RAW REAL_RUNTIME only; no auto-verify; no bearer", all_real_runtime_raw)
    h.check("05 EVAL-3 not overwritten and no input leak", eval3_not_overwritten)
    h.check("06 collector does not invoke training", no_training_in_collector)
    h.check("07 production path not written", production_path_unwritten)
    h.check("08 MEMORY not fabricated", memory_not_fabricated)
    h.check("09 V4 still blocked on MEMORY", v4_not_ready_without_memory)
    h.check("10 Experiment 004 not started", no_experiment_004)
    return h.finish()


if __name__ == "__main__":
    raise SystemExit(main())
