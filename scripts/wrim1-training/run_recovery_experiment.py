#!/usr/bin/env python3
"""TEST-WRIM1.1-RECOVERY-001. TEST_ONLY. Not official WRIM lineage. Not production."""
from __future__ import annotations

import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from tokenizers import Tokenizer, decoders

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))

from checkpoint_io import (  # noqa: E402
    load_bundle,
    load_model_weights,
    load_parent_wrim0_weights,
    model_to_numpy,
    register_checkpoint,
    write_checkpoint_bundle,
)
from constants import (  # noqa: E402
    PARENT_CHECKPOINT_REL,
    PARENT_CHECKPOINT_SHA256,
    TOKENIZER_REL,
    TOKENIZER_SHA256,
)
from contiguous_pack import materialize_recovery_mix  # noqa: E402
from dataset_cursor import DatasetCursor, initial_cursor, next_batch  # noqa: E402
from diagnose_collapse import generate, stats, topk_diag  # noqa: E402
from hashes import sha256_file, sha256_json, tensor_tree_sha256  # noqa: E402
from paths import official_ckpt_dir, repo_root  # noqa: E402
from rng_state import capture_rng, lr_at_step  # noqa: E402
from trainer_core import append_metric, apply_mlx_limits, build_from_config, reconstruct_optimizer  # noqa: E402
from training_config import official_training_config, optimizer_config_from_training  # noqa: E402

EXPERIMENT_ID = "TEST-WRIM1.1-RECOVERY-001"
WORK_REL = "model-lab/manifests/wrim1_1_recovery/test-only"
FROZEN_SUITE_REL = "model-lab/manifests/wave9/test-only/WRIM-RECOVERY-DIAGNOSTIC-0.json"
MAX_STEPS = 150
DIAG_STEPS = (0, 25, 50, 100, 150)
PEAK_LR = 3e-4
WARMUP = 25
BATCH = 8
CTX = 512
SEED = 20260830


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_tokenizer(root: Path) -> Tokenizer:
    path = root / TOKENIZER_REL
    if sha256_file(path) != TOKENIZER_SHA256:
        raise RuntimeError("tokenizer hash mismatch")
    tok = Tokenizer.from_file(str(path))
    if tok.decoder is None:
        tok.decoder = decoders.ByteLevel()
    return tok


def recovery_config() -> dict:
    cfg = official_training_config()
    cfg.update({
        "learning_rate": PEAK_LR,
        "warmup_steps": WARMUP,
        "total_steps": MAX_STEPS,
        "batch_size": BATCH,
        "context_length": CTX,
        "validation_cadence_steps": 25,
        "checkpoint_cadence_steps": 25,
        "seed": SEED,
        "shuffle_strategy": "document_permutation_then_contiguous_windows",
        "test_only": True,
        "promotable": False,
        "lineage": "NOT_OFFICIAL_WRIM_LINEAGE",
        "experiment_id": EXPERIMENT_ID,
        "lr_rationale": (
            "Continued pretraining from finished WRIM-0. Genesis peak 3e-3 is from-scratch. "
            "Recovery uses 3e-4 (10x lower), warmup 25 of 150, cosine to 10% floor."
        ),
    })
    return cfg


