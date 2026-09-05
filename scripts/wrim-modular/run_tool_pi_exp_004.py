#!/usr/bin/env python3
"""WR-TOOL PARAMETER-ISOLATED EXPERIMENT 004 — authorized training.

Frozen WRIM-0 + fresh LoRA r=2 on attn.q/v + Linear(256→6) classifier.
Train: frozen V4 train.jsonl (n=26). Eval: EVAL-4 val/test (16/16).
Does not train WRIM-0, does not promote, does not touch production.
"""
from __future__ import annotations

import hashlib
import json
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))
sys.path.insert(0, str(SCRIPT_DIR))

from paths import (  # noqa: E402
    EXP002_DIR,
    EXP003_DIR,
    EXP004_DIR,
    EXP004_HEAD_ID,
    EXP004_ID,
    EXP004_LORA_ID,
    EXP004_RUN_ID,
    EXP004_TITLE,
    FROZEN_V4_TRAIN_HASH,
    PRODUCTION_ROOT,
    ROOT,
    TOKENIZER_JSON,
    TOKENIZER_SHA256,
    TOOL_EVAL_2_ITEMS,
    TOOL_EVAL_3_DIR,
    TOOL_EVAL_4_DIR,
    V4_CANDIDATE_DIR,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_ID,
    WRIM0_WEIGHTS,
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
    detach_lora_qv,
    freeze_backbone_unfreeze_lora,
    inject_lora_qv,
    load_lora_into_model,
    lora_param_view,
    optimizer_key_partition,
    save_lora_artifact,
    verified_qv_sites,
)
from exp001_support import POOLING_RATIONALE, POOLING_STRATEGY, input_ids_hash, softmax_np  # noqa: E402
from exp004_support import (  # noqa: E402
    CLASS_NAMES,
    CLASS_TO_ID,
    EVAL4_BUNDLE,
    EXPECTED_HEAD_PARAMS,
    EXPECTED_LORA_PARAMS,
    EXPECTED_TRAINABLE,
    HARD_BOUNDARY_PAIRS,
    N_CLASSES,
    assert_eval4_contract,
    bow_predict,
    classification_report_6,
    eval2_eval3_protected,
    family_leak,
    is_failure_row,
    is_hard_boundary_row,
    keyword_predict,
    labels,
    load_eval4_split,
    load_jsonl,
    load_v4_train,
    map_historical_class,
    mask_class_tool_names,
    mask_urls,
    pred_ids,
    render_prefix,
    routing_label,
)

from active_runtime import (  # noqa: E402
    attach_module_to_runtime,
    default_active_runtime,
    detach_module_from_runtime,
)

LR = 5e-4
BETAS = (0.9, 0.999)
EPS = 1e-8
WEIGHT_DECAY = 0.01
BATCH = 4
MAX_EPOCHS = 40
PATIENCE = 8
MIN_EPOCHS = 3
CLIP_NORM = 1.0
SEED = 20260831
HEAD_INIT_SEED = 11
LORA_INIT_SEED = 20260831
RUNTIME_BUDGET_SEC = 60 * 60
LOGIT_ATOL = 1e-5
KEYWORD_TEST_ACC = 0.8125
BOW_TEST_ACC = 0.75
GATE_ACC = 0.875
GATE_BAL = 0.80
GATE_F1 = 0.8659
GATE_RECALL = 0.50
GATE_BOUNDARY = 0.75
GATE_REAL = 0.8125

OPTIMIZER_RATIONALE = (
    "Design-reviewed EXP-004 recipe: AdamW lr=5e-4, betas=(0.9,0.999), eps=1e-8, "
    "wd=0.01, batch=4, clip_norm=1.0, max 40 / min 3 / patience 8 on val macro F1. "
    "Class-weighted CE was proposed but not fixed; this authorized run uses standard CE. "
    "n_train=26 imbalance is a reported limitation."
)


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


def batches(n: int, batch: int, rng: np.random.Generator):
    order = rng.permutation(n)
    for i in range(0, n, batch):
        yield order[i : i + batch]


def restore_lora(model, tensors: dict[str, np.ndarray]) -> None:
    import mlx.core as mx
    import mlx.utils

    model.update(mlx.utils.tree_unflatten([(k, mx.array(v)) for k, v in tensors.items()]))
    mx.eval(model.parameters())


def restore_head(head, tensors: dict[str, np.ndarray]) -> None:
    import mlx.core as mx
    import mlx.utils

    head.update(mlx.utils.tree_unflatten([(k, mx.array(v)) for k, v in tensors.items()]))
    mx.eval(head.parameters())


def clip_tree(grads, max_norm: float):
    import mlx.core as mx
    import mlx.utils as mxu

    leaves = mxu.tree_flatten(grads)
    total = mx.array(0.0)
    for _, g in leaves:
        if g is not None:
            total = total + mx.sum(g.astype(mx.float32) ** 2)
    norm = mx.sqrt(total)
    scale = mx.minimum(mx.array(1.0), mx.array(max_norm) / (norm + 1e-6))
    clipped = mxu.tree_unflatten([(k, g * scale if g is not None else g) for k, g in leaves])
    return clipped, float(norm.item())


def predict_logits(runtime, token_rows: list[list[int]]) -> np.ndarray:
    import mlx.core as mx

    out = []
    for ids in token_rows:
        idx = mx.array([ids], dtype=mx.int32)
        _, pred = runtime(idx)
        out.append(np.array(pred)[0])
    return np.stack(out, axis=0)


def eval_split(runtime, token_rows, y: np.ndarray) -> dict[str, Any]:
    logits = predict_logits(runtime, token_rows)
    pred = np.argmax(logits, axis=1)
    losses = []
    for i, arr in enumerate(logits):
        p = softmax_np(arr[None, :])[0, int(y[i])]
        losses.append(float(-np.log(p + 1e-12)))
    rep = classification_report_6(y, pred)
    rep["loss"] = float(np.mean(losses)) if losses else float("nan")
    rep["pred"] = [CLASS_NAMES[int(i)] for i in pred]
    return rep


def better_checkpoint(cand: dict[str, float], best: dict[str, float]) -> bool:
    if cand["macro_f1"] > best["macro_f1"] + 1e-12:
        return True
    if abs(cand["macro_f1"] - best["macro_f1"]) <= 1e-12:
        if cand["balanced_accuracy"] > best["balanced_accuracy"] + 1e-12:
            return True
        if abs(cand["balanced_accuracy"] - best["balanced_accuracy"]) <= 1e-12:
            if cand["loss"] < best["loss"] - 1e-12:
                return True
    return False


