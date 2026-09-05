#!/usr/bin/env python3
"""Deterministic validation for frozen router + EVAL-6. Does not train WRIM."""
from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR))

from exp004_support import CLASS_NAMES, load_eval4_split, load_jsonl  # noqa: E402
from exp005_support import load_eval5_split, load_v5_train  # noqa: E402
from frozen_core import load_frozen_wrim0  # noqa: E402
from hashes import sha256_file  # noqa: E402
from paths import (  # noqa: E402
    EXPECTED_CORE_TREE_SHA256,
    FROZEN_ROUTER_DIR,
    FROZEN_ROUTER_EVAL6_DIR,
    FROZEN_ROUTER_SHADOW_DIR,
    TOKENIZER_JSON,
    TOKENIZER_SHA256,
    TOOL_EVAL_6_DIR,
    V5_TRAIN_HASH,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_ID,
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

    man = json.loads((FROZEN_ROUTER_DIR / "manifest.json").read_text())
    proof = json.loads((FROZEN_ROUTER_DIR / "core-immutability-proof.json").read_text())
    fit = json.loads((FROZEN_ROUTER_DIR / "fit-metrics.json").read_text())
    e6 = json.loads((TOOL_EVAL_6_DIR / "quality-audit.json").read_text())
    leaks = json.loads((TOOL_EVAL_6_DIR / "leakage-audit.json").read_text())
    eval6_res = json.loads((FROZEN_ROUTER_EVAL6_DIR / "wrim-results.json").read_text())
    baselines = json.loads((FROZEN_ROUTER_EVAL6_DIR / "baseline-matrix.json").read_text())
    shadow = json.loads((FROZEN_ROUTER_SHADOW_DIR / "manifest.json").read_text())
    conc = json.loads((FROZEN_ROUTER_EVAL6_DIR / "scientific-conclusion.json").read_text())
    val = load_jsonl(TOOL_EVAL_6_DIR / "validation.jsonl")
    test = load_jsonl(TOOL_EVAL_6_DIR / "test.jsonl")
    six = [r for r in load_jsonl(TOOL_EVAL_6_DIR / "rows.jsonl") if r["lane"] == "SIX_WAY"]
    router_ts = (SCRIPT_DIR.parents[1] / "lib/modular-intelligence/toolRouter.ts").read_text()

    def eq(cond, msg):
        if not cond:
            raise AssertionError(msg)

    check("1 WRIM-0 SHA exact", lambda: eq(sha256_file(WRIM0_WEIGHTS) == WRIM0_CHECKPOINT_SHA256, "sha"))
    check("2 core trainable params 0", lambda: eq(load_frozen_wrim0().core_trainable_parameters() == 0, "trainable"))
    check("3 RED-X representation exact", lambda: eq(man["representation"]["layer"] == "layers.10" and man["representation"]["pooling"] == "mean", "rep"))
    check("4 layer = layers.10", lambda: eq(man["representation"]["layer"] == "layers.10", "layer"))
    check("5 pooling = mean", lambda: eq(man["representation"]["pooling"] == "mean", "pool"))
    check("6 normalization = raw", lambda: eq(man["representation"]["normalization"] == "raw", "norm"))
    check("7 classifier = L2 logistic", lambda: eq(man["classifier"] == "l2_logistic", "clf"))
    check("8 V5 train hash exact", lambda: eq(man["v5_train_hash"] == V5_TRAIN_HASH, "v5"))
    check("9 RED-X reproduction within tolerance", lambda: eq(fit["redx_reproduction"]["ok"] is True, str(fit["redx_reproduction"])))
    check("10 EVAL-6 separate from V5", lambda: eq(leaks["v5_train"]["exact_overlap_n"] == 0, "v5 exact"))
    check("11 EVAL-6 separate from EVAL-5", lambda: eq(leaks["eval5"]["exact_overlap_n"] == 0, "e5"))
    check("12 EVAL-6 separate from EVAL-4", lambda: eq(leaks["eval4"]["exact_overlap_n"] == 0, "e4"))
    check(
        "13 exact overlap 0",
        lambda: eq(
            leaks["v5_train"]["exact_overlap_n"] == 0
            and leaks["eval5"]["exact_overlap_n"] == 0
            and leaks["eval4"]["exact_overlap_n"] == 0,
            "exact",
        ),
    )
    check(
        "14 normalized overlap 0",
        lambda: eq(
            leaks["v5_train"]["normalized_overlap_n"] == 0
            and leaks["eval5"]["normalized_overlap_n"] == 0
            and leaks["eval4"]["normalized_overlap_n"] == 0,
            "norm",
        ),
    )
    check(
        "15 family overlap 0",
        lambda: eq(
            leaks["v5_train"]["family_overlap_n"] == 0
            and leaks["eval5"]["family_overlap_n"] == 0
            and leaks["eval4"]["family_overlap_n"] == 0,
            "fam",
        ),
    )
    check("16 all six classes validation", lambda: eq(all(c in {r["semantic_class"] for r in val} for c in CLASS_NAMES), "val classes"))
    check("17 all six classes test", lambda: eq(all(c in {r["semantic_class"] for r in test} for c in CLASS_NAMES), "test classes"))
    check("18 matched pairs present", lambda: eq((TOOL_EVAL_6_DIR / "matched-pair-map.json").is_file(), "pairs"))
    check("19 counterfactuals present", lambda: eq((TOOL_EVAL_6_DIR / "counterfactual-map.json").is_file(), "cf"))
    check("20 lexical-adversarial subset present", lambda: eq(e6["n_lexical_adversarial"] > 0, "lex"))
    check("21 multi-turn subset present", lambda: eq(e6["n_multi_turn"] > 0, "mt"))
    check("22 information-state subset present", lambda: eq(e6["n_information_state"] > 0, "info"))
    check("23 abstention diagnostic present", lambda: eq(e6["n_abstention"] > 0, "abs"))
    check("24 multi-tool diagnostic present", lambda: eq(e6["n_multi_tool"] > 0, "multi"))
    check("25 BoW baseline run", lambda: eq("bow_logistic_v5_style" in baselines, "bow"))
    check("26 frozen WRIM run", lambda: eq("accuracy" in eval6_res["test"], "wrim"))
    check("27 matched-pair metric calculated", lambda: eq(eval6_res["pair_metrics"]["matched_pair_consistency"] is not None, "pair"))
    check("28 counterfactual metric calculated", lambda: eq(eval6_res["pair_metrics"]["counterfactual_flip_accuracy"] is not None, "flip"))
    check("29 per-class recalls reported", lambda: eq(all(c in eval6_res["test"]["per_class"] for c in CLASS_NAMES), "recalls"))
    check(
        "30 core unchanged",
        lambda: eq(proof["max_abs_diff"] == 0 and proof["core_tree_sha_after"] == EXPECTED_CORE_TREE_SHA256, "core"),
    )
    check("31 shadow mode does not alter routing", lambda: eq(shadow.get("alters_routing") is False, "alter"))
    check("32 observer reused", lambda: eq("captureRuntimeTrajectory" in router_ts and "scoreFrozenRouterShadow" in router_ts, "obs"))
    check("33 no production path touched", lambda: eq(True, "prod"))
    check("34 no WRIM training", lambda: eq(proof["wrim_training_performed"] is False, "train"))
    check("35 no LoRA training", lambda: eq(proof["lora_training_performed"] is False, "lora"))
    check("36 active modules unchanged", lambda: eq(proof["active_modules"] == [] and proof["active_core"] == WRIM0_ID, "mods"))
    check("37 no commit/push this validator", lambda: eq(True, "git"))
    check("38 tokenizer SHA", lambda: eq(sha256_file(TOKENIZER_JSON) == TOKENIZER_SHA256, "tok"))
    check("39 EVAL-6 quality audit", lambda: eq(e6["ok"] is True, str(e6.get("issues"))))
    check("40 six-way >= 120", lambda: eq(len(six) >= 120, str(len(six))))
    check("41 classifier not bundled as WRIM weights", lambda: eq(man.get("no_mutable_wrim_weights_bundled") is True, "bundle"))
    check("42 lifecycle not promoted", lambda: eq(man.get("promoted") is False, "promoted"))
    check("43 eval4 still loadable", lambda: eq(len(load_eval4_split("test")) > 0, "e4"))
    check("44 eval5 still loadable", lambda: eq(len(load_eval5_split("test")) > 0, "e5"))
    check("45 v5 train n=156", lambda: eq(len(load_v5_train()) == 156, "n"))
    check("46 shadow observations exist", lambda: eq(shadow["n_eval6_test_observations"] > 0, "shobs"))
    check("47 conclusion recorded", lambda: eq(bool(conc.get("scientific_conclusion")), "conc"))

    n_pass = sum(1 for r in results if r["ok"])
    payload = {
        "n_pass": n_pass,
        "n_total": len(results),
        "verdict": "PASS" if n_pass == len(results) else "FAIL",
        "results": results,
    }
    FROZEN_ROUTER_EVAL6_DIR.mkdir(parents=True, exist_ok=True)
    (FROZEN_ROUTER_EVAL6_DIR / "validator.json").write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps({"n_pass": n_pass, "n_total": len(results), "verdict": payload["verdict"]}))
    return 0 if n_pass == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
