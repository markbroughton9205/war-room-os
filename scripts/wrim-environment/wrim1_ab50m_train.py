"""WRIM1-FINAL-TOKENIZER-AND-AB50M-01 trainer. From-scratch A/B, 50M physical tokens each."""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from tokenizers import Tokenizer

from wrim1_ab50m_identity import (
    ARCH_A,
    ARCH_B,
    AUTHORIZE_ENV_NAME,
    AUTHORIZE_ENV_VALUE,
    AUTHORIZE_FLAG,
    BETAS,
    CANONICAL,
    CKPT_ROOT,
    CORPUS_HASH,
    DATA_ROOT,
    EPS,
    FULL_EVAL_FRACS,
    GRAD_CLIP,
    GRAD_HARD,
    LR_A,
    LR_B,
    MICRO_BATCH,
    MICRO_EVAL_EVERY,
    PACK_DIR,
    PREFLIGHT_STEPS,
    PHYSICAL_TOKENS,
    PROBE_DIR,
    PROGRAM_ID,
    REPORT_PATH,
    SEED,
    SEQ_LEN,
    STEPS,
    TOKENIZER_DIR,
    TOKENS_PER_STEP,
    WARMUP_FRAC,
    WEIGHT_DECAY,
)
from wrim_gpu_quiet_mode import gpu_snapshot as quiet_gpu_snapshot
from wrim_gpu_quiet_mode import (
    assert_gpu_quiet, restore_ollama_prior_state, runtime_mask_user_ollama,
    snapshot_prior_state, stop_user_ollama,
)
from wrim_pilot_ab_10m import (
    autocast_ctx,
    cache_probes,
    cosine_lr,
    evaluate,
    make_model,
    nvidia_proc_vram,
    sample_hw,
    save_ckpt,
    summarize_signal,
    val_ce,
)
from wrim_pilot_ab_data import sha256_file, special_ids
from wrim_pilot_ab_model import WRIM1PilotModel, spec_param_count
from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def authorization_ok() -> bool:
    return AUTHORIZE_FLAG in sys.argv and os.environ.get(AUTHORIZE_ENV_NAME) == AUTHORIZE_ENV_VALUE


def ollama_active() -> bool:
    env = dict(os.environ)
    env.setdefault("XDG_RUNTIME_DIR", "/run/user/1000")
    proc = subprocess.run(["systemctl", "--user", "is-active", "ollama.service"], capture_output=True, text=True, env=env)
    return proc.stdout.strip() == "active"



def hold_quiet_gpu(*, hold_s: float = 60.0, timeout_s: float = 300.0) -> dict[str, Any]:
    """Require an uninterrupted quiet-GPU window before training.

    Any Ollama service or llama-server resurrection is stopped, recorded,
    and resets the quiet timer. Training may begin only after hold_s
    continuous seconds with Ollama inactive, no llama-server, and >=8 GiB
    free VRAM.
    """
    t0 = time.perf_counter()
    quiet_since: float | None = None
    events: list[dict[str, Any]] = []
    samples: list[dict[str, Any]] = []
    min_free = 1e18

    stop_user_ollama()

    while time.perf_counter() - t0 < timeout_s:
        llama_before = subprocess.run(
            ["pgrep", "-a", "llama-server"],
            capture_output=True,
            text=True,
        ).stdout.strip()
        service_before = ollama_active()

        if service_before or llama_before:
            event = {
                "utc": utc_now(),
                "action": "restop_and_reset_quiet_clock",
                "ollama_active": service_before,
                "llama_server": llama_before or None,
            }
            events.append(event)
            print("QUIET_RESPAWN_RESET", json.dumps(event), flush=True)

            stop_user_ollama()
            quiet_since = None
            time.sleep(0.5)
            continue

        snap = quiet_gpu_snapshot()
        now = time.perf_counter()
        min_free = min(min_free, float(snap["free_mib"]))

        service_on = ollama_active()
        llama = snap.get("llama_server")

        exclusive = (
            not service_on
            and llama is None
            and float(snap["free_mib"]) >= 8000
        )

        if exclusive:
            if quiet_since is None:
                quiet_since = now
            consecutive = now - quiet_since
        else:
            quiet_since = None
            consecutive = 0.0

        samples.append({
            **snap,
            "ollama_active": service_on,
            "ok": exclusive,
            "elapsed_s": now - t0,
            "consecutive_s": consecutive,
        })

        if consecutive >= hold_s:
            return {
                "stable": True,
                "min_free_mib": min_free,
                "held_s": consecutive,
                "events": events,
                "samples": samples[-12:],
                "wall_s": now - t0,
                "proof_rule": (
                    "60_uninterrupted_seconds_no_ollama_"
                    "no_llama_server_free_mib_gte_8000"
                ),
            }

        time.sleep(0.5)

    return {
        "stable": False,
        "min_free_mib": min_free,
        "held_s": (
            0.0
            if quiet_since is None
            else time.perf_counter() - quiet_since
        ),
        "events": events,
        "samples": samples[-12:],
        "wall_s": time.perf_counter() - t0,
        "proof_rule": (
            "60_uninterrupted_seconds_no_ollama_"
            "no_llama_server_free_mib_gte_8000"
        ),
    }


