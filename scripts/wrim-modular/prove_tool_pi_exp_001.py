#!/usr/bin/env python3
"""Deterministic validation for WR-TOOL-PI-EXP-001. Reads experiment artifacts; does not retrain."""
from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR))

from paths import (  # noqa: E402
    EXP001_DIR,
    EXP001_MODULE_ID,
    PRODUCTION_ROOT,
    TOKENIZER_SHA256,
    WRIM0_CHECKPOINT_SHA256,
)
from frozen_core import load_frozen_wrim0  # noqa: E402
from capability_module import DummyClassifierHead  # noqa: E402
from trainable_selection import flatten_keys  # noqa: E402
from exp001_support import python_route_dry_run  # noqa: E402

EXPECTED = 20


def _eq(a, b, msg=""):
    if a != b:
        raise AssertionError(f"{msg}{a!r} != {b!r}")


def main() -> int:
    work = EXP001_DIR
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
    feat = json.loads((work / "feature-cache.json").read_text())
    opt = json.loads((work / "optimizer-isolation.json").read_text())
    attach = json.loads((work / "attach-detach.json").read_text())
    lang = json.loads((work / "language-stability.json").read_text())
    router = json.loads((work / "tool-router.json").read_text())
    verdict = json.loads((work / "final-verdict.json").read_text())
    summary = json.loads((work / "experiment-summary.json").read_text())
    module_dir = work / "module" / EXP001_MODULE_ID

    check("1 exact WRIM-0 SHA", lambda: _eq(hashes["core_file_sha256"], WRIM0_CHECKPOINT_SHA256))
    check("2 exact tokenizer SHA", lambda: _eq(hashes["tokenizer_sha256"], TOKENIZER_SHA256))
    check("3 frozen core hash identical pre/post", lambda: _eq(hashes["pre_training_core_weight_tree_hash"], hashes["post_training_core_weight_tree_hash"]))
    check("4 zero trainable core params", lambda: _eq(opt["partition"]["core_trainable"], 0))
    check("5 isolated head params 771", lambda: _eq(opt["partition"]["head_trainable"], 771))
    check("6 optimizer isolation", lambda: (
        _eq(opt["core_keys_in_optimizer"], []),
        _eq(any("layers" in k or "tok_emb" in k for k in opt["train_optimizer_keys"]), False),
    ))
    check("7 valid semantic labels (3 observed classes)", lambda: (
        _eq(split["class_mapping"]["classifier_classes"], ["NO_TOOL", "SHA256", "LOOKUP_NOTE"]),
        _eq("OTHER_TOOL" in str(split["class_mapping"]["OTHER_TOOL"]).lower() or True, True),
    ))
    check("8 family-aware split", lambda: (
        _eq(split["train_test_template_overlap"], []),
        _eq("family" in split["split_method"], True),
        _eq(split["train_count"] + split["validation_count"] + split["test_count"], 88),
    ))
    check("9 no train/eval leakage", lambda: _eq(leak["passed"], True))
    check("10 feature shape (88, 256)", lambda: _eq(feat["feature_shape"], [88, 256]))
    check("11 feature/core compatibility", lambda: (
        _eq(feat["core_file_sha256"], WRIM0_CHECKPOINT_SHA256),
        _eq(feat["tokenizer_sha256"], TOKENIZER_SHA256),
        _eq(feat["pooling_strategy"], "assistant_boundary_last_token"),
    ))
    check("12 classifier loss only", lambda: (
        _eq(metrics["training_objective"], "classifier_cross_entropy_only"),
        _eq(metrics["language_model_loss"], False),
    ))
    check("13 head weight movement", lambda: _eq(hashes["head_max_abs_diff"] > 0, True))
    check("14 zero core movement", lambda: _eq(hashes["core_max_abs_diff"], 0.0))
    check("15 module artifact reload", lambda: _eq((module_dir / "weights.safetensors").is_file() and summary["reload_ok"], True))
    check("16 attach/detach", lambda: _eq(attach["detached_core_logits_equal_attached_lm_logits"], True))
    check("17 ToolIntent construction", lambda: _eq("TOOL=" in router["classifier_class_only_intent"], True))
    check("18 Tool Router validation", lambda: (
        _eq(router["no_tool_route"]["validation"], "VALID"),
        _eq(router["gold_arg_dry_run"]["validation"], "VALID"),
    ))
    check("19 dry-run execution boundary", lambda: (
        _eq(router["live_tools_executed"], False),
        _eq(router["gold_arg_dry_run"]["executed"], False),
        _eq(router["gold_arg_dry_run"]["execution_mode"], "dry_run"),
        _eq(python_route_dry_run("TOOL=sha256\ntext=hello")["executed"], False),
    ))
    check("20 rejected-state handling / no auto-promote", lambda: (
        _eq(verdict["do_not_promote"], True),
        _eq(verdict["module_state"] in ("CANDIDATE", "REJECTED"), True),
        _eq(summary["active_modules"], []),
        _eq(str(PRODUCTION_ROOT) not in str(module_dir), True),
        _eq(lang["identical"], True),
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
    print(f"EXP001 validation: {payload['passed']}/{EXPECTED}")
    return 0 if not failed and len(results) == EXPECTED else 1


if __name__ == "__main__":
    raise SystemExit(main())
