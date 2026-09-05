#!/usr/bin/env python3
"""Deterministic validation for WR-TOOL-RED-X-FORENSICS-001. Does not train WRIM."""
from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR))

from paths import (  # noqa: E402
    EXPECTED_CORE_TREE_SHA256,
    PRODUCTION_ROOT,
    REDX_DIR,
    TOKENIZER_SHA256,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_ID,
)
from frozen_core import load_frozen_wrim0  # noqa: E402
from hashes import sha256_file  # noqa: E402
from paths import TOKENIZER_JSON, WRIM0_WEIGHTS  # noqa: E402


REQUIRED = [
    "manifest.json",
    "layer-matrix.json",
    "pooling-matrix.json",
    "geometry-report.json",
    "anisotropy-report.json",
    "probe-matrix.json",
    "hierarchical-ablation.json",
    "registry-routing-ablation.json",
    "hard-boundary-results.json",
    "abstention-analysis.json",
    "wrim-limit-assessment.json",
    "eval6-design.json",
    "core-immutability-proof.json",
    "final-diagnosis.json",
]


def main() -> int:
    results = []

    def check(name: str, fn):
        try:
            fn()
            results.append({"name": name, "ok": True})
            print(f"PASS {name}")
        except Exception as exc:  # noqa: BLE001
            results.append({"name": name, "ok": False, "detail": str(exc)})
            print(f"FAIL {name}: {exc}")

    work = REDX_DIR

    def artifacts_exist():
        missing = [n for n in REQUIRED if not (work / n).is_file()]
        if missing:
            raise AssertionError(f"missing {missing}")

    def no_training():
        man = json.loads((work / "manifest.json").read_text())
        proof = json.loads((work / "core-immutability-proof.json").read_text())
        if man.get("replaces") != "EXP006":
            raise AssertionError("must replace EXP006")
        if man.get("no_wrim_training") is not True:
            raise AssertionError("WRIM training flag")
        if man.get("no_lora_training") is not True:
            raise AssertionError("LoRA training flag")
        if proof.get("wrim_training_performed") or proof.get("lora_training_performed"):
            raise AssertionError("training performed")
        if proof.get("max_abs_diff") != 0:
            raise AssertionError(f"max_abs_diff={proof.get('max_abs_diff')}")
        if proof.get("core_tree_sha_before") != proof.get("core_tree_sha_after"):
            raise AssertionError("core tree changed")
        if proof.get("core_tree_sha_after") != EXPECTED_CORE_TREE_SHA256:
            raise AssertionError("core tree SHA mismatch")
        if proof.get("active_modules") != []:
            raise AssertionError("active modules must be empty")
        if proof.get("active_core") != WRIM0_ID:
            raise AssertionError("active core")

    def datasets_frozen():
        man = json.loads((work / "manifest.json").read_text())
        if man["datasets"]["train"]["hash"] != "f9e1ae99e46fa1bf767f95c246f5aa0ee55a5153e671374859bc30eeb9ffad33":
            raise AssertionError("V5 train hash")
        if man["datasets"]["train"]["n"] != 156:
            raise AssertionError("train n")
        if man["datasets"]["eval5"]["n_val"] != 48 or man["datasets"]["eval5"]["n_test"] != 48:
            raise AssertionError("eval5 sizes")
        if not man["datasets"]["eval4_preserved"]:
            raise AssertionError("EVAL-4 not preserved")

    def test_once():
        probe = json.loads((work / "probe-matrix.json").read_text())
        if probe["selected"]["selection_split"] != "validation":
            raise AssertionError("selection must use validation")
        if not probe["selected"]["test_untouched_until_now"]:
            raise AssertionError("test policy")
        if "test_selected_once" not in probe:
            raise AssertionError("missing single test eval")

    def eval6_design_only():
        e6 = json.loads((work / "eval6-design.json").read_text())
        if e6.get("status") != "DESIGN_ONLY":
            raise AssertionError("EVAL-6 must be design only")
        if e6.get("do_not_materialize_training_dataset") is not True:
            raise AssertionError("must not materialize training")

    def registry_not_mutated():
        reg = json.loads((work / "registry-routing-ablation.json").read_text())
        if reg.get("authoritative_registry_mutated") is True:
            raise AssertionError("registry mutated")

    def live_core_still_wrim0():
        core = load_frozen_wrim0()
        if sha256_file(WRIM0_WEIGHTS) != WRIM0_CHECKPOINT_SHA256:
            raise AssertionError("file sha")
        if sha256_file(TOKENIZER_JSON) != TOKENIZER_SHA256:
            raise AssertionError("tok sha")
        if core.weight_tree_hash() != EXPECTED_CORE_TREE_SHA256:
            raise AssertionError("live tree")
        if core.core_trainable_parameters() != 0:
            raise AssertionError("trainable")
        if PRODUCTION_ROOT.exists() is False:
            pass  # allowed if missing; must not have been required

    def docs_exist():
        doc = SCRIPT_DIR.parents[1] / "docs" / "WR_TOOL_RED_X_NATIVE_ROUTING_FORENSICS.md"
        if not doc.is_file():
            raise AssertionError("missing forensics doc")

    check("1 required artifacts exist", artifacts_exist)
    check("2 no WRIM/LoRA training and core immutable", no_training)
    check("3 frozen V5/EVAL-5/EVAL-4 bindings", datasets_frozen)
    check("4 test evaluated once after validation selection", test_once)
    check("5 EVAL-6 design only", eval6_design_only)
    check("6 authoritative registry not mutated", registry_not_mutated)
    check("7 live WRIM-0 still exact", live_core_still_wrim0)
    check("8 forensics doc exists", docs_exist)

    n_pass = sum(1 for r in results if r["ok"])
    payload = {
        "n_pass": n_pass,
        "n_total": len(results),
        "verdict": "PASS" if n_pass == len(results) else "FAIL",
        "results": results,
    }
    (work / "validator.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"verdict": payload["verdict"], "n_pass": n_pass, "n_total": len(results)}))
    return 0 if payload["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