class OllamaRestart(RuntimeError):
    pass


class OllamaWatchdog:
    def __init__(self) -> None:
        self.hit = False
        self.event: str | None = None
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread.ident is not None:
            self._thread.join(timeout=3)

    def reset(self) -> None:
        self.stop()
        self.hit = False
        self.event = None
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self.start()

    def check(self, where: str) -> None:
        if self.hit:
            raise OllamaRestart(self.event or f"ollama.service became active at {where}")

    def _run(self) -> None:
        while not self._stop.wait(1.0):
            llama = subprocess.run(
                ["pgrep", "-a", "llama-server"],
                capture_output=True,
                text=True,
            )
            service_on = ollama_active()

            if llama.stdout.strip() or service_on:
                self.hit = True
                self.event = (
                    f"GPU quiet-mode violation at {utc_now()}; "
                    f"ollama_active={service_on}; "
                    f"llama_server={llama.stdout.strip() or 'none'}"
                )

                # Clear contention to protect the host/GPU, but never resume
                # this scientific run after the violation.
                stop_user_ollama()
                return


def pause_and_clear_gpu(
    watchdog: OllamaWatchdog,
    events: list[dict[str, Any]],
    where: str,
) -> None:
    """Fail closed on any Ollama/GPU quiet-mode violation.

    Never continue the same A/B scientific run after contention.
    """
    event = {
        "utc": utc_now(),
        "where": where,
        "event": watchdog.event,
        "action": "abort_no_resume",
    }
    events.append(event)

    print(
        "GPU_QUIET_MODE_VIOLATION_ABORT",
        json.dumps(event),
        flush=True,
    )

    # Best-effort clear so the machine is not left with a competing
    # llama-server, but do not reset watchdog and do not resume training.
    stop_user_ollama()

    raise OllamaRestart(
        watchdog.event
        or (
            f"GPU quiet-mode violation at {where}; "
            "scientific run invalidated"
        )
    )


def assert_pre_optimizer_quiet(watchdog: OllamaWatchdog, where: str) -> None:
    try:
        watchdog.check(where)
        assert_gpu_quiet()
        watchdog.check(where)
    except Exception as exc:
        watchdog.hit = True
        watchdog.event = f"GPU quiet-mode violation at {where}: {exc}"
        raise OllamaRestart(watchdog.event) from exc


def relative_update_norm(model: WRIM1PilotModel, prev: dict[str, torch.Tensor]) -> float:
    num = 0.0
    den = 0.0
    with torch.no_grad():
        for name, param in model.named_parameters():
            old = prev.get(name)
            if old is None:
                continue
            delta = param.detach() - old
            num += float(delta.float().norm().item() ** 2)
            den += float(old.float().norm().item() ** 2)
    return math.sqrt(num) / max(math.sqrt(den), 1e-12)


