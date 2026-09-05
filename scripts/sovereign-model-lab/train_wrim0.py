#!/usr/bin/env python3
"""WRIM-0 Genesis Smoke Run training engine.

fp32 end-to-end, AdamW (beta 0.9/0.95, weight_decay 0.1), gradient clip 1.0, no dropout — per the
Kimi Genesis research's cross-verified recommendation (cross_verification.md "Decisions the report
must make" #5). MLX cache/memory limits are set explicitly: measured on this exact machine, leaving
MLX's Metal buffer cache unbounded causes step time to grow monotonically (2.7s -> 61s across four
steps at batch=8/seq=512, memory pressure already at ~3.7GB swap used at idle on this 8GB machine) —
see the Genesis report's hardware-benchmark section. `mx.set_cache_limit` + `mx.clear_cache()` after
every step is the fix that keeps step time flat; this is not a stylistic choice.

Genesis Smoke Run scope, not a full WRIM-0 production run: this corpus (~317K training tokens) is
roughly three orders of magnitude below a Chinchilla-optimal token budget for a 19.2M-parameter
model. The purpose is pipeline correctness proof (random init -> train -> checkpoint -> reload ->
inference), not a capability claim — see mission Phase 8 and Phase 13.
"""
from __future__ import annotations

import argparse
import json
import math
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
import mlx.utils
import numpy as np

from wrim0_architecture import WRIM0Config, build_model, count_parameters
from wrim0_checkpoint import load_checkpoint, save_checkpoint, sha256_file

MLX_CACHE_LIMIT_BYTES = 256 * 1024 * 1024
MLX_MEMORY_LIMIT_BYTES = int(3.0 * 1024 ** 3)


def get_batch(data: np.ndarray, batch_size: int, seq_len: int, rng: np.random.Generator):
    max_start = data.size - seq_len - 1
    starts = rng.integers(0, max_start, size=batch_size)
    x = np.stack([data[s:s + seq_len] for s in starts]).astype(np.int64)
    y = np.stack([data[s + 1:s + seq_len + 1] for s in starts]).astype(np.int64)
    return mx.array(x), mx.array(y)


def lr_schedule(step: int, total_steps: int, peak_lr: float, warmup_steps: int, floor_ratio: float = 0.1) -> float:
    if step < warmup_steps:
        return peak_lr * (step + 1) / max(1, warmup_steps)
    progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
    progress = min(1.0, progress)
    cosine = 0.5 * (1 + math.cos(math.pi * progress))
    return peak_lr * (floor_ratio + (1 - floor_ratio) * cosine)


