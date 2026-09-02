#!/usr/bin/env python3
"""WR-TOOL PARAMETER-ISOLATED EXPERIMENT 003.

Frozen WRIM-0 + fresh LoRA r=2 on attn.q/v + Linear(256→8) classifier.
Dataset/class-space is the only scientific variable vs EXP-002.
Does not train WRIM-0, does not start argument extraction / EXP-004 /
Recovery-012 / WRIM1-RUN-000003, does not touch production, does not promote.
"""
from __future__ import annotations

import json
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))
sys.path.insert(0, str(SCRIPT_DIR))

from paths import (  # noqa: E402
    CAP_EVAL_0_SUITE,
    DIAGNOSTIC_SUITE,
    EXP002_DIR,
    EXP003_DIR,
    EXP003_HEAD_ID,
    EXP003_ID,
    EXP003_LORA_ID,
    EXP003_TITLE,
    PRODUCTION_ROOT,
    ROOT,
    TOKENIZER_JSON,
    TOKENIZER_SHA256,
    TOOL_EVAL_1_SUITE,
    TOOL_EVAL_2_HASH,
    TOOL_EVAL_2_ITEMS,
    TOOL_EVAL_2_SUITE,
    V3_CURRICULUM_ID,
    V3_DATASET_HASH,
    V3_EXAMPLES_JSONL,
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
    detach_lora_qv,
    freeze_backbone_unfreeze_lora,
    inject_lora_qv,
    load_lora_into_model,
    lora_param_view,
    optimizer_key_partition,
    save_lora_artifact,
    verified_qv_sites,
)
from exp001_support import POOLING_RATIONALE, POOLING_STRATEGY, input_ids_hash, leakage_report, softmax_np  # noqa: E402
from exp002_support import compare_attached_vs_detached, generation_degeneration  # noqa: E402
from exp003_support import (  # noqa: E402
    CLASS_NAMES,
    CLASS_TO_ID,
    EXPECTED_HEAD_PARAMS,
    EXPECTED_LORA_PARAMS,
    EXPECTED_TRAINABLE,
    HEURISTIC_EVAL2,
    apply_official_v3_split,
    apply_threshold,
    capability_verdict,
    choose_threshold,
    class_geometry,
    classification_report,
    compact_from_class,
    dataset_content_hash,
    geometry_delta,
    load_eval2_records,
    load_v3_records,
    python_route_dry_run,
    subset_report,
    worst_confusion_pair,
)
from active_runtime import (  # noqa: E402
    attach_module_to_runtime,
    default_active_runtime,
    detach_module_from_runtime,
)

LR = 1e-3
BETAS = (0.9, 0.999)
EPS = 1e-8
WEIGHT_DECAY = 0.01
BATCH = 8
MAX_EPOCHS = 100
PATIENCE = 15
MIN_EPOCHS = 5
SEED = 20260831
HEAD_INIT_SEED = 11
LORA_INIT_SEED = 20260831
RUNTIME_BUDGET_SEC = 60 * 60
OPTIMIZER_RATIONALE = (
    "Reuse EXP-002 AdamW recipe (lr=1e-3, betas=0.9/0.999, eps=1e-8, wd=0.01, batch=8). "
    "Isolated trainable count is almost unchanged (38,920 vs 37,635); only the label space grew. "
    "No sweep."
)


def load_tokenizer_local():
    from tokenizers import Tokenizer, decoders

    tok = Tokenizer.from_file(str(TOKENIZER_JSON))
    if tok.decoder is None:
        tok.decoder = decoders.ByteLevel()
    return tok


def generate(model, tokenizer, prompt: str, max_new_tokens: int, temperature: float = 0.0) -> dict:
    import mlx.core as mx

    mx.random.seed(0)
    bos_id = tokenizer.token_to_id("<|bos|>")
    eos_id = tokenizer.token_to_id("<|eos|>")
    prompt_ids = tokenizer.encode(prompt).ids
    ids = [bos_id] + prompt_ids
    cache = model.fresh_cache()
    logits, cache = model(mx.array([ids]), cache=cache)
    generated = list(ids)
    new_ids = []
    for _ in range(max_new_tokens):
        last = logits[:, -1, :]
        next_id = int(mx.argmax(last, axis=-1).item())
        generated.append(next_id)
        new_ids.append(next_id)
        if next_id == eos_id:
            break
        logits, cache = model(mx.array([[next_id]]), cache=cache)
    continuation = tokenizer.decode(new_ids, skip_special_tokens=True)
    return {"continuation": continuation, "new_ids": new_ids}


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


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


def hidden_last(model, ids: list[int]):
    import mlx.core as mx

    idx = mx.array([ids], dtype=mx.int32)
    _, hidden = model.forward_hidden(idx)
    last = hidden[:, -1, :]
    mx.eval(last)
    return last


def collect_hiddens(model, token_rows: list[list[int]]) -> np.ndarray:
    import mlx.core as mx

    feats = []
    for ids in token_rows:
        last = hidden_last(model, ids)
        feats.append(np.array(last.astype(mx.float32))[0])
    return np.stack(feats, axis=0).astype(np.float32)


def run_diagnostics(model, tokenizer, items: list[dict]) -> dict:
    gens = []
    for item in items:
        g = generate(model, tokenizer, item["input"], 32, temperature=0.0)
        gens.append({
            "id": item["id"],
            "input": item["input"],
            "continuation": g["continuation"],
            "new_ids": g["new_ids"],
        })
    blob = sha256_json([{k: g[k] for k in ("id", "continuation", "new_ids")} for g in gens])
    return {"n": len(gens), "items": gens, "output_hash": blob}


