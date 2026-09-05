#!/usr/bin/env python3
"""MEMORY REAL_RUNTIME collection proofs. No training. No secret values."""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from paths import PRODUCTION_ROOT, ROOT, WRIM0_CHECKPOINT_SHA256, WRIM0_WEIGHTS  # noqa: E402

LEDGER = ROOT / "model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-MEMORY-V1"
OBSERVER = ROOT / "model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-OBSERVER-DEV-V1"
CLASS_DIV = ROOT / "model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-CLASS-DIVERSITY-V1"
EVAL3 = ROOT / "model-lab/eval-only/WR-TOOL-EVAL-3/suite.json"
COLLECTOR = ROOT / "scripts/wrim-modular/collect_memory_runtime.ts"
EXPECTED = 12


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
            f"MEMORY runtime Python proofs: TOTAL={len(self.results)} EXPECTED={self.expected} "
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

    def class_div_intact() -> None:
        summary = json.loads((CLASS_DIV / "session-summary.json").read_text(encoding="utf-8"))
        if summary.get("total_new_REAL_RUNTIME") != 17:
            raise AssertionError("class-diversity ledger mutated")
        if summary.get("per_class_gold", {}).get("MEMORY") != 0:
            raise AssertionError("class-diversity MEMORY gold changed")

    def ledger_files() -> None:
        for name in (
            "MANIFEST.json",
            "raw-trajectories.jsonl",
            "normalized-trajectories.jsonl",
            "quality-results.jsonl",
            "session-summary.json",
            "v4-readiness.json",
            "credential-check.json",
            "runtime-path.json",
            "family-map.json",
            "files-vs-memory-boundary.json",
            "notool-vs-memory-boundary.json",
            "store-status.json",
            "sanitization-proof.json",
            "echo-int-role.json",
            "lookup-note-role.json",
            "v4-class-space-recommendation.json",
        ):
            if not (LEDGER / name).exists():
                raise AssertionError(f"missing {name}")

    def credential_and_no_fabricated_memory() -> None:
        cred = json.loads((LEDGER / "credential-check.json").read_text(encoding="utf-8"))
        summary = json.loads((LEDGER / "session-summary.json").read_text(encoding="utf-8"))
        if cred.get("SUPABASE_SERVICE_ROLE_KEY") not in ("AVAILABLE", "MISSING"):
            raise AssertionError("credential status not binary")
        if cred.get("value_not_recorded") is not True:
            raise AssertionError("credential value recorded")
        if cred["SUPABASE_SERVICE_ROLE_KEY"] == "MISSING":
            if summary.get("MEMORY_REAL_RUNTIME") != 0:
                raise AssertionError("MEMORY rows fabricated without service role")
            if summary.get("live_memory_executed") is not False:
                raise AssertionError("live memory claimed without key")
        jwt_re = re.compile(r"eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}")
        for path in LEDGER.iterdir():
            if not path.is_file():
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            if jwt_re.search(text):
                raise AssertionError(f"jwt-shaped secret in {path.name}")
            if "Bearer " in text:
                raise AssertionError(f"bearer leak in {path.name}")

    def raw_rows_honest() -> None:
        n = 0
        for line in (LEDGER / "raw-trajectories.jsonl").read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            n += 1
            if rec.get("source_type") != "REAL_RUNTIME":
                raise AssertionError("not REAL_RUNTIME")
            if rec.get("review_state") != "RAW":
                raise AssertionError("review_state not RAW")
            if rec.get("auto_verified") or rec.get("auto_curriculum"):
                raise AssertionError("auto promotion")
            if rec.get("training_invoked"):
                raise AssertionError("training invoked")
            if rec.get("selected_tool") == "memory":
                cred = json.loads((LEDGER / "credential-check.json").read_text(encoding="utf-8"))
                if cred["SUPABASE_SERVICE_ROLE_KEY"] == "MISSING":
                    raise AssertionError("memory row without credential")
            blob = json.dumps(rec)
            if "Bearer " in blob:
                raise AssertionError("bearer leak")
            if "SUPABASE_SERVICE_ROLE_KEY=" in blob and "MISSING" not in blob:
                # name-only mentions in skipped logs are ok; assignment of a value is not
                pass

    def eval3_intact() -> None:
        suite = json.loads(EVAL3.read_text(encoding="utf-8"))
        if suite.get("suite_id") != "WR-TOOL-EVAL-3" or suite.get("item_count") != 13:
            raise AssertionError("EVAL-3 mutated")
        summary = json.loads((LEDGER / "session-summary.json").read_text(encoding="utf-8"))
        if summary.get("eval3_leaks"):
            raise AssertionError(f"eval3 leaks {summary['eval3_leaks']}")

    def no_training_in_collector() -> None:
        src = COLLECTOR.read_text(encoding="utf-8")
        for needle in ("run_lora", "ModelLabOptimizer", "WRIM1-RUN-000003", "promote_checkpoint"):
            if needle in src:
                raise AssertionError(needle)

    def production_untouched() -> None:
        marker = PRODUCTION_ROOT / "THIS_MEMORY_COLLECTION_MUST_NOT_EXIST.json"
        if marker.exists():
            raise AssertionError("wrote production marker")

    def v4_and_roles() -> None:
        summary = json.loads((LEDGER / "session-summary.json").read_text(encoding="utf-8"))
        echo = json.loads((LEDGER / "echo-int-role.json").read_text(encoding="utf-8"))
        lookup = json.loads((LEDGER / "lookup-note-role.json").read_text(encoding="utf-8"))
        if echo.get("block_v4_on_missing_REAL_RUNTIME") is not False:
            raise AssertionError("ECHO_INT incorrectly blocking")
        if lookup.get("do_not_force_live_collection") is not True:
            raise AssertionError("LOOKUP_NOTE live collection forced")
        if summary.get("v4_readiness") != "WR-TOOL V4 — MORE REAL EXPERIENCE REQUIRED":
            if summary.get("post_mission_MEMORY_gold", 0) < 2:
                raise AssertionError("V4 ready without MEMORY gold")
        if summary.get("optimizer_training", {}).get("experiment_004"):
            raise AssertionError("experiment 004 started")

    def class_space_not_silently_changed() -> None:
        rec = json.loads((LEDGER / "v4-class-space-recommendation.json").read_text(encoding="utf-8"))
        if rec.get("do_not_silently_change") is not True:
            raise AssertionError("silent class-space change")
        current = rec.get("current_eight") or []
        if len(current) != 8:
            raise AssertionError("current eight missing")

    def files_boundary_files_side() -> None:
        bound = json.loads((LEDGER / "files-vs-memory-boundary.json").read_text(encoding="utf-8"))
        if bound.get("files_executed") is not True:
            raise AssertionError("FILES side of boundary not executed")
        summary = json.loads((LEDGER / "session-summary.json").read_text(encoding="utf-8"))
        if summary.get("supabase_service_role") == "MISSING" and bound.get("memory_executed"):
            raise AssertionError("MEMORY boundary fabricated")

    h.check("01 WRIM-0 checkpoint hash unchanged", wrim0_hash)
    h.check("02 original observer-dev proof intact", observer_proof_intact)
    h.check("03 class-diversity ledger intact", class_div_intact)
    h.check("04 MEMORY ledger artifacts present", ledger_files)
    h.check("05 credential binary; no fabricated MEMORY", credential_and_no_fabricated_memory)
    h.check("06 captured rows RAW REAL_RUNTIME; no auto-train", raw_rows_honest)
    h.check("07 EVAL-3 intact; no input leak", eval3_intact)
    h.check("08 collector does not invoke training", no_training_in_collector)
    h.check("09 production path not written", production_untouched)
    h.check("10 V4/ECHO_INT/LOOKUP_NOTE roles honest; EXP-004 off", v4_and_roles)
    h.check("11 class space recommendation not silent change", class_space_not_silently_changed)
    h.check("12 FILES-vs-MEMORY files side executed; MEMORY not faked", files_boundary_files_side)
    return h.finish()


if __name__ == "__main__":
    raise SystemExit(main())