def run_suite(model, tokenizer, items: list[dict], max_new: int = 32) -> dict:
    gens = []
    collapsed_n = 0
    echo_vals = []
    period_fracs = []
    uniq = []
    eos_n = 0
    json_ok = None
    for item in items:
        g = generate(model, tokenizer, item["input"], max_new, temperature=0.0)
        st = stats(item["input"], g, tokenizer)
        if st["collapsed"]:
            collapsed_n += 1
        echo_vals.append(st["prompt_echo"])
        if st["period_frac"] is not None:
            period_fracs.append(st["period_frac"])
        if st["unique_ratio"] is not None:
            uniq.append(st["unique_ratio"])
        if st["eos"]:
            eos_n += 1
        if item["id"] == "d0-json":
            try:
                json.loads(g["continuation"])
                json_ok = True
            except Exception:
                try:
                    json.loads(item["input"] + g["continuation"])
                    json_ok = True
                except Exception:
                    json_ok = False
        gens.append({
            "id": item["id"],
            "category": item["category"],
            "input": item["input"],
            "continuation": g["continuation"],
            "full_decode": g["full_decode"],
            **st,
        })
    sky = next((x for x in gens if x["id"] == "d0-prose-sky"), None)
    period_run = False
    sky_cont = ""
    if sky is not None:
        period_run = (sky["continuation"] or "").startswith("..") or (sky["max_run"] >= 6 and "." in (sky["continuation"] or "")[:8])
        sky_cont = sky["continuation"]
    return {
        "collapsed_probes": collapsed_n,
        "n_probes": len(items),
        "mean_prompt_echo": float(np.mean(echo_vals)) if echo_vals else None,
        "mean_period_frac": float(np.mean(period_fracs)) if period_fracs else None,
        "mean_unique_ratio": float(np.mean(uniq)) if uniq else None,
        "eos_generations": eos_n,
        "json_valid": json_ok,
        "period_run_sky": period_run,
        "sky_continuation": sky_cont,
        "items": gens,
    }


def collapse_gate(step0: dict, now: dict, logits: dict) -> tuple[bool, str]:
    if not logits.get("finite"):
        return True, "non-finite logits"
    top = (logits.get("top") or [{}])[0]
    if top.get("tok") == "." and now["collapsed_probes"] >= max(3, step0["collapsed_probes"] + 1):
        return True, "greedy period argmax with rising collapse"
    if now["period_run_sky"] and not step0["period_run_sky"]:
        return True, "period-run degeneration on The sky is"
    if now["collapsed_probes"] >= 6:
        return True, "diagnostic suite collapsed (>=6/n)"
    if (
        step0.get("mean_unique_ratio")
        and now.get("mean_unique_ratio") is not None
        and now["mean_unique_ratio"] < 0.5 * step0["mean_unique_ratio"]
    ):
        return True, "unique-token ratio collapsed vs WRIM-0"
    if now.get("mean_prompt_echo") is not None and step0.get("mean_prompt_echo") is not None:
        if now["mean_prompt_echo"] >= step0["mean_prompt_echo"] + 0.4:
            return True, "prompt echo worsened materially"
    return False, ""


def masked_loss_fn(model, x, y, w, vocab: int):
    import mlx.nn as nn
    logits = model(x)
    ce = nn.losses.cross_entropy(logits.reshape(-1, vocab), y.reshape(-1), reduction="none")
    ww = w.reshape(-1)
    return (ce * ww).sum() / (ww.sum() + 1e-8)


def evaluate_val(model, val_stream, val_mask, cfg, vocab: int) -> dict:
    import mlx.core as mx
    import mlx.nn as nn
    if val_stream.size < int(cfg["context_length"]) + 1:
        return {"validation_loss": None}
    vcur = initial_cursor(val_stream.size, int(cfg["context_length"]), min(2, int(cfg["batch_size"])), 0)
    losses = []
    for _ in range(4):
        vx, vy, vw, vcur = next_batch(val_stream, vcur, loss_mask=val_mask)
        logits = model(mx.array(vx))
        ce = nn.losses.cross_entropy(logits.reshape(-1, vocab), mx.array(vy).reshape(-1), reduction="none")
        ww = mx.array(vw).reshape(-1)
        vloss = (ce * ww).sum() / (ww.sum() + 1e-8)
        mx.eval(vloss)
        losses.append(float(vloss.item()))
    return {"validation_loss": float(np.mean(losses))}


