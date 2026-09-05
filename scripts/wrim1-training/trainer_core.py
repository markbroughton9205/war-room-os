from __future__ import annotations

import json
import math
import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))

from wrim0_architecture import WRIM0Config, WRIM0Model, build_model, count_parameters  # noqa: E402

from checkpoint_io import (  # noqa: E402
    load_bundle,
    load_model_weights,
    load_parent_wrim0_weights,
    register_checkpoint,
    write_checkpoint_bundle,
)
from dataset_cursor import DatasetCursor, initial_cursor, next_batch  # noqa: E402
from hashes import sha256_json, tensor_tree_sha256  # noqa: E402
from rng_state import capture_rng, lr_at_step, restore_rng  # noqa: E402
from training_config import optimizer_config_from_training  # noqa: E402


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def append_metric(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, sort_keys=True) + "\n")
        f.flush()
        os.fsync(f.fileno())


def apply_mlx_limits(cfg: dict) -> None:
    import mlx.core as mx
    mx.set_cache_limit(int(cfg["mlx_cache_limit_bytes"]))
    mx.set_memory_limit(int(cfg["mlx_memory_limit_bytes"]))


def build_from_config(cfg: dict, seed: int):
    arch = WRIM0Config(
        vocab_size=int(cfg["vocab_size"]),
        d_model=int(cfg["d_model"]),
        n_layers=int(cfg["n_layers"]),
        n_heads=int(cfg["n_heads"]),
        head_dim=int(cfg["head_dim"]),
        d_ff=int(cfg["d_ff"]),
        rope_theta=float(cfg.get("rope_theta", 10000.0)),
        context_length=int(cfg["context_length"]),
    )
    model, nparams = build_model(arch, seed)
    return model, arch, nparams


def reconstruct_optimizer(cfg: dict, model):
    import mlx.optimizers as optim
    opt_cfg = optimizer_config_from_training(cfg)
    betas = tuple(opt_cfg["betas"])
    opt = optim.AdamW(
        learning_rate=opt_cfg["learning_rate"],
        betas=betas,
        eps=opt_cfg["eps"],
        weight_decay=opt_cfg["weight_decay"],
    )
    return opt, opt_cfg


def restore_optimizer_state(opt, tensors: dict) -> None:
    import mlx.core as mx
    import mlx.utils
    if not tensors:
        return
    tree = mlx.utils.tree_unflatten([(k, mx.array(v)) for k, v in tensors.items()])
    opt.state = tree
    mx.eval(opt.state)


def finite_or_raise(name: str, value: float) -> None:
    if not math.isfinite(value):
        raise RuntimeError(f"{name} is non-finite: {value}")


