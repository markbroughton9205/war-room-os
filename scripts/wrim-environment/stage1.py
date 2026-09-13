"""Stage 1 WRIM-0 diagnostic: 10 AdamW steps, save, reload, STOP.

Pipeline (Commander-authorized, TEST_ONLY, not promotion, not Ra'el):
load WRIM-0 → corrected packed batch → forward → loss → backward → grads →
AdamW step → repeat exactly 10 times → save diagnostic checkpoint → reload →
verify it still works → STOP.

Does not overwrite the historical WRIM-0 parent. Does not resume MLX opt.*.
Does not start Stage 2 or WRIM1-RUN-000003.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from safetensors.torch import load_file, save_file
from tokenizers import Tokenizer

from safetensors_model import load_model_state_from_safetensors
from stage1_pack import (
    SEQ_LEN,
    causal_batch_audit,
    build_corrected_stream,
    slice_contiguous_batches,
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
RUN_ID = "WRIM1-NEBULA-DIAG-000001"
STEPS = 10
BATCH = 8
PEAK_LR = 3e-5
WARMUP = 25
BETAS = (0.9, 0.95)
EPS = 1e-8
WEIGHT_DECAY = 0.1
GRAD_CLIP = 1.0
RUNTIME_SEED = 1337
DISK_STOP_GB = 32
DISK_WARN_GB = 64
SMOKE_PROMPT = "The sky is"


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


def lr_at_step(step: int) -> float:
    # 0-indexed training step. Step 9 (10th update) → 10/25 * 3e-5 = 1.2e-5.
    return PEAK_LR * (step + 1) / max(1, WARMUP)


def entropy_from_logits(logits: torch.Tensor) -> float:
    x = logits.float()
    x = x - x.max()
    p = torch.softmax(x, dim=-1)
    return float(-(p * torch.log(p.clamp_min(1e-12))).sum().item())


def smoke_forward(model: WRIM0Model, tokenizer: Tokenizer, device: torch.device) -> dict:
    enc = tokenizer.encode(SMOKE_PROMPT, add_special_tokens=False)
    ids = [1, *enc.ids]
    prompt = torch.tensor([ids], dtype=torch.long, device=device)
    was_training = model.training
    model.eval()
    with torch.inference_mode():
        logits = model(prompt)[0, -1]
        argmax = int(torch.argmax(logits).item())
        ent = entropy_from_logits(logits)
        finite = bool(torch.isfinite(logits).all().item())
    if was_training:
        model.train()
    return {"argmax_id": argmax, "entropy": ent, "finite": finite, "prompt_ids": ids}


def disk_gb(path: Path) -> float:
    usage = shutil.disk_usage(path)
    return usage.free / (1024**3)


def collect_optimizer_tensors(optimizer: torch.optim.AdamW, model: WRIM0Model) -> dict[str, torch.Tensor]:
    name_of = {id(p): n for n, p in model.named_parameters()}
    out: dict[str, torch.Tensor] = {}
    for p in optimizer.param_groups[0]["params"]:
        st = optimizer.state.get(p)
        if not st:
            continue
        name = name_of[id(p)]
        out[f"{name}.exp_avg"] = st["exp_avg"].detach().cpu().contiguous()
        out[f"{name}.exp_avg_sq"] = st["exp_avg_sq"].detach().cpu().contiguous()
        out[f"{name}.step"] = torch.tensor(int(st["step"]), dtype=torch.int64)
    return out


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--dump-root", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--ckpt-dir", required=True)
    args = ap.parse_args()

    weights = Path(args.weights)
    tokenizer_path = Path(args.tokenizer)
    dump_root = Path(args.dump_root)
    report_path = Path(args.report)
    ckpt_dir = Path(args.ckpt_dir)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    ckpt_dir.mkdir(parents=True, exist_ok=True)

    parent_mtime_before = weights.stat().st_mtime_ns
    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tokenizer_path)
    free_gb = disk_gb(ckpt_dir)
    fail_base = {
        "ok": False,
        "run_id": RUN_ID,
        "kind": "TEST_ONLY",
        "promotion_candidate": False,
        "WRIM_STAGE1": "FAILED",
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "CURRENT_WRIM_TRAINING": "NOT_RUNNING",
        "TRAINING_AUTHORIZATION": "OFF",
        "RAEL": "NOT_IMPLEMENTED",
        "QWEN": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "parent_sha": parent_sha,
        "tokenizer_sha": tok_sha,
        "wrote_parent": False,
        "stopped_after_steps": 0,
        "stage2_started": False,
        "stage3_started": False,
    }
    if parent_sha != PARENT_SHA or tok_sha != TOKENIZER_SHA:
        payload = {**fail_base, "error": "HASH_MISMATCH"}
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2))
        return 2
    if free_gb < DISK_STOP_GB:
        payload = {**fail_base, "error": "DISK_STOP", "free_gb": free_gb}
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2))
        return 2

    disable_tf32()
    torch.manual_seed(RUNTIME_SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(RUNTIME_SEED)
    # Stage 1 does not require bit-perfect CUDA determinism. Record the attempt only.
    det_note = "not_required_stage1"
    try:
        torch.use_deterministic_algorithms(False)
    except Exception as e:  # noqa: BLE001
        det_note = f"flag_error:{type(e).__name__}"

    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    packed = build_corrected_stream(dump_root=dump_root, tokenizer=tokenizer)
    stream = packed["stream"]
    audit = packed["audit"]
    if not audit["packing_ok"]:
        payload = {**fail_base, "error": "PACKING_AUDIT_FAILED", "packing": audit}
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2))
        return 1

    batches = slice_contiguous_batches(stream, STEPS, BATCH, SEQ_LEN)
    causal = causal_batch_audit(batches, stream)
    if not causal["ok"]:
        payload = {**fail_base, "error": "CAUSAL_BATCH_FAILED", "causal": causal, "packing": audit}
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2))
        return 1

    np.save(ckpt_dir / "train-stream.npy", stream)
    write_json(ckpt_dir / "packing-audit.json", {**audit, "causal": causal})

    if not torch.cuda.is_available():
        payload = {**fail_base, "error": "CUDA_REQUIRED"}
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2))
        return 1
    device = torch.device("cuda")
    gpu_name = torch.cuda.get_device_name(0)
    if "5060 Ti" not in gpu_name:
        payload = {**fail_base, "error": "WRONG_GPU", "gpu": gpu_name}
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2))
        return 1

    disable_tf32()
    state, coverage = load_model_state_from_safetensors(weights)
    expected = expected_torch_keys()
    mapping_ok = (
        coverage["mapped"] == 164
        and not coverage["missing"]
        and coverage["skipped_opt"] > 0
        and not coverage["lm_head_present"]
        and len(state) == 164
        and len(expected) == 164
    )
    if not mapping_ok:
        payload = {**fail_base, "error": "MAPPING_FAILED", "mapping": coverage}
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2))
        return 1

    model = WRIM0Model()
    model.load_state_dict(state, strict=True)
    model.enable_training()
    model = model.to(device)
    n_trainable = sum(int(p.requires_grad) for p in model.parameters())
    n_params = sum(int(p.numel()) for p in model.parameters())

    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=lr_at_step(0),
        betas=BETAS,
        eps=EPS,
        weight_decay=WEIGHT_DECAY,
        fused=False,
    )

    smoke0 = smoke_forward(model, tokenizer, device)
    torch.cuda.reset_peak_memory_stats()
    metrics = []
    t_run = time.perf_counter()
    for step in range(STEPS):
        lr = lr_at_step(step)
        for pg in optimizer.param_groups:
            pg["lr"] = lr
        x_np, y_np = batches[step]
        x = torch.tensor(x_np, dtype=torch.long, device=device)
        y = torch.tensor(y_np, dtype=torch.long, device=device)
        optimizer.zero_grad(set_to_none=True)
        logits = model(x)
        loss = F.cross_entropy(logits.reshape(-1, VOCAB_SIZE), y.reshape(-1))
        loss_finite = bool(torch.isfinite(loss).item())
        if not loss_finite:
            payload = {**fail_base, "error": "NONFINITE_LOSS", "step": step, "metrics": metrics}
            write_json(report_path, payload)
            print(json.dumps(payload, indent=2))
            return 1
        loss.backward()
        grads_finite = True
        grad_sq = 0.0
        for p in model.parameters():
            if p.grad is None:
                grads_finite = False
                break
            if not torch.isfinite(p.grad).all():
                grads_finite = False
                break
            grad_sq += float(p.grad.detach().float().pow(2).sum().item())
        if not grads_finite:
            payload = {**fail_base, "error": "NONFINITE_OR_MISSING_GRAD", "step": step, "metrics": metrics}
            write_json(report_path, payload)
            print(json.dumps(payload, indent=2))
            return 1
        grad_norm_pre = math.sqrt(grad_sq)
        clip_norm = float(torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP))
        optimizer.step()
        torch.cuda.synchronize()
        row = {
            "step": step + 1,
            "lr": lr,
            "loss": float(loss.detach().item()),
            "grad_norm_pre_clip": grad_norm_pre,
            "grad_norm_clip_return": clip_norm,
            "loss_finite": True,
            "grads_finite": True,
            "tokens": BATCH * SEQ_LEN,
        }
        metrics.append(row)
        print(json.dumps(row), flush=True)
        del logits, loss, x, y

    train_s = time.perf_counter() - t_run
    peak_vram = int(torch.cuda.max_memory_allocated())
    smoke10 = smoke_forward(model, tokenizer, device)

    model_cpu_state = {k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}
    save_hash = tensors_sha256(model_cpu_state)
    model_path = ckpt_dir / "model.safetensors"
    save_file(model_cpu_state, str(model_path))
    opt_tensors = collect_optimizer_tensors(optimizer, model)
    opt_path = ckpt_dir / "optimizer.safetensors"
    save_file(opt_tensors, str(opt_path))
    model_sha = sha256_file(model_path)

    # Reload into a fresh module. Do not take an 11th optimizer step.
    reloaded = WRIM0Model()
    loaded = load_file(str(model_path))
    reloaded.load_state_dict(loaded, strict=True)
    reload_hash = tensors_sha256({k: v.detach().cpu().contiguous() for k, v in reloaded.state_dict().items()})
    hash_match = save_hash == reload_hash
    reloaded.enable_training()
    reloaded = reloaded.to(device)
    reloaded.eval()
    x_np, y_np = batches[-1]
    x = torch.tensor(x_np, dtype=torch.long, device=device)
    y = torch.tensor(y_np, dtype=torch.long, device=device)
    model.eval()
    with torch.inference_mode():
        logits_saved = model(x)
        logits_loaded = reloaded(x)
        reload_finite = bool(torch.isfinite(logits_loaded).all().item())
        reload_loss = float(F.cross_entropy(logits_loaded.reshape(-1, VOCAB_SIZE), y.reshape(-1)).item())
        saved_loss = float(F.cross_entropy(logits_saved.reshape(-1, VOCAB_SIZE), y.reshape(-1)).item())
        max_diff = float((logits_saved - logits_loaded).abs().max().item())
    logits_match = max_diff < 1e-5 and math.isfinite(reload_loss) and reload_finite
    smoke_reload = smoke_forward(reloaded, tokenizer, device)
    smoke_works = bool(smoke_reload["finite"] and smoke10["finite"] and smoke0["finite"])

    opt_reload = load_file(str(opt_path))
    opt_steps = [int(v.item()) for k, v in opt_reload.items() if k.endswith(".step")]
    opt_ok = bool(opt_steps) and all(s == STEPS for s in opt_steps)

    parent_mtime_after = weights.stat().st_mtime_ns
    parent_unmodified = parent_mtime_before == parent_mtime_after and sha256_file(weights) == PARENT_SHA

    plumbing = (
        mapping_ok
        and audit["packing_ok"]
        and causal["ok"]
        and len(metrics) == STEPS
        and all(m["loss_finite"] and m["grads_finite"] for m in metrics)
        and hash_match
        and logits_match
        and smoke_works
        and opt_ok
        and parent_unmodified
        and n_params == 19_217_152
    )
    started = datetime.now(timezone.utc).isoformat()
    manifest = {
        "run_id": RUN_ID,
        "kind": "TEST_ONLY",
        "promotion_status": "NOT_A_CANDIDATE",
        "parent_model": "WRIM-0",
        "parent_sha": parent_sha,
        "architecture_id": "WRIM-G-20M-v1-option-A",
        "tokenizer_id": "WR-TOKENIZER-0",
        "tokenizer_sha": tok_sha,
        "packing_method": "CONTIGUOUS_UNIT_PACK_DEFICIT_INTERLEAVE",
        "eos_policy": "append EOS=2 every unit",
        "bos_policy": "prepend BOS=1 every unit",
        "optimizer": "AdamW",
        "resume_historical_mlx": False,
        "lr_initial": 0,
        "lr_peak": PEAK_LR,
        "lr_min": 3e-6,
        "warmup_steps": WARMUP,
        "schedule": "linear warmup 0→3e-5 over 25; Stage 1 stays in warmup",
        "lr_step_10": lr_at_step(STEPS - 1),
        "betas": list(BETAS),
        "eps": EPS,
        "weight_decay": WEIGHT_DECAY,
        "gradient_clip_norm": GRAD_CLIP,
        "fused": False,
        "batch": BATCH,
        "sequence": CONTEXT_LENGTH,
        "accumulation": 1,
        "precision": "FP32",
        "tf32": False,
        "seed_runtime": RUNTIME_SEED,
        "seed_data": 20260912,
        "seed_packing": 20260912,
        "hardware": gpu_name,
        "software": {"torch": torch.__version__, "torch_cuda": torch.version.cuda, "python": sys.version.split()[0]},
        "steps": STEPS,
        "tokens": STEPS * BATCH * SEQ_LEN,
        "started_utc": started,
        "verdict": "PASS" if plumbing else "FAIL",
        "stage2_started": False,
        "stage3_started": False,
        "rael": "NOT_IMPLEMENTED",
    }
    write_json(ckpt_dir / "run-manifest.json", manifest)

    payload = {
        "ok": plumbing,
        "run_id": RUN_ID,
        "kind": "TEST_ONLY",
        "promotion_candidate": False,
        "WRIM_ENVIRONMENT": "READY",
        "WRIM_PYTORCH_PORT": "STAGE0_VERIFIED",
        "WRIM_STAGE1": "STAGE1_VERIFIED" if plumbing else "FAILED",
        "WRIM_TRAINING": "NOT_RUNNING",
        "TRAINING_AUTHORIZATION": "OFF",
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "QWEN": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "RAEL": "NOT_IMPLEMENTED",
        "NEXT_AUTHORIZED_PASS": "READY_FOR_STAGE2_AUTHORIZATION" if plumbing else "STAGE1_FAILED",
        "architecture": {
            "id": "WRIM-G-20M-v1-option-A",
            "layers": N_LAYERS,
            "d_model": D_MODEL,
            "heads": N_HEADS,
            "head_dim": HEAD_DIM,
            "d_ff": D_FF,
            "context": CONTEXT_LENGTH,
            "vocab": VOCAB_SIZE,
            "tied_embeddings": True,
            "lm_head": False,
            "attention": "reference_explicit_causal_not_sdpa",
        },
        "parent_sha": parent_sha,
        "tokenizer_sha": tok_sha,
        "parent_unmodified": parent_unmodified,
        "mapping": coverage,
        "mapping_ok": mapping_ok,
        "trainable_tensors": n_trainable,
        "parameter_count": n_params,
        "packing": audit,
        "causal": causal,
        "steps": metrics,
        "n_steps": len(metrics),
        "tokens": STEPS * BATCH * SEQ_LEN,
        "optimizer": {
            "algorithm": "AdamW",
            "fresh": True,
            "resumed_mlx": False,
            "betas": list(BETAS),
            "weight_decay": WEIGHT_DECAY,
            "eps": EPS,
            "fused": False,
            "clip": GRAD_CLIP,
            "step_count_on_reload": opt_steps[0] if opt_steps else None,
            "optimizer_reload_ok": opt_ok,
        },
        "smoke_step0": smoke0,
        "smoke_step10": smoke10,
        "smoke_reload": smoke_reload,
        "checkpoint": {
            "dir": str(ckpt_dir),
            "model": str(model_path),
            "model_sha256": model_sha,
            "save_hash": save_hash,
            "reload_hash": reload_hash,
            "hash_match": hash_match,
            "reload_logits_max_diff": max_diff,
            "reload_loss": reload_loss,
            "saved_eval_loss": saved_loss,
            "reload_finite": reload_finite,
            "logits_match": logits_match,
            "works_after_reload": logits_match and smoke_works and hash_match,
        },
        "vram_peak_bytes": peak_vram,
        "train_seconds": train_s,
        "free_gb": free_gb,
        "disk_warn_gb": DISK_WARN_GB,
        "deterministic_algorithms": det_note,
        "tf32_enabled": bool(torch.backends.cuda.matmul.allow_tf32),
        "backward": True,
        "new_training_checkpoint": True,
        "wrote_parent": False,
        "pickle_used": False,
        "stage2_started": False,
        "stage3_started": False,
        "stopped": True,
        "software": {
            "torch": torch.__version__,
            "torch_cuda": torch.version.cuda,
            "python": sys.version.split()[0],
        },
    }
    write_json(report_path, payload)
    write_json(ckpt_dir / "stage1-report.json", payload)
    summary = {
        "ok": payload["ok"],
        "WRIM_STAGE1": payload["WRIM_STAGE1"],
        "n_steps": payload["n_steps"],
        "losses": [m["loss"] for m in metrics],
        "parent_unmodified": parent_unmodified,
        "reload_works": payload["checkpoint"]["works_after_reload"],
        "stopped": True,
        "NEXT_AUTHORIZED_PASS": payload["NEXT_AUTHORIZED_PASS"],
    }
    print(json.dumps(summary, indent=2), flush=True)
    return 0 if plumbing else 1


if __name__ == "__main__":
    sys.exit(main())
