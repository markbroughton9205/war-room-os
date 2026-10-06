"""WRIM1-RUN-000005 P2 sovereign foundational CLM training.

Commander-authorized execution of the frozen WRIM1-RUN-000005-P2-RECIPE.
Fresh AdamW from WRIM-0. Seed-2303 stream only. No step 1001. No P3. No STAGE3B.

Does not mutate WR-CORPUS, tokenizer, parent weights, P1, or seed-2302.
Does not repack. Resume is RESTART_REQUIRED_NOT_RESUMABLE.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from safetensors.torch import load_file, save_file
from tokenizers import Tokenizer

from foundational_p1_refine import npy_payload_sha, sha256_file, write_json
from p2_recipe import (
    BETAS,
    COMPACT_CADENCE,
    EPS,
    EVAL_SEED,
    EXCLUDED_DOCS,
    FORBIDDEN_2302_STREAM,
    FORBIDDEN_P1_STREAM,
    FULL_CADENCE,
    GRAD_ACCUM,
    GRAD_CLIP,
    MICRO_BATCH,
    OPTIMIZER_SAVE_STEPS,
    PACKER_MODE,
    PACKER_VERSION,
    PARAM_COUNT,
    PARENT_SHA,
    PRECISION,
    RECIPE_ID,
    RUN_ID,
    RUNTIME_SEED,
    SEQ_LEN,
    SOVEREIGN_PACKED_SOURCE_SHA,
    SOVEREIGN_SEED,
    SOVEREIGN_STREAM_SHA,
    TF32,
    TOKENIZER_SHA,
    TOKENS_PER_STEP,
    TOTAL_STEPS,
    WEIGHT_DECAY,
    WEIGHT_SAVE_STEPS,
    canonical_recipe,
    ledger_has_excluded,
    recipe_hash,
)
from p2_schedule import FORMULA, MIN_LR, PEAK_LR, WARMUP_STEPS, lr_p2, self_test
from phase2_grid import parameter_displacement
from safetensors_model import load_model_state_from_safetensors
from stage1_pack import causal_batch_audit
from stage2 import collect_optimizer_tensors
from stage2_eval import EVAL_SEED as STAGE2_EVAL_SEED
from stage2_pack import encode_corpus1_val_units, encode_rehearsal_val_units
from stage3_eval_baseline import concat_units
from stage3_runtime import PARAM_COUNT as RUNTIME_PARAM_COUNT
from stage3_runtime import disk_guard, utc_now
from stage3a_corrective_train import compact, save_weights, snapshot_eval, tensors_sha256
from stage3a_run import disable_tf32, gpu_stats, load_baseline, pid_alive, rng_snapshot
from stop_policy import STOP_POLICY_VERSION, decide, snapshot_from_compact
from wrim_g20m import VOCAB_SIZE, WRIM0Model, expected_torch_keys

AUTHORIZED_RECIPE_SHA = "5b6237dcad4321111510453c9bfcb6713a8f61a8218c487afd67952a42d18117"
MAX_STEPS = TOTAL_STEPS
TOKEN_BUDGET = MAX_STEPS * TOKENS_PER_STEP
IGNORE_INDEX = -100
PARENT_VAL0 = 8.890125
KIND = "WRIM_FOUNDATIONAL_P2_DIAGNOSTIC"
MEMORIZATION_MARKERS = [
    "It was the best of times",
    "You will rejoice to hear that no disaster has accompanied",
    "Pride and Prejudice",
    "code-operator-lifecycle-classification",
    "export default function Home",
]


def acquire_lock(lock_path: Path) -> dict[str, Any]:
    if lock_path.exists():
        try:
            prev = json.loads(lock_path.read_text(encoding="utf-8"))
        except Exception:
            prev = {}
        pid = int(prev.get("pid") or 0)
        if pid_alive(pid):
            return {"ok": False, "reason": "conflicting_active_wrim_training_pid", "existing": prev}
    payload = {"pid": os.getpid(), "run_id": RUN_ID, "utc": utc_now(), "recipe_sha256": AUTHORIZED_RECIPE_SHA}
    write_json(lock_path, payload)
    return {"ok": True, "lock": payload}


def release_lock(lock_path: Path) -> None:
    try:
        if lock_path.exists():
            lock_path.unlink()
    except OSError:
        pass


def seed_training() -> None:
    random.seed(RUNTIME_SEED)
    np.random.seed(RUNTIME_SEED)
    torch.manual_seed(RUNTIME_SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(RUNTIME_SEED)


def reseed_eval() -> None:
    random.seed(EVAL_SEED)
    np.random.seed(EVAL_SEED)
    torch.manual_seed(EVAL_SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(EVAL_SEED)


def slice_p2_batches(stream: np.ndarray, steps: int, batch_size: int, seq_len: int) -> tuple[list[tuple[np.ndarray, np.ndarray]], int]:
    batches: list[tuple[np.ndarray, np.ndarray]] = []
    offset = 0
    ignored = 0
    n = int(stream.size)
    for _ in range(steps):
        xs: list[np.ndarray] = []
        ys: list[np.ndarray] = []
        for _b in range(batch_size):
            x = np.array(stream[offset : offset + seq_len], dtype=np.int64)
            y_raw = np.array(stream[offset + 1 : offset + seq_len + 1], dtype=np.int64)
            if x.shape[0] != seq_len:
                raise ValueError(f"stream too short for x at offset {offset}: {x.shape[0]}")
            if y_raw.shape[0] == seq_len:
                y = y_raw
            elif y_raw.shape[0] == seq_len - 1 and offset + seq_len == n:
                y = np.concatenate([y_raw, np.array([IGNORE_INDEX], dtype=np.int64)])
                ignored += 1
            else:
                raise ValueError(f"unexpected y length {y_raw.shape[0]} at offset {offset}")
            xs.append(x)
            ys.append(y)
            offset += seq_len
        batches.append((np.stack(xs), np.stack(ys)))
    return batches, ignored


def abort_body(*, reason: str, step: int | None, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "ok": False,
        "kind": "ABORT",
        "run_id": RUN_ID,
        "reason": reason,
        "step": step,
        "timestamp": utc_now(),
        "TRAINING_AUTHORIZATION": "OFF",
        "P3_AUTHORIZED": False,
        "STAGE3B_AUTHORIZATION": "NO",
        "STAGE3B_EXECUTION_READINESS": False,
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "promotion_candidate": False,
        "final_classification": "P2_SOVEREIGN_FOUNDATIONAL_DIAGNOSTIC_INTERRUPTED"
        if reason in {"interrupted", "runtime_integrity_failure"}
        else "P2_SOVEREIGN_FOUNDATIONAL_DIAGNOSTIC_STOPPED_BY_POLICY",
        **(extra or {}),
    }


def memorization_scan(ev: dict[str, Any]) -> dict[str, Any]:
    hits: list[str] = []
    items = (((ev.get("dev") or {}).get("full") or {}).get("items")) or []
    blobs = []
    for it in items:
        blobs.append(str(it.get("continuation_prefix") or ""))
    text = "\n".join(blobs)
    for marker in MEMORIZATION_MARKERS:
        if marker and marker in text:
            hits.append(marker)
    unique128 = float(((ev.get("dev") or {}).get("unique_ratio_128")) or 0.0)
    looping = int(((ev.get("dev") or {}).get("n_looping")) or 0)
    return {
        "verbatim_marker_hits": hits,
        "unique128": unique128,
        "looping": looping,
        "note": "Semantic similarity alone is not memorization. Hits are distinctive long spans only.",
    }


def classify_p2(
    *,
    interrupted: bool,
    aborted: bool,
    abort_reason: str | None,
    last_valid_step: int,
    stop_decisions: list[dict[str, Any]],
    evals: dict[int, dict[str, Any]],
    eval0: dict[str, Any],
) -> dict[str, Any]:
    if interrupted:
        return {
            "final_classification": "P2_SOVEREIGN_FOUNDATIONAL_DIAGNOSTIC_INTERRUPTED",
            "generation_conclusion": "INTERRUPTED",
            "retention_conclusion": "INTERRUPTED",
            "scientific_conclusion": "Official trajectory did not complete.",
            "p3_merits_consideration": False,
            "transient_vs_sustained": "INTERRUPTED",
        }
    terminal_decision = (stop_decisions[-1]["decision"] if stop_decisions else "CONTINUE_ELIGIBLE")
    policy_stop = aborted and terminal_decision in {"HARD_ABORT", "SOFT_STOP", "REVIEW_REQUIRED"}
    if policy_stop and last_valid_step < MAX_STEPS:
        cls = "P2_SOVEREIGN_FOUNDATIONAL_DIAGNOSTIC_STOPPED_BY_POLICY"
    elif aborted:
        cls = "P2_SOVEREIGN_FOUNDATIONAL_DIAGNOSTIC_STOPPED_BY_POLICY"
    else:
        cls = None

    def axis_at(step: int) -> dict[str, Any]:
        ev = evals.get(step) or {}
        row = compact(ev) if ev else {}
        return snapshot_from_compact(row) if row else {}

    parent = snapshot_from_compact(compact(eval0))
    available = sorted(s for s in evals if s > 0)
    early = [s for s in available if s <= 25]
    late = [s for s in available if s >= 500] or [s for s in available if s >= 100] or available[-2:]
    terminal_step = last_valid_step if last_valid_step in evals else (available[-1] if available else 0)
    terminal = axis_at(terminal_step) if terminal_step else parent
    dterm = decide(parent, terminal) if terminal else None
    gen_states = (dterm or {}).get("generation_axis_states") or {}
    improvements = (dterm or {}).get("improvements") or []
    hits = (dterm or {}).get("hits") or []
    floors = (dterm or {}).get("floor_metric_states") or {}
    floor_only = all(v in {"UNCHANGED_AT_FLOOR", "UNCHANGED"} for v in floors.values())

    def improved_at(step: int) -> list[str]:
        ax = axis_at(step)
        if not ax:
            return []
        return decide(parent, ax).get("improvements") or []

    early_imp = set().union(*(improved_at(s) for s in early)) if early else set()
    late_imp = set().union(*(improved_at(s) for s in late)) if late else set()
    sustained = sorted(early_imp & late_imp & set(improvements))
    transient = sorted((early_imp - late_imp) | (early_imp - set(improvements)))
    term_ev = evals.get(terminal_step) or eval0
    dnll = float(term_ev.get("mean_wrim0_anchor_nll_delta") or 0.0)
    kl = float(term_ev.get("mean_kl_wrim0_to_candidate") or 0.0)
    val0 = float(term_ev.get("val_loss_corpus0") or 9e9)
    retention_ok = dnll < 0.105 and kl < 0.018 and val0 < PARENT_VAL0
    retention_conclusion = "WITHIN_HARD_BANDS" if retention_ok else "OUTSIDE_HARD_BANDS"
    gen_improved = len(improvements) >= 1 and not hits
    gen_worsened = len(hits) >= 1
    if gen_improved and sustained:
        generation_conclusion = "SUSTAINED_IMPROVEMENT"
    elif gen_improved and not sustained:
        generation_conclusion = "FINAL_STATE_IMPROVEMENT_NOT_SUSTAINED_TRAJECTORY"
    elif transient and gen_worsened:
        generation_conclusion = "TRANSIENT_THEN_DEGRADED"
    elif gen_worsened:
        generation_conclusion = "DEGRADED"
    else:
        generation_conclusion = "NO_CLEAR_GENERATION_SIGNAL"

    if cls is None:
        if not retention_ok:
            cls = "P2_SOVEREIGN_FOUNDATIONAL_DIAGNOSTIC_FAILED"
        elif generation_conclusion == "SUSTAINED_IMPROVEMENT" and retention_ok:
            cls = "P2_SOVEREIGN_FOUNDATIONAL_DIAGNOSTIC_SUCCESS"
        elif generation_conclusion in {"TRANSIENT_THEN_DEGRADED", "FINAL_STATE_IMPROVEMENT_NOT_SUSTAINED_TRAJECTORY"} or (
            improvements and hits
        ):
            cls = "P2_SOVEREIGN_FOUNDATIONAL_DIAGNOSTIC_MIXED"
        elif generation_conclusion == "DEGRADED":
            cls = "P2_SOVEREIGN_FOUNDATIONAL_DIAGNOSTIC_FAILED"
        else:
            cls = "P2_SOVEREIGN_FOUNDATIONAL_DIAGNOSTIC_INCONCLUSIVE"

    p3_merits = bool(
        retention_ok
        and generation_conclusion in {"SUSTAINED_IMPROVEMENT", "FINAL_STATE_IMPROVEMENT_NOT_SUSTAINED_TRAJECTORY"}
        and cls in {"P2_SOVEREIGN_FOUNDATIONAL_DIAGNOSTIC_SUCCESS", "P2_SOVEREIGN_FOUNDATIONAL_DIAGNOSTIC_MIXED"}
    )
    return {
        "final_classification": cls,
        "generation_conclusion": generation_conclusion,
        "retention_conclusion": retention_conclusion,
        "scientific_conclusion": (
            "P2 is a foundational CLM diagnostic, not instruction/JSON SFT. "
            f"Floor metrics remaining at zero are UNCHANGED_AT_FLOOR ({floor_only}). "
            f"Generation: {generation_conclusion}. Retention: {retention_conclusion}. "
            f"Sustained axes: {sustained or 'none'}. Transient axes: {transient or 'none'}."
        ),
        "p3_merits_consideration": p3_merits,
        "transient_vs_sustained": {
            "early_improvements": sorted(early_imp),
            "late_improvements": sorted(late_imp),
            "terminal_improvements": improvements,
            "terminal_hits": hits,
            "sustained": sustained,
            "transient": transient,
            "generation_axis_states": gen_states,
            "floor_metric_states": floors,
        },
        "abort_reason": abort_reason,
        "stop_policy_terminal": terminal_decision,
    }


def best_analysis_checkpoint(evals: dict[int, dict[str, Any]], ckpts: dict[int, dict[str, Any]]) -> dict[str, Any]:
    scored = []
    for step, ev in evals.items():
        if step == 0 or step not in ckpts:
            continue
        row = compact(ev)
        dnll = float(row.get("dnll") or 0.0)
        kl = float(row.get("kl") or 0.0)
        val0 = float(row.get("val0") or 9e9)
        if not (dnll < 0.105 and kl < 0.018 and val0 < PARENT_VAL0):
            continue
        looping = int(row.get("dev_looping") or 0)
        u128 = float(row.get("dev_unique_128") or 0.0)
        u256 = float(row.get("dev_unique_256") or 0.0)
        collapse = int(row.get("dev_collapsed") or 0)
        score = (-looping) + u128 + 0.5 * u256 + (-0.25 * collapse)
        scored.append({"step": step, "score": score, "looping": looping, "unique128": u128, "unique256": u256, "dnll": dnll, "kl": kl})
    if not scored:
        return {"step": None, "note": "No saved checkpoint stayed inside retention bands. Analysis-only; not a promotion."}
    best = max(scored, key=lambda r: (r["score"], -int(r["step"])))
    best["note"] = "Analysis only. Not a promotion candidate. Do not call this Ra'el."
    best["promotion"] = False
    return best


def save_p2_ckpt(
    ckpt_dir: Path,
    model: WRIM0Model,
    optimizer: torch.optim.AdamW | None,
    step: int,
    tokens: int,
    lr: float | None,
    extra: dict[str, Any],
    *,
    save_opt: bool,
) -> dict[str, Any]:
    meta = save_weights(ckpt_dir, model, step, tokens)
    if save_opt and optimizer is not None:
        opt_path = ckpt_dir / "optimizer.safetensors"
        save_file(collect_optimizer_tensors(optimizer, model), str(opt_path))
        meta["optimizer_path"] = str(opt_path)
        meta["optimizer_sha256"] = sha256_file(opt_path)
    else:
        meta["optimizer_path"] = None
        meta["optimizer_saved"] = False
    write_json(ckpt_dir / "scheduler.json", {"step": step, "lr": lr, "formula": FORMULA, "next_unauthorized_step": 1001})
    write_json(ckpt_dir / "rng.json", rng_snapshot())
    write_json(ckpt_dir / "meta.json", extra)
    return meta


def run_p2(
    *,
    weights: Path,
    tokenizer_path: Path,
    dump_root: Path,
    baseline_path: Path,
    sovereignty_path: Path,
    stream_path: Path,
    ledger_path: Path,
    p1_npy: Path,
    refine_npy: Path,
    claude_md: Path,
    report_path: Path,
    ckpt_root: Path,
    authorize: bool,
) -> dict[str, Any]:
    started = utc_now()
    t_run0 = time.perf_counter()
    ckpt_root.mkdir(parents=True, exist_ok=True)
    lock_path = ckpt_root / "RUN.lock"
    evals_dir = ckpt_root / "evals"
    evals_dir.mkdir(parents=True, exist_ok=True)
    metrics_path = ckpt_root / "metrics.jsonl"
    adamw_constructed = False
    optimizer_created_at = None
    last_valid_step = 0
    tokens_seen = 0
    interrupted = False

    def fail(reason: str, step: int | None = 0, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = abort_body(reason=reason, step=step, extra=extra)
        payload["AdamW_constructed"] = adamw_constructed
        payload["optimizer_steps"] = last_valid_step
        payload["tokens_trained"] = tokens_seen
        payload["TRAINING_AUTHORIZATION"] = "OFF"
        write_json(ckpt_root / "ABORT.json", payload)
        write_json(report_path, payload)
        return payload

    if not authorize:
        return fail("TRAINING_DENIED_missing_cli_authorization", 0)
    if STAGE2_EVAL_SEED != 42 or EVAL_SEED != 42:
        return fail("eval_seed_mismatch", 0)

    sched = self_test()
    if not sched["ok"]:
        return fail("schedule_self_test", 0, {"schedule": sched})
    if abs(lr_p2(25) - PEAK_LR) > 1e-15 or abs(lr_p2(1000) - MIN_LR) > 1e-15:
        return fail("lr_schedule_mismatch", 0)
    recipe = canonical_recipe()
    rhash = recipe_hash(recipe)
    if rhash != AUTHORIZED_RECIPE_SHA:
        return fail("recipe_hash_mismatch", 0, {"got": rhash, "want": AUTHORIZED_RECIPE_SHA})

    sovereignty = json.loads(sovereignty_path.read_text(encoding="utf-8"))
    ledger = json.loads(ledger_path.read_text(encoding="utf-8")) if ledger_path.exists() else {"documents": []}
    excluded_hits = ledger_has_excluded(ledger)
    packed_source_sha = str((sovereignty.get("new_stream") or {}).get("packed_source_sha256") or "")
    seed = int((sovereignty.get("new_stream") or {}).get("seed") or 0)
    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tokenizer_path)
    stream_sha = npy_payload_sha(stream_path) if stream_path.exists() else ""
    p1_sha = npy_payload_sha(p1_npy) if p1_npy.exists() else ""
    refine_sha = npy_payload_sha(refine_npy) if refine_npy.exists() else ""
    exclusions = list(sovereignty.get("exclusions_applied") or [])

    gate = {
        "commander_authorization": authorize,
        "run_id": RUN_ID,
        "parent_sha": parent_sha == PARENT_SHA,
        "tokenizer_sha": tok_sha == TOKENIZER_SHA,
        "stream_sha": stream_sha == SOVEREIGN_STREAM_SHA,
        "packed_source_sha": packed_source_sha == SOVEREIGN_PACKED_SOURCE_SHA,
        "recipe_sha": rhash == AUTHORIZED_RECIPE_SHA,
        "seed_2303": seed == SOVEREIGN_SEED,
        "sovereignty_exclusions": all(doc in exclusions for doc in EXCLUDED_DOCS) and not excluded_hits,
        "tokens_per_step_arithmetic": SEQ_LEN * MICRO_BATCH * GRAD_ACCUM == 4096,
        "cuda_device": bool(torch.cuda.is_available()),
        "fp32": PRECISION == "FP32",
        "tf32_false": TF32 is False,
        "scheduler_parameters": sched["ok"] and WARMUP_STEPS == 25 and MAX_STEPS == 1000,
        "checkpoint_path_writable": True,
    }
    if stream_sha in {FORBIDDEN_P1_STREAM, FORBIDDEN_2302_STREAM} or seed == 2302:
        return fail("FORBIDDEN_STREAM", 0, {"stream_sha": stream_sha, "seed": seed})
    if not all(gate.values()):
        return fail("step0_gate_failed", 0, {"gate": gate, "parent": parent_sha, "tokenizer": tok_sha, "stream": stream_sha})
    if not claude_md.exists():
        return fail("claude_md_missing_from_disk_unexpected", 0)

    baseline = load_baseline(baseline_path)
    if not baseline["hash_ok"]:
        return fail("baseline_sha_mismatch", 0)
    disk0 = disk_guard(ckpt_root)
    lock = acquire_lock(lock_path)
    if not lock["ok"]:
        return fail("conflicting_active_wrim_training_pid", 0, lock)
    if disk0["hard_stop"]:
        release_lock(lock_path)
        return fail("disk_safety_failure", 0, {"disk": disk0})

    disable_tf32()
    seed_training()
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type != "cuda":
        release_lock(lock_path)
        return fail("cuda_required", 0)

    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    stream = np.load(str(stream_path))
    if int(stream.size) != TOKEN_BUDGET:
        release_lock(lock_path)
        return fail("stream_token_count_mismatch", 0, {"n": int(stream.size), "want": TOKEN_BUDGET})
    if hashlib_sha(stream) != stream_sha:
        release_lock(lock_path)
        return fail("stream_sha_reload_mismatch", 0)
    try:
        batches, ignored_targets = slice_p2_batches(stream, MAX_STEPS, MICRO_BATCH, SEQ_LEN)
    except Exception as exc:
        release_lock(lock_path)
        return fail("batch_slice_failure", 0, {"error": str(exc)})
    if ignored_targets > 1:
        release_lock(lock_path)
        return fail("unexpected_ignored_targets", 0, {"ignored": ignored_targets})
    causal = causal_batch_audit(batches, stream)
    if not causal.get("ok") or len(batches) != MAX_STEPS:
        release_lock(lock_path)
        return fail("packing_integrity_failure", 0, {"causal": causal, "n_batches": len(batches)})

    state, coverage = load_model_state_from_safetensors(weights)
    if set(state) != set(expected_torch_keys()):
        release_lock(lock_path)
        return fail("invalid_architecture_or_tensor_shape", 0, {"coverage": coverage})
    model = WRIM0Model()
    model.load_state_dict(state, strict=True)
    n_params = int(sum(p.numel() for p in model.parameters()))
    if n_params != PARAM_COUNT or n_params != RUNTIME_PARAM_COUNT:
        release_lock(lock_path)
        return fail("invalid_architecture_or_tensor_shape", 0, {"n_params": n_params})
    parent_cpu = {k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}
    model.to(device)
    model.freeze_inference()
    c0 = concat_units(encode_rehearsal_val_units(tokenizer, dump_root))
    c1 = concat_units(encode_corpus1_val_units(tokenizer, dump_root))
    frozen_items = baseline["obj"]["items"]
    wrim0_logp: dict[str, torch.Tensor] = {}

    write_json(
        ckpt_root / "parent-pointer.json",
        {
            "kind": "PARENT_POINTER_ONLY",
            "step": 0,
            "parent_id": "WRIM-0",
            "parent_sha256": parent_sha,
            "weights_path": str(weights),
            "not_a_trained_checkpoint": True,
            "optimizer_state_present": False,
            "run_id": RUN_ID,
        },
    )

    print("[p2] step-0 eval before AdamW", flush=True)
    try:
        eval0 = snapshot_eval(
            model=model,
            tokenizer=tokenizer,
            device=device,
            dump_root=dump_root,
            frozen_items=frozen_items,
            wrim0_logp=wrim0_logp,
            c0=c0,
            c1=c1,
            parent_cpu=parent_cpu,
            step=0,
            tokens=0,
            lr=None,
            train_loss=None,
            full_adj=True,
            long_cap=256,
        )
    except torch.cuda.OutOfMemoryError:
        release_lock(lock_path)
        return fail("CUDA_OOM", 0, {"oom_policy": "HARD_ABORT"})
    write_json(evals_dir / "step-0.json", eval0)
    write_json(evals_dir / "step-0.compact.json", compact(eval0))
    if abs(float(eval0["val_loss_corpus0"]) - PARENT_VAL0) > 0.02:
        release_lock(lock_path)
        return fail("step0_val0_did_not_reproduce", 0, {"val0": eval0["val_loss_corpus0"]})
    parent_snap = snapshot_from_compact(compact(eval0))
    d0 = decide(parent_snap, parent_snap)
    write_json(evals_dir / "step-0.stop.json", d0)

    model.enable_training()
    model.to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=lr_p2(1),
        betas=tuple(BETAS),
        eps=EPS,
        weight_decay=WEIGHT_DECAY,
        fused=False,
    )
    adamw_constructed = True
    optimizer_created_at = utc_now()
    print(json.dumps({"AdamW_constructed": True, "at": optimizer_created_at, "lr_step1": lr_p2(1)}), flush=True)

    metrics: list[dict[str, Any]] = []
    evals: dict[int, dict[str, Any]] = {0: eval0}
    ckpts: dict[int, dict[str, Any]] = {0: {"kind": "PARENT_POINTER_ONLY", "parent_sha256": parent_sha}}
    stop_decisions: list[dict[str, Any]] = [{"step": 0, **d0}]
    aborted = False
    abort_reason = None
    halt_kind = None

    def persist_metric(row: dict[str, Any]) -> None:
        metrics.append(row)
        with metrics_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, separators=(",", ":")) + "\n")

    def maybe_eval(step: int, lr: float | None, train_loss: float | None, *, force_full: bool = False) -> dict[str, Any] | None:
        compact_hit = step in COMPACT_CADENCE
        full_hit = step in FULL_CADENCE or force_full
        if not compact_hit and not full_hit:
            return None
        print(f"[p2] eval step {step} compact={compact_hit} full={full_hit}", flush=True)
        ev = snapshot_eval(
            model=model,
            tokenizer=tokenizer,
            device=device,
            dump_root=dump_root,
            frozen_items=frozen_items,
            wrim0_logp=wrim0_logp,
            c0=c0,
            c1=c1,
            parent_cpu=parent_cpu,
            step=step,
            tokens=tokens_seen,
            lr=lr,
            train_loss=train_loss,
            full_adj=full_hit,
            long_cap=256,
        )
        evals[step] = ev
        write_json(evals_dir / f"step-{step}.json", ev)
        write_json(evals_dir / f"step-{step}.compact.json", compact(ev))
        cand = snapshot_from_compact(compact(ev))
        decision = decide(parent_snap, cand)
        decision["step"] = step
        stop_decisions.append(decision)
        write_json(evals_dir / f"step-{step}.stop.json", decision)
        return decision

    try:
        for step in range(1, MAX_STEPS + 1):
            if step > MAX_STEPS:
                aborted = True
                abort_reason = "optimizer_step_1001_forbidden"
                halt_kind = "HARD_ABORT"
                write_json(ckpt_root / "ABORT.json", abort_body(reason=abort_reason, step=step))
                break
            disk = disk_guard(ckpt_root)
            if disk["hard_stop"]:
                aborted = True
                abort_reason = "disk_safety_failure"
                halt_kind = "HARD_ABORT"
                write_json(ckpt_root / "ABORT.json", abort_body(reason=abort_reason, step=step, extra={"disk": disk}))
                break
            lr = lr_p2(step)
            for pg in optimizer.param_groups:
                pg["lr"] = lr
            x_np, y_np = batches[step - 1]
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            t0 = time.perf_counter()
            optimizer.zero_grad(set_to_none=True)
            logits = model(x)
            loss = F.cross_entropy(logits.reshape(-1, VOCAB_SIZE), y.reshape(-1), ignore_index=IGNORE_INDEX)
            if not bool(torch.isfinite(loss).item()):
                aborted = True
                abort_reason = "NaN_or_Inf"
                halt_kind = "HARD_ABORT"
                write_json(ckpt_root / "ABORT.json", abort_body(reason=abort_reason, step=step, extra={"loss": str(loss)}))
                break
            loss.backward()
            grads_finite = True
            grad_sq = 0.0
            for p in model.parameters():
                if p.grad is None or not torch.isfinite(p.grad).all():
                    grads_finite = False
                    break
                grad_sq += float(p.grad.detach().float().pow(2).sum().item())
            if not grads_finite:
                aborted = True
                abort_reason = "NaN_or_Inf"
                halt_kind = "HARD_ABORT"
                write_json(ckpt_root / "ABORT.json", abort_body(reason=abort_reason, step=step))
                break
            grad_norm = math.sqrt(grad_sq)
            before = [p.detach().clone() for p in model.parameters()]
            clip = torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP)
            clipped = bool(float(clip) > GRAD_CLIP + 1e-12) or grad_norm > GRAD_CLIP
            optimizer.step()
            tokens_seen += TOKENS_PER_STEP
            if tokens_seen > TOKEN_BUDGET:
                aborted = True
                abort_reason = "token_budget_exceeded"
                halt_kind = "HARD_ABORT"
                write_json(ckpt_root / "ABORT.json", abort_body(reason=abort_reason, step=step, extra={"tokens_seen": tokens_seen}))
                break
            delta_sq = 0.0
            for p, b in zip(model.parameters(), before):
                delta_sq += float((p.detach() - b).float().pow(2).sum().item())
            update_norm = math.sqrt(delta_sq)
            elapsed = time.perf_counter() - t0
            last_valid_step = step
            persist_metric(
                {
                    "step": step,
                    "tokens": tokens_seen,
                    "loss": float(loss.item()),
                    "lr": lr,
                    "grad_norm": grad_norm,
                    "clip": float(clip),
                    "clipped": clipped,
                    "update_norm": update_norm,
                    "elapsed_s": elapsed,
                    "timestamp": utc_now(),
                }
            )
            if step % 25 == 0 or step <= 10:
                print(json.dumps({"step": step, "loss": float(loss.item()), "lr": lr, "grad_norm": grad_norm, "tokens": tokens_seen}), flush=True)
            save_w = step in WEIGHT_SAVE_STEPS
            save_o = step in OPTIMIZER_SAVE_STEPS
            if save_w:
                try:
                    ckpts[step] = save_p2_ckpt(
                        ckpt_root / f"step-{step}",
                        model,
                        optimizer,
                        step,
                        tokens_seen,
                        lr,
                        {"loss": float(loss.item()), "grad_norm": grad_norm, "clipped": clipped, "timestamp": utc_now()},
                        save_opt=save_o,
                    )
                except Exception as exc:
                    aborted = True
                    abort_reason = "checkpoint_write_hash_failure"
                    halt_kind = "HARD_ABORT"
                    write_json(ckpt_root / "ABORT.json", abort_body(reason=abort_reason, step=step, extra={"error": str(exc)}))
                    break
            decision = maybe_eval(step, lr, float(loss.item()))
            if decision is not None and not decision.get("next_optimizer_step_allowed"):
                halt_kind = decision.get("decision")
                abort_reason = decision.get("hard_abort_reason") or decision.get("decision")
                if step < MAX_STEPS or halt_kind == "HARD_ABORT":
                    aborted = True
                    artifact = ckpt_root / str(decision.get("artifact") or "STOP.json")
                    write_json(artifact, abort_body(reason=str(abort_reason), step=step, extra={"stop": decision, "eval": compact(evals[step])}))
                    if step not in ckpts:
                        ckpts[step] = save_p2_ckpt(
                            ckpt_root / f"step-{step}-halt",
                            model,
                            optimizer,
                            step,
                            tokens_seen,
                            lr,
                            {"halt": True, "decision": decision.get("decision"), "timestamp": utc_now()},
                            save_opt=False,
                        )
                    if halt_kind != "HARD_ABORT" or decision.get("hard_abort_reason") not in {"NaN_or_Inf"}:
                        if step not in FULL_CADENCE:
                            try:
                                maybe_eval(step, lr, float(loss.item()), force_full=True)
                            except Exception as exc:
                                print(json.dumps({"terminal_full_eval_error": str(exc)}), flush=True)
                    break
                break
        if (not aborted) and last_valid_step == MAX_STEPS and MAX_STEPS not in evals:
            maybe_eval(MAX_STEPS, lr_p2(MAX_STEPS), metrics[-1]["loss"] if metrics else None)
    except torch.cuda.OutOfMemoryError:
        aborted = True
        abort_reason = "CUDA_OOM"
        halt_kind = "HARD_ABORT"
        write_json(ckpt_root / "ABORT.json", abort_body(reason=abort_reason, step=last_valid_step, extra={"oom_policy": "HARD_ABORT"}))
    except KeyboardInterrupt:
        interrupted = True
        aborted = True
        abort_reason = "manual_interruption"
        halt_kind = "INTERRUPTED"
        write_json(ckpt_root / "ABORT.json", abort_body(reason=abort_reason, step=last_valid_step))
    except Exception as exc:
        interrupted = True
        aborted = True
        abort_reason = "runtime_integrity_failure"
        halt_kind = "INTERRUPTED"
        write_json(ckpt_root / "ABORT.json", abort_body(reason=abort_reason, step=last_valid_step, extra={"error": str(exc)}))
    finally:
        release_lock(lock_path)

    if last_valid_step > 0 and last_valid_step not in ckpts:
        try:
            ckpts[last_valid_step] = save_p2_ckpt(
                ckpt_root / f"step-{last_valid_step}-terminal",
                model,
                optimizer if adamw_constructed else None,
                last_valid_step,
                tokens_seen,
                lr_p2(last_valid_step) if last_valid_step >= 1 else None,
                {"terminal": True, "timestamp": utc_now()},
                save_opt=last_valid_step in OPTIMIZER_SAVE_STEPS,
            )
        except Exception as exc:
            print(json.dumps({"terminal_ckpt_error": str(exc)}), flush=True)

    analysis = classify_p2(
        interrupted=interrupted,
        aborted=aborted,
        abort_reason=abort_reason,
        last_valid_step=last_valid_step,
        stop_decisions=stop_decisions,
        evals=evals,
        eval0=eval0,
    )
    terminal_step = last_valid_step if last_valid_step in evals else (max(evals) if evals else 0)
    terminal_ev = evals.get(terminal_step) or eval0
    lr_traj = [{"step": m["step"], "lr": m["lr"]} for m in metrics]
    compact_traj = [compact(evals[s]) for s in sorted(evals)]
    full_traj = [compact(evals[s]) for s in sorted(evals) if s in FULL_CADENCE or ((evals[s].get("adjudication") is not None))]

    def series(key: str) -> list[dict[str, Any]]:
        out = []
        for s in sorted(evals):
            row = compact(evals[s])
            out.append({"step": s, "value": row.get(key)})
        return out

    payload = {
        "ok": (not interrupted) and last_valid_step > 0,
        "kind": KIND,
        "run_id": RUN_ID,
        "recipe_id": RECIPE_ID,
        "recipe_sha256": rhash,
        "commander_authorization": "AUTHORIZED",
        "P2_AUTHORIZED": True,
        "P2_EXECUTION_STARTED": True,
        "AdamW_constructed": adamw_constructed,
        "optimizer_created_at": optimizer_created_at,
        "optimizer": {
            "name": "AdamW",
            "fused": False,
            "fresh": True,
            "betas": BETAS,
            "eps": EPS,
            "weight_decay": WEIGHT_DECAY,
            "grad_clip": GRAD_CLIP,
            "grad_clip_type": "global_l2_norm",
            "grad_clip_when": "after_backward_before_optimizer_step",
            "grad_scaler": False,
        },
        "peak_lr": PEAK_LR,
        "min_lr": MIN_LR,
        "warmup_steps": WARMUP_STEPS,
        "scheduler": "warmup_cosine_1_indexed",
        "scheduler_formula": FORMULA,
        "precision": PRECISION,
        "tf32": TF32,
        "sequence_length": SEQ_LEN,
        "micro_batch": MICRO_BATCH,
        "grad_accum": GRAD_ACCUM,
        "effective_tokens_per_step": TOKENS_PER_STEP,
        "ignored_causal_targets": ignored_targets,
        "resume_policy": "RESTART_REQUIRED_NOT_RESUMABLE",
        "oom_policy": "HARD_ABORT",
        "rng_policy": {
            "python_seed": RUNTIME_SEED,
            "numpy_seed": RUNTIME_SEED,
            "torch_cpu_seed": RUNTIME_SEED,
            "torch_cuda_seed": RUNTIME_SEED,
            "eval_seed": EVAL_SEED,
            "packing_seed": SOVEREIGN_SEED,
            "cudnn_deterministic": True,
            "cudnn_benchmark": False,
            "reproducibility_class": "STATISTICALLY_REPRODUCIBLE",
        },
        "packer": PACKER_MODE,
        "packer_version": PACKER_VERSION,
        "start_timestamp": started,
        "end_timestamp": utc_now(),
        "elapsed_s": round(time.perf_counter() - t_run0, 3),
        "optimizer_steps": last_valid_step,
        "optimizer_steps_this_pass": last_valid_step,
        "tokens_trained": tokens_seen,
        "terminal_checkpoint": ckpts.get(last_valid_step) or ckpts.get(max(ckpts)) if ckpts else None,
        "terminal_reason": abort_reason or ("completed_1000" if last_valid_step == MAX_STEPS else "incomplete"),
        "halt_kind": halt_kind,
        "parent_identity": "WRIM-0",
        "parent_sha256": parent_sha,
        "tokenizer_identity": "WR-TOKENIZER-0",
        "tokenizer_sha256": tok_sha,
        "seed": seed,
        "stream_path": str(stream_path),
        "stream_sha256": stream_sha,
        "packed_source_sha256": packed_source_sha,
        "forbidden_streams_untouched": {
            "historical_p1": p1_sha,
            "seed_2302": refine_sha,
            "seed_2302_not_trained": True,
            "historical_p1_not_trained": True,
        },
        "sovereignty_policy_proof": {
            "exclusions_applied": exclusions,
            "present_in_ledger": excluded_hits,
            "claude_md_on_disk_untouched": claude_md.exists(),
            "training_eligibility_layer": True,
        },
        "step0_gate": gate,
        "step0_baseline": compact(eval0),
        "lr_trajectory": lr_traj,
        "compact_eval_trajectory": compact_traj,
        "full_eval_trajectory": full_traj,
        "looping_trajectory": series("dev_looping"),
        "unique128_trajectory": series("dev_unique_128"),
        "unique256_trajectory": series("dev_unique_256"),
        "coherence_trajectory": series("dev_unique"),
        "val0_trajectory": series("val0"),
        "val1_trajectory": series("val1"),
        "dnll_trajectory": series("dnll"),
        "kl_trajectory": series("kl"),
        "collapse_findings": series("dev_collapsed"),
        "stability_findings": {
            "parameter_displacement_terminal": (terminal_ev.get("parameter_displacement") if terminal_ev else None),
            "grad_clip_events": int(sum(1 for m in metrics if m.get("clipped"))),
            "nan_or_inf": abort_reason == "NaN_or_Inf",
        },
        "memorization_findings": {str(s): memorization_scan(evals[s]) for s in sorted(evals)},
        "stop_policy_version": STOP_POLICY_VERSION,
        "stop_policy_unchanged": True,
        "stop_policy_decisions": stop_decisions,
        "checkpoint_artifacts": ckpts,
        "best_checkpoint_for_analysis_only": best_analysis_checkpoint(evals, ckpts),
        "generation_conclusion": analysis["generation_conclusion"],
        "retention_conclusion": analysis["retention_conclusion"],
        "scientific_conclusion": analysis["scientific_conclusion"],
        "transient_vs_sustained": analysis["transient_vs_sustained"],
        "p3_merits_consideration": analysis["p3_merits_consideration"],
        "final_classification": analysis["final_classification"],
        "TRAINING_AUTHORIZATION": "OFF",
        "P3_AUTHORIZED": False,
        "STAGE3B_AUTHORIZATION": "NO",
        "STAGE3B_EXECUTION_READINESS": False,
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "promotion_candidate": False,
        "nothing_pushed": True,
        "nothing_deployed": True,
        "corpus_mutated": False,
        "tokenizer_mutated": False,
        "stream_mutated": False,
        "hardware": gpu_stats(),
        "device": str(device),
        "step_metrics": metrics,
    }
    write_json(report_path, payload)
    write_json(ckpt_root / "run-manifest.json", {k: payload.get(k) for k in payload if k != "step_metrics"})
    print(
        json.dumps(
            {
                "ok": payload["ok"],
                "final_classification": payload["final_classification"],
                "optimizer_steps": last_valid_step,
                "tokens_trained": tokens_seen,
                "terminal_reason": payload["terminal_reason"],
                "recipe_sha256": rhash,
                "stream_sha256": stream_sha,
                "TRAINING_AUTHORIZATION": "OFF",
                "AdamW_constructed": adamw_constructed,
            },
            indent=2,
        ),
        flush=True,
    )
    return payload


def hashlib_sha(stream: np.ndarray) -> str:
    import hashlib

    return hashlib.sha256(np.ascontiguousarray(stream).tobytes()).hexdigest()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--weights", required=True)
    p.add_argument("--tokenizer", required=True)
    p.add_argument("--dump-root", required=True)
    p.add_argument("--baseline", required=True)
    p.add_argument("--sovereignty-report", required=True)
    p.add_argument("--stream", required=True)
    p.add_argument("--ledger", required=True)
    p.add_argument("--p1-npy", required=True)
    p.add_argument("--refine-npy", required=True)
    p.add_argument("--claude-md", required=True)
    p.add_argument("--report", required=True)
    p.add_argument("--ckpt-dir", required=True)
    p.add_argument("--authorize-wrim1-run-000005", action="store_true")
    args = p.parse_args()
    ckpt = Path(args.ckpt_dir)
    if "P2-INCOMPLETE-CONFIG" in str(ckpt) or "P2-RECIPE" == Path(args.ckpt_dir).name:
        print(json.dumps({"ok": False, "error": "refuses_to_overwrite_prior_p2_artifacts"}), flush=True)
        return 2
    out = run_p2(
        weights=Path(args.weights),
        tokenizer_path=Path(args.tokenizer),
        dump_root=Path(args.dump_root),
        baseline_path=Path(args.baseline),
        sovereignty_path=Path(args.sovereignty_report),
        stream_path=Path(args.stream),
        ledger_path=Path(args.ledger),
        p1_npy=Path(args.p1_npy),
        refine_npy=Path(args.refine_npy),
        claude_md=Path(args.claude_md),
        report_path=Path(args.report),
        ckpt_root=ckpt,
        authorize=bool(args.authorize_wrim1_run_000005),
    )
    if int(out.get("optimizer_steps") or 0) > 1000:
        return 3
    if Path(ckpt / "step-1001").exists():
        return 3
    if out.get("TRAINING_AUTHORIZATION") != "OFF":
        return 1
    if out.get("stream_sha256") in {FORBIDDEN_P1_STREAM, FORBIDDEN_2302_STREAM}:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