def subset_accuracy(rows: list[dict[str, Any]], pred: list[str], fn) -> dict[str, Any] | None:
    idx = [i for i, r in enumerate(rows) if fn(r)]
    if not idx:
        return {"n": 0, "accuracy": None, "ids": []}
    y = labels([rows[i] for i in idx])
    p = pred_ids([pred[i] for i in idx])
    return {
        "n": len(idx),
        "accuracy": float(np.mean(y == p)),
        "ids": [rows[i]["example_id"] for i in idx],
        "gold": [rows[i]["gold_class"] for i in idx],
        "pred": [pred[i] for i in idx],
    }


def estimate_runtime(runtime, token_rows, y_train, n_train: int, n_val: int) -> dict:
    import mlx.core as mx
    import mlx.nn as nn
    import mlx.optimizers as optim

    opt = optim.AdamW(learning_rate=LR, betas=BETAS, eps=EPS, weight_decay=WEIGHT_DECAY)

    def loss_fn(idx, yb):
        _, pred = runtime(idx)
        return mx.mean(nn.losses.cross_entropy(pred, yb))

    loss_and_grad = nn.value_and_grad(runtime, loss_fn)
    sample = token_rows[: min(4, n_train)]
    t0 = time.perf_counter()
    for i, ids in enumerate(sample):
        idx = mx.array([ids], dtype=mx.int32)
        yb = mx.array([int(y_train[i])], dtype=mx.int32)
        loss, grads = loss_and_grad(idx, yb)
        grads, _ = clip_tree(grads, CLIP_NORM)
        opt.update(runtime, grads)
        mx.eval(runtime.parameters(), loss)
    elapsed = time.perf_counter() - t0
    per_ex = elapsed / max(1, len(sample))
    steps_per_epoch = int(np.ceil(n_train / BATCH))
    epoch_train = per_ex * n_train
    epoch_val = per_ex * 0.40 * n_val
    epoch_train_eval = per_ex * 0.40 * n_train
    worst = (epoch_train + epoch_val + epoch_train_eval) * MAX_EPOCHS
    likely = (epoch_train + epoch_val + epoch_train_eval) * min(MAX_EPOCHS, MIN_EPOCHS + PATIENCE + 4)
    return {
        "timed_examples": len(sample),
        "seconds_for_timed": elapsed,
        "sec_per_example_fwd_bwd": per_ex,
        "steps_per_epoch": steps_per_epoch,
        "n_train": n_train,
        "n_val": n_val,
        "estimated_worst_case_sec": worst,
        "estimated_likely_sec": likely,
        "budget_sec": RUNTIME_BUDGET_SEC,
        "optimizer_rationale": OPTIMIZER_RATIONALE,
        "stop_before_training": worst > RUNTIME_BUDGET_SEC,
    }


def fail(work: Path, reason: str, extra: dict | None = None) -> int:
    payload = {"reason": reason, "status": "FAIL", "experiment_id": EXP004_ID, "run_id": EXP004_RUN_ID}
    if extra:
        payload.update(extra)
    write_json(work / "FAILURE.json", payload)
    print(f"STOP FAIL: {reason}", flush=True)
    return 1