def estimate_runtime(runtime, token_rows, y_train, n_train: int, n_val: int) -> dict:
    import mlx.core as mx
    import mlx.nn as nn
    import mlx.optimizers as optim

    opt = optim.AdamW(learning_rate=LR, betas=BETAS, eps=EPS, weight_decay=WEIGHT_DECAY)

    def loss_fn(idx, yb):
        _, pred = runtime(idx)
        return mx.mean(nn.losses.cross_entropy(pred, yb))

    loss_and_grad = nn.value_and_grad(runtime, loss_fn)
    sample = token_rows[: min(8, n_train)]
    t0 = time.perf_counter()
    for i, ids in enumerate(sample):
        idx = mx.array([ids], dtype=mx.int32)
        yb = mx.array([int(y_train[i])], dtype=mx.int32)
        loss, grads = loss_and_grad(idx, yb)
        opt.update(runtime, grads)
        mx.eval(runtime.parameters(), loss)
    elapsed = time.perf_counter() - t0
    per_ex = elapsed / max(1, len(sample))
    steps_per_epoch = int(np.ceil(n_train / BATCH))
    epoch_train = per_ex * n_train
    epoch_val = per_ex * 0.35 * n_val
    worst = (epoch_train + epoch_val) * MAX_EPOCHS
    likely = (epoch_train + epoch_val) * min(MAX_EPOCHS, MIN_EPOCHS + PATIENCE + 10)
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
        "stop_before_training": worst > RUNTIME_BUDGET_SEC and likely > RUNTIME_BUDGET_SEC,
    }


def train_lora_head(runtime, token_rows, y_all, train_ix, val_ix):
    import mlx.core as mx
    import mlx.nn as nn
    import mlx.optimizers as optim
    import mlx.utils as mxu

    rng = np.random.default_rng(SEED)
    opt = optim.AdamW(learning_rate=LR, betas=BETAS, eps=EPS, weight_decay=WEIGHT_DECAY)
    part = optimizer_key_partition(runtime)
    assert_optimizer_lora_and_head_only(runtime)

    def loss_on_indices(indices):
        total = mx.array(0.0)
        n = 0
        for j in indices:
            idx = mx.array([token_rows[int(j)]], dtype=mx.int32)
            yb = mx.array([int(y_all[int(j)])], dtype=mx.int32)
            _, pred = runtime(idx)
            total = total + mx.mean(nn.losses.cross_entropy(pred, yb))
            n += 1
        return total / max(1, n)

    history = []
    best_lora = lora_param_view(runtime.backbone)
    best_head = numpy_params(runtime.head)
    best_epoch = 0
    best_val = float("inf")
    stall = 0

    def eval_indices(indices):
        logits = []
        losses = []
        for j in indices:
            idx = mx.array([token_rows[int(j)]], dtype=mx.int32)
            _, pred = runtime(idx)
            arr = np.array(pred)[0]
            logits.append(arr)
            y = int(y_all[int(j)])
            p = softmax_np(arr[None, :])[0, y]
            losses.append(float(-np.log(p + 1e-12)))
        logits = np.stack(logits, axis=0)
        pred = np.argmax(logits, axis=1)
        y = y_all[np.array(indices, dtype=int)]
        return float(np.mean(losses)), float(np.mean(pred == y)), logits

    n_tr = len(train_ix)
    for epoch in range(1, MAX_EPOCHS + 1):
        losses = []
        for chunk in batches(n_tr, BATCH, rng):
            local = [train_ix[int(k)] for k in chunk]

            def step_loss():
                return loss_on_indices(local)

            loss_and_grad = nn.value_and_grad(runtime, step_loss)
            loss, grads = loss_and_grad()
            grad_keys = [k for k, _ in mxu.tree_flatten(grads)]
            if any((not k.startswith("head.")) and ("lora_a" not in k and "lora_b" not in k) for k in grad_keys):
                raise RuntimeError(f"unexpected grad keys {grad_keys[:12]}")
            opt.update(runtime, grads)
            mx.eval(runtime.parameters())
            losses.append(float(loss.item()))
            if not np.isfinite(losses[-1]):
                return {
                    "unstable": True,
                    "history": history,
                    "stopped_epoch": epoch,
                    "best_epoch": best_epoch,
                    "reason": "non-finite train loss",
                    "optimizer_param_keys": part["trainable_keys"],
                    "early_stop_rule": early_stop_rule(),
                }
        tr_loss = float(np.mean(losses))
        va_loss, va_acc, _ = eval_indices(val_ix)
        history.append({
            "epoch": epoch,
            "train_loss": tr_loss,
            "train_accuracy": float("nan"),
            "val_loss": va_loss,
            "val_accuracy": va_acc,
        })
        print(f"epoch {epoch} train_loss={tr_loss:.4f} val_loss={va_loss:.4f} val_acc={va_acc:.4f}", flush=True)
        if va_loss < best_val - 1e-6:
            best_val = va_loss
            best_epoch = epoch
            best_lora = lora_param_view(runtime.backbone)
            best_head = numpy_params(runtime.head)
            stall = 0
        else:
            stall += 1
        if epoch >= MIN_EPOCHS and stall >= PATIENCE:
            break

    restore_lora(runtime.backbone, best_lora)
    restore_head(runtime.head, best_head)
    freeze_backbone_unfreeze_lora(runtime.backbone)
    return {
        "unstable": False,
        "history": history,
        "stopped_epoch": history[-1]["epoch"],
        "best_epoch": best_epoch,
        "early_stop_rule": early_stop_rule(),
        "optimizer_param_keys": part["trainable_keys"],
        "optimizer_contains_core": False,
        "best_val_loss": best_val,
    }


def early_stop_rule() -> str:
    return (
        f"AdamW lr={LR} eps={EPS} wd={WEIGHT_DECAY} betas={BETAS}; "
        f"per-example CE (batch group {BATCH}); max {MAX_EPOCHS} epochs; "
        f"min {MIN_EPOCHS}; restore best validation loss; patience {PATIENCE}; "
        "never select on test or EVAL-2"
    )


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


def predict_logits_rows(runtime, token_rows, indices):
    import mlx.core as mx

    out = []
    for j in indices:
        idx = mx.array([token_rows[int(j)]], dtype=mx.int32)
        _, pred = runtime(idx)
        out.append(np.array(pred)[0])
    return np.stack(out, axis=0)


