"""WRIM-1 Nebula controlled stability experiment. TEST_ONLY. 12 runs. No Stage 3.

SUPERSEDED. accum=4 / SKEWED_BASELINE 12-run grid is not the Phase 2 experiment.
Phase 2 primary grid is scripts/wrim-environment/phase2_grid.py
(WRIM1-NEBULA-STABILITY-GRID-000001, accum=1, NATURAL_BASELINE, 40 runs).
This module hard-aborts. Do not train from here.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from safetensors.torch import load_file, save_file
from tokenizers import Tokenizer

from experiment_pack import (
    GRAD_ACCUM,
    LOCKED_MIX,
    MICRO_BATCH,
    NEEDED_TRAIN_TOKENS,
    STEPS,
    TOKENS_PER_STEP,
    encode_raw_families,
    pack_train_stream,
    pack_val_stream,
)
from safetensors_model import load_model_state_from_safetensors
from stage1_pack import SEQ_LEN, causal_batch_audit, slice_contiguous_batches
from stage2_eval import (
    EVAL_SEED,
    evaluate_stability,
    greedy_generate,
    load_retention_items,
    score_retention,
)
from wrim_g20m import (
    CONTEXT_LENGTH,
    D_FF,
    D_MODEL,
    HEAD_DIM,
    N_HEADS,
    N_LAYERS,
    VOCAB_SIZE,
    WRIM0Model,
    expected_torch_keys,
)

PARENT_SHA = "d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015"
TOKENIZER_SHA = "47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7"
EXPERIMENT_ID = "WRIM1-NEBULA-CTRL-STAB-000001"
WARMUP = 25
BETAS = (0.9, 0.95)
EPS = 1e-8
WEIGHT_DECAY = 0.1
GRAD_CLIP = 1.0
DISK_STOP_GB = 32
DISK_WARN_GB = 64
EVAL_STEPS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]
SAVE_STEPS = {25, 50}
STRATEGIES = ["SKEWED_BASELINE", "BALANCED_GENESIS"]
PEAK_LRS = [3e-5, 2e-5]
SEEDS = [1337, 7331, 20260912]
ALPHAS = [0.1, 0.2, 0.3, 0.4, 0.5]
LR_LABEL = {3e-5: "LR_HIGH", 2e-5: "LR_LOW"}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def tensors_sha256(state: dict[str, torch.Tensor]) -> str:
    h = hashlib.sha256()
    for k in sorted(state):
        t = state[k].detach().contiguous().cpu().float().numpy().tobytes()
        h.update(k.encode("utf-8"))
        h.update(t)
    return h.hexdigest()


def disable_tf32() -> None:
    if torch.cuda.is_available():
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.backends.cudnn.benchmark = False
    if hasattr(torch, "set_float32_matmul_precision"):
        torch.set_float32_matmul_precision("highest")


def lr_at_step(step: int, peak_lr: float) -> float:
    """Same warmup family for both LR cells. 0-indexed. min_lr = peak/10."""
    min_lr = peak_lr / 10.0
    if step < WARMUP:
        return peak_lr * (step + 1) / WARMUP
    progress = (step - WARMUP) / max(1, STEPS - WARMUP)
    progress = min(1.0, max(0.0, progress))
    cosine = 0.5 * (1.0 + math.cos(math.pi * progress))
    return min_lr + (peak_lr - min_lr) * cosine


def disk_gb(path: Path) -> float:
    return shutil.disk_usage(path).free / (1024**3)


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def measure_val_loss(model: WRIM0Model, val_stream: np.ndarray, device: torch.device, n_batches: int = 4) -> float | None:
    if val_stream.size < SEQ_LEN + 1:
        return None
    was = model.training
    model.eval()
    offset = 0
    losses = []
    usable = int(val_stream.size) - SEQ_LEN - 1
    with torch.inference_mode():
        for _ in range(n_batches):
            xs = []
            ys = []
            for _b in range(min(MICRO_BATCH, 4)):
                if offset > usable:
                    offset = 0
                xs.append(val_stream[offset : offset + SEQ_LEN])
                ys.append(val_stream[offset + 1 : offset + SEQ_LEN + 1])
                offset += SEQ_LEN
            x = torch.tensor(np.stack(xs), dtype=torch.long, device=device)
            y = torch.tensor(np.stack(ys), dtype=torch.long, device=device)
            logits = model(x)
            loss = F.cross_entropy(logits.reshape(-1, VOCAB_SIZE), y.reshape(-1))
            if not torch.isfinite(loss):
                if was:
                    model.train()
                return None
            losses.append(float(loss.item()))
    if was:
        model.train()
    return float(sum(losses) / len(losses)) if losses else None


def encode_prompt_ids(tokenizer: Tokenizer, prompt: str) -> list[int]:
    bos = tokenizer.token_to_id("<|bos|>")
    body = tokenizer.encode(prompt, add_special_tokens=False).ids
    return [int(bos), *body]


def teacher_force_nll(model: WRIM0Model, prompt_ids: list[int], target_ids: list[int], device: torch.device) -> dict[str, float]:
    ids = prompt_ids + target_ids
    if len(ids) < 2 or not target_ids:
        return {"nll": float("nan"), "mean_token_prob": float("nan"), "mean_entropy_tf": float("nan")}
    x = torch.tensor([ids[:-1]], dtype=torch.long, device=device)
    was = model.training
    model.eval()
    with torch.inference_mode():
        logits = model(x)[0]
        start = len(prompt_ids) - 1
        tlogits = logits[start : start + len(target_ids)].float()
        logp = F.log_softmax(tlogits, dim=-1)
        idx = torch.arange(len(target_ids), device=device)
        tgt = torch.tensor(target_ids, dtype=torch.long, device=device)
        tok_nll = -logp[idx, tgt]
        probs = torch.exp(-tok_nll)
        ents = []
        for i in range(tlogits.size(0)):
            p = torch.softmax(tlogits[i], dim=-1)
            ents.append(float(-(p * torch.log(p.clamp_min(1e-12))).sum().item()))
    if was:
        model.train()
    return {
        "nll": float(tok_nll.mean().item()),
        "mean_token_prob": float(probs.mean().item()),
        "mean_entropy_tf": float(sum(ents) / len(ents)),
    }


def summarize_nll_deltas(deltas: list[float]) -> dict[str, float]:
    if not deltas:
        return {"mean": float("nan"), "median": float("nan"), "worst": float("nan"), "std": float("nan")}
    return {
        "mean": float(statistics.mean(deltas)),
        "median": float(statistics.median(deltas)),
        "worst": float(max(deltas)),
        "std": float(statistics.pstdev(deltas)) if len(deltas) > 1 else 0.0,
    }


def wrim0_retention_targets(model: WRIM0Model, tokenizer: Tokenizer, device: torch.device, dump_root: Path) -> dict[str, Any]:
    items = load_retention_items(dump_root)
    torch.manual_seed(EVAL_SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(EVAL_SEED)
    targets = []
    for it in items:
        prompt = it.get("generation_prompt") or it["prompt"]
        prompt_ids = encode_prompt_ids(tokenizer, prompt)
        gen = greedy_generate(model, tokenizer, prompt, device)
        target_ids = list(gen["new_ids"])
        nll = teacher_force_nll(model, prompt_ids, target_ids, device)
        targets.append(
            {
                "evalId": it.get("evalId"),
                "prompt": prompt,
                "prompt_ids": prompt_ids,
                "target_ids": target_ids,
                "nll_wrim0": nll["nll"],
                "mean_token_prob_wrim0": nll["mean_token_prob"],
                "binary_pass_wrim0": score_retention(gen, it.get("expected") or {}),
                "unique_ratio_wrim0": gen.get("unique_ratio"),
                "entropy_wrim0": gen.get("entropy"),
                "continuation_fingerprint_wrim0": hashlib.sha256((gen.get("continuation") or "").encode("utf-8")).hexdigest()[:16],
            }
        )
    return {"eval_seed": EVAL_SEED, "items": targets}


def retention_nll_eval(model, tokenizer, device, dump_root, targets: dict[str, Any]) -> dict[str, Any]:
    items = load_retention_items(dump_root)
    by_id = {it.get("evalId"): it for it in items}
    rows = []
    deltas = []
    for tgt in targets["items"]:
        prompt = tgt["prompt"]
        gen = greedy_generate(model, tokenizer, prompt, device)
        nll = teacher_force_nll(model, tgt["prompt_ids"], tgt["target_ids"], device)
        delta = float(nll["nll"] - tgt["nll_wrim0"])
        expected = (by_id.get(tgt["evalId"]) or {}).get("expected") or {}
        binary = score_retention(gen, expected)
        deltas.append(delta)
        rows.append(
            {
                "evalId": tgt["evalId"],
                "nll": nll["nll"],
                "nll_wrim0_baseline": tgt["nll_wrim0"],
                "nll_delta": delta,
                "mean_token_prob": nll["mean_token_prob"],
                "entropy_tf": nll["mean_entropy_tf"],
                "entropy_first": gen.get("entropy"),
                "unique_ratio": gen.get("unique_ratio"),
                "max_token_run": gen.get("max_run"),
                "continuation_fingerprint": hashlib.sha256((gen.get("continuation") or "").encode("utf-8")).hexdigest()[:16],
                "binary_pass": binary,
                "collapsed": gen.get("collapsed"),
                "continuation": (gen.get("continuation") or "")[:160],
            }
        )
    summary = summarize_nll_deltas(deltas)
    return {
        "items": rows,
        "mean_nll_delta": summary["mean"],
        "median_nll_delta": summary["median"],
        "worst_item_nll_delta": summary["worst"],
        "std_nll_delta": summary["std"],
        "binary_pass": int(sum(1 for r in rows if r["binary_pass"])),
        "binary_total": len(rows),
    }


def hard_stop_decision(step0: dict, now: dict, history: list[dict]) -> tuple[bool, str | None, str | None]:
    """Return (stop, rule, warning). Binary 6/6→5/6 is WARNING, not automatic stop."""
    floor = int(step0.get("collapsed_probes") or 0)
    collapse = int(now.get("collapsed_probes") or 0)
    nll0 = float(step0.get("mean_nll_delta") or 0.0)
    nll = float(now.get("mean_nll_delta") or 0.0)
    warning = None
    ret0 = int(step0.get("retention_pass") or 0)
    ret = int(now.get("retention_pass") or 0)
    if ret < ret0:
        warning = f"RETENTION_WARNING binary {ret}/{now.get('retention_total')} vs step-0 {ret0}"

    if collapse >= floor + 4:
        return True, "extreme repetition collapse: collapsed_probes >= WRIM-0 floor + 4", warning
    if int(now.get("special_token_loops") or 0) > 0:
        return True, "extreme repetition collapse: special-token loop", warning
    if int(now.get("max_token_run") or 0) >= 24 and int(now.get("punct_dominated_count") or 0) >= 4:
        return True, "extreme repetition collapse: max_token_run>=24 and punct_dominated>=4", warning

    prior = history[-2] if len(history) >= 2 else None
    if prior is not None:
        prior_collapse = int(prior.get("collapsed_probes") or 0)
        prior_nll = float(prior.get("mean_nll_delta") or 0.0)
        if collapse >= floor + 2 and prior_collapse >= floor + 2 and nll > 0.75 and prior_nll > 0.75:
            return True, (
                "severe collapse plus large continuous retention degradation: "
                "collapsed_probes >= floor+2 AND mean NLL_DELTA > 0.75 for two consecutive evals"
            ), warning
    return False, None, warning


def save_model_only(ckpt_dir: Path, model: WRIM0Model, step: int, tokens: int) -> dict:
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    model_cpu = {k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}
    save_hash = tensors_sha256(model_cpu)
    model_path = ckpt_dir / "model.safetensors"
    save_file(model_cpu, str(model_path))
    meta = {
        "model_path": str(model_path),
        "model_sha256": sha256_file(model_path),
        "save_hash": save_hash,
        "step": step,
        "tokens": tokens,
        "kind": "TEST_ONLY",
        "promotion_candidate": False,
    }
    write_json(ckpt_dir / "checkpoint.json", meta)
    return meta


def load_parent_model(weights: Path, device: torch.device) -> tuple[WRIM0Model, str]:
    raw, hdr = load_model_state_from_safetensors(weights)
    model = WRIM0Model()
    missing = [k for k in expected_torch_keys() if k not in raw]
    if missing:
        raise RuntimeError(f"parent missing keys: {missing[:8]}")
    model.load_state_dict(raw, strict=True)
    parent_hash = tensors_sha256({k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()})
    model = model.to(device)
    return model, parent_hash


def cell_id(strategy: str, peak_lr: float, seed: int) -> str:
    lr_key = "3e-5" if abs(peak_lr - 3e-5) < 1e-12 else "2e-5"
    return f"{strategy}__{lr_key}__s{seed}"


def factor_cell_id(strategy: str, peak_lr: float) -> str:
    lr_key = "3e-5" if abs(peak_lr - 3e-5) < 1e-12 else "2e-5"
    return f"{strategy}__{lr_key}"


def run_one(
    *,
    strategy: str,
    peak_lr: float,
    seed: int,
    raw_families: dict,
    val_stream: np.ndarray,
    tokenizer: Tokenizer,
    dump_root: Path,
    weights: Path,
    out_root: Path,
    device: torch.device,
    parent_hash: str,
    targets: dict[str, Any],
    parent_mtime: int,
    tokenizer_sha: str,
) -> dict[str, Any]:
    rid = cell_id(strategy, peak_lr, seed)
    run_dir = out_root / rid
    run_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    free0 = disk_gb(run_dir)
    warnings: list[str] = []
    collapse_events: list[dict] = []
    if free0 < DISK_STOP_GB:
        payload = {"ok": False, "run_id": rid, "stopped_reason": "disk safety violation", "hard_stop_rule": f"free {free0:.1f}GB < {DISK_STOP_GB}GB"}
        write_json(run_dir / "run.json", payload)
        return payload
    if free0 < DISK_WARN_GB:
        warnings.append(f"disk warn {free0:.1f}GB < {DISK_WARN_GB}GB")

    packed = pack_train_stream(raw_families, tokenizer, strategy=strategy, seed=seed, dump_root=dump_root)
    audit = packed["audit"]
    write_json(run_dir / "packing-audit.json", audit)
    if not audit.get("packing_ok"):
        payload = {
            "ok": False,
            "run_id": rid,
            "stopped_reason": "packing violation",
            "hard_stop_rule": "packing_ok is false",
            "audit": audit,
        }
        write_json(run_dir / "run.json", payload)
        return payload

    n_micro = STEPS * GRAD_ACCUM
    batches = slice_contiguous_batches(packed["stream"], n_micro, MICRO_BATCH, SEQ_LEN)
    batch_audit = causal_batch_audit(batches, packed["stream"])
    if not batch_audit.get("ok"):
        payload = {"ok": False, "run_id": rid, "stopped_reason": "packing violation", "hard_stop_rule": "causal_batch_audit failed", "batch_audit": batch_audit}
        write_json(run_dir / "run.json", payload)
        return payload

    torch.manual_seed(seed)
    np.random.seed(seed % (2**31))
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)

    model, loaded_hash = load_parent_model(weights, device)
    if loaded_hash != parent_hash:
        payload = {"ok": False, "run_id": rid, "stopped_reason": "parent mismatch", "hard_stop_rule": "reloaded parent hash != experiment parent hash"}
        write_json(run_dir / "run.json", payload)
        return payload
    model.enable_training()
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=peak_lr,
        betas=BETAS,
        eps=EPS,
        weight_decay=WEIGHT_DECAY,
        fused=False,
    )

    def eval_at(step: int, train_loss: float | None) -> dict[str, Any]:
        torch.manual_seed(EVAL_SEED)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(EVAL_SEED)
        state = {k: v.detach().cpu() for k, v in model.state_dict().items()}
        wh = tensors_sha256(state)
        vloss = measure_val_loss(model, val_stream, device)
        row = evaluate_stability(model, tokenizer, device, dump_root, val_loss=vloss, train_loss=train_loss, weight_hash=wh)
        nll = retention_nll_eval(model, tokenizer, device, dump_root, targets)
        row["step"] = step
        row["mean_nll_delta"] = nll["mean_nll_delta"]
        row["median_nll_delta"] = nll["median_nll_delta"]
        row["worst_item_nll_delta"] = nll["worst_item_nll_delta"]
        row["std_nll_delta"] = nll["std_nll_delta"]
        row["retention_nll_items"] = nll["items"]
        row["retention_pass"] = nll["binary_pass"]
        row["retention_total"] = nll["binary_total"]
        row["retention_family"] = f"{nll['binary_pass']}/{nll['binary_total']}"
        row["lr"] = lr_at_step(max(0, step - 1), peak_lr) if step > 0 else 0.0
        return row

    evals: list[dict] = []
    train_curve: list[dict] = []
    last_train_loss = None
    stopped_step = STEPS
    hard_stop_rule = None
    status = "COMPLETED"
    tokens = 0

    step0 = eval_at(0, None)
    evals.append(step0)

    optimizer.zero_grad(set_to_none=True)
    for step in range(1, STEPS + 1):
        lr = lr_at_step(step - 1, peak_lr)
        for g in optimizer.param_groups:
            g["lr"] = lr
        micro_losses = []
        for a in range(GRAD_ACCUM):
            x_np, y_np = batches[(step - 1) * GRAD_ACCUM + a]
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            logits = model(x)
            loss = F.cross_entropy(logits.reshape(-1, VOCAB_SIZE), y.reshape(-1)) / GRAD_ACCUM
            if not torch.isfinite(loss):
                hard_stop_rule = "NaN/Inf loss"
                status = "HARD_STOP"
                stopped_step = step
                collapse_events.append({"step": step, "rule": hard_stop_rule})
                break
            loss.backward()
            micro_losses.append(float(loss.item()) * GRAD_ACCUM)
            tokens += MICRO_BATCH * SEQ_LEN
        if status == "HARD_STOP":
            save_model_only(run_dir / f"step-{stopped_step}-sentinel", model, stopped_step, tokens)
            break
        grads_ok = True
        for p in model.parameters():
            if p.grad is not None and not torch.isfinite(p.grad).all():
                grads_ok = False
                break
        if not grads_ok:
            hard_stop_rule = "NaN/Inf gradients"
            status = "HARD_STOP"
            stopped_step = step
            collapse_events.append({"step": step, "rule": hard_stop_rule})
            save_model_only(run_dir / f"step-{stopped_step}-sentinel", model, stopped_step, tokens)
            break
        torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP)
        optimizer.step()
        optimizer.zero_grad(set_to_none=True)
        last_train_loss = float(sum(micro_losses) / len(micro_losses))
        train_curve.append({"step": step, "loss": last_train_loss, "lr": lr, "tokens": tokens})

        if step in EVAL_STEPS:
            ev = eval_at(step, last_train_loss)
            evals.append(ev)
            stop, rule, warn = hard_stop_decision(step0, ev, evals)
            if warn:
                warnings.append(f"step {step}: {warn}")
            if stop:
                hard_stop_rule = rule
                status = "HARD_STOP"
                stopped_step = step
                collapse_events.append({"step": step, "rule": rule, "mean_nll_delta": ev.get("mean_nll_delta")})
                save_model_only(run_dir / f"step-{step}-sentinel", model, step, tokens)
                break

        if step in SAVE_STEPS and status != "HARD_STOP":
            ckpt = save_model_only(run_dir / f"step-{step}", model, step, tokens)
            reload_hash = tensors_sha256({k: v.detach().cpu().contiguous() for k, v in load_file(str(Path(ckpt["model_path"]))).items()})
            if reload_hash != ckpt["save_hash"]:
                hard_stop_rule = "checkpoint corruption"
                status = "HARD_STOP"
                stopped_step = step
                collapse_events.append({"step": step, "rule": hard_stop_rule})
                break

        free = disk_gb(run_dir)
        if free < DISK_STOP_GB:
            hard_stop_rule = f"disk safety violation free {free:.1f}GB < {DISK_STOP_GB}GB"
            status = "HARD_STOP"
            stopped_step = step
            save_model_only(run_dir / f"step-{step}-sentinel", model, step, tokens)
            break

    parent_unmodified = weights.stat().st_mtime_ns == parent_mtime
    tok_unmodified = tokenizer_sha == TOKENIZER_SHA
    last_eval = evals[-1]
    if status == "COMPLETED" and last_eval.get("retention_pass", 6) < int(step0.get("retention_pass") or 6):
        status = "COMPLETED_WITH_RETENTION_WARNING"

    payload = {
        "ok": status != "HARD_STOP",
        "run_id": rid,
        "experiment_id": EXPERIMENT_ID,
        "kind": "TEST_ONLY",
        "classification": "CONTROLLED_EXPERIMENT",
        "promotion_candidate": False,
        "stage3_started": False,
        "rehearsal_strategy": strategy,
        "peak_lr": peak_lr,
        "lr_cell": LR_LABEL[peak_lr],
        "seed": seed,
        "status": status,
        "stopped_step": stopped_step,
        "hard_stop_rule": hard_stop_rule,
        "warnings": warnings,
        "collapse_events": collapse_events,
        "n_steps_ran": stopped_step if status == "HARD_STOP" else STEPS,
        "tokens_seen": tokens,
        "effective_batch": MICRO_BATCH * GRAD_ACCUM,
        "micro_batch": MICRO_BATCH,
        "gradient_accumulation": GRAD_ACCUM,
        "sequence_length": SEQ_LEN,
        "warmup": WARMUP,
        "optimizer": {"name": "AdamW", "betas": list(BETAS), "eps": EPS, "weight_decay": WEIGHT_DECAY, "grad_clip": GRAD_CLIP, "fresh": True, "fused": False},
        "packing": {
            "packer_version": audit.get("packer_version"),
            "rehearsal_pct": audit.get("rehearsal_pct"),
            "wr_corpus_1_pct": audit.get("wr_corpus_1_pct"),
            "actual_mix": audit.get("actual_mix"),
            "genesis_prefix_audit": audit.get("genesis_prefix_audit"),
            "packing_ok": audit.get("packing_ok"),
            "tool_use_pct": 0.0,
        },
        "train_curve": train_curve,
        "evals": [{k: v for k, v in e.items() if k not in ("diagnostic_items",)} for e in evals],
        "step0_binary": step0.get("retention_family"),
        "final_binary": last_eval.get("retention_family"),
        "final_mean_nll_delta": last_eval.get("mean_nll_delta"),
        "final_val_loss": last_eval.get("validation_loss"),
        "final_train_loss": last_train_loss,
        "final_entropy": last_eval.get("mean_entropy"),
        "final_diversity": last_eval.get("generation_diversity"),
        "checkpoint_health": "OK" if status != "HARD_STOP" or hard_stop_rule != "checkpoint corruption" else "CORRUPT",
        "parent_unmodified": parent_unmodified,
        "tokenizer_unmodified": tok_unmodified,
        "elapsed_s": round(time.perf_counter() - t0, 3),
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "RAEL": "NOT_IMPLEMENTED",
        "QWEN": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "READY_FOR_STAGE3_TRAINING_AUTHORIZATION": "NO",
    }
    write_json(run_dir / "run.json", payload)
    del model
    del optimizer
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    print(json.dumps({"run_id": rid, "status": status, "final_mean_nll_delta": payload["final_mean_nll_delta"], "final_binary": payload["final_binary"]}, indent=2))
    return payload


def load_model_from_ckpt(ckpt_dir: Path, device: torch.device) -> WRIM0Model:
    loaded = load_file(str(ckpt_dir / "model.safetensors"))
    model = WRIM0Model()
    model.load_state_dict(loaded, strict=True)
    return model.to(device)


def interpolate_state(cand: dict[str, torch.Tensor], parent: dict[str, torch.Tensor], alpha: float) -> dict[str, torch.Tensor]:
    out = {}
    for k in cand:
        out[k] = ((1.0 - alpha) * cand[k].float() + alpha * parent[k].float()).contiguous()
    return out


def four_stats(xs: list[float]) -> dict[str, float | None]:
    clean = [x for x in xs if x is not None and isinstance(x, (int, float)) and math.isfinite(float(x))]
    if not clean:
        return {"mean": None, "std": None, "min": None, "max": None, "n": 0}
    vals = [float(x) for x in clean]
    return {
        "mean": float(statistics.mean(vals)),
        "std": float(statistics.stdev(vals)) if len(vals) > 1 else 0.0,
        "min": float(min(vals)),
        "max": float(max(vals)),
        "n": len(vals),
    }


def classify(cells: dict[str, dict], skewed_high_runs: list[dict]) -> tuple[str, str, bool]:
    """Descriptive n=3. Do not overclaim."""
    def cell_mean(cid: str, key: str = "mean_nll_delta") -> float | None:
        st = cells.get(cid, {}).get(key) or {}
        return st.get("mean")

    sh = cell_mean("SKEWED_BASELINE__3e-5")
    sl = cell_mean("SKEWED_BASELINE__2e-5")
    bh = cell_mean("BALANCED_GENESIS__3e-5")
    bl = cell_mean("BALANCED_GENESIS__2e-5")
    if any(v is None for v in (sh, sl, bh, bl)):
        return "E", "INCONCLUSIVE: missing cell means", False

    seed_sds = []
    for cid, row in cells.items():
        sd = (row.get("mean_nll_delta") or {}).get("std")
        if sd is not None:
            seed_sds.append(float(sd))
    noise = float(statistics.mean(seed_sds)) if seed_sds else 0.0
    noise = max(noise, 1e-4)

    rehearsal_high = float(bh) - float(sh)
    rehearsal_low = float(bl) - float(sl)
    rehearsal_effect = statistics.mean([rehearsal_high, rehearsal_low])
    lr_skewed = float(sl) - float(sh)
    lr_bal = float(bl) - float(bh)
    lr_effect = statistics.mean([lr_skewed, lr_bal])
    interaction = rehearsal_high - rehearsal_low

    # Negative NLL delta is better (less forgetting vs WRIM-0).
    # Effect of BALANCED vs SKEWED: rehearsal_effect < 0 means balancing helps.
    # Effect of LOW vs HIGH LR: lr_effect < 0 means lowering LR helps.
    reh_matters = abs(rehearsal_effect) > 2.0 * noise
    lr_matters = abs(lr_effect) > 2.0 * noise
    both_same_sign_reh = (rehearsal_high < 0 and rehearsal_low < 0) or (rehearsal_high > 0 and rehearsal_low > 0)
    both_same_sign_lr = (lr_skewed < 0 and lr_bal < 0) or (lr_skewed > 0 and lr_bal > 0)

    reproduced = 0
    for run in skewed_high_runs:
        last = (run.get("evals") or [{}])[-1]
        nll = float(last.get("mean_nll_delta") or 0)
        uniq_fail = False
        for ev in run.get("evals") or []:
            for item in ev.get("retention_nll_items") or []:
                if item.get("evalId") == "cap0-ret-02" and item.get("binary_pass") is False:
                    uniq_fail = True
        binary_drop = int(last.get("retention_pass") or 6) < 6
        if uniq_fail or binary_drop or nll > 0.15:
            reproduced += 1
    event_reproduces = reproduced >= 2

    note = (
        f"rehearsal_effect={rehearsal_effect:.4f} (BAL-SKEW; neg=balancing helps); "
        f"lr_effect={lr_effect:.4f} (LOW-HIGH; neg=lower LR helps); "
        f"interaction={interaction:.4f}; seed_sd_mean={noise:.4f}; "
        f"STAB-000001-like events in SKEWED+HIGH: {reproduced}/3"
    )

    consistent = event_reproduces or (reh_matters and both_same_sign_reh) or (lr_matters and both_same_sign_lr)
    if not event_reproduces and not reh_matters and not lr_matters:
        return "D", f"NEITHER_RELIABLY_REPRODUCES. {note}", False
    if reh_matters and lr_matters and both_same_sign_reh and both_same_sign_lr:
        return "C", f"BOTH_MATTER. {note}", True
    if lr_matters and both_same_sign_lr and (not reh_matters or not both_same_sign_reh):
        return "A", f"LR_DOMINANT. {note}", True
    if reh_matters and both_same_sign_reh and (not lr_matters or not both_same_sign_lr):
        return "B", f"REHEARSAL_BALANCING_DOMINANT. {note}", True
    if abs(interaction) > 2.0 * noise:
        return "C", f"BOTH_MATTER (interaction). {note}", True
    return "E", f"INCONCLUSIVE. {note}", False


def main() -> int:
    payload = {
        "ok": False,
        "error": "TRAINING_AUTHORIZATION=OFF",
        "reason": (
            "The 12-run grid with gradient_accumulation=4 and SKEWED_BASELINE is SUPERSEDED. "
            "Phase 0 only. Optimizer steps are forbidden. Do not start this script."
        ),
        "experiment_id": EXPERIMENT_ID,
        "optimizer_steps": 0,
        "stage3_started": False,
        "promotion_candidate": False,
        "CLEAR_TO_RUN": False,
    }
    print(json.dumps(payload, indent=2))
    return 3
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--dump-root", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--ckpt-root", required=True)
    args = ap.parse_args()

    weights = Path(args.weights)
    tokenizer_path = Path(args.tokenizer)
    dump_root = Path(args.dump_root)
    report_path = Path(args.report)
    ckpt_root = Path(args.ckpt_root)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    ckpt_root.mkdir(parents=True, exist_ok=True)

    disable_tf32()
    if not torch.cuda.is_available():
        payload = {"ok": False, "error": "CUDA required", "experiment_id": EXPERIMENT_ID}
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2))
        return 2

    parent_mtime = weights.stat().st_mtime_ns
    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tokenizer_path)
    if parent_sha != PARENT_SHA or tok_sha != TOKENIZER_SHA:
        payload = {"ok": False, "error": "HASH_MISMATCH", "parent_sha": parent_sha, "tokenizer_sha": tok_sha, "stage3_started": False}
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2))
        return 2

    device = torch.device("cuda")
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    print("[experiment] encoding families once", flush=True)
    raw = encode_raw_families(dump_root, tokenizer)
    print("[experiment] packing shared validation stream", flush=True)
    val_pack = pack_val_stream(dump_root, tokenizer)
    val_stream = val_pack["val_stream"]

    parent_model, parent_hash = load_parent_model(weights, device)
    parent_model.freeze_inference()
    print("[experiment] WRIM-0 retention NLL baselines", flush=True)
    targets = wrim0_retention_targets(parent_model, tokenizer, device, dump_root)
    write_json(ckpt_root / "wrim0-nll-baseline.json", {**targets, "items": [{k: v for k, v in it.items() if k not in ("prompt_ids", "target_ids")} | {"n_prompt_ids": len(it["prompt_ids"]), "n_target_ids": len(it["target_ids"])} for it in targets["items"]]})
    parent_cpu = {k: v.detach().cpu().contiguous() for k, v in parent_model.state_dict().items()}
    del parent_model
    torch.cuda.empty_cache()

    runs: list[dict] = []
    t_grid = time.perf_counter()
    for strategy in STRATEGIES:
        for peak_lr in PEAK_LRS:
            for seed in SEEDS:
                print(f"[experiment] START {cell_id(strategy, peak_lr, seed)}", flush=True)
                row = run_one(
                    strategy=strategy,
                    peak_lr=peak_lr,
                    seed=seed,
                    raw_families=raw,
                    val_stream=val_stream,
                    tokenizer=tokenizer,
                    dump_root=dump_root,
                    weights=weights,
                    out_root=ckpt_root,
                    device=device,
                    parent_hash=parent_hash,
                    targets=targets,
                    parent_mtime=parent_mtime,
                    tokenizer_sha=tok_sha,
                )
                runs.append(row)

    # Aggregate cells
    cells: dict[str, dict] = {}
    for strategy in STRATEGIES:
        for peak_lr in PEAK_LRS:
            cid = factor_cell_id(strategy, peak_lr)
            group = [r for r in runs if r.get("rehearsal_strategy") == strategy and abs(float(r.get("peak_lr") or 0) - peak_lr) < 1e-12]
            healthy = [r for r in group if r.get("status") in ("COMPLETED", "COMPLETED_WITH_RETENTION_WARNING")]
            cells[cid] = {
                "rehearsal_strategy": strategy,
                "peak_lr": peak_lr,
                "lr_cell": LR_LABEL[peak_lr],
                "n_runs": len(group),
                "n_healthy": len(healthy),
                "seeds": [r.get("seed") for r in group],
                "mean_nll_delta": four_stats([r.get("final_mean_nll_delta") for r in group]),
                "validation_loss": four_stats([r.get("final_val_loss") for r in group]),
                "training_loss": four_stats([r.get("final_train_loss") for r in group]),
                "diversity": four_stats([r.get("final_diversity") for r in group]),
                "entropy": four_stats([r.get("final_entropy") for r in group]),
                "binary_retention_count": four_stats([
                    int(str(r.get("final_binary") or "0/6").split("/")[0]) for r in group
                ]),
            }
            best = None
            best_score = None
            for r in healthy:
                score = r.get("final_mean_nll_delta")
                if score is None:
                    continue
                if best_score is None or float(score) < best_score:
                    best = r
                    best_score = float(score)
            cells[cid]["best_healthy_run_id"] = None if best is None else best.get("run_id")

    # Interpolation
    interp_results = []
    for cid, cell in cells.items():
        rid = cell.get("best_healthy_run_id")
        if not rid:
            interp_results.append({"cell": cid, "skipped": True, "reason": "no healthy candidate"})
            continue
        cand_dir = ckpt_root / rid / "step-50"
        if not (cand_dir / "model.safetensors").exists():
            # last saved
            matches = sorted((ckpt_root / rid).glob("step-*/model.safetensors"))
            if not matches:
                interp_results.append({"cell": cid, "skipped": True, "reason": "no checkpoint"})
                continue
            cand_dir = matches[-1].parent
        cand = load_file(str(cand_dir / "model.safetensors"))
        cell_rows = []
        for alpha in ALPHAS:
            merged = interpolate_state(cand, parent_cpu, alpha)
            model = WRIM0Model()
            model.load_state_dict(merged, strict=True)
            model = model.to(device)
            model.freeze_inference()
            torch.manual_seed(EVAL_SEED)
            if torch.cuda.is_available():
                torch.cuda.manual_seed_all(EVAL_SEED)
            vloss = measure_val_loss(model, val_stream, device)
            stab = evaluate_stability(model, tokenizer, device, dump_root, val_loss=vloss, train_loss=None, weight_hash=tensors_sha256(merged))
            nll = retention_nll_eval(model, tokenizer, device, dump_root, targets)
            out_dir = ckpt_root / "interpolation" / cid / f"alpha-{alpha}"
            out_dir.mkdir(parents=True, exist_ok=True)
            save_file({k: v.cpu().contiguous() for k, v in merged.items()}, str(out_dir / "model.safetensors"))
            row = {
                "cell": cid,
                "candidate_run_id": rid,
                "alpha": alpha,
                "kind": "TEST_ONLY_MERGED",
                "promotion_candidate": False,
                "mean_nll_delta": nll["mean_nll_delta"],
                "median_nll_delta": nll["median_nll_delta"],
                "worst_item_nll_delta": nll["worst_item_nll_delta"],
                "validation_loss": vloss,
                "diversity": stab.get("generation_diversity"),
                "entropy": stab.get("mean_entropy"),
                "json_valid": stab.get("json_valid"),
                "binary_retention": nll["binary_pass"],
                "retention_family": f"{nll['binary_pass']}/{nll['binary_total']}",
            }
            write_json(out_dir / "eval.json", row)
            cell_rows.append(row)
            del model
            torch.cuda.empty_cache()
        best_a = min(cell_rows, key=lambda r: float(r["mean_nll_delta"])) if cell_rows else None
        interp_results.append({"cell": cid, "candidate_run_id": rid, "sweep": cell_rows, "best_alpha": None if best_a is None else best_a["alpha"], "best_mean_nll_delta": None if best_a is None else best_a["mean_nll_delta"]})

    skewed_high = [r for r in runs if r.get("rehearsal_strategy") == "SKEWED_BASELINE" and abs(float(r.get("peak_lr") or 0) - 3e-5) < 1e-12]
    decision, decision_note, consistent = classify(cells, skewed_high)

    # Recommendations
    lr_helps = (cells.get("SKEWED_BASELINE__2e-5", {}).get("mean_nll_delta") or {}).get("mean", 0) < (cells.get("SKEWED_BASELINE__3e-5", {}).get("mean_nll_delta") or {}).get("mean", 0)
    bal_helps = (cells.get("BALANCED_GENESIS__3e-5", {}).get("mean_nll_delta") or {}).get("mean", 0) < (cells.get("SKEWED_BASELINE__3e-5", {}).get("mean_nll_delta") or {}).get("mean", 0)
    interp_helps = any(
        (block.get("best_mean_nll_delta") is not None and block.get("best_alpha") is not None and float(block["best_mean_nll_delta"]) < 0)
        for block in interp_results
        if not block.get("skipped")
    )
    flat_lr_rec = (
        "JUSTIFIED_FOR_LATER_PROBE"
        if lr_helps and decision in ("A", "C")
        else "NOT_JUSTIFIED_FROM_THIS_GRID"
    )
    l2sp_rec = "RECOMMEND_TEST_NEXT" if interp_helps or decision in ("A", "C", "B") else "LOW_PRIORITY"
    lora_rec = "RECOMMEND_TEST_NEXT" if decision in ("A", "C") and not (bal_helps and not lr_helps) else "OPTIONAL_AFTER_L2SP"
    freeze_rec = "RECOMMEND_SELECTIVE_FREEZE_PROBE" if interp_helps else "NOT_FIRST_LINE"

    stage3_recipe = None
    ready_design = "NO"
    if consistent and decision in ("A", "B", "C"):
        ready_design = "YES"
        peak = 2e-5 if lr_helps else 3e-5
        reh = "BALANCED_GENESIS" if bal_helps else "SKEWED_BASELINE"
        stage3_recipe = {
            "authorized": False,
            "note": "PROPOSED RECIPE ONLY. Stage 3 is NOT authorized. Do not start WRIM1-RUN-000003.",
            "parent": "WRIM-0",
            "architecture": "WRIM-G-20M-v1-option-A",
            "tokenizer": "WR-TOKENIZER-0",
            "rehearsal_strategy": reh,
            "peak_lr": peak,
            "warmup": WARMUP,
            "micro_batch": MICRO_BATCH,
            "gradient_accumulation": GRAD_ACCUM,
            "effective_batch": 32,
            "wr_corpus_0": 0.30,
            "wr_corpus_1": 0.70,
            "tool_use": 0.0,
            "locked_wr_corpus_1_mix": LOCKED_MIX,
        }

    parent_unmodified = weights.stat().st_mtime_ns == parent_mtime
    report = {
        "ok": len(runs) == 12,
        "experiment_id": EXPERIMENT_ID,
        "kind": "TEST_ONLY",
        "classification": "CONTROLLED_EXPERIMENT",
        "promotion_candidate": False,
        "stage3_started": False,
        "READY_FOR_STAGE3_TRAINING_AUTHORIZATION": "NO",
        "READY_FOR_STAGE3_DESIGN": ready_design,
        "decision": decision,
        "decision_note": decision_note,
        "WRIM_STAGE2": "STAGE2_STOPPED_BY_SENTINEL",
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "CURRENT_WRIM_TRAINING": "NOT_RUNNING",
        "TRAINING_AUTHORIZATION": "OFF",
        "RAEL": "NOT_IMPLEMENTED",
        "QWEN": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "roadmap_22": "CLOSED",
        "roadmap_23": "ACTIVE",
        "invariants": {
            "parent": "WRIM-0",
            "parent_sha256": PARENT_SHA,
            "tokenizer": "WR-TOKENIZER-0",
            "tokenizer_sha256": TOKENIZER_SHA,
            "architecture": "WRIM-G-20M-v1-option-A",
            "architecture_unchanged": True,
            "dtype": "FP32",
            "tf32": False,
            "sequence_length": SEQ_LEN,
            "micro_batch": MICRO_BATCH,
            "gradient_accumulation": GRAD_ACCUM,
            "effective_batch": MICRO_BATCH * GRAD_ACCUM,
            "steps_per_run": STEPS,
            "tokens_per_step": TOKENS_PER_STEP,
            "tool_use": 0,
            "wr_corpus_active": 0,
            "global_rehearsal_ratio": 0.30,
            "locked_mix": LOCKED_MIX,
            "warmup": WARMUP,
            "optimizer": "fresh AdamW every run",
            "betas": list(BETAS),
            "eps": EPS,
            "weight_decay": WEIGHT_DECAY,
            "grad_clip": GRAD_CLIP,
            "packing": "contiguous unit packing, BOS/EOS, no per-token shuffle",
            "eval_steps": EVAL_STEPS,
        },
        "run_matrix": [{"strategy": s, "peak_lr": lr, "seed": seed, "run_id": cell_id(s, lr, seed)} for s in STRATEGIES for lr in PEAK_LRS for seed in SEEDS],
        "runs": [{k: v for k, v in r.items() if k != "evals"} | {"eval_count": len(r.get("evals") or []), "evals_path": str(ckpt_root / r.get("run_id", "") / "run.json")} for r in runs],
        "cells": cells,
        "interpolation": interp_results,
        "flat_lr_recommendation": flat_lr_rec,
        "l2sp_recommendation": l2sp_rec,
        "lora_recommendation": lora_rec,
        "freezing_recommendation": freeze_rec,
        "proposed_stage3_recipe": stage3_recipe,
        "parent_unmodified": parent_unmodified,
        "tokenizer_unmodified": tok_sha == TOKENIZER_SHA,
        "n_runs": len(runs),
        "elapsed_s": round(time.perf_counter() - t_grid, 3),
        "nothing_pushed": True,
        "nothing_deployed": True,
        "val_pack": {k: v for k, v in val_pack.items() if k != "val_stream"},
        "wrim0_nll_baseline": [{k: it[k] for k in ("evalId", "nll_wrim0", "binary_pass_wrim0", "unique_ratio_wrim0")} for it in targets["items"]],
    }
    # Keep full run evals on disk; attach compact curves to report
    report["per_run_curves"] = {
        r["run_id"]: {
            "train": r.get("train_curve"),
            "val": [{"step": e.get("step"), "validation_loss": e.get("validation_loss")} for e in r.get("evals") or []],
            "nll": [{"step": e.get("step"), "mean_nll_delta": e.get("mean_nll_delta"), "median": e.get("median_nll_delta"), "worst": e.get("worst_item_nll_delta"), "binary": e.get("retention_family")} for e in r.get("evals") or []],
            "per_item_nll": {
                item.get("evalId"): [
                    {"step": e.get("step"), "nll_delta": next((x.get("nll_delta") for x in (e.get("retention_nll_items") or []) if x.get("evalId") == item.get("evalId")), None),
                     "binary_pass": next((x.get("binary_pass") for x in (e.get("retention_nll_items") or []) if x.get("evalId") == item.get("evalId")), None),
                     "unique_ratio": next((x.get("unique_ratio") for x in (e.get("retention_nll_items") or []) if x.get("evalId") == item.get("evalId")), None)}
                    for e in r.get("evals") or []
                ]
                for item in (r.get("evals") or [{}])[-1].get("retention_nll_items") or []
            },
            "entropy": [{"step": e.get("step"), "mean_entropy": e.get("mean_entropy")} for e in r.get("evals") or []],
            "diversity": [{"step": e.get("step"), "generation_diversity": e.get("generation_diversity")} for e in r.get("evals") or []],
        }
        for r in runs if r.get("run_id")
    }
    write_json(report_path, report)
    print(json.dumps({"ok": True, "decision": decision, "READY_FOR_STAGE3_DESIGN": ready_design, "n_runs": len(runs), "report": str(report_path)}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