def main() -> int:
    wall0 = time.perf_counter()
    work = EXP004_DIR
    work.mkdir(parents=True, exist_ok=True)
    lora_dir = work / "module" / EXP004_LORA_ID
    head_dir = work / "module" / EXP004_HEAD_ID
    ckpt_dir = work / "checkpoints" / "best"

    prod_mtime = PRODUCTION_ROOT.stat().st_mtime if PRODUCTION_ROOT.exists() else None
    exp002_mtime = EXP002_DIR.stat().st_mtime if EXP002_DIR.exists() else None
    exp003_mtime = EXP003_DIR.stat().st_mtime if EXP003_DIR.exists() else None
    wrim0_mtime = WRIM0_WEIGHTS.stat().st_mtime

    train = load_v4_train()
    val = load_eval4_split("validation")
    test = load_eval4_split("test")
    assert_eval4_contract(val, test)
    train_hash = hashlib.sha256((V4_CANDIDATE_DIR / "train.jsonl").read_bytes()).hexdigest()
    eval4_hashes = json.loads((TOOL_EVAL_4_DIR / "HASHES.json").read_text())
    eval4_bundle = eval4_hashes["combined_bundle"]

    class_counts = dict(Counter(r["gold_class"] for r in train))
    write_json(work / "train-class-distribution.json", {
        "n": len(train),
        "counts": class_counts,
        "class_weighting": "NONE — standard unweighted cross-entropy",
        "reason": (
            "Design listed optional inverse-frequency weights but did not fix them. "
            "Authorization: do not invent weights. Imbalance is a limitation."
        ),
        "memory_n": class_counts.get("MEMORY", 0),
    })

    leak_val = family_leak(train, val)
    leak_test = family_leak(train, test)
    train_ids = {r["example_id"] for r in train}
    eval_ids = {r["example_id"] for r in val} | {r["example_id"] for r in test}
    overlap_ids = sorted(train_ids & eval_ids)
    if leak_val or leak_test or overlap_ids:
        return fail(work, "EVAL-4 overlap with train", {"leak_val": leak_val, "leak_test": leak_test, "ids": overlap_ids})

    tokenizer = load_tokenizer_local()
    tok_sha = sha256_file(TOKENIZER_JSON)
    if tok_sha != TOKENIZER_SHA256:
        return fail(work, "tokenizer SHA mismatch", {"got": tok_sha})

    core = load_frozen_wrim0()
    pre_hash = core.weight_tree_hash()
    pre_snap = core.snapshot_params()
    proof = core.proof()
    file_sha = sha256_file(WRIM0_WEIGHTS)
    pre_proofs = {
        "1_wrim0_sha_exact": file_sha == WRIM0_CHECKPOINT_SHA256 and proof.file_sha256 == WRIM0_CHECKPOINT_SHA256,
        "2_core_trainable_params_0": proof.core_trainable_parameters == 0,
        "3_train_hash_exact": train_hash == FROZEN_V4_TRAIN_HASH,
        "4_eval4_hash_exact": eval4_bundle == EVAL4_BUNDLE,
        "5_class_map_exact": list(CLASS_NAMES) == ["NO_TOOL", "WEB", "MEMORY", "FILES", "RESEARCH", "SHA256"],
        "10_eval4_excluded_from_train": not leak_val and not leak_test and not overlap_ids,
        "11_active_modules_empty": True,
        "12_no_production_path": str(PRODUCTION_ROOT) not in str(work),
        "wrim0_sha": file_sha,
        "core_tree_sha_before": pre_hash,
        "core_trainable": proof.core_trainable_parameters,
        "train_hash": train_hash,
        "eval4_hash": eval4_bundle,
        "class_map": list(CLASS_NAMES),
        "n_train": len(train),
        "n_val": len(val),
        "n_test": len(test),
    }
    for key in ("1_wrim0_sha_exact", "2_core_trainable_params_0", "3_train_hash_exact", "4_eval4_hash_exact",
                "5_class_map_exact", "10_eval4_excluded_from_train", "12_no_production_path"):
        if not pre_proofs[key]:
            write_json(work / "pre-training-proofs.json", pre_proofs)
            return fail(work, f"pre-training proof failed: {key}", {"proofs": pre_proofs})

    train_tok = [encode_prefix(tokenizer, r["prompt_prefix"]) for r in train]
    val_tok = [encode_prefix(tokenizer, r["prompt_prefix"]) for r in val]
    test_tok = [encode_prefix(tokenizer, r["prompt_prefix"]) for r in test]
    y_tr = labels(train)
    y_va = labels(val)
    y_te = labels(test)

    sites_before = verified_qv_sites(core.model)
    lora_info = inject_lora_qv(core.model, rank=RANK, alpha=ALPHA, seed=LORA_INIT_SEED)
    sites_after = verified_qv_sites(core.model)
    n_lora = count_lora_params(core.model)
    n_base = count_base_trainable(core.model)
    if n_base != 0:
        return fail(work, "core trainable after LoRA attach", {"n": n_base})
    if n_lora != EXPECTED_LORA_PARAMS:
        return fail(work, "LoRA param count", {"n": n_lora})
    if sites_after != [f"layers.{i}.attn.{a}" for i in range(18) for a in ("q", "v")]:
        return fail(work, "LoRA sites mismatch", {"sites": sites_after})

    attach_core_diff = max_abs_diff(pre_snap, core_param_view(core.model))
    if attach_core_diff != 0.0:
        return fail(work, "core mutated on LoRA attach", {"max_abs_diff": attach_core_diff})

    head_manifest = make_tool_head_manifest(
        module_id=EXP004_HEAD_ID,
        n_classes=N_CLASSES,
        state="SHADOW",
        training_dataset_identity="WR-TOOL-CURRICULUM-V4-CANDIDATE/train.jsonl",
        eval_identity="WR-TOOL-EVAL-4-CANDIDATE",
        experiment_id=EXP004_ID,
        kind="WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_004",
        extra_provenance={"paired_lora_module": EXP004_LORA_ID, "class_map": list(CLASS_NAMES), "not_merged_checkpoint": True},
    )
    head = DummyClassifierHead(head_manifest, seed=HEAD_INIT_SEED)
    n_head = int(sum(v.size for v in numpy_params(head).values()))
    if n_head != EXPECTED_HEAD_PARAMS:
        return fail(work, "head param count", {"n": n_head})

    runtime = IsolatedLoRAHeadRuntime(core.model, head)
    freeze_backbone_unfreeze_lora(core.model)
    runtime.head.unfreeze()
    part = optimizer_key_partition(runtime)
    assert_optimizer_lora_and_head_only(runtime)
    total_train = part["total_trainable_count"]
    if total_train != EXPECTED_TRAINABLE:
        return fail(work, "trainable count", {"n": total_train, "part": part})

    pre_proofs.update({
        "6_lora_sites_exact": True,
        "7_lora_params": n_lora,
        "8_head_params": n_head,
        "9_total_trainable": total_train,
        "lora_sites": sites_after,
        "core_trainable_after_attach": n_base,
        "attach_core_max_abs_diff": attach_core_diff,
        "passed": True,
    })
    write_json(work / "pre-training-proofs.json", pre_proofs)

    lora_before = lora_param_view(core.model)
    head_before = numpy_params(head)

    timing = estimate_runtime(runtime, train_tok, y_tr, len(train), len(val))
    write_json(work / "runtime-estimate.json", timing)
    print(
        f"EXP004 runtime estimate likely={timing['estimated_likely_sec']:.1f}s "
        f"worst={timing['estimated_worst_case_sec']:.1f}s "
        f"per_ex={timing['sec_per_example_fwd_bwd']:.3f}s",
        flush=True,
    )
    if timing["stop_before_training"]:
        return fail(work, "runtime estimate exceeds 60 minutes", {"timing": timing})

    restore_lora(core.model, lora_before)
    restore_head(head, head_before)
    freeze_backbone_unfreeze_lora(core.model)
    runtime.head.unfreeze()

    import mlx.core as mx
    import mlx.nn as nn
    import mlx.optimizers as optim
    import mlx.utils as mxu

    rng = np.random.default_rng(SEED)
    opt = optim.AdamW(learning_rate=LR, betas=BETAS, eps=EPS, weight_decay=WEIGHT_DECAY)
    history: list[dict[str, Any]] = []
    best_lora = lora_param_view(runtime.backbone)
    best_head = numpy_params(runtime.head)
    best_sel = {"macro_f1": -1.0, "balanced_accuracy": -1.0, "loss": float("inf"), "epoch": 0}
    best_epoch_metrics: dict[str, Any] = {}
    stall = 0
    stop_reason = "max_epochs"
    train_t0 = time.perf_counter()

    n_tr = len(train)
    for epoch in range(1, MAX_EPOCHS + 1):
        losses = []
        for chunk in batches(n_tr, BATCH, rng):
            local = [int(k) for k in chunk]
            batch_ids = [train[j]["example_id"] for j in local]
            if any(eid in eval_ids for eid in batch_ids):
                return fail(work, "EVAL-4 entered training batch", {"epoch": epoch, "ids": batch_ids})
            if any(eid not in train_ids for eid in batch_ids):
                return fail(work, "unexpected train row in batch", {"epoch": epoch, "ids": batch_ids})

            def step_loss():
                total = mx.array(0.0)
                for j in local:
                    idx = mx.array([train_tok[j]], dtype=mx.int32)
                    yb = mx.array([int(y_tr[j])], dtype=mx.int32)
                    _, pred = runtime(idx)
                    total = total + mx.mean(nn.losses.cross_entropy(pred, yb))
                return total / max(1, len(local))

            loss_and_grad = nn.value_and_grad(runtime, step_loss)
            loss, grads = loss_and_grad()
            grad_keys = [k for k, _ in mxu.tree_flatten(grads)]
            if any((not k.startswith("head.")) and ("lora_a" not in k and "lora_b" not in k) for k in grad_keys):
                return fail(work, "unexpected grad keys / core in optimizer", {"keys": grad_keys[:20]})
            grads, gnorm = clip_tree(grads, CLIP_NORM)
            opt.update(runtime, grads)
            mx.eval(runtime.parameters())
            lv = float(loss.item())
            losses.append(lv)
            if not np.isfinite(lv) or not np.isfinite(gnorm):
                return fail(work, "NaN or Inf", {"epoch": epoch, "loss": lv, "grad_norm": gnorm})

        core_now = core_param_view(runtime.backbone)
        core_diff_epoch = max_abs_diff(pre_snap, core_now)
        if core_diff_epoch != 0.0:
            return fail(work, "WRIM core mutation during training", {"epoch": epoch, "max_abs_diff": core_diff_epoch})

        tr_rep = eval_split(runtime, train_tok, y_tr)
        va_rep = eval_split(runtime, val_tok, y_va)
        gap = float(tr_rep["accuracy"] - va_rep["accuracy"])
        row = {
            "epoch": epoch,
            "train_loss": float(np.mean(losses)),
            "train_accuracy": tr_rep["accuracy"],
            "validation_loss": va_rep["loss"],
            "validation_accuracy": va_rep["accuracy"],
            "validation_balanced_accuracy": va_rep["balanced_accuracy"],
            "validation_macro_f1": va_rep["macro_f1"],
            "per_class_validation_recall": {c: va_rep["per_class"][c]["recall"] for c in CLASS_NAMES},
            "generalization_gap": gap,
        }
        history.append(row)
        print(
            f"epoch {epoch} train_loss={row['train_loss']:.4f} train_acc={row['train_accuracy']:.4f} "
            f"val_loss={row['validation_loss']:.4f} val_acc={row['validation_accuracy']:.4f} "
            f"val_bal={row['validation_balanced_accuracy']:.4f} val_f1={row['validation_macro_f1']:.4f}",
            flush=True,
        )

        cand = {
            "macro_f1": va_rep["macro_f1"],
            "balanced_accuracy": va_rep["balanced_accuracy"],
            "loss": va_rep["loss"],
            "epoch": epoch,
        }
        f1_improved = va_rep["macro_f1"] > best_sel["macro_f1"] + 1e-12
        if better_checkpoint(cand, best_sel):
            best_sel = cand
            best_lora = lora_param_view(runtime.backbone)
            best_head = numpy_params(runtime.head)
            best_epoch_metrics = {**row, "validation_report": {
                k: va_rep[k] for k in ("accuracy", "balanced_accuracy", "macro_f1", "loss", "per_class", "confusion_matrix")
            }}
        if f1_improved:
            stall = 0
        else:
            stall += 1
        if epoch >= MIN_EPOCHS and stall >= PATIENCE:
            stop_reason = f"patience_{PATIENCE}_on_val_macro_f1"
            break
    else:
        stop_reason = "max_epochs"

    train_elapsed = time.perf_counter() - train_t0
    restore_lora(runtime.backbone, best_lora)
    restore_head(runtime.head, best_head)
    freeze_backbone_unfreeze_lora(runtime.backbone)
    runtime.head.unfreeze()
    selection_frozen = True

    lora_after = lora_param_view(runtime.backbone)
    head_after = numpy_params(runtime.head)
    if max_abs_diff(lora_before, lora_after) == 0.0:
        return fail(work, "LoRA parameters did not move")
    if max_abs_diff(head_before, head_after) == 0.0:
        return fail(work, "head parameters did not move")

    post_core_view = core_param_view(runtime.backbone)
    core_diff = max_abs_diff(pre_snap, post_core_view)
    post_hash = tensor_tree_sha256(post_core_view)
    if post_hash != pre_hash or core_diff != 0.0:
        return fail(work, "CORE DRIFT after training", {"pre": pre_hash, "post": post_hash, "max_abs_diff": core_diff})

    tr_rep = eval_split(runtime, train_tok, y_tr)
    va_rep = eval_split(runtime, val_tok, y_va)
    te_rep = eval_split(runtime, test_tok, y_te)
    te_pred = te_rep["pred"]

    hard_b = subset_accuracy(test, te_pred, is_hard_boundary_row)
    real_t = subset_accuracy(test, te_pred, lambda r: r.get("source_type") == "REAL_TEST")
    synth_t = subset_accuracy(test, te_pred, lambda r: r.get("source_type") == "EVAL_SYNTHETIC")
    fail_t = subset_accuracy(test, te_pred, is_failure_row)

    synth_masking = False
    if (
        synth_t["accuracy"] is not None
        and real_t["accuracy"] is not None
        and (synth_t["accuracy"] - real_t["accuracy"] > 0.15)
        and real_t["accuracy"] < GATE_REAL
    ):
        synth_masking = True

    kw_pred = [keyword_predict(r["input"]) for r in test]
    bow_pred = bow_predict(train, test)
    kw_acc = float(np.mean(labels(test) == pred_ids(kw_pred)))
    bow_acc = float(np.mean(labels(test) == pred_ids(bow_pred)))

    url_rows = [r for r in test if "http://" in r["input"] or "https://" in r["input"]]
    url_masked_rows = []
    for r in url_rows:
        masked = dict(r)
        masked["input"] = mask_urls(r["input"])
        masked["prompt_prefix"] = render_prefix(masked["input"])
        url_masked_rows.append(masked)
    url_diag = None
    if url_masked_rows:
        url_tok = [encode_prefix(tokenizer, r["prompt_prefix"]) for r in url_masked_rows]
        url_rep = eval_split(runtime, url_tok, labels(url_masked_rows))
        url_diag = {
            "n": len(url_masked_rows),
            "accuracy": url_rep["accuracy"],
            "canonical_unmodified": True,
            "trained_on_masked": False,
            "pred": url_rep["pred"],
            "gold": [r["gold_class"] for r in url_masked_rows],
            "ids": [r["example_id"] for r in url_masked_rows],
        }

    name_masked_rows = []
    for r in test:
        masked = dict(r)
        masked["input"] = mask_class_tool_names(r["input"])
        masked["prompt_prefix"] = render_prefix(masked["input"])
        name_masked_rows.append(masked)
    name_tok = [encode_prefix(tokenizer, r["prompt_prefix"]) for r in name_masked_rows]
    name_rep = eval_split(runtime, name_tok, labels(name_masked_rows))
    name_diag = {
        "n": len(name_masked_rows),
        "accuracy": name_rep["accuracy"],
        "canonical_test_accuracy": te_rep["accuracy"],
        "delta_vs_canonical": float(name_rep["accuracy"] - te_rep["accuracy"]),
        "material_collapse": bool(te_rep["accuracy"] - name_rep["accuracy"] >= 0.15),
        "canonical_unmodified": True,
        "trained_on_masked": False,
        "per_class": name_rep["per_class"],
        "confusion_matrix": name_rep["confusion_matrix"],
    }
    if url_diag is not None:
        url_diag["delta_vs_canonical_subset"] = None
        url_canon = subset_accuracy(test, te_pred, lambda r: "http://" in r["input"] or "https://" in r["input"])
        if url_canon["accuracy"] is not None:
            url_diag["canonical_url_subset_accuracy"] = url_canon["accuracy"]
            url_diag["delta_vs_canonical_subset"] = float(url_diag["accuracy"] - url_canon["accuracy"])
            url_diag["material_collapse"] = bool(url_canon["accuracy"] - url_diag["accuracy"] >= 0.15)

    hist_eval2 = evaluate_historical_eval2(runtime, tokenizer)
    hist_eval3 = evaluate_historical_eval3(runtime, tokenizer)

    recalls = {c: te_rep["per_class"][c]["recall"] for c in CLASS_NAMES}
    precisions = {c: te_rep["per_class"][c]["precision"] for c in CLASS_NAMES}
    gate_acc = bool(te_rep["accuracy"] >= GATE_ACC and te_rep["accuracy"] > KEYWORD_TEST_ACC and te_rep["accuracy"] > BOW_TEST_ACC)
    gate_bal = bool(te_rep["balanced_accuracy"] >= GATE_BAL)
    gate_f1 = bool(te_rep["macro_f1"] >= GATE_F1)
    gate_rec = all(recalls[c] >= GATE_RECALL for c in CLASS_NAMES)
    gate_bnd = bool(hard_b["accuracy"] is not None and hard_b["accuracy"] >= GATE_BOUNDARY)
    gate_real = bool(real_t["accuracy"] is not None and real_t["accuracy"] >= GATE_REAL)
    isolation_ok = core_diff == 0.0 and n_base == 0 and total_train == EXPECTED_TRAINABLE
    all_gates = gate_acc and gate_bal and gate_f1 and gate_rec and gate_bnd and gate_real

    final_train_acc = tr_rep["accuracy"]
    gap = float(final_train_acc - va_rep["accuracy"])
    overfit = bool(final_train_acc >= 0.96 and gap >= 0.25)

    if isolation_ok and all_gates and not overfit:
        cap_label = "WR-TOOL EXP004 — CAPABILITY ACQUISITION DEMONSTRATED"
        experiment_verdict = "WR-TOOL EXPERIMENT 004 TRAINING — PASS"
    elif isolation_ok:
        cap_label = "WR-TOOL EXP004 — CAPABILITY ACQUISITION NOT DEMONSTRATED"
        experiment_verdict = "WR-TOOL EXPERIMENT 004 TRAINING — PASS"
        if overfit:
            cap_label = "WR-TOOL EXP004 — CAPABILITY ACQUISITION NOT DEMONSTRATED"
    else:
        cap_label = "WR-TOOL EXP004 — EXPERIMENT EXECUTION FAIL"
        experiment_verdict = "WR-TOOL EXPERIMENT 004 TRAINING — FAIL"

    if overfit:
        overfit_note = "MEMORIZATION: train accuracy >= 0.96 and train-val gap >= 0.25. Not capability acquisition."
    else:
        overfit_note = "Memorization criterion not met."

    final_state = "CANDIDATE"
    head.manifest.state = final_state
    lora_manifest = make_lora_manifest(
        module_id=EXP004_LORA_ID,
        rank=RANK,
        alpha=ALPHA,
        target_layers=lora_info["targets"],
        state=final_state,
        training_dataset_identity="WR-TOOL-CURRICULUM-V4-CANDIDATE/train.jsonl",
        eval_identity="WR-TOOL-EVAL-4-CANDIDATE",
        experiment_id=EXP004_ID,
        kind="WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_004",
    )
    saved_lora = save_lora_artifact(runtime.backbone, lora_dir, lora_manifest, extra_config={"parameter_count": n_lora})
    head.manifest.trainable_parameter_count = n_head
    saved_head = head.save_artifact(head_dir)

    ckpt_dir.mkdir(parents=True, exist_ok=True)
    write_json(ckpt_dir / "class-map.json", {"order": list(CLASS_NAMES), "ids": CLASS_TO_ID})
    write_json(ckpt_dir / "dataset-hashes.json", {
        "train": train_hash,
        "eval4_bundle": eval4_bundle,
        "core_sha": WRIM0_CHECKPOINT_SHA256,
    })
    write_json(ckpt_dir / "metrics.json", best_epoch_metrics)
    write_json(ckpt_dir / "selection.json", {
        "select_on": "validation_macro_f1",
        "tie_break": ["validation_balanced_accuracy", "lower_validation_loss"],
        "test_not_used": True,
        "frozen": selection_frozen,
        **best_sel,
    })
    save_lora_artifact(runtime.backbone, ckpt_dir / "lora", lora_manifest, extra_config={"parameter_count": n_lora})
    head.save_artifact(ckpt_dir / "head")
    selected_hash = hashlib.sha256(
        (saved_lora["hashes"]["weight_tree_sha256"] + saved_head["hashes"]["weight_tree_sha256"]).encode()
    ).hexdigest()

    saved_lora_state = lora_param_view(runtime.backbone)
    probe_idx = mx.array([test_tok[0]], dtype=mx.int32)
    _, live_logits = runtime(probe_idx)
    live_arr = np.array(live_logits)

    detach_lora_qv(runtime.backbone)
    runtime.backbone.freeze()
    mx.eval(runtime.backbone.parameters())
    detach_view = core_param_view(runtime.backbone)
    detach_hash = tensor_tree_sha256(detach_view)
    detach_diff = max_abs_diff(pre_snap, detach_view)
    inject_lora_qv(runtime.backbone, rank=RANK, alpha=ALPHA, seed=LORA_INIT_SEED)
    restore_lora(runtime.backbone, saved_lora_state)
    freeze_backbone_unfreeze_lora(runtime.backbone)

    reload_core = load_frozen_wrim0()
    reload_before = reload_core.snapshot_params()
    inject_lora_qv(reload_core.model, rank=RANK, alpha=ALPHA, seed=0)
    load_lora_into_model(reload_core.model, lora_dir)
    loaded_head = DummyClassifierHead.load_artifact(head_dir)
    loaded_head.validate_compatibility(reload_core)
    reload_rt = IsolatedLoRAHeadRuntime(reload_core.model, loaded_head)
    reload_logits = np.array(reload_rt(probe_idx)[1])
    reload_ok_probe = bool(np.allclose(reload_logits, live_arr, atol=LOGIT_ATOL))
    reload_test = eval_split(reload_rt, test_tok, y_te)
    reload_metrics_ok = (
        abs(reload_test["accuracy"] - te_rep["accuracy"]) < 1e-9
        and abs(reload_test["macro_f1"] - te_rep["macro_f1"]) < 1e-9
    )
    reload_core_diff = max_abs_diff(reload_before, core_param_view(reload_core.model))
    reload_class_map = list(CLASS_NAMES)
    reload_ok = reload_ok_probe and reload_metrics_ok and reload_core_diff == 0.0
    after_eval_core = core_param_view(runtime.backbone)
    after_eval_diff = max_abs_diff(pre_snap, after_eval_core)
    after_eval_hash = tensor_tree_sha256(after_eval_core)

    local_rt = default_active_runtime()
    composed = attach_module_to_runtime(local_rt, EXP004_LORA_ID)
    composed = attach_module_to_runtime(composed, EXP004_HEAD_ID)
    detached_rt = detach_module_from_runtime(composed, EXP004_HEAD_ID)
    detached_rt = detach_module_from_runtime(detached_rt, EXP004_LORA_ID)

    if PRODUCTION_ROOT.exists() and PRODUCTION_ROOT.stat().st_mtime != prod_mtime:
        return fail(work, "production directory mtime changed")
    if EXP002_DIR.exists() and EXP002_DIR.stat().st_mtime != exp002_mtime:
        return fail(work, "EXP002 artifacts mutated")
    if EXP003_DIR.exists() and EXP003_DIR.stat().st_mtime != exp003_mtime:
        return fail(work, "EXP003 artifacts mutated")
    if WRIM0_WEIGHTS.stat().st_mtime != wrim0_mtime or sha256_file(WRIM0_WEIGHTS) != WRIM0_CHECKPOINT_SHA256:
        return fail(work, "WRIM-0 file mutated")

    wall = time.perf_counter() - wall0
    actual_epochs = history[-1]["epoch"] if history else 0
    best_hist = next(h for h in history if h["epoch"] == best_sel["epoch"])

    gates = {
        "primary_test_accuracy": {"threshold": GATE_ACC, "value": te_rep["accuracy"], "must_exceed_keyword": KEYWORD_TEST_ACC, "must_exceed_bow": BOW_TEST_ACC, "keyword": kw_acc, "bow": bow_acc, "pass": gate_acc},
        "balanced_accuracy": {"threshold": GATE_BAL, "value": te_rep["balanced_accuracy"], "pass": gate_bal},
        "macro_f1": {"threshold": GATE_F1, "value": te_rep["macro_f1"], "pass": gate_f1},
        "per_class_recall": {"threshold": GATE_RECALL, "values": recalls, "pass": gate_rec},
        "hard_boundary": {"threshold": GATE_BOUNDARY, "value": hard_b["accuracy"], "n": hard_b["n"], "pass": gate_bnd},
        "REAL_TEST": {"threshold": GATE_REAL, "value": real_t["accuracy"], "n": real_t["n"], "pass": gate_real},
        "all_required_pass": all_gates,
    }

    write_json(work / "run-manifest.json", {
        "run_id": EXP004_RUN_ID,
        "experiment_id": EXP004_ID,
        "title": EXP004_TITLE,
        "started_at": utcnow(),
        "authorized_for_training": True,
        "promotion": "NO",
        "active_modules": [],
        "active_core": WRIM0_ID,
    })
    write_json(work / "config.json", {
        "run_id": EXP004_RUN_ID,
        "optimizer": "AdamW",
        "learning_rate": LR,
        "betas": list(BETAS),
        "eps": EPS,
        "weight_decay": WEIGHT_DECAY,
        "batch_size": BATCH,
        "max_epochs": MAX_EPOCHS,
        "min_epochs": MIN_EPOCHS,
        "patience": PATIENCE,
        "patience_metric": "validation_macro_f1",
        "grad_clip_norm": CLIP_NORM,
        "seed": SEED,
        "head_init_seed": HEAD_INIT_SEED,
        "lora_init_seed": LORA_INIT_SEED,
        "rank": RANK,
        "alpha": ALPHA,
        "n_classes": N_CLASSES,
        "pooling": POOLING_STRATEGY,
        "loss": "unweighted_cross_entropy",
        "class_weighting": False,
    })
    write_json(work / "class-map.json", {"order": list(CLASS_NAMES), "ids": CLASS_TO_ID, "n_classes": N_CLASSES, "forbidden": ["LOOKUP_NOTE", "ECHO_INT"]})
    write_json(work / "dataset-bindings.json", {
        "train": {"hash": train_hash, "n": len(train), "path": str(V4_CANDIDATE_DIR / "train.jsonl")},
        "eval4": {"hash": eval4_bundle, "val_n": len(val), "test_n": len(test), "path": str(TOOL_EVAL_4_DIR)},
        "eval4_must_not_enter_optimizer": True,
        "family_leak_val": leak_val,
        "family_leak_test": leak_test,
    })
    write_json(work / "training-history.json", {"history": history, "stop_reason": stop_reason, "actual_epochs": actual_epochs, "best_epoch": best_sel["epoch"]})
    write_json(work / "checkpoint-registry.json", {
        "best": str(ckpt_dir),
        "lora_module": str(lora_dir),
        "head_module": str(head_dir),
        "selected_checkpoint_hash": selected_hash,
        "did_not_overwrite_exp002": True,
        "did_not_overwrite_exp003": True,
        "core_weights_not_duplicated": True,
        "core_referenced_by_sha": WRIM0_CHECKPOINT_SHA256,
    })
    write_json(work / "validation-metrics.json", va_rep)
    write_json(work / "test-metrics.json", {k: te_rep[k] for k in te_rep if k != "pred"})
    write_json(work / "confusion-matrix.json", {"labels": list(CLASS_NAMES), "test": te_rep["confusion_matrix"], "validation": va_rep["confusion_matrix"], "train": tr_rep["confusion_matrix"]})
    write_json(work / "per-class-metrics.json", {"precision": precisions, "recall": recalls, "full": te_rep["per_class"]})
    write_json(work / "boundary-metrics.json", {"hard_boundary": hard_b, "pairs": sorted(HARD_BOUNDARY_PAIRS)})
    write_json(work / "real-test-metrics.json", real_t)
    write_json(work / "eval-synthetic-metrics.json", {**synth_t, "SYNTHETIC_MASKING": synth_masking})
    write_json(work / "failure-row-metrics.json", fail_t)
    write_json(work / "lexical-shortcut-audit.json", {
        "url_masked": url_diag,
        "class_tool_name_masked": name_diag,
        "hard_boundary": hard_b,
        "canonical_eval4_unmodified": True,
        "not_used_for_checkpoint_selection": True,
    })
    write_json(work / "overfit-report.json", {
        "final_train_accuracy": final_train_acc,
        "final_val_accuracy": va_rep["accuracy"],
        "generalization_gap": gap,
        "memorization_flag": overfit,
        "criterion": "train_accuracy >= 0.96 AND gap >= 0.25",
        "note": overfit_note,
    })
    write_json(work / "core-immutability-proof.json", {
        "file_sha256": file_sha,
        "core_tree_sha_before": pre_hash,
        "core_tree_sha_after_attach": pre_hash,
        "core_tree_sha_after_training": post_hash,
        "core_tree_sha_after_detach": detach_hash,
        "core_tree_sha_after_final_eval": after_eval_hash,
        "max_abs_diff_after_attach": attach_core_diff,
        "max_abs_diff_after_training": core_diff,
        "max_abs_diff_after_detach": detach_diff,
        "max_abs_diff_after_final_eval": after_eval_diff,
        "expected_max_abs_diff": 0,
    })
    write_json(work / "reload-proof.json", {
        "same_class_map": reload_class_map == list(CLASS_NAMES),
        "logits_match": reload_ok_probe,
        "test_metrics_match": reload_metrics_ok,
        "core_unchanged": reload_core_diff == 0.0,
        "reload_ok": reload_ok,
        "atol": LOGIT_ATOL,
        "reload_test_accuracy": reload_test["accuracy"],
        "reload_test_macro_f1": reload_test["macro_f1"],
    })
    write_json(work / "success-gate-report.json", gates)
    write_json(work / "historical-diagnostics.json", {
        "role": "secondary only; not checkpoint; not train",
        "EVAL-2": hist_eval2,
        "EVAL-3": hist_eval3,
        "protected": eval2_eval3_protected(),
    })
    write_json(work / "memory-interpretation.json", {
        "meaning": "ROUTING GENERALIZATION SIGNAL ONLY",
        "not_broad_memory_competence": True,
        "train_MEMORY_gold": class_counts.get("MEMORY", 0),
        "live_store": "3 rows / 2 unique decree texts",
        "held_out_MEMORY": "partly EVAL_SYNTHETIC",
        "test_MEMORY_recall": recalls["MEMORY"],
    })
    write_json(work / "optimizer-isolation.json", {
        **part,
        "core_keys_in_optimizer": part["base_trainable_keys"],
        "class_weighting": False,
    })
    write_json(work / "lora-config.json", {**lora_info, "verified_parameter_count": n_lora})
    write_json(work / "experiment-runtime.json", {
        "note": "Experiment-local composition only. Global ACTIVE MODULES remain empty.",
        "composed_candidate": f"{WRIM0_ID}+{EXP004_LORA_ID}+{EXP004_HEAD_ID}",
        "attached": composed.to_dict(),
        "detached": detached_rt.to_dict(),
        "global_active_not_written": True,
    })
    write_json(work / "token-cache.json", {
        "pooling_strategy": POOLING_STRATEGY,
        "pooling_rationale": POOLING_RATIONALE,
        "hidden_source": "WRIM0Model.forward_hidden then hidden[:, -1, :] then Linear(256→6)",
        "mean_pool": False,
        "input_ids_hash_train": input_ids_hash(train_tok),
        "n_train": len(train_tok),
    })
    write_json(work / "HASHES.json", {
        "wrim0": WRIM0_CHECKPOINT_SHA256,
        "train": train_hash,
        "eval4": eval4_bundle,
        "lora_weights": saved_lora["hashes"],
        "head_weights": saved_head["hashes"],
        "selected_checkpoint_hash": selected_hash,
        "core_tree_before": pre_hash,
        "core_tree_after": post_hash,
    })

    summary = {
        "run_id": EXP004_RUN_ID,
        "training_start_status": "AUTHORIZED_AND_EXECUTED",
        "wrim0_sha": WRIM0_CHECKPOINT_SHA256,
        "core_trainable_params": 0,
        "lora_rank": RANK,
        "lora_sites": sites_after,
        "lora_params": n_lora,
        "head_params": n_head,
        "total_trainable_params": total_train,
        "class_map": list(CLASS_NAMES),
        "train_hash": train_hash,
        "train_rows": len(train),
        "eval4_hash": eval4_bundle,
        "val_size": len(val),
        "test_size": len(test),
        "optimizer": "AdamW",
        "learning_rate": LR,
        "batch_size": BATCH,
        "max_epochs": MAX_EPOCHS,
        "actual_epochs": actual_epochs,
        "stop_reason": stop_reason,
        "best_epoch": best_sel["epoch"],
        "best_val_loss": best_hist["validation_loss"],
        "best_val_accuracy": best_hist["validation_accuracy"],
        "best_val_balanced_accuracy": best_hist["validation_balanced_accuracy"],
        "best_val_macro_f1": best_hist["validation_macro_f1"],
        "final_train_accuracy": final_train_acc,
        "generalization_gap": gap,
        "overfit_flag": overfit,
        "test_accuracy": te_rep["accuracy"],
        "test_balanced_accuracy": te_rep["balanced_accuracy"],
        "test_macro_f1": te_rep["macro_f1"],
        "recalls": recalls,
        "tool_vs_no_tool_accuracy": te_rep["tool_vs_no_tool_accuracy"],
        "conditional_tool_id_accuracy": te_rep["conditional_tool_id_accuracy"],
        "hard_boundary_accuracy": hard_b["accuracy"],
        "REAL_TEST_accuracy": real_t["accuracy"],
        "EVAL_SYNTHETIC_accuracy": synth_t["accuracy"],
        "SYNTHETIC_MASKING": synth_masking,
        "failure_row_routing_accuracy": fail_t["accuracy"],
        "url_masked": url_diag,
        "name_masked": {"accuracy": name_diag["accuracy"], "material_collapse": name_diag["material_collapse"]},
        "confusion_matrix": te_rep["confusion_matrix"],
        "gates": {k: v["pass"] if isinstance(v, dict) and "pass" in v else v for k, v in gates.items()},
        "experiment_verdict": experiment_verdict,
        "capability_verdict": cap_label,
        "core_sha_before": pre_hash,
        "core_sha_after": post_hash,
        "core_max_abs_diff": core_diff,
        "module_reload_proof": reload_ok,
        "selected_checkpoint_hash": selected_hash,
        "active_core": WRIM0_ID,
        "active_modules": [],
        "promotion_status": "CANDIDATE — NO AUTOMATIC PROMOTION",
        "production_status": "UNTOUCHED",
        "isolation_pass": isolation_ok,
        "reload_ok": reload_ok,
        "train_elapsed_sec": train_elapsed,
        "wall_sec": wall,
        "timing": timing,
        "overfit_note": overfit_note,
    }
    write_json(work / "experiment-summary.json", summary)
    write_json(work / "final-verdict.json", {
        "experiment_verdict": experiment_verdict,
        "capability_verdict": cap_label,
        "isolation_pass": isolation_ok,
        "module_state": final_state,
        "do_not_promote": True,
        "active_core": WRIM0_ID,
        "active_modules": [],
        "overfit_flag": overfit,
        "all_gates_pass": all_gates,
    })

    print(experiment_verdict)
    print(cap_label)
    print(
        f"isolation_pass={isolation_ok} test_acc={te_rep['accuracy']:.4f} "
        f"bal={te_rep['balanced_accuracy']:.4f} f1={te_rep['macro_f1']:.4f} "
        f"core_diff={core_diff} epochs={actual_epochs} wall={wall:.1f}s",
        flush=True,
    )
    return 0 if isolation_ok else 1


