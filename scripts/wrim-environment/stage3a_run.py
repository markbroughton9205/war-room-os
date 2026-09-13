"""WRIM1-RUN-000003 STAGE3A controlled confirmation run.

Exactly 50 AdamW steps. No step 51. No STAGE3B. No promotion.
"""
from __future__ import annotations

import ctypes
import hashlib
import json
import math
import os
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from safetensors.torch import load_file, save_file
from tokenizers import Tokenizer

from experiment_pack import encode_raw_families, genesis_token_audit, pack_train_stream
from phase2_grid import (
    annotate_stream,
    diagnostic0_snapshot,
    hard_stop_decision,
    parameter_displacement,
    step_token_contrib,
)
from safetensors_model import load_model_state_from_safetensors
from stage1_pack import causal_batch_audit, slice_contiguous_batches
from stage2_eval import greedy_generate, load_diagnostic_items, load_retention_items, score_retention
from stage2_pack import encode_corpus1_val_units, encode_rehearsal_val_units
from stage2 import collect_optimizer_tensors
from stage3_eval_baseline import (
    concat_units,
    continuation_metrics,
    encode_prompt_ids,
    extract_json_blob,
    measure_val_loss,
    score_item,
    teacher_force_nll_kl,
)
from stage3_eval_items import CATEGORIES
from stage3_runtime import (
    ADAMW,
    ARCHITECTURE,
    BASELINE_SHA,
    CLASSIFICATION,
    SUITE_ID,
    DISK_STOP_GB,
    MAX_AUTHORIZED_OPTIMIZER_STEPS,
    MICRO_BATCH,
    PARAM_COUNT,
    PARENT_SHA,
    PRECISION,
    REVIEW_BANDS,
    RUN_ID,
    SEED,
    SEGMENT_A,
    SEQ_LEN,
    STAGE3_AUTHORIZATION,
    STAGE3A_STEPS,
    STAGE3A_TOKEN_BUDGET,
    STAGE3B_AUTHORIZATION,
    SUITE_SHA,
    TF32,
    TOKENIZER_SHA,
    TOKENS_PER_STEP,
    TRAINING_AUTHORIZATION,
    abort_payload,
    authorization_gate,
    disk_guard,
    parent_pointer,
    run_manifest_template,
    utc_now,
    write_abort,
    write_json,
)
from stage3_schedule import lr_stage3a
from wrim_g20m import VOCAB_SIZE, WRIM0Model, expected_torch_keys


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


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
        torch.backends.cudnn.deterministic = True
    if hasattr(torch, "set_float32_matmul_precision"):
        torch.set_float32_matmul_precision("highest")