def train_loop(
    *,
    work_dir: Path,
    cfg: dict,
    run_manifest: dict,
    train_stream: np.ndarray,
    val_stream: np.ndarray,
    max_steps: int,
    stop_after: int | None,
    resume_from: Path | None,
    identities: dict,
    run_status_on_complete: str = "COMPLETED",
) -> dict:
    import mlx.core as mx
    import mlx.nn as nn
    import mlx.optimizers as optim
    import mlx.utils

    apply_mlx_limits(cfg)
    work_dir.mkdir(parents=True, exist_ok=True)
    metrics_path = work_dir / "metrics.jsonl"
    registry_path = work_dir / "checkpoint-registry.json"
    interrupted = {"flag": False}

    def handle_stop(signum, frame):
        interrupted["flag"] = True

    signal.signal(signal.SIGTERM, handle_stop)
    signal.signal(signal.SIGINT, handle_stop)

    rng = np.random.default_rng(int(cfg["seed"]))
    import random
    random.seed(int(cfg["seed"]))
    mx.random.seed(int(cfg["seed"]))

    opt_cfg = optimizer_config_from_training(cfg)
    parent = None
    if resume_from is not None:
        bundle = load_bundle(resume_from)
        if bundle["run_manifest"].get("run_id") != run_manifest["run_id"]:
            raise ValueError("wrong run id on resume")
        saved_cfg_hash = bundle["run_manifest"].get("training_config_sha256")
        if saved_cfg_hash != run_manifest.get("training_config_sha256"):
            raise ValueError("training config hash mismatch on resume")
        model, arch, nparams = build_from_config(cfg, int(cfg["seed"]))
        load_model_weights(model, bundle["model"], strict=True)
        opt, opt_cfg_loaded = reconstruct_optimizer(cfg, model)
        if opt_cfg_loaded != bundle["optimizer_config"] and json.dumps(opt_cfg_loaded, sort_keys=True) != json.dumps(bundle["optimizer_config"], sort_keys=True):
            raise ValueError("optimizer config mismatch on resume")
        restore_optimizer_state(opt, bundle["optimizer"])
        restore_rng(bundle["rng"], rng)
        cursor = DatasetCursor.from_dict(bundle["dataset_state"])
        start_step = int(bundle["training_state"]["global_step"])
        tokens_seen = int(bundle["training_state"]["tokens_seen"])
        interruption_count = int(bundle["training_state"].get("interruption_count", 0)) + 1
        parent = resume_from.name
        started_at = bundle["training_state"].get("started_at") or iso_now()
        last_val = bundle["training_state"].get("last_validation_step")
        latest_val = bundle["training_state"].get("latest_validation_metrics")
        best_val = bundle["training_state"].get("best_validation_metrics")
    else:
        model, arch, nparams = build_from_config(cfg, int(cfg["seed"]))
        parent_path = identities.get("parent_checkpoint_path")
        parent_sha = identities.get("parent_checkpoint_sha256")
        if parent_path and parent_sha:
            load_parent_wrim0_weights(model, Path(parent_path), parent_sha)
        elif identities.get("test_only"):
            pass
        else:
            raise RuntimeError("official training requires parent WRIM-0 path and sha256")
        opt, _ = reconstruct_optimizer(cfg, model)
        cursor = initial_cursor(train_stream.size, int(cfg["context_length"]), int(cfg["batch_size"]), int(cfg["seed"]))
        start_step = 0
        tokens_seen = 0
        interruption_count = 0
        started_at = iso_now()
        last_val = None
        latest_val = None
        best_val = None

    cfg["parameter_count"] = int(nparams)
    vocab = int(cfg["vocab_size"])

    def loss_fn(m, x, y):
        logits = m(x)
        return nn.losses.cross_entropy(logits.reshape(-1, vocab), y.reshape(-1), reduction="mean")

    loss_and_grad = nn.value_and_grad(model, loss_fn)
    t0 = time.time()
    last_ckpt_id = None
    last_ckpt_path = str(resume_from) if resume_from else None
    steps_this_process = 0
    end_step = start_step + (stop_after if stop_after is not None else max_steps - start_step)
    end_step = min(end_step, max_steps)

    def evaluate() -> dict:
        if val_stream.size < int(cfg["context_length"]) + 1:
            return {"validation_loss": None}
        vcur = initial_cursor(val_stream.size, int(cfg["context_length"]), min(2, int(cfg["batch_size"])), 0)
        losses = []
        for _ in range(4):
            vx, vy, vcur = next_batch(val_stream, vcur)
            logits = model(mx.array(vx))
            vloss = nn.losses.cross_entropy(logits.reshape(-1, vocab), mx.array(vy).reshape(-1), reduction="mean")
            mx.eval(vloss)
            losses.append(float(vloss.item()))
        return {"validation_loss": float(np.mean(losses)), "eval_refs": ["synthetic-or-split-val-diagnostic"]}

    def save_ckpt(step: int, cursor_now: DatasetCursor, status: str, val_metrics: dict | None) -> dict:
        nonlocal last_ckpt_id, last_ckpt_path, last_val, latest_val, best_val, parent
        ckpt_id = f"checkpoint-step-{step:06d}"
        dest = work_dir / ckpt_id
        if dest.exists() and (dest / "checkpoint-manifest.json").is_file():
            existing = json.loads((dest / "checkpoint-manifest.json").read_text(encoding="utf-8"))
            if existing.get("complete"):
                last_ckpt_id = ckpt_id
                last_ckpt_path = str(dest)
                parent = dest.name
                return existing
        training_state = {
            "run_id": run_manifest["run_id"],
            "global_step": step,
            "epoch": cursor_now.epoch,
            "tokens_seen": cursor_now.tokens_consumed,
            "samples_seen": cursor_now.sample_position,
            "dataset_position": cursor_now.to_dict(),
            "batch_position": cursor_now.batch_position,
            "scheduler_position": step,
            "current_learning_rate": lr_at_step(
                step, int(cfg["total_steps"]), float(cfg["learning_rate"]),
                int(cfg["warmup_steps"]), float(cfg["scheduler_floor_ratio"]),
            ),
            "last_validation_step": last_val,
            "latest_validation_metrics": latest_val,
            "best_validation_metrics": best_val,
            "last_checkpoint_id": ckpt_id,
            "last_checkpoint_path": str(dest),
            "run_status": status,
            "started_at": started_at,
            "updated_at": iso_now(),
            "interruption_count": interruption_count,
        }
        if val_metrics is not None:
            last_val = step
            latest_val = val_metrics
            training_state["last_validation_step"] = last_val
            training_state["latest_validation_metrics"] = latest_val
            if best_val is None or (
                val_metrics.get("validation_loss") is not None
                and (best_val.get("validation_loss") is None or val_metrics["validation_loss"] < best_val["validation_loss"])
            ):
                best_val = val_metrics
                training_state["best_validation_metrics"] = best_val
        manifest = write_checkpoint_bundle(
            dest_dir=dest,
            checkpoint_id=ckpt_id,
            run_id=run_manifest["run_id"],
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
            metrics_snapshot={"last_validation": latest_val, "best_validation": best_val},
            parent_checkpoint=parent,
            identities=identities,
        )
        register_checkpoint(registry_path, {
            "checkpoint_id": ckpt_id,
            "run_id": run_manifest["run_id"],
            "path": str(dest),
            "step": step,
            "epoch": cursor_now.epoch,
            "tokens_seen": cursor_now.tokens_consumed,
            "sha": manifest["model_tensor_sha256"],
            "parent": parent,
            "created_at": training_state["updated_at"],
            "validation_metrics": latest_val,
            "status": "complete",
            "promotable": False,
            "corrupted": False,
            "test_only": identities.get("test_only", False),
            "lineage": identities.get("lineage"),
        })
        append_metric(metrics_path, {
            "kind": "checkpoint",
            "step": step,
            "checkpoint_id": ckpt_id,
            "checkpoint_sha": manifest["model_tensor_sha256"],
            "timestamp": iso_now(),
        })
        last_ckpt_id = ckpt_id
        last_ckpt_path = str(dest)
        parent = dest.name
        return manifest

    global_step = start_step
    for _ in range(end_step - start_step):
        x_np, y_np, cursor = next_batch(train_stream, cursor)
        x = mx.array(x_np)
        y = mx.array(y_np)
        lr = lr_at_step(
            global_step, int(cfg["total_steps"]), float(cfg["learning_rate"]),
            int(cfg["warmup_steps"]), float(cfg["scheduler_floor_ratio"]),
        )
        opt.learning_rate = lr
        t_step = time.time()
        loss, grads = loss_and_grad(model, x, y)
        grad_leaves = [g for _, g in mlx.utils.tree_flatten(grads)]
        grad_norm_sq = sum(mx.sum(g.astype(mx.float32) ** 2) for g in grad_leaves)
        grad_norm = mx.sqrt(grad_norm_sq)
        clip_coef = mx.minimum(1.0, float(cfg["gradient_clipping"]) / (grad_norm + 1e-6))
        grads = mlx.utils.tree_map(lambda g: g * clip_coef, grads)
        mx.eval(loss, grad_norm)
        loss_val = float(loss.item())
        grad_val = float(grad_norm.item())
        finite_or_raise("train_loss", loss_val)
        finite_or_raise("grad_norm", grad_val)
        if loss_val > 50:
            raise RuntimeError(f"exploding loss {loss_val}")
        opt.update(model, grads)
        mx.eval(model.parameters(), opt.state)
        mx.clear_cache()
        dt = time.time() - t_step
        tokens_step = int(cfg["batch_size"]) * int(cfg["context_length"])
        tokens_seen = cursor.tokens_consumed
        mem = {}
        if hasattr(mx, "get_active_memory"):
            mem["active_memory"] = int(mx.get_active_memory())
        if hasattr(mx, "get_peak_memory"):
            mem["peak_memory"] = int(mx.get_peak_memory())
        rec = {
            "kind": "train",
            "step": global_step + 1,
            "epoch": cursor.epoch,
            "tokens_seen": tokens_seen,
            "train_loss": loss_val,
            "learning_rate": lr,
            "tokens_per_second": tokens_step / dt if dt else None,
            "step_time": dt,
            "timestamp": iso_now(),
            **mem,
        }
        global_step += 1
        steps_this_process += 1
        if global_step % int(cfg["validation_cadence_steps"]) == 0:
            val_metrics = evaluate()
            rec["validation_loss"] = val_metrics.get("validation_loss")
            rec["kind"] = "train+validation"
            last_val = global_step
            latest_val = val_metrics
            if best_val is None or (
                val_metrics.get("validation_loss") is not None
                and (best_val.get("validation_loss") is None or val_metrics["validation_loss"] < best_val["validation_loss"])
            ):
                best_val = val_metrics
            append_metric(metrics_path, {**rec, "eval_refs": val_metrics.get("eval_refs")})
        else:
            append_metric(metrics_path, rec)
        if global_step % int(cfg["checkpoint_cadence_steps"]) == 0:
            save_ckpt(global_step, cursor, "TRAINING", latest_val)
        if interrupted["flag"]:
            save_ckpt(global_step, cursor, "INTERRUPTED", latest_val)
            return {
                "status": "INTERRUPTED",
                "global_step": global_step,
                "last_checkpoint": last_ckpt_path,
                "work_dir": str(work_dir),
            }

    final_status = run_status_on_complete if global_step >= max_steps else "INTERRUPTED"
    val_metrics = evaluate()
    save_ckpt(global_step, cursor, final_status, val_metrics)
    return {
        "status": final_status,
        "global_step": global_step,
        "parameter_count": nparams,
        "architecture_hash": arch.config_hash(),
        "last_checkpoint": last_ckpt_path,
        "work_dir": str(work_dir),
        "elapsed_sec": time.time() - t0,
        "steps_this_process": steps_this_process,
    }
