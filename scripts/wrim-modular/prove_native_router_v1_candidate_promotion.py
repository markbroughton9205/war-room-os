#!/usr/bin/env python3
"""Validate Native Router V1 CANDIDATE lifecycle promotion. No training. No serving."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR))

from hashes import sha256_file, sha256_json  # noqa: E402
from native_router_v1 import RULE_SPECS, parse_tool_registry_cards, registry_snapshot_hash  # noqa: E402
from paths import (  # noqa: E402
    NATIVE_ROUTER_V1_DIR,
    NATIVE_ROUTER_V1_EXPECTED_BASELINE_HASH,
    NATIVE_ROUTER_V1_EXPECTED_CONFIDENCE_HASH,
    NATIVE_ROUTER_V1_EXPECTED_LEXICAL_HASH,
    NATIVE_ROUTER_V1_EXPECTED_REGISTRY_HASH,
    NATIVE_ROUTER_V1_EXPECTED_ROUTER_SOURCE_HASH,
    NATIVE_ROUTER_V1_EXPECTED_RULE_HASH,
    NATIVE_ROUTER_V1_FRESH_GEN_DIR,
    NATIVE_ROUTER_V1_FROZEN_GEN_DIR,
    NATIVE_ROUTER_V1_PROMOTION_DIR,
    PRODUCTION_ROOT,
    ROOT,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_WEIGHTS,
)

EXPECTED = 36


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

    frozen = NATIVE_ROUTER_V1_FROZEN_GEN_DIR
    work = NATIVE_ROUTER_V1_PROMOTION_DIR
    cand = NATIVE_ROUTER_V1_DIR
    fresh = NATIVE_ROUTER_V1_FRESH_GEN_DIR
    man = json.loads((cand / "manifest.json").read_text())
    life = json.loads((cand / "lifecycle.json").read_text())
    verdict = json.loads((cand / "readiness-verdict.json").read_text())
    base = json.loads((frozen / "baseline-manifest.json").read_text())
    ready = json.loads((fresh / "promotion-review-readiness.json").read_text())
    tax = json.loads((fresh / "failure-taxonomy.json").read_text())
    rules = json.loads((fresh / "rule-performance.json").read_text())
    mt = json.loads((work / "multi-tool-block.json").read_text())
    scope = json.loads((work / "scope-lock.json").read_text())
    wrim_role = json.loads((work / "wrim-role.json").read_text())
    rollback = json.loads((work / "rollback-plan.json").read_text())
    immut = json.loads((work / "immutability-record.json").read_text())
    live_gap = json.loads((work / "live-runtime-gap.json").read_text())
    proof = json.loads((work / "no-serving-change-proof.json").read_text())
    rem = json.loads((work / "remediation-backlog.json").read_text())
    pilot = json.loads((work / "pilot-readiness-design.json").read_text())
    promo = json.loads((work / "promotion-manifest.json").read_text())
    gate_ts = (ROOT / "lib/modular-intelligence/nativeRouterV1Gate.ts").read_text()
    native_ts = (ROOT / "lib/modular-intelligence/nativeRouterV1Shadow.ts").read_text()
    router_ts = (ROOT / "lib/modular-intelligence/toolRouter.ts").read_text()
    py_router = SCRIPT_DIR / "native_router_v1.py"
    lifecycle_py = (SCRIPT_DIR / "native_router_v1_candidate_lifecycle.py").read_text()

    check("1 exact frozen baseline found", lambda: eq((frozen / "baseline-manifest.json").is_file(), "base"))
    check(
        "2 baseline hash exact",
        lambda: eq(base["artifact_hash"] == NATIVE_ROUTER_V1_EXPECTED_BASELINE_HASH == man["artifact_hash"], "bh"),
    )
    check(
        "3 rule hash exact",
        lambda: eq(
            sha256_json(RULE_SPECS) == NATIVE_ROUTER_V1_EXPECTED_RULE_HASH == man["rule_hash"] == base["rule_hash"],
            "rh",
        ),
    )
    check(
        "4 lexical hash exact",
        lambda: eq(
            sha256_file(cand / "lexical-bow.npz")
            == NATIVE_ROUTER_V1_EXPECTED_LEXICAL_HASH
            == man["lexical_hash"]
            == base["lexical_model_hash"],
            "lx",
        ),
    )
    check(
        "5 confidence hash exact",
        lambda: eq(
            sha256_json(json.loads((cand / "confidence-policy.json").read_text()))
            == NATIVE_ROUTER_V1_EXPECTED_CONFIDENCE_HASH
            == man["confidence_policy_hash"],
            "ch",
        ),
    )
    check(
        "6 registry-binding hash exact",
        lambda: eq(
            registry_snapshot_hash(parse_tool_registry_cards())
            == NATIVE_ROUTER_V1_EXPECTED_REGISTRY_HASH
            == man["registry_snapshot_hash"],
            "rg",
        ),
    )
    check(
        "7 router source hash exact",
        lambda: eq(
            sha256_file(py_router)
            == NATIVE_ROUTER_V1_EXPECTED_ROUTER_SOURCE_HASH
            == man["router_source_hash"]
            == sha256_file(frozen / "native_router_v1.py.snapshot"),
            "rs",
        ),
    )
    check(
        "8 fresh-generalization PASS exists",
        lambda: eq(json.loads((fresh / "validator.json").read_text())["pass"] is True, "fg"),
    )
    check(
        "9 promotion-review readiness PASS exists",
        lambda: eq(ready["ready_for_controlled_candidate_promotion_review"] is True and ready["gates"]["all_pass"] is True, "pr"),
    )
    check("10 lifecycle before SHADOW", lambda: eq(promo["previous_lifecycle"] == "SHADOW" == life["previous_status"], "before"))
    check("11 lifecycle after CANDIDATE", lambda: eq(man["lifecycle"] == "CANDIDATE" == life["status"] == verdict["lifecycle"], "after"))
    check(
        "12 candidate not ACTIVE",
        lambda: eq(man["lifecycle"] != "ACTIVE" and life["status"] != "ACTIVE" and man["active_modules"] == [], "act"),
    )
    check(
        "13 candidate not production-serving",
        lambda: eq(
            man["serving_activation"] is False
            and man["production_serving"] is False
            and man["production_activation"] is False
            and verdict["promoted"] is False
            and pilot["activated"] is False,
            "ps",
        ),
    )
    check(
        "14 single-tool scope locked",
        lambda: eq(
            man["scope"] == "SINGLE_TOOL_ROUTING_ONLY"
            and scope["allowed_routes"] == ["NO_TOOL", "WEB", "MEMORY", "FILES", "RESEARCH", "SHA256"],
            "sc",
        ),
    )
    check("15 multi-tool blocked", lambda: eq(mt["status"] == "BLOCKED" and mt["execution_allowed"] is False and man["multi_tool"] == "BLOCKED", "mt"))
    check("16 planner blocked", lambda: eq(mt["planner"] == "BLOCKED" and man["planner"] == "BLOCKED", "pl"))
    check("17 WRIM serving disabled", lambda: eq(wrim_role["wrim_l10_serving"] is False and man["wrim_l10_serving"] is False, "ws"))
    check("18 WRIM telemetry preserved", lambda: eq(wrim_role["wrim_telemetry_support_preserved"] is True and "scoreNativeRouterV1Shadow" in router_ts, "wt"))
    check(
        "19 remediation items not applied",
        lambda: eq(
            tax["applied"] is False
            and rem["applied"] is False
            and rem["applied_count"] == 0
            and tax["n_remediation_candidates"] == 17 == rem["POST_TEST_REMEDIATION_CANDIDATE_count"],
            "rem",
        ),
    )
    check(
        "20 R03 unchanged",
        lambda: eq(
            abs(rules["R03_prior_turn_underspecified"]["precision_when_chosen_first"] - 0.8478260869565217) < 1e-12
            and rem["R03_id"] == "R03_prior_turn_underspecified",
            "r03",
        ),
    )
    check(
        "21 feature flag default OFF",
        lambda: eq("default_off" in gate_ts and man["default_off"] is True and man["feature_flag_default"] == "OFF", "ff"),
    )
    check(
        "22 production flag OFF",
        lambda: eq("NODE_ENV === 'production'" in gate_ts and man["production_always_off"] is True and man["production_feature_flag"] == "OFF", "pff"),
    )
    check(
        "23 existing serving behavior unchanged",
        lambda: eq(
            proof["serving_behavior_unchanged"] is True
            and proof["tool_router_hash"] == proof["tool_router_hash_after"]
            and "alters_routing: false" in native_ts,
            "srv",
        ),
    )
    check(
        "24 existing router remains authoritative",
        lambda: eq("export function routeToolIntent" in router_ts and proof["existing_router_authoritative"] is True, "auth"),
    )
    check(
        "25 active modules unchanged",
        lambda: eq(man["active_modules"] == [] and life["active_modules"] == [], "mods"),
    )
    check(
        "26 rollback defined",
        lambda: eq(
            rollback["defined"] is True
            and rollback["executed_this_mission"] is False
            and "rollback_candidate_to_shadow" in lifecycle_py
            and rollback["path"].endswith("native_router_v1_candidate_lifecycle.py")
            and immut["established"] is True,
            "rb",
        ),
    )
    check("27 evidence linked", lambda: eq((work / "evidence-index.json").is_file() and (work / "generalization-evidence.json").is_file(), "ev"))
    check("28 live-runtime gap documented", lambda: eq(live_gap["REAL_RUNTIME_FRESH"] == 0 and live_gap["documented"] is True, "gap"))
    check(
        "29 production untouched",
        lambda: eq(
            str(PRODUCTION_ROOT) == "/Users/markbroughton/WarRoomNode01"
            and proof["production_path_untouched"] is True
            and not str(work).startswith(str(PRODUCTION_ROOT)),
            "prod",
        ),
    )
    check("30 no WRIM training", lambda: eq(sha256_file(WRIM0_WEIGHTS) == WRIM0_CHECKPOINT_SHA256 == wrim_role["wrim_hash_after"] == wrim_role["wrim_hash_before"], "nw"))
    check("31 no LoRA training", lambda: eq(json.loads((cand / "core-immutability-proof.json").read_text())["lora_training_performed"] is False, "nl"))
    check("32 no EXP006", lambda: eq(json.loads((cand / "core-immutability-proof.json").read_text())["exp006_started"] is False, "e6"))
    check("33 no RED-X-2", lambda: eq(json.loads((fresh / "immutability-proof.json").read_text())["red_x_2_performed"] is False, "rx"))
    check("34 no planner", lambda: eq("class Planner" not in py_router.read_text() and mt["planner"] == "BLOCKED", "np"))
    git = subprocess.run(["git", "status", "-sb"], cwd=ROOT, capture_output=True, text=True, check=False)
    head_now = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=False)
    recorded = json.loads((work / "git-head.json").read_text())
    promote_src = (SCRIPT_DIR / "promote_native_router_v1_candidate.py").read_text()
    check(
        "35 no commit",
        lambda: eq(
            head_now.stdout.strip() == recorded["head"]
            and recorded["commit_this_mission"] is False
            and "git commit" not in promote_src,
            "commit",
        ),
    )
    check(
        "36 no push",
        lambda: eq(
            recorded["push_this_mission"] is False
            and git.returncode == 0
            and "git push" not in promote_src
            and "git push" not in lifecycle_py
            and "git commit" not in lifecycle_py,
            "push",
        ),
    )

    payload = {
        "results": results,
        "pass": all(r["ok"] for r in results) and len(results) == EXPECTED,
        "n": len(results),
        "expected": EXPECTED,
        "git_status_short": git.stdout.split("\n")[0],
        "git_dirty_path_count": max(0, len([ln for ln in git.stdout.splitlines() if ln.strip()]) - 1),
        "head": head_now.stdout.strip(),
        "lifecycle": man["lifecycle"],
        "serving_activation": man["serving_activation"],
        "proof_result": proof["result"],
        "n_rules": len(RULE_SPECS),
    }
    write = work / "validation-results.json"
    write.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    failed = [r for r in results if not r["ok"]]
    print(f"TOTAL={len(results)} EXPECTED={EXPECTED} PASS={len(results)-len(failed)} FAIL={len(failed)}")
    return 0 if not failed and len(results) == EXPECTED else 1


if __name__ == "__main__":
    raise SystemExit(main())
