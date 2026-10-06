"""WRIM1-PILOT-AB-10M from-scratch A/B trainer.

Requires:
  --authorize-wrim1-pilot-ab-10m
  env WRIM_TRAINING_AUTHORIZATION=ON_FOR_WRIM1_PILOT_AB_10M_ONLY

Does not load Genesis weights. Does not promote. Does not spend Genesis tokens.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import resource
import subprocess
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from tokenizers import Tokenizer

from wrim_pilot_ab_data import (
    encode_doc,
    frozen_probes,
    greedy_select,
    load_catalog,
    load_texts,
    pack_windows,
    sha256_file,
    sha256_text,
    special_ids,
    train_tokenizer_candidates,
)
from wrim_pilot_ab_identity import (
    ARCH_A,
    ARCH_B,
    AUTHORIZE_ENV_NAME,
    AUTHORIZE_ENV_VALUE,
    AUTHORIZE_FLAG,
    BETAS,
    CANONICAL,
    CANONICAL_HASH,
    CKPT_ROOT,
    CORPUS_DIR,
    FROZEN_CORPUS_HASH,
    FROZEN_TOKENIZER_HASH,
    FROZEN_TRAIN_WINDOWS_SHA256,
    FROZEN_VAL_WINDOWS_SHA256,
    EPS,
    EVAL_SEED,
    FULL_EVAL_FRACS,
    GRAD_CLIP,
    GRAD_HARD,
    LR_A,
    LR_B,
    MICRO_BATCH,
    MICRO_EVAL_EVERY,
    MIN_LR_FRAC,
    PHYSICAL_TOKENS,
    PREFLIGHT_STEPS,
    PROBE_DIR,
    PROGRAM_ID,
    REPORT_PATH,
    SEED,
    SEQ_LEN,
    STEPS,
    TOKENIZER_DIR,
    TOKENS_PER_STEP,
    UNIQUE_TARGET,
    WARMUP_FRAC,
    WEIGHT_DECAY,
)
from wrim_pilot_ab_model import WRIM1PilotModel, spec_param_count
from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def authorization_ok(argv: list[str] | None = None) -> bool:
    import sys

    args = argv if argv is not None else sys.argv[1:]
    return AUTHORIZE_FLAG in args and os.environ.get(AUTHORIZE_ENV_NAME) == AUTHORIZE_ENV_VALUE


def gpu_snapshot() -> dict[str, Any]:
    snap: dict[str, Any] = {}
    try:
        smi = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu",
                "--format=csv,noheader,nounits",
            ],
            text=True,
        ).strip()
        parts = [p.strip() for p in smi.split(",")]
        snap["gpu"] = {
            "name": parts[0],
            "memory_total_mib": float(parts[1]),
            "memory_used_mib": float(parts[2]),
            "memory_free_mib": float(parts[3]),
            "util_pct": float(parts[4]) if len(parts) > 4 else None,
        }
    except Exception as exc:  # noqa: BLE001
        snap["gpu"] = {"error": str(exc)}
    try:
        procs = subprocess.check_output(
            ["nvidia-smi", "--query-compute-apps=pid,process_name,used_gpu_memory", "--format=csv,noheader"],
            text=True,
        ).strip()
        rows = []
        for line in procs.splitlines():
            if not line.strip():
                continue
            pid, name, mem = [p.strip() for p in line.split(",", 2)]
            rows.append({"pid": int(pid), "name": name, "used_gpu_memory": mem})
        snap["compute_apps"] = rows
    except Exception as exc:  # noqa: BLE001
        snap["compute_apps"] = [{"error": str(exc)}]
    return snap


def gpu_exclusive_enough(snap: dict[str, Any]) -> tuple[bool, str]:
    used = float((snap.get("gpu") or {}).get("memory_used_mib") or 99999)
    free = float((snap.get("gpu") or {}).get("memory_free_mib") or 0)
    llama = []
    trainer_like = []
    for row in snap.get("compute_apps") or []:
        name = str(row.get("name") or "").lower()
        if "llama-server" in name or "llama_server" in name or "/ollama/" in name:
            llama.append(row)
        if any(k in name for k in ("python", "pt_main", "wrim")) and "cursor" not in name:
            trainer_like.append(row)
    if llama:
        return False, "llama_server_present"
    if trainer_like:
        return False, "other_compute_python_or_wrim"
    if free < 8000:
        return False, f"free_mib={free}"
    if used > 6000:
        return False, f"used_mib={used}"
    return True, "desktop_cursor_only"


def verify_frozen_bundle(built: dict[str, Any]) -> tuple[bool, str]:
    man = built.get("manifest") or {}
    study = built.get("tok_study") or {}
    corpus_hash = man.get("corpus_hash")
    tok_hash = study.get("tokenizer_sha256")
    tw_hash = man.get("train_windows_sha256")
    vw_hash = man.get("val_windows_sha256")
    if corpus_hash != FROZEN_CORPUS_HASH:
        return False, f"corpus_hash_mismatch {corpus_hash}"
    if tok_hash != FROZEN_TOKENIZER_HASH:
        return False, f"tokenizer_hash_mismatch {tok_hash}"
    if tw_hash != FROZEN_TRAIN_WINDOWS_SHA256:
        return False, f"train_windows_hash_mismatch {tw_hash}"
    if vw_hash != FROZEN_VAL_WINDOWS_SHA256:
        return False, f"val_windows_hash_mismatch {vw_hash}"
    return True, "frozen_ok"


def ram_peak_mib() -> float:
    # Linux ru_maxrss is kilobytes.
    return float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss) / 1024.0


def sample_hw() -> dict[str, Any]:
    snap = gpu_snapshot()
    cpu = None
    try:
        load = os.getloadavg()[0]
        ncpu = os.cpu_count() or 1
        cpu = 100.0 * min(1.0, load / ncpu)
    except Exception:
        cpu = None
    return {
        "gpu": snap.get("gpu"),
        "cpu_load_pct_proxy": cpu,
        "ram_peak_mib": ram_peak_mib(),
    }


def cosine_lr(step: int, peak: float, steps: int, warmup: int) -> float:
    if step <= 0:
        return peak / max(warmup, 1)
    if step < warmup:
        return peak * (step / warmup)
    t = (step - warmup) / max(1, steps - warmup)
    min_lr = peak * MIN_LR_FRAC
    return min_lr + (peak - min_lr) * 0.5 * (1.0 + math.cos(math.pi * t))


def load_existing_bundle() -> dict[str, Any] | None:
    man_path = CORPUS_DIR / "WRIM1-PILOT-CORPUS-v1-MANIFEST.json"
    tok_path = TOKENIZER_DIR / "tokenizer.json"
    tw = CORPUS_DIR / "train-windows.npy"
    vw = CORPUS_DIR / "val-windows.npy"
    probes_path = PROBE_DIR / "probes.json"
    study_path = TOKENIZER_DIR / "VOCAB_STUDY.json"
    if not all(p.is_file() for p in (man_path, tok_path, tw, vw, probes_path, study_path)):
        return None
    tok = Tokenizer.from_file(str(tok_path))
    return {
        "manifest": json.loads(man_path.read_text(encoding="utf-8")),
        "tok_study": json.loads(study_path.read_text(encoding="utf-8")),
        "ids": special_ids(tok),
        "train_windows": np.load(tw),
        "val_windows": np.load(vw),
        "probes": json.loads(probes_path.read_text(encoding="utf-8")),
        "tokenizer_path": str(tok_path),
    }


def build_corpus_and_tokenizer() -> dict[str, Any]:
    catalog = load_catalog()
    train_sel, val_sel, plan_stats = greedy_select(catalog, seed=SEED)
    train_docs = load_texts(train_sel)
    val_docs = load_texts(val_sel)
    tok_study = train_tokenizer_candidates(train_docs)
    tok = Tokenizer.from_file(tok_study["tokenizer_path"])
    ids = special_ids(tok)
    unique_train = 0
    unique_val = 0
    unique_domain: dict[str, int] = {}
    for rec in train_docs:
        n = len(encode_doc(tok, rec, ids))
        unique_train += n
        unique_domain[rec["domain"]] = unique_domain.get(rec["domain"], 0) + n
    for rec in val_docs:
        unique_val += len(encode_doc(tok, rec, ids))
    n_windows = STEPS * MICRO_BATCH
    train_windows, train_domains, unique_packed, mix_counts = pack_windows(
        train_docs, tok, ids, seq=SEQ_LEN, n_windows=n_windows, seed=SEED
    )
    val_n = min(512, max(64, len(val_docs) * 2))
    val_windows, val_domains, _, _ = pack_windows(
        val_docs if val_docs else train_docs[:80], tok, ids, seq=SEQ_LEN, n_windows=val_n, seed=SEED + 1
    )
    CORPUS_DIR.mkdir(parents=True, exist_ok=True)
    tw = CORPUS_DIR / "train-windows.npy"
    vw = CORPUS_DIR / "val-windows.npy"
    np.save(tw, train_windows)
    np.save(vw, val_windows)
    (CORPUS_DIR / "train-domains.json").write_text(json.dumps(train_domains), encoding="utf-8")
    probes = frozen_probes()
    PROBE_DIR.mkdir(parents=True, exist_ok=True)
    (PROBE_DIR / "probes.json").write_text(json.dumps(probes, indent=2), encoding="utf-8")
    manifest = {
        "kind": "WRIM1-PILOT-CORPUS-v1",
        "created_at": utc_now(),
        "seed": SEED,
        "unique_target": UNIQUE_TARGET,
        "unique_train_tokens_new_tokenizer": unique_train,
        "unique_val_tokens_new_tokenizer": unique_val,
        "unique_train_by_domain": unique_domain,
        "plan_old_tokenizer_stats": plan_stats,
        "packed_windows": int(train_windows.shape[0]),
        "packed_mix_window_counts": mix_counts,
        "physical_tokens_budget": PHYSICAL_TOKENS,
        "steps": STEPS,
        "train_docs": len(train_docs),
        "val_docs": len(val_docs),
        "train_windows_sha256": sha256_file(tw),
        "val_windows_sha256": sha256_file(vw),
        "tokenizer_sha256": tok_study["tokenizer_sha256"],
        "probes_sha256": probes["sha256"],
        "canonical_untouched": CANONICAL,
        "canonical_hash": CANONICAL_HASH,
    }
    man_path = CORPUS_DIR / "WRIM1-PILOT-CORPUS-v1-MANIFEST.json"
    man_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    manifest["corpus_hash"] = sha256_file(man_path)
    man_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    tok_study_path = TOKENIZER_DIR / "VOCAB_STUDY.json"
    tok_study_path.write_text(json.dumps(tok_study, indent=2) + "\n", encoding="utf-8")
    return {
        "manifest": manifest,
        "tok_study": tok_study,
        "ids": ids,
        "train_windows": train_windows,
        "val_windows": val_windows,
        "probes": probes,
        "tokenizer_path": tok_study["tokenizer_path"],
    }


def tokenize_probe(tok, ids: dict[str, int], item: dict[str, Any], *, role: bool) -> dict[str, Any]:
    prompt = item["prompt"]
    target = item["target"]
    if role:
        prefix = [ids["bos"], ids["commander"]] + tok.encode("\n" + prompt, add_special_tokens=False).ids + [ids["assistant"]]
        # assistant newline before target, matching train instruction packing
        prefix += tok.encode("\n", add_special_tokens=False).ids
    else:
        prefix = [ids["bos"]] + tok.encode(prompt, add_special_tokens=False).ids
    gold = tok.encode(target, add_special_tokens=False).ids
    if not gold:
        gold = tok.encode(" " + target, add_special_tokens=False).ids
    return {"prefix": prefix, "gold": gold or [ids["unk"]], "id": item["id"]}


def cache_probes(tok, ids: dict[str, int], probes: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    out["instruction"] = [tokenize_probe(tok, ids, x, role=True) for x in probes["instruction"]]
    for key in ("natural", "json", "code", "reasoning", "language"):
        out[key] = [tokenize_probe(tok, ids, x, role=False) for x in probes[key]]
    return out


@torch.no_grad()
def first_token_stats(
    model: WRIM1PilotModel,
    items: list[dict[str, Any]],
    device: torch.device,
    pad: int,
    *,
    prefix_depth: bool,
) -> dict[str, float]:
    ranks = []
    logps = []
    depths = []
    for item in items:
        prefix = item["prefix"]
        gold = item["gold"]
        x = torch.tensor([prefix[-SEQ_LEN:]], device=device, dtype=torch.long)
        with autocast_ctx():
            logits = model(x)[0, -1].float()
        logprob = torch.log_softmax(logits, dim=-1)
        target = int(gold[0])
        if target < 0 or target >= logits.numel():
            ranks.append(int(logits.numel()))
            logps.append(-100.0)
            depths.append(0.0)
            continue
        order = torch.argsort(logits, descending=True)
        rank = int((order == target).nonzero(as_tuple=False)[0, 0].item()) + 1
        ranks.append(rank)
        logps.append(float(logprob[target].item()))
        if not prefix_depth:
            depths.append(0.0)
            continue
        cur = list(prefix)
        depth = 0
        for g in gold[:8]:
            t = torch.tensor([cur[-SEQ_LEN:]], device=device, dtype=torch.long)
            with autocast_ctx():
                nxt = int(model(t)[0, -1].argmax().item())
            if nxt == int(g):
                depth += 1
                cur.append(nxt)
            else:
                break
        depths.append(depth / max(1, min(8, len(gold))))
    return {
        "mean_rank": float(np.mean(ranks)) if ranks else -1,
        "median_rank": float(np.median(ranks)) if ranks else -1,
        "mean_logp": float(np.mean(logps)) if logps else 0.0,
        "mean_prefix_depth": float(np.mean(depths)) if depths else 0.0,
        "n": len(items),
    }


@torch.no_grad()
def val_ce(model: WRIM1PilotModel, windows: np.ndarray, device: torch.device, n: int, pad: int) -> float:
    model.eval()
    total = 0.0
    toks = 0
    use = windows[:n]
    for i in range(0, len(use), MICRO_BATCH):
        batch = torch.tensor(use[i : i + MICRO_BATCH], device=device, dtype=torch.long)
        with autocast_ctx():
            logits = model(batch)
        loss = F.cross_entropy(
            logits[:, :-1].reshape(-1, logits.size(-1)).float(),
            batch[:, 1:].reshape(-1),
            ignore_index=pad,
            reduction="sum",
        )
        valid = (batch[:, 1:] != pad).sum()
        total += float(loss.item())
        toks += int(valid.item())
    model.train()
    return total / max(toks, 1)


@torch.no_grad()
def hidden_separability(model: WRIM1PilotModel, instr, prose, device: torch.device) -> dict[str, float]:
    def last_h(items: list[dict[str, Any]]) -> torch.Tensor:
        hs = []
        for item in items:
            x = torch.tensor([item["prefix"][-SEQ_LEN:]], device=device, dtype=torch.long)
            with autocast_ctx():
                _, h = model(x, return_hidden=True)
            hs.append(h[0, -1].float())
        return torch.stack(hs, dim=0)

    hi = last_h(instr)
    hp = last_h(prose)
    hi = F.normalize(hi, dim=-1)
    hp = F.normalize(hp, dim=-1)
    within = (hi @ hi.T).mean().item()
    between = (hi @ hp.T).mean().item()
    return {"within_instruction_cosine": within, "instruction_vs_prose_cosine": between, "delta": within - between}


def nvidia_proc_vram() -> float | None:
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-compute-apps=pid,used_gpu_memory", "--format=csv,noheader,nounits"],
            text=True,
        )
        me = os.getpid()
        for line in out.splitlines():
            pid, mem = [p.strip() for p in line.split(",")]
            if int(pid) == me:
                return float(mem)
    except Exception:
        return None
    return None


def make_model(arch: dict[str, Any], vocab: int, device: torch.device, dtype: torch.dtype) -> WRIM1PilotModel:
    m = WRIM1PilotModel(
        vocab_size=vocab,
        d_model=arch["d_model"],
        n_layers=arch["n_layers"],
        n_heads=arch["n_heads"],
        head_dim=arch["head_dim"],
        d_ff=arch["d_ff"],
        untied=True,
        use_sdpa=True,
    )
    return m.to(device)


USE_BF16_AUTOCAST = True


def autocast_ctx():
    enabled = bool(USE_BF16_AUTOCAST and torch.cuda.is_available() and torch.cuda.is_bf16_supported())
    return torch.autocast(device_type="cuda", dtype=torch.bfloat16, enabled=enabled)


def preflight_lr(
    arch: dict[str, Any],
    vocab: int,
    windows: np.ndarray,
    device: torch.device,
    dtype: torch.dtype,
    pad: int,
    candidates: tuple[float, ...],
) -> dict[str, Any]:
    rows = []
    for lr in candidates:
        torch.manual_seed(SEED)
        model = make_model(arch, vocab, device, dtype)
        opt = torch.optim.AdamW(model.parameters(), lr=lr, betas=BETAS, eps=EPS, weight_decay=WEIGHT_DECAY)
        last_loss = None
        max_grad = 0.0
        unsafe = False
        for step in range(PREFLIGHT_STEPS):
            batch = torch.tensor(windows[step * MICRO_BATCH : (step + 1) * MICRO_BATCH], device=device, dtype=torch.long)
            opt.zero_grad(set_to_none=True)
            with autocast_ctx():
                logits = model(batch)
            loss = F.cross_entropy(
                logits[:, :-1].reshape(-1, logits.size(-1)).float(),
                batch[:, 1:].reshape(-1),
                ignore_index=pad,
            )
            if not torch.isfinite(loss):
                unsafe = True
                last_loss = float("nan")
                break
            loss.backward()
            gn = torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP)
            max_grad = max(max_grad, float(gn))
            if float(gn) >= GRAD_HARD:
                unsafe = True
            opt.step()
            last_loss = float(loss.item())
        slope = None
        rows.append({"lr": lr, "final_loss": last_loss, "max_grad": max_grad, "unsafe": unsafe})
        del model, opt
        if device.type == "cuda":
            torch.cuda.empty_cache()
    safe = [r for r in rows if not r["unsafe"] and r["final_loss"] is not None and r["final_loss"] == r["final_loss"]]
    if safe:
        chosen = min(safe, key=lambda r: r["final_loss"])
    else:
        chosen = min(rows, key=lambda r: r["lr"])
    return {"rows": rows, "chosen_lr": chosen["lr"]}


def evaluate(
    model: WRIM1PilotModel,
    val_windows: np.ndarray,
    cached: dict[str, list[dict[str, Any]]],
    device: torch.device,
    pad: int,
    *,
    full: bool,
) -> dict[str, Any]:
    t0 = time.perf_counter()
    n = 256 if full else 64
    ce = val_ce(model, val_windows, device, n, pad)
    inst = first_token_stats(model, cached["instruction"], device, pad, prefix_depth=full)
    natural = first_token_stats(model, cached["natural"], device, pad, prefix_depth=full)
    js = first_token_stats(model, cached["json"], device, pad, prefix_depth=full)
    code = first_token_stats(model, cached["code"], device, pad, prefix_depth=full)
    reason = first_token_stats(model, cached["reasoning"], device, pad, prefix_depth=full)
    lang = first_token_stats(model, cached["language"], device, pad, prefix_depth=full)
    sep = None
    if full:
        sep = hidden_separability(model, cached["instruction"], cached["language"], device)
    return {
        "val_ce": ce,
        "instruction": inst,
        "natural": natural,
        "json": js,
        "code": code,
        "reasoning": reason,
        "language": lang,
        "separability": sep,
        "eval_s": time.perf_counter() - t0,
        "full": full,
    }


def save_ckpt(path: Path, model: WRIM1PilotModel, step: int, meta: dict[str, Any]) -> None:
    path.mkdir(parents=True, exist_ok=True)
    torch.save({"step": step, "state_dict": {k: v.detach().cpu() for k, v in model.state_dict().items()}, "meta": meta}, path / "model.pt")


def train_candidate(
    *,
    arch: dict[str, Any],
    run_id: str,
    vocab: int,
    peak_lr: float,
    train_windows: np.ndarray,
    val_windows: np.ndarray,
    cached: dict[str, list[dict[str, Any]]],
    device: torch.device,
    dtype: torch.dtype,
    pad: int,
    ids: dict[str, int],
) -> dict[str, Any]:
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    random.seed(SEED)
    model = make_model(arch, vocab, device, dtype)
    opt = torch.optim.AdamW(model.parameters(), lr=peak_lr, betas=BETAS, eps=EPS, weight_decay=WEIGHT_DECAY)
    warmup = max(1, int(STEPS * WARMUP_FRAC))
    n_windows = STEPS * MICRO_BATCH
    full_steps = sorted({int(round(f * STEPS)) for f in FULL_EVAL_FRACS})
    full_steps = [s for s in full_steps if 0 <= s <= STEPS]
    metrics: list[dict[str, Any]] = []
    micro: list[dict[str, Any]] = []
    train_s = 0.0
    eval_s = 0.0
    ckpt_s = 0.0
    tokens_used = 0
    last_train = None
    best_val = 1e9
    best_step = 0
    peak_alloc = 0.0
    gpu_util_samples: list[float] = []
    ram_peak = ram_peak_mib()
    hw_start = sample_hw()
    t_run = time.perf_counter()
    # step 0 eval
    ev = evaluate(model, val_windows, cached, device, pad, full=True)
    eval_s += ev["eval_s"]
    metrics.append({"step": 0, **ev})
    save_ckpt(CKPT_ROOT / run_id / "step-0", model, 0, {"lr": peak_lr})
    if device.type == "cuda":
        peak_alloc = max(peak_alloc, torch.cuda.max_memory_allocated() / (1024 * 1024))
    for step in range(1, STEPS + 1):
        lr = cosine_lr(step, peak_lr, STEPS, warmup)
        for g in opt.param_groups:
            g["lr"] = lr
        start = ((step - 1) * MICRO_BATCH) % n_windows
        batch_np = train_windows[start : start + MICRO_BATCH]
        if len(batch_np) < MICRO_BATCH:
            batch_np = np.concatenate([batch_np, train_windows[: MICRO_BATCH - len(batch_np)]], axis=0)
        batch = torch.tensor(batch_np, device=device, dtype=torch.long)
        t0 = time.perf_counter()
        opt.zero_grad(set_to_none=True)
        with autocast_ctx():
            logits = model(batch)
        loss = F.cross_entropy(
            logits[:, :-1].reshape(-1, logits.size(-1)).float(),
            batch[:, 1:].reshape(-1),
            ignore_index=pad,
        )
        loss.backward()
        gn = torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP)
        opt.step()
        if device.type == "cuda":
            torch.cuda.synchronize()
        train_s += time.perf_counter() - t0
        tokens_used += TOKENS_PER_STEP
        last_train = float(loss.item())
        if device.type == "cuda":
            peak_alloc = max(peak_alloc, torch.cuda.max_memory_allocated() / (1024 * 1024))
        if tokens_used > PHYSICAL_TOKENS:
            break
        if step % MICRO_EVAL_EVERY == 0:
            ev = evaluate(model, val_windows, cached, device, pad, full=False)
            eval_s += ev["eval_s"]
            micro.append({"step": step, "train_loss": last_train, "grad": float(gn), "lr": lr, **ev})
        if step in full_steps and step != 0:
            ev = evaluate(model, val_windows, cached, device, pad, full=True)
            eval_s += ev["eval_s"]
            metrics.append({"step": step, "train_loss": last_train, "grad": float(gn), "lr": lr, **ev})
            t1 = time.perf_counter()
            save_ckpt(CKPT_ROOT / run_id / f"step-{step}", model, step, {"lr": lr, "val_ce": ev["val_ce"]})
            ckpt_s += time.perf_counter() - t1
            if ev["val_ce"] < best_val:
                best_val = ev["val_ce"]
                best_step = step
                save_ckpt(CKPT_ROOT / run_id / "best-val", model, step, {"lr": lr, "val_ce": ev["val_ce"]})
        if step % 200 == 0:
            hw = sample_hw()
            ram_peak = max(ram_peak, float(hw.get("ram_peak_mib") or 0))
            util = ((hw.get("gpu") or {}).get("util_pct"))
            if util is not None:
                gpu_util_samples.append(float(util))
            print(json.dumps({"run": run_id, "step": step, "loss": last_train, "tokens": tokens_used, "gpu_util": util}), flush=True)
    wall = time.perf_counter() - t_run
    final = metrics[-1] if metrics else {}
    return {
        "run_id": run_id,
        "architecture": arch,
        "parameters": model.count_params(),
        "tokens_used": tokens_used,
        "steps": step,
        "lr": peak_lr,
        "warmup_steps": warmup,
        "final_train_loss": last_train,
        "final_val_loss": final.get("val_ce"),
        "generalization_gap": None if last_train is None or final.get("val_ce") is None else float(final["val_ce"]) - float(last_train),
        "final_eval": final,
        "metrics": metrics,
        "micro": micro,
        "best_val": best_val if best_val < 1e8 else None,
        "best_step": best_step,
        "train_s": train_s,
        "eval_s": eval_s,
        "ckpt_s": ckpt_s,
        "wall_s": wall,
        "train_tokens_sec": tokens_used / max(train_s, 1e-6),
        "wall_tokens_sec": tokens_used / max(wall, 1e-6),
        "torch_peak_mib": peak_alloc,
        "nvidia_smi_proc_mib": nvidia_proc_vram(),
        "gpu_util_mean": (sum(gpu_util_samples) / len(gpu_util_samples)) if gpu_util_samples else None,
        "gpu_util_peak": max(gpu_util_samples) if gpu_util_samples else None,
        "cpu_load_pct_proxy_start": hw_start.get("cpu_load_pct_proxy"),
        "cpu_load_pct_proxy_end": sample_hw().get("cpu_load_pct_proxy"),
        "ram_peak_mib": ram_peak,
        "hw_start": hw_start,
        "dtype": str(dtype).replace("torch.", ""),
        "device": str(device),
    }


def summarize_signal(ev: dict[str, Any], key: str) -> str:
    block = ev.get(key) or {}
    if not block:
        return "MISSING"
    return (
        f"mean_rank={block.get('mean_rank'):.1f} "
        f"mean_logp={block.get('mean_logp'):.3f} "
        f"prefix_depth={block.get('mean_prefix_depth'):.3f}"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(AUTHORIZE_FLAG, action="store_true")
    args = parser.parse_args()
    if not authorization_ok():
        print(json.dumps({"ok": False, "reason": "authorization_denied"}))
        return 2
    snap0 = gpu_snapshot()
    ok_gpu, why = gpu_exclusive_enough(snap0)
    if not ok_gpu:
        payload = {
            "ok": False,
            "PROGRAM_STATUS": "GPU_EXCLUSIVITY_REQUIRED",
            "reason": why,
            "snapshot": snap0,
            "action": "Do not kill Commander desktop/Cursor processes silently. Free the competing compute job, then re-authorize.",
        }
        REPORT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(payload, indent=2))
        return 3
    lock = acquire_trainer_lock(
        run_id=PROGRAM_ID,
        authorization_id=PROGRAM_ID,
        checkpoint_parent="FROM_SCRATCH",
        token_budget=PHYSICAL_TOKENS * 2,
    )
    if not lock.get("ok"):
        print(json.dumps(lock, indent=2))
        return 4
    try:
        t_prep = time.perf_counter()
        built = load_existing_bundle()
        if built is None:
            fail = {
                "ok": False,
                "PROGRAM_STATUS": "FROZEN_ARTIFACTS_MISSING",
                "action": "Do not rebuild. Restore WRIM1-PILOT-CORPUS-v1 and WRIM1-PILOT-TOKENIZER-v1.",
            }
            REPORT_PATH.write_text(json.dumps(fail, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(fail, indent=2))
            return 5
        ok_frz, why_frz = verify_frozen_bundle(built)
        if not ok_frz:
            fail = {
                "ok": False,
                "PROGRAM_STATUS": "FROZEN_HASH_MISMATCH",
                "reason": why_frz,
            }
            REPORT_PATH.write_text(json.dumps(fail, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(fail, indent=2))
            return 6
        prep_s = time.perf_counter() - t_prep
        tok = Tokenizer.from_file(built["tokenizer_path"])
        ids = built["ids"]
        vocab = tok.get_vocab_size()
        cached = cache_probes(tok, ids, built["probes"])
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        global USE_BF16_AUTOCAST
        bf16_ok = bool(device.type == "cuda" and torch.cuda.is_bf16_supported())
        USE_BF16_AUTOCAST = bf16_ok
        dtype = torch.bfloat16 if bf16_ok else torch.float32
        torch.manual_seed(SEED)
        probe_m = make_model(ARCH_A, vocab, device, dtype)
        x = torch.tensor(built["train_windows"][:MICRO_BATCH], device=device, dtype=torch.long)
        with autocast_ctx():
            logits = probe_m(x)
        loss = F.cross_entropy(logits[:, :-1].reshape(-1, vocab).float(), x[:, 1:].reshape(-1), ignore_index=ids["pad"])
        if not torch.isfinite(loss):
            USE_BF16_AUTOCAST = False
            dtype = torch.float32
            bf16_ok = False
        del probe_m, x, loss
        if device.type == "cuda":
            torch.cuda.empty_cache()
        pf_a = preflight_lr(ARCH_A, vocab, built["train_windows"], device, dtype, ids["pad"], LR_A)
        pf_b = preflight_lr(ARCH_B, vocab, built["train_windows"], device, dtype, ids["pad"], LR_B)
        result_a = train_candidate(
            arch=ARCH_A,
            run_id="WRIM1-A-23M-PILOT",
            vocab=vocab,
            peak_lr=float(pf_a["chosen_lr"]),
            train_windows=built["train_windows"],
            val_windows=built["val_windows"],
            cached=cached,
            device=device,
            dtype=dtype,
            pad=ids["pad"],
            ids=ids,
        )
        if device.type == "cuda":
            torch.cuda.empty_cache()
        result_b = train_candidate(
            arch=ARCH_B,
            run_id="WRIM1-B-50M-PILOT",
            vocab=vocab,
            peak_lr=float(pf_b["chosen_lr"]),
            train_windows=built["train_windows"],
            val_windows=built["val_windows"],
            cached=cached,
            device=device,
            dtype=dtype,
            pad=ids["pad"],
            ids=ids,
        )
        fa = result_a["final_eval"]
        fb = result_b["final_eval"]
        # winner: representation first, then efficiency
        score = {}
        for name, r, f in (("A", result_a, fa), ("B", result_b, fb)):
            inst = f.get("instruction") or {}
            gap = abs(float(r.get("generalization_gap") or 0))
            score[name] = {
                "inst_rank": inst.get("mean_rank") or 1e9,
                "inst_logp": inst.get("mean_logp") or -1e9,
                "val": f.get("val_ce") or 1e9,
                "gap": gap,
                "json_rank": (f.get("json") or {}).get("mean_rank") or 1e9,
                "code_rank": (f.get("code") or {}).get("mean_rank") or 1e9,
                "natural_rank": (f.get("natural") or {}).get("mean_rank") or 1e9,
                "tok_s": r.get("train_tokens_sec") or 0,
            }
        # lower rank better; higher logp better
        a_rep = (
            score["A"]["inst_rank"]
            + 0.5 * score["A"]["json_rank"]
            + 0.5 * score["A"]["code_rank"]
            + 0.35 * score["A"]["natural_rank"]
            + 8.0 * score["A"]["val"]
        )
        b_rep = (
            score["B"]["inst_rank"]
            + 0.5 * score["B"]["json_rank"]
            + 0.5 * score["B"]["code_rank"]
            + 0.35 * score["B"]["natural_rank"]
            + 8.0 * score["B"]["val"]
        )
        rank_gain = score["A"]["inst_rank"] - score["B"]["inst_rank"]
        val_gain = score["A"]["val"] - score["B"]["val"]
        if b_rep + 5 < a_rep and (rank_gain >= 5 or val_gain >= 0.15):
            winner = "B"
            reason = (
                f"B representation composite {b_rep:.1f} vs A {a_rep:.1f}; "
                f"instruction rank {score['B']['inst_rank']:.1f} vs {score['A']['inst_rank']:.1f}; "
                f"val CE {score['B']['val']:.3f} vs {score['A']['val']:.3f}."
            )
        elif abs(b_rep - a_rep) < 8 and score["A"]["tok_s"] > 1.4 * score["B"]["tok_s"]:
            winner = "A"
            reason = (
                f"Representation composites similar (A {a_rep:.1f}, B {b_rep:.1f}); "
                f"A throughput {score['A']['tok_s']:.0f} vs B {score['B']['tok_s']:.0f} tok/s makes deeper training more valuable."
            )
        elif a_rep < b_rep:
            winner = "A"
            reason = f"A representation composite {a_rep:.1f} better than B {b_rep:.1f}."
        else:
            winner = "B"
            reason = f"B representation composite {b_rep:.1f} vs A {a_rep:.1f}, but advantage is modest."
        unique_now = int(built["manifest"]["unique_train_tokens_new_tokenizer"])
        unique_pool_old = 16_944_719
        unique_sufficient = unique_pool_old >= 50_000_000
        rec_model = "WRIM1-B-50M" if winner == "B" and unique_sufficient else "WRIM1-A-23M" if winner == "A" else "WRIM1-B-50M"
        if winner == "B" and not unique_sufficient:
            rec_model = "WRIM1-B-50M_PENDING_CORPUS_EXPANSION"
        params_sel = result_b["parameters"] if "B" in rec_model else result_a["parameters"]
        twenty = 20 * params_sel
        wall_a = result_a["wall_s"]
        wall_b = result_b["wall_s"]
        eval_share = (result_a["eval_s"] + result_b["eval_s"]) / max(wall_a + wall_b, 1e-6)
        report = {
            "ok": True,
            "kind": "WRIM1_PILOT_AB_10M_REPORT",
            "PROGRAM_STATUS": "COMPLETED",
            "CANONICAL": CANONICAL,
            "created_at": utc_now(),
            "prep_s": prep_s,
            "gpu_start": snap0,
            "gpu_end": gpu_snapshot(),
            "precision": str(dtype).replace("torch.", ""),
            "bf16_supported": bool(torch.cuda.is_bf16_supported()) if device.type == "cuda" else False,
            "PILOT_CORPUS": "WRIM1-PILOT-CORPUS-v1",
            "PILOT_CORPUS_HASH": built["manifest"].get("corpus_hash") or built["manifest"]["train_windows_sha256"],
            "PILOT_CORPUS_UNIQUE_TOKENS": unique_now,
            "PILOT_TOKENIZER": "WRIM1-PILOT-TOKENIZER-v1",
            "PILOT_TOKENIZER_HASH": built["tok_study"]["tokenizer_sha256"],
            "PILOT_TOKENIZER_VOCAB": vocab,
            "TOKENIZER_STUDY": built["tok_study"],
            "TOKENIZER_ENGLISH_TOK_WORD": built["tok_study"]["efficiency"]["english"]["tokens_per_word"],
            "TOKENIZER_INSTRUCTION_TOK_WORD": built["tok_study"]["efficiency"]["instruction"]["tokens_per_word"],
            "TOKENIZER_JSON_TOK_WORD": built["tok_study"]["efficiency"]["json"]["tokens_per_word"],
            "TOKENIZER_CODE_TOK_WORD": built["tok_study"]["efficiency"]["code"]["tokens_per_word"],
            "special_ids": ids,
            "CANDIDATE_A": result_a,
            "CANDIDATE_B": result_b,
            "CANDIDATE_A_ARCHITECTURE": ARCH_A,
            "CANDIDATE_A_PARAMETERS": result_a["parameters"],
            "CANDIDATE_A_TOKENS_USED": result_a["tokens_used"],
            "CANDIDATE_A_LR": result_a["lr"],
            "CANDIDATE_A_LR_PREFLIGHT": pf_a,
            "CANDIDATE_A_FINAL_TRAIN_LOSS": result_a["final_train_loss"],
            "CANDIDATE_A_FINAL_VAL_LOSS": result_a["final_val_loss"],
            "CANDIDATE_A_GENERALIZATION_GAP": result_a["generalization_gap"],
            "CANDIDATE_A_INSTRUCTION_SIGNAL": summarize_signal(fa, "instruction"),
            "CANDIDATE_A_NATURAL_SIGNAL": summarize_signal(fa, "natural"),
            "CANDIDATE_A_JSON_SIGNAL": summarize_signal(fa, "json"),
            "CANDIDATE_A_CODE_SIGNAL": summarize_signal(fa, "code"),
            "CANDIDATE_A_TRAIN_TOKENS_SEC": result_a["train_tokens_sec"],
            "CANDIDATE_A_WALL_TOKENS_SEC": result_a["wall_tokens_sec"],
            "CANDIDATE_A_VRAM_PEAK": result_a["torch_peak_mib"],
            "CANDIDATE_B_ARCHITECTURE": ARCH_B,
            "CANDIDATE_B_PARAMETERS": result_b["parameters"],
            "CANDIDATE_B_TOKENS_USED": result_b["tokens_used"],
            "CANDIDATE_B_LR": result_b["lr"],
            "CANDIDATE_B_LR_PREFLIGHT": pf_b,
            "CANDIDATE_B_FINAL_TRAIN_LOSS": result_b["final_train_loss"],
            "CANDIDATE_B_FINAL_VAL_LOSS": result_b["final_val_loss"],
            "CANDIDATE_B_GENERALIZATION_GAP": result_b["generalization_gap"],
            "CANDIDATE_B_INSTRUCTION_SIGNAL": summarize_signal(fb, "instruction"),
            "CANDIDATE_B_NATURAL_SIGNAL": summarize_signal(fb, "natural"),
            "CANDIDATE_B_JSON_SIGNAL": summarize_signal(fb, "json"),
            "CANDIDATE_B_CODE_SIGNAL": summarize_signal(fb, "code"),
            "CANDIDATE_B_TRAIN_TOKENS_SEC": result_b["train_tokens_sec"],
            "CANDIDATE_B_WALL_TOKENS_SEC": result_b["wall_tokens_sec"],
            "CANDIDATE_B_VRAM_PEAK": result_b["torch_peak_mib"],
            "MICRO_EVAL_WALL_SHARE": (result_a["eval_s"] + result_b["eval_s"]) / max(wall_a + wall_b, 1e-6),
            "FULL_EVAL_WALL_SHARE": eval_share,
            "REPRESENTATION_COMPARISON": {
                "composite_A": a_rep,
                "composite_B": b_rep,
                "instruction_rank_A": score["A"]["inst_rank"],
                "instruction_rank_B": score["B"]["inst_rank"],
                "val_A": score["A"]["val"],
                "val_B": score["B"]["val"],
                "separability_A": fa.get("separability"),
                "separability_B": fb.get("separability"),
            },
            "PILOT_WINNER": winner,
            "PILOT_WINNER_REASON": reason,
            "CURRENT_UNIQUE_CORPUS_SUFFICIENT_FOR_NEXT_STAGE": "NO" if not unique_sufficient else "YES",
            "CORPUS_EXPANSION_REQUIRED": "YES" if not unique_sufficient else "NO",
            "RECOMMENDED_NEXT_MODEL": rec_model,
            "RECOMMENDED_STAGE1_TOKENS": 100_000_000,
            "RECOMMENDED_STAGE2_CUMULATIVE_TOKENS": 300_000_000,
            "RECOMMENDED_LONG_RUN_TOKEN_TARGET": int(twenty),
            "TWENTY_TOKENS_PER_PARAMETER_REFERENCE": {
                "formula": "20 * parameter_count",
                "A_23M": 20 * int(result_a["parameters"]),
                "B_50M": 20 * int(result_b["parameters"]),
                "selected": int(twenty),
                "note": "100M is a STAGE-1 tranche, not compute-optimal for 50M.",
            },
            "RECOMMENDED_UNIQUE_CORPUS_TARGET": 50_000_000,
            "CURRENT_HARDWARE_SUFFICIENT": "YES",
            "FULL_WRIM1_TRAINING_AUTHORIZED": "NO",
            "TOKENIZER_FINALIZED": "NO",
            "MODEL_PROMOTED": "NO",
            "CANONICAL_CHANGED": "NO",
            "FOUNDATION_V2_STARTED": "NO",
            "COMMIT": "NO",
            "PUSH": "NO",
            "DEPLOY": "NO",
            "RAEL_STARTED": "NO",
            "GENESIS_TOKENS_SPENT": 0,
            "spec_param_count_A": spec_param_count(vocab, ARCH_A),
            "spec_param_count_B": spec_param_count(vocab, ARCH_B),
        }
        if unique_sufficient:
            report["NEXT_COMMANDER_DECISION"] = "AUTHORIZE WRIM1 NEXT-STAGE TRAINING"
        else:
            report["NEXT_COMMANDER_DECISION"] = "AUTHORIZE CORPUS EXPANSION"
        REPORT_PATH.write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")
        print(json.dumps({
            "ok": True,
            "PROGRAM_STATUS": "COMPLETED",
            "PILOT_WINNER": winner,
            "report": str(REPORT_PATH),
            "A_params": result_a["parameters"],
            "B_params": result_b["parameters"],
            "A_val": result_a["final_val_loss"],
            "B_val": result_b["final_val_loss"],
        }, indent=2))
        return 0
    except Exception as exc:  # noqa: BLE001
        fail = {"ok": False, "PROGRAM_STATUS": "FAILED", "error": str(exc), "trace": traceback.format_exc()}
        REPORT_PATH.write_text(json.dumps(fail, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(fail, indent=2)[:4000])
        return 1
    finally:
        release_trainer_lock(PROGRAM_ID)


if __name__ == "__main__":
    raise SystemExit(main())