def evaluate_val_loss(model, val_data: np.ndarray, seq_len: int, vocab_size: int, n_batches: int = 4) -> float:
    if val_data.size < seq_len + 1:
        return float("nan")
    rng = np.random.default_rng(0)
    losses = []
    for _ in range(n_batches):
        x, y = get_batch(val_data, batch_size=4, seq_len=min(seq_len, val_data.size - 1), rng=rng)
        logits = model(x)
        loss = nn.losses.cross_entropy(logits.reshape(-1, vocab_size), y.reshape(-1), reduction="mean")
        losses.append(loss.item())
    return float(np.mean(losses))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--checkpoint-dir", required=True)
    ap.add_argument("--resume-from", default="checkpoint-0", help="Checkpoint name (without extension) to load and continue from.")
    ap.add_argument("--train-npy", required=True)
    ap.add_argument("--val-npy", required=True)
    ap.add_argument("--batch-size", type=int, default=8)
    ap.add_argument("--seq-len", type=int, default=512)
    ap.add_argument("--steps", type=int, required=True)
    ap.add_argument("--peak-lr", type=float, default=3e-3)
    ap.add_argument("--warmup-steps", type=int, default=30)
    ap.add_argument("--grad-clip", type=float, default=1.0)
    ap.add_argument("--weight-decay", type=float, default=0.1)
    ap.add_argument("--checkpoint-every", type=int, default=100)
    ap.add_argument("--eval-every", type=int, default=50)
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--log-jsonl", required=True)
    args = ap.parse_args()

    mx.set_cache_limit(MLX_CACHE_LIMIT_BYTES)
    mx.set_memory_limit(MLX_MEMORY_LIMIT_BYTES)

    ckpt_dir = Path(args.checkpoint_dir)
    with open(ckpt_dir / f"{args.resume_from}.json", "r", encoding="utf-8") as f:
        resume_meta = json.load(f)
    config = WRIM0Config(**resume_meta["architectureConfig"])
    assert config.config_hash() == resume_meta["architectureConfigHash"], "architecture config hash mismatch on resume"

    model, opt_state, sidecar = load_checkpoint(ckpt_dir, args.resume_from, config)
    start_step = int(sidecar.get("step", 0))
    tokens_seen = int(sidecar.get("tokensSeen", 0))
    print(f"Resumed from {args.resume_from}: step={start_step} tokens_seen={tokens_seen} params={count_parameters(model)}", flush=True)

    opt = optim.AdamW(learning_rate=args.peak_lr, betas=(0.9, 0.95), weight_decay=args.weight_decay)
    if opt_state is not None:
        opt.state = opt_state

    train_data = np.load(args.train_npy)
    val_data = np.load(args.val_npy)
    rng = np.random.default_rng(args.seed)

    def loss_fn(model, x, y):
        logits = model(x)
        return nn.losses.cross_entropy(logits.reshape(-1, config.vocab_size), y.reshape(-1), reduction="mean")

    loss_and_grad = nn.value_and_grad(model, loss_fn)

    log_path = Path(args.log_jsonl)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_f = open(log_path, "a", encoding="utf-8")

    interrupted = {"flag": False}

    def handle_sigterm(signum, frame):
        interrupted["flag"] = True

    signal.signal(signal.SIGTERM, handle_sigterm)
    signal.signal(signal.SIGINT, handle_sigterm)

    ema_loss = None
    total_steps = args.steps
    run_t0 = time.time()

    def do_checkpoint(step: int, tokens_seen: int, name: str):
        meta = {
            "modelId": "WRIM-0",
            "ownership": "war_room_native_artifact",
            "step": step,
            "tokensSeen": tokens_seen,
            "architectureConfig": config.__dict__,
            "architectureConfigHash": config.config_hash(),
            "parameterCount": count_parameters(model),
            "seed": args.seed,
            "peakLr": args.peak_lr,
            "savedAt": datetime.now(timezone.utc).isoformat(),
            "parentCheckpoint": args.resume_from,
        }
        sidecar_out = save_checkpoint(ckpt_dir, name, model, opt.state, meta)
        print(f"  [checkpoint saved] {name} weightsSha256={sidecar_out['weightsSha256'][:16]}...", flush=True)
        return sidecar_out

    try:
        for i in range(total_steps):
            step = start_step + i
            lr = lr_schedule(i, total_steps, args.peak_lr, args.warmup_steps)
            opt.learning_rate = lr

            t_step0 = time.time()
            x, y = get_batch(train_data, args.batch_size, args.seq_len, rng)
            loss, grads = loss_and_grad(model, x, y)

            grad_leaves = [g for _, g in mlx.utils.tree_flatten(grads)]
            grad_norm_sq = sum(mx.sum(g.astype(mx.float32) ** 2) for g in grad_leaves)
            grad_norm = mx.sqrt(grad_norm_sq)
            clip_coef = mx.minimum(1.0, args.grad_clip / (grad_norm + 1e-6))
            grads = mlx.utils.tree_map(lambda g: g * clip_coef, grads)

            opt.update(model, grads)
            mx.eval(model.parameters(), opt.state, loss, grad_norm)
            mx.clear_cache()
            dt = time.time() - t_step0

            loss_val = loss.item()
            grad_norm_val = grad_norm.item()
            ema_loss = loss_val if ema_loss is None else 0.9 * ema_loss + 0.1 * loss_val
            tokens_seen += args.batch_size * args.seq_len

            record = {
                "step": step,
                "tokensSeen": tokens_seen,
                "trainLoss": loss_val,
                "emaTrainLoss": ema_loss,
                "gradNorm": grad_norm_val,
                "lr": lr,
                "stepTimeSec": dt,
                "tokensPerSec": (args.batch_size * args.seq_len) / dt,
                "elapsedSec": time.time() - run_t0,
                "peakMemGb": mx.get_peak_memory() / 1e9,
            }

            if (i + 1) % args.eval_every == 0 or i == 0:
                val_loss = evaluate_val_loss(model, val_data, args.seq_len, config.vocab_size)
                record["valLoss"] = val_loss
                record["valPerplexity"] = math.exp(val_loss) if val_loss == val_loss else None
                print(f"step {step:5d} | loss {loss_val:.4f} | ema {ema_loss:.4f} | val {val_loss:.4f} | lr {lr:.2e} | {record['tokensPerSec']:.0f} tok/s | {dt:.2f}s", flush=True)
            else:
                print(f"step {step:5d} | loss {loss_val:.4f} | ema {ema_loss:.4f} | lr {lr:.2e} | {record['tokensPerSec']:.0f} tok/s | {dt:.2f}s", flush=True)

            log_f.write(json.dumps(record) + "\n")
            log_f.flush()

            if (i + 1) % args.checkpoint_every == 0:
                do_checkpoint(step + 1, tokens_seen, f"checkpoint-step{step + 1}")

            if interrupted["flag"]:
                print("Interrupted — saving checkpoint before exit.", flush=True)
                do_checkpoint(step + 1, tokens_seen, "checkpoint-interrupted")
                log_f.close()
                return 130

        final = do_checkpoint(start_step + total_steps, tokens_seen, "checkpoint-final")
        final_val_loss = evaluate_val_loss(model, val_data, args.seq_len, config.vocab_size, n_batches=8)
        print(json.dumps({
            "finalStep": start_step + total_steps,
            "tokensSeen": tokens_seen,
            "finalTrainLoss": ema_loss,
            "finalValLoss": final_val_loss,
            "finalValPerplexity": math.exp(final_val_loss) if final_val_loss == final_val_loss else None,
            "finalCheckpointSha256": final["weightsSha256"],
            "elapsedSec": time.time() - run_t0,
        }))
    finally:
        log_f.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