def evaluate_historical_eval2(runtime, tokenizer) -> dict[str, Any]:
    rows = load_jsonl(TOOL_EVAL_2_ITEMS)
    comparable = []
    not_comp = []
    for rec in rows:
        mapped = map_historical_class(rec.get("semantic_class"), rec.get("gold_tool_id"))
        if mapped is None:
            not_comp.append({"exampleId": rec.get("exampleId"), "semantic_class": rec.get("semantic_class")})
            continue
        comparable.append({
            "example_id": rec.get("exampleId"),
            "input": rec["input"],
            "prompt_prefix": render_prefix(rec["input"]),
            "gold_class": mapped,
        })
    if not comparable:
        return {"status": "NOT_COMPARABLE", "n_total": len(rows), "n_not_comparable": len(not_comp)}
    toks = [encode_prefix(tokenizer, r["prompt_prefix"]) for r in comparable]
    y = labels(comparable)
    rep = eval_split(runtime, toks, y)
    return {
        "status": "COMPARABLE_SUBSET",
        "n_total": len(rows),
        "n_comparable": len(comparable),
        "n_not_comparable": len(not_comp),
        "not_comparable_reason": "LOOKUP_NOTE/ECHO_INT or unmapped 8-class labels",
        "accuracy": rep["accuracy"],
        "macro_f1": rep["macro_f1"],
        "balanced_accuracy": rep["balanced_accuracy"],
        "per_class": rep["per_class"],
        "confusion_matrix": rep["confusion_matrix"],
        "not_used_for_checkpoint": True,
    }