def preflight_lr(
    arch: dict[str, Any],
    vocab: int,
    train_windows: np.ndarray,
    val_windows: np.ndarray,
    device: torch.device,
    dtype: torch.dtype,
    pad: int,
    candidates: tuple[float, ...],
    watchdog: OllamaWatchdog,
) -> dict[str, Any]:
    rows = []
    for lr in candidates:
        torch.manual_seed(SEED)
        model = make_model(arch, vocab, device, dtype)
        opt = torch.optim.AdamW(model.parameters(), lr=lr, betas=BETAS, eps=EPS, weight_decay=WEIGHT_DECAY)
        prev = {n: p.detach().clone() for n, p in model.named_parameters()}
        last_loss = None
        max_grad = 0.0
        unsafe = False
        for step in range(PREFLIGHT_STEPS):
            batch = torch.tensor(train_windows[step * MICRO_BATCH : (step + 1) * MICRO_BATCH], device=device, dtype=torch.long)
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
            assert_pre_optimizer_quiet(watchdog, f"preflight lr={lr} step={step} pre-opt.step")
            opt.step()
            last_loss = float(loss.item())
        rel = relative_update_norm(model, prev)
        if rel >= 0.5:
            unsafe = True
        val_micro = val_ce(model, val_windows, device, min(48, len(val_windows)), pad)
        if not math.isfinite(val_micro):
            unsafe = True
        rows.append({
            "lr": lr,
            "train_loss": last_loss,
            "val_ce": val_micro,
            "max_grad": max_grad,
            "relative_update_norm": rel,
            "unsafe": unsafe,
        })
        del model, opt
        if device.type == "cuda":
            torch.cuda.empty_cache()
    safe = [r for r in rows if not r["unsafe"]]
    pool = safe or rows
    chosen = min(pool, key=lambda r: (r["val_ce"] if math.isfinite(r["val_ce"]) else 1e9, abs(math.log10(r["lr"]) + 3)))
    return {"rows": rows, "chosen_lr": chosen["lr"], "selection": "min_val_ce_among_stable"}


