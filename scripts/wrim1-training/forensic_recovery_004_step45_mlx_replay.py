#!/usr/bin/env python3
"""EVAL-ONLY MLX replay of Recovery-004 batches 35/41/42/43 against step-25 weights.

No optimizer update. Does not write into Recovery-004 checkpoint dirs.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from safetensors.numpy import load_file

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))

from checkpoint_io import load_model_weights  # noqa: E402
from dataset_cursor import initial_cursor, next_batch  # noqa: E402
from forensic_recovery_004_step45 import (  # noqa: E402
    BATCH,
    CTX,
    OUT,
    SEED,
    SRC,
    component_key,
    load_tokenizer,
    lookup_spans,
    redact,
)
from paths import repo_root  # noqa: E402
from recovery_instrumentation import grad_instrumentation  # noqa: E402
from run_recovery_experiment import masked_loss_fn, run_suite  # noqa: E402
from trainer_core import apply_mlx_limits, build_from_config  # noqa: E402

WANTED = {35, 40, 41, 42, 43, 45}


def main() -> int:
    import mlx.core as mx
    import mlx.nn as nn
    import mlx.utils

    root = repo_root()
    src = root / SRC
    out = root / OUT
    cfg = json.loads((src / "training-config.json").read_text())
    spans = json.loads((out / "unit-spans.json").read_text())
    tokenizer = load_tokenizer(root)
    eos_id = tokenizer.token_to_id("<|eos|>")
    bos_id = tokenizer.token_to_id("<|bos|>")
    train = np.load(src / "train.npy")
    mask = np.load(src / "train-mask.npy")
    apply_mlx_limits(cfg)
    model, arch, nparams = build_from_config(cfg, SEED)
    weights = load_file(str(src / "checkpoint-step-000025" / "model.safetensors"))
    load_model_weights(model, weights, strict=True)
    mx.eval(model.parameters())
    vocab = int(cfg["vocab_size"])
    loss_and_grad = nn.value_and_grad(model, lambda m, x, y, w: masked_loss_fn(m, x, y, w, vocab))
    cursor = initial_cursor(train.size, CTX, BATCH, SEED)
    rows = []
    top_tokens = []
    for step in range(1, 46):
        x_np, y_np, w_np, cursor = next_batch(train, cursor, loss_mask=mask)
        if step not in WANTED:
            continue
        x, y, w = mx.array(x_np), mx.array(y_np), mx.array(w_np)
        logits = model(x)
        ce = nn.losses.cross_entropy(logits.reshape(-1, vocab), y.reshape(-1), reduction="none")
        mx.eval(ce)
        ce_np = np.array(ce)
        w_flat = np.array(w_np).reshape(-1)
        y_flat = y_np.reshape(-1)
        seq_losses = []
        for bi in range(BATCH):
            sl = ce_np[bi * CTX:(bi + 1) * CTX]
            sw = w_flat[bi * CTX:(bi + 1) * CTX]
            seq_losses.append(float((sl * sw).sum() / (float(sw.sum()) + 1e-8)))
        idx = np.where(w_flat > 0)[0]
        order = idx[np.argsort(-ce_np[idx])[:12]]
        for j in order:
            tok_id = int(y_flat[j])
            tok_txt = redact(tokenizer.decode([tok_id], skip_special_tokens=False))
            pos = int(j)
            seq_i, pos_in = pos // CTX, pos % CTX
            stream_pos = (step - 1) * BATCH * CTX + seq_i * CTX + pos_in
            fam = "unknown"
            for h in lookup_spans(spans, stream_pos, stream_pos + 1):
                fam = h["bucket"]
            top_tokens.append({
                "step": step, "seq": seq_i, "pos": pos_in, "loss": float(ce_np[j]),
                "token_id": tok_id, "token_text": tok_txt, "source_family": fam,
                "target_is_eos": tok_id == eos_id, "target_is_bos": tok_id == bos_id,
            })
        loss_val, grads = loss_and_grad(model, x, y, w)
        ginfo = grad_instrumentation(grads)
        accs = {}
        for name, g in mlx.utils.tree_flatten(grads):
            ck = component_key(name)
            s = mx.sum(g.astype(mx.float32) ** 2)
            accs[ck] = s if ck not in accs else accs[ck] + s
        mx.eval(*accs.values())
        comp = {k: float(np.sqrt(float(v.item()))) for k, v in sorted(accs.items())}
        rows.append({
            "step": step,
            "eval_only_on": "checkpoint-step-000025",
            "batch_loss_replay": float(loss_val.item()),
            "per_sequence_loss": seq_losses,
            "global_grad_l2": float(ginfo["global_grad_l2"]),
            "per_layer_grad_l2": ginfo.get("per_layer_grad_l2"),
            "per_component_grad_l2": comp,
            "clip_would_apply": float(ginfo["global_grad_l2"]) > 1.0,
        })
        mx.clear_cache()
    live = {k: np.array(v) for k, v in mlx.utils.tree_flatten(model.parameters())}
    max_abs = 0.0
    for k, a in weights.items():
        b = live.get(k)
        if b is not None:
            max_abs = max(max_abs, float(np.max(np.abs(a.astype(np.float64) - b.astype(np.float64)))))
    suite = json.loads((src / "WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED.json").read_text())
    suite_out = run_suite(model, tokenizer, suite["items"], 32)
    hist25 = json.loads((src / "diagnostic-step-000025.json").read_text())
    payload = {
        "weights_unchanged_max_abs_vs_checkpoint": max_abs,
        "nparams": nparams,
        "rows": rows,
        "top_loss_tokens": sorted(top_tokens, key=lambda r: -r["loss"])[:50],
        "step25_suite_replay": {
            "replay_collapsed": suite_out["collapsed_probes"],
            "historical_collapsed": hist25.get("collapsed_probes"),
            "replay_unique": suite_out.get("mean_unique_ratio"),
            "historical_unique": hist25.get("mean_unique_ratio"),
            "sky": suite_out.get("sky_continuation"),
        },
    }
    (out / "eval-only-replay-step25.json").write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps({
        "weight_delta": max_abs,
        "suite": payload["step25_suite_replay"],
        "losses": {r["step"]: r["batch_loss_replay"] for r in rows},
        "grads": {r["step"]: r["global_grad_l2"] for r in rows},
        "top5": payload["top_loss_tokens"][:5],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