def prepare_work_dir(work: Path) -> None:
    work.mkdir(parents=True, exist_ok=True)
    for p in work.iterdir():
        if p.name == "design-only":
            continue
        if p.is_dir():
            shutil.rmtree(p)
        else:
            p.unlink()


def main() -> int:
    wall0 = time.perf_counter()
    work = EXP003_DIR
    prepare_work_dir(work)
    lora_dir = work / "module" / EXP003_LORA_ID
    head_dir = work / "module" / EXP003_HEAD_ID
    exp002_lora = EXP002_DIR / "module" / "WR-TOOL-LORA-R2-001"
    exp002_head = EXP002_DIR / "module" / "WR-TOOL-HEAD-002"

    prod_mtime = PRODUCTION_ROOT.stat().st_mtime if PRODUCTION_ROOT.exists() else None

    records = load_v3_records(V3_EXAMPLES_JSONL)
    v3_hash = dataset_content_hash(records)
    if v3_hash != V3_DATASET_HASH:
        write_json(work / "FAILURE.json", {"reason": "V3 hash mismatch", "got": v3_hash, "expected": V3_DATASET_HASH})
        return 1
    split_proof = apply_official_v3_split(records)
    train_recs = [r for r in records if r["split"] == "train"]
    val_recs = [r for r in records if r["split"] == "val"]
    test_recs = [r for r in records if r["split"] == "test"]

    eval2_recs = load_eval2_records(TOOL_EVAL_2_ITEMS)
    eval2_hash = dataset_content_hash(eval2_recs)
    if eval2_hash != TOOL_EVAL_2_HASH:
        write_json(work / "FAILURE.json", {"reason": "EVAL-2 hash mismatch", "got": eval2_hash, "expected": TOOL_EVAL_2_HASH})
        return 1
    if any(r.get("EXCLUDE_FROM_TRAINING") is False for r in eval2_recs):
        write_json(work / "FAILURE.json", {"reason": "EVAL-2 not excluded from training"})
        return 1
    if len(eval2_recs) != 115:
        write_json(work / "FAILURE.json", {"reason": "EVAL-2 count", "n": len(eval2_recs)})
        return 1

    cap_suite = json.loads(CAP_EVAL_0_SUITE.read_text(encoding="utf-8"))
    tool1_suite = json.loads(TOOL_EVAL_1_SUITE.read_text(encoding="utf-8"))
    tool2_suite = json.loads(TOOL_EVAL_2_SUITE.read_text(encoding="utf-8"))
    leak_cap = leakage_report(train_recs, cap_suite)
    leak_tool1 = leakage_report(train_recs, tool1_suite)
    leak_tool2 = leakage_report(train_recs, tool2_suite)
    leak_ok = (
        int(leak_cap.get("known_eval_leakage") or 0) == 0
        and int(leak_tool1.get("known_eval_leakage") or 0) == 0
        and int(leak_tool2.get("known_eval_leakage") or 0) == 0
        and not split_proof["train_test_family_overlap"]
    )
    write_json(work / "dataset-split.json", {
        "dataset_id": V3_CURRICULUM_ID,
        "dataset_hash": v3_hash,
        "class_mapping": {"classifier_classes": list(CLASS_NAMES)},
        **{k: split_proof[k] for k in split_proof},
        "examples": [
            {"example_id": r["example_id"], "split": r["split"], "gold_class": r["gold_class"], "family_id": r["family_id"]}
            for r in records
        ],
    })
    write_json(work / "leakage.json", {
        "cap_eval_0": leak_cap,
        "tool_eval_1": leak_tool1,
        "tool_eval_2": leak_tool2,
        "train_test_family_leakage": len(split_proof["train_test_family_overlap"]),
        "passed": leak_ok,
        "reused_official_v3_split": True,
    })
    if not leak_ok:
        write_json(work / "FAILURE.json", {"reason": "leakage", "leakage": True})
        return 1

    tokenizer = load_tokenizer_local()
    tok_sha = sha256_file(TOKENIZER_JSON)
    if tok_sha != TOKENIZER_SHA256:
        raise RuntimeError("tokenizer SHA mismatch")

    core = load_frozen_wrim0()
    pre_hash = core.weight_tree_hash()
    pre_snap = core.snapshot_params()
    proof = core.proof()
    if proof.file_sha256 != WRIM0_CHECKPOINT_SHA256:
        raise RuntimeError("WRIM-0 SHA mismatch")
    if proof.core_total_parameters != 19_217_152:
        raise RuntimeError(proof.core_total_parameters)
    if proof.core_trainable_parameters != 0:
        raise RuntimeError("core not frozen at load")

    sites_before = verified_qv_sites(core.model)
    diag_suite = json.loads(DIAGNOSTIC_SUITE.read_text(encoding="utf-8"))
    items = list(diag_suite["items"])
    if len(items) != 13:
        raise RuntimeError(f"expected 13 diagnostic probes, got {len(items)}")
    diag_detached_before = run_diagnostics(core.model, tokenizer, items)

    token_rows = [encode_prefix(tokenizer, r["prompt_prefix"]) for r in records]
    eval2_token_rows = [encode_prefix(tokenizer, r["prompt_prefix"]) for r in eval2_recs]
    ids_hash = input_ids_hash(token_rows)
    write_json(work / "token-cache.json", {
        "note": "tokenized inputs only; hidden states are NOT cached for training",
        "pooling_strategy": POOLING_STRATEGY,
        "pooling_rationale": POOLING_RATIONALE + " V3 uses the same assistant-boundary prefix.",
        "hidden_source": "WRIM0Model.forward_hidden post-norm_f through LoRA-adapted attn.q/v",
        "input_ids_hash": ids_hash,
        "n": len(token_rows),
        "mean_prefix_tokens": float(np.mean([len(x) for x in token_rows])),
        "max_prefix_tokens": int(max(len(x) for x in token_rows)),
        "initialization": "fresh LoRA r=2 + fresh 8-way head; not initialized from EXP-002",
    })

    idx_by_id = {r["example_id"]: i for i, r in enumerate(records)}
    y_all = np.array([CLASS_TO_ID[r["gold_class"]] for r in records], dtype=np.int32)
    train_ix = [idx_by_id[r["example_id"]] for r in train_recs]
    val_ix = [idx_by_id[r["example_id"]] for r in val_recs]
    test_ix = [idx_by_id[r["example_id"]] for r in test_recs]
    y_tr, y_va, y_te = y_all[train_ix], y_all[val_ix], y_all[test_ix]
    y_e2 = np.array([CLASS_TO_ID[r["gold_class"]] for r in eval2_recs], dtype=np.int32)

    frozen_feats = collect_hiddens(core.model, token_rows)
    frozen_geom = class_geometry(frozen_feats, y_all)

    import mlx.core as mx

    probe_ids = token_rows[train_ix[0]]
    idx0 = mx.array([probe_ids], dtype=mx.int32)
    logits_detached0, hidden_detached0 = core.forward_hidden(idx0)
    mx.eval(logits_detached0, hidden_detached0)

    lora_info = inject_lora_qv(core.model, rank=RANK, alpha=ALPHA, seed=LORA_INIT_SEED)
    sites_after = verified_qv_sites(core.model)
    n_lora = count_lora_params(core.model)
    n_base_train = count_base_trainable(core.model)
    if n_base_train != 0:
        write_json(work / "FAILURE.json", {"reason": "base trainable after LoRA inject", "n": n_base_train})
        return 1

    logits_attached0, hidden_attached0 = core.model.forward_hidden(idx0)
    mx.eval(logits_attached0, hidden_attached0)
    pretrain_delta = {
        "max_abs_logit_diff": float(np.max(np.abs(np.array(logits_attached0) - np.array(logits_detached0)))),
        "max_abs_hidden_diff": float(np.max(np.abs(np.array(hidden_attached0) - np.array(hidden_detached0)))),
        "note": "B=0 at init so composed module should match detached WRIM-0 within numeric noise",
    }

    head_manifest = make_tool_head_manifest(
        module_id=EXP003_HEAD_ID,
        n_classes=8,
        state="SHADOW",
        training_dataset_identity="WR-TOOL-CURRICULUM-V3",
        eval_identity="WR-TOOL-EVAL-2",
        experiment_id=EXP003_ID,
        kind="WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_003",
        extra_provenance={
            "paired_lora_module": EXP003_LORA_ID,
            "not_merged_checkpoint": True,
            "not_initialized_from_exp002": True,
        },
    )
    head = DummyClassifierHead(head_manifest, seed=HEAD_INIT_SEED)
    head_before = numpy_params(head)
    head_pre_hash = tensor_tree_sha256(head_before)
    n_head = int(sum(v.size for v in head_before.values()))

    lora_before = lora_param_view(core.model)
    lora_pre_hash = tensor_tree_sha256(lora_before)
    runtime = IsolatedLoRAHeadRuntime(core.model, head)
    freeze_backbone_unfreeze_lora(core.model)
    runtime.head.unfreeze()
    part = optimizer_key_partition(runtime)
    assert_optimizer_lora_and_head_only(runtime)
    total_train = part["total_trainable_count"]

    y_train_np = y_all[train_ix]
    timing = estimate_runtime(runtime, [token_rows[i] for i in train_ix], y_train_np, len(train_ix), len(val_ix))
    write_json(work / "runtime-estimate.json", timing)
    print(
        f"EXP003 runtime estimate likely={timing['estimated_likely_sec']:.1f}s "
        f"worst={timing['estimated_worst_case_sec']:.1f}s "
        f"per_ex={timing['sec_per_example_fwd_bwd']:.3f}s",
        flush=True,
    )
    if timing["stop_before_training"]:
        write_json(work / "FAILURE.json", {"reason": "runtime estimate exceeds 60 minutes", "timing": timing})
        print("STOP BEFORE TRAINING: estimated runtime exceeds 60 minutes")
        return 1

    restore_lora(core.model, lora_before)
    restore_head(head, head_before)
    freeze_backbone_unfreeze_lora(core.model)
    runtime.head.unfreeze()

    train_t0 = time.perf_counter()
    train_info = train_lora_head(runtime, token_rows, y_all, train_ix, val_ix)
    train_elapsed = time.perf_counter() - train_t0
    if train_info.get("unstable"):
        write_json(work / "FAILURE.json", {"reason": "training unstable", "train": train_info})
        print("STOP: training unstable")
        return 1

    head.manifest.state = "CANDIDATE"
    lora_after = lora_param_view(core.model)
    head_after = numpy_params(head)
    lora_moved = max_abs_diff(lora_before, lora_after)
    head_moved = max_abs_diff(head_before, head_after)
    if lora_moved == 0.0:
        write_json(work / "FAILURE.json", {"reason": "LoRA parameters did not move"})
        return 1
    if head_moved == 0.0:
        write_json(work / "FAILURE.json", {"reason": "head parameters did not move"})
        return 1

    post_core_view = core_param_view(core.model)
    core_diff = max_abs_diff(pre_snap, post_core_view)
    post_hash = tensor_tree_sha256(post_core_view)
    if post_hash != pre_hash or core_diff != 0.0:
        write_json(work / "FAILURE.json", {
            "reason": "CORE DRIFT",
            "pre": pre_hash,
            "post": post_hash,
            "max_abs_diff": core_diff,
        })
        return 1

    tr_logits = predict_logits_rows(runtime, token_rows, train_ix)
    va_logits = predict_logits_rows(runtime, token_rows, val_ix)
    te_logits = predict_logits_rows(runtime, token_rows, test_ix)
    thresh = choose_threshold(va_logits, y_va)
    tau = float(thresh["tau"])
    tr_pred = apply_threshold(tr_logits, tau)
    va_pred = apply_threshold(va_logits, tau)
    te_pred = apply_threshold(te_logits, tau)
    train_rep = classification_report(y_tr, tr_pred)
    val_rep = classification_report(y_va, va_pred)
    test_rep = classification_report(y_te, te_pred)

    eval2_logits = predict_logits_rows(runtime, eval2_token_rows, list(range(len(eval2_recs))))
    eval2_pred = apply_threshold(eval2_logits, tau)
    eval2_rep = classification_report(y_e2, eval2_pred)
    real_mask = [r["real_wording"] for r in eval2_recs]
    dist_mask = [r["distractor"] for r in eval2_recs]
    arg_mask = [r["argument_task"] for r in eval2_recs]
    unsup_mask = [r["unsupported_or_unavailable"] for r in eval2_recs]
    amb_mask = [r["ambiguity"] for r in eval2_recs]
    fail_mask = [
        r["eval_section"] in ("FAILURE_RESULT_HANDLING", "UNSUPPORTED_TOOL", "UNAVAILABLE_TOOL")
        or r["unsupported_or_unavailable"]
        for r in eval2_recs
    ]
    eval2_pack = {
        **eval2_rep,
        "real_wording": subset_report(y_e2, eval2_pred, real_mask),
        "distractor": subset_report(y_e2, eval2_pred, dist_mask),
        "argument_task_routing": subset_report(y_e2, eval2_pred, arg_mask),
        "unsupported_unavailable": subset_report(y_e2, eval2_pred, unsup_mask),
        "ambiguity": subset_report(y_e2, eval2_pred, amb_mask),
        "failure_result": subset_report(y_e2, eval2_pred, fail_mask),
        "n_real_wording": int(sum(real_mask)),
        "n_distractor": int(sum(dist_mask)),
        "n_argument_task": int(sum(arg_mask)),
        "n_unsupported": int(sum(unsup_mask)),
        "n_ambiguity": int(sum(amb_mask)),
        "n_failure_result": int(sum(fail_mask)),
        "per_item": [
            {
                "eval_id": rec["example_id"],
                "gold_class": rec["gold_class"],
                "pred_class": CLASS_NAMES[int(eval2_pred[i])],
                "correct": bool(eval2_pred[i] == y_e2[i]),
                "real_wording": rec["real_wording"],
                "distractor": rec["distractor"],
                "argument_task": rec["argument_task"],
                "eval_section": rec["eval_section"],
            }
            for i, rec in enumerate(eval2_recs)
        ],
        "note": "Argument values are not scored. Routing class only.",
    }

    distractor_test = [i for i, r in enumerate(test_recs) if r["distractor"]]
    distractor_rep = None
    if distractor_test:
        distractor_rep = classification_report(y_te[distractor_test], te_pred[distractor_test])

    adapted_feats = collect_hiddens(core.model, token_rows)
    adapted_geom = class_geometry(adapted_feats, y_all)
    geom = {
        "frozen_wrim0": {k: frozen_geom[k] for k in ("within_class", "centroid_l2", "fisher_ratio", "nearest_centroid_pair")},
        "lora_adapted": {k: adapted_geom[k] for k in ("within_class", "centroid_l2", "fisher_ratio", "nearest_centroid_pair")},
        "delta": geometry_delta(frozen_geom, adapted_geom),
        "pooling": POOLING_STRATEGY,
        "n": len(records),
        "n_classes": 8,
    }

    gold_args_demo = next(r for r in records if r["gold_class"] == "SHA256" and r["gold_arguments"])
    live_idx = mx.array([token_rows[test_ix[0]]], dtype=mx.int32)
    lm_logits, head_out = runtime(live_idx)
    attached_pred = CLASS_NAMES[int(np.argmax(np.array(head_out), axis=-1).item())]
    compact_cls_only = compact_from_class(attached_pred)
    routed_cls = python_route_dry_run(compact_cls_only, source_module=EXP003_HEAD_ID)
    compact_with_gold_args = compact_from_class("SHA256", gold_args_demo["gold_arguments"])
    routed_args = python_route_dry_run(compact_with_gold_args, source_module=EXP003_HEAD_ID)
    none_route = python_route_dry_run("TOOL=none", source_module=EXP003_HEAD_ID)
    mapping_proof = {
        cls: compact_from_class(cls) for cls in CLASS_NAMES
    }
    if routed_args.get("executed") or routed_cls.get("executed") or none_route.get("executed"):
        raise RuntimeError("execution boundary violated")

    diag_attached = run_diagnostics(core.model, tokenizer, items)
    attached_deg = generation_degeneration(diag_attached["items"], tokenizer)

    saved_lora_state = lora_param_view(core.model)
    detach_lora_qv(core.model)
    core.model.freeze()
    mx.eval(core.model.parameters())
    detached_view = core_param_view(core.model)
    detach_hash = tensor_tree_sha256(detached_view)
    detach_diff = max_abs_diff(pre_snap, detached_view)
    diag_detached_after = run_diagnostics(core.model, tokenizer, items)
    language_ok = (
        diag_detached_before["output_hash"] == diag_detached_after["output_hash"]
        and detach_hash == pre_hash
        and detach_diff == 0.0
    )
    attached_deg = compare_attached_vs_detached(diag_detached_before["items"], attached_deg)

    inject_lora_qv(core.model, rank=RANK, alpha=ALPHA, seed=LORA_INIT_SEED)
    restore_lora(core.model, saved_lora_state)
    freeze_backbone_unfreeze_lora(core.model)
    runtime = IsolatedLoRAHeadRuntime(core.model, head)
    _, head_out2 = runtime(live_idx)
    reattach_ok = bool(np.allclose(np.array(head_out), np.array(head_out2), atol=1e-5))

    lora_manifest = make_lora_manifest(
        module_id=EXP003_LORA_ID,
        rank=RANK,
        alpha=ALPHA,
        target_layers=lora_info["targets"],
        state="CANDIDATE",
        training_dataset_identity="WR-TOOL-CURRICULUM-V3",
        eval_identity="WR-TOOL-EVAL-2",
        experiment_id=EXP003_ID,
        kind="WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_003",
    )
    saved_lora = save_lora_artifact(core.model, lora_dir, lora_manifest, extra_config={"parameter_count": n_lora})
    head.manifest.trainable_parameter_count = n_head
    saved_head = head.save_artifact(head_dir)

    reload_model_core = load_frozen_wrim0()
    inject_lora_qv(reload_model_core.model, rank=RANK, alpha=ALPHA, seed=0)
    load_lora_into_model(reload_model_core.model, lora_dir)
    loaded_head = DummyClassifierHead.load_artifact(head_dir)
    loaded_head.validate_compatibility(reload_model_core)
    reload_rt = IsolatedLoRAHeadRuntime(reload_model_core.model, loaded_head)
    reload_logits = np.array(reload_rt(live_idx)[1])
    live_reload = np.array(runtime(live_idx)[1])
    reload_ok = bool(np.allclose(reload_logits, live_reload, atol=1e-5))

    local_rt = default_active_runtime()
    composed = attach_module_to_runtime(local_rt, EXP003_LORA_ID)
    composed = attach_module_to_runtime(composed, EXP003_HEAD_ID)
    detached_rt = detach_module_from_runtime(composed, EXP003_HEAD_ID)
    detached_rt = detach_module_from_runtime(detached_rt, EXP003_LORA_ID)
    write_json(work / "experiment-runtime.json", {
        "note": "Experiment-local composition only. Global ACTIVE MODULES remain empty.",
        "composed_candidate": f"{WRIM0_ID}+{EXP003_LORA_ID}+{EXP003_HEAD_ID}",
        "attached": composed.to_dict(),
        "detached": detached_rt.to_dict(),
        "global_active_not_written": True,
        "did_not_overwrite_exp002_modules": True,
        "exp002_lora_still_present": exp002_lora.is_dir(),
        "exp002_head_still_present": exp002_head.is_dir(),
    })

    h = HEURISTIC_EVAL2
    heuristic_cmp = {
        "eval2_neural_accuracy": eval2_rep["accuracy"],
        "eval2_neural_macro_f1": eval2_rep["macro_f1"],
        "eval2_neural_balanced_accuracy": eval2_rep["balanced_accuracy"],
        "majority_accuracy": h["majority_accuracy"],
        "random_accuracy": h["random_accuracy"],
        "keyword_accuracy": h["keyword_accuracy"],
        "keyword_macro_f1": h["keyword_macro_f1"],
        "schema_accuracy": h["schema_accuracy"],
        "schema_macro_f1": h["schema_macro_f1"],
        "bow_accuracy": h["bow_accuracy"],
        "bow_macro_f1": h["bow_macro_f1"],
        "beats_majority": eval2_rep["accuracy"] > h["majority_accuracy"],
        "beats_random": eval2_rep["accuracy"] > h["random_accuracy"],
        "beats_keyword_accuracy": eval2_rep["accuracy"] > h["keyword_accuracy"],
        "beats_keyword_macro_f1": eval2_rep["macro_f1"] > h["keyword_macro_f1"],
        "beats_schema_accuracy": eval2_rep["accuracy"] > h["schema_accuracy"],
        "beats_schema_macro_f1": eval2_rep["macro_f1"] > h["schema_macro_f1"],
        "beats_bow_accuracy": eval2_rep["accuracy"] > h["bow_accuracy"],
        "beats_bow_macro_f1": eval2_rep["macro_f1"] > h["bow_macro_f1"],
        "source": "WR-TOOL-CURRICULUM-V3/baselines.json (EVAL-2)",
    }

    expected_sites = [f"layers.{i}.attn.{a}" for i in range(18) for a in ("q", "v")]
    sites_ok = sites_after == expected_sites
    isolation_pass = all([
        proof.file_sha256 == WRIM0_CHECKPOINT_SHA256,
        tok_sha == TOKENIZER_SHA256,
        v3_hash == V3_DATASET_HASH,
        eval2_hash == TOOL_EVAL_2_HASH,
        n_base_train == 0,
        count_base_trainable(core.model) == 0,
        not part["base_trainable_keys"],
        n_lora == count_lora_params(core.model),
        lora_moved > 0,
        head_moved > 0,
        core_diff == 0.0,
        pre_hash == post_hash,
        language_ok,
        reload_ok,
        leak_ok,
        not routed_args["executed"],
        reattach_ok,
        sites_ok,
        not attached_deg.get("adapter_created_broad_degeneration"),
        pretrain_delta["max_abs_logit_diff"] < 1e-4,
        RANK == 2,
        head.manifest.n_classes == 8,
        exp002_lora.is_dir(),
        exp002_head.is_dir(),
    ])

    if attached_deg.get("adapter_created_broad_degeneration"):
        final_state = "REJECTED"
        isolation_pass = False
    else:
        final_state = "CANDIDATE" if isolation_pass else "REJECTED"

    experiment_verdict = (
        "WR-TOOL PARAMETER-ISOLATED EXPERIMENT 003 — PASS"
        if isolation_pass
        else "WR-TOOL PARAMETER-ISOLATED EXPERIMENT 003 — FAIL"
    )
    overfit_note = (
        f"train_acc={train_rep['accuracy']:.3f} val_acc={val_rep['accuracy']:.3f} "
        f"test_acc={test_rep['accuracy']:.3f} eval2_acc={eval2_rep['accuracy']:.3f} "
        f"synthetic_share={split_proof['synthetic_share']:.3f}"
    )
    cap_label, cap_why = capability_verdict(
        isolation_pass=isolation_pass,
        eval2=eval2_pack,
        test_rep=test_rep,
        attached_deg=attached_deg,
        train_acc=train_rep["accuracy"],
        overfit_note=overfit_note,
    )

    lora_manifest.state = final_state
    head.manifest.state = final_state
    save_lora_artifact(core.model, lora_dir, lora_manifest, extra_config={"parameter_count": n_lora})
    head.save_artifact(head_dir)

    if PRODUCTION_ROOT.exists() and PRODUCTION_ROOT.stat().st_mtime != prod_mtime:
        raise RuntimeError("production directory mtime changed; abort")

    best_hist = next(hrow for hrow in train_info["history"] if hrow["epoch"] == train_info["best_epoch"])
    wall = time.perf_counter() - wall0

    write_json(work / "metrics.json", {
        "optimizer": "AdamW",
        "optimizer_rationale": OPTIMIZER_RATIONALE,
        "learning_rate": LR,
        "betas": list(BETAS),
        "eps": EPS,
        "weight_decay": WEIGHT_DECAY,
        "batch_size": BATCH,
        "seed": SEED,
        "head_init_seed": HEAD_INIT_SEED,
        "lora_init_seed": LORA_INIT_SEED,
        "epoch_policy": train_info["early_stop_rule"],
        "stopped_epoch": train_info["stopped_epoch"],
        "best_epoch": train_info["best_epoch"],
        "history": train_info["history"],
        "threshold": thresh,
        "train": train_rep,
        "validation": val_rep,
        "test": test_rep,
        "distractor_test": distractor_rep,
        "lora_parameter_count": n_lora,
        "head_parameter_count": n_head,
        "expected_lora_parameter_count": EXPECTED_LORA_PARAMS,
        "expected_head_parameter_count": EXPECTED_HEAD_PARAMS,
        "expected_total_trainable_isolated": EXPECTED_TRAINABLE,
        "total_trainable_isolated": total_train,
        "head_architecture": "Linear(256 -> 8, bias=True)",
        "training_objective": "classifier_cross_entropy_only",
        "language_model_loss": False,
        "argument_extraction_trained": False,
        "initialized_from_exp002": False,
        "train_elapsed_sec": train_elapsed,
        "wall_sec": wall,
    })
    write_json(work / "confusion-matrix.json", {
        "test": test_rep["confusion_matrix"],
        "eval2": eval2_rep["confusion_matrix"],
        "labels": list(CLASS_NAMES),
        "validation": val_rep["confusion_matrix"],
        "train": train_rep["confusion_matrix"],
        "worst_test_pair": worst_confusion_pair(test_rep["confusion_matrix"], list(CLASS_NAMES)),
        "worst_eval2_pair": worst_confusion_pair(eval2_rep["confusion_matrix"], list(CLASS_NAMES)),
    })
    write_json(work / "eval-2.json", eval2_pack)
    write_json(work / "real-wording-analysis.json", {
        "n": eval2_pack["n_real_wording"],
        "metrics": eval2_pack["real_wording"],
        "limitation": "V3 REAL_RUNTIME=0; do not claim real-world generalization from synthetic train accuracy.",
        "items": [x for x in eval2_pack["per_item"] if x["real_wording"]],
    })
    write_json(work / "distractor-analysis.json", {
        "n": eval2_pack["n_distractor"],
        "metrics": eval2_pack["distractor"],
        "note": "If accuracy collapses only when tool-name tokens appear as distractors, the adapter is lexical not semantic.",
        "items": [x for x in eval2_pack["per_item"] if x["distractor"]],
    })
    write_json(work / "heuristic-comparison.json", heuristic_cmp)
    write_json(work / "representation-analysis.json", geom)
    write_json(work / "hash-proofs.json", {
        "core_file_sha256": proof.file_sha256,
        "expected_core_file_sha256": WRIM0_CHECKPOINT_SHA256,
        "tokenizer_sha256": tok_sha,
        "v3_hash": v3_hash,
        "eval2_hash": eval2_hash,
        "pre_training_core_weight_tree_hash": pre_hash,
        "post_training_core_weight_tree_hash": post_hash,
        "detached_core_weight_tree_hash": detach_hash,
        "core_max_abs_diff": core_diff,
        "detached_max_abs_diff": detach_diff,
        "lora_pre_hash": lora_pre_hash,
        "lora_post_hash": tensor_tree_sha256(lora_after),
        "lora_max_abs_diff": lora_moved,
        "head_pre_hash": head_pre_hash,
        "head_post_hash": tensor_tree_sha256(head_after),
        "head_max_abs_diff": head_moved,
        "pretrain_attached_vs_detached": pretrain_delta,
        "input_ids_hash": ids_hash,
        "qv_sites": sites_after,
    })
    write_json(work / "language-stability.json", {
        "core_detached": {
            "before_hash": diag_detached_before["output_hash"],
            "after_hash": diag_detached_after["output_hash"],
            "identical": language_ok,
            "n_probes": 13,
            "before": [{"id": g["id"], "continuation": g["continuation"]} for g in diag_detached_before["items"]],
            "after": [{"id": g["id"], "continuation": g["continuation"]} for g in diag_detached_after["items"]],
        },
        "composed_attached": {
            "output_hash": diag_attached["output_hash"],
            "same_as_detached_core": diag_attached["output_hash"] == diag_detached_before["output_hash"],
            **{k: attached_deg[k] for k in attached_deg if k != "items"},
            "items": attached_deg["items"],
        },
        "exp002_comparison_note": "Compare collapse_count / unique_ratio / degeneration classes against EXP-002 language-stability.json.",
    })
    write_json(work / "attach-detach.json", {
        "reattach_classifier_logits_match": reattach_ok,
        "lora_reload_ok": reload_ok,
        "head_reload_ok": reload_ok,
        "qv_sites_before_inject": sites_before,
        "qv_sites_after_inject": sites_after,
        "pretrain_identity": pretrain_delta,
    })
    write_json(work / "optimizer-isolation.json", {
        **part,
        "core_keys_in_optimizer": part["base_trainable_keys"],
        "train_optimizer_keys": train_info["optimizer_param_keys"],
        "core_total": proof.core_total_parameters,
        "core_trainable_base": 0,
        "lora_trainable": n_lora,
        "head_trainable": n_head,
        "total_trainable_isolated": total_train,
    })
    write_json(work / "tool-router.json", {
        "class_to_compact": mapping_proof,
        "classifier_class_only_intent": compact_cls_only,
        "classifier_class_only_route": {
            k: routed_cls[k] for k in routed_cls if k != "intent"
        } | {"parse_status": routed_cls["intent"]["parse_status"], "decision": routed_cls["intent"]["decision"]},
        "gold_arg_fixture_not_used_as_eval_score": compact_with_gold_args,
        "gold_arg_dry_run": {
            "executed": routed_args["executed"],
            "stageReached": routed_args["stageReached"],
            "execution_mode": routed_args["execution_mode"],
            "validation": routed_args["validation"],
            "dry_run_result": routed_args.get("dry_run_result"),
        },
        "no_tool_route": {
            "executed": none_route["executed"],
            "decision": none_route["intent"]["decision"],
            "validation": none_route["validation"],
        },
        "live_tools_executed": False,
        "source_module": EXP003_HEAD_ID,
        "argument_extraction_not_trained": True,
    })
    write_json(work / "lora-config.json", {
        **lora_info,
        "verified_parameter_count": n_lora,
        "expected_phase1_count": EXPECTED_LORA_PARAMS,
        "counts_match_phase1": n_lora == EXPECTED_LORA_PARAMS,
        "fresh_init_not_from_exp002": True,
    })
    write_json(work / "config.json", {
        "experiment_id": EXP003_ID,
        "title": EXP003_TITLE,
        "lora_module_id": EXP003_LORA_ID,
        "head_module_id": EXP003_HEAD_ID,
        "composed_candidate": f"{WRIM0_ID}+{EXP003_LORA_ID}+{EXP003_HEAD_ID}",
        "core_id": WRIM0_ID,
        "pooling": POOLING_STRATEGY,
        "n_classes": 8,
        "lr": LR,
        "batch_size": BATCH,
        "max_epochs": MAX_EPOCHS,
        "patience": PATIENCE,
        "rank": RANK,
        "alpha": ALPHA,
        "dataset_id": V3_CURRICULUM_ID,
        "eval_id": "WR-TOOL-EVAL-2",
        "initialized_from_exp002": False,
    })
    write_json(work / "v3-reference.json", {
        "dataset_id": V3_CURRICULUM_ID,
        "dataset_hash": v3_hash,
        "expected_hash": V3_DATASET_HASH,
        "eval_id": "WR-TOOL-EVAL-2",
        "eval_hash": eval2_hash,
        "expected_eval_hash": TOOL_EVAL_2_HASH,
        "n_examples": len(records),
        "synthetic_share": split_proof["synthetic_share"],
        "example_class_counts": split_proof["example_class_counts"],
        "limitation": "94.3% synthetic. REAL_RUNTIME=0.",
    })

    summary = {
        "experiment_id": EXP003_ID,
        "title": EXP003_TITLE,
        "lora_module_id": EXP003_LORA_ID,
        "head_module_id": EXP003_HEAD_ID,
        "module_lifecycle_final_state": final_state,
        "core_id": WRIM0_ID,
        "core_file_sha256": proof.file_sha256,
        "tokenizer_sha256": tok_sha,
        "v3_hash": v3_hash,
        "eval2_hash": eval2_hash,
        "core_total_parameters": proof.core_total_parameters,
        "core_trainable_parameters": 0,
        "lora_parameter_count": n_lora,
        "head_parameter_count": n_head,
        "total_trainable_isolated": total_train,
        "pooling": POOLING_STRATEGY,
        "split": {
            "train_count": split_proof["train_count"],
            "validation_count": split_proof["validation_count"],
            "test_count": split_proof["test_count"],
        },
        "leakage_passed": leak_ok,
        "isolation_pass": isolation_pass,
        "experiment_verdict": experiment_verdict,
        "capability_verdict": cap_label,
        "capability_rationale": cap_why,
        "active_core": WRIM0_ID,
        "active_modules": [],
        "production_untouched": True,
        "not_started": [
            "argument extractor training",
            "LoRA r=4",
            "Experiment 004",
            "Recovery-012",
            "WRIM1-RUN-000003",
            "promotion",
        ],
        "reload_ok": reload_ok,
        "best_epoch": train_info["best_epoch"],
        "best_train_loss": best_hist["train_loss"],
        "best_val_loss": best_hist["val_loss"],
        "test_accuracy": test_rep["accuracy"],
        "eval2_accuracy": eval2_rep["accuracy"],
        "eval2_macro_f1": eval2_rep["macro_f1"],
        "artifact_dirs": {"lora": str(lora_dir), "head": str(head_dir)},
        "saved_lora_hashes": saved_lora["hashes"],
        "saved_head_hashes": saved_head["hashes"],
        "timing": timing,
        "train_elapsed_sec": train_elapsed,
        "wall_sec": wall,
        "h1_supported": cap_label == "WR-TOOL V3 LoRA-R2 — CAPABILITY ACQUISITION DEMONSTRATED",
    }
    write_json(work / "experiment-summary.json", summary)
    write_json(work / "final-verdict.json", {
        "experiment_verdict": experiment_verdict,
        "capability_verdict": cap_label,
        "isolation_pass": isolation_pass,
        "module_state": final_state,
        "do_not_promote": True,
        "active_core": WRIM0_ID,
        "active_modules": [],
        "h1_supported": cap_label == "WR-TOOL V3 LoRA-R2 — CAPABILITY ACQUISITION DEMONSTRATED",
        "capability_rationale": cap_why,
    })

    print(experiment_verdict)
    print(cap_label)
    print(
        f"isolation_pass={isolation_pass} test_acc={test_rep['accuracy']:.4f} "
        f"eval2_acc={eval2_rep['accuracy']:.4f} eval2_f1={eval2_rep['macro_f1']:.4f} "
        f"core_diff={core_diff} lora_n={n_lora} head_n={n_head} wall={wall:.1f}s"
    )
    return 0 if isolation_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