def load_suite(path: Path) -> dict[str, Any]:
    obj = json.loads(path.read_text(encoding="utf-8"))
    items = obj.get("items") or []
    canonical = json.dumps(
        {"suite_id": obj.get("suite_id"), "suite_version": obj.get("suite_version"), "items": items},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    recomputed = sha256_text(canonical)
    cats: dict[str, int] = {}
    for it in items:
        cats[str(it.get("category"))] = cats.get(str(it.get("category")), 0) + 1
    return {
        "obj": obj,
        "n_items": len(items),
        "categories": cats,
        "stored_hash": obj.get("suite_hash"),
        "recomputed_hash": recomputed,
        "hash_ok": obj.get("suite_hash") == SUITE_SHA and recomputed == SUITE_SHA,
        "inventory_ok": len(items) == 35 and obj.get("suite_id") == SUITE_ID and len(cats) == 7 and all(v == 5 for v in cats.values()),
    }


def load_baseline(path: Path) -> dict[str, Any]:
    raw = path.read_text(encoding="utf-8")
    normalized = raw.replace("\r\n", "\n")
    digest = sha256_text(normalized)
    obj = json.loads(raw)
    self_kl = obj.get("self_kl") or {}
    return {
        "obj": obj,
        "sha256": digest,
        "hash_ok": digest == BASELINE_SHA and obj.get("kind") == "WRIM0_STAGE3_SUITE_BASELINE",
        "self_kl_pass": bool(self_kl.get("pass") is True and self_kl.get("mean") == 0 and self_kl.get("max") == 0),
        "n_items": len(obj.get("items") or []),
        "rewritten": False,
    }

STEP0_NLL_TOL = 1e-3
STEP0_KL_TOL = 1e-5
VAL_TOL = 5e-5


def pid_alive(pid: int) -> bool:
    if not pid:
        return False
    try:
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
        if handle:
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        return False
    except Exception:
        return False


def acquire_lock(lock_path: Path) -> dict[str, Any]:
    if lock_path.exists():
        try:
            prev = json.loads(lock_path.read_text(encoding="utf-8"))
        except Exception:
            prev = {}
        if pid_alive(int(prev.get("pid") or 0)):
            return {"ok": False, "reason": "conflicting_active_wrim_training_pid", "existing": prev}
    payload = {"pid": os.getpid(), "run_id": RUN_ID, "segment": SEGMENT_A, "utc": utc_now()}
    write_json(lock_path, payload)
    return {"ok": True, "lock": payload}


def release_lock(lock_path: Path) -> None:
    try:
        if lock_path.exists():
            lock_path.unlink()
    except OSError:
        pass


def gpu_stats() -> dict[str, Any]:
    if not torch.cuda.is_available():
        return {"available": False}
    out: dict[str, Any] = {
        "available": True,
        "name": torch.cuda.get_device_name(0),
        "memory_allocated_gb": round(torch.cuda.memory_allocated() / (1024**3), 4),
        "memory_reserved_gb": round(torch.cuda.memory_reserved() / (1024**3), 4),
        "max_memory_allocated_gb": round(torch.cuda.max_memory_allocated() / (1024**3), 4),
    }
    try:
        out["utilization"] = int(torch.cuda.utilization())
    except Exception:
        out["utilization"] = None
    return out


def rng_snapshot() -> dict[str, Any]:
    payload: dict[str, Any] = {
        "torch": torch.random.get_rng_state().cpu().numpy().tobytes().hex(),
        "numpy": np.random.get_state()[1].tolist()[:16],
        "numpy_pos": int(np.random.get_state()[2]),
        "python_seed": SEED,
    }
    if torch.cuda.is_available():
        payload["cuda"] = torch.cuda.get_rng_state().cpu().numpy().tobytes().hex()
    return payload


def cap_eval_overlay(model: WRIM0Model, tokenizer: Tokenizer, device: torch.device, dump_root: Path) -> dict[str, Any]:
    items = load_retention_items(dump_root)
    rows = []
    passed = 0
    for it in items:
        prompt = it.get("prompt") or it.get("input") or it.get("generation_prompt") or ""
        gen = greedy_generate(model, tokenizer, prompt, device, max_new=32)
        binary = score_retention(gen, it.get("expected") or {})
        if binary:
            passed += 1
        rows.append(
            {
                "evalId": it.get("evalId") or it.get("id"),
                "binary_pass": binary,
                "unique_ratio": gen.get("unique_ratio"),
                "collapsed": gen.get("collapsed"),
                "special_loop": gen.get("special_loop"),
            }
        )
    return {
        "status": "COMPATIBILITY_ONLY",
        "replaced": False,
        "primary": False,
        "n_items": len(rows),
        "historical_binary": f"{passed}/{len(rows)}" if rows else "0/0",
        "historical_pass_count": passed,
        "items": rows,
    }


def d0_json_probe(model: WRIM0Model, tokenizer: Tokenizer, device: torch.device, dump_root: Path) -> dict[str, Any]:
    items = load_diagnostic_items(dump_root)
    d0 = next((x for x in items if x.get("id") == "d0-json"), None)
    if not d0:
        return {"status": "COMPATIBILITY_ONLY", "id": "d0-json", "json_valid": False, "missing": True}
    gen = greedy_generate(model, tokenizer, d0["input"], device, max_new=32)
    blob = extract_json_blob((d0.get("input") or "") + (gen.get("continuation") or ""))
    valid = False
    if blob:
        try:
            json.loads(blob)
            valid = True
        except Exception:
            valid = False
    return {
        "status": "COMPATIBILITY_ONLY",
        "id": "d0-json",
        "json_valid": valid,
        "collapsed": gen.get("collapsed"),
        "special_loop": gen.get("special_loop"),
        "note": "Canonical DIAGNOSTIC-0 probe only.",
    }


def evaluate_candidate(
    *,
    model: WRIM0Model,
    tokenizer: Tokenizer,
    device: torch.device,
    dump_root: Path,
    suite_items: list[dict[str, Any]],
    frozen_items: list[dict[str, Any]],
    wrim0_logp: dict[str, torch.Tensor],
    parent_cpu: dict[str, torch.Tensor],
    c0: np.ndarray,
    c1: np.ndarray,
    greedy_256: bool,
    step: int,
    train_loss: float | None,
    tokens: int,
    lr: float | None,
) -> dict[str, Any]:
    was = model.training
    model.eval()
    v0 = measure_val_loss(model, c0, device)
    v1 = measure_val_loss(model, c1, device)
    frozen_by_id = {r["item_id"]: r for r in frozen_items}
    rows = []
    deltas = []
    kls = []
    for it in suite_items:
        prompt = it["prompt_text"]
        prompt_ids = encode_prompt_ids(tokenizer, prompt)
        frozen = frozen_by_id[it["item_id"]]
        frozen_ids = list((frozen.get("historical_32") or {}).get("new_ids") or [])
        gen32 = greedy_generate(model, tokenizer, prompt, device, max_new=32)
        gen256 = greedy_generate(model, tokenizer, prompt, device, max_new=256) if greedy_256 else None
        primary = gen256 if greedy_256 and int(it.get("max_new_tokens") or 32) >= 256 else gen32
        m32 = continuation_metrics(gen32)
        m256 = continuation_metrics(gen256) if gen256 else None
        parent_logp = wrim0_logp.get(it["item_id"])
        bundle = teacher_force_nll_kl(model, prompt_ids, frozen_ids, device, parent_logp)
        if parent_logp is None and bundle.get("log_softmax") is not None:
            wrim0_logp[it["item_id"]] = bundle["log_softmax"]
        frozen_nll = float(frozen.get("wrim0_anchor_nll_32"))
        delta = float(bundle["nll"] - frozen_nll) if math.isfinite(bundle["nll"]) else float("nan")
        deltas.append(delta)
        if bundle["kl"] is not None and math.isfinite(bundle["kl"]):
            kls.append(float(bundle["kl"]))
        scores = score_item(it, primary, gen32, gen256 or gen32)
        row = {
            "item_id": it["item_id"],
            "category": it["category"],
            "wrim0_anchor_nll_32": bundle["nll"],
            "wrim0_anchor_nll_delta": delta,
            "kl_wrim0_to_candidate": bundle["kl"],
            "frozen_nll": frozen_nll,
            "frozen_token_id_sha256": (frozen.get("historical_32") or {}).get("token_id_sha256"),
            "greedy_32_token_id_sha256": m32.get("token_id_sha256"),
            "historical_32": {k: v for k, v in m32.items() if k != "new_ids"} | {"new_ids": m32["new_ids"]},
            "category_scores": scores,
        }
        if m256:
            row["descriptive_256"] = {k: v for k, v in m256.items() if k != "new_ids"} | {"new_ids": m256["new_ids"]}
        rows.append(row)
    by_cat: dict[str, list[dict[str, Any]]] = {c: [] for c in CATEGORIES}
    for row in rows:
        by_cat[row["category"]].append(row)

    def cat_agg(cat_rows: list[dict[str, Any]]) -> dict[str, Any]:
        json_valid = [r["category_scores"].get("json_valid") for r in cat_rows if "json_valid" in r["category_scores"]]
        spec_key = "descriptive_256" if greedy_256 else "historical_32"
        spec = [float((r.get(spec_key) or {}).get("special_rate_0_8") or 0.0) for r in cat_rows]
        coll = [bool((r.get(spec_key) or {}).get("collapsed")) for r in cat_rows]
        inst = [r["category_scores"] for r in cat_rows]
        return {
            "n": len(cat_rows),
            "mean_anchor_nll_delta": float(sum(float(r["wrim0_anchor_nll_delta"]) for r in cat_rows) / max(1, len(cat_rows))),
            "mean_kl": float(sum(float(r["kl_wrim0_to_candidate"] or 0.0) for r in cat_rows) / max(1, len(cat_rows))),
            "mean_special_rate": float(sum(spec) / max(1, len(spec))),
            "n_collapsed": int(sum(coll)),
            "json_valid_count": int(sum(1 for x in json_valid if x)),
            "json_n": len(json_valid),
            "instruction_flags": inst if cat_rows and cat_rows[0]["category"] == "INSTRUCTION_FOLLOWING" else None,
        }

    cap = cap_eval_overlay(model, tokenizer, device, dump_root)
    d0 = diagnostic0_snapshot(model, tokenizer, device, dump_root)
    d0_json = d0_json_probe(model, tokenizer, device, dump_root)
    disp = parameter_displacement(model, parent_cpu)
    if was:
        model.train()
        for p in model.parameters():
            p.requires_grad_(True)
    mean_delta = float(sum(deltas) / max(1, len(deltas)))
    mean_kl = float(sum(kls) / max(1, len(kls))) if kls else None
    return {
        "step": step,
        "tokens": tokens,
        "lr": lr,
        "train_loss": train_loss,
        "val_loss_corpus0": v0,
        "val_loss_corpus1": v1,
        "mean_wrim0_anchor_nll_delta": mean_delta,
        "mean_kl_wrim0_to_candidate": mean_kl,
        "historical_pass_count": cap.get("historical_pass_count"),
        "historical_total": cap.get("n_items"),
        "historical_binary": cap.get("historical_binary"),
        "retention_special_loops": int(sum(1 for r in rows if (r.get("historical_32") or {}).get("special_loop"))),
        "items": rows,
        "category_aggregates": {c: cat_agg(by_cat[c]) for c in CATEGORIES},
        "cap_eval_0": cap,
        "diagnostic0": d0,
        "diagnostic_0_json": d0_json,
        "parameter_displacement": disp,
        "special_token_mean_rate": float(
            sum(float((r.get("descriptive_256") or r.get("historical_32") or {}).get("special_rate_0_8") or 0.0) for r in rows) / max(1, len(rows))
        ),
        "n_collapsed": int(sum(1 for r in rows if (r.get("descriptive_256") or r.get("historical_32") or {}).get("collapsed"))),
    }


def review_band_crossings(ev: dict[str, Any], frozen_special: float) -> list[str]:
    bands = REVIEW_BANDS["stage3a_step_50"]
    hits = []
    dnll = ev.get("mean_wrim0_anchor_nll_delta")
    kl = ev.get("mean_kl_wrim0_to_candidate")
    v0 = ev.get("val_loss_corpus0")
    v1 = ev.get("val_loss_corpus1")
    if dnll is not None and math.isfinite(float(dnll)) and float(dnll) >= bands["anchor_dnll_review_at_or_above"]:
        hits.append(f"anchor_dnll {dnll} >= {bands['anchor_dnll_review_at_or_above']}")
    if kl is not None and math.isfinite(float(kl)) and float(kl) >= bands["kl_review_at_or_above"]:
        hits.append(f"kl {kl} >= {bands['kl_review_at_or_above']}")
    if v0 is not None and float(v0) >= bands["val0_review_at_or_above"]:
        hits.append(f"val0 {v0} >= {bands['val0_review_at_or_above']}")
    if v1 is not None and float(v1) >= bands["val1_review_at_or_above"]:
        hits.append(f"val1 {v1} >= {bands['val1_review_at_or_above']}")
    aggs = ev.get("category_aggregates") or {}
    for cat, row in aggs.items():
        if int(row.get("n_collapsed") or 0) >= 5:
            hits.append(f"whole-category collapse {cat}")
        if float(row.get("mean_special_rate") or 0.0) > frozen_special + 0.05:
            hits.append(f"special-token rate {cat} {row.get('mean_special_rate')}")
    return hits


def classify_stage3a(*, aborted: bool, abort_reason: str | None, step50: dict[str, Any] | None, crossings: list[str], hard_stop: bool) -> str:
    if aborted and hard_stop:
        if abort_reason and "runtime" in abort_reason.lower():
            return "E. RUNTIME_INTEGRITY_FAILURE"
        return "D. HARD_STOP_ABORTED"
    if aborted:
        return "D. HARD_STOP_ABORTED"
    if not step50:
        return "F. INCONCLUSIVE"
    cat_hits = [c for c in crossings if "collapse" in c or "category" in c]
    cont_hits = [c for c in crossings if c.startswith("anchor_dnll") or c.startswith("kl") or c.startswith("val")]
    if cat_hits and not cont_hits:
        return "C. REVIEW_REQUIRED_CATEGORY_REGRESSION"
    if cont_hits:
        return "B. REVIEW_REQUIRED_CONTINUOUS_DRIFT"
    if crossings:
        return "B. REVIEW_REQUIRED_CONTINUOUS_DRIFT"
    return "A. HEALTHY_FOR_CONTINUATION_REVIEW"


def apply_hard_stop(step0: dict[str, Any], now: dict[str, Any], history: list[dict[str, Any]]) -> tuple[bool, str | None, str | None]:
    stop, reason, warning = hard_stop_decision(step0, now, history)
    if stop and reason and "special-token loop" in reason:
        d0_now = now.get("diagnostic0") or {}
        d0_0 = step0.get("diagnostic0") or {}
        loops_now = int(d0_now.get("special_token_loops") or 0)
        loops_0 = int(d0_0.get("special_token_loops") or 0)
        ret_now = int(now.get("retention_special_loops") or 0)
        ret_0 = int(step0.get("retention_special_loops") or 0)
        if loops_now <= loops_0 and ret_now <= ret_0:
            note = f"parent-baseline special loops unchanged ({reason})"
            return False, None, warning or note
    return stop, reason, warning


def save_weights(ckpt_dir: Path, model: WRIM0Model, step: int, tokens: int) -> dict[str, Any]:
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    model_cpu = {k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}
    save_hash = tensors_sha256(model_cpu)
    path = ckpt_dir / "model.safetensors"
    save_file(model_cpu, str(path))
    reload_hash = tensors_sha256(load_file(str(path)))
    if reload_hash != save_hash:
        raise RuntimeError("checkpoint corruption")
    return {
        "model_path": str(path),
        "model_sha256": sha256_file(path),
        "tensors_sha256": save_hash,
        "reload_ok": True,
        "step": step,
        "tokens": tokens,
    }


def save_continuity(ckpt_dir: Path, model: WRIM0Model, optimizer: torch.optim.AdamW, step: int, tokens: int, extra: dict[str, Any]) -> dict[str, Any]:
    meta = save_weights(ckpt_dir, model, step, tokens)
    opt_path = ckpt_dir / "optimizer.safetensors"
    save_file(collect_optimizer_tensors(optimizer, model), str(opt_path))
    meta["optimizer_path"] = str(opt_path)
    meta["optimizer_sha256"] = sha256_file(opt_path)
    write_json(ckpt_dir / "scheduler.json", {"step": step, "lr": lr_stage3a(step), "formula": "STAGE3A exact 1-indexed warmup-cosine", "next_unauthorized_step": 51})
    write_json(ckpt_dir / "rng.json", rng_snapshot())
    write_json(ckpt_dir / "packing_cursor.json", extra)
    return meta


def run_stage3a(
    *,
    weights: Path,
    tokenizer_path: Path,
    dump_root: Path,
    suite_path: Path,
    baseline_path: Path,
    report_path: Path,
    ckpt_root: Path,
) -> dict[str, Any]:
    started = utc_now()
    t_run0 = time.perf_counter()
    ckpt_root.mkdir(parents=True, exist_ok=True)
    lock_path = ckpt_root / "RUN.lock"
    evals_dir = ckpt_root / "evals"
    evals_dir.mkdir(parents=True, exist_ok=True)
    metrics_path = ckpt_root / "metrics.jsonl"

    gate = authorization_gate(requested_mode="stage3a")
    if not gate["allowed"]:
        payload = abort_payload(reason="TRAINING_DENIED", step=0, extra={"gate": gate})
        write_abort(ckpt_root, payload)
        write_json(report_path, payload)
        return payload

    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tokenizer_path)
    suite = load_suite(suite_path)
    baseline = load_baseline(baseline_path)
    disk0 = disk_guard(ckpt_root)
    lock = acquire_lock(lock_path)
    mismatches = []
    if parent_sha != PARENT_SHA:
        mismatches.append("parent_sha")
    if tok_sha != TOKENIZER_SHA:
        mismatches.append("tokenizer_sha")
    if not suite["hash_ok"]:
        mismatches.append("suite_sha")
    if not baseline["hash_ok"]:
        mismatches.append("baseline_sha")
    if not suite.get("inventory_ok"):
        mismatches.append("suite_inventory")
    if not baseline.get("self_kl_pass"):
        mismatches.append("baseline_self_kl")
    if STAGE3B_AUTHORIZATION != "NO":
        mismatches.append("stage3b_authorization")
    stage3b_dir = ckpt_root.parent / "STAGE3B"
    if stage3b_dir.exists() and any(stage3b_dir.glob("**/metrics.jsonl")):
        mismatches.append("stage3b_already_started")
    if not lock["ok"]:
        payload = abort_payload(reason="conflicting_active_wrim_training_pid", step=0, extra=lock)
        write_abort(ckpt_root, payload)
        write_json(report_path, payload)
        return payload
    if mismatches:
        release_lock(lock_path)
        payload = abort_payload(reason="pre_run_sha_or_auth_mismatch", step=0, extra={"mismatches": mismatches})
        write_abort(ckpt_root, payload)
        write_json(report_path, payload)
        return payload
    if disk0["hard_stop"]:
        release_lock(lock_path)
        payload = abort_payload(reason="disk_below_32GB", step=0, extra={"disk": disk0})
        write_abort(ckpt_root, payload)
        write_json(report_path, payload)
        return payload

    disable_tf32()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)
        torch.cuda.reset_peak_memory_stats()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    raw_families = encode_raw_families(dump_root, tokenizer)
    packed = pack_train_stream(raw_families, tokenizer, strategy="NATURAL_BASELINE", seed=SEED, dump_root=dump_root)
    audit = packed["audit"]
    write_json(ckpt_root / "packing-audit.json", audit)
    mix = audit.get("mix_assertions") or {}
    if not audit.get("packing_ok") or not mix.get("ok"):
        release_lock(lock_path)
        payload = abort_payload(reason="packing_invariant_failure", step=0, extra={"mix": mix})
        write_abort(ckpt_root, payload)
        write_json(report_path, payload)
        return payload
    stream = packed["stream"]
    batches = slice_contiguous_batches(stream, STAGE3A_STEPS, MICRO_BATCH, SEQ_LEN)
    causal = causal_batch_audit(batches, stream)
    if not causal.get("ok"):
        release_lock(lock_path)
        payload = abort_payload(reason="packing_invariant_failure", step=0, extra={"causal": causal})
        write_abort(ckpt_root, payload)
        write_json(report_path, payload)
        return payload

    state, coverage = load_model_state_from_safetensors(weights)
    if set(state) != set(expected_torch_keys()):
        release_lock(lock_path)
        payload = abort_payload(reason="invalid_architecture_or_tensor_shape", step=0, extra={"coverage": coverage})
        write_abort(ckpt_root, payload)
        write_json(report_path, payload)
        return payload
    model = WRIM0Model()
    model.load_state_dict(state, strict=True)
    n_params = int(sum(p.numel() for p in model.parameters()))
    if n_params != PARAM_COUNT:
        release_lock(lock_path)
        payload = abort_payload(reason="invalid_architecture_or_tensor_shape", step=0, extra={"n_params": n_params})
        write_abort(ckpt_root, payload)
        write_json(report_path, payload)
        return payload
    parent_cpu = {k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}
    model.to(device)
    model.freeze_inference()
    c0 = concat_units(encode_rehearsal_val_units(tokenizer, dump_root))
    c1 = concat_units(encode_corpus1_val_units(tokenizer, dump_root))
    suite_items = suite["obj"]["items"]
    frozen_items = baseline["obj"]["items"]
    wrim0_logp: dict[str, torch.Tensor] = {}

    pointer = parent_pointer(weights_path=weights, parent_sha=parent_sha)
    write_json(ckpt_root / "parent-pointer.json", pointer)
    write_json(ckpt_root / "run-manifest.json", {**run_manifest_template(), "hardware": gpu_stats(), "authorization_at_start": gate})

    print("[stage3a] step-0 full eval", flush=True)
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)
    eval0 = evaluate_candidate(
        model=model,
        tokenizer=tokenizer,
        device=device,
        dump_root=dump_root,
        suite_items=suite_items,
        frozen_items=frozen_items,
        wrim0_logp=wrim0_logp,
        parent_cpu=parent_cpu,
        c0=c0,
        c1=c1,
        greedy_256=True,
        step=0,
        train_loss=None,
        tokens=0,
        lr=None,
    )
    write_json(evals_dir / "step-0.json", eval0)
    if len(wrim0_logp) != 35:
        release_lock(lock_path)
        payload = abort_payload(reason="runtime_corruption", step=0, extra={"wrim0_logp_n": len(wrim0_logp)})
        write_abort(ckpt_root, payload)
        write_json(report_path, payload)
        return payload
    fp_mismatch = [
        r["item_id"]
        for r in eval0["items"]
        if r.get("greedy_32_token_id_sha256") != r.get("frozen_token_id_sha256")
    ]
    nll_mismatch = [
        r["item_id"]
        for r in eval0["items"]
        if abs(float(r["wrim0_anchor_nll_32"]) - float(r["frozen_nll"])) > STEP0_NLL_TOL
    ]
    kl0 = float(eval0.get("mean_kl_wrim0_to_candidate") or 0.0)
    v0_ok = abs(float(eval0["val_loss_corpus0"]) - 8.890125) <= VAL_TOL
    v1_ok = abs(float(eval0["val_loss_corpus1"]) - 7.971308) <= VAL_TOL
    eval0["fingerprint_mismatches"] = fp_mismatch
    if nll_mismatch or abs(kl0) > STEP0_KL_TOL or not v0_ok or not v1_ok:
        release_lock(lock_path)
        payload = abort_payload(
            reason="step0_baseline_did_not_reproduce",
            step=0,
            extra={"fp_mismatch": fp_mismatch, "nll_mismatch": nll_mismatch, "kl": kl0, "val0": eval0["val_loss_corpus0"], "val1": eval0["val_loss_corpus1"]},
        )
        write_abort(ckpt_root, payload)
        write_json(report_path, payload)
        return payload

    frozen_special = float((baseline["obj"].get("special_token_baseline") or {}).get("mean_special_rate_256") or 0.0)
    interleaved = packed.get("interleaved") or []
    buckets, docs = annotate_stream(interleaved)
    all_docs = sorted({d for d in docs if d})

    model.enable_training()
    model.to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=lr_stage3a(1),
        betas=tuple(ADAMW["betas"]),
        eps=ADAMW["eps"],
        weight_decay=ADAMW["weight_decay"],
        fused=False,
    )
    metrics: list[dict[str, Any]] = []
    clip_events = 0
    update_norms: list[float] = []
    eval25 = None
    eval50 = None
    ckpt25 = None
    ckpt50 = None
    disk25 = None
    aborted = False
    abort_reason = None
    hard_stop = False
    history = [eval0]
    contrib_acc = {"corpus0_tokens": 0, "corpus1_tokens": 0, "code_tokens": 0}

    def persist_metric(row: dict[str, Any]) -> None:
        metrics.append(row)
        with metrics_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, separators=(",", ":")) + "\n")

    tokens_seen = 0
    try:
        for step in range(1, STAGE3A_STEPS + 1):
            if step > MAX_AUTHORIZED_OPTIMIZER_STEPS:
                aborted = True
                hard_stop = True
                abort_reason = "optimizer_step_51_forbidden"
                break
            disk = disk_guard(ckpt_root)
            if disk["hard_stop"]:
                aborted = True
                hard_stop = True
                abort_reason = "disk_below_32GB"
                write_abort(ckpt_root, abort_payload(reason=abort_reason, step=step, extra={"disk": disk}))
                break
            lr = lr_stage3a(step)
            for pg in optimizer.param_groups:
                pg["lr"] = lr
            x_np, y_np = batches[step - 1]
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            t0 = time.perf_counter()
            optimizer.zero_grad(set_to_none=True)
            logits = model(x)
            loss = F.cross_entropy(logits.reshape(-1, VOCAB_SIZE), y.reshape(-1))
            if not bool(torch.isfinite(loss).item()):
                aborted = True
                hard_stop = True
                abort_reason = "NaN_or_Inf_loss"
                write_abort(ckpt_root, abort_payload(reason=abort_reason, step=step, extra={"loss": str(loss)}))
                break
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
                aborted = True
                hard_stop = True
                abort_reason = "NaN_Inf_gradients"
                write_abort(ckpt_root, abort_payload(reason=abort_reason, step=step))
                break
            grad_norm = math.sqrt(grad_sq)
            before = [p.detach().clone() for p in model.parameters()]
            clip = torch.nn.utils.clip_grad_norm_(model.parameters(), ADAMW["grad_clip"])
            clipped = bool(float(clip) > ADAMW["grad_clip"] + 1e-12) or grad_norm > ADAMW["grad_clip"]
            if clipped:
                clip_events += 1
            optimizer.step()
            tokens_seen += TOKENS_PER_STEP
            if tokens_seen > STAGE3A_TOKEN_BUDGET:
                aborted = True
                hard_stop = True
                abort_reason = "token_budget_exceeded"
                write_abort(ckpt_root, abort_payload(reason=abort_reason, step=step, extra={"tokens_seen": tokens_seen}))
                break
            delta = 0.0
            for p, b in zip(model.parameters(), before):
                delta += float((p.detach() - b).float().pow(2).sum().item())
            update_norm = math.sqrt(delta)
            update_norms.append(update_norm)
            dt = time.perf_counter() - t0
            contrib = step_token_contrib(buckets, docs, step, all_docs)
            contrib_acc["corpus0_tokens"] += int(contrib["corpus0_tokens"])
            contrib_acc["corpus1_tokens"] += int(contrib["corpus1_tokens"])
            contrib_acc["code_tokens"] += int(contrib["code_tokens"])
            row = {
                "global_step": step,
                "segment_step": step,
                "tokens_seen": tokens_seen,
                "lr": lr,
                "loss": float(loss.item()),
                "grad_norm": grad_norm,
                "clip_event": clipped,
                "clip_value": float(clip) if torch.is_tensor(clip) else float(clip),
                "update_norm": update_norm,
                "wall_ms": round(dt * 1000.0, 3),
                "tokens_per_sec": round(TOKENS_PER_STEP / max(dt, 1e-9), 2),
                "gpu": gpu_stats(),
                "corpus_mix_step": contrib,
                "disk_free_gb": disk["free_gb"],
            }
            persist_metric(row)
            print(json.dumps({"step": step, "lr": lr, "loss": row["loss"], "grad_norm": grad_norm, "tokens": tokens_seen}), flush=True)

            if step == 25:
                disk25 = disk_guard(ckpt_root)
                ckpt25 = save_weights(ckpt_root / "step-25", model, step, tokens_seen)
                print("[stage3a] step-25 compact eval", flush=True)
                eval25 = evaluate_candidate(
                    model=model,
                    tokenizer=tokenizer,
                    device=device,
                    dump_root=dump_root,
                    suite_items=suite_items,
                    frozen_items=frozen_items,
                    wrim0_logp=wrim0_logp,
                    parent_cpu=parent_cpu,
                    c0=c0,
                    c1=c1,
                    greedy_256=False,
                    step=25,
                    train_loss=row["loss"],
                    tokens=tokens_seen,
                    lr=lr,
                )
                eval25["parameter_displacement"] = parameter_displacement(model, parent_cpu)
                eval25["checkpoint"] = ckpt25
                write_json(evals_dir / "step-25.json", eval25)
                write_json(ckpt_root / "step-25" / "manifest.json", {"step": 25, "tokens": tokens_seen, "checkpoint": ckpt25, "metrics": row})
                history.append(eval25)
                stop, reason, _warn = apply_hard_stop(eval0, eval25, history)
                if stop:
                    aborted = True
                    hard_stop = True
                    abort_reason = reason
                    write_abort(ckpt_root, abort_payload(reason=reason or "hard_stop", step=25, extra={"eval": {"delta": eval25.get("mean_wrim0_anchor_nll_delta")}}))
                    break

            if step == 50:
                break
    finally:
        pass

    disk50 = disk_guard(ckpt_root)
    if not aborted and len(metrics) == 50:
        print("[stage3a] step-50 full eval + continuity checkpoint", flush=True)
        packing_cursor = {
            "next_unauthorized_step": 51,
            "tokens_seen": tokens_seen,
            "seed": SEED,
            "stream_tokens": int(stream.size),
            "note": "Continuation state recorded for a later Commander-authorized STAGE3B only. Step 51 was not executed.",
        }
        ckpt50 = save_continuity(ckpt_root / "step-50", model, optimizer, 50, tokens_seen, packing_cursor)
        eval50 = evaluate_candidate(
            model=model,
            tokenizer=tokenizer,
            device=device,
            dump_root=dump_root,
            suite_items=suite_items,
            frozen_items=frozen_items,
            wrim0_logp=wrim0_logp,
            parent_cpu=parent_cpu,
            c0=c0,
            c1=c1,
            greedy_256=True,
            step=50,
            train_loss=metrics[-1]["loss"] if metrics else None,
            tokens=tokens_seen,
            lr=lr_stage3a(50),
        )
        write_json(evals_dir / "step-50.json", eval50)
        write_json(ckpt_root / "step-50" / "manifest.json", {"step": 50, "tokens": tokens_seen, "checkpoint": ckpt50, "lineage": {"parent_sha256": PARENT_SHA, "run_id": RUN_ID, "segment": SEGMENT_A}})
        history.append(eval50)
        stop, reason, _warn = apply_hard_stop(eval0, eval50, history)
        if stop:
            aborted = True
            hard_stop = True
            abort_reason = reason
            write_abort(ckpt_root, abort_payload(reason=reason or "hard_stop", step=50))

    del optimizer
    parent_sha_after = sha256_file(weights)
    crossings = review_band_crossings(eval50 or eval25 or eval0, frozen_special)
    classification = classify_stage3a(aborted=aborted, abort_reason=abort_reason, step50=eval50, crossings=crossings, hard_stop=hard_stop)
    candidate_state = "TRAINING_ARTIFACT" if aborted else "EVALUATION_CANDIDATE"
    total = max(1, contrib_acc["corpus0_tokens"] + contrib_acc["corpus1_tokens"])
    genesis = genesis_token_audit(interleaved, tokens_seen, all_docs)
    summary = {
        "ok": (not aborted) and len(metrics) == 50 and tokens_seen == STAGE3A_TOKEN_BUDGET and parent_sha_after == PARENT_SHA,
        "kind": "STAGE3A_CONTROLLED_CONFIRMATION_RUN",
        "run_id": RUN_ID,
        "segment": SEGMENT_A,
        "classification_run": CLASSIFICATION,
        "final_classification": classification,
        "started_utc": started,
        "ended_utc": utc_now(),
        "wall_s": round(time.perf_counter() - t_run0, 3),
        "optimizer_steps": len(metrics),
        "parameter_update_count": len(metrics),
        "tokens_seen": tokens_seen,
        "step_51_exists": False,
        "STAGE3B_started": False,
        "TRAINING_AUTHORIZATION": "OFF",
        "STAGE3_AUTHORIZATION": "NO_PENDING_REVIEW",
        "STAGE3A_STATUS": "COMPLETE_PENDING_REVIEW" if not aborted else "ABORTED",
        "STAGE3B_EXECUTION_READINESS": False,
        "STAGE3B_AUTHORIZATION": "NO",
        "candidate_state": candidate_state,
        "promotion_candidate": False,
        "interpolation_executed": False,
        "parent_sha256": PARENT_SHA,
        "parent_sha_after": parent_sha_after,
        "parent_unmodified": parent_sha_after == PARENT_SHA,
        "tokenizer_sha256": tok_sha,
        "suite_sha256": suite["stored_hash"],
        "baseline_sha256": baseline["sha256"],
        "seed": SEED,
        "architecture": ARCHITECTURE,
        "n_params": n_params,
        "precision": PRECISION,
        "tf32": TF32,
        "abort": {"present": aborted, "hard_stop": hard_stop, "reason": abort_reason},
        "review_band_crossings": crossings,
        "clip_events": clip_events,
        "clip_rate": clip_events / max(1, len(metrics)),
        "update_norm": {
            "mean": float(sum(update_norms) / max(1, len(update_norms))),
            "max": float(max(update_norms) if update_norms else 0.0),
            "last": float(update_norms[-1] if update_norms else 0.0),
        },
        "realized_corpus_mix": {
            "corpus0_share": contrib_acc["corpus0_tokens"] / total,
            "corpus1_share": contrib_acc["corpus1_tokens"] / total,
            "code_share": contrib_acc["code_tokens"] / total,
            "tool_use_share": 0.0,
            "tokens": contrib_acc,
        },
        "realized_rehearsal": genesis,
        "disk": {"start": disk0, "step25": disk25, "step50": disk50},
        "checkpoints": {"step0": pointer, "step25": ckpt25, "step50": ckpt50},
        "eval_step0": {
            "mean_wrim0_anchor_nll_delta": eval0.get("mean_wrim0_anchor_nll_delta"),
            "mean_kl": eval0.get("mean_kl_wrim0_to_candidate"),
            "val0": eval0.get("val_loss_corpus0"),
            "val1": eval0.get("val_loss_corpus1"),
            "historical_binary": eval0.get("historical_binary"),
            "reproduced_frozen_parent": True,
        },
        "eval_step25": None
        if eval25 is None
        else {
            "mean_wrim0_anchor_nll_delta": eval25.get("mean_wrim0_anchor_nll_delta"),
            "mean_kl": eval25.get("mean_kl_wrim0_to_candidate"),
            "val0": eval25.get("val_loss_corpus0"),
            "val1": eval25.get("val_loss_corpus1"),
            "historical_binary": eval25.get("historical_binary"),
            "displacement": eval25.get("parameter_displacement"),
        },
        "eval_step50": None
        if eval50 is None
        else {
            "mean_wrim0_anchor_nll_delta": eval50.get("mean_wrim0_anchor_nll_delta"),
            "mean_kl": eval50.get("mean_kl_wrim0_to_candidate"),
            "val0": eval50.get("val_loss_corpus0"),
            "val1": eval50.get("val_loss_corpus1"),
            "historical_binary": eval50.get("historical_binary"),
            "category_aggregates": eval50.get("category_aggregates"),
            "json": eval50.get("category_aggregates", {}).get("JSON_STRUCTURED_OUTPUT"),
            "instruction": eval50.get("category_aggregates", {}).get("INSTRUCTION_FOLLOWING"),
            "long_form": eval50.get("category_aggregates", {}).get("LONG_FORM_CONTINUITY"),
            "special": eval50.get("category_aggregates", {}).get("SPECIAL_TOKEN_STABILITY"),
            "n_collapsed": eval50.get("n_collapsed"),
            "special_token_mean_rate": eval50.get("special_token_mean_rate"),
            "cap_eval_0": eval50.get("cap_eval_0"),
            "diagnostic_0_json": eval50.get("diagnostic_0_json"),
            "displacement": eval50.get("parameter_displacement"),
        },
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "QWEN": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "RAEL": "NOT_IMPLEMENTED",
        "ROADMAP_22": "CLOSED",
        "ROADMAP_23": "ACTIVE",
        "metrics_path": str(metrics_path),
        "ckpt_root": str(ckpt_root),
    }
    write_json(report_path, summary)
    write_json(ckpt_root / "STAGE3A_SUMMARY.json", summary)
    release_lock(lock_path)
    print(json.dumps({k: summary.get(k) for k in ("ok", "final_classification", "optimizer_steps", "tokens_seen", "TRAINING_AUTHORIZATION", "abort")}, indent=2), flush=True)
    return summary
