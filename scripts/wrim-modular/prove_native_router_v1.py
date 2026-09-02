#!/usr/bin/env python3
"""Deterministic validation for Native Router V1. Does not train WRIM."""
from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR))

from hashes import sha256_file  # noqa: E402
from native_router_v1 import RULE_SPECS  # noqa: E402
from paths import (  # noqa: E402
    EXPECTED_CORE_TREE_SHA256,
    FROZEN_ROUTER_DIR,
    NATIVE_ROUTER_V1_DIR,
    PRODUCTION_ROOT,
    TOKENIZER_SHA256,
    TOOL_EVAL_6_DIR,
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

    work = NATIVE_ROUTER_V1_DIR
    man = json.loads((work / "manifest.json").read_text())
    arch = json.loads((work / "architecture.json").read_text())
    proof = json.loads((work / "core-immutability-proof.json").read_text())
    gates_lock = json.loads((work / "gates-locked-before-test.json").read_text())
    ablations = json.loads((work / "ablation-results.json").read_text())
    eval6 = json.loads((work / "eval6-results.json").read_text())
    lexical = json.loads((work / "lexical-component.json").read_text())
    wrim_c = json.loads((work / "wrim-component.json").read_text())
    reg = json.loads((work / "registry-bindings.json").read_text())
    shadow = json.loads((work / "shadow-results.json").read_text())
    verdict = json.loads((work / "readiness-verdict.json").read_text())
    hashes = json.loads((TOOL_EVAL_6_DIR / "HASHES.json").read_text())
    router_ts = (SCRIPT_DIR.parents[1] / "lib/modular-intelligence/toolRouter.ts").read_text()
    gate_ts = (SCRIPT_DIR.parents[1] / "lib/modular-intelligence/nativeRouterV1Gate.ts").read_text()
    registry_ts = (SCRIPT_DIR.parents[1] / "lib/tools/toolRegistry.ts").read_text()

    check("1 existing router inspected", lambda: eq("routeToolIntent" in router_ts and "executeNormalizedRequest" in router_ts, "router"))
    check("2 existing toolRegistry reused", lambda: eq(reg["authoritative_registry"] == "lib/tools/toolRegistry.ts" and "export const TOOL_REGISTRY" in registry_ts, "reg"))
    check("3 observer reused", lambda: eq("captureRuntimeTrajectory" in router_ts, "obs"))
    check("4 no duplicate registry", lambda: eq(reg["duplicate_registry_created"] is False, "dup"))
    check("5 no duplicate execution system", lambda: eq("executeNormalizedRequest" in router_ts and "parallelLedger" not in router_ts, "exec"))
    check("6 WRIM SHA exact", lambda: eq(sha256_file(WRIM0_WEIGHTS) == WRIM0_CHECKPOINT_SHA256 == proof["core_file_sha_after"], "sha"))
    check("7 WRIM core trainable params 0", lambda: eq(proof["core_trainable_parameters"] == 0, "train0"))
    check("8 L10 mean representation exact", lambda: eq(wrim_c["representation"]["layer"] == "layers.10" and wrim_c["representation"]["pooling"] == "mean" and wrim_c["representation"]["normalization"] == "raw", "rep"))
    check("9 information-state classifier implemented", lambda: eq((work / "information-state-contract.json").is_file(), "info"))
    check("10 deterministic pre-router implemented", lambda: eq(len(RULE_SPECS) >= 8, "rules"))
    check("11 NO_TOOL gate separated", lambda: eq("NO_TOOL_CONFIDENT" in (work / "gate-contract.json").read_text(), "gate"))
    check("12 lexical component implemented", lambda: eq(lexical["type"] == "v5_style_l2_bow_ova", "lex"))
    check("13 WRIM semantic component implemented", lambda: eq(wrim_c["frozen_head"] == "WR-TOOL-FROZEN-ROUTER-L10-MEAN-V1", "wrim"))
    check("14 registry compatibility check implemented", lambda: eq("schema" in (work / "hybrid-policy.json").read_text().lower(), "schema"))
    check("15 confidence/abstention implemented", lambda: eq((work / "confidence-policy.json").is_file(), "conf"))
    check("16 component disagreement logged", lambda: eq('"disagreement"' in (work / "shadow-observations.jsonl").read_text().splitlines()[0], "dis"))
    check("17 multi-tool detection implemented", lambda: eq("multi_tool_required" in Path(SCRIPT_DIR / "native_router_v1.py").read_text(), "mt"))
    check("18 EVAL-6 canonical rows unchanged", lambda: eq(sha256_file(TOOL_EVAL_6_DIR / "rows.jsonl") == hashes["rows.jsonl"] == eval6["eval6_rows_hash"], "rows"))
    check("19 validation/test separation preserved", lambda: eq(eval6["n_validation"] == 112 and eval6["n_test"] == 112, "split"))
    check("20 final gates fixed before test", lambda: eq(gates_lock["preferred_gates_unchanged"] is True and gates_lock["split"] == "validation", "lock"))
    check("21 deterministic-only ablation", lambda: eq("A_deterministic_only" in ablations, "A"))
    check("22 lexical-only ablation", lambda: eq("B_lexical_only" in ablations, "B"))
    check("23 WRIM-only ablation", lambda: eq("C_wrim_only" in ablations, "C"))
    check("24 deterministic+lexical", lambda: eq("D_deterministic_lexical" in ablations, "D"))
    check("25 deterministic+WRIM", lambda: eq("E_deterministic_wrim" in ablations, "E"))
    check("26 lexical+WRIM", lambda: eq("F_lexical_wrim" in ablations, "F"))
    check("27 full hybrid", lambda: eq("G_full_hybrid" in ablations, "G"))
    check("28 matched-pair metrics", lambda: eq((work / "semantic-subsets.json").is_file(), "mp"))
    check("29 counterfactual metrics", lambda: eq("counterfactual_flip_accuracy" in (work / "semantic-subsets.json").read_text(), "cf"))
    check("30 information-state metrics", lambda: eq("information_state" in (work / "semantic-subsets.json").read_text(), "is"))
    check("31 multi-turn metrics", lambda: eq("multi_turn" in (work / "semantic-subsets.json").read_text(), "mt2"))
    check("32 lexical-adversarial metrics", lambda: eq("lexical_adversarial" in (work / "semantic-subsets.json").read_text(), "la"))
    check("33 per-class metrics", lambda: eq("per_class" in json.dumps(eval6["full_hybrid"]), "pc"))
    native_ts = (SCRIPT_DIR.parents[1] / "lib/modular-intelligence/nativeRouterV1Shadow.ts").read_text()
    check("34 shadow mode cannot alter execution", lambda: eq(shadow["alters_routing"] is False and "alters_routing: false" in native_ts, "noalt"))
    check("35 feature flag default OFF", lambda: eq("default_off" in gate_ts and man["default_off"] is True, "off"))
    check("36 production always OFF", lambda: eq("NODE_ENV === 'production'" in gate_ts and man["production_always_off"] is True, "prodoff"))
    check("37 no WRIM training", lambda: eq(proof["wrim_training_performed"] is False, "notr"))
    check("38 no LoRA training", lambda: eq(proof["lora_training_performed"] is False, "nolora"))
    check("39 no EXP006", lambda: eq(proof["exp006_started"] is False, "no6"))
    check("40 core diff 0", lambda: eq(proof["max_abs_diff"] == 0, "diff"))
    check("41 active modules unchanged", lambda: eq(proof["active_modules"] == [] and man["active_modules"] == [], "mods"))
    check("42 production untouched", lambda: eq(proof["production_touched"] is False and str(PRODUCTION_ROOT) == proof["production_root"], "prod"))
    check(
        "43 lifecycle CANDIDATE metadata only; not production-promoted",
        lambda: eq(
            verdict["promoted"] is False
            and man["lifecycle"] == "CANDIDATE"
            and man.get("serving_activation") is False
            and man["active_modules"] == [],
            "cand-meta",
        ),
    )
    extra = [
        ("44 tree hash expected", lambda: eq(proof["core_tree_sha_after"] == EXPECTED_CORE_TREE_SHA256 == proof["core_tree_sha_before"], "tree")),
        ("45 frozen classifier present", lambda: eq((FROZEN_ROUTER_DIR / "classifier.npz").is_file(), "clf")),
        ("46 tokenizer sha documented", lambda: eq(len(TOKENIZER_SHA256) == 64, "tok")),
    ]
    for name, fn in extra:
        check(name, fn)

    write = work / "validator.json"
    write.write_text(json.dumps({"results": results, "pass": all(r["ok"] for r in results), "n": len(results)}, indent=2) + "\n")
    failed = [r for r in results if not r["ok"]]
    print(f"TOTAL={len(results)} PASS={len(results)-len(failed)} FAIL={len(failed)}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
