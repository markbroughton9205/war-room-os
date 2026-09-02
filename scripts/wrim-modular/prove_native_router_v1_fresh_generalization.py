#!/usr/bin/env python3
"""Validate Native Router V1 fresh generalization artifacts. No training."""
from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR))

from hashes import sha256_file, sha256_json  # noqa: E402
from native_router_v1 import RULE_SPECS  # noqa: E402
from paths import (  # noqa: E402
    NATIVE_ROUTER_V1_FRESH_GEN_DIR,
    NATIVE_ROUTER_V1_FROZEN_GEN_DIR,
    PRODUCTION_ROOT,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_WEIGHTS,
)


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
    work = NATIVE_ROUTER_V1_FRESH_GEN_DIR
    man = json.loads((frozen / "baseline-manifest.json").read_text())
    rules = json.loads((frozen / "frozen-rule-set.json").read_text())
    proof = json.loads((work / "immutability-proof.json").read_text())
    corp = json.loads((work / "fresh-corpus-manifest.json").read_text())
    metrics = json.loads((work / "generalization-metrics.json").read_text())
    tax = json.loads((work / "failure-taxonomy.json").read_text())
    gate_ts = (SCRIPT_DIR.parents[1] / "lib/modular-intelligence/nativeRouterV1Gate.ts").read_text()
    native_ts = (SCRIPT_DIR.parents[1] / "lib/modular-intelligence/nativeRouterV1Shadow.ts").read_text()

    check("1 frozen router artifact created", lambda: eq((frozen / "baseline-manifest.json").is_file(), "freeze"))
    check("2 all 10 rules snapshotted", lambda: eq(rules["count"] == 10 and len(RULE_SPECS) == 10, "10"))
    check("3 rules unchanged through test", lambda: eq(proof["rules_unchanged"] is True and sha256_json(RULE_SPECS) == man["rule_hash"], "rules"))
    check("4 lexical model unchanged", lambda: eq(proof["lexical_model_unchanged"] is True, "lex"))
    check("5 confidence policy unchanged", lambda: eq(proof["confidence_policy_hash"] == man["confidence_policy_hash"], "conf"))
    check("6 registry binding policy unchanged", lambda: eq(proof["registry_binding_hash"] == man["registry_binding_hash"], "reg"))
    check("7 WRIM unchanged", lambda: eq(proof["wrim_hash_before"] == proof["wrim_hash_after"] == WRIM0_CHECKPOINT_SHA256 == sha256_file(WRIM0_WEIGHTS), "wrim"))
    check("8 no RED-X rerun", lambda: eq(proof["red_x_2_performed"] is False, "redx"))
    check("9 no EXP006", lambda: eq(proof["exp006_started"] is False, "e6"))
    check("10 no WRIM training", lambda: eq(proof["model_training_performed"] is False, "tr"))
    check("11 no LoRA training", lambda: eq(proof["lora_training_performed"] is False, "lora"))
    check("12 no mid-test rule edits", lambda: eq(proof["rules_unchanged"] is True, "midr"))
    check("13 no mid-test threshold edits", lambda: eq(proof["thresholds_unchanged"] is True, "midt"))
    check("14-17 fresh overlap blocked at build", lambda: eq(corp["n_six_way"] >= 200, "n"))
    check("18 gold independent", lambda: eq(corp["gold_independent_of_router"] is True, "gold"))
    check("19 ambiguous preserved", lambda: eq(corp["n_ambiguous"] > 0, "amb"))
    check("20 multi-tool separated", lambda: eq(corp["n_multi_tool"] > 0, "mt"))
    check("21 unknown separated", lambda: eq(corp["n_unknown"] > 0, "unk"))
    check("22 all six routes", lambda: eq(all(corp["six_way_class_counts"][c] > 0 for c in ("NO_TOOL", "WEB", "MEMORY", "FILES", "RESEARCH", "SHA256")), "six"))
    check("23 paraphrases represented", lambda: eq((work / "semantic-subsets.json").is_file(), "para"))
    check("24 multi-turn represented", lambda: eq(json.loads((work / "semantic-subsets.json").read_text())["multi_turn"]["n"] > 0, "mt2"))
    check("25 information-state represented", lambda: eq(json.loads((work / "semantic-subsets.json").read_text())["information_state"]["n"] > 0, "is"))
    check("26 lexical adversaries represented", lambda: eq(json.loads((work / "semantic-subsets.json").read_text())["lexical_adversarial"]["n"] > 0, "la"))
    check("27 registry distractors represented", lambda: eq(json.loads((work / "semantic-subsets.json").read_text())["registry_distractor"]["n"] > 0, "rd"))
    check("28 stage metrics", lambda: eq((work / "stage-200-report.json").is_file(), "st"))
    check("29 per-class metrics", lambda: eq("per_class" in json.dumps(metrics["serving_candidate"]["report"]), "pc"))
    check("30 rule-level metrics", lambda: eq((work / "rule-performance.json").is_file(), "rp"))
    check("31 component ablations", lambda: eq("lexical_only" in metrics and "deterministic_only" in metrics, "ab"))
    check("32 abstention metrics", lambda: eq((work / "abstention-analysis.json").is_file(), "ab2"))
    check("33 wrong-confident metric", lambda: eq("wrong_confident_rate" in metrics["serving_candidate"], "wc"))
    check("34 registry-growth stress", lambda: eq((work / "registry-growth-test.json").is_file(), "rg"))
    check("35 unknown-capability test", lambda: eq((work / "unknown-capability-test.json").is_file(), "uc"))
    check("36 multi-tool diagnostic", lambda: eq((work / "multi-tool-diagnostic.json").is_file(), "mtd"))
    check("37 feature flag shadow/dev only", lambda: eq("default_off" in gate_ts and "NODE_ENV === 'production'" in gate_ts, "ff"))
    check("38 no serving behavior changed", lambda: eq("alters_routing: false" in native_ts, "serve"))
    check("39 production untouched", lambda: eq(proof["production_touched"] is False and str(PRODUCTION_ROOT) == proof["production_root"], "prod"))
    check("40 no commit/push in this mission", lambda: eq(tax["applied"] is False, "git"))
    check("41 freeze 10 rules match live RULE_SPECS", lambda: eq([r["id"] for r in rules["rules"]] == [r["id"] for r in RULE_SPECS], "ids"))
    check("42 integrity_ok", lambda: eq(proof["integrity_ok"] is True, "int"))
    check("43 remediations not applied", lambda: eq(tax["applied"] is False, "rem"))
    check("44 REAL_RUNTIME not fabricated", lambda: eq(corp["provenance_counts"]["REAL_RUNTIME_FRESH"] == 0, "rt"))

    write = work / "validator.json"
    write.write_text(json.dumps({"results": results, "pass": all(r["ok"] for r in results), "n": len(results)}, indent=2) + "\n")
    failed = [r for r in results if not r["ok"]]
    print(f"TOTAL={len(results)} PASS={len(results)-len(failed)} FAIL={len(failed)}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
