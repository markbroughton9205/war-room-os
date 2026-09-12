"""Stage 0 WRIM-0 PyTorch equivalence. Inference only. No backward. No optimizer. No weight write."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import torch
from tokenizers import Tokenizer

from safetensors_model import load_model_state_from_safetensors
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
SMOKE_PROMPT = "The sky is"
SMOKE_ARGMAX = 126
SMOKE_ENTROPY = 6.033060550689697
CPU_ENTROPY_TOL = 1e-4
CUDA_ENTROPY_TOL = 0.02
SPECIALS = [
    (0, "<|pad|>"),
    (1, "<|bos|>"),
    (2, "<|eos|>"),
    (3, "<|unk|>"),
    (4, "<|system|>"),
    (5, "<|commander|>"),
    (6, "<|assistant|>"),
    (7, "<|tool|>"),
    (8, "<|evidence|>"),
]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def entropy_from_logits(logits: torch.Tensor) -> float:
    x = logits.float()
    x = x - x.max()
    p = torch.softmax(x, dim=-1)
    return float(-(p * torch.log(p.clamp_min(1e-12))).sum().item())


def greedy(model: WRIM0Model, ids: list[int], new_tokens: int, device: torch.device) -> tuple[list[int], int, float, bool]:
    prompt = torch.tensor([ids], dtype=torch.long, device=device)
    with torch.inference_mode():
        first = model(prompt)[0, -1]
        argmax = int(torch.argmax(first).item())
        ent = entropy_from_logits(first)
        finite = bool(torch.isfinite(first).all().item())
        generated = list(ids)
        cur = prompt
        for _ in range(new_tokens):
            logits = model(cur)[0, -1]
            nxt = int(torch.argmax(logits).item())
            generated.append(nxt)
            if nxt == 2:
                break
            cur = torch.tensor([generated], dtype=torch.long, device=device)
    return generated, argmax, ent, finite


def measure_precision(device: torch.device) -> dict:
    out = {
        "FP32": "UNVERIFIED",
        "TF32": "UNVERIFIED",
        "FP16": "UNVERIFIED",
        "BF16": "UNVERIFIED",
        "notes": [],
    }
    a = torch.randn(256, 256, device=device, dtype=torch.float32)
    b = torch.randn(256, 256, device=device, dtype=torch.float32)
    c = a @ b
    out["FP32"] = "SUPPORTED" if bool(torch.isfinite(c).all().item()) else "UNSUPPORTED"
    if device.type != "cuda":
        out["notes"].append("TF32/FP16/BF16 CUDA ops not applicable on CPU.")
        out["TF32"] = "UNSUPPORTED"
        out["FP16"] = "UNVERIFIED"
        out["BF16"] = "UNVERIFIED"
        return out
    tf32_flag = bool(torch.backends.cuda.matmul.allow_tf32)
    try:
        torch.backends.cuda.matmul.allow_tf32 = True
        t = (a @ b)
        out["TF32"] = "SUPPORTED" if bool(torch.isfinite(t).all().item()) else "UNSUPPORTED"
        out["notes"].append(f"TF32 matmul flag exists; default_was={tf32_flag}. Stage 0 forces TF32 OFF.")
    except Exception as e:  # noqa: BLE001
        out["TF32"] = "UNSUPPORTED"
        out["notes"].append(f"TF32 probe error: {e}")
    finally:
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
    try:
        h = (a.half() @ b.half())
        out["FP16"] = "SUPPORTED" if bool(torch.isfinite(h).all().item()) else "UNSUPPORTED"
    except Exception as e:  # noqa: BLE001
        out["FP16"] = "UNSUPPORTED"
        out["notes"].append(f"FP16 probe error: {e}")
    try:
        bf_ok = bool(torch.cuda.is_bf16_supported())
        if bf_ok:
            z = (a.bfloat16() @ b.bfloat16())
            out["BF16"] = "SUPPORTED" if bool(torch.isfinite(z).all().item()) else "UNSUPPORTED"
        else:
            out["BF16"] = "UNSUPPORTED"
            out["notes"].append("torch.cuda.is_bf16_supported() is False.")
    except Exception as e:  # noqa: BLE001
        out["BF16"] = "UNSUPPORTED"
        out["notes"].append(f"BF16 probe error: {e}")
    return out


def tokenizer_check(path: Path) -> dict:
    tok = Tokenizer.from_file(str(path))
    specials_ok = True
    specials = []
    for sid, name in SPECIALS:
        got = tok.token_to_id(name)
        specials.append({"id": sid, "token": name, "actual": got, "ok": got == sid})
        if got != sid:
            specials_ok = False
    enc = tok.encode(SMOKE_PROMPT, add_special_tokens=False)
    ids = [1, *enc.ids]
    return {
        "vocab": tok.get_vocab_size(),
        "vocab_ok": tok.get_vocab_size() == VOCAB_SIZE,
        "specials": specials,
        "specials_ok": specials_ok,
        "prompt_ids": ids,
        "prompt_without_bos": enc.ids,
        "edited": False,
    }


def disable_tf32() -> None:
    if torch.cuda.is_available():
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
    if hasattr(torch, "set_float32_matmul_precision"):
        torch.set_float32_matmul_precision("highest")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--ids", default="", help="optional comma-separated ids including BOS")
    ap.add_argument("--new-tokens", type=int, default=8)
    args = ap.parse_args()

    torch.set_grad_enabled(False)
    disable_tf32()

    weights = Path(args.weights)
    tokenizer_path = Path(args.tokenizer)
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    parent_mtime_before = weights.stat().st_mtime_ns
    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tokenizer_path)
    if parent_sha != PARENT_SHA or tok_sha != TOKENIZER_SHA:
        payload = {
            "ok": False,
            "WRIM_ENVIRONMENT": "FAILED",
            "WRIM_PYTORCH_PORT": "FAILED",
            "error": "HASH_MISMATCH",
            "parent_sha": parent_sha,
            "tokenizer_sha": tok_sha,
            "wrote_weights": False,
            "backward": False,
            "optimizer": False,
        }
        report_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(json.dumps(payload))
        return 2

    tok_info = tokenizer_check(tokenizer_path)
    ids = [int(x) for x in args.ids.split(",") if x.strip()] if args.ids.strip() else tok_info["prompt_ids"]

    t0 = time.perf_counter()
    state, coverage = load_model_state_from_safetensors(weights)
    checkpoint_load_s = time.perf_counter() - t0

    expected = expected_torch_keys()
    coverage["expected_keys"] = len(expected)
    mapping_ok = (
        coverage["mapped"] == 164
        and not coverage["missing"]
        and coverage["skipped_opt"] > 0
        and not coverage["lm_head_present"]
        and len(state) == 164
    )

    t1 = time.perf_counter()
    model = WRIM0Model()
    model.load_state_dict(state, strict=True)
    model.freeze_inference()
    model_load_s = time.perf_counter() - t1

    cpu = torch.device("cpu")
    model = model.to(cpu)
    t_cpu = time.perf_counter()
    cpu_gen, cpu_argmax, cpu_entropy, cpu_finite = greedy(model, ids, args.new_tokens, cpu)
    cpu_s = time.perf_counter() - t_cpu
    cpu_new = cpu_gen[len(ids) :]
    cpu_pass = (
        cpu_argmax == SMOKE_ARGMAX
        and abs(cpu_entropy - SMOKE_ENTROPY) <= CPU_ENTROPY_TOL
        and cpu_finite
        and (len(cpu_new) == 0 or cpu_new[0] == SMOKE_ARGMAX)
    )

    cuda_info = {
        "available": bool(torch.cuda.is_available()),
        "name": None,
        "capability": None,
        "total_vram_bytes": None,
        "arch_list": None,
        "skipped_reason": None,
    }
    cuda_result = None
    vram = None
    batch_probe = []
    precision = measure_precision(cpu)

    if not cpu_pass:
        cuda_info["skipped_reason"] = "CPU equivalence failed; CUDA Stage 0 not attempted."
    elif not torch.cuda.is_available():
        cuda_info["skipped_reason"] = "torch.cuda.is_available() is False. CPU fallback is not CUDA PASS."
    else:
        disable_tf32()
        cuda_info["name"] = torch.cuda.get_device_name(0)
        cuda_info["capability"] = list(torch.cuda.get_device_capability(0))
        cuda_info["total_vram_bytes"] = int(torch.cuda.get_device_properties(0).total_memory)
        try:
            cuda_info["arch_list"] = torch.cuda.get_arch_list()
        except Exception:  # noqa: BLE001
            cuda_info["arch_list"] = None
        if "5060 Ti" not in str(cuda_info["name"]):
            cuda_info["skipped_reason"] = f"GPU is {cuda_info['name']}, not RTX 5060 Ti."
        else:
            device = torch.device("cuda")
            precision = measure_precision(device)
            disable_tf32()
            torch.cuda.reset_peak_memory_stats()
            model = model.to(device)
            t_cu = time.perf_counter()
            cu_gen, cu_argmax, cu_entropy, cu_finite = greedy(model, ids, args.new_tokens, device)
            torch.cuda.synchronize()
            cu_s = time.perf_counter() - t_cu
            cu_new = cu_gen[len(ids) :]
            cuda_pass = (
                cu_argmax == SMOKE_ARGMAX
                and abs(cu_entropy - SMOKE_ENTROPY) <= CUDA_ENTROPY_TOL
                and cu_finite
                and (len(cu_new) == 0 or cu_new[0] == SMOKE_ARGMAX)
            )
            allocated = int(torch.cuda.memory_allocated())
            reserved = int(torch.cuda.memory_reserved())
            peak = int(torch.cuda.max_memory_allocated())
            vram = {
                "allocated_bytes": allocated,
                "reserved_bytes": reserved,
                "peak_bytes": peak,
                "total_bytes": cuda_info["total_vram_bytes"],
            }
            tokens_per_s = (len(cu_new) / cu_s) if cu_s > 0 else None
            cuda_result = {
                "argmax_id": cu_argmax,
                "entropy": cu_entropy,
                "finite": cu_finite,
                "generated_ids": cu_gen,
                "new_ids": cu_new,
                "pass": cuda_pass,
                "seconds": cu_s,
                "tokens_per_sec": tokens_per_s,
                "tf32_enabled": bool(torch.backends.cuda.matmul.allow_tf32),
                "dtype": "float32",
            }
            for bsz in (1, 2, 4, 8, 16):
                torch.cuda.empty_cache()
                torch.cuda.reset_peak_memory_stats()
                x = torch.randint(0, VOCAB_SIZE, (bsz, CONTEXT_LENGTH), device=device)
                try:
                    t_b = time.perf_counter()
                    with torch.inference_mode():
                        logits = model(x)
                    torch.cuda.synchronize()
                    elapsed = time.perf_counter() - t_b
                    batch_probe.append(
                        {
                            "micro_batch": bsz,
                            "sequence": CONTEXT_LENGTH,
                            "FORWARD_ONLY": True,
                            "ok": True,
                            "seconds": elapsed,
                            "peak_vram_bytes": int(torch.cuda.max_memory_allocated()),
                            "allocated_bytes": int(torch.cuda.memory_allocated()),
                            "logits_shape": list(logits.shape),
                            "backward": False,
                            "not_training_capacity": True,
                        }
                    )
                    del logits, x
                except RuntimeError as e:
                    batch_probe.append(
                        {
                            "micro_batch": bsz,
                            "sequence": CONTEXT_LENGTH,
                            "FORWARD_ONLY": True,
                            "ok": False,
                            "error": str(e).split("\n")[0],
                            "backward": False,
                            "not_training_capacity": True,
                        }
                    )
                    break

    parent_mtime_after = weights.stat().st_mtime_ns
    cpu_tokens_per_s = (len(cpu_new) / cpu_s) if cpu_s > 0 else None
    env_status = "READY" if cpu_pass and cuda_result and cuda_result.get("pass") else "FAILED"
    port_status = "STAGE0_VERIFIED" if env_status == "READY" else "FAILED"

    payload = {
        "ok": env_status == "READY",
        "WRIM_ENVIRONMENT": env_status,
        "WRIM_PYTORCH_PORT": port_status,
        "WRIM_TRAINING": "NOT_RUNNING",
        "TRAINING_AUTHORIZATION": "OFF",
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "QWEN": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "RAEL": "NOT_IMPLEMENTED",
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
            "rmsnorm_eps": 1e-5,
            "swiglu": "silu(gate)*up then down",
            "dropout": 0,
            "bias": False,
        },
        "parent_sha": parent_sha,
        "tokenizer_sha": tok_sha,
        "parent_unmodified": parent_mtime_before == parent_mtime_after,
        "tokenizer": tok_info,
        "mapping": coverage,
        "mapping_ok": mapping_ok,
        "cpu": {
            "argmax_id": cpu_argmax,
            "entropy": cpu_entropy,
            "finite": cpu_finite,
            "generated_ids": cpu_gen,
            "new_ids": cpu_new,
            "pass": cpu_pass,
            "seconds": cpu_s,
            "tokens_per_sec": cpu_tokens_per_s,
        },
        "cuda": cuda_info,
        "cuda_stage0": cuda_result,
        "precision": precision,
        "timings": {
            "checkpoint_load_s": checkpoint_load_s,
            "model_construct_load_s": model_load_s,
            "cpu_inference_s": cpu_s,
            "cuda_inference_s": None if not cuda_result else cuda_result["seconds"],
        },
        "vram": vram,
        "forward_only_batch_probe": batch_probe,
        "backward": False,
        "optimizer": False,
        "new_training_checkpoint": False,
        "wrote_weights": False,
        "pickle_used": False,
        "cuda_toolkit_installed": False,
        "software": {
            "torch": torch.__version__,
            "torch_cuda": torch.version.cuda,
            "python": sys.version.split()[0],
        },
    }
    report_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps({k: payload[k] for k in ("ok", "WRIM_ENVIRONMENT", "WRIM_PYTORCH_PORT", "cpu", "cuda_stage0")}, indent=2))
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
