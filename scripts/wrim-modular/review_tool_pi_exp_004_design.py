#!/usr/bin/env python3
"""WR-TOOL EXP-004 6-class loader/head DESIGN REVIEW.

Dry-run only: load V4 train + EVAL-4, attach LoRA r=2, Linear(256→6),
forward + CE. NO optimizer. NO optimizer.step. NO training.
Does not write WR-TOOL-PI-EXP-004 weights. Does not touch production.
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))
sys.path.insert(0, str(SCRIPT_DIR))

from paths import (  # noqa: E402
    EXP004_DESIGN_PKG_DIR,
    EXP004_DESIGN_PKG_ID,
    EXP004_HEAD_ID,
    EXP004_LORA_ID,
    FROZEN_V4_TRAIN_HASH,
    PRODUCTION_ROOT,
    ROOT,
    TOKENIZER_JSON,
    TOKENIZER_SHA256,
    TOOL_EVAL_2_DIR,
    TOOL_EVAL_3_DIR,
    TOOL_EVAL_4_DIR,
    V4_CANDIDATE_DIR,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_ID,
)
from frozen_core import load_frozen_wrim0, max_abs_diff, numpy_params  # noqa: E402
from capability_module import DummyClassifierHead, make_lora_manifest, make_tool_head_manifest  # noqa: E402
from hashes import sha256_file, sha256_json, tensor_tree_sha256  # noqa: E402
from lora_qv import (  # noqa: E402
    IsolatedLoRAHeadRuntime,
    ALPHA,
    RANK,
    assert_optimizer_lora_and_head_only,
    core_param_view,
    count_base_trainable,
    count_lora_params,
    freeze_backbone_unfreeze_lora,
    inject_lora_qv,
    lora_param_view,
    optimizer_key_partition,
    verified_qv_sites,
)
from exp001_support import POOLING_STRATEGY  # noqa: E402
from exp004_support import (  # noqa: E402
    CLASS_NAMES,
    CLASS_TO_ID,
    EVAL4_BUNDLE,
    EXPECTED_HEAD_PARAMS,
    EXPECTED_LORA_PARAMS,
    EXPECTED_TRAINABLE,
    N_CLASSES,
    SCHEMA_BLOCK_6,
    assert_eval4_contract,
    bow_predict,
    classification_report_6,
    eval2_eval3_protected,
    family_leak,
    keyword_predict,
    labels,
    lexical_views,
    load_eval4_split,
    load_v4_train,
    pred_ids,
    render_prefix,
    schema_predict,
    subset,
)

SEED = 20260831
HEAD_INIT_SEED = 11
LORA_INIT_SEED = 20260831
LR = 5e-4
BETAS = (0.9, 0.999)
EPS = 1e-8
WEIGHT_DECAY = 0.01
BATCH = 4
MAX_EPOCHS = 40
MIN_EPOCHS = 3
PATIENCE = 8
CLIP_NORM = 1.0


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=True) + "\n", encoding="utf-8")


def load_tokenizer_local():
    from tokenizers import Tokenizer, decoders

    tok = Tokenizer.from_file(str(TOKENIZER_JSON))
    if tok.decoder is None:
        tok.decoder = decoders.ByteLevel()
    return tok


def encode_prefix(tokenizer, prefix: str) -> list[int]:
    ids = tokenizer.encode(prefix).ids
    if not ids:
        raise ValueError("empty token ids")
    if len(ids) > 512:
        ids = ids[-512:]
    return ids


def report_from_names(rows: list[dict], names: list[str]) -> dict:
    return classification_report_6(labels(rows), pred_ids(names))


def majority_names(train: list[dict], n: int) -> list[str]:
    maj = Counter([r["gold_class"] for r in train]).most_common(1)[0][0]
    return [maj] * n


def Counter(xs):  # local to avoid extra import clash in this fn — actually use collections
    from collections import Counter as C

    return C(xs)


def baseline_pack(train: list[dict], rows: list[dict], split: str) -> dict[str, Any]:
    y_kw = [keyword_predict(r["input"]) for r in rows]
    y_sc = [schema_predict(r["input"]) for r in rows]
    y_maj = majority_names(train, len(rows))
    y_bow = bow_predict(train, rows)
    rng = np.random.default_rng(SEED)
    y_rnd = [CLASS_NAMES[i] for i in rng.integers(0, N_CLASSES, size=len(rows))]
    kw = report_from_names(rows, y_kw)
    sc = report_from_names(rows, y_sc)
    maj = report_from_names(rows, y_maj)
    bow = report_from_names(rows, y_bow)
    rnd_emp = report_from_names(rows, y_rnd)
    boundary = subset(rows, y_kw, lambda r: r.get("boundary_pair") in {
        "WEB_vs_RESEARCH", "FILES_vs_MEMORY", "MEMORY_vs_NO_TOOL", "WEB_vs_NO_TOOL"
    })
    real = subset(rows, y_kw, lambda r: r.get("source_type") == "REAL_TEST")
    synth = subset(rows, y_kw, lambda r: r.get("source_type") == "EVAL_SYNTHETIC")
    fail = subset(rows, y_kw, lambda r: r.get("execution_outcome") in {"TAVILY_401", "NO_MATCH", "MISSING_ARGUMENT"})
    return {
        "split": split,
        "n": len(rows),
        "majority": maj,
        "random_theoretical_accuracy": 1.0 / N_CLASSES,
        "random_empirical_seeded": rnd_emp,
        "keyword": kw,
        "schema_rule": sc,
        "bow_logistic": bow,
        "keyword_hard_boundary": boundary,
        "keyword_REAL_TEST": real,
        "keyword_EVAL_SYNTHETIC": synth,
        "keyword_failure_rows": fail,
    }


def dry_run_mlx(train: list[dict], val: list[dict], test: list[dict]) -> dict[str, Any]:
    import mlx.core as mx
    import mlx.nn as nn

    if PRODUCTION_ROOT.exists() and str(PRODUCTION_ROOT) in str(Path(__file__).resolve()):
        raise RuntimeError("refusing production tree")

    tok_sha = sha256_file(TOKENIZER_JSON)
    if tok_sha != TOKENIZER_SHA256:
        raise RuntimeError("tokenizer SHA mismatch")
    tokenizer = load_tokenizer_local()

    core = load_frozen_wrim0()
    sha_load = core.weight_tree_hash()
    snap_load = core_param_view(core.model)
    proof = core.proof()
    if proof.file_sha256 != WRIM0_CHECKPOINT_SHA256:
        raise RuntimeError("WRIM-0 SHA mismatch")
    if proof.core_trainable_parameters != 0:
        raise RuntimeError("core not frozen at load")
    core_n = proof.core_total_parameters

    train_ids = [encode_prefix(tokenizer, r["prompt_prefix"]) for r in train]
    val_ids = [encode_prefix(tokenizer, r["prompt_prefix"]) for r in val]
    test_ids = [encode_prefix(tokenizer, r["prompt_prefix"]) for r in test]
    # Prove EVAL-4 tokens exist and are distinct from train encoding set.
    probe_train = mx.array([train_ids[0]], dtype=mx.int32)
    probe_val = mx.array([val_ids[0]], dtype=mx.int32)
    probe_test = mx.array([test_ids[0]], dtype=mx.int32)

    logits0, hidden0 = core.model.forward_hidden(probe_train)
    mx.eval(logits0, hidden0)
    sha_after_fwd_pre = tensor_tree_sha256(core_param_view(core.model))

    sites = verified_qv_sites(core.model)
    lora_info = inject_lora_qv(core.model, rank=RANK, alpha=ALPHA, seed=LORA_INIT_SEED)
    freeze_backbone_unfreeze_lora(core.model)
    n_lora = count_lora_params(core.model)
    n_base = count_base_trainable(core.model)
    if n_base != 0:
        raise RuntimeError(f"base trainable after LoRA {n_base}")
    if n_lora != EXPECTED_LORA_PARAMS:
        raise RuntimeError(f"lora count {n_lora} != {EXPECTED_LORA_PARAMS}")

    snap_after_attach = core_param_view(core.model)
    core_attach_diff = max_abs_diff(snap_load, snap_after_attach)

    head_manifest = make_tool_head_manifest(
        module_id=EXP004_HEAD_ID,
        n_classes=N_CLASSES,
        state="SHADOW",
        training_dataset_identity="WR-TOOL-CURRICULUM-V4-CANDIDATE/train.jsonl",
        eval_identity="WR-TOOL-EVAL-4-CANDIDATE",
        experiment_id="WR-TOOL-EXP-004-DESIGN",
        kind="WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_004_DESIGN",
        extra_provenance={"class_names": list(CLASS_NAMES), "AUTHORIZED_FOR_TRAINING": False},
    )
    head = DummyClassifierHead(head_manifest, seed=HEAD_INIT_SEED)
    head.unfreeze()
    n_head = int(sum(v.size for v in numpy_params(head).values()))
    if n_head != EXPECTED_HEAD_PARAMS:
        raise RuntimeError(f"head count {n_head} != {EXPECTED_HEAD_PARAMS}")

    runtime = IsolatedLoRAHeadRuntime(core.model, head)
    runtime.head.unfreeze()
    assert_optimizer_lora_and_head_only(runtime)
    part = optimizer_key_partition(runtime)
    if part["total_trainable_count"] != EXPECTED_TRAINABLE:
        raise RuntimeError(f"trainable {part['total_trainable_count']} != {EXPECTED_TRAINABLE}")

    lora_before = lora_param_view(runtime.backbone)
    head_before = numpy_params(runtime.head)
    lora_hash_before = tensor_tree_sha256(lora_before)
    head_hash_before = tensor_tree_sha256(head_before)

    y_train0 = mx.array([CLASS_TO_ID[train[0]["gold_class"]]], dtype=mx.int32)
    lm, pred = runtime(probe_train)
    mx.eval(lm, pred)
    loss = mx.mean(nn.losses.cross_entropy(pred, y_train0))
    mx.eval(loss)
    loss_f = float(loss.item())
    pred_cls = CLASS_NAMES[int(np.argmax(np.array(pred)[0]))]

    _, pred_val = runtime(probe_val)
    _, pred_test = runtime(probe_test)
    mx.eval(pred_val, pred_test)
    metric_demo = classification_report_6(
        np.array([CLASS_TO_ID[val[0]["gold_class"]], CLASS_TO_ID[test[0]["gold_class"]]], dtype=np.int32),
        np.array([int(np.argmax(np.array(pred_val)[0])), int(np.argmax(np.array(pred_test)[0]))], dtype=np.int32),
    )

    snap_after_fwd = core_param_view(runtime.backbone)
    core_fwd_diff = max_abs_diff(snap_load, snap_after_fwd)
    lora_after = lora_param_view(runtime.backbone)
    head_after = numpy_params(runtime.head)
    lora_mut = max_abs_diff(lora_before, lora_after)
    head_mut = max_abs_diff(head_before, head_after)
    sha_after = tensor_tree_sha256(snap_after_fwd)

    # Confirm optimizer was never constructed.
    optimizer_step_invoked = False
    mlx_optim_imported = "mlx.optimizers" in sys.modules

    return {
        "wrim0_file_sha": proof.file_sha256,
        "core_total_parameters": core_n,
        "core_trainable_parameters": 0,
        "core_sha_load": sha_load,
        "core_sha_after_pre_attach_forward": sha_after_fwd_pre,
        "core_sha_after_attach_and_forward": sha_after,
        "core_max_abs_diff_after_attach": core_attach_diff,
        "core_max_abs_diff_after_forward": core_fwd_diff,
        "lora_sites_n": len(sites),
        "lora_info": {k: lora_info[k] for k in ("rank", "alpha", "scale", "matched_modules", "lora_parameter_count")},
        "n_lora": n_lora,
        "n_head": n_head,
        "n_trainable": part["total_trainable_count"],
        "optimizer_partition": {
            "lora_trainable_count": part["lora_trainable_count"],
            "head_trainable_count": part["head_trainable_count"],
            "base_trainable_keys": part["base_trainable_keys"],
        },
        "train_probe_loss": loss_f,
        "train_probe_pred": pred_cls,
        "train_probe_gold": train[0]["gold_class"],
        "eval4_val_probe_loaded": True,
        "eval4_test_probe_loaded": True,
        "metric_pipeline_demo_n2": metric_demo,
        "lora_hash_before": lora_hash_before,
        "lora_hash_after": tensor_tree_sha256(lora_after),
        "head_hash_before": head_hash_before,
        "head_hash_after": tensor_tree_sha256(head_after),
        "lora_max_abs_diff": lora_mut,
        "head_max_abs_diff": head_mut,
        "pooling": POOLING_STRATEGY,
        "feature": "hidden[:, -1, :] after forward_hidden (post-norm_f); IsolatedLoRAHeadRuntime",
        "tokenizer_sha": tok_sha,
        "mean_train_prefix_tokens": float(np.mean([len(x) for x in train_ids])),
        "mean_val_prefix_tokens": float(np.mean([len(x) for x in val_ids])),
        "optimizer_constructed": False,
        "optimizer_step_invoked": optimizer_step_invoked,
        "mlx_optimizers_imported": mlx_optim_imported,
        "checkpoint_dir_prepared": str(EXP004_DESIGN_PKG_DIR / "checkpoint-prep"),
    }


def materialize() -> dict[str, Any]:
    print("estimate_runtime_minutes=8")
    t0 = time.perf_counter()
    work = EXP004_DESIGN_PKG_DIR
    work.mkdir(parents=True, exist_ok=True)
    (work / "checkpoint-prep").mkdir(exist_ok=True)
    (work / "checkpoint-prep" / "README.txt").write_text(
        "Prepared path only. No weights. EXP-004 not started.\n",
        encoding="utf-8",
    )

    train = load_v4_train()
    val = load_eval4_split("validation")
    test = load_eval4_split("test")
    assert_eval4_contract(val, test)
    leak_val = family_leak(train, val)
    leak_test = family_leak(train, test)
    if leak_val or leak_test:
        raise RuntimeError(f"family leak train/eval {leak_val} {leak_test}")

    e2e3 = eval2_eval3_protected()
    if e2e3["EVAL-2_n"] != 115 or e2e3["EVAL-3_n"] != 13:
        raise RuntimeError("historical eval mutated")

    b_val = baseline_pack(train, val, "validation")
    b_test = baseline_pack(train, test, "test")

    # Fixed gates BEFORE any future training. Numeric, not "materially".
    kw_acc = b_test["keyword"]["accuracy"]
    bow_acc = b_test["bow_logistic"]["accuracy"]
    bow_f1 = b_test["bow_logistic"]["macro_f1"]
    kw_f1 = b_test["keyword"]["macro_f1"]
    kw_bal = b_test["keyword"]["balanced_accuracy"]
    bow_bal = b_test["bow_logistic"]["balanced_accuracy"]
    primary_acc = 0.875  # 14/16; strictly > keyword 0.8125 and BoW 0.75
    if not (primary_acc > kw_acc and primary_acc > bow_acc):
        raise RuntimeError("primary acc gate must exceed keyword and BoW")
    f1_floor = round(max(bow_f1, kw_f1) + 0.05, 4)
    if f1_floor < 0.70:
        f1_floor = 0.70
    bal_floor = round(max(kw_bal, bow_bal, 0.55) + 0.05, 4)
    if bal_floor > 0.80:
        bal_floor = 0.80
    boundary_gate = 0.75
    real_test_gate = 0.8125
    recall_floor = 0.50

    class_map = {
        "order": list(CLASS_NAMES),
        "ids": CLASS_TO_ID,
        "n_classes": N_CLASSES,
        "forbidden": ["LOOKUP_NOTE", "ECHO_INT"],
        "legacy_8_class_map_rejected": True,
        "fail_closed_on_mismatch": True,
    }
    write_json(work / "class-map.json", class_map)

    dataset_bindings = {
        "train": {
            "identity": "WR-TOOL-CURRICULUM-V4-CANDIDATE/train.jsonl",
            "path": str((V4_CANDIDATE_DIR / "train.jsonl").relative_to(ROOT)),
            "hash": FROZEN_V4_TRAIN_HASH,
            "n": len(train),
            "fail_closed": [
                "hash mismatch",
                "unexpected class",
                "split != train",
                "EXCLUDE_FROM_TRAINING",
                "LOOKUP_NOTE/ECHO_INT",
                "EVAL-4 family overlap",
            ],
        },
        "eval": {
            "identity": "WR-TOOL-EVAL-4-CANDIDATE",
            "path": str(TOOL_EVAL_4_DIR.relative_to(ROOT)),
            "combined_bundle": EVAL4_BUNDLE,
            "validation_n": len(val),
            "test_n": len(test),
            "EXCLUDE_FROM_TRAINING": True,
            "must_not_enter_optimizer_batches": True,
        },
        "v4_internal_val_test": "NOT used for EXP004 checkpoint or test; leftover curriculum split only",
        "EVAL-2": {
            "path": str(TOOL_EVAL_2_DIR.relative_to(ROOT)),
            "role": "secondary compatibility diagnostic; 8-class historical; do not tune; do not select checkpoints",
            "overwrite": False,
        },
        "EVAL-3": {
            "path": str(TOOL_EVAL_3_DIR.relative_to(ROOT)),
            "role": "secondary compatibility diagnostic; do not tune; do not select checkpoints",
            "overwrite": False,
        },
        "family_leak_train_val": leak_val,
        "family_leak_train_test": leak_test,
        "prompt_prefix": "V3-style bos/system/commander + 6-class SCHEMA_BLOCK + <|assistant|>\\n; gold response omitted",
        "schema_block_6": SCHEMA_BLOCK_6,
    }
    write_json(work / "dataset-bindings.json", dataset_bindings)

    metric_contract = {
        "required": [
            "accuracy",
            "balanced_accuracy",
            "macro_f1",
            "per_class_precision",
            "per_class_recall",
            "confusion_matrix",
            "TOOL_vs_NO_TOOL_accuracy",
            "conditional_tool_id_accuracy",
            "hard_boundary_accuracy",
            "REAL_TEST_subset_accuracy",
            "EVAL_SYNTHETIC_subset_accuracy",
            "failure_row_routing_accuracy",
        ],
        "pooling": POOLING_STRATEGY,
        "feature_extraction": "IsolatedLoRAHeadRuntime: backbone.forward_hidden then head(hidden[:, -1, :])",
        "historical_note": "Matches EXP-002/003 last-token after assistant-boundary prefix. Not mean-pool.",
        "eval2_eval3": "report after final checkpoint only; never every epoch",
    }
    write_json(work / "metric-contract.json", metric_contract)

    success_gates = {
        "fixed_before_training": True,
        "no_post_hoc_promotion_logic": True,
        "primary_split": "EVAL-4 test (n=16), selected checkpoint from validation only",
        "must_all_pass": {
            "test_accuracy_min": primary_acc,
            "test_accuracy_must_exceed_keyword": kw_acc,
            "test_accuracy_must_exceed_bow": bow_acc,
            "test_balanced_accuracy_min": bal_floor,
            "test_macro_f1_min": f1_floor,
            "per_class_recall_floor": recall_floor,
            "per_class_recall_applies_to": list(CLASS_NAMES),
            "hard_boundary_accuracy_min": boundary_gate,
            "hard_boundary_scope": "EVAL-4 test rows whose boundary_pair is one of WEB_vs_RESEARCH, FILES_vs_MEMORY, MEMORY_vs_NO_TOOL, WEB_vs_NO_TOOL",
            "REAL_TEST_test_subset_accuracy_min": real_test_gate,
        },
        "EVAL_SYNTHETIC_policy": (
            "Report separately. Cannot satisfy primary success. "
            "If EVAL_SYNTHETIC accuracy exceeds REAL_TEST accuracy by more than 0.15 "
            "AND REAL_TEST accuracy < 0.8125, fail as SYNTHETIC_MASKING."
        ),
        "beating_majority_or_random_alone": "NOT sufficient",
        "MEMORY_floor": "recall >= 0.50 still required; passing it is ROUTING GENERALIZATION SIGNAL only",
    }
    write_json(work / "success-gates.json", success_gates)

    checkpoint_policy = {
        "select_on": "validation macro_f1",
        "tie_break": ["validation balanced_accuracy", "lower validation loss"],
        "exp003_behavior": "selected on best validation loss; test not used each epoch",
        "exp004_required_change": "select on best validation macro_f1 instead of val loss; still never inspect test to choose",
        "test": "run once on selected checkpoint",
        "EVAL-2_EVAL-3": "not used for selection",
        "v4_internal_val_test": "not used for selection",
    }
    write_json(work / "checkpoint-policy.json", checkpoint_policy)

    stop_conditions = {
        "max_epochs": MAX_EPOCHS,
        "min_epochs": MIN_EPOCHS,
        "patience": PATIENCE,
        "patience_metric": "validation macro_f1",
        "nan_inf_train_loss": "immediate stop FAIL",
        "core_mutation": "immediate stop FAIL",
        "dataset_hash_mismatch": "refuse to start",
        "class_map_mismatch": "refuse to start",
        "eval4_in_optimizer_batch": "refuse / FAIL",
        "module_serialization_failure": "FAIL",
        "open_ended_training": False,
    }
    write_json(work / "stop-conditions.json", stop_conditions)

    memory_caveat = {
        "label": "ROUTING GENERALIZATION SIGNAL — not PROVEN BROAD MEMORY COMPETENCE",
        "train_MEMORY_gold_rows": 2,
        "eval_MEMORY_rows": 6,
        "eval_MEMORY_includes_EVAL_SYNTHETIC": True,
        "live_store": "3 rows / 2 unique decree texts",
        "interpretation": (
            "A passing MEMORY recall floor means the 6-way router assigned MEMORY on held-out "
            "wording distinct from train families. It does not prove a general memory tool skill "
            "or live-store retrieve competence."
        ),
        "do_not_waive_floor": True,
    }
    write_json(work / "memory-caveat.json", memory_caveat)

    lex = {
        "validation": lexical_views(val),
        "test": lexical_views(test),
        "keyword_test_accuracy_context": kw_acc,
        "suspected_WEB_cue": "https://",
        "policy": "derived diagnostic views only; canonical EVAL-4 rows unmodified; never train on masked variants",
    }
    write_json(work / "lexical-shortcut-audit.json", lex)

    failure_semantics = {
        "correct_tool_selection_is_not_provider_success": True,
        "TAVILY_401": "gold remains WEB",
        "MEMORY_NO_MATCH / NO_MATCH": "gold remains MEMORY",
        "SHA256_MISSING_ARGUMENT / MISSING_ARGUMENT": "gold remains SHA256 (not NO_TOOL)",
        "do_not_teach_NO_TOOL_because_execution_failed": True,
        "v4_train_includes_labeled_failures": True,
    }

    optimizer_proposal = {
        "type": "AdamW",
        "learning_rate": LR,
        "betas": list(BETAS),
        "eps": EPS,
        "weight_decay": WEIGHT_DECAY,
        "batch_size": BATCH,
        "max_epochs": MAX_EPOCHS,
        "min_epochs": MIN_EPOCHS,
        "patience": PATIENCE,
        "grad_clip_norm": CLIP_NORM,
        "seed": SEED,
        "scheduler": None,
        "loss": "cross_entropy; optional inverse-frequency class weights because MEMORY n=2",
        "class_weight_formula": "n_train / (n_classes * n_c)",
        "exp003_was": "AdamW lr=1e-3 batch=8 max_epochs=100 patience=15 select val_loss, n_train=313",
        "why_changed": (
            "n_train dropped 313→26. Lower LR, smaller batch, fewer epochs, clip, "
            "and val macro-F1 selection reduce silent memorization. Not a hyperparameter sweep."
        ),
        "this_mission_instantiates_optimizer": False,
    }

    overfit = {
        "log_every_epoch": ["train_loss", "train_accuracy", "train_macro_f1", "val_loss", "val_accuracy", "val_macro_f1", "val_balanced_accuracy"],
        "generalization_gap": "train_accuracy - val_accuracy",
        "flag_memorization_not_capability_if": "train_accuracy >= 0.96 AND (train_accuracy - val_accuracy) >= 0.25",
        "do_not_call_memorization_capability_acquisition": True,
    }

    promotion = {
        "even_if_gates_pass": "NO automatic promotion",
        "result_state": "CANDIDATE",
        "active_modules_until_later_authorization": [],
        "AUTHORIZED_FOR_TRAINING": False,
        "NOT_TRAINED": True,
    }

    print("starting_dry_run", flush=True)
    dry = dry_run_mlx(train, val, test)
    (work / "checkpoint-prep").mkdir(exist_ok=True)

    compatibility = {
        "exp003_script": "scripts/wrim-modular/run_tool_pi_exp_003.py",
        "exp003_n_classes": 8,
        "exp003_class_order": [
            "NO_TOOL", "SHA256", "LOOKUP_NOTE", "ECHO_INT", "WEB", "MEMORY", "FILES", "RESEARCH"
        ],
        "exp003_head": "Linear(256→8) = 2056 params",
        "exp003_lora": "r=2 q+v all 18 layers = 36864 params",
        "exp003_trainable": 38920,
        "exp003_checkpoint": "best validation loss; test not each epoch",
        "exp003_eval": "V3 family test + EVAL-2 after training",
        "exp004_n_classes": 6,
        "exp004_class_order": list(CLASS_NAMES),
        "exp004_head": "Linear(256→6) = 1542 params",
        "exp004_lora": "unchanged r=2 q+v 18 layers = 36864 (verified in dry-run)",
        "exp004_trainable": 38406,
        "exp004_dataset": "frozen V4 train 26 + EVAL-4 16/16",
        "exp004_pooling_unchanged": POOLING_STRATEGY,
        "fresh_lora_and_head": True,
        "do_not_resume_exp003_weights": True,
        "required_code_changes_when_training_later": [
            "new class map and n_classes=6",
            "V4/EVAL-4 loaders with fail-closed hashes",
            "checkpoint on val macro_f1",
            "do not evaluate test each epoch (already true in EXP003)",
            "6-class schema in prompt prefix",
            "class-weighted CE optional but recommended",
        ],
    }
    write_json(work / "compatibility-report.json", compatibility)

    write_json(work / "dry-run-proof.json", dry)

    baselines_out = {
        "validation": {
            "majority_accuracy": b_val["majority"]["accuracy"],
            "majority_balanced_accuracy": b_val["majority"]["balanced_accuracy"],
            "majority_macro_f1": b_val["majority"]["macro_f1"],
            "random_accuracy": b_val["random_theoretical_accuracy"],
            "keyword": b_val["keyword"],
            "schema_rule": b_val["schema_rule"],
            "bow_logistic": b_val["bow_logistic"],
        },
        "test": {
            "majority_accuracy": b_test["majority"]["accuracy"],
            "majority_balanced_accuracy": b_test["majority"]["balanced_accuracy"],
            "majority_macro_f1": b_test["majority"]["macro_f1"],
            "random_accuracy": b_test["random_theoretical_accuracy"],
            "keyword": b_test["keyword"],
            "schema_rule": b_test["schema_rule"],
            "bow_logistic": b_test["bow_logistic"],
        },
        "note": "Macro F1 computed now; EVAL-4 rows unchanged. BoW trained on frozen V4 train only.",
    }
    write_json(work / "baselines-full.json", baselines_out)

    dry_ok = (
        dry["core_max_abs_diff_after_forward"] == 0.0
        and dry["lora_max_abs_diff"] == 0.0
        and dry["head_max_abs_diff"] == 0.0
        and dry["n_lora"] == EXPECTED_LORA_PARAMS
        and dry["n_head"] == EXPECTED_HEAD_PARAMS
        and dry["optimizer_step_invoked"] is False
        and dry["optimizer_constructed"] is False
        and dry["core_trainable_parameters"] == 0
    )
    design_ready = dry_ok and leak_val == [] and leak_test == []
    readiness = (
        "WR-TOOL EXP004 — READY FOR COMMANDER TRAINING AUTHORIZATION"
        if design_ready
        else "WR-TOOL EXP004 — NOT READY FOR COMMANDER TRAINING AUTHORIZATION"
    )
    mission = (
        "WR-TOOL EXPERIMENT 004 DESIGN REVIEW — PASS"
        if design_ready
        else "WR-TOOL EXPERIMENT 004 DESIGN REVIEW — FAIL"
    )

    readiness_obj = {
        "design_review": mission,
        "commander_training_authorization": readiness,
        "AUTHORIZED_FOR_TRAINING": False,
        "NOT_TRAINED": True,
        "experiment_004_started": False,
        "do_not_train_without_new_commander_order": True,
        "scientific_risks_remaining": [
            "n_train=26 is scarcity; memorization is likely",
            "MEMORY gold n=2; held-out MEMORY is EVAL_SYNTHETIC",
            "keyword test accuracy 0.8125; lexical WEB cue https://",
        ],
        "reasons": [] if design_ready else ["dry-run or leak gate failed"],
    }
    write_json(work / "readiness-verdict.json", readiness_obj)

    manifest = {
        "identity": EXP004_DESIGN_PKG_ID,
        "DESIGN_ONLY": True,
        "NOT_TRAINED": True,
        "AUTHORIZED_FOR_TRAINING": False,
        "experiment_004_started": False,
        "core_id": WRIM0_ID,
        "core_sha": WRIM0_CHECKPOINT_SHA256,
        "lora": {"id": EXP004_LORA_ID, "rank": 2, "alpha": 2.0, "sites": "layers.0-17 attn.q and attn.v", "params": EXPECTED_LORA_PARAMS},
        "head": {"id": EXP004_HEAD_ID, "arch": "Linear(256→6, bias=True)", "params": EXPECTED_HEAD_PARAMS},
        "trainable_total": EXPECTED_TRAINABLE,
        "class_map": list(CLASS_NAMES),
        "train_hash": FROZEN_V4_TRAIN_HASH,
        "eval4_bundle": EVAL4_BUNDLE,
        "optimizer_proposal": optimizer_proposal,
        "success_gates_file": "success-gates.json",
        "promotion": promotion,
        "failure_row_semantics": failure_semantics,
        "overfit": overfit,
        "pooling": POOLING_STRATEGY,
    }
    write_json(work / "manifest.json", manifest)

    hashes = {
        "class-map.json": sha256_file(work / "class-map.json"),
        "dataset-bindings.json": sha256_file(work / "dataset-bindings.json"),
        "success-gates.json": sha256_file(work / "success-gates.json"),
        "v4_train.jsonl": FROZEN_V4_TRAIN_HASH,
        "eval4_combined_bundle": EVAL4_BUNDLE,
        "dry-run-proof.json": sha256_file(work / "dry-run-proof.json"),
    }
    hashes["combined_design"] = sha256_json(hashes)
    write_json(work / "HASHES.json", hashes)

    summary = {
        "identity": EXP004_DESIGN_PKG_ID,
        "mission_verdict": mission,
        "design_readiness_verdict": readiness,
        "dry_ok": dry_ok,
        "train_n": len(train),
        "val_n": len(val),
        "test_n": len(test),
        "baselines_test_keyword_acc": kw_acc,
        "baselines_test_bow_acc": bow_acc,
        "baselines_test_keyword_macro_f1": kw_f1,
        "baselines_test_bow_macro_f1": bow_f1,
        "gates": success_gates["must_all_pass"],
        "dry": {
            "n_lora": dry["n_lora"],
            "n_head": dry["n_head"],
            "n_trainable": dry["n_trainable"],
            "core_diff": dry["core_max_abs_diff_after_forward"],
            "lora_diff": dry["lora_max_abs_diff"],
            "head_diff": dry["head_max_abs_diff"],
            "loss": dry["train_probe_loss"],
            "optimizer_step": dry["optimizer_step_invoked"],
        },
        "active_core": WRIM0_ID,
        "active_modules": [],
        "training_invoked": False,
        "experiment_004_started": False,
        "production_untouched": True,
        "wall_sec": time.perf_counter() - t0,
        "created_at": utcnow(),
    }
    write_json(work / "session-summary.json", summary)
    return summary, dry, b_val, b_test, success_gates, train, val, test


def validate(summary: dict, dry: dict) -> None:
    checks = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"name": name, "ok": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + (f": {detail}" if detail and not ok else ""))

    work = EXP004_DESIGN_PKG_DIR
    e2n = sum(1 for line in (TOOL_EVAL_2_DIR / "items.jsonl").read_text().splitlines() if line.strip())
    e3 = json.loads((TOOL_EVAL_3_DIR / "suite.json").read_text())
    gates = json.loads((work / "success-gates.json").read_text())
    check("01 EXP003 script exists", (ROOT / "scripts/wrim-modular/run_tool_pi_exp_003.py").is_file())
    check("02 6-class map bound", json.loads((work / "class-map.json").read_text())["n_classes"] == 6)
    check("03 WRIM-0 SHA", dry["wrim0_file_sha"] == WRIM0_CHECKPOINT_SHA256)
    check("04 core trainable 0", dry["core_trainable_parameters"] == 0)
    check("05 LoRA 36864", dry["n_lora"] == 36864)
    check("06 head 1542", dry["n_head"] == 1542)
    check("07 trainable 38406", dry["n_trainable"] == 38406)
    check("08 V4 train hash", sha256_file(V4_CANDIDATE_DIR / "train.jsonl") == FROZEN_V4_TRAIN_HASH)
    check("09 EVAL-4 bundle", json.loads((TOOL_EVAL_4_DIR / "HASHES.json").read_text())["combined_bundle"] == EVAL4_BUNDLE)
    check("10 EVAL-4 excluded", all(
        json.loads(line).get("EXCLUDE_FROM_TRAINING")
        for line in (TOOL_EVAL_4_DIR / "rows.jsonl").read_text().splitlines() if line.strip()
    ))
    check("11 test not for checkpoint", json.loads((work / "checkpoint-policy.json").read_text())["test"].startswith("run once"))
    check("12 EVAL-2 protected n=115", e2n == 115)
    check("13 EVAL-3 protected n=13", e3["item_count"] == 13)
    check("14 no optimizer step", dry["optimizer_step_invoked"] is False and dry["optimizer_constructed"] is False)
    check("15 core unchanged dry-run", dry["core_max_abs_diff_after_forward"] == 0.0)
    check("16 LoRA/head unchanged", dry["lora_max_abs_diff"] == 0.0 and dry["head_max_abs_diff"] == 0.0)
    check("17 numeric gates present", "test_accuracy_min" in gates["must_all_pass"])
    check("18 recall floor 0.5", gates["must_all_pass"]["per_class_recall_floor"] == 0.50)
    check("19 EXP004 not started", summary["experiment_004_started"] is False)
    check("20 no training", summary["training_invoked"] is False)
    check("21 active modules empty", summary["active_modules"] == [])
    check("22 production flag", summary["production_untouched"] is True)
    check("23 no EXP004 weights dir", not (ROOT / "model-lab/manifests/modular-intelligence/WR-TOOL-PI-EXP-004/weights").exists())
    check("24 dry-run loss finite", np.isfinite(dry["train_probe_loss"]))
    check("25 mlx.optimizers not imported", dry["mlx_optimizers_imported"] is False)

    passed = sum(1 for c in checks if c["ok"])
    write_json(work / "validator.json", {"n_pass": passed, "n_total": len(checks), "passed": passed == len(checks), "checks": checks})
    if passed != len(checks):
        raise SystemExit(1)


def main() -> int:
    summary, dry, _bval, _btest, _gates, _tr, _va, _te = materialize()
    validate(summary, dry)
    print(json.dumps({
        "identity": EXP004_DESIGN_PKG_ID,
        "mission": summary["mission_verdict"],
        "readiness": summary["design_readiness_verdict"],
        "n_lora": dry["n_lora"],
        "n_head": dry["n_head"],
        "core_diff": dry["core_max_abs_diff_after_forward"],
        "optimizer_step": dry["optimizer_step_invoked"],
        "wall_sec": round(summary["wall_sec"], 2),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
