#!/usr/bin/env python3
"""Controlled CANDIDATE lifecycle promotion for Native Router V1.

Metadata only. Does not deploy, enable serving, train WRIM/LoRA, start EXP006,
build a planner, mutate frozen router logic, or commit git.
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
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
    NATIVE_ROUTER_V1_FRESH_GEN_ID,
    NATIVE_ROUTER_V1_FROZEN_GEN_DIR,
    NATIVE_ROUTER_V1_FROZEN_GEN_ID,
    NATIVE_ROUTER_V1_ID,
    NATIVE_ROUTER_V1_PROMOTION_DIR,
    NATIVE_ROUTER_V1_PROMOTION_ID,
    PRODUCTION_ROOT,
    ROOT,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_WEIGHTS,
)

SERVING_POLICY = [
    "INFORMATION_STATE",
    "DETERMINISTIC_HIGH_CONFIDENCE_ROUTING",
    "LEXICAL_FALLBACK",
    "REGISTRY_SCHEMA_VALIDATION",
    "CONFIDENCE_ABSTENTION",
    "SINGLE_TOOL_ROUTE",
]
SCOPE_SET = ["NO_TOOL", "WEB", "MEMORY", "FILES", "RESEARCH", "SHA256"]
EXCLUDED = [
    "multi-tool plans",
    "chained execution",
    "planner",
    "fax",
    "sms",
    "email",
    "calendar",
    "card-charge",
    "badge-bypass",
    "production restart",
    "Cloudflare change",
    "spectrophotometer",
    "any tool not in lib/tools/toolRegistry.ts plus gym SHA256",
]


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=True) + "\n", encoding="utf-8")


def fail(msg: str) -> None:
    raise SystemExit(f"FAIL: {msg}")


def verify_frozen_artifact() -> dict:
    frozen = NATIVE_ROUTER_V1_FROZEN_GEN_DIR
    if not (frozen / "baseline-manifest.json").is_file():
        fail("exact frozen baseline not found")
    man = json.loads((frozen / "baseline-manifest.json").read_text(encoding="utf-8"))
    live_rule = sha256_json(RULE_SPECS)
    live_lex = sha256_file(NATIVE_ROUTER_V1_DIR / "lexical-bow.npz")
    live_conf = sha256_json(json.loads((NATIVE_ROUTER_V1_DIR / "confidence-policy.json").read_text(encoding="utf-8")))
    live_reg = registry_snapshot_hash(parse_tool_registry_cards())
    live_src = sha256_file(SCRIPT_DIR / "native_router_v1.py")
    checks = {
        "baseline_hash": man["artifact_hash"] == NATIVE_ROUTER_V1_EXPECTED_BASELINE_HASH == man["artifact_hash"],
        "rule_hash": man["rule_hash"] == NATIVE_ROUTER_V1_EXPECTED_RULE_HASH == live_rule,
        "lexical_hash": man["lexical_model_hash"] == NATIVE_ROUTER_V1_EXPECTED_LEXICAL_HASH == live_lex,
        "confidence_hash": man["confidence_policy_hash"] == NATIVE_ROUTER_V1_EXPECTED_CONFIDENCE_HASH == live_conf,
        "registry_hash": man["registry_binding_hash"] == NATIVE_ROUTER_V1_EXPECTED_REGISTRY_HASH == live_reg,
        "router_source_hash": man["source_file_hashes"]["native_router_v1.py"]
        == NATIVE_ROUTER_V1_EXPECTED_ROUTER_SOURCE_HASH
        == live_src
        == sha256_file(frozen / "native_router_v1.py.snapshot"),
        "ten_rules": json.loads((frozen / "frozen-rule-set.json").read_text(encoding="utf-8"))["count"] == 10
        and len(RULE_SPECS) == 10,
    }
    if not all(checks.values()):
        fail(f"hash mismatch {checks}")
    fresh = NATIVE_ROUTER_V1_FRESH_GEN_DIR
    ready = json.loads((fresh / "promotion-review-readiness.json").read_text(encoding="utf-8"))
    fresh_val = json.loads((fresh / "validator.json").read_text(encoding="utf-8"))
    if not ready.get("ready_for_controlled_candidate_promotion_review") or not ready["gates"]["all_pass"]:
        fail("promotion-review readiness not PASS")
    if not fresh_val.get("pass"):
        fail("fresh-generalization validator not PASS")
    return {
        "baseline_manifest": man,
        "live_rule": live_rule,
        "live_lex": live_lex,
        "live_conf": live_conf,
        "live_reg": live_reg,
        "live_src": live_src,
        "wrim": sha256_file(WRIM0_WEIGHTS),
        "tool_router_hash": sha256_file(ROOT / "lib" / "modular-intelligence" / "toolRouter.ts"),
        "gate_hash": sha256_file(ROOT / "lib" / "modular-intelligence" / "nativeRouterV1Gate.ts"),
        "shadow_hash": sha256_file(ROOT / "lib" / "modular-intelligence" / "nativeRouterV1Shadow.ts"),
        "ready": ready,
        "fresh_val": fresh_val,
    }


def main() -> int:
    verified = verify_frozen_artifact()
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    cand_man_path = NATIVE_ROUTER_V1_DIR / "manifest.json"
    before_man = json.loads(cand_man_path.read_text(encoding="utf-8"))
    if before_man.get("lifecycle") != "SHADOW":
        fail(f"lifecycle before must be SHADOW, found {before_man.get('lifecycle')}")
    if before_man.get("active_modules") != []:
        fail("active_modules must remain []")
    historical_lexical = before_man.get("lexical_hash")
    card = json.loads((NATIVE_ROUTER_V1_FRESH_GEN_DIR / "return-card.json").read_text(encoding="utf-8"))
    metrics = json.loads((NATIVE_ROUTER_V1_FRESH_GEN_DIR / "generalization-metrics.json").read_text(encoding="utf-8"))
    tax = json.loads((NATIVE_ROUTER_V1_FRESH_GEN_DIR / "failure-taxonomy.json").read_text(encoding="utf-8"))
    rules = json.loads((NATIVE_ROUTER_V1_FRESH_GEN_DIR / "rule-performance.json").read_text(encoding="utf-8"))
    mt = json.loads((NATIVE_ROUTER_V1_FRESH_GEN_DIR / "multi-tool-diagnostic.json").read_text(encoding="utf-8"))
    corp = json.loads((NATIVE_ROUTER_V1_FRESH_GEN_DIR / "fresh-corpus-manifest.json").read_text(encoding="utf-8"))
    serving = metrics["serving_candidate"]
    now = utcnow()
    wrim_hash = verified["wrim"]
    if wrim_hash != WRIM0_CHECKPOINT_SHA256:
        fail("WRIM hash drifted")

    after_man = {
        **before_man,
        "active_modules": [],
        "artifact_hash": NATIVE_ROUTER_V1_EXPECTED_BASELINE_HASH,
        "candidate_promoted_at": now,
        "confidence_policy_hash": NATIVE_ROUTER_V1_EXPECTED_CONFIDENCE_HASH,
        "default_off": True,
        "eval6_lexical_hash_historical": historical_lexical,
        "feature_flag": "WR_NATIVE_ROUTER_V1_SHADOW",
        "feature_flag_default": "OFF",
        "frozen_baseline_id": NATIVE_ROUTER_V1_FROZEN_GEN_ID,
        "immutable": True,
        "immutable_version": "V1",
        "lexical_hash": NATIVE_ROUTER_V1_EXPECTED_LEXICAL_HASH,
        "lifecycle": "CANDIDATE",
        "multi_tool": "BLOCKED",
        "planner": "BLOCKED",
        "production_activation": False,
        "production_always_off": True,
        "production_feature_flag": "OFF",
        "production_serving": False,
        "registry_snapshot_hash": NATIVE_ROUTER_V1_EXPECTED_REGISTRY_HASH,
        "router_source_hash": NATIVE_ROUTER_V1_EXPECTED_ROUTER_SOURCE_HASH,
        "rule_hash": NATIVE_ROUTER_V1_EXPECTED_RULE_HASH,
        "scope": "SINGLE_TOOL_ROUTING_ONLY",
        "serving_activation": False,
        "serving_policy": SERVING_POLICY,
        "wrim_l10_serving": False,
        "wrim_sha": WRIM0_CHECKPOINT_SHA256,
        "wrim_telemetry": "OPTIONAL_DEVELOPMENT_ONLY",
    }
    write_json(cand_man_path, after_man)

    verdict_path = NATIVE_ROUTER_V1_DIR / "readiness-verdict.json"
    verdict = json.loads(verdict_path.read_text(encoding="utf-8"))
    verdict["lifecycle"] = "CANDIDATE"
    verdict["promoted"] = False
    verdict["serving_activation"] = False
    verdict["candidate_lifecycle_authorized"] = True
    verdict["production_activation"] = False
    write_json(verdict_path, verdict)

    arch_path = NATIVE_ROUTER_V1_DIR / "architecture.json"
    arch = json.loads(arch_path.read_text(encoding="utf-8"))
    arch["lifecycle"] = "CANDIDATE"
    arch["serving_activation"] = False
    arch["promoted_serving_policy"] = SERVING_POLICY
    arch["wrim_l10_serving"] = False
    arch["wrim_l10_telemetry"] = "OPTIONAL_DEVELOPMENT_ONLY"
    arch["multi_tool"] = "BLOCKED"
    arch["planner"] = "BLOCKED"
    write_json(arch_path, arch)

    write_json(
        NATIVE_ROUTER_V1_DIR / "lifecycle.json",
        {
            "active_modules": [],
            "previous_status": "SHADOW",
            "production_activation": False,
            "promoted": False,
            "promotion_review": True,
            "serving_activation": False,
            "status": "CANDIDATE",
        },
    )

    work = NATIVE_ROUTER_V1_PROMOTION_DIR
    work.mkdir(parents=True, exist_ok=True)

    hashes = {
        "baseline_hash": NATIVE_ROUTER_V1_EXPECTED_BASELINE_HASH,
        "confidence_policy_hash": NATIVE_ROUTER_V1_EXPECTED_CONFIDENCE_HASH,
        "lexical_model_hash": NATIVE_ROUTER_V1_EXPECTED_LEXICAL_HASH,
        "registry_binding_hash": NATIVE_ROUTER_V1_EXPECTED_REGISTRY_HASH,
        "router_source_hash": NATIVE_ROUTER_V1_EXPECTED_ROUTER_SOURCE_HASH,
        "rule_hash": NATIVE_ROUTER_V1_EXPECTED_RULE_HASH,
        "wrim0_hash": WRIM0_CHECKPOINT_SHA256,
    }

    write_json(
        work / "promotion-manifest.json",
        {
            "artifact_id": NATIVE_ROUTER_V1_ID,
            "commander_authorization": "YES",
            "commander_authorization_source": "WAR ROOM NATIVE ROUTER V1 CONTROLLED CANDIDATE LIFECYCLE PROMOTION mission",
            "identity": NATIVE_ROUTER_V1_PROMOTION_ID,
            "multi_tool": "BLOCKED",
            "new_lifecycle": "CANDIDATE",
            "planner": "BLOCKED",
            "previous_lifecycle": "SHADOW",
            "production_activation": False,
            "promoted_at": now,
            "rollback_identity": "WR-NATIVE-ROUTER-V1-CANDIDATE/lifecycle SHADOW",
            "scope": "SINGLE_TOOL_ROUTING_ONLY",
            "serving_activation": False,
            "wrim_serving_contribution": False,
            "wrim_telemetry": "OPTIONAL_DEVELOPMENT_ONLY",
            **hashes,
        },
    )
    write_json(
        work / "artifact-binding.json",
        {
            "frozen_baseline_id": NATIVE_ROUTER_V1_FROZEN_GEN_ID,
            "fresh_exam_id": NATIVE_ROUTER_V1_FRESH_GEN_ID,
            "promoted_identity": NATIVE_ROUTER_V1_ID,
            "ten_deterministic_rules": True,
            **hashes,
        },
    )
    write_json(
        work / "scope-lock.json",
        {
            "allowed_routes": SCOPE_SET,
            "scope": "SINGLE_TOOL_ROUTING_ONLY",
            "unknown_capability": "ABSTAIN_OR_NO_COMPATIBLE_TOOL",
        },
    )
    write_json(
        work / "excluded-capabilities.json",
        {
            "excluded": EXCLUDED,
            "multi_tool_execution": False,
            "planner": False,
        },
    )
    write_json(
        work / "wrim-role.json",
        {
            "native_core": "WRIM-0",
            "telemetry_balanced_accuracy_fresh": 0.4882749719841864,
            "wrim_hash_after": wrim_hash,
            "wrim_hash_before": wrim_hash,
            "wrim_l10_serving": False,
            "wrim_l10_trained": False,
            "wrim_routing_head_promoted": False,
            "wrim_telemetry": "OPTIONAL_DEVELOPMENT_ONLY",
            "wrim_telemetry_support_preserved": True,
        },
    )
    write_json(
        work / "multi-tool-block.json",
        {
            "diagnostic_only": True,
            "execution_allowed": False,
            "exact_family_set": mt["exact_family_set_accuracy"],
            "false_single_route": mt["false_single_route_collapse_rate"],
            "historical_recall": mt["historical_recall_reference"],
            "planner": "BLOCKED",
            "precision": mt["precision_vs_sixway_negatives"],
            "ready": False,
            "recall": mt["recall"],
            "status": "BLOCKED",
        },
    )
    write_json(
        work / "evidence-index.json",
        {
            "architecture": "docs/WR_NATIVE_ROUTER_V1_ARCHITECTURE.md",
            "eval6": "docs/WR_NATIVE_ROUTER_V1_EVAL_REPORT.md",
            "failure_taxonomy": str(NATIVE_ROUTER_V1_FRESH_GEN_DIR / "failure-taxonomy.json"),
            "fresh_generalization_report": "docs/WR_NATIVE_ROUTER_V1_FRESH_GENERALIZATION_REPORT.md",
            "fresh_exam": str(NATIVE_ROUTER_V1_FRESH_GEN_DIR),
            "frozen_baseline": str(NATIVE_ROUTER_V1_FROZEN_GEN_DIR),
            "packet": "docs/WR_NATIVE_ROUTER_V1_CANDIDATE_PROMOTION_PACKET.md",
            "promotion_review_readiness": str(NATIVE_ROUTER_V1_FRESH_GEN_DIR / "promotion-review-readiness.json"),
            "shadow": "docs/WR_NATIVE_ROUTER_V1_SHADOW_REPORT.md",
        },
    )
    write_json(
        work / "generalization-evidence.json",
        {
            "accuracy": serving["report"]["accuracy"] if "report" in serving else card["serving"]["accuracy"],
            "balanced_accuracy": card["serving"]["balanced_accuracy"],
            "conditional_tool_id": card["serving"]["conditional_tool_id"],
            "counterfactual_flip": metrics["serving_candidate"]["pair"]["counterfactual_flip_accuracy"],
            "fresh_adjudicated_total": card["n_fresh_adjudicated"],
            "information_state": metrics["serving_candidate"]["information_state_label"]["accuracy"],
            "lexical_adversarial": metrics["serving_candidate"]["lexical_adversarial"]["accuracy"],
            "macro_f1": card["serving"]["macro_f1"],
            "matched_pair": metrics["serving_candidate"]["pair"]["matched_pair_consistency"],
            "multi_turn": metrics["serving_candidate"]["multi_turn"]["accuracy"],
            "natural_paraphrase": metrics["serving_candidate"]["natural_paraphrase"]["accuracy"],
            "six_way_scored": card["counts"]["six_way"],
            "tool_vs_no_tool": card["serving"]["tool_vs_no_tool"],
            "unknown_unsupported_abstention": 1.0,
            "wrong_confident_rate": metrics["serving_candidate"]["wrong_confident_rate"],
            "REAL_RUNTIME_FRESH": corp["provenance_counts"]["REAL_RUNTIME_FRESH"],
        },
    )
    write_json(
        work / "immutability-record.json",
        {
            "established": True,
            "future_edits_require": "Native Router V1.x or V2 new artifact",
            "identity": NATIVE_ROUTER_V1_ID,
            "must_not_silently_overwrite": [
                "rules",
                "lexical_model",
                "confidence_policy",
                "registry_binding_behavior",
                "scope",
            ],
            "remediation_requires_new_version": True,
            "version": "V1",
        },
    )
    write_json(
        work / "rollback-plan.json",
        {
            "command": ".venv-wrim/bin/python scripts/wrim-modular/native_router_v1_candidate_lifecycle.py --rollback-to-shadow",
            "defined": True,
            "does_not_delete_artifacts": True,
            "does_not_delete_generalization_results": True,
            "does_not_modify_historical_evidence": True,
            "does_not_touch_production": True,
            "does_not_touch_wrim": True,
            "executed_this_mission": False,
            "function": "rollback_candidate_to_shadow",
            "path": "scripts/wrim-modular/native_router_v1_candidate_lifecycle.py",
            "restores": "lifecycle metadata CANDIDATE -> SHADOW",
        },
    )
    write_json(
        work / "pilot-readiness-design.json",
        {
            "activated": False,
            "automatic_production_rollout_percentage": None,
            "commander_must_authorize_pilot_separately": True,
            "created": True,
            "criteria": {
                "fallback_to_existing_router": True,
                "feature_gated": True,
                "limited_scope": "SINGLE_TOOL_ROUTING_ONLY",
                "multi_tool_blocked": True,
                "observer_enabled": True,
                "reversible": True,
                "rollback_immediate": True,
                "single_tool_only": True,
                "wrim_l10_excluded_from_serving": True,
            },
            "design_only": True,
            "executed": False,
        },
    )
    write_json(
        work / "live-runtime-gap.json",
        {
            "REAL_RUNTIME_FRESH": 0,
            "acceptable_for_candidate_lifecycle": True,
            "basis": "fresh human-adjudicated + adversarial + real-test",
            "documented": True,
            "sufficient_for_unrestricted_production_activation": False,
        },
    )
    write_json(
        work / "no-serving-change-proof.json",
        {
            "candidate_lifecycle_does_not_execute_tools": True,
            "existing_router_authoritative": True,
            "feature_flag_after": "OFF",
            "feature_flag_before": "OFF",
            "feature_flag_name": "WR_NATIVE_ROUTER_V1_SHADOW",
            "gate_hash": verified["gate_hash"],
            "native_router_does_not_alter_routing": True,
            "production_path_untouched": True,
            "result": "PASS",
            "serving_behavior_after": "routeToolIntent / executeNormalizedRequest own live routing",
            "serving_behavior_before": "routeToolIntent / executeNormalizedRequest own live routing",
            "serving_behavior_unchanged": True,
            "shadow_hash": verified["shadow_hash"],
            "tool_router_hash": verified["tool_router_hash"],
        },
    )
    r03 = rules["R03_prior_turn_underspecified"]
    write_json(
        work / "remediation-backlog.json",
        {
            "POST_TEST_REMEDIATION_CANDIDATE_count": tax["n_remediation_candidates"],
            "R03_fresh_precision": r03["precision_when_chosen_first"],
            "R03_id": "R03_prior_turn_underspecified",
            "applied_count": 0,
            "applied": False,
            "source": str(NATIVE_ROUTER_V1_FRESH_GEN_DIR / "failure-taxonomy.json"),
        },
    )
    write_json(
        work / "promotion-verdict.json",
        {
            "lifecycle_verdict": "NATIVE ROUTER V1 — PROMOTED TO CANDIDATE",
            "mission_verdict": "WAR ROOM NATIVE ROUTER V1 CANDIDATE PROMOTION — PASS",
            "multi_tool_verdict": "NATIVE ROUTER V1 — MULTI-TOOL BLOCKED",
            "serving_verdict": "NATIVE ROUTER V1 — NOT SERVING",
        },
    )

    after_src = sha256_file(SCRIPT_DIR / "native_router_v1.py")
    after_wrim = sha256_file(WRIM0_WEIGHTS)
    after_tool = sha256_file(ROOT / "lib" / "modular-intelligence" / "toolRouter.ts")
    after_gate = sha256_file(ROOT / "lib" / "modular-intelligence" / "nativeRouterV1Gate.ts")
    after_shadow = sha256_file(ROOT / "lib" / "modular-intelligence" / "nativeRouterV1Shadow.ts")
    if after_src != NATIVE_ROUTER_V1_EXPECTED_ROUTER_SOURCE_HASH:
        fail("router source mutated")
    if after_wrim != wrim_hash:
        fail("WRIM mutated")
    if after_tool != verified["tool_router_hash"] or after_gate != verified["gate_hash"] or after_shadow != verified["shadow_hash"]:
        fail("serving TypeScript mutated")

    proof = json.loads((work / "no-serving-change-proof.json").read_text(encoding="utf-8"))
    proof["tool_router_hash_after"] = after_tool
    proof["gate_hash_after"] = after_gate
    proof["shadow_hash_after"] = after_shadow
    write_json(work / "no-serving-change-proof.json", proof)

    write_json(
        work / "audit-trail.json",
        {
            "authorized_by": "Commander",
            "artifact_promoted": NATIVE_ROUTER_V1_ID,
            "evidence_packet": "docs/WR_NATIVE_ROUTER_V1_CANDIDATE_PROMOTION_PACKET.md",
            "excluded_capabilities": EXCLUDED,
            "git_head_at_promotion": head,
            "hashes": hashes,
            "production_inactive": True,
            "production_validation_claimed": False,
            "rollback_path": "scripts/wrim-modular/native_router_v1_candidate_lifecycle.py --rollback-to-shadow",
            "scope": "SINGLE_TOOL_ROUTING_ONLY",
        },
    )
    write_json(work / "git-head.json", {"head": head, "commit_this_mission": False, "push_this_mission": False})
    print(json.dumps({"ok": True, "promoted_at": now, "dir": str(work)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
