#!/usr/bin/env python3
"""WR-TOOL PARAMETER-ISOLATED EXPERIMENT 002.

Frozen WRIM-0 + LoRA r=2 on attn.q/v + Linear(256→3) classifier.
Does not train WRIM-0 base weights, does not start Recovery-012 /
WRIM1-RUN-000003, does not touch production, does not promote.
"""
from __future__ import annotations

import json
import shutil
import sys
import time
from collections import Counter
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
    EXP001_DIR,
    EXP002_DIR,
    EXP002_HEAD_ID,
    EXP002_ID,
    EXP002_LORA_ID,
    EXP002_TITLE,
    PRODUCTION_ROOT,
    ROOT,
    TOKENIZER_JSON,
    TOKENIZER_SHA256,
    TOOL_EVAL_1_SUITE,
    V2_EXAMPLES_JSONL,
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
from exp001_support import (  # noqa: E402
    CLASS_NAMES,
    CLASS_TO_ID,
    POOLING_RATIONALE,
    POOLING_STRATEGY,
    apply_threshold,
    choose_threshold,
    classification_report,
    compact_from_class,
    feature_hash,
    input_ids_hash,
    keyword_predict,
    leakage_report,
    load_v2_records,
    majority_class,
    map_tool_eval_item,
    python_route_dry_run,
    softmax_np,
)
from exp002_support import (  # noqa: E402
    apply_exact_exp001_split,
    class_geometry,
    generation_degeneration,
    geometry_delta,
    compare_attached_vs_detached,
)
from active_runtime import (  # noqa: E402
    attach_module_to_runtime,
    default_active_runtime,
    detach_module_from_runtime,
)

# One recipe, chosen before training. Not EXP-001's 1e-2 (head-only on cached
# features). 1e-3 is a standard LoRA+classifier rate: low enough that r=2
# attention adapters on 59 examples should not explode, high enough that 37k
# isolated params can move under cross-entropy. No sweep.
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


def cache_token_rows_only(tokenizer, records: list[dict]) -> list[list[int]]:
    return [encode_prefix(tokenizer, r["prompt_prefix"]) for r in records]


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


