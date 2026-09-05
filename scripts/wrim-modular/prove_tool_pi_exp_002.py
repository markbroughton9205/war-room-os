#!/usr/bin/env python3
"""Deterministic validation for WR-TOOL-PI-EXP-002. Reads artifacts; does not retrain."""
from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR))

from paths import (  # noqa: E402
    EXP001_DIR,
    EXP002_DIR,
    EXP002_HEAD_ID,
    EXP002_LORA_ID,
    PRODUCTION_ROOT,
    TOKENIZER_SHA256,
    WRIM0_CHECKPOINT_SHA256,
)
from frozen_core import load_frozen_wrim0  # noqa: E402
from capability_module import DummyClassifierHead  # noqa: E402
from lora_qv import IsolatedLoRAHeadRuntime, inject_lora_qv, load_lora_into_model, verified_qv_sites  # noqa: E402
from exp001_support import python_route_dry_run  # noqa: E402

EXPECTED = 28


def _eq(a, b, msg=""):
    if a != b:
        raise AssertionError(f"{msg}{a!r} != {b!r}")


def main() -> int:
    work = EXP002_DIR
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
    lora_dir = work / "module" / EXP002_LORA_ID
    head_dir = work / "module" / EXP002_HEAD_ID
    exp001_split = json.loads((EXP001_DIR / "dataset-split.json").read_text())

    check("1 exact WRIM-0 SHA", lambda: _eq(hashes["core_file_sha256"], WRIM0_CHECKPOINT_SHA256))
    check("2 exact tokenizer SHA", lambda: _eq(hashes["tokenizer_sha256"], TOKENIZER_SHA256))
    check("3 base frozen / hash identical pre/post", lambda: (
        _eq(hashes["pre_training_core_weight_tree_hash"], hashes["post_training_core_weight_tree_hash"]),
        _eq(hashes["core_max_abs_diff"], 0.0),
    ))
    check("4 core trainable params = 0", lambda: _eq(opt["core_trainable_base"], 0))
    check("5 actual q/v sites verified", lambda: (
        _eq(len(lora_cfg["targets"]), 36),
        _eq(lora_cfg["target_suffixes"], ["attn.q", "attn.v"]),
        _eq("q_proj" in str(lora_cfg["targets"]).lower(), False),
    ))
    check("6 LoRA r=2 parameter count from implementation", lambda: (
        _eq(lora_cfg["rank"], 2),
        _eq(opt["lora_trainable"], lora_cfg["verified_parameter_count"]),
        _eq(lora_cfg["verified_parameter_count"] > 0, True),
    ))
    check("7 classifier parameter count 771", lambda: _eq(opt["head_trainable"], 771))
    check("8 optimizer excludes core", lambda: (
        _eq(opt["core_keys_in_optimizer"], []),
        _eq(opt["base_trainable_keys"], []),
    ))
    check("9 exact EXP-001 split reused", lambda: (
        _eq(split["train_ids_equal"], True),
        _eq(split["train_count"], exp001_split["train_count"]),
        _eq(split["validation_count"], exp001_split["validation_count"]),
        _eq(split["test_count"], exp001_split["test_count"]),
        _eq([e["example_id"] for e in split["examples"]], [e["example_id"] for e in exp001_split["examples"]]),
        _eq([e["split"] for e in split["examples"]], [e["split"] for e in exp001_split["examples"]]),
    ))
    check("10 label mapping identical", lambda: (
        _eq(split["class_mapping"]["classifier_classes"], ["NO_TOOL", "SHA256", "LOOKUP_NOTE"]),
        _eq([e["gold_class"] for e in split["examples"]], [e["gold_class"] for e in exp001_split["examples"]]),
    ))
    check("11 no train/test family leakage", lambda: _eq(split["train_test_template_overlap"], []))
    check("12 no CAP-EVAL leakage", lambda: _eq(int(leak["cap_eval_0"].get("known_eval_leakage") or 0), 0))
    check("13 no TOOL-EVAL leakage", lambda: _eq(int(leak["tool_eval_1"].get("known_eval_leakage") or 0), 0))
    check("14 only classifier CE objective", lambda: (
        _eq(metrics["training_objective"], "classifier_cross_entropy_only"),
        _eq(metrics["language_model_loss"], False),
        _eq("hidden states are NOT cached for training" in tok_cache["note"], True),
    ))
    check("15 LoRA weights move", lambda: _eq(hashes["lora_max_abs_diff"] > 0, True))
    check("16 classifier weights move", lambda: _eq(hashes["head_max_abs_diff"] > 0, True))
    check("17 core weights do not move", lambda: _eq(hashes["core_max_abs_diff"], 0.0))
    check("18 core hash identical", lambda: _eq(hashes["pre_training_core_weight_tree_hash"], hashes["post_training_core_weight_tree_hash"]))
    check("19 LoRA artifact save/load", lambda: _eq((lora_dir / "weights.safetensors").is_file() and summary["reload_ok"], True))
    check("20 classifier artifact save/load", lambda: _eq((head_dir / "weights.safetensors").is_file() and summary["reload_ok"], True))
    check("21 attach/detach", lambda: _eq(attach["reattach_classifier_logits_match"], True))
    check("22 detached WRIM exact behavior", lambda: _eq(lang["core_detached"]["identical"], True))
    check("23 attached stability probes recorded", lambda: (
        _eq(lang["composed_attached"]["n_probes"], 13),
        _eq("collapse_count" in lang["composed_attached"], True),
        _eq(lang["composed_attached"].get("adapter_created_broad_degeneration"), False),
    ))
    check("24 ToolIntent construction", lambda: _eq("TOOL=" in router["classifier_class_only_intent"], True))
    check("25 Tool Router validation", lambda: (
        _eq(router["no_tool_route"]["validation"], "VALID"),
        _eq(router["gold_arg_dry_run"]["validation"], "VALID"),
    ))
    check("26 execution=false dry-run boundary", lambda: (
        _eq(router["live_tools_executed"], False),
        _eq(router["gold_arg_dry_run"]["executed"], False),
        _eq(router["gold_arg_dry_run"]["execution_mode"], "dry_run"),
        _eq(python_route_dry_run("TOOL=sha256\ntext=hello")["executed"], False),
    ))
    check("27 lifecycle state", lambda: (
        _eq(verdict["do_not_promote"], True),
        _eq(verdict["module_state"] in ("CANDIDATE", "REJECTED"), True),
        _eq(verdict["module_state"] != "PROMOTED", True),
        _eq(summary["active_modules"], []),
        _eq(verdict["active_core"], "WRIM-0"),
    ))
    check("28 production untouched", lambda: (
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
    print(f"EXP002 validation: {payload['passed']}/{EXPECTED}")
    return 0 if not failed and len(results) == EXPECTED else 1


if __name__ == "__main__":
    raise SystemExit(main())
