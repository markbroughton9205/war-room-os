#!/usr/bin/env python3
"""Fit WR-TOOL-FROZEN-ROUTER-L10-MEAN-V1. Reproduce RED-X. No WRIM/LoRA training."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))
sys.path.insert(0, str(SCRIPT_DIR))

from hashes import sha256_file  # noqa: E402
from frozen_core import load_frozen_wrim0, max_abs_diff, numpy_params  # noqa: E402
from exp004_support import CLASS_NAMES, classification_report_6, labels  # noqa: E402
from exp005_support import (  # noqa: E402
    assert_eval5_contract,
    eval4_still_frozen,
    eval5_hashes,
    load_eval5_split,
    load_v5_train,
    v5_hashes,
)
from frozen_router_support import (  # noqa: E402
    CLASSIFIER,
    LAYER,
    NORMALIZATION,
    POOLING,
    artifact_bytes_hash,
    classifier_param_count,
    dump_classifier,
    extract_rows,
    fit_l2_logistic,
    identity_payload,
    load_classifier,
    load_tokenizer_local,
    metrics_match_redx,
    predict_ids,
    predict_proba,
    utcnow,
    write_json,
)
from paths import (  # noqa: E402
    EXPECTED_CORE_TREE_SHA256,
    FROZEN_ROUTER_DIR,
    FROZEN_ROUTER_ID,
    FROZEN_ROUTER_TITLE,
    PRODUCTION_ROOT,
    REDX_LOCKED_TEST,
    TOKENIZER_JSON,
    TOKENIZER_SHA256,
    V5_TRAIN_HASH,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_ID,
    WRIM0_WEIGHTS,
)
from redx_support import jsonable  # noqa: E402


def main() -> int:
    work = FROZEN_ROUTER_DIR
    work.mkdir(parents=True, exist_ok=True)

    train = load_v5_train()
    val = load_eval5_split("validation")
    test = load_eval5_split("test")
    assert_eval5_contract(val, test)
    if len(train) != 156:
        raise RuntimeError(f"V5 train n={len(train)}")
    if v5_hashes()["train.jsonl"] != V5_TRAIN_HASH:
        raise RuntimeError("V5 train hash mismatch")
    if not eval4_still_frozen():
        raise RuntimeError("EVAL-4 mutated")

    if sha256_file(TOKENIZER_JSON) != TOKENIZER_SHA256:
        raise RuntimeError("tokenizer SHA")
    if sha256_file(WRIM0_WEIGHTS) != WRIM0_CHECKPOINT_SHA256:
        raise RuntimeError("WRIM-0 file SHA")

    core = load_frozen_wrim0()
    before_tree = core.weight_tree_hash()
    before_file = core.file_sha256
    snap0 = numpy_params(core.model)
    if before_file != WRIM0_CHECKPOINT_SHA256:
        raise RuntimeError("sidecar file SHA")
    if before_tree != EXPECTED_CORE_TREE_SHA256:
        raise RuntimeError(f"core tree SHA {before_tree} != {EXPECTED_CORE_TREE_SHA256}")
    if core.core_trainable_parameters() != 0:
        raise RuntimeError("core trainable != 0")

    tokenizer = load_tokenizer_local()
    xtr = extract_rows(core.model, tokenizer, train)
    xva = extract_rows(core.model, tokenizer, val)
    xte = extract_rows(core.model, tokenizer, test)
    ytr = labels(train)
    yva = labels(val)
    yte = labels(test)

    clf = fit_l2_logistic(xtr, ytr)
    pred_va = predict_ids(clf, xva)
    pred_te = predict_ids(clf, xte)
    val_rep = classification_report_6(yva, pred_va)
    test_rep = classification_report_6(yte, pred_te)
    match = metrics_match_redx(test_rep)
    if not match["ok"]:
        write_json(
            work / "reproduction-FAIL.json",
            {"match": match, "val": val_rep, "test": test_rep, "stopped": True},
        )
        print("RED-X REPRODUCTION FAIL — STOP. EVAL-6 not started.")
        print(json.dumps(jsonable(match), indent=2))
        return 2

    after_tree = core.weight_tree_hash()
    after_file = sha256_file(WRIM0_WEIGHTS)
    peak = max_abs_diff(snap0, numpy_params(core.model))
    if peak != 0.0 or after_tree != before_tree or after_file != before_file:
        raise RuntimeError(f"core mutated peak={peak}")

    dump_classifier(work / "classifier.npz", clf, int(xtr.shape[1]))
    clf2 = load_classifier(work / "classifier.npz")
    reload_pred = predict_ids(clf2, xte)
    reload_ok = bool(np.array_equal(reload_pred, pred_te))
    if not reload_ok:
        raise RuntimeError("classifier reload mismatch")

    n_params = classifier_param_count(clf)
    write_json(work / "class-map.json", {str(i): n for i, n in enumerate(CLASS_NAMES)})
    write_json(
        work / "representation.json",
        {
            "layer": LAYER,
            "pooling": POOLING,
            "normalization": NORMALIZATION,
            "classifier": CLASSIFIER,
            "feature_dimension": int(xtr.shape[1]),
            "n_train": len(train),
            "methodology": "RED-X exact: collect_hiddens layers.10 mean, raw features, LogisticRegression L2 lbfgs",
        },
    )
    write_json(work / "fit-metrics.json", {"validation": val_rep, "eval5_test_once": test_rep, "redx_reproduction": match})
    write_json(
        work / "reload-proof.json",
        {"ok": reload_ok, "eval5_test_equal": reload_ok, "n_test": int(len(test))},
    )
    write_json(
        work / "core-immutability-proof.json",
        {
            "core_file_sha_before": before_file,
            "core_file_sha_after": after_file,
            "core_tree_sha_before": before_tree,
            "core_tree_sha_after": after_tree,
            "max_abs_diff": peak,
            "core_trainable_parameters": 0,
            "classifier_trainable_params": n_params,
            "wrim_training_performed": False,
            "lora_training_performed": False,
            "active_core": WRIM0_ID,
            "active_modules": [],
            "production_root_untouched": str(PRODUCTION_ROOT),
        },
    )
    write_json(
        work / "lifecycle.json",
        {
            "status": "SHADOW",
            "promoted": False,
            "promotion_review": False,
            "active_modules": [],
        },
    )
    hashed_files = [
        work / "classifier.npz",
        work / "class-map.json",
        work / "representation.json",
        work / "fit-metrics.json",
        work / "reload-proof.json",
        work / "core-immutability-proof.json",
        work / "lifecycle.json",
    ]
    bundle = artifact_bytes_hash(hashed_files)
    write_json(
        work / "HASHES.json",
        {
            "classifier.npz": sha256_file(work / "classifier.npz"),
            "artifact_bundle": bundle,
            "v5_train.jsonl": V5_TRAIN_HASH,
            "wrim0": WRIM0_CHECKPOINT_SHA256,
        },
    )
    ident = identity_payload()
    ident.update(
        {
            "title": FROZEN_ROUTER_TITLE,
            "created_at": utcnow(),
            "feature_dimension": int(xtr.shape[1]),
            "classifier_trainable_params": n_params,
            "no_wrim_training": True,
            "no_lora_training": True,
            "no_mutable_wrim_weights_bundled": True,
            "reproduction": match,
            "eval5_test": {k: test_rep[k] for k in ("accuracy", "balanced_accuracy", "macro_f1")},
            "artifact_hash": bundle,
            "hashes": json.loads((work / "HASHES.json").read_text()),
        },
    )
    write_json(work / "manifest.json", ident)
    print(json.dumps({"identity": FROZEN_ROUTER_ID, "reproduction": match["ok"], "test": ident["eval5_test"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