def main() -> int:
    root = repo_root()
    work = root / WORK_REL
    work.mkdir(parents=True, exist_ok=True)
    official = official_ckpt_dir(root)
    if not official.exists():
        print("official WRIM-1 checkpoint dir missing; aborting without claiming isolation", file=sys.stderr)
        return 2

    frozen = json.loads((root / FROZEN_SUITE_REL).read_text(encoding="utf-8"))
    extra = [
        {"id": "d0-echo", "category": "prompt_echo", "input": "Repeat exactly: maple syrup"},
        {"id": "d0-repeat", "category": "repetition", "input": "Count up: one two"},
        {"id": "d0-eos", "category": "eos", "input": "The end of this sentence is here"},
        {"id": "d0-qa-ctx", "category": "qa_from_context", "input": "Context: The cup is blue. Question: What color is the cup? Answer:"},
        {"id": "d0-instr", "category": "short_instruction", "input": "Write one word for a canine:"},
    ]
    suite = {
        "suite_id": "WRIM-RECOVERY-DIAGNOSTIC-0+EXPERIMENT-EXT",
        "kind": "DIAGNOSTIC_ONLY",
        "promotable": False,
        "held_out": False,
        "frozen_parent": frozen["suite_id"],
        "items": list(frozen["items"]) + extra,
    }
    (work / "WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED.json").write_text(json.dumps(suite, indent=2) + "\n")

    tokenizer = load_tokenizer(root)
    packed = materialize_recovery_mix(root=root, tokenizer=tokenizer, seed=SEED, target_tokens=400_000, rehearsal_frac=0.15)
    report = packed["report"]
    (work / "data-mix-report.json").write_text(json.dumps(report, indent=2) + "\n")
    if report["held_out_leak_count"] != 0:
        (work / "ABORT-HELD-OUT-LEAK.json").write_text(json.dumps(report["held_out_leak_hits"], indent=2) + "\n")
        print("held-out leak scan failed; experiment not started", file=sys.stderr)
        return 2

    np.save(work / "train.npy", packed["train_stream"])
    np.save(work / "train-mask.npy", packed["train_mask"])
    np.save(work / "val.npy", packed["val_stream"])
    np.save(work / "val-mask.npy", packed["val_mask"])

    train_stream = packed["train_stream"]
    train_mask = packed["train_mask"]
    val_stream = packed["val_stream"]
    val_mask = packed["val_mask"]
    if train_stream.size < CTX + 1 or val_stream.size < CTX + 1:
        print(json.dumps({"error": "packed streams too short", "train": int(train_stream.size), "val": int(val_stream.size)}))
        return 2

    cfg = recovery_config()
    identities = {
        "test_only": True,
        "promotable": False,
        "lineage": "NOT_OFFICIAL_WRIM_LINEAGE",
        "NOT_PRODUCTION": True,
        "experiment_id": EXPERIMENT_ID,
        "parent_checkpoint_path": str(root / PARENT_CHECKPOINT_REL),
        "parent_checkpoint_sha256": PARENT_CHECKPOINT_SHA256,
        "tokenizer_sha256": TOKENIZER_SHA256,
        "training_config_sha256": sha256_json(cfg),
    }
    run_manifest = {
        "run_id": EXPERIMENT_ID,
        "test_only": True,
        "promotable": False,
        "NOT_OFFICIAL_WRIM_LINEAGE": True,
        "NOT_PRODUCTION": True,
        "NOT_PROMOTABLE": True,
        "parent_checkpoint_sha256": PARENT_CHECKPOINT_SHA256,
        "training_config_sha256": identities["training_config_sha256"],
        "authorization": "COMMANDER_SMALL_RECOVERY_EXPERIMENT_ONLY",
    }
    (work / "run-manifest.json").write_text(json.dumps(run_manifest, indent=2) + "\n")
    (work / "training-config.json").write_text(json.dumps(cfg, indent=2) + "\n")
    (work / "optimizer-config.json").write_text(json.dumps(optimizer_config_from_training(cfg), indent=2) + "\n")

    import mlx.core as mx
    import mlx.nn as nn
    import mlx.utils

    apply_mlx_limits(cfg)
    mx.random.seed(SEED)
    rng = np.random.default_rng(SEED)
    import random
    random.seed(SEED)

    model, arch, nparams = build_from_config(cfg, SEED)
    parent_path = root / PARENT_CHECKPOINT_REL
    parent_file_sha = sha256_file(parent_path)
    if parent_file_sha != PARENT_CHECKPOINT_SHA256:
        raise RuntimeError("WRIM-0 file hash mismatch")
    load_info = load_parent_wrim0_weights(model, parent_path, PARENT_CHECKPOINT_SHA256)
    loaded = model_to_numpy(model)
    loaded_sha = tensor_tree_sha256(loaded)
    from safetensors.numpy import load_file
    raw = load_file(str(parent_path))
    parent_tensors = {k[6:]: v for k, v in raw.items() if k.startswith("model.")}
    parent_sha = tensor_tree_sha256(parent_tensors)
    max_abs = 0.0
    for k in loaded:
        max_abs = max(max_abs, float(np.max(np.abs(loaded[k].astype(np.float64) - parent_tensors[k].astype(np.float64)))))
    parent_proof = {
        "file_sha256": parent_file_sha,
        "expected": PARENT_CHECKPOINT_SHA256,
        "file_match": parent_file_sha == PARENT_CHECKPOINT_SHA256,
        "loaded_tensor_tree_sha256": loaded_sha,
        "parent_tensor_tree_sha256": parent_sha,
        "tensor_tree_match": loaded_sha == parent_sha,
        "max_abs_diff": max_abs,
        "nparams": nparams,
        "load_info": load_info,
        "before_optimizer_step": True,
    }
    (work / "wrim0-load-proof.json").write_text(json.dumps(parent_proof, indent=2) + "\n")
    if not parent_proof["file_match"] or not parent_proof["tensor_tree_match"] or max_abs != 0.0:
        print("WRIM-0 load proof failed", file=sys.stderr)
        return 2

    opt, opt_cfg = reconstruct_optimizer(cfg, model)
    vocab = int(cfg["vocab_size"])

    def loss_fn(m, x, y, w):
        return masked_loss_fn(m, x, y, w, vocab)

    loss_and_grad = nn.value_and_grad(model, loss_fn)
    cursor = initial_cursor(train_stream.size, CTX, BATCH, SEED)
    metrics_path = work / "metrics.jsonl"
    registry_path = work / "checkpoint-registry.json"
    diag_table = []
    logit_rows = []
    early_stop = {"stopped": False, "reason": "", "step": None}
    last_ckpt = None
    t0 = time.time()

    def save_ckpt(step: int, cursor_now: DatasetCursor, status: str, val_metrics: dict | None):
        nonlocal last_ckpt
        ckpt_id = f"checkpoint-step-{step:06d}"
        dest = work / ckpt_id
        if dest.exists() and (dest / "checkpoint-manifest.json").is_file():
            existing = json.loads((dest / "checkpoint-manifest.json").read_text(encoding="utf-8"))
            if existing.get("complete"):
                last_ckpt = ckpt_id
                return dest, existing
        training_state = {
            "run_id": EXPERIMENT_ID,
            "global_step": step,
            "epoch": cursor_now.epoch,
            "tokens_seen": cursor_now.tokens_consumed,
            "test_only": True,
            "promotable": False,
            "run_status": status,
            "updated_at": iso_now(),
            "latest_validation_metrics": val_metrics,
        }
        manifest = write_checkpoint_bundle(
            dest_dir=dest,
            checkpoint_id=ckpt_id,
            run_id=EXPERIMENT_ID,
            step=step,
            epoch=cursor_now.epoch,
            tokens_seen=cursor_now.tokens_consumed,
            model=model,
            optimizer_state=opt.state,
            optimizer_config=opt_cfg,
            rng_blob=capture_rng(rng),
            training_state=training_state,
            dataset_state=cursor_now.to_dict(),
            run_manifest=run_manifest,
            metrics_snapshot={"last_validation": val_metrics},
            parent_checkpoint="WRIM-0" if step == 0 else last_ckpt,
            identities=identities,
        )
        register_checkpoint(registry_path, {
            "checkpoint_id": ckpt_id,
            "run_id": EXPERIMENT_ID,
            "path": str(dest),
            "step": step,
            "sha": manifest["model_tensor_sha256"],
            "status": "complete",
            "promotable": False,
            "test_only": True,
            "lineage": "NOT_OFFICIAL_WRIM_LINEAGE",
        })
        last_ckpt = ckpt_id
        return dest, manifest

    def diagnose(step: int, val_metrics: dict | None, train_loss: float | None):
        suite_out = run_suite(model, tokenizer, suite["items"])
        lg = topk_diag(model, tokenizer, "The sky is")
        lg["step"] = step
        logit_rows.append(lg)
        row = {
            "step": step,
            "train_loss": train_loss,
            "validation_loss": None if val_metrics is None else val_metrics.get("validation_loss"),
            "logits": {
                "p_period": lg.get("p_period"),
                "p_eos": lg.get("p_eos"),
                "entropy": lg.get("entropy"),
                "top": (lg.get("top") or [None])[0],
                "finite": lg.get("finite"),
            },
            **{k: suite_out[k] for k in suite_out if k != "items"},
            "language_outputs": {it["id"]: it["continuation"] for it in suite_out["items"]},
        }
        (work / f"diagnostic-step-{step:06d}.json").write_text(
            json.dumps({**row, "items": suite_out["items"]}, indent=2) + "\n"
        )
        diag_table.append(row)
        return suite_out, lg

    val0 = evaluate_val(model, val_stream, val_mask, cfg, vocab)
    save_ckpt(0, cursor, "TEST_ONLY", val0)
    s0, lg0 = diagnose(0, val0, None)
    step0_row = diag_table[0]

    global_step = 0
    last_train_loss = None
    nan_inf = False
    while global_step < MAX_STEPS:
        x_np, y_np, w_np, cursor = next_batch(train_stream, cursor, loss_mask=train_mask)
        x = mx.array(x_np)
        y = mx.array(y_np)
        w = mx.array(w_np)
        lr = lr_at_step(global_step, MAX_STEPS, PEAK_LR, WARMUP, 0.1)
        opt.learning_rate = lr
        loss, grads = loss_and_grad(model, x, y, w)
        grad_leaves = [g for _, g in mlx.utils.tree_flatten(grads)]
        grad_norm_sq = sum(mx.sum(g.astype(mx.float32) ** 2) for g in grad_leaves)
        grad_norm = mx.sqrt(grad_norm_sq)
        clip_coef = mx.minimum(1.0, float(cfg["gradient_clipping"]) / (grad_norm + 1e-6))
        grads = mlx.utils.tree_map(lambda g: g * clip_coef, grads)
        mx.eval(loss, grad_norm)
        loss_val = float(loss.item())
        grad_val = float(grad_norm.item())
        if not math.isfinite(loss_val) or not math.isfinite(grad_val):
            nan_inf = True
            early_stop = {"stopped": True, "reason": f"NaN/Inf loss={loss_val} grad={grad_val}", "step": global_step + 1}
            break
        if loss_val > 50:
            early_stop = {"stopped": True, "reason": f"exploding loss {loss_val}", "step": global_step + 1}
            break
        opt.update(model, grads)
        mx.eval(model.parameters(), opt.state)
        mx.clear_cache()
        global_step += 1
        last_train_loss = loss_val
        rec = {
            "kind": "train",
            "step": global_step,
            "epoch": cursor.epoch,
            "tokens_seen": cursor.tokens_consumed,
            "train_loss": loss_val,
            "learning_rate": lr,
            "timestamp": iso_now(),
        }
        val_metrics = None
        if global_step % int(cfg["validation_cadence_steps"]) == 0 or global_step in DIAG_STEPS:
            val_metrics = evaluate_val(model, val_stream, val_mask, cfg, vocab)
            rec["validation_loss"] = val_metrics.get("validation_loss")
        append_metric(metrics_path, rec)
        if global_step in DIAG_STEPS:
            dest, _man = save_ckpt(global_step, cursor, "TEST_ONLY", val_metrics)
            suite_out, lg = diagnose(global_step, val_metrics, loss_val)
            stop, reason = collapse_gate(step0_row, {**suite_out, "period_run_sky": suite_out["period_run_sky"]}, lg)
            if nan_inf or stop:
                early_stop = {"stopped": True, "reason": reason, "step": global_step}
                break

    if not early_stop["stopped"] and global_step not in DIAG_STEPS:
        val_metrics = evaluate_val(model, val_stream, val_mask, cfg, vocab)
        save_ckpt(global_step, cursor, "TEST_ONLY_COMPLETED", val_metrics)
        diagnose(global_step, val_metrics, last_train_loss)

    # checkpoint reload proof
    reload_proof = []
    for step in [r["step"] for r in diag_table]:
        ckpt = work / f"checkpoint-step-{step:06d}"
        if not (ckpt / "checkpoint-manifest.json").is_file():
            reload_proof.append({"step": step, "ok": False, "detail": "missing"})
            continue
        bundle = load_bundle(ckpt)
        m2, _, _ = build_from_config(cfg, SEED)
        load_model_weights(m2, bundle["model"], strict=True)
        sha = tensor_tree_sha256(model_to_numpy(m2))
        reload_proof.append({
            "step": step,
            "ok": True,
            "reloaded_sha": sha,
            "bundle_sha": bundle["manifest"]["model_tensor_sha256"],
            "sha_match": sha == bundle["manifest"]["model_tensor_sha256"],
        })
    if diag_table:
        m0 = build_from_config(cfg, SEED)[0]
        b0 = load_bundle(work / "checkpoint-step-000000")
        load_model_weights(m0, b0["model"], strict=True)
        reload_proof.append({
            "step0_matches_wrim0": tensor_tree_sha256(model_to_numpy(m0)) == parent_sha,
        })

    official_entries = []
    if (official / "checkpoint-registry.json").is_file():
        official_entries = json.loads((official / "checkpoint-registry.json").read_text()).get("checkpoints") or []

    summary = {
        "experiment_id": EXPERIMENT_ID,
        "test_only": True,
        "NOT_PROMOTABLE": True,
        "NOT_OFFICIAL_WRIM_LINEAGE": True,
        "NOT_PRODUCTION": True,
        "parent_sha256": PARENT_CHECKPOINT_SHA256,
        "parent_load_proof": parent_proof,
        "data_mix": report,
        "planned_steps": MAX_STEPS,
        "completed_steps": global_step,
        "early_stop": early_stop,
        "nan_inf": nan_inf,
        "peak_lr": PEAK_LR,
        "optimizer": opt_cfg,
        "elapsed_sec": time.time() - t0,
        "diagnostics": diag_table,
        "logit_drift": logit_rows,
        "reload_proof": reload_proof,
        "official_wrim1_checkpoint_count": len(official_entries),
        "official_dir_untouched_by_path": str(work.resolve()) != str(official.resolve()),
        "collapse_detected": bool(early_stop["stopped"] and "NaN" not in (early_stop["reason"] or "") and early_stop["reason"] != ""),
    }
    (work / "experiment-summary.json").write_text(json.dumps(summary, indent=2, default=str) + "\n")
    print(json.dumps({
        "experiment_id": EXPERIMENT_ID,
        "completed_steps": global_step,
        "early_stop": early_stop,
        "elapsed_sec": summary["elapsed_sec"],
        "held_out_leak_count": report["held_out_leak_count"],
        "train_tokens": report["train_tokens"],
        "eos_count": report["eos_count"],
        "work_dir": str(work),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
