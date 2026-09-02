#!/usr/bin/env python3
"""Deterministic validation for WR-TOOL-PI-EXP-003. Reads artifacts; does not retrain."""
from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR))

from paths import (  # noqa: E402
    EXP002_DIR,
    EXP003_DIR,
    EXP003_HEAD_ID,
    EXP003_LORA_ID,
    PRODUCTION_ROOT,
    TOKENIZER_SHA256,
    TOOL_EVAL_2_HASH,
    V3_DATASET_HASH,
    WRIM0_CHECKPOINT_SHA256,
)
from exp003_support import python_route_dry_run  # noqa: E402

EXPECTED = 30


def _eq(a, b, msg=""):
    if a != b:
        raise AssertionError(f"{msg}{a!r} != {b!r}")


def main() -> int:
    work = EXP003_DIR
    results = []

    def check(name: str, fn):
        try:
            fn()
            results.append({"name": name, "ok": True})
            print(f"PASS {name}")
        except Exception as exc:  # noqa: BLE001
            results.append({"name": name, "ok": False, "detail": str(exc)})
            print(f"FAIL {name}: {exc}")

    hashes = json.loads((work / "hash-proofs.json").read_text())
    metrics = json.loads((work / "metrics.json").read_text())
    leak = json.loads((work / "leakage.json").read_text())
    split = json.loads((work / "dataset-split.json").read_text())
    opt = json.loads((work / "optimizer-isolation.json").read_text())
    attach = json.loads((work / "attach-detach.json").read_text())
    lang = json.loads((work / "language-stability.json").read_text())
    router = json.loads((work / "tool-router.json").read_text())
    verdict = json.loads((work / "final-verdict.json").read_text())
    summary = json.loads((work / "experiment-summary.json").read_text())
    lora_cfg = json.loads((work / "lora-config.json").read_text())
    tok_cache = json.loads((work / "token-cache.json").read_text())
    cfg = json.loads((work / "config.json").read_text())
    v3ref = json.loads((work / "v3-reference.json").read_text())
    eval2 = json.loads((work / "eval-2.json").read_text())
    lora_dir = work / "module" / EXP003_LORA_ID
    head_dir = work / "module" / EXP003_HEAD_ID
    exp002_lora = EXP002_DIR / "module" / "WR-TOOL-LORA-R2-001"
    exp002_head = EXP002_DIR / "module" / "WR-TOOL-HEAD-002"

    check("1 exact WRIM-0 SHA", lambda: _eq(hashes["core_file_sha256"], WRIM0_CHECKPOINT_SHA256))
    check("2 exact tokenizer SHA", lambda: _eq(hashes["tokenizer_sha256"], TOKENIZER_SHA256))
    check("3 V3 identity/hash", lambda: (
        _eq(v3ref["dataset_id"], "WR-TOOL-CURRICULUM-V3"),
        _eq(hashes["v3_hash"], V3_DATASET_HASH),
        _eq(v3ref["dataset_hash"], V3_DATASET_HASH),
    ))
    check("4 EVAL-2 identity/hash", lambda: (
        _eq(v3ref["eval_id"], "WR-TOOL-EVAL-2"),
        _eq(hashes["eval2_hash"], TOOL_EVAL_2_HASH),
        _eq(eval2["n"], 115),
    ))
    check("5 split counts 313/66/62", lambda: (
        _eq(split["train_count"], 313),
        _eq(split["validation_count"], 66),
        _eq(split["test_count"], 62),
    ))
    check("6 8-class mapping", lambda: _eq(
        split["class_mapping"]["classifier_classes"],
        ["NO_TOOL", "SHA256", "LOOKUP_NOTE", "ECHO_INT", "WEB", "MEMORY", "FILES", "RESEARCH"],
    ))
    check("7 family isolation", lambda: _eq(split["train_test_family_overlap"], []))
    check("8 no CAP-EVAL leakage", lambda: _eq(int(leak["cap_eval_0"].get("known_eval_leakage") or 0), 0))
    check("9 no TOOL-EVAL-1 leakage", lambda: _eq(int(leak["tool_eval_1"].get("known_eval_leakage") or 0), 0))
    check("10 no TOOL-EVAL-2 leakage", lambda: _eq(int(leak["tool_eval_2"].get("known_eval_leakage") or 0), 0))
    check("11 LoRA r=2 exact", lambda: (
        _eq(lora_cfg["rank"], 2),
        _eq(cfg["rank"], 2),
    ))
    check("12 actual q/v targets", lambda: (
        _eq(len(lora_cfg["targets"]), 36),
        _eq(lora_cfg["target_suffixes"], ["attn.q", "attn.v"]),
        _eq("q_proj" in str(lora_cfg["targets"]).lower(), False),
    ))
    check("13 classifier 256→8", lambda: (
        _eq(metrics["head_architecture"], "Linear(256 -> 8, bias=True)"),
        _eq(cfg["n_classes"], 8),
    ))
    check("14 LoRA param count computed", lambda: (
        _eq(opt["lora_trainable"], lora_cfg["verified_parameter_count"]),
        _eq(lora_cfg["verified_parameter_count"] > 0, True),
        _eq(metrics["lora_parameter_count"], lora_cfg["verified_parameter_count"]),
    ))
    check("15 head param count computed", lambda: (
        _eq(opt["head_trainable"], metrics["head_parameter_count"]),
        _eq(metrics["head_parameter_count"] > 0, True),
    ))
    check("16 optimizer excludes core", lambda: (
        _eq(opt["core_keys_in_optimizer"], []),
        _eq(opt["base_trainable_keys"], []),
        _eq(opt["core_trainable_base"], 0),
    ))
    check("17 classifier CE only", lambda: (
        _eq(metrics["training_objective"], "classifier_cross_entropy_only"),
        _eq(metrics["language_model_loss"], False),
        _eq(metrics["argument_extraction_trained"], False),
        _eq("hidden states are NOT cached for training" in tok_cache["note"], True),
    ))
    check("18 LoRA weights move", lambda: _eq(hashes["lora_max_abs_diff"] > 0, True))
    check("19 head weights move", lambda: _eq(hashes["head_max_abs_diff"] > 0, True))
    check("20 core weights do not move", lambda: _eq(hashes["core_max_abs_diff"], 0.0))
    check("21 core hash identical", lambda: _eq(
        hashes["pre_training_core_weight_tree_hash"],
        hashes["post_training_core_weight_tree_hash"],
    ))
    check("22 detached WRIM exact", lambda: _eq(lang["core_detached"]["identical"], True))
    check("23 attached stability diagnostics", lambda: (
        _eq(lang["composed_attached"]["n_probes"], 13),
        _eq("collapse_count" in lang["composed_attached"], True),
        _eq(lang["composed_attached"].get("adapter_created_broad_degeneration"), False),
    ))
    check("24 artifact reload", lambda: _eq(
        (lora_dir / "weights.safetensors").is_file()
        and (head_dir / "weights.safetensors").is_file()
        and summary["reload_ok"],
        True,
    ))
    check("25 attach/detach", lambda: _eq(attach["reattach_classifier_logits_match"], True))
    check("26 ToolIntent mapping", lambda: (
        _eq(router["class_to_compact"]["NO_TOOL"], "TOOL=none"),
        _eq(router["class_to_compact"]["SHA256"], "TOOL=sha256"),
        _eq(router["class_to_compact"]["WEB"], "TOOL=web"),
        _eq("TOOL=" in router["classifier_class_only_intent"], True),
    ))
    check("27 schema validation", lambda: (
        _eq(router["no_tool_route"]["validation"], "VALID"),
        _eq(router["gold_arg_dry_run"]["validation"], "VALID"),
    ))
    check("28 dry-run execution=false", lambda: (
        _eq(router["live_tools_executed"], False),
        _eq(router["gold_arg_dry_run"]["executed"], False),
        _eq(router["gold_arg_dry_run"]["execution_mode"], "dry_run"),
        _eq(python_route_dry_run("TOOL=sha256\ntext=hello")["executed"], False),
    ))
    check("29 lifecycle state", lambda: (
        _eq(verdict["do_not_promote"], True),
        _eq(verdict["module_state"] in ("CANDIDATE", "REJECTED"), True),
        _eq(verdict["module_state"] != "PROMOTED", True),
        _eq(summary["active_modules"], []),
        _eq(verdict["active_core"], "WRIM-0"),
        _eq(EXP003_LORA_ID, "WR-TOOL-LORA-R2-002"),
        _eq(EXP003_HEAD_ID, "WR-TOOL-HEAD-003"),
        _eq(exp002_lora.is_dir(), True),
        _eq(exp002_head.is_dir(), True),
        _eq(lora_dir.name != "WR-TOOL-LORA-R2-001", True),
        _eq(head_dir.name != "WR-TOOL-HEAD-002", True),
    ))
    check("30 production untouched", lambda: (
        _eq(summary["production_untouched"], True),
        _eq(str(PRODUCTION_ROOT) not in str(lora_dir), True),
        _eq(str(PRODUCTION_ROOT) not in str(head_dir), True),
    ))

    payload = {
        "expected": EXPECTED,
        "total": len(results),
        "passed": sum(1 for r in results if r["ok"]),
        "failed": [r for r in results if not r["ok"]],
        "results": results,
        "experiment_verdict": verdict["experiment_verdict"],
        "capability_verdict": verdict["capability_verdict"],
    }
    (work / "validation.json").write_text(json.dumps(payload, indent=2) + "\n")
    failed = [r for r in results if not r["ok"]]
    print(f"EXP003 validation: {payload['passed']}/{EXPECTED}")
    return 0 if not failed and len(results) == EXPECTED else 1


if __name__ == "__main__":
    raise SystemExit(main())
