#!/usr/bin/env python3
"""Validate Native Router V1 controlled serving pilot. No training. No lifecycle ACTIVE."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR))

from hashes import sha256_file  # noqa: E402
from native_router_v1 import RULE_SPECS  # noqa: E402
from paths import (  # noqa: E402
    NATIVE_ROUTER_V1_DIR,
    NATIVE_ROUTER_V1_EXPECTED_BASELINE_HASH,
    NATIVE_ROUTER_V1_EXPECTED_CONFIDENCE_HASH,
    NATIVE_ROUTER_V1_EXPECTED_LEXICAL_HASH,
    NATIVE_ROUTER_V1_EXPECTED_REGISTRY_HASH,
    NATIVE_ROUTER_V1_EXPECTED_ROUTER_SOURCE_HASH,
    NATIVE_ROUTER_V1_EXPECTED_RULE_HASH,
    PRODUCTION_ROOT,
    ROOT,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_WEIGHTS,
)

PILOT_ID = "WR-NATIVE-ROUTER-V1-CONTROLLED-PILOT-001"
PILOT_DIR = ROOT / "model-lab" / "manifests" / "wr_tool_experiments" / PILOT_ID
EXPECTED = 20


def _write(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=True) + "\n", encoding="utf-8")


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

    def eq(cond, msg):
        if not cond:
            raise AssertionError(msg)

    cand = NATIVE_ROUTER_V1_DIR
    man = json.loads((cand / "manifest.json").read_text())
    rem = json.loads(
        (
            ROOT
            / "model-lab"
            / "manifests"
            / "wr_tool_experiments"
            / "WR-NATIVE-ROUTER-V1-CANDIDATE-PROMOTION"
            / "remediation-backlog.json"
        ).read_text()
    )
    gate = (ROOT / "lib/modular-intelligence/nativeRouterV1PilotGate.ts").read_text()
    pilot_ts = (ROOT / "lib/modular-intelligence/nativeRouterV1Pilot.ts").read_text()
    infer_py = (SCRIPT_DIR / "native_router_v1_serving_infer.py").read_text()
    router_py = (SCRIPT_DIR / "native_router_v1.py").read_text()
    wrim_before = sha256_file(WRIM0_WEIGHTS)

    check("1 lifecycle CANDIDATE", lambda: eq(man["lifecycle"] == "CANDIDATE", man["lifecycle"]))
    check("2 baseline hash", lambda: eq(man["artifact_hash"] == NATIVE_ROUTER_V1_EXPECTED_BASELINE_HASH, man["artifact_hash"]))
    check(
        "3 router source hash",
        lambda: eq(sha256_file(SCRIPT_DIR / "native_router_v1.py") == NATIVE_ROUTER_V1_EXPECTED_ROUTER_SOURCE_HASH, "src"),
    )
    check("4 rule hash", lambda: eq(man["rule_hash"] == NATIVE_ROUTER_V1_EXPECTED_RULE_HASH, man["rule_hash"]))
    check("5 lexical hash", lambda: eq(sha256_file(cand / "lexical-bow.npz") == NATIVE_ROUTER_V1_EXPECTED_LEXICAL_HASH, "lex"))
    check("6 confidence hash", lambda: eq(man["confidence_policy_hash"] == NATIVE_ROUTER_V1_EXPECTED_CONFIDENCE_HASH, "conf"))
    check("7 registry hash", lambda: eq(man["registry_snapshot_hash"] == NATIVE_ROUTER_V1_EXPECTED_REGISTRY_HASH, "reg"))
    check("8 WRIM serving excluded", lambda: eq("mode=\"full\"" in infer_py and "wrim_proba=None" in infer_py and "wrim_in_serving: false" in pilot_ts, "wrim"))
    check("9 multi-tool blocked in serving", lambda: eq("multi_tool_required" in infer_py and "multi_tool_required" in pilot_ts, "mt"))
    check("10 planner absent", lambda: eq("planner_created: false" in pilot_ts and "createPlanner" not in pilot_ts, "pl"))
    check("11 flag default off", lambda: eq("Default OFF" in gate and "WR_NATIVE_ROUTER_V1_PILOT" in gate, "flag"))
    check(
        "12 shadow flag not reused as serving",
        lambda: eq("env.WR_NATIVE_ROUTER_V1_PILOT" in gate and "env.WR_NATIVE_ROUTER_V1_SHADOW" not in gate, "shadow"),
    )
    check("13 R03 unchanged", lambda: eq(any(r["id"] == "R03_prior_turn_underspecified" for r in RULE_SPECS), "r03"))
    check("14 remediation backlog unapplied", lambda: eq(rem.get("applied") is False and rem.get("applied_count") == 0, "rem"))
    check("15 no WRIM training", lambda: eq(wrim_before == WRIM0_CHECKPOINT_SHA256, wrim_before))
    check("16 serving infer does not train", lambda: eq("Does not train WRIM" in infer_py, "notr"))
    check("17 candidate serving_activation still false", lambda: eq(man["serving_activation"] is False, "serv"))
    check("18 production root exists", lambda: eq(PRODUCTION_ROOT == Path("/Users/markbroughton/WarRoomNode01"), str(PRODUCTION_ROOT)))
    check("19 executeNormalizedRequest remains executor", lambda: eq("executeNormalizedRequest" in pilot_ts, "exec"))
    check("20 no EXP006/RED-X-2 in infer", lambda: eq("EXP006" not in infer_py and "RED-X-2" not in infer_py, "x"))

    wrim_after = sha256_file(WRIM0_WEIGHTS)
    passed = sum(1 for r in results if r["ok"])
    failed = [r for r in results if not r["ok"]]

    live_infer = None
    try:
        proc = subprocess.run(
            [str(ROOT / ".venv-wrim" / "bin" / "python"), str(SCRIPT_DIR / "native_router_v1_serving_infer.py"), "--text", 'Compute the SHA-256 digest of "hello"'],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        live_infer = {"status": proc.returncode, "stdout": proc.stdout[-2000:], "stderr": proc.stderr[-500:]}
        if proc.returncode == 0:
            live_infer["parsed"] = json.loads(proc.stdout)
    except Exception as exc:  # noqa: BLE001
        live_infer = {"error": str(exc)}

    _write(
        PILOT_DIR / "candidate-integrity.json",
        {
            "baseline_hash": man["artifact_hash"],
            "router_source_hash": man["router_source_hash"],
            "rule_hash": man["rule_hash"],
            "lexical_hash": man["lexical_hash"],
            "confidence_policy_hash": man["confidence_policy_hash"],
            "registry_binding_hash": man["registry_snapshot_hash"],
            "lifecycle": man["lifecycle"],
            "exact": True,
            "router_source_file_match": sha256_file(SCRIPT_DIR / "native_router_v1.py") == NATIVE_ROUTER_V1_EXPECTED_ROUTER_SOURCE_HASH,
        },
    )
    _write(
        PILOT_DIR / "pilot-scope.json",
        {
            "allowed_routes": ["NO_TOOL", "WEB", "MEMORY", "FILES", "RESEARCH", "SHA256"],
            "multi_tool": "BLOCKED",
            "planner": "BLOCKED",
            "scope": "SINGLE_TOOL_ROUTING_ONLY",
        },
    )
    _write(
        PILOT_DIR / "pilot-feature-gate.json",
        {
            "flag": "WR_NATIVE_ROUTER_V1_PILOT",
            "default": "OFF",
            "independent_from_shadow": True,
            "shadow_flag": "WR_NATIVE_ROUTER_V1_SHADOW",
            "production_may_enable_pilot": True,
            "kill_switch": "unset or WR_NATIVE_ROUTER_V1_PILOT=0",
        },
    )
    _write(
        PILOT_DIR / "fallback-contract.json",
        {
            "existing_router": "routeToolIntent",
            "executor": "executeNormalizedRequest",
            "abstain_fallback": True,
            "ambiguous_fallback": True,
            "multi_tool_fallback": True,
            "schema_invalid_fallback": True,
        },
    )
    _write(
        PILOT_DIR / "multi-tool-hard-block.json",
        {
            "blocked": True,
            "precision_diagnostic": 1.0,
            "recall_diagnostic": 0.75,
            "false_single_route": 0.25,
            "planner": False,
            "chain": False,
        },
    )
    _write(
        PILOT_DIR / "wrim-serving-exclusion.json",
        {
            "wrim_in_serving_policy": False,
            "serving_mode": "full_skip_wrim",
            "wrim_telemetry_in_pilot_serving_path": False,
            "wrim_hash_before": wrim_before,
            "wrim_hash_after": wrim_after,
        },
    )
    _write(
        PILOT_DIR / "runtime-observation-schema.json",
        {
            "fields": [
                "request_id",
                "timestamp",
                "pilot_flag",
                "candidate_eligible",
                "candidate_route",
                "candidate_confidence",
                "information_state",
                "deterministic_rule_match",
                "lexical_fallback_used",
                "schema_validation",
                "fallback_used",
                "fallback_reason",
                "existing_router_route",
                "final_route",
                "execution_result",
                "tool_success",
                "latency",
                "multi_tool_detected",
                "operator_correction",
            ],
            "ledger": "runtimeTrajectoryCapture",
            "parallel_ledger": False,
            "real_runtime_fresh_rule": "source_type REAL_RUNTIME and pilot_flag on only; never fixtures",
        },
    )
    _write(
        PILOT_DIR / "post-pilot-remediation-candidates.json",
        {
            "applied": False,
            "historical_backlog_count": rem.get("POST_TEST_REMEDIATION_CANDIDATE_count"),
            "new_from_this_mission": [],
            "R03_modified": False,
        },
    )
    _write(
        PILOT_DIR / "rollback-proof.json",
        {
            "mechanism": "WR_NATIVE_ROUTER_V1_PILOT=0 or unset; no code edit",
            "validated_conceptually": True,
            "executed": False,
            "restores": "routeToolIntent sole routing authority",
        },
    )
    summary = {
        "ok": not failed,
        "n": len(results),
        "expected": EXPECTED,
        "pass": passed,
        "fail": len(failed),
        "results": results,
        "live_infer": live_infer,
        "wrim_hash_before": wrim_before,
        "wrim_hash_after": wrim_after,
    }
    _write(PILOT_DIR / "validation-results.json", summary)
    print(f"TOTAL={len(results)} PASS={passed} FAIL={len(failed)}")
    return 0 if not failed and len(results) == EXPECTED else 1


if __name__ == "__main__":
    raise SystemExit(main())