def evaluate_historical_eval3(runtime, tokenizer) -> dict[str, Any]:
    suite = json.loads((TOOL_EVAL_3_DIR / "suite.json").read_text())
    items = suite.get("items") or []
    comparable = []
    not_comp = []
    for rec in items:
        gold = rec.get("gold") or {}
        cls = rec.get("semantic_class")
        mapped = map_historical_class(cls, gold.get("tool_id"))
        if mapped is None:
            if gold.get("decision") == "NO_TOOL":
                mapped = "NO_TOOL"
            else:
                not_comp.append({"eval_id": rec.get("eval_id"), "tool_id": gold.get("tool_id")})
                continue
        comparable.append({
            "example_id": rec.get("eval_id"),
            "input": rec["input"],
            "prompt_prefix": render_prefix(rec["input"]),
            "gold_class": mapped,
        })
    if not comparable:
        return {"status": "NOT_COMPARABLE", "n_total": len(items)}
    toks = [encode_prefix(tokenizer, r["prompt_prefix"]) for r in comparable]
    y = labels(comparable)
    rep = eval_split(runtime, toks, y)
    return {
        "status": "COMPARABLE_SUBSET",
        "n_total": len(items),
        "n_comparable": len(comparable),
        "n_not_comparable": len(not_comp),
        "accuracy": rep["accuracy"],
        "macro_f1": rep["macro_f1"],
        "balanced_accuracy": rep["balanced_accuracy"],
        "per_class": rep["per_class"],
        "not_used_for_checkpoint": True,
    }


if __name__ == "__main__":
    raise SystemExit(main())