def train_candidate(
    *,
    arch: dict[str, Any],
    run_id: str,
    vocab: int,
    peak_lr: float,
    train_windows: np.ndarray,
    val_windows: np.ndarray,
    hold_windows: np.ndarray,
    cached: dict[str, list[dict[str, Any]]],
    device: torch.device,
    dtype: torch.dtype,
    pad: int,
    watchdog: OllamaWatchdog,
) -> dict[str, Any]:
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    random.seed(SEED)
    model = make_model(arch, vocab, device, dtype)
    opt = torch.optim.AdamW(model.parameters(), lr=peak_lr, betas=BETAS, eps=EPS, weight_decay=WEIGHT_DECAY)
    warmup = max(1, int(STEPS * WARMUP_FRAC))
    n_windows = len(train_windows)
    full_steps = sorted({max(1, int(round(f * STEPS))) for f in FULL_EVAL_FRACS})
    metrics: list[dict[str, Any]] = []
    micro: list[dict[str, Any]] = []
    train_s = 0.0
    eval_s = 0.0
    tokens_used = 0
    last_train = None
    best_val = 1e9
    best_step = 0
    peak_alloc = 0.0
    gpu_util_samples: list[float] = []
    family_traj: list[dict[str, Any]] = []
    respawn_events: list[dict[str, Any]] = []
    t_run = time.perf_counter()
    ev = evaluate(model, val_windows, cached, device, pad, full=True)
    eval_s += ev["eval_s"]
    hold_ce0 = evaluate_hold(model, hold_windows, device, pad)
    metrics.append({"step": 0, "hold_ce": hold_ce0, **ev})
    save_ckpt(CKPT_ROOT / run_id / "step-0", model, 0, {"lr": peak_lr})
    step = 0
    for step in range(1, STEPS + 1):
        try:
            watchdog.check(f"{run_id} step {step}")
        except OllamaRestart:
            pause_and_clear_gpu(watchdog, respawn_events, f"{run_id} step {step}")
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
        assert_pre_optimizer_quiet(watchdog, f"{run_id} step={step} pre-opt.step")
        opt.step()
        if device.type == "cuda":
            torch.cuda.synchronize()
        train_s += time.perf_counter() - t0
        tokens_used += TOKENS_PER_STEP
        last_train = float(loss.item())
        if tokens_used > PHYSICAL_TOKENS:
            break
        if step % MICRO_EVAL_EVERY == 0:
            ev = evaluate(model, val_windows, cached, device, pad, full=False)
            eval_s += ev["eval_s"]
            micro.append({"step": step, "train_loss": last_train, "grad": float(gn), "lr": lr, **ev})
            family_traj.append({
                "step": step,
                "instruction_rank": (ev.get("instruction") or {}).get("mean_rank"),
                "natural_rank": (ev.get("natural") or {}).get("mean_rank"),
                "json_rank": (ev.get("json") or {}).get("mean_rank"),
                "code_rank": (ev.get("code") or {}).get("mean_rank"),
                "reasoning_rank": (ev.get("reasoning") or {}).get("mean_rank"),
            })
        if step in full_steps:
            ev = evaluate(model, val_windows, cached, device, pad, full=True)
            eval_s += ev["eval_s"]
            hold_ce = evaluate_hold(model, hold_windows, device, pad)
            metrics.append({"step": step, "train_loss": last_train, "grad": float(gn), "lr": lr, "hold_ce": hold_ce, **ev})
            save_ckpt(CKPT_ROOT / run_id / f"step-{step}", model, step, {"lr": lr, "val_ce": ev["val_ce"]})
            if ev["val_ce"] < best_val:
                best_val = ev["val_ce"]
                best_step = step
                save_ckpt(CKPT_ROOT / run_id / "best-val", model, step, {"lr": lr, "val_ce": ev["val_ce"]})
        if step % 400 == 0:
            hw = sample_hw()
            util = ((hw.get("gpu") or {}).get("util_pct"))
            if util is not None:
                gpu_util_samples.append(float(util))
            print(json.dumps({"run": run_id, "step": step, "loss": last_train, "tokens": tokens_used, "gpu_util": util}), flush=True)
        if device.type == "cuda":
            peak_alloc = max(peak_alloc, torch.cuda.max_memory_allocated() / (1024 * 1024))
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
        "final_hold_ce": final.get("hold_ce"),
        "generalization_gap": None if last_train is None or final.get("val_ce") is None else float(final["val_ce"]) - float(last_train),
        "final_eval": final,
        "metrics": metrics,
        "micro": micro,
        "family_traj": family_traj,
        "best_val": best_val if best_val < 1e8 else None,
        "best_step": best_step,
        "train_s": train_s,
        "eval_s": eval_s,
        "wall_s": wall,
        "train_tokens_sec": tokens_used / max(train_s, 1e-6),
        "wall_tokens_sec": tokens_used / max(wall, 1e-6),
        "torch_peak_mib": peak_alloc,
        "nvidia_smi_proc_mib": nvidia_proc_vram(),
        "gpu_util_mean": (sum(gpu_util_samples) / len(gpu_util_samples)) if gpu_util_samples else None,
        "dtype": str(dtype).replace("torch.", ""),
        "device": str(device),
        "bf16": bool(torch.cuda.is_available() and torch.cuda.is_bf16_supported()),
        "precision": {
            "param_dtype": "float32",
            "compute": "bf16_autocast" if (torch.cuda.is_available() and torch.cuda.is_bf16_supported()) else "float32",
        },
        "ollama_respawn_events": respawn_events,
    }


@torch.no_grad()
def evaluate_hold(model: WRIM1PilotModel, windows: np.ndarray, device: torch.device, pad: int) -> float:
    return val_ce(model, windows, device, min(len(windows), 128), pad)


