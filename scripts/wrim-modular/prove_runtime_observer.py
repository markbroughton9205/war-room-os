#!/usr/bin/env python3
"""WR-TOOL REAL-RUNTIME OBSERVER — WRIM-0 / production isolation proofs. No training."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from paths import PRODUCTION_ROOT, ROOT, WRIM0_CHECKPOINT_SHA256, WRIM0_WEIGHTS  # noqa: E402

EXPECTED = 6


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
            f"Runtime observer Python proofs: TOTAL={len(self.results)} EXPECTED={self.expected} "
            f"PASS={passed} FAIL={len(failed)}"
        )
        out = ROOT / "model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-OBSERVER-DEV-V1"
        out.mkdir(parents=True, exist_ok=True)
        (out / "python-proof.json").write_text(
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
            raise AssertionError(f"WRIM-0 hash changed {got}")

    def capture_src_no_train() -> None:
        src = (ROOT / "lib/modular-intelligence/runtimeTrajectoryCapture.ts").read_text(encoding="utf-8")
        if "from '@/lib/wrim1-training" in src or 'from "@/lib/wrim1-training' in src:
            raise AssertionError("imports wrim1-training")
        if "safetensors" in src:
            raise AssertionError("writes weights")

    def production_path_untouched_in_src() -> None:
        src = (ROOT / "lib/modular-intelligence/runtimeTrajectoryCapture.ts").read_text(encoding="utf-8")
        if "WarRoomNode01" in src:
            raise AssertionError("production path referenced")

    def pool_v1_not_overwritten_identity() -> None:
        man = ROOT / "model-lab/manifests/wr_tool_trajectories/WR-TOOL-REAL-TRAJECTORY-POOL-V1/MANIFEST.json"
        data = json.loads(man.read_text(encoding="utf-8"))
        if data.get("identity") not in (None, "WR-TOOL-REAL-TRAJECTORY-POOL-V1") and "WR-TOOL-REAL-TRAJECTORY-POOL-V1" not in json.dumps(
            data
        ):
            raise AssertionError("pool v1 identity missing")

    def production_root_not_this_repo() -> None:
        if PRODUCTION_ROOT.resolve() == ROOT.resolve():
            raise AssertionError("production root equals development repo")

    def no_exp004_train_dir() -> None:
        trained = ROOT / "model-lab/manifests/modular-intelligence/WR-TOOL-PI-EXP-004"
        if trained.exists() and any(trained.rglob("*.safetensors")):
            raise AssertionError("EXP-004 weights present")

    h.check("1 WRIM-0 checkpoint SHA unchanged", wrim0_hash)
    h.check("2 capture module does not train", capture_src_no_train)
    h.check("3 capture module does not name production path", production_path_untouched_in_src)
    h.check("4 pool V1 manifest still present", pool_v1_not_overwritten_identity)
    h.check("5 production root is not the development repo", production_root_not_this_repo)
    h.check("6 Experiment 004 weights absent", no_exp004_train_dir)
    return h.finish()


if __name__ == "__main__":
    raise SystemExit(main())