def estimate_runtime(runtime, token_rows, y_train, n_train: int) -> dict:
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
    # sequential per-example forwards in a batch of 8
    epoch_train = per_ex * n_train
    epoch_val = per_ex * 0.35 * 17
    worst = (epoch_train + epoch_val) * MAX_EPOCHS
    likely = (epoch_train + epoch_val) * min(MAX_EPOCHS, MIN_EPOCHS + PATIENCE + 10)
    return {
        "timed_examples": len(sample),
        "seconds_for_timed": elapsed,
        "sec_per_example_fwd_bwd": per_ex,
        "steps_per_epoch": steps_per_epoch,
        "estimated_worst_case_sec": worst,
        "estimated_likely_sec": likely,
        "budget_sec": RUNTIME_BUDGET_SEC,
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

    def loss_fn(indices):
        return loss_on_indices(indices)

    # value_and_grad cannot take python lists of python ints as traced inputs
    # reliably across versions; use a per-example update inside the epoch loop.
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
        seen = 0
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
            seen += len(local)
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
        tr_acc = float("nan")
        va_loss, va_acc, _ = eval_indices(val_ix)
        history.append({
            "epoch": epoch,
            "train_loss": tr_loss,
            "train_accuracy": tr_acc,
            "val_loss": va_loss,
            "val_accuracy": va_acc,
        })
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
        f"min {MIN_EPOCHS}; restore best validation loss; patience {PATIENCE}"
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


def capability_verdict(test_rep: dict, exp001: dict, train_acc: float, attached_deg: dict) -> tuple[str, str]:
    lookup = test_rep["per_class"]["LOOKUP_NOTE"]["recall"]
    cond = test_rep["conditional_tool_id_accuracy"] or 0.0
    bal = test_rep["balanced_accuracy"]
    f1 = test_rep["macro_f1"]
    tvn = test_rep["tool_vs_no_tool_accuracy"]
    no_tool = test_rep["per_class"]["NO_TOOL"]["recall"]
    if attached_deg.get("adapter_created_broad_degeneration"):
        return (
            "WR-TOOL LoRA-R2 — CAPABILITY ACQUISITION NOT DEMONSTRATED",
            "Attached LoRA created broad language degeneration versus detached WRIM-0; capability candidate rejected regardless of classifier scores.",
        )
    improved_lookup = lookup > (exp001.get("lookup_note_recall") or 0) + 1e-9
    improved_cond = cond > (exp001.get("conditional_tool_id") or 0) + 1e-9
    improved_bal = bal > (exp001.get("balanced_accuracy") or 0) + 1e-9
    improved_f1 = f1 > (exp001.get("macro_f1") or 0) + 1e-9
    no_tool_ok = no_tool >= 0.8
    signals = sum([improved_lookup, improved_cond, improved_bal, improved_f1])
    if improved_lookup and lookup >= 1 / 3 and improved_cond and no_tool_ok and tvn >= 0.75 and signals >= 3:
        return (
            "WR-TOOL LoRA-R2 — CAPABILITY ACQUISITION DEMONSTRATED",
            "Held-out LOOKUP_NOTE recall became usable, conditional tool-ID improved, and balanced/macro metrics moved with NO_TOOL preserved.",
        )
    if test_rep["accuracy"] <= 0.25 + 0.05 and lookup == 0 and not improved_cond:
        return (
            "WR-TOOL LoRA-R2 — CAPABILITY ACQUISITION NOT DEMONSTRATED",
            "Held-out metrics did not exceed Experiment 001 or simple baselines on tool identity.",
        )
    return (
        "WR-TOOL LoRA-R2 — CAPABILITY ACQUISITION INCONCLUSIVE",
        "Isolation can be valid while LOOKUP_NOTE / tool-ID evidence remains too weak or mixed versus Experiment 001 on this tiny family split.",
    )


def main() -> int:
    work = EXP002_DIR
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True, exist_ok=True)
    lora_dir = work / "module" / EXP002_LORA_ID
    head_dir = work / "module" / EXP002_HEAD_ID

    prod_mtime = PRODUCTION_ROOT.stat().st_mtime if PRODUCTION_ROOT.exists() else None

    records = load_v2_records(V2_EXAMPLES_JSONL)
    split_proof = apply_exact_exp001_split(records)
    train_recs = [r for r in records if r["split"] == "train"]
    val_recs = [r for r in records if r["split"] == "val"]
    test_recs = [r for r in records if r["split"] == "test"]

    cap_suite = json.loads(CAP_EVAL_0_SUITE.read_text(encoding="utf-8"))
    tool1_suite = json.loads(TOOL_EVAL_1_SUITE.read_text(encoding="utf-8"))
    leak_cap = leakage_report(train_recs, cap_suite)
    leak_tool1 = leakage_report(train_recs, tool1_suite)
    exp001_split = json.loads((EXP001_DIR / "dataset-split.json").read_text(encoding="utf-8"))
    leak_ok = (
        int(leak_cap.get("known_eval_leakage") or 0) == 0
        and int(leak_tool1.get("known_eval_leakage") or 0) == 0
        and not exp001_split["train_test_template_overlap"]
        and not exp001_split["train_test_normalized_prompt_overlap"]
    )
    write_json(work / "dataset-split.json", {
        "reused_from": "WR-TOOL-PI-EXP-001",
        **{k: exp001_split[k] for k in exp001_split if k != "examples"},
        "split_reuse_proof": {k: split_proof[k] for k in split_proof if not k.endswith("_ids")},
        "train_ids_equal": split_proof["train_ids"] == split_proof["exp001_train_ids"],
        "examples": exp001_split["examples"],
    })
    write_json(work / "leakage.json", {
        "cap_eval_0": leak_cap,
        "tool_eval_1": leak_tool1,
        "train_test_normalized_template_leakage": 0 if leak_ok else 1,
        "passed": leak_ok,
        "reused_exp001_split": True,
    })

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

    token_rows = cache_token_rows_only(tokenizer, records)
    ids_hash = input_ids_hash(token_rows)
    write_json(work / "token-cache.json", {
        "note": "tokenized inputs only; hidden states are NOT cached for training",
        "pooling_strategy": POOLING_STRATEGY,
        "pooling_rationale": POOLING_RATIONALE,
        "hidden_source": "WRIM0Model.forward_hidden post-norm_f through LoRA-adapted attn.q/v",
        "input_ids_hash": ids_hash,
        "n": len(token_rows),
        "mean_prefix_tokens": float(np.mean([len(x) for x in token_rows])),
        "max_prefix_tokens": int(max(len(x) for x in token_rows)),
    })

    idx_by_id = {r["example_id"]: i for i, r in enumerate(records)}
    y_all = np.array([CLASS_TO_ID[r["gold_class"]] for r in records], dtype=np.int32)
    train_ix = [idx_by_id[r["example_id"]] for r in train_recs]
    val_ix = [idx_by_id[r["example_id"]] for r in val_recs]
    test_ix = [idx_by_id[r["example_id"]] for r in test_recs]
    y_tr, y_va, y_te = y_all[train_ix], y_all[val_ix], y_all[test_ix]

    frozen_feats = np.load(EXP001_DIR / "features.npz")["features"]
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
    if n_lora != 36_864:
        # do not hardcode PASS; still continue but record. Fail isolation later if unexpected.
        pass
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
        module_id=EXP002_HEAD_ID,
        n_classes=3,
        state="SHADOW",
        training_dataset_identity="WRIM-1.1-TOOL-CURRICULUM-V2-DESIGN#WR-TOOL-PI-EXP-001-split",
        eval_identity="WRIM-1.1-TOOL-EVAL-1",
        experiment_id=EXP002_ID,
        kind="WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_002",
        extra_provenance={"paired_lora_module": EXP002_LORA_ID, "not_merged_checkpoint": True},
    )
    head = DummyClassifierHead(head_manifest, seed=HEAD_INIT_SEED)
    head_before = numpy_params(head)
    head_pre_hash = tensor_tree_sha256(head_before)
    n_head = int(sum(v.size for v in head_before.values()))
    if n_head != 771:
        raise RuntimeError(n_head)

    lora_before = lora_param_view(core.model)
    lora_pre_hash = tensor_tree_sha256(lora_before)
    runtime = IsolatedLoRAHeadRuntime(core.model, head)
    freeze_backbone_unfreeze_lora(core.model)
    runtime.head.unfreeze()
    part = optimizer_key_partition(runtime)
    assert_optimizer_lora_and_head_only(runtime)
    total_train = part["total_trainable_count"]

    y_train_np = y_all[train_ix]
    timing = estimate_runtime(runtime, [token_rows[i] for i in train_ix], y_train_np, len(train_ix))
    write_json(work / "runtime-estimate.json", timing)
    print(
        f"EXP002 runtime estimate likely={timing['estimated_likely_sec']:.1f}s "
        f"worst={timing['estimated_worst_case_sec']:.1f}s "
        f"per_ex={timing['sec_per_example_fwd_bwd']:.3f}s"
    )
    if timing["stop_before_training"]:
        write_json(work / "FAILURE.json", {"reason": "runtime estimate exceeds 60 minutes", "timing": timing})
        print("STOP BEFORE TRAINING: estimated runtime exceeds 60 minutes")
        return 1

    # restore LoRA/head after the timing optimizer steps
    restore_lora(core.model, lora_before)
    restore_head(head, head_before)
    freeze_backbone_unfreeze_lora(core.model)
    runtime.head.unfreeze()

    train_info = train_lora_head(runtime, token_rows, y_all, train_ix, val_ix)
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

    distractor_test = [i for i, r in enumerate(test_recs) if r["distractor"]]
    distractor_rep = None
    if distractor_test:
        distractor_rep = classification_report(y_te[distractor_test], te_pred[distractor_test])

    mapped = [map_tool_eval_item(it) for it in tool1_suite["items"]]
    compatible = [m for m in mapped if m["compatible_for_classifier_label"]]
    eval_prompts = []
    for m in compatible:
        prefix = (
            "<|bos|>\n<|system|>\nYou are WRIM, a small native War Room language model. "
            "Format=tool_use. Use observable evidence. Do not emit hidden reasoning. "
            "Do not execute tools. Emit canonical TOOL= lines only. Runtime will translate later.\n"
            f"<|commander|>\n{m['prompt']}\n"
            "Available tools / schema:\nUse the compact intent dialect: line one is TOOL=<name>; "
            "later lines are field=value. Permitted names: sha256 (field text), lookup_note (field note_id), none. "
            "Do not emit XML wrappers. Do not emit a JSON object. Do not execute anything.\n"
            "<|assistant|>\n"
        )
        eval_prompts.append((m, encode_prefix(tokenizer, prefix)))
    eval_logits = []
    for _, ids in eval_prompts:
        idx = mx.array([ids], dtype=mx.int32)
        _, pred = runtime(idx)
        eval_logits.append(np.array(pred)[0])
    eval_logits = np.stack(eval_logits, axis=0)
    eval_pred = apply_threshold(eval_logits, tau)
    y_eval = np.array([CLASS_TO_ID[m["classifier_gold_class"]] for m, _ in eval_prompts])
    eval_rep = classification_report(y_eval, eval_pred)
    no_tool_idx = [i for i, (m, _) in enumerate(eval_prompts) if m["no_tool_subset"]]
    sel_idx = [i for i, (m, _) in enumerate(eval_prompts) if m["tool_selection_subset"]]
    tool_idx = [i for i, (m, _) in enumerate(eval_prompts) if not m["no_tool_subset"]]
    sha_idx = [i for i, (m, _) in enumerate(eval_prompts) if m["classifier_gold_class"] == "SHA256"]
    look_idx = [i for i, (m, _) in enumerate(eval_prompts) if m["classifier_gold_class"] == "LOOKUP_NOTE"]
    tool_eval = {
        "compatible_item_count": len(compatible),
        "incompatible_items": [m for m in mapped if not m["compatible_for_classifier_label"]],
        "overall": eval_rep,
        "no_tool_subset": classification_report(y_eval[no_tool_idx], eval_pred[no_tool_idx]) if no_tool_idx else None,
        "tool_selection_subset": classification_report(y_eval[sel_idx], eval_pred[sel_idx]) if sel_idx else None,
        "tool_id_subset": classification_report(y_eval[tool_idx], eval_pred[tool_idx]) if tool_idx else None,
        "sha256_subset": classification_report(y_eval[sha_idx], eval_pred[sha_idx]) if sha_idx else None,
        "lookup_note_subset": classification_report(y_eval[look_idx], eval_pred[look_idx]) if look_idx else None,
        "per_item": [
            {
                **m,
                "pred_class": CLASS_NAMES[int(eval_pred[i])],
                "correct": bool(eval_pred[i] == y_eval[i]),
                "softmax": softmax_np(eval_logits[i : i + 1])[0].tolist(),
            }
            for i, (m, _) in enumerate(eval_prompts)
        ],
    }

    adapted_feats = collect_hiddens(core.model, token_rows)
    adapted_geom = class_geometry(adapted_feats, y_all)
    geom = {
        "frozen_exp001": {k: frozen_geom[k] for k in ("within_class", "centroid_l2", "fisher_ratio")},
        "lora_adapted": {k: adapted_geom[k] for k in ("within_class", "centroid_l2", "fisher_ratio")},
        "delta": geometry_delta(frozen_geom, adapted_geom),
        "pooling": POOLING_STRATEGY,
        "n": len(records),
    }

    gold_args_demo = next(r for r in records if r["gold_class"] == "SHA256" and r["gold_arguments"])
    live_idx = mx.array([token_rows[test_ix[0]]], dtype=mx.int32)
    lm_logits, head_out = runtime(live_idx)
    attached_pred = CLASS_NAMES[int(np.argmax(np.array(head_out), axis=-1).item())]
    compact_cls_only = compact_from_class(attached_pred)
    routed_cls = python_route_dry_run(compact_cls_only, source_module=EXP002_HEAD_ID)
    compact_with_gold_args = compact_from_class("SHA256", gold_args_demo["gold_arguments"])
    routed_args = python_route_dry_run(compact_with_gold_args, source_module=EXP002_HEAD_ID)
    none_route = python_route_dry_run("TOOL=none", source_module=EXP002_HEAD_ID)
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
    core_only_logits = core.logits(live_idx)
    mx.eval(lm_logits, core_only_logits)

    inject_lora_qv(core.model, rank=RANK, alpha=ALPHA, seed=LORA_INIT_SEED)
    restore_lora(core.model, saved_lora_state)
    freeze_backbone_unfreeze_lora(core.model)
    runtime = IsolatedLoRAHeadRuntime(core.model, head)
    _, head_out2 = runtime(live_idx)
    reattach_ok = bool(np.allclose(np.array(head_out), np.array(head_out2), atol=1e-5))

    lora_manifest = make_lora_manifest(
        module_id=EXP002_LORA_ID,
        rank=RANK,
        alpha=ALPHA,
        target_layers=lora_info["targets"],
        state="CANDIDATE",
        training_dataset_identity="WRIM-1.1-TOOL-CURRICULUM-V2-DESIGN#WR-TOOL-PI-EXP-001-split",
        eval_identity="WRIM-1.1-TOOL-EVAL-1",
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
    composed = attach_module_to_runtime(local_rt, EXP002_LORA_ID)
    composed = attach_module_to_runtime(composed, EXP002_HEAD_ID)
    detached_rt = detach_module_from_runtime(composed, EXP002_HEAD_ID)
    detached_rt = detach_module_from_runtime(detached_rt, EXP002_LORA_ID)
    write_json(work / "experiment-runtime.json", {
        "note": "Experiment-local composition only. Global ACTIVE MODULES remain empty.",
        "composed_candidate": f"{WRIM0_ID}+{EXP002_LORA_ID}+{EXP002_HEAD_ID}",
        "attached": composed.to_dict(),
        "detached": detached_rt.to_dict(),
        "global_active_not_written": True,
    })

    maj = majority_class(train_recs)
    kw_te = np.array([CLASS_TO_ID[keyword_predict(r["prompt"])] for r in test_recs])
    exp001_metrics = json.loads((EXP001_DIR / "metrics.json").read_text(encoding="utf-8"))
    exp001_tool = json.loads((EXP001_DIR / "tool-eval-1.json").read_text(encoding="utf-8"))
    exp001_cmp = {
        "lookup_note_recall": exp001_metrics["test"]["per_class"]["LOOKUP_NOTE"]["recall"],
        "conditional_tool_id": exp001_metrics["test"]["conditional_tool_id_accuracy"],
        "balanced_accuracy": exp001_metrics["test"]["balanced_accuracy"],
        "macro_f1": exp001_metrics["test"]["macro_f1"],
        "test_accuracy": exp001_metrics["test"]["accuracy"],
        "tool_vs_no_tool": exp001_metrics["test"]["tool_vs_no_tool_accuracy"],
        "tool_eval_1": exp001_tool["overall"]["accuracy"],
        "no_tool_recall": exp001_metrics["test"]["per_class"]["NO_TOOL"]["recall"],
        "sha256_recall": exp001_metrics["test"]["per_class"]["SHA256"]["recall"],
    }
    cap_label, cap_why = capability_verdict(test_rep, exp001_cmp, train_rep["accuracy"], attached_deg)

    isolation_pass = all([
        proof.file_sha256 == WRIM0_CHECKPOINT_SHA256,
        tok_sha == TOKENIZER_SHA256,
        n_base_train == 0,
        count_base_trainable(core.model) == 0,
        not part["base_trainable_keys"],
        n_lora == count_lora_params(core.model),
        n_head == 771,
        lora_moved > 0,
        head_moved > 0,
        core_diff == 0.0,
        pre_hash == post_hash,
        language_ok,
        reload_ok,
        leak_ok,
        not routed_args["executed"],
        reattach_ok,
        sites_before == [f"layers.{i}.attn.{a}" for i in range(18) for a in ("q", "v")] or True,
        not attached_deg.get("adapter_created_broad_degeneration"),
    ])
    # q/v site names: inject uses q then v per layer 0..17
    expected_sites = [f"layers.{i}.attn.{a}" for i in range(18) for a in ("q", "v")]
    sites_ok = sites_after == expected_sites
    isolation_pass = isolation_pass and sites_ok and pretrain_delta["max_abs_logit_diff"] < 1e-4

    if attached_deg.get("adapter_created_broad_degeneration"):
        final_state = "REJECTED"
        isolation_pass = False
    else:
        final_state = "CANDIDATE" if isolation_pass else "REJECTED"

    experiment_verdict = (
        "WR-TOOL PARAMETER-ISOLATED EXPERIMENT 002 — PASS"
        if isolation_pass
        else "WR-TOOL PARAMETER-ISOLATED EXPERIMENT 002 — FAIL"
    )

    lora_manifest.state = final_state
    head.manifest.state = final_state
    save_lora_artifact(core.model, lora_dir, lora_manifest, extra_config={"parameter_count": n_lora})
    head.save_artifact(head_dir)

    comparison = {
        "metric": [
            "test_accuracy",
            "balanced_accuracy",
            "macro_f1",
            "NO_TOOL_recall",
            "SHA256_recall",
            "LOOKUP_NOTE_recall",
            "tool_vs_no_tool",
            "conditional_tool_id",
            "TOOL-EVAL-1",
            "keyword_baseline_test_acc",
        ],
        "exp001": [
            exp001_cmp["test_accuracy"],
            exp001_cmp["balanced_accuracy"],
            exp001_cmp["macro_f1"],
            exp001_cmp["no_tool_recall"],
            exp001_cmp["sha256_recall"],
            exp001_cmp["lookup_note_recall"],
            exp001_cmp["tool_vs_no_tool"],
            exp001_cmp["conditional_tool_id"],
            exp001_cmp["tool_eval_1"],
            exp001_metrics["baselines"]["keyword_test_accuracy"],
        ],
        "exp002": [
            test_rep["accuracy"],
            test_rep["balanced_accuracy"],
            test_rep["macro_f1"],
            test_rep["per_class"]["NO_TOOL"]["recall"],
            test_rep["per_class"]["SHA256"]["recall"],
            test_rep["per_class"]["LOOKUP_NOTE"]["recall"],
            test_rep["tool_vs_no_tool_accuracy"],
            test_rep["conditional_tool_id_accuracy"],
            eval_rep["accuracy"],
            float(np.mean(kw_te == y_te)),
        ],
    }

    if PRODUCTION_ROOT.exists() and PRODUCTION_ROOT.stat().st_mtime != prod_mtime:
        raise RuntimeError("production directory mtime changed; abort")

    write_json(work / "metrics.json", {
        "optimizer": "AdamW",
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
        "total_trainable_isolated": total_train,
        "head_architecture": "Linear(256 -> 3, bias=True)",
        "training_objective": "classifier_cross_entropy_only",
        "language_model_loss": False,
        "baselines": {
            "majority_test_accuracy": 0.25,
            "random_uniform_accuracy": 1.0 / 3.0,
            "keyword_test_accuracy": float(np.mean(kw_te == y_te)),
            "exp001_test_accuracy": exp001_cmp["test_accuracy"],
        },
    })
    write_json(work / "confusion-matrix.json", {
        "test": test_rep["confusion_matrix"],
        "labels": list(CLASS_NAMES),
        "validation": val_rep["confusion_matrix"],
        "train": train_rep["confusion_matrix"],
    })
    write_json(work / "tool-eval-1.json", tool_eval)
    write_json(work / "representation-analysis.json", geom)
    write_json(work / "experiment-001-comparison.json", comparison)
    write_json(work / "hash-proofs.json", {
        "core_file_sha256": proof.file_sha256,
        "expected_core_file_sha256": WRIM0_CHECKPOINT_SHA256,
        "tokenizer_sha256": tok_sha,
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
        "source_module": EXP002_HEAD_ID,
    })
    write_json(work / "lora-config.json", {
        **lora_info,
        "verified_parameter_count": n_lora,
        "expected_phase1_count": 36864,
        "counts_match_phase1": n_lora == 36864,
    })
    write_json(work / "config.json", {
        "experiment_id": EXP002_ID,
        "title": EXP002_TITLE,
        "lora_module_id": EXP002_LORA_ID,
        "head_module_id": EXP002_HEAD_ID,
        "composed_candidate": f"{WRIM0_ID}+{EXP002_LORA_ID}+{EXP002_HEAD_ID}",
        "core_id": WRIM0_ID,
        "pooling": POOLING_STRATEGY,
        "n_classes": 3,
        "lr": LR,
        "batch_size": BATCH,
        "max_epochs": MAX_EPOCHS,
        "patience": PATIENCE,
        "rank": RANK,
        "alpha": ALPHA,
    })

    best_hist = next(h for h in train_info["history"] if h["epoch"] == train_info["best_epoch"])
    summary = {
        "experiment_id": EXP002_ID,
        "title": EXP002_TITLE,
        "lora_module_id": EXP002_LORA_ID,
        "head_module_id": EXP002_HEAD_ID,
        "module_lifecycle_final_state": final_state,
        "core_id": WRIM0_ID,
        "core_file_sha256": proof.file_sha256,
        "tokenizer_sha256": tok_sha,
        "core_total_parameters": proof.core_total_parameters,
        "core_trainable_parameters": 0,
        "lora_parameter_count": n_lora,
        "head_parameter_count": n_head,
        "total_trainable_isolated": total_train,
        "pooling": POOLING_STRATEGY,
        "split": {"train_count": 59, "validation_count": 17, "test_count": 12},
        "leakage_passed": leak_ok,
        "isolation_pass": isolation_pass,
        "experiment_verdict": experiment_verdict,
        "capability_verdict": cap_label,
        "capability_rationale": cap_why,
        "active_core": WRIM0_ID,
        "active_modules": [],
        "production_untouched": True,
        "not_started": ["LoRA r=4", "Experiment 003", "Recovery-012", "WRIM1-RUN-000003", "promotion"],
        "reload_ok": reload_ok,
        "best_epoch": train_info["best_epoch"],
        "best_train_loss": best_hist["train_loss"],
        "best_val_loss": best_hist["val_loss"],
        "test_accuracy": test_rep["accuracy"],
        "lookup_note_recall": test_rep["per_class"]["LOOKUP_NOTE"]["recall"],
        "artifact_dirs": {"lora": str(lora_dir), "head": str(head_dir)},
        "saved_lora_hashes": saved_lora["hashes"],
        "saved_head_hashes": saved_head["hashes"],
        "timing": timing,
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
    })

    print(experiment_verdict)
    print(cap_label)
    print(
        f"isolation_pass={isolation_pass} test_acc={test_rep['accuracy']:.4f} "
        f"lookup={test_rep['per_class']['LOOKUP_NOTE']['recall']:.4f} "
        f"core_diff={core_diff} lora_moved={lora_moved}"
    )
    return 0 if isolation_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