def pareto(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    def better(metric: str, low_good: bool = True) -> str:
        av, bv = a.get(metric), b.get(metric)
        if av is None or bv is None:
            return "unknown"
        if low_good:
            return "A" if av < bv else ("B" if bv < av else "tie")
        return "A" if av > bv else ("B" if bv > av else "tie")

    def better_rank(av: float | None, bv: float | None) -> str:
        if av is None or bv is None:
            return "unknown"
        if av < bv:
            return "A"
        if bv < av:
            return "B"
        return "tie"

    inst_a = ((a.get("final_eval") or {}).get("instruction") or {}).get("mean_rank")
    inst_b = ((b.get("final_eval") or {}).get("instruction") or {}).get("mean_rank")
    nat_a = ((a.get("final_eval") or {}).get("natural") or {}).get("mean_rank")
    nat_b = ((b.get("final_eval") or {}).get("natural") or {}).get("mean_rank")
    json_a = ((a.get("final_eval") or {}).get("json") or {}).get("mean_rank")
    json_b = ((b.get("final_eval") or {}).get("json") or {}).get("mean_rank")
    code_a = ((a.get("final_eval") or {}).get("code") or {}).get("mean_rank")
    code_b = ((b.get("final_eval") or {}).get("code") or {}).get("mean_rank")
    reason_a = ((a.get("final_eval") or {}).get("reasoning") or {}).get("mean_rank")
    reason_b = ((b.get("final_eval") or {}).get("reasoning") or {}).get("mean_rank")
    pref_a = ((a.get("final_eval") or {}).get("instruction") or {}).get("mean_prefix_depth")
    pref_b = ((b.get("final_eval") or {}).get("instruction") or {}).get("mean_prefix_depth")
    table = {
        "val_ce": better("final_val_loss"),
        "hold_ce": better("final_hold_ce"),
        "gap": better("generalization_gap"),
        "instruction_rank": better_rank(inst_a, inst_b),
        "natural_rank": better_rank(nat_a, nat_b),
        "json_rank": better_rank(json_a, json_b),
        "code_rank": better_rank(code_a, code_b),
        "reasoning_rank": better_rank(reason_a, reason_b),
        "throughput": better("train_tokens_sec", low_good=False),
    }
    b_rep = sum(1 for k in ("val_ce", "gap", "instruction_rank", "json_rank", "code_rank") if table[k] == "B")
    a_eff = table["throughput"] == "A" or table["natural_rank"] == "A"
    if b_rep >= 4 and table["val_ce"] == "B":
        rec, conf, why = "B", "medium", "B stronger on validation and structured/instruction ranks enough to justify cost"
    elif a_eff and b_rep <= 2:
        rec, conf, why = "A", "medium", "A comparable enough with better throughput/natural rank"
    else:
        rec, conf, why = "A_B_DECISION_STILL_AMBIGUOUS", "low", "50M still too shallow vs Chinchilla 20 tok/param"
    return {"winners": table, "recommended": rec, "confidence": conf, "reason": why, "prefix_a": pref_a, "prefix_b": pref_b}


def candidate_fields(prefix: str, r: dict[str, Any]) -> dict[str, Any]:
    ev = r.get("final_eval") or {}
    return {
        f"{prefix}_PARAMETERS": r.get("parameters"),
        f"{prefix}_TOKENS_USED": r.get("tokens_used"),
        f"{prefix}_LR": r.get("lr"),
        f"{prefix}_TRAIN_CE": r.get("final_train_loss"),
        f"{prefix}_VAL_CE": r.get("final_val_loss"),
        f"{prefix}_SOURCE_HOLDOUT_CE": r.get("final_hold_ce"),
        f"{prefix}_GENERALIZATION_GAP": r.get("generalization_gap"),
        f"{prefix}_INSTRUCTION_SIGNAL": summarize_signal(ev, "instruction"),
        f"{prefix}_NATURAL_SIGNAL": summarize_signal(ev, "natural"),
        f"{prefix}_JSON_SIGNAL": summarize_signal(ev, "json"),
        f"{prefix}_CODE_SIGNAL": summarize_signal(ev, "code"),
        f"{prefix}_REASONING_SIGNAL": summarize_signal(ev, "reasoning"),
        f"{prefix}_PREFIX_DEPTH": ((ev.get("instruction") or {}).get("mean_prefix_depth")),
        f"{prefix}_TRAIN_TOK_S": r.get("train_tokens_sec"),
        f"{prefix}_WALL_TOK_S": r.get("wall_tokens_sec"),
        f"{prefix}_VRAM_PEAK": r.get("nvidia_smi_proc_mib") or r.get("torch_peak_mib"),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(AUTHORIZE_FLAG, action="store_true")
    parser.parse_args()
    if not authorization_ok():
        print(json.dumps({"ok": False, "reason": "authorization_denied"}))
        return 2

    tok_man = json.loads((TOKENIZER_DIR / "WRIM1-TOKENIZER-v1-MANIFEST.json").read_text(encoding="utf-8"))
    pack_man = json.loads((PACK_DIR / "PACK-MANIFEST.json").read_text(encoding="utf-8"))
    tok = Tokenizer.from_file(str(TOKENIZER_DIR / "tokenizer.json"))
    assert sha256_file(TOKENIZER_DIR / "tokenizer.json") == tok_man["sha256"]
    ids = special_ids(tok)
    vocab = int(tok.get_vocab_size())
    train_windows = np.load(PACK_DIR / "train_windows.npy")
    val_windows = np.load(PACK_DIR / "val_windows.npy")
    hold_windows = np.load(PACK_DIR / "hold_windows.npy")
    probes = json.loads((PROBE_DIR / "probes.json").read_text(encoding="utf-8"))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dtype = torch.bfloat16 if device.type == "cuda" and torch.cuda.is_bf16_supported() else torch.float32
    cached = cache_probes(tok, ids, probes)

    prior = None
    unexpected = False
    result_a = None
    result_b = None
    proof = None
    abort_reason = None
    lock = acquire_trainer_lock(run_id=PROGRAM_ID, authorization_id=PROGRAM_ID, checkpoint_parent="FROM_SCRATCH", token_budget=PHYSICAL_TOKENS * 2)
    if not lock.get("ok"):
        print(json.dumps(lock, indent=2))
        return 4
    watchdog = OllamaWatchdog()
    pf_a = None
    pf_b = None
    restored = {"ok": False, "pending": True}
    respawn_events: list[dict[str, Any]] = []
    try:
        prior = snapshot_prior_state()
        stopped = stop_user_ollama(prior=prior)
        if not stopped["ok"]:
            raise RuntimeError("Failed to stop Ollama")
        runtime_mask_user_ollama(prior)
        print("OLLAMA_STOPPED", stopped.get("ok"), flush=True)
        proof = hold_quiet_gpu()
        (DATA_ROOT / "WRIM1_AB50M_GPU_60S_PROOF.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
        if not proof["stable"]:
            abort_reason = "GPU_QUIET_MODE_UNSTABLE"
            raise RuntimeError(abort_reason)
        watchdog.start()
        pf_a = preflight_lr(ARCH_A, vocab, train_windows, val_windows, device, dtype, ids["pad"], LR_A, watchdog)
        try:
            watchdog.check("after preflight A")
        except OllamaRestart:
            pause_and_clear_gpu(watchdog, respawn_events, "after preflight A")
        pf_b = preflight_lr(ARCH_B, vocab, train_windows, val_windows, device, dtype, ids["pad"], LR_B, watchdog)
        try:
            watchdog.check("after preflight B")
        except OllamaRestart:
            pause_and_clear_gpu(watchdog, respawn_events, "after preflight B")
        print("PREFLIGHT", pf_a["chosen_lr"], pf_b["chosen_lr"], flush=True)
        result_a = train_candidate(
            arch=ARCH_A, run_id="WRIM1-A-23M-DEEP", vocab=vocab, peak_lr=float(pf_a["chosen_lr"]),
            train_windows=train_windows, val_windows=val_windows, hold_windows=hold_windows,
            cached=cached, device=device, dtype=dtype, pad=ids["pad"], watchdog=watchdog,
        )
        try:
            watchdog.check("between A and B")
        except OllamaRestart:
            pause_and_clear_gpu(watchdog, respawn_events, "between A and B")
        result_b = train_candidate(
            arch=ARCH_B, run_id="WRIM1-B-50M-DEEP", vocab=vocab, peak_lr=float(pf_b["chosen_lr"]),
            train_windows=train_windows, val_windows=val_windows, hold_windows=hold_windows,
            cached=cached, device=device, dtype=dtype, pad=ids["pad"], watchdog=watchdog,
        )
    except OllamaRestart as exc:
        unexpected = True
        abort_reason = str(exc)
        print("ABORT", abort_reason, flush=True)
    except Exception as exc:  # noqa: BLE001
        abort_reason = f"{type(exc).__name__}: {exc}"
        print("ABORT", abort_reason, flush=True)
    finally:
        watchdog.stop()
        restored = restore_ollama_prior_state(prior) if prior is not None else {"ok": True, "action": "unchanged"}
        release_trainer_lock(PROGRAM_ID)
        print("OLLAMA_RESTORE", restored, flush=True)
        if not restored["ok"]:
            raise RuntimeError(f"Ollama restoration failed: {restored}")

    comparison = pareto(result_a or {}, result_b or {}) if result_a and result_b else {"recommended": "INCOMPLETE"}
    rec = comparison.get("recommended")
    next_dec = (
        "AUTHORIZE WRIM1 NEXT-STAGE TRAINING"
        if rec in {"A", "B"} and comparison.get("confidence") in {"medium", "high"}
        else "RUN ADDITIONAL A/B DISCRIMINATOR"
    )
    if rec == "A_B_DECISION_STILL_AMBIGUOUS":
        next_dec = "RUN ADDITIONAL A/B DISCRIMINATOR"
    report = {
        "kind": "WRIM1_FINAL_TOKENIZER_AB50M_REPORT",
        "CORPUS_VERSION": "WRIM-1-PRETRAIN-CORPUS-v1.5.0",
        "CORPUS_HASH": CORPUS_HASH,
        "FINAL_TOKENIZER": "WRIM1-TOKENIZER-v1",
        "FINAL_TOKENIZER_HASH": tok_man["sha256"],
        "FINAL_TOKENIZER_VOCAB": tok_man["actual_vocab"],
        "SPECIAL_TOKEN_IDS": tok_man["special_token_ids"],
        "TOKENIZER_ENGLISH_TOK_WORD": ((tok_man.get("candidates") or [{}])[0].get("efficiency") or {}).get("english"),
        "TOKENIZER_STUDY": tok_man.get("candidates"),
        "TOKENIZER_SELECTED_REASON": tok_man.get("selection_reason"),
        "PACKED_PHYSICAL_MIX": pack_man.get("physical_mix_actual"),
        "DOMAIN_REPEAT_FACTORS": pack_man.get("repeat_stats"),
        "GPU_QUIET_MODE": "USED",
        "GPU_QUIET_MODE_STABLE": bool(proof and proof.get("stable")),
        "OLLAMA_PRIOR_STATE": prior,
        "OLLAMA_UNEXPECTED_RESTART": unexpected or bool(respawn_events) or bool((result_a or {}).get("ollama_respawn_events")) or bool((result_b or {}).get("ollama_respawn_events")),
        "OLLAMA_RESTORED": bool(restored.get("matches_prior")),
        "OLLAMA_RESTORE_RESULT": restored,
        "ABORT_REASON": abort_reason,
        **candidate_fields("CANDIDATE_A", result_a or {}),
        **candidate_fields("CANDIDATE_B", result_b or {}),
        "A_B_REPRESENTATION_COMPARISON": comparison.get("winners"),
        "A_B_COMPUTE_COMPARISON": {
            "A_train_tok_s": (result_a or {}).get("train_tokens_sec"),
            "B_train_tok_s": (result_b or {}).get("train_tokens_sec"),
            "A_wall_s": (result_a or {}).get("wall_s"),
            "B_wall_s": (result_b or {}).get("wall_s"),
            "A_eval_wall_share": ((result_a or {}).get("eval_s") or 0) / max((result_a or {}).get("wall_s") or 1, 1e-6),
            "B_eval_wall_share": ((result_b or {}).get("eval_s") or 0) / max((result_b or {}).get("wall_s") or 1, 1e-6),
        },
        "A_B_PARETO_FRONTIER": comparison,
        "RECOMMENDED_MODEL": rec,
        "RECOMMENDED_MODEL_REASON": comparison.get("reason"),
        "A_B_DECISION_CONFIDENCE": comparison.get("confidence"),
        "RECOMMENDED_NEXT_TOKEN_TRANCHE": 100_000_000 if rec != "A_B_DECISION_STILL_AMBIGUOUS" else 50_000_000,
        "RECOMMENDED_LONG_RUN_TOKEN_TARGET": {
            "A_chinchilla_20tok": spec_param_count(vocab, ARCH_A) * 20,
            "B_chinchilla_20tok": spec_param_count(vocab, ARCH_B) * 20,
        },
        "FULL_WRIM1_TRAINING_AUTHORIZED": False,
        "TOKENIZER_FINALIZED": True,
        "MODEL_PROMOTED": False,
        "CANONICAL": CANONICAL,
        "CANONICAL_CHANGED": False,
        "FOUNDATION_V2_STARTED": False,
        "GENESIS_RESUMED": False,
        "COMMIT": False,
        "PUSH": False,
        "DEPLOY": False,
        "RAEL_STARTED": False,
        "NEXT_COMMANDER_DECISION": next_dec,
        "created_at": utc_now(),
        "preflight_a": pf_a,
        "preflight_b": pf_b,
        "result_a": result_a,
        "result_b": result_b,
    }
    # fill tokenizer domain tok/word from selected candidate
    selected = next((c for c in tok_man.get("candidates") or [] if c.get("vocab_size") == tok_man.get("selected_vocab")), None)
    if selected:
        e = selected["efficiency"]
        report["TOKENIZER_ENGLISH_TOK_WORD"] = e["english"]["tokens_per_word"]
        report["TOKENIZER_CONVERSATION_TOK_WORD"] = e["conversation"]["tokens_per_word"]
        report["TOKENIZER_INSTRUCTION_TOK_WORD"] = e["instruction"]["tokens_per_word"]
        report["TOKENIZER_JSON_TOK_WORD"] = e["json"]["tokens_per_word"]
        report["TOKENIZER_CODE_TOK_WORD"] = e["code"]["tokens_per_word"]
        report["TOKENIZER_MATH_TOK_WORD"] = e["math"]["tokens_per_word"]
        report["TOKENIZER_PROCEDURAL_TOK_WORD"] = e["procedural"]["tokens_per_word"]
    REPORT_PATH.write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")
    print("TRAIN_DONE", rec, abort_reason, flush=True)
    print(json.dumps({k: report[k] for k in (
        "FINAL_TOKENIZER_VOCAB", "FINAL_TOKENIZER_HASH", "RECOMMENDED_MODEL",
        "CANDIDATE_A_VAL_CE", "CANDIDATE_B_VAL_CE", "TOKENIZER_FINALIZED", "NEXT_COMMANDER_DECISION",
    ) if k in report}, indent=2))
    return 0 if result_a and result_b and not unexpected else 5


if __name__ == "__main__":
    raise SystemExit(main())
