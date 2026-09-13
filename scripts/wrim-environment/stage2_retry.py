"""Stage 2 retry WRIM-0 stability run: WRIM1-NEBULA-STAB-000002.

TEST_ONLY. STABILITY_RETRY. Not promotion. Not Stage 3.
Starts from WRIM-0. Fresh AdamW. Peak LR 2e-5. Document-balanced rehearsal.
Code <= 18% of total tokens. Unchanged retention sentinel.
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
from stage1_pack import SEQ_LEN, causal_batch_audit, slice_contiguous_batches
from stage2_eval import evaluate_stability, sentinel_decision
from stage2_retry_pack import (
    BATCH,
    NEEDED_TRAIN_TOKENS,
    PACKER_VERSION,
    REHEARSAL_TARGET_PCT,
    STEPS,
    build_stage2_retry_streams,
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
RUN_ID = "WRIM1-NEBULA-STAB-000002"
PEAK_LR = 2e-5
MIN_LR = 2e-6
WARMUP = 25
BETAS = (0.9, 0.95)
EPS = 1e-8
WEIGHT_DECAY = 0.1
GRAD_CLIP = 1.0
RUNTIME_SEED = 1337
PACKING_SEED = 20260912
EVAL_SEED = 42
DISK_STOP_GB = 32
DISK_WARN_GB = 64
EVAL_EVERY = 10
RETENTION_EXTRA_AFTER = 20
RETENTION_EVERY = 5
SAVE_EVAL_STEPS = {10, 20, 30, 40, 50}
STARTING_REASON = (
    "Fresh STAB-000002 from WRIM-0 parent weights for clean comparison. "
    "Does not continue STAB-000001, Stage 1, collapsed WRIM-1, or rejected recovery checkpoints. "
    "Fresh AdamW; peak LR 2e-5; document-balanced rehearsal; code cap 18% of total tokens."
)


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


def module_group(name: str) -> str:
    if name.startswith("tok_emb"):
        return "embeddings"
    if name.startswith("norm_f"):
        return "final_norm"
    if ".attn_norm." in name or ".ffn_norm." in name:
        return "block_norms"
    if ".attn." in name:
        return "attention"
    if ".ffn." in name:
        return "ffn"
    return "other"


def module_deltas_vs(parent: dict[str, torch.Tensor], current: dict[str, torch.Tensor]) -> dict[str, dict[str, float]]:
    acc: dict[str, dict[str, float]] = {}
    for k, p in parent.items():
        a = p.detach().float().cpu()
        b = current[k].detach().float().cpu()
        g = module_group(k)
        slot = acc.setdefault(g, {"sum_sq": 0.0, "n": 0, "max_abs": 0.0})
        slot["sum_sq"] += float((b - a).pow(2).sum().item())
        slot["n"] += int(a.numel())
        slot["max_abs"] = max(slot["max_abs"], float((b - a).abs().max().item()))
    return {
        g: {"rms": math.sqrt(v["sum_sq"] / max(1, v["n"])), "n_params": int(v["n"]), "max_abs": v["max_abs"]}
        for g, v in acc.items()
    }


def watch_item(ev: dict, eval_id: str) -> dict | None:
    for it in ev.get("retention_items") or []:
        if it.get("evalId") == eval_id:
            return {
                "evalId": eval_id,
                "pass": it.get("pass"),
                "unique_ratio": it.get("unique_ratio"),
                "entropy": it.get("entropy"),
                "argmax_id": it.get("argmax_id"),
                "argmax_prob": it.get("argmax_prob"),
                "max_run": it.get("max_run"),
                "collapsed": it.get("collapsed"),
                "continuation_fingerprint": it.get("continuation_fingerprint"),
            }
    return None


def should_eval(completed: int) -> bool:
    if completed % EVAL_EVERY == 0:
        return True
    return completed > RETENTION_EXTRA_AFTER and completed % RETENTION_EVERY == 0


def disable_tf32() -> None:
    if torch.cuda.is_available():
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.backends.cudnn.benchmark = False
    if hasattr(torch, "set_float32_matmul_precision"):
        torch.set_float32_matmul_precision("highest")


def lr_at_step(step: int) -> float:
    """0-indexed. Warmup 25 then cosine over remaining 25 of the 50-step bound."""
    if step < WARMUP:
        return PEAK_LR * (step + 1) / WARMUP
    progress = (step - WARMUP) / max(1, STEPS - WARMUP)
    progress = min(1.0, max(0.0, progress))
    cosine = 0.5 * (1.0 + math.cos(math.pi * progress))
    return MIN_LR + (PEAK_LR - MIN_LR) * cosine


def disk_gb(path: Path) -> float:
    return shutil.disk_usage(path).free / (1024**3)


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


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
            for _b in range(min(BATCH, 4)):
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


def fail_payload(extra: dict) -> dict:
    return {
        "ok": False,
        "run_id": RUN_ID,
        "kind": "TEST_ONLY",
        "classification": "STABILITY_RETRY",
        "promotion_candidate": False,
        "WRIM_STAGE2": extra.get("WRIM_STAGE2", "STAGE2_RETRY_FAIL"),
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "CURRENT_WRIM_TRAINING": "NOT_RUNNING",
        "TRAINING_AUTHORIZATION": "OFF",
        "RAEL": "NOT_IMPLEMENTED",
        "QWEN": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "stage3_started": False,
        "stopped": True,
        **extra,
    }


def save_eval_checkpoint(ckpt_dir: Path, model: WRIM0Model, step: int) -> dict:
    dest = ckpt_dir / f"step-{step}"
    dest.mkdir(parents=True, exist_ok=True)
    model_cpu = {k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}
    model_path = dest / "model.safetensors"
    save_file(model_cpu, str(model_path))
    return {
        "step": step,
        "model_path": str(model_path),
        "model_sha256": sha256_file(model_path),
        "save_hash": tensors_sha256(model_cpu),
    }


def save_checkpoint(ckpt_dir: Path, model: WRIM0Model, optimizer: torch.optim.AdamW, step: int, tokens: int) -> dict:
    model_cpu = {k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}
    save_hash = tensors_sha256(model_cpu)
    model_path = ckpt_dir / "model.safetensors"
    save_file(model_cpu, str(model_path))
    save_file(collect_optimizer_tensors(optimizer, model), str(ckpt_dir / "optimizer.safetensors"))
    return {
        "model_path": str(model_path),
        "model_sha256": sha256_file(model_path),
        "save_hash": save_hash,
        "step": step,
        "tokens": tokens,
    }


def verify_reload(ckpt_dir: Path, device: torch.device, tokenizer: Tokenizer, dump_root: Path) -> dict:
    model_path = ckpt_dir / "model.safetensors"
    loaded = load_file(str(model_path))
    fresh = WRIM0Model()
    fresh.load_state_dict(loaded, strict=True)
    reload_hash = tensors_sha256({k: v.detach().cpu().contiguous() for k, v in fresh.state_dict().items()})
    fresh.eval()
    fresh = fresh.to(device)
    from stage2_eval import greedy_generate

    smoke = greedy_generate(fresh, tokenizer, "The sky is", device, max_new=8)
    return {
        "reload_hash": reload_hash,
        "n_tensors": len(fresh.state_dict()),
        "architecture": "WRIM-G-20M-v1-option-A",
        "tokenizer_bound": True,
        "finite_logits": bool(smoke["finite"]),
        "finite_entropy": bool(smoke["entropy"] is not None and math.isfinite(smoke["entropy"])),
        "entropy": smoke["entropy"],
        "argmax_id": smoke["argmax_id"],
        "continuation": smoke["continuation"],
    }


def run_eval(model, tokenizer, device, dump_root, val_stream, train_loss, parent_hash) -> dict:
    state = {k: v.detach().cpu() for k, v in model.state_dict().items()}
    wh = tensors_sha256(state)
    vloss = measure_val_loss(model, val_stream, device)
    row = evaluate_stability(
        model, tokenizer, device, dump_root, val_loss=vloss, train_loss=train_loss, weight_hash=wh
    )
    row["weight_drift_vs_parent"] = wh != parent_hash
    row["weight_hash_vs_parent_changed"] = wh != parent_hash
    return row


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--dump-root", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--ckpt-dir", required=True)
    ap.add_argument("--verify-only", action="store_true")
    args = ap.parse_args()

    weights = Path(args.weights)
    tokenizer_path = Path(args.tokenizer)
    dump_root = Path(args.dump_root)
    report_path = Path(args.report)
    ckpt_dir = Path(args.ckpt_dir)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    ckpt_dir.mkdir(parents=True, exist_ok=True)

    if args.verify_only:
        disable_tf32()
        device = torch.device("cuda")
        tok = Tokenizer.from_file(str(tokenizer_path))
        result = verify_reload(ckpt_dir, device, tok, dump_root)
        write_json(ckpt_dir / "reload-verify.json", result)
        print(json.dumps({"ok": result["finite_logits"] and result["finite_entropy"], **result}, indent=2))
        return 0 if result["finite_logits"] and result["finite_entropy"] else 1

    parent_mtime_before = weights.stat().st_mtime_ns
    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tokenizer_path)
    free_gb = disk_gb(ckpt_dir)
    if parent_sha != PARENT_SHA or tok_sha != TOKENIZER_SHA:
        payload = fail_payload({"error": "HASH_MISMATCH", "parent_sha": parent_sha, "tokenizer_sha": tok_sha})
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2))
        return 2
    if free_gb < DISK_STOP_GB:
        payload = fail_payload({"error": "DISK_STOP", "free_gb": free_gb})
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2))
        return 2

    grant = {
        "id": "STAGE2_RETRY_HISTORICAL_CORPUS_AUTHORIZATION",
        "run_id": RUN_ID,
        "classification": "TEST_ONLY",
        "applies_only_to": RUN_ID,
        "authorized_corpora": ["WR-CORPUS-0 rehearsal", "WR-CORPUS-1-HARDENED train (eval-infra and TOOL_USE excluded)"],
        "not_authorized": ["WRIM1-RUN-000003", "Stage 3", "WR-CORPUS-ACTIVE", "global ELIGIBLE promotion", "test shard", "eval-only"],
        "global_historical_eligibility_promoted": False,
        "created_utc": datetime.now(timezone.utc).isoformat(),
    }
    write_json(ckpt_dir / "corpus-authorization.json", grant)

    disable_tf32()
    torch.manual_seed(RUNTIME_SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(RUNTIME_SEED)

    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    packed = build_stage2_retry_streams(dump_root=dump_root, tokenizer=tokenizer)
    stream = packed["stream"]
    val_stream = packed["val_stream"]
    audit = packed["audit"]
    write_json(ckpt_dir / "packing-audit.json", audit)
    np.save(ckpt_dir / "train-stream.npy", stream)
    np.save(ckpt_dir / "val-stream.npy", val_stream)

    if not audit["packing_ok"]:
        payload = fail_payload({"error": "PACKING_AUDIT_FAILED", "packing": audit, "WRIM_STAGE2": "STAGE2_RETRY_FAIL"})
        write_json(report_path, payload)
        print(json.dumps({"ok": False, "error": "PACKING_AUDIT_FAILED", "rehearsal_pct": audit.get("rehearsal_pct"), "ratio_ok": audit.get("ratio_ok")}, indent=2))
        return 1

    batches = slice_contiguous_batches(stream, STEPS, BATCH, SEQ_LEN)
    causal = causal_batch_audit(batches, stream)
    if not causal["ok"]:
        payload = fail_payload({"error": "CAUSAL_BATCH_FAILED", "causal": causal})
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2))
        return 1

    if not torch.cuda.is_available():
        payload = fail_payload({"error": "CUDA_REQUIRED"})
        write_json(report_path, payload)
        return 1
    device = torch.device("cuda")
    gpu_name = torch.cuda.get_device_name(0)
    if "5060 Ti" not in gpu_name:
        payload = fail_payload({"error": "WRONG_GPU", "gpu": gpu_name})
        write_json(report_path, payload)
        return 1

    disable_tf32()
    state, coverage = load_model_state_from_safetensors(weights)
    mapping_ok = coverage["mapped"] == 164 and not coverage["missing"] and coverage["skipped_opt"] > 0 and len(state) == 164
    if not mapping_ok:
        payload = fail_payload({"error": "MAPPING_FAILED", "mapping": coverage})
        write_json(report_path, payload)
        return 1

    model = WRIM0Model()
    model.load_state_dict(state, strict=True)
    model.enable_training()
    model = model.to(device)
    n_params = sum(int(p.numel()) for p in model.parameters())
    parent_cpu = {k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}
    parent_hash = tensors_sha256(parent_cpu)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=lr_at_step(0),
        betas=BETAS,
        eps=EPS,
        weight_decay=WEIGHT_DECAY,
        fused=False,
    )

    evals: list[dict] = []
    metrics: list[dict] = []
    sentinel_events: list[dict] = []
    eval_ckpts: list[dict] = []
    verdict = "STAGE2_RETRY_PASS"
    stop_reason = None

    torch.cuda.reset_peak_memory_stats()
    t_run = time.perf_counter()
    step0 = run_eval(model, tokenizer, device, dump_root, val_stream, train_loss=None, parent_hash=parent_hash)
    step0["step"] = 0
    step0["module_deltas_vs_wrim0"] = module_deltas_vs(parent_cpu, parent_cpu)
    step0["cap0_ret_01"] = watch_item(step0, "cap0-ret-01")
    step0["cap0_ret_02"] = watch_item(step0, "cap0-ret-02")
    evals.append(step0)
    print(
        json.dumps(
            {
                "eval_step": 0,
                "collapsed": step0["collapsed_probes"],
                "retention": step0["retention_family"],
                "val": step0["validation_loss"],
                "uniq": step0["mean_unique_ratio"],
                "ret01": step0["cap0_ret_01"],
                "ret02": step0["cap0_ret_02"],
            }
        ),
        flush=True,
    )

    tokens_seen = 0
    last_train_loss = None
    completed_steps = 0
    for step in range(STEPS):
        t0 = time.perf_counter()
        lr = lr_at_step(step)
        if lr > PEAK_LR + 1e-12:
            payload = fail_payload({"error": "LR_EXCEEDED_PEAK", "lr": lr})
            write_json(report_path, payload)
            return 1
        for pg in optimizer.param_groups:
            pg["lr"] = lr
        x_np, y_np = batches[step]
        x = torch.tensor(x_np, dtype=torch.long, device=device)
        y = torch.tensor(y_np, dtype=torch.long, device=device)
        optimizer.zero_grad(set_to_none=True)
        logits = model(x)
        loss = F.cross_entropy(logits.reshape(-1, VOCAB_SIZE), y.reshape(-1))
        if not bool(torch.isfinite(loss).item()):
            verdict = "STAGE2_RETRY_STOPPED_BY_SENTINEL"
            stop_reason = f"NONFINITE_LOSS at step {step + 1}"
            sentinel_events.append({"step": step + 1, "reason": stop_reason})
            break
        loss.backward()
        grads_finite = True
        grad_missing = False
        grad_sq = 0.0
        for p in model.parameters():
            if p.grad is None:
                grad_missing = True
                grads_finite = False
                break
            if not torch.isfinite(p.grad).all():
                grads_finite = False
                break
            grad_sq += float(p.grad.detach().float().pow(2).sum().item())
        if grad_missing or not grads_finite:
            verdict = "STAGE2_RETRY_STOPPED_BY_SENTINEL"
            stop_reason = f"{'ZERO_OR_MISSING_GRAD' if grad_missing else 'NONFINITE_GRAD'} at step {step + 1}"
            sentinel_events.append({"step": step + 1, "reason": stop_reason})
            break
        grad_pre = math.sqrt(grad_sq)
        if grad_pre > 1e6:
            verdict = "STAGE2_RETRY_STOPPED_BY_SENTINEL"
            stop_reason = f"EXPLODING_GRAD {grad_pre} at step {step + 1}"
            sentinel_events.append({"step": step + 1, "reason": stop_reason})
            break
        clip_ret = float(torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP))
        after_sq = 0.0
        for p in model.parameters():
            if p.grad is not None:
                after_sq += float(p.grad.detach().float().pow(2).sum().item())
        grad_after = math.sqrt(after_sq)
        update_norm = math.sqrt(sum(float((p.grad * lr).detach().float().pow(2).sum().item()) for p in model.parameters() if p.grad is not None))
        optimizer.step()
        torch.cuda.synchronize()
        elapsed = time.perf_counter() - t0
        tokens_seen += BATCH * SEQ_LEN
        completed_steps = step + 1
        last_train_loss = float(loss.detach().item())
        row = {
            "step": completed_steps,
            "tokens_seen": tokens_seen,
            "lr": lr,
            "train_loss": last_train_loss,
            "grad_norm_pre_clip": grad_pre,
            "grad_norm_after_clip": grad_after,
            "grad_norm_clip_return": clip_ret,
            "bounded_update_norm": update_norm,
            "clip_event": bool(grad_pre > GRAD_CLIP),
            "elapsed_s": elapsed,
            "tokens_per_sec": (BATCH * SEQ_LEN) / elapsed if elapsed > 0 else None,
            "vram_allocated": int(torch.cuda.memory_allocated()),
            "vram_reserved": int(torch.cuda.memory_reserved()),
            "loss_finite": True,
            "grads_finite": True,
        }
        metrics.append(row)
        print(json.dumps(row), flush=True)
        del logits, loss, x, y

        if should_eval(completed_steps):
            ev = run_eval(model, tokenizer, device, dump_root, val_stream, last_train_loss, parent_hash)
            ev["step"] = completed_steps
            ev["module_deltas_vs_wrim0"] = module_deltas_vs(parent_cpu, {k: v.detach().cpu() for k, v in model.state_dict().items()})
            ev["cap0_ret_01"] = watch_item(ev, "cap0-ret-01")
            ev["cap0_ret_02"] = watch_item(ev, "cap0-ret-02")
            evals.append(ev)
            print(
                json.dumps(
                    {
                        "eval_step": completed_steps,
                        "collapsed": ev["collapsed_probes"],
                        "retention": ev["retention_family"],
                        "val": ev["validation_loss"],
                        "train": last_train_loss,
                        "uniq": ev["mean_unique_ratio"],
                        "ret01": ev["cap0_ret_01"],
                        "ret02": ev["cap0_ret_02"],
                    }
                ),
                flush=True,
            )
            if completed_steps in SAVE_EVAL_STEPS:
                eval_ckpts.append(save_eval_checkpoint(ckpt_dir, model, completed_steps))
            stop, reason = sentinel_decision(step0, ev, evals)
            if stop:
                verdict = "STAGE2_RETRY_STOPPED_BY_SENTINEL"
                stop_reason = reason
                sentinel_events.append({"step": completed_steps, "reason": reason})
                break

    train_s = time.perf_counter() - t_run
    peak_vram = int(torch.cuda.max_memory_allocated())
    saved_steps = {c["step"] for c in eval_ckpts}
    if completed_steps not in saved_steps and completed_steps > 0:
        eval_ckpts.append(save_eval_checkpoint(ckpt_dir, model, completed_steps))
    ckpt_meta = save_checkpoint(ckpt_dir, model, optimizer, completed_steps, tokens_seen)

    # In-process reload, then fresh-process verify.
    reload_inproc = verify_reload(ckpt_dir, device, tokenizer, dump_root)
    hash_match = reload_inproc["reload_hash"] == ckpt_meta["save_hash"]
    proc = None
    try:
        import subprocess

        proc = subprocess.run(
            [
                sys.executable,
                str(Path(__file__).resolve()),
                "--weights",
                str(weights),
                "--tokenizer",
                str(tokenizer_path),
                "--dump-root",
                str(dump_root),
                "--report",
                str(report_path),
                "--ckpt-dir",
                str(ckpt_dir),
                "--verify-only",
            ],
            cwd=str(Path(__file__).resolve().parent),
            capture_output=True,
            text=True,
            timeout=180,
        )
        fresh_ok = proc.returncode == 0
        fresh_out = proc.stdout[-2000:]
    except Exception as e:  # noqa: BLE001
        fresh_ok = False
        fresh_out = str(e)

    parent_mtime_after = weights.stat().st_mtime_ns
    parent_unmodified = parent_mtime_before == parent_mtime_after and sha256_file(weights) == PARENT_SHA

    if completed_steps > STEPS:
        verdict = "STAGE2_RETRY_FAIL"
        stop_reason = "exceeded 50 steps"
    if tokens_seen > STEPS * BATCH * SEQ_LEN:
        verdict = "STAGE2_RETRY_FAIL"
        stop_reason = "exceeded 204800 tokens"

    last_ev = evals[-1] if evals else {}
    eval_steps = [e.get("step") for e in evals]
    ret01_all = [watch_item(e, "cap0-ret-01") for e in evals]
    ret02_all = [watch_item(e, "cap0-ret-02") for e in evals]
    retention_held = all(int(e.get("retention_pass") or 0) == 6 for e in evals)
    ret01_held = all(bool(x and x.get("pass")) for x in ret01_all)
    ret02_held = all(bool(x and x.get("pass")) for x in ret02_all)
    required_evals = [0, 10, 20, 25, 30, 35, 40, 45, 50]
    evals_complete = all(s in eval_steps for s in required_evals)

    pass_ok = (
        verdict == "STAGE2_RETRY_PASS"
        and completed_steps == STEPS
        and tokens_seen == STEPS * BATCH * SEQ_LEN
        and audit["packing_ok"]
        and audit["ratio_ok"]
        and not audit["leak_scan_hits"]
        and not audit.get("genesis_starved")
        and audit.get("genesis_majority_doc") is None
        and float(audit.get("code_pct") or 99) <= 18.0
        and float(audit.get("prefix_code_pct") or 99) <= 18.0
        and all(m["loss_finite"] and m["grads_finite"] for m in metrics)
        and hash_match
        and reload_inproc["finite_logits"]
        and reload_inproc["finite_entropy"]
        and fresh_ok
        and parent_unmodified
        and not sentinel_events
        and retention_held
        and ret01_held
        and ret02_held
        and evals_complete
        and n_params == 19_217_152
    )
    if verdict == "STAGE2_RETRY_PASS" and not pass_ok:
        verdict = "STAGE2_RETRY_FAIL"
        stop_reason = stop_reason or "post-run gate failed"

    ready_s3 = "YES" if verdict == "STAGE2_RETRY_PASS" else "NO"
    next_pass = "READY_FOR_STAGE3_TRAINING_AUTHORIZATION" if verdict == "STAGE2_RETRY_PASS" else "STAGE2_RETRY_STOPPED_OR_FAILED"

    lr_schedule = [lr_at_step(i) for i in range(min(completed_steps, STEPS) or 1)]
    manifest = {
        "run_id": RUN_ID,
        "classification": "TEST_ONLY / STABILITY_RETRY / NOT_PROMOTION_CANDIDATE",
        "parent_sha": parent_sha,
        "tokenizer_sha": tok_sha,
        "corpus_hashes": audit.get("corpus_hashes"),
        "target_mix": audit.get("target_mix"),
        "actual_mix": audit.get("actual_mix"),
        "packer_version": PACKER_VERSION,
        "optimizer": "AdamW fresh",
        "lr_schedule": "warmup 25 then cosine over remaining 25; peak 2e-5 min 2e-6",
        "batch": {"micro": BATCH, "seq": SEQ_LEN, "accum": 1, "effective": BATCH},
        "precision": "FP32",
        "tf32": False,
        "seeds": {"runtime": RUNTIME_SEED, "packing": PACKING_SEED, "eval": EVAL_SEED},
        "hardware": gpu_name,
        "software": {"torch": torch.__version__, "torch_cuda": torch.version.cuda, "python": sys.version.split()[0]},
        "step_count": completed_steps,
        "token_count": tokens_seen,
        "sentinel_state": sentinel_events,
        "verdict": verdict,
        "starting_checkpoint": "WRIM-0 checkpoint-final.safetensors",
        "starting_reason": STARTING_REASON,
        "eval_checkpoints": eval_ckpts,
    }
    write_json(ckpt_dir / "run-manifest.json", manifest)

    payload = {
        "ok": verdict == "STAGE2_RETRY_PASS",
        "run_id": RUN_ID,
        "kind": "TEST_ONLY",
        "classification": "STABILITY_RETRY",
        "promotion_candidate": False,
        "WRIM_ENVIRONMENT": "READY",
        "WRIM_PYTORCH_PORT": "STAGE0_VERIFIED",
        "WRIM_STAGE1": "STAGE1_VERIFIED",
        "WRIM_STAGE2": verdict,
        "WRIM_TRAINING": "NOT_RUNNING",
        "TRAINING_AUTHORIZATION": "OFF",
        "TRAINING_AUTHORIZATION_DURING_RUN": "STAGE2_RETRY_ONLY",
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "QWEN": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "RAEL": "NOT_IMPLEMENTED",
        "READY_FOR_STAGE3_TRAINING_AUTHORIZATION": ready_s3,
        "NEXT_AUTHORIZED_PASS": next_pass,
        "starting_checkpoint": "WRIM-0",
        "starting_reason": STARTING_REASON,
        "parent_sha": parent_sha,
        "tokenizer_sha": tok_sha,
        "parent_unmodified": parent_unmodified,
        "architecture": {
            "id": "WRIM-G-20M-v1-option-A",
            "layers": N_LAYERS,
            "d_model": D_MODEL,
            "heads": N_HEADS,
            "head_dim": HEAD_DIM,
            "d_ff": D_FF,
            "context": CONTEXT_LENGTH,
            "vocab": VOCAB_SIZE,
            "moe": False,
            "sparse": False,
        },
        "corpus_authorization": grant,
        "packing": audit,
        "causal": causal,
        "optimizer": {
            "algorithm": "AdamW",
            "fresh": True,
            "resumed_mlx": False,
            "resumed_stage1": False,
            "betas": list(BETAS),
            "weight_decay": WEIGHT_DECAY,
            "eps": EPS,
            "fused": False,
            "clip": GRAD_CLIP,
        },
        "lr_peak": PEAK_LR,
        "lr_min": MIN_LR,
        "lr_warmup": WARMUP,
        "lr_by_step": lr_schedule,
        "precision": "FP32",
        "tf32_enabled": bool(torch.backends.cuda.matmul.allow_tf32),
        "batch": BATCH,
        "sequence": SEQ_LEN,
        "accumulation": 1,
        "seeds": {"runtime": RUNTIME_SEED, "packing": PACKING_SEED, "eval": EVAL_SEED},
        "n_steps": completed_steps,
        "tokens": tokens_seen,
        "max_authorized_steps": STEPS,
        "max_authorized_tokens": STEPS * BATCH * SEQ_LEN,
        "steps": metrics,
        "evals": [
            {
                **{k: v for k, v in e.items() if k not in ("diagnostic_items", "retention_items")},
                "diagnostic_n": len(e.get("diagnostic_items") or []),
                "retention_n": len(e.get("retention_items") or []),
            }
            for e in evals
        ],
        "eval_full": evals,
        "sentinel_events": sentinel_events,
        "stop_reason": stop_reason,
        "train_seconds": train_s,
        "tokens_per_sec_mean": (tokens_seen / train_s) if train_s > 0 else None,
        "vram_peak_bytes": peak_vram,
        "checkpoint": {
            **ckpt_meta,
            "dir": str(ckpt_dir),
            "hash_match": hash_match,
            "reload": reload_inproc,
            "fresh_process_ok": fresh_ok,
            "fresh_process_out": fresh_out,
        },
        "disk_free_gb": free_gb,
        "mapping": coverage,
        "parameter_count": n_params,
        "eval_checkpoints": eval_ckpts,
        "cap0_ret_01_trajectory": ret01_all,
        "cap0_ret_02_trajectory": ret02_all,
        "stage3_started": False,
        "pickle_used": False,
        "stopped": True,
        "software": {"torch": torch.__version__, "torch_cuda": torch.version.cuda, "python": sys.version.split()[0]},
        "hardware": gpu_name,
    }
    # eval_full can be large; keep on disk separately
    write_json(ckpt_dir / "eval-full.json", evals)
    slim = dict(payload)
    slim.pop("eval_full", None)
    write_json(report_path, slim)
    write_json(ckpt_dir / "stage2-report.json", slim)
    print(
        json.dumps(
            {
                "ok": payload["ok"],
                "WRIM_STAGE2": verdict,
                "n_steps": completed_steps,
                "tokens": tokens_seen,
                "rehearsal_pct": audit.get("rehearsal_pct"),
                "rehearsal_deviation_pp": audit.get("rehearsal_deviation_pp"),
                "parent_unmodified": parent_unmodified,
                "reload_ok": hash_match and fresh_ok,
                "READY_FOR_STAGE3_TRAINING_AUTHORIZATION": ready_s3,
                "stopped": True,
                "sentinel_events": sentinel_events,
            },
            indent=2,
        ),
        flush=True,
    )
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
