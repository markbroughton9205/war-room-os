#!/usr/bin/env python3
"""WR-TOOL PARAMETER-ISOLATED EXPERIMENT 001.

Tiny CLASSIFIER_HEAD on frozen WRIM-0 hidden states. Does not train WRIM-0,
does not use LoRA, does not start Recovery-012 / WRIM1-RUN-000003, does not
touch production, does not promote.
"""
from __future__ import annotations

import json
import shutil
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR))

from paths import (  # noqa: E402
    CAP_EVAL_0_SUITE,
    DIAGNOSTIC_SUITE,
    EXP001_DIR,
    EXP001_ID,
    EXP001_MODULE_ID,
    EXP001_TITLE,
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
from capability_module import DummyClassifierHead, make_tool_head_manifest  # noqa: E402
from trainable_selection import (  # noqa: E402
    IsolatedCapabilityRuntime,
    assert_optimizer_excludes_core,
    flatten_keys,
    partition_parameters,
)
from active_runtime import (  # noqa: E402
    attach_module_to_runtime,
    default_active_runtime,
    detach_module_from_runtime,
)
from hashes import sha256_file, sha256_json, tensor_tree_sha256  # noqa: E402
from exp001_support import (  # noqa: E402
    CLASS_NAMES,
    CLASS_TO_ID,
    POOLING_RATIONALE,
    POOLING_STRATEGY,
    apply_threshold,
    choose_threshold,
    classification_report,
    compact_from_class,
    family_aware_split,
    feature_hash,
    input_ids_hash,
    keyword_predict,
    leakage_report,
    load_v2_records,
    majority_class,
    map_tool_eval_item,
    prompt_prefix,
    python_route_dry_run,
    softmax_np,
)

LR = 1e-2
BETAS = (0.9, 0.999)
WEIGHT_DECAY = 0.01
BATCH = 8
MAX_EPOCHS = 100
PATIENCE = 12
MIN_EPOCHS = 5
SEED = 20260831
HEAD_INIT_SEED = 11


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
    return {
        "continuation": continuation,
        "new_ids": new_ids,
    }


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


def encode_all(tokenizer, records: list[dict]) -> list[list[int]]:
    return [encode_prefix(tokenizer, r["prompt_prefix"]) for r in records]


def cache_features(core, token_rows: list[list[int]]) -> np.ndarray:
    import mlx.core as mx

    feats = []
    for ids in token_rows:
        idx = mx.array([ids], dtype=mx.int32)
        _, hidden = core.forward_hidden(idx)
        last = hidden[:, -1, :]
        mx.eval(last)
        feats.append(np.array(last.astype(mx.float32))[0])
    return np.stack(feats, axis=0).astype(np.float32)


def batches(n: int, batch: int, rng: np.random.Generator):
    order = rng.permutation(n)
    for i in range(0, n, batch):
        yield order[i : i + batch]


def train_head(head, x_train, y_train, x_val, y_val):
    import mlx.core as mx
    import mlx.nn as nn
    import mlx.optimizers as optim
    import mlx.utils

    rng = np.random.default_rng(SEED)
    opt = optim.AdamW(learning_rate=LR, betas=BETAS, weight_decay=WEIGHT_DECAY)
    opt_keys = flatten_keys(head.trainable_parameters())
    if not opt_keys:
        raise RuntimeError("optimizer has no head parameters")

    def loss_fn(xb, yb):
        logits = head(xb)
        return mx.mean(nn.losses.cross_entropy(logits, yb))

    loss_and_grad = nn.value_and_grad(head, loss_fn)
    history = []
    best_state = numpy_params(head)
    best_epoch = 0
    best_val = float("inf")
    stall = 0

    def eval_split(x_np, y_np):
        logits = np.array(head(mx.array(x_np)))
        pred = np.argmax(logits, axis=1)
        loss = float(np.mean(np.log(softmax_np(logits)[np.arange(len(y_np)), y_np] + 1e-12) * -1))
        acc = float(np.mean(pred == y_np))
        return loss, acc, logits

    for epoch in range(1, MAX_EPOCHS + 1):
        losses = []
        correct = 0
        seen = 0
        for idx in batches(len(y_train), BATCH, rng):
            xb = mx.array(x_train[idx])
            yb = mx.array(y_train[idx])
            loss, grads = loss_and_grad(xb, yb)
            grad_keys = flatten_keys(grads)
            if "core" in " ".join(grad_keys):
                raise RuntimeError(f"unexpected grad keys {grad_keys}")
            opt.update(head, grads)
            mx.eval(head.parameters())
            losses.append(float(loss.item()))
            pred = np.argmax(np.array(head(xb)), axis=1)
            correct += int(np.sum(pred == y_train[idx]))
            seen += len(idx)
        tr_loss = float(np.mean(losses))
        tr_acc = correct / max(1, seen)
        va_loss, va_acc, _ = eval_split(x_val, y_val)
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
            best_state = numpy_params(head)
            stall = 0
        else:
            stall += 1
        if epoch >= MIN_EPOCHS and stall >= PATIENCE:
            break

    import mlx.core as mx
    import mlx.utils

    tree = mlx.utils.tree_unflatten([(k, mx.array(v)) for k, v in best_state.items()])
    head.update(tree)
    mx.eval(head.parameters())
    return {
        "history": history,
        "stopped_epoch": history[-1]["epoch"],
        "best_epoch": best_epoch,
        "early_stop_rule": (
            f"AdamW on cached features only; max {MAX_EPOCHS} epochs; "
            f"min {MIN_EPOCHS}; restore best val loss; patience {PATIENCE}"
        ),
        "optimizer_param_keys": sorted(opt_keys),
        "optimizer_contains_core": False,
    }


def predict_logits(head, x_np):
    import mlx.core as mx
    return np.array(head(mx.array(x_np)))


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


def capability_verdict(test_rep: dict, majority_acc: float, keyword_acc: float, train_acc: float) -> tuple[str, str]:
    test_acc = test_rep["accuracy"]
    bal = test_rep["balanced_accuracy"]
    tvn = test_rep["tool_vs_no_tool_accuracy"]
    cond = test_rep["conditional_tool_id_accuracy"]
    overfit = train_acc >= 0.9 and test_acc <= majority_acc + 0.05
    above_maj = test_acc >= majority_acc + 0.10 and bal >= majority_acc + 0.08
    tool_ok = tvn >= 0.70
    cond_ok = cond is not None and cond >= 0.55
    if overfit:
        return (
            "WR-TOOL HEAD — CAPABILITY ACQUISITION NOT DEMONSTRATED",
            "Train accuracy is high while held-out family accuracy is not above majority by a meaningful margin (overfit).",
        )
    if above_maj and tool_ok and cond_ok:
        return (
            "WR-TOOL HEAD — CAPABILITY ACQUISITION DEMONSTRATED",
            "Held-out family metrics beat majority/random by a clear margin with TOOL vs NO_TOOL discrimination and non-trivial tool-id accuracy.",
        )
    if test_acc > majority_acc + 0.02 or (cond is not None and cond > 0.5 + 0.05):
        return (
            "WR-TOOL HEAD — CAPABILITY ACQUISITION INCONCLUSIVE",
            "Some held-out signal exists but it is not clearly above keyword/majority on this tiny family-held-out set.",
        )
    return (
        "WR-TOOL HEAD — CAPABILITY ACQUISITION NOT DEMONSTRATED",
        "Held-out classifier performance is not clearly above majority/random under family-aware split.",
    )


def main() -> int:
    work = EXP001_DIR
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True, exist_ok=True)
    module_dir = work / "module" / EXP001_MODULE_ID
    proofs: dict = {}

    if PRODUCTION_ROOT.exists():
        prod_mtime = PRODUCTION_ROOT.stat().st_mtime
    else:
        prod_mtime = None

    records = load_v2_records(V2_EXAMPLES_JSONL)
    split_meta = family_aware_split(records)
    if split_meta["train_test_template_overlap"] or split_meta["train_test_normalized_prompt_overlap"]:
        write_json(work / "FAILURE.json", {"reason": "train/test leakage", "split": split_meta})
        return 1

    train_recs = [r for r in records if r["split"] == "train"]
    val_recs = [r for r in records if r["split"] == "val"]
    test_recs = [r for r in records if r["split"] == "test"]

    cap_suite = json.loads(CAP_EVAL_0_SUITE.read_text(encoding="utf-8"))
    tool1_suite = json.loads(TOOL_EVAL_1_SUITE.read_text(encoding="utf-8"))
    leak_cap = leakage_report(train_recs, cap_suite)
    leak_tool1 = leakage_report(train_recs, tool1_suite)
    leak_ok = (
        int(leak_cap.get("known_eval_leakage") or 0) == 0
        and int(leak_tool1.get("known_eval_leakage") or 0) == 0
        and not split_meta["train_test_template_overlap"]
        and not split_meta["train_test_normalized_prompt_overlap"]
    )

    write_json(work / "dataset-split.json", {
        "source": str(V2_EXAMPLES_JSONL.relative_to(ROOT)),
        "n": len(records),
        "class_mapping": {
            "observed_v2_tools": ["none", "sha256", "lookup_note"],
            "classifier_classes": list(CLASS_NAMES),
            "OTHER_TOOL": "not used — V2 catalog has no additional tools",
            "label_source": "validator.expected.tool (semantic intent, not generation targets)",
        },
        **split_meta,
        "examples": [
            {
                "example_id": r["example_id"],
                "split": r["split"],
                "gold_class": r["gold_class"],
                "gold_decision": r["gold_decision"],
                "gold_tool": r["gold_tool"],
                "semantic_family": r["semantic_family"],
                "template_family": r["template_family"],
                "provenance": r["provenance"],
                "distractor": r["distractor"],
            }
            for r in records
        ],
    })
    write_json(work / "leakage.json", {
        "cap_eval_0": leak_cap,
        "tool_eval_1": leak_tool1,
        "train_test_normalized_template_leakage": 0 if leak_ok else 1,
        "passed": leak_ok,
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
        raise RuntimeError("core not frozen")

    diag_suite = json.loads(DIAGNOSTIC_SUITE.read_text(encoding="utf-8"))
    items = list(diag_suite["items"])
    if len(items) != 13:
        raise RuntimeError(f"expected 13 diagnostic probes, got {len(items)}")
    diag_before = run_diagnostics(core.model, tokenizer, items)

    token_rows = encode_all(tokenizer, records)
    features = cache_features(core, token_rows)
    if features.shape != (len(records), 256):
        raise RuntimeError(f"bad feature shape {features.shape}")
    cache_id = "WR-TOOL-PI-EXP-001-FEATURES-V1"
    feat_hash = feature_hash(features)
    ids_hash = input_ids_hash(token_rows)
    cache_manifest = {
        "feature_cache_id": cache_id,
        "core_id": WRIM0_ID,
        "core_file_sha256": proof.file_sha256,
        "core_weight_tree_sha256": pre_hash,
        "tokenizer_sha256": tok_sha,
        "pooling_strategy": POOLING_STRATEGY,
        "pooling_rationale": POOLING_RATIONALE,
        "hidden_source": "WRIM0Model.forward_hidden post-norm_f",
        "feature_shape": list(features.shape),
        "feature_hash": feat_hash,
        "input_ids_hash": ids_hash,
        "n": len(records),
        "labels_not_in_feature_file": True,
        "held_out_labels_not_used_for_training": True,
    }
    np.savez_compressed(work / "features.npz", features=features, example_ids=np.array([r["example_id"] for r in records]))
    write_json(work / "feature-cache.json", cache_manifest)

    idx_by_id = {r["example_id"]: i for i, r in enumerate(records)}

    def stack_split(recs):
        ix = [idx_by_id[r["example_id"]] for r in recs]
        y = np.array([CLASS_TO_ID[r["gold_class"]] for r in recs], dtype=np.int32)
        return features[ix], y, ix

    x_tr, y_tr, _ = stack_split(train_recs)
    x_va, y_va, _ = stack_split(val_recs)
    x_te, y_te, _ = stack_split(test_recs)

    maj = majority_class(train_recs)
    maj_pred_te = np.array([CLASS_TO_ID[maj]] * len(y_te))
    kw_te = np.array([CLASS_TO_ID[keyword_predict(r["prompt"])] for r in test_recs])
    rng_chance = 1.0 / len(CLASS_NAMES)
    train_prior = Counter(r["gold_class"] for r in train_recs)
    random_prior_acc = sum((train_prior[c] / len(train_recs)) ** 2 for c in CLASS_NAMES)
    baselines = {
        "majority_class": maj,
        "majority_test_accuracy": float(np.mean(maj_pred_te == y_te)),
        "majority_test_report": classification_report(y_te, maj_pred_te),
        "random_uniform_accuracy": rng_chance,
        "random_according_to_train_prior_expected_accuracy": random_prior_acc,
        "keyword_test_accuracy": float(np.mean(kw_te == y_te)),
        "keyword_test_report": classification_report(y_te, kw_te),
        "keyword_rule": "deterministic cues: none/refuse/missing-arg; else sha256 vs lookup_note name/hash/note patterns",
    }

    head_before_params = None
    manifest = make_tool_head_manifest(
        module_id=EXP001_MODULE_ID,
        n_classes=len(CLASS_NAMES),
        state="SHADOW",
        training_dataset_identity="WRIM-1.1-TOOL-CURRICULUM-V2-DESIGN#WR-TOOL-PI-EXP-001-split",
        eval_identity="WRIM-1.1-TOOL-EVAL-1",
    )
    head = DummyClassifierHead(manifest, seed=HEAD_INIT_SEED)
    head_before = numpy_params(head)
    head_pre_hash = tensor_tree_sha256(head_before)
    part = partition_parameters(core, head)
    if part["core_trainable_count"] != 0:
        raise RuntimeError("core trainable after head create")
    if part["capability_trainable_count"] != 256 * 3 + 3:
        raise RuntimeError(part["capability_trainable_count"])

    import mlx.core as mx

    assert_optimizer_excludes_core(flatten_keys(head.trainable_parameters()), core)

    train_info = train_head(head, x_tr, y_tr, x_va, y_va)
    head.manifest.state = "CANDIDATE"
    head.manifest.trainable_parameter_count = part["capability_trainable_count"]
    head_after = numpy_params(head)
    head_post_hash = tensor_tree_sha256(head_after)
    head_moved = max_abs_diff(head_before, head_after)
    if head_moved == 0.0:
        raise RuntimeError("head parameters did not move")

    post_hash = core.weight_tree_hash()
    core_diff = max_abs_diff(pre_snap, core.snapshot_params())
    if post_hash != pre_hash or core_diff != 0.0:
        write_json(work / "FAILURE.json", {
            "reason": "CORE DRIFT",
            "pre": pre_hash,
            "post": post_hash,
            "max_abs_diff": core_diff,
        })
        head.manifest.state = "REJECTED"
        head.save_artifact(module_dir)
        return 1

    tr_logits = predict_logits(head, x_tr)
    va_logits = predict_logits(head, x_va)
    te_logits = predict_logits(head, x_te)
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
    eval_feats = cache_features(core, [ids for _, ids in eval_prompts])
    eval_logits = predict_logits(head, eval_feats)
    eval_pred = apply_threshold(eval_logits, tau)
    y_eval = np.array([CLASS_TO_ID[m["classifier_gold_class"]] for m, _ in eval_prompts])
    eval_rep = classification_report(y_eval, eval_pred)
    no_tool_idx = [i for i, (m, _) in enumerate(eval_prompts) if m["no_tool_subset"]]
    sel_idx = [i for i, (m, _) in enumerate(eval_prompts) if m["tool_selection_subset"]]
    tool_idx = [i for i, (m, _) in enumerate(eval_prompts) if not m["no_tool_subset"]]
    tool_eval = {
        "compatible_item_count": len(compatible),
        "incompatible_items": [m for m in mapped if not m["compatible_for_classifier_label"]],
        "items_not_scored_as_generation": [
            {"eval_id": m["eval_id"], "classifier_does_not_score": m["classifier_does_not_score"]}
            for m in mapped if m["classifier_does_not_score"]
        ],
        "overall": eval_rep,
        "no_tool_subset": classification_report(y_eval[no_tool_idx], eval_pred[no_tool_idx]) if no_tool_idx else None,
        "tool_selection_subset": classification_report(y_eval[sel_idx], eval_pred[sel_idx]) if sel_idx else None,
        "tool_id_subset": classification_report(y_eval[tool_idx], eval_pred[tool_idx]) if tool_idx else None,
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

    attached = head.attach(core)
    live_idx = mx.array([token_rows[idx_by_id[test_recs[0]["example_id"]]]], dtype=mx.int32)
    lm_logits, head_out = attached.forward(live_idx)
    attached_pred = CLASS_NAMES[int(np.argmax(np.array(head_out), axis=-1).item())]
    detached_mod = attached.detach()
    core_only_logits = core.logits(live_idx)
    mx.eval(lm_logits, core_only_logits)
    attach_detach_proof = {
        "attached_head_emits_decision": attached_pred,
        "detached_returns_module_id": detached_mod.manifest.module_id,
        "lm_logits_shape": list(lm_logits.shape),
        "core_only_logits_shape": list(core_only_logits.shape),
        "detached_core_logits_equal_attached_lm_logits": bool(
            np.allclose(np.array(lm_logits), np.array(core_only_logits), atol=0.0, rtol=0.0)
        ),
    }

    runtime = IsolatedCapabilityRuntime(core, head)
    opt_keys = flatten_keys(runtime.trainable_parameters())
    assert_optimizer_excludes_core(opt_keys, core)
    isolation_live = {
        "isolated_runtime_trainable_keys": sorted(opt_keys),
        "core_keys_in_optimizer": sorted(opt_keys & flatten_keys(core.model.parameters())),
    }

    gold_args_demo = next(r for r in records if r["gold_class"] == "SHA256" and r["gold_arguments"])
    pred_cls = attached_pred
    compact_cls_only = compact_from_class(pred_cls)
    routed_cls = python_route_dry_run(compact_cls_only)
    compact_with_gold_args = compact_from_class("SHA256", gold_args_demo["gold_arguments"])
    routed_args = python_route_dry_run(compact_with_gold_args)
    none_route = python_route_dry_run("TOOL=none")
    if routed_args.get("executed") or routed_cls.get("executed") or none_route.get("executed"):
        raise RuntimeError("execution boundary violated")
    router_proof = {
        "classifier_class_only_intent": compact_cls_only,
        "classifier_class_only_route": {k: routed_cls[k] for k in routed_cls if k != "intent"} | {"parse_status": routed_cls["intent"]["parse_status"], "decision": routed_cls["intent"]["decision"]},
        "note": "class-only TOOL=sha256 without args is expected MISSING_ARGUMENT; that is classifier-scope, not a router bug",
        "gold_arg_fixture_not_used_as_eval_score": compact_with_gold_args,
        "gold_arg_dry_run": {
            "executed": routed_args["executed"],
            "stageReached": routed_args["stageReached"],
            "execution_mode": routed_args["execution_mode"],
            "validation": routed_args["validation"],
            "dry_run_result": routed_args.get("dry_run_result"),
        },
        "no_tool_route": {"executed": none_route["executed"], "decision": none_route["intent"]["decision"], "validation": none_route["validation"]},
        "live_tools_executed": False,
    }

    saved = head.save_artifact(module_dir)
    loaded = DummyClassifierHead.load_artifact(module_dir)
    loaded.validate_compatibility(core)
    reload_logits = np.array(loaded(mx.array(x_te[:1])))
    live_reload = np.array(head(mx.array(x_te[:1])))
    reload_ok = bool(np.allclose(reload_logits, live_reload, atol=1e-6))

    local_rt = default_active_runtime()
    composed = attach_module_to_runtime(local_rt, EXP001_MODULE_ID)
    detached_rt = detach_module_from_runtime(composed, EXP001_MODULE_ID)
    write_json(work / "experiment-runtime.json", {
        "note": "Experiment-local composition only. Global ACTIVE MODULES remain empty.",
        "attached": composed.to_dict(),
        "detached": detached_rt.to_dict(),
        "global_active_not_written": True,
    })

    diag_after = run_diagnostics(core.model, tokenizer, items)
    language_ok = diag_before["output_hash"] == diag_after["output_hash"]
    if not language_ok:
        write_json(work / "FAILURE.json", {"reason": "detached WRIM-0 output changed", "before": diag_before["output_hash"], "after": diag_after["output_hash"]})
        return 1

    isolation_pass = all([
        proof.file_sha256 == WRIM0_CHECKPOINT_SHA256,
        tok_sha == TOKENIZER_SHA256,
        proof.core_trainable_parameters == 0,
        not isolation_live["core_keys_in_optimizer"],
        head_moved > 0,
        core_diff == 0.0,
        pre_hash == post_hash,
        attach_detach_proof["detached_core_logits_equal_attached_lm_logits"],
        reload_ok,
        leak_ok,
        language_ok,
        not routed_args["executed"],
    ])

    cap_label, cap_why = capability_verdict(
        test_rep,
        baselines["majority_test_accuracy"],
        baselines["keyword_test_accuracy"],
        train_rep["accuracy"],
    )
    experiment_verdict = (
        "WR-TOOL PARAMETER-ISOLATED EXPERIMENT 001 — PASS"
        if isolation_pass
        else "WR-TOOL PARAMETER-ISOLATED EXPERIMENT 001 — FAIL"
    )

    final_state = "CANDIDATE" if isolation_pass else "REJECTED"
    head.manifest.state = final_state
    head.save_artifact(module_dir)

    experience_hook = {
        "ledger": "existing agi-experience hooks only; no parallel ledger written",
        "capture_shape": {
            "composedRuntimeId": composed.composed_runtime_id,
            "capability_family": "tool_use",
            "decision": "TOOL" if pred_cls != "NO_TOOL" else "NO_TOOL",
            "selected_tool": None if pred_cls == "NO_TOOL" else CLASS_TO_ID and {"SHA256": "sha256", "LOOKUP_NOTE": "lookup_note"}.get(pred_cls),
        },
    }

    metrics = {
        "optimizer": "AdamW",
        "learning_rate": LR,
        "betas": list(BETAS),
        "weight_decay": WEIGHT_DECAY,
        "batch_size": BATCH,
        "seed": SEED,
        "head_init_seed": HEAD_INIT_SEED,
        "epoch_policy": train_info["early_stop_rule"],
        "stopped_epoch": train_info["stopped_epoch"],
        "best_epoch": train_info["best_epoch"],
        "history": train_info["history"],
        "threshold": thresh,
        "train": train_rep,
        "validation": val_rep,
        "test": test_rep,
        "distractor_test": distractor_rep,
        "baselines": baselines,
        "head_parameter_count": part["capability_trainable_count"],
        "head_architecture": "Linear(256 -> 3, bias=True)",
        "training_objective": "classifier_cross_entropy_only",
        "language_model_loss": False,
    }
    write_json(work / "metrics.json", metrics)
    write_json(work / "confusion-matrix.json", {
        "test": test_rep["confusion_matrix"],
        "labels": list(CLASS_NAMES),
        "validation": val_rep["confusion_matrix"],
    })
    write_json(work / "tool-eval-1.json", tool_eval)
    write_json(work / "hash-proofs.json", {
        "core_file_sha256": proof.file_sha256,
        "expected_core_file_sha256": WRIM0_CHECKPOINT_SHA256,
        "tokenizer_sha256": tok_sha,
        "pre_training_core_weight_tree_hash": pre_hash,
        "post_training_core_weight_tree_hash": post_hash,
        "core_max_abs_diff": core_diff,
        "head_pre_hash": head_pre_hash,
        "head_post_hash": head_post_hash,
        "head_max_abs_diff": head_moved,
        "feature_hash": feat_hash,
    })
    write_json(work / "language-stability.json", {
        "before_hash": diag_before["output_hash"],
        "after_hash": diag_after["output_hash"],
        "identical": language_ok,
        "n_probes": 13,
        "before": [{"id": g["id"], "continuation": g["continuation"]} for g in diag_before["items"]],
        "after": [{"id": g["id"], "continuation": g["continuation"]} for g in diag_after["items"]],
    })
    write_json(work / "attach-detach.json", attach_detach_proof)
    write_json(work / "optimizer-isolation.json", {
        **isolation_live,
        "train_optimizer_keys": train_info["optimizer_param_keys"],
        "partition": {
            "core_total": part["core_total_parameters"],
            "core_trainable": part["core_trainable_count"],
            "head_trainable": part["capability_trainable_count"],
            "head_keys": part["capability_parameters"],
        },
    })
    write_json(work / "tool-router.json", router_proof)
    write_json(work / "config.json", {
        "experiment_id": EXP001_ID,
        "title": EXP001_TITLE,
        "module_id": EXP001_MODULE_ID,
        "module_type": "CLASSIFIER_HEAD",
        "core_id": WRIM0_ID,
        "pooling": POOLING_STRATEGY,
        "n_classes": 3,
        "lr": LR,
        "batch_size": BATCH,
        "max_epochs": MAX_EPOCHS,
    })

    if PRODUCTION_ROOT.exists() and PRODUCTION_ROOT.stat().st_mtime != prod_mtime:
        raise RuntimeError("production directory mtime changed; abort")

    summary = {
        "experiment_id": EXP001_ID,
        "title": EXP001_TITLE,
        "module_id": EXP001_MODULE_ID,
        "module_type": "CLASSIFIER_HEAD",
        "module_lifecycle_final_state": final_state,
        "core_id": WRIM0_ID,
        "core_file_sha256": proof.file_sha256,
        "tokenizer_sha256": tok_sha,
        "core_total_parameters": proof.core_total_parameters,
        "core_trainable_parameters": proof.core_trainable_parameters,
        "head_architecture": metrics["head_architecture"],
        "head_parameter_count": part["capability_trainable_count"],
        "pooling": POOLING_STRATEGY,
        "feature_shape": list(features.shape),
        "feature_cache_id": cache_id,
        "feature_hash": feat_hash,
        "split": {k: split_meta[k] for k in ("train_count", "validation_count", "test_count", "split_method")},
        "leakage_passed": leak_ok,
        "isolation_pass": isolation_pass,
        "experiment_verdict": experiment_verdict,
        "capability_verdict": cap_label,
        "capability_rationale": cap_why,
        "active_core": WRIM0_ID,
        "active_modules": [],
        "production_untouched": True,
        "not_started": ["LoRA r=2", "Experiment 002", "Recovery-012", "WRIM1-RUN-000003", "promotion"],
        "experience_hook": experience_hook,
        "reload_ok": reload_ok,
        "artifact_dir": str(module_dir),
        "saved_hashes": saved["hashes"],
    }
    write_json(work / "experiment-summary.json", summary)
    write_json(work / "final-verdict.json", {
        "experiment_verdict": experiment_verdict,
        "capability_verdict": cap_label,
        "isolation_pass": isolation_pass,
        "module_state": final_state,
        "do_not_promote": True,
    })

    print(experiment_verdict)
    print(cap_label)
    print(f"isolation_pass={isolation_pass} test_acc={test_rep['accuracy']:.4f} bal={test_rep['balanced_accuracy']:.4f}")
    print(f"core_diff={core_diff} head_moved={head_moved} leak_ok={leak_ok}")
    return 0 if isolation_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
