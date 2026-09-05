#!/usr/bin/env python3
"""WRIM1-RUN-000002 official candidate training. Does not promote. Does not touch production."""
from __future__ import annotations

import json
import math
import os
import platform
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
from safetensors.numpy import load_file

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))

from checkpoint_io import (  # noqa: E402
    load_bundle,
    load_model_weights,
    load_parent_wrim0_weights,
    model_to_numpy,
    register_checkpoint,
    write_checkpoint_bundle,
)
from constants import PARENT_CHECKPOINT_REL, PARENT_CHECKPOINT_SHA256, TOKENIZER_SHA256  # noqa: E402
from dataset_cursor import DatasetCursor, initial_cursor, next_batch  # noqa: E402
from diagnose_collapse import generate, topk_diag  # noqa: E402
from fingerprints import dirty_tree_fingerprint  # noqa: E402
from hashes import sha256_file, sha256_json, tensor_tree_sha256  # noqa: E402
from interleave_curriculum import (  # noqa: E402
    build_span_index,
    families_for_positions,
    local_mix_preflight,
    rolling_rehearsal,
    simulate_step_mix,
)
from pack_wrim1_run_000002 import materialize_official_pack  # noqa: E402
from paths import official_ckpt_dir, repo_root  # noqa: E402
from recovery_instrumentation import (  # noqa: E402
    build_retention_windows,
    causal_and_mask_audit,
    grad_instrumentation,
    kl_mean_from_logits,
    logits_for_windows,
    numpy_param_map,
    param_drift_vs_parent,
)
from rng_state import capture_rng, lr_at_step  # noqa: E402
from trainer_core import append_metric, apply_mlx_limits, build_from_config, reconstruct_optimizer  # noqa: E402
from training_config import official_training_config, optimizer_config_from_training  # noqa: E402
from run_recovery_experiment import evaluate_val, iso_now, load_tokenizer, masked_loss_fn, run_suite  # noqa: E402
from run_recovery_experiment_004 import collapse_gate_004, symbol_run  # noqa: E402
from run_wrim0_cap_eval_baseline import generate as cap_generate  # noqa: E402
from capability_curriculum_lib import EVAL_ID, score_output  # noqa: E402

RUN_ID = "WRIM1-RUN-000002"
MODEL_ID = "WRIM-1.1-CANDIDATE"
WORK_REL = "model-lab/manifests/wrim1_1_official/WRIM1-RUN-000002"
PRIOR_SUITE_REL = "model-lab/manifests/wrim1_1_recovery/test-only/WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED.json"
VENV_PYTHON_REL = ".venv-wrim/bin/python"
PRODUCTION_ROOT = Path("/Users/markbroughton/WarRoomNode01")
MAX_STEPS = 502
CKPT_STEPS = (0, 25, 50, 100, 150, 200, 250, 300, 350, 400, 450, 502)
FULL_DIAG_STEPS = CKPT_STEPS
LIGHT_STEPS = tuple(range(0, MAX_STEPS + 1, 10))
CAP_EVAL_STEPS = (0, 150, 250, 300, 400, 502)
PEAK_LR = 3e-5
WARMUP = 25
SCHEDULER_TOTAL = 502
BATCH = 8
CTX = 512
SEED = 20260830
FLOOR_RATIO = 0.1
EXPECTED_PY = (3, 12, 14)
EXPECTED_MLX = "0.32.2"
RECOVERY_MARKERS = ("TEST-WRIM1.1-RECOVERY", "WRIM-RECOVERY", "recovery/test-only")

FAM_SHORT = {
    "EVAL-LANG": "LANG",
    "EVAL-INSTRUCT": "INSTRUCT",
    "EVAL-JSON": "JSON",
    "EVAL-CODE": "CODE",
    "EVAL-WR": "WR",
    "EVAL-EVIDENCE": "EVIDENCE",
    "EVAL-TOOL": "TOOL",
    "EVAL-CORRECTION": "CORRECTION",
    "EVAL-RETENTION": "RETENTION",
}
P0 = {"LANG", "INSTRUCT", "JSON", "WR", "EVIDENCE"}
P1 = {"CODE", "TOOL"}
P2 = {"CORRECTION"}


def official_config() -> dict:
    cfg = official_training_config()
    cfg.update({
        "learning_rate": PEAK_LR,
        "warmup_steps": WARMUP,
        "total_steps": SCHEDULER_TOTAL,
        "planned_train_steps": MAX_STEPS,
        "batch_size": BATCH,
        "context_length": CTX,
        "validation_cadence_steps": 10,
        "checkpoint_cadence_steps": 25,
        "seed": SEED,
        "shuffle_strategy": "deficit_interleave_contiguous_windows",
        "test_only": False,
        "promotable": False,
        "lineage": "WRX-000001 -> WRIM-0 -> WRIM-1.1-CANDIDATE",
        "run_id": RUN_ID,
        "model_id": MODEL_ID,
        "lr_rationale": (
            "Official WRIM-1.1 candidate: peak 3e-5, warmup 25, cosine over 502 steps, floor 10% (3e-6). "
            "Inherited from Recovery-006/007. Cosine horizon equals official length."
        ),
        "scheduler_floor_ratio": FLOOR_RATIO,
    })
    return cfg


def verify_wrim_env(root: Path) -> dict:
    expected_exe = (root / VENV_PYTHON_REL).resolve()
    actual_exe = Path(sys.executable).resolve()
    import mlx.core as mx
    mlx_ver = str(getattr(mx, "__version__", "") or "")
    if not mlx_ver:
        import importlib.metadata as importlib_metadata
        mlx_ver = importlib_metadata.version("mlx")
    device = str(mx.default_device())
    metal = bool(mx.metal.is_available()) if hasattr(mx, "metal") else False
    info = {
        "venv_python": str(root / VENV_PYTHON_REL),
        "executable": str(actual_exe),
        "expected_executable": str(expected_exe),
        "executable_match": actual_exe == expected_exe,
        "python_version": platform.python_version(),
        "python_ok": tuple(sys.version_info[:3]) == EXPECTED_PY,
        "machine": platform.machine(),
        "arm64": platform.machine() == "arm64",
        "mlx_version": mlx_ver,
        "mlx_ok": mlx_ver == EXPECTED_MLX,
        "device": device,
        "metal_available": metal,
        "gpu_device": device.startswith("Device(gpu"),
        "NOT_PRODUCTION": True,
        "forbidden_python": str(actual_exe) not in ("/usr/bin/python3",),
    }
    info["passed"] = bool(
        info["executable_match"] and info["python_ok"] and info["arm64"]
        and info["mlx_ok"] and info["gpu_device"] and metal
        and "CommandLineTools" not in str(actual_exe)
    )
    return info


def family_ce_on_batch(model, x, y, w, vocab, spans, seq_starts, ctx) -> dict:
    import mlx.core as mx
    import mlx.nn as nn
    logits = model(x)
    ce = nn.losses.cross_entropy(logits.reshape(-1, vocab), y.reshape(-1), reduction="none")
    mx.eval(ce)
    ce_np = np.array(ce, dtype=np.float64).reshape(x.shape[0], x.shape[1])
    w_np = np.array(w)
    acc = defaultdict(lambda: [0.0, 0.0])
    for i, start in enumerate(seq_starts):
        positions = np.arange(start + 1, start + 1 + ctx, dtype=np.int64)
        fams = families_for_positions(spans, positions)
        for t, fam in enumerate(fams):
            wt = float(w_np[i, t])
            if wt <= 0:
                continue
            acc[fam][0] += float(ce_np[i, t]) * wt
            acc[fam][1] += wt
    return {fam: (None if n <= 0 else float(s / n)) for fam, (s, n) in acc.items()}


def run_cap_eval(model, tokenizer, suite: dict) -> dict:
    results = []
    family_stats: dict[str, dict[str, int]] = {}
    for item in suite["items"]:
        gen = cap_generate(model, tokenizer, item["generation_prompt"], 64)
        scored = score_output(item, gen["continuation"])
        fam = item["family"]
        family_stats.setdefault(fam, {"n": 0, "pass": 0, "fail": 0})
        family_stats[fam]["n"] += 1
        if scored["pass"]:
            family_stats[fam]["pass"] += 1
        else:
            family_stats[fam]["fail"] += 1
        results.append({
            "evalId": item["evalId"],
            "family": fam,
            "short_family": FAM_SHORT.get(fam, fam),
            "level": item["level"],
            "capability_ids": item["capability_ids"],
            "output": gen["continuation"][:400],
            "n_new": gen["n_new"],
            **{k: v for k, v in scored.items() if k != "evalId"},
        })
    short = {FAM_SHORT.get(k, k): v for k, v in family_stats.items()}
    return {
        "suite_id": suite["suite_id"],
        "EXCLUDE_FROM_TRAINING": True,
        "pass_count": sum(1 for r in results if r["pass"]),
        "item_count": len(results),
        "family_stats": family_stats,
        "family_stats_short": short,
        "results": results,
    }


def delta_vs_baseline(cand: dict, baseline: dict) -> dict:
    bfam = baseline.get("family_stats") or {}
    cfam = cand.get("family_stats") or {}
    families = []
    for key, short in FAM_SHORT.items():
        b = bfam.get(key) or {"n": 0, "pass": 0}
        c = cfam.get(key) or {"n": 0, "pass": 0}
        bn, bp = int(b["n"]), int(b["pass"])
        cn, cp = int(c["n"]), int(c["pass"])
        examples = [r["evalId"] for r in cand["results"] if r["family"] == key and r["pass"]]
        regressions = [
            r["evalId"] for r in cand["results"]
            if r["family"] == key and not r["pass"]
            for br in baseline.get("results") or []
            if br.get("evalId") == r["evalId"] and br.get("pass")
        ]
        families.append({
            "family": short,
            "eval_key": key,
            "baseline": f"{bp}/{bn}",
            "candidate": f"{cp}/{cn}",
            "delta_pass": cp - bp,
            "examples": examples,
            "regressions": regressions,
            "priority": "P0" if short in P0 else ("P1" if short in P1 else ("P2" if short in P2 else "RETENTION")),
        })
    p0_improve = []
    p0_reg = []
    for row in families:
        if row["family"] not in P0 and row["family"] != "RETENTION":
            continue
        n = int((bfam.get(row["eval_key"]) or {}).get("n") or 0)
        bp = int((bfam.get(row["eval_key"]) or {}).get("pass") or 0)
        cp = int((cfam.get(row["eval_key"]) or {}).get("pass") or 0)
        meaningful = (n >= 8 and (cp - bp) >= 2) or (row["family"] == "JSON" and bp == 0 and cp >= 2)
        if row["family"] in P0 and meaningful:
            p0_improve.append(row["family"])
        rel_drop = (bp - cp) / bp if bp > 0 else 0.0
        if row["family"] in P0 | {"RETENTION"} and rel_drop >= 0.30:
            p0_reg.append(row["family"])
        if row["family"] in {"LANG", "RETENTION"} and cp < bp:
            p0_reg.append(row["family"])
    p0_reg = sorted(set(p0_reg))
    return {
        "overall_baseline": f"{baseline.get('pass_count')}/{baseline.get('item_count')}",
        "overall_candidate": f"{cand.get('pass_count')}/{cand.get('item_count')}",
        "overall_delta": int(cand.get("pass_count") or 0) - int(baseline.get("pass_count") or 0),
        "families": families,
        "p0_meaningful_improvements": p0_improve,
        "p0_regressions": p0_reg,
        "p1": [r for r in families if r["family"] in P1],
        "p2": [r for r in families if r["family"] in P2],
    }


def candidate_verdict(gates: dict) -> str:
    if not gates.get("no_leak") or not gates.get("no_collapse") or not gates.get("reload_ok"):
        return "WRIM-1.1 CANDIDATE — NOT BETTER THAN WRIM-0"
    if not gates.get("p0_improve"):
        return "WRIM-1.1 CANDIDATE — NOT BETTER THAN WRIM-0"
    if gates.get("p0_regression"):
        return "WRIM-1.1 CANDIDATE — NOT BETTER THAN WRIM-0"
    if not gates.get("repro_ok"):
        return "WRIM-1.1 CANDIDATE — INCONCLUSIVE"
    return "WRIM-1.1 CANDIDATE — BETTER THAN WRIM-0"


def fail_packet(work: Path, reason: str, evidence: dict) -> int:
    payload = {
        "run_id": RUN_ID,
        "verdict": "WRIM1-RUN-000002 — FAIL",
        "reason": reason,
        "evidence": evidence,
        "trained": False,
        "promoted": False,
        "production_untouched": True,
    }
    work.mkdir(parents=True, exist_ok=True)
    (work / "FAIL.json").write_text(json.dumps(payload, indent=2, default=str) + "\n")
    print(json.dumps(payload, indent=2, default=str))
    return 2


def main() -> int:
    root = repo_root()
    work = root / WORK_REL
    work.mkdir(parents=True, exist_ok=True)
    official_000001 = official_ckpt_dir(root)
    wrim0_path = root / PARENT_CHECKPOINT_REL
    prod_before = {
        "production_exists": PRODUCTION_ROOT.exists(),
        "production_root": str(PRODUCTION_ROOT),
        "wrim0_sha_before": sha256_file(wrim0_path),
        "wrim1_000001_registry_mtime": (
            (official_000001 / "checkpoint-registry.json").stat().st_mtime
            if (official_000001 / "checkpoint-registry.json").is_file() else None
        ),
    }

    env = verify_wrim_env(root)
    (work / "environment.json").write_text(json.dumps(env, indent=2) + "\n")
    if not env["passed"]:
        return fail_packet(work, "Python/MLX environment failed", env)

    tok_sha = sha256_file(root / "model-lab/manifests/wrim0_tokenizer_v16384/tokenizer.json")
    parent_sha = sha256_file(wrim0_path)
    if tok_sha != TOKENIZER_SHA256:
        return fail_packet(work, "tokenizer SHA mismatch", {"expected": TOKENIZER_SHA256, "actual": tok_sha})
    if parent_sha != PARENT_CHECKPOINT_SHA256:
        return fail_packet(work, "parent SHA mismatch", {"expected": PARENT_CHECKPOINT_SHA256, "actual": parent_sha})
    if any(m in str(wrim0_path) for m in RECOVERY_MARKERS):
        return fail_packet(work, "parent path looks like a Recovery artifact", {"path": str(wrim0_path)})

    tokenizer = load_tokenizer(root)
    packed = materialize_official_pack(root=root, tokenizer=tokenizer)
    report = {
        "curriculum_id": packed["curriculum_id"],
        "eval_id": packed["eval_id"],
        "selected_tokens": packed["selected_tokens"],
        "train_tokens": int(packed["train_stream"].size),
        "token_pct": packed["token_pct"],
        "rehearsal_pct": packed["rehearsal_pct"],
        "pack_token_match": packed["pack_token_match"],
        "split_preserves_tokens": packed["split_preserves_tokens"],
        "interleave": packed["interleave_unit_order_only"],
        "shuffle": packed["shuffle"],
        "validator_passed": packed["validator"]["passed"],
        "example_leak": packed["example_leak_scan"]["known_eval_leakage"],
        "stream_leak": packed["stream_leak_scan"]["known_eval_leakage"],
        "eval_exclude_ok": packed["eval_exclude_ok"],
        "mask_proof_passed": packed["mask_proof"]["passed"],
        "tool_proof_passed": packed["tool_proof"]["passed"],
        "commander_corrections": packed["account"]["commander_correction_count"],
        "terra_training_observations": packed["account"]["terra_training_observations"],
        "design_content_sha256": packed["design_manifest"].get("content_sha256"),
    }
    (work / "pack-report.json").write_text(json.dumps({
        **report,
        "token_counts": packed["token_counts"],
        "mask_proof": packed["mask_proof"],
        "tool_proof": packed["tool_proof"],
        "stream_leak_scan": packed["stream_leak_scan"],
        "validator": packed["validator"],
        "interleave_unit_order_only": packed["interleave_unit_order_only"],
    }, indent=2, default=str) + "\n")

    if packed["account"]["commander_correction_count"] != 0 or packed["account"]["terra_training_observations"] != 0:
        return fail_packet(work, "fabricated commander/terra counts forbidden", report)
    if not packed["pack_token_match"]:
        return fail_packet(work, "curriculum pack token count mismatch", report)
    if not packed["validator"]["passed"]:
        return fail_packet(work, "curriculum validator failed", packed["validator"])
    if not packed["eval_exclude_ok"]:
        return fail_packet(work, "held-out exclusion marker missing", report)
    if packed["example_leak_scan"]["known_eval_leakage"] != 0:
        return fail_packet(work, "example leak scan non-zero", packed["example_leak_scan"])
    if not packed["stream_leak_scan"]["passed"]:
        return fail_packet(work, "packed-stream leak scan failed", packed["stream_leak_scan"])
    if not packed["split_preserves_tokens"] or not packed["interleave_unit_order_only"].get("passed"):
        return fail_packet(work, "contiguous-unit interleave proof failed", report)
    if packed["interleave_unit_order_only"].get("passed") and not packed["interleave_unit_order_only"].get("unit_order_changed"):
        return fail_packet(work, "interleave did not change unit order", report)
    if not packed["mask_proof"]["passed"]:
        return fail_packet(work, "mask correctness failed", packed["mask_proof"])
    if not packed["tool_proof"]["passed"]:
        return fail_packet(work, "tool-target gradient proof failed", packed["tool_proof"])

    np.save(work / "train.npy", packed["train_stream"])
    np.save(work / "train-mask.npy", packed["train_mask"])
    np.save(work / "val.npy", packed["val_stream"])
    np.save(work / "val-mask.npy", packed["val_mask"])
    train_stream = packed["train_stream"]
    train_mask = packed["train_mask"]
    val_stream = packed["val_stream"]
    val_mask = packed["val_mask"]
    train_sha = sha256_file(work / "train.npy")
    (work / "train-stream.sha256").write_text(train_sha + "\n")

    if train_stream.size < CTX + 1:
        return fail_packet(work, "packed train stream too short", {"n": int(train_stream.size)})

    planned = simulate_step_mix(
        train_stream=train_stream,
        train_mask=train_mask,
        units=packed["train_units"],
        ctx=CTX,
        batch=BATCH,
        seed=SEED,
        n_steps=MAX_STEPS,
    )
    for row in planned:
        pct = row.get("pct") or {}
        row["supervised_pct"] = float(pct.get("supervised") or 0.0)
    preflight = local_mix_preflight(planned)
    (work / "planned-step-source-map.json").write_text(json.dumps({
        "steps": planned,
        "preflight": {k: preflight[k] for k in preflight if k not in ("rolling_5", "rolling_10")},
        "first_batch": planned[0] if planned else None,
    }, indent=2) + "\n")
    if not preflight["passed"]:
        return fail_packet(work, "local mix / contiguous interleave preflight failed", preflight)
    if int(preflight.get("longest_rehearsal_only_steps") or 0) != 0:
        return fail_packet(work, "100% rehearsal binge present", preflight)

    audit = causal_and_mask_audit(
        train_stream=train_stream,
        train_mask=train_mask,
        tokenizer=tokenizer,
        ctx=CTX,
        batch=BATCH,
        seed=SEED,
        n_batches=12,
    )
    (work / "causal-batch-audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    if not audit["passed"] or audit["causal_y_equals_x_shift_mismatches"] != 0:
        return fail_packet(work, "causal y[t]==x[t+1] failed", audit)
    (work / "unit-mask-audit.json").write_text(json.dumps(packed["mask_proof"], indent=2) + "\n")
    (work / "tool-target-proof.json").write_text(json.dumps(packed["tool_proof"], indent=2) + "\n")
    (work / "first-batch.json").write_text(json.dumps(planned[0], indent=2) + "\n")

    suite = json.loads((root / PRIOR_SUITE_REL).read_text(encoding="utf-8"))
    if len(suite.get("items") or []) != 13:
        return fail_packet(work, "13-probe diagnostic suite missing", {"n": len(suite.get("items") or [])})
    (work / "WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED.json").write_text(json.dumps(suite, indent=2) + "\n")

    cap_suite = json.loads((root / "model-lab/eval-only" / EVAL_ID / "suite.json").read_text(encoding="utf-8"))
    baseline = json.loads((root / "model-lab/eval-only" / EVAL_ID / "wrim0-baseline.json").read_text(encoding="utf-8"))
    eval_sha = sha256_file(root / "model-lab/eval-only" / EVAL_ID / "suite.json")

    cfg = official_config()
    identities = {
        "promotable": False,
        "lineage": cfg["lineage"],
        "NOT_PRODUCTION": True,
        "run_id": RUN_ID,
        "model_id": MODEL_ID,
        "parent_checkpoint_path": str(wrim0_path),
        "parent_checkpoint_sha256": PARENT_CHECKPOINT_SHA256,
        "tokenizer_sha256": TOKENIZER_SHA256,
        "training_config_sha256": sha256_json(cfg),
        "curriculum_id": packed["curriculum_id"],
        "curriculum_stream_sha256": train_sha,
        "eval_id": EVAL_ID,
        "eval_suite_sha256": eval_sha,
        "code_fingerprint": dirty_tree_fingerprint(root),
    }
    run_manifest = {
        "run_id": RUN_ID,
        "official": True,
        "promotable": False,
        "NOT_PRODUCTION": True,
        "NOT_PROMOTABLE": True,
        "model_id": MODEL_ID,
        "parent_model_id": "WRIM-0",
        "parent_checkpoint_sha256": PARENT_CHECKPOINT_SHA256,
        "tokenizer_id": "WR-TOKENIZER-0",
        "tokenizer_sha256": TOKENIZER_SHA256,
        "curriculum_id": packed["curriculum_id"],
        "eval_id": EVAL_ID,
        "training_config_sha256": identities["training_config_sha256"],
        "authorization": "COMMANDER_WRIM1_RUN_000002_TRAINING_ONLY",
        "does_not_overwrite": ["WRIM-0", "WRX-000001", "WRIM1-RUN-000001", "Recovery-001-007"],
    }
    (work / "run-manifest.json").write_text(json.dumps(run_manifest, indent=2) + "\n")
    (work / "training-config.json").write_text(json.dumps(cfg, indent=2) + "\n")
    opt_cfg_now = optimizer_config_from_training(cfg)
    (work / "optimizer-config.json").write_text(json.dumps(opt_cfg_now, indent=2) + "\n")
    lr_rows = [{"step": s, "learning_rate": lr_at_step(s, SCHEDULER_TOTAL, PEAK_LR, WARMUP, FLOOR_RATIO)} for s in range(MAX_STEPS)]
    if any(r["learning_rate"] > PEAK_LR + 1e-18 for r in lr_rows):
        return fail_packet(work, "planned LR exceeds 3e-5", {"max": max(r["learning_rate"] for r in lr_rows)})
    (work / "lr-schedule.json").write_text(json.dumps({
        "peak_lr": PEAK_LR,
        "warmup_steps": WARMUP,
        "scheduler_total_steps": SCHEDULER_TOTAL,
        "floor_lr": PEAK_LR * FLOOR_RATIO,
        "schedule": lr_rows,
    }, indent=2) + "\n")

    import mlx.core as mx
    import mlx.nn as nn
    import mlx.utils
    import random

    apply_mlx_limits(cfg)
    mx.random.seed(SEED)
    rng = np.random.default_rng(SEED)
    random.seed(SEED)

    model, arch, nparams = build_from_config(cfg, SEED)
    load_info = load_parent_wrim0_weights(model, wrim0_path, PARENT_CHECKPOINT_SHA256)
    loaded = model_to_numpy(model)
    loaded_sha = tensor_tree_sha256(loaded)
    raw = load_file(str(wrim0_path))
    parent_tensors = {k[6:]: v for k, v in raw.items() if k.startswith("model.")}
    parent_sha_tree = tensor_tree_sha256(parent_tensors)
    max_abs = 0.0
    for k in loaded:
        max_abs = max(max_abs, float(np.max(np.abs(loaded[k].astype(np.float64) - parent_tensors[k].astype(np.float64)))))
    parent_proof = {
        "file_sha256": parent_sha,
        "expected": PARENT_CHECKPOINT_SHA256,
        "file_match": parent_sha == PARENT_CHECKPOINT_SHA256,
        "loaded_tensor_tree_sha256": loaded_sha,
        "parent_tensor_tree_sha256": parent_sha_tree,
        "tensor_tree_match": loaded_sha == parent_sha_tree,
        "max_abs_diff": max_abs,
        "nparams": nparams,
        "load_info": load_info,
        "before_optimizer_step": True,
        "not_recovery_parent": True,
        "parent_path": str(wrim0_path),
    }
    (work / "wrim0-load-proof.json").write_text(json.dumps(parent_proof, indent=2) + "\n")
    if not parent_proof["file_match"] or not parent_proof["tensor_tree_match"] or max_abs != 0.0:
        return fail_packet(work, "exact WRIM-0 load failed", parent_proof)

    parent_np = numpy_param_map(model)
    ret = build_retention_windows(root=root, tokenizer=tokenizer)
    if ret.get("leak_hits"):
        return fail_packet(work, "retention windows leaked held-out prompts", ret)
    np.save(work / "retention-windows.npy", ret["windows"])
    (work / "retention-windows-meta.json").write_text(json.dumps({k: ret[k] for k in ret if k != "windows"}, indent=2) + "\n")
    parent_ret_logits = logits_for_windows(model, ret["windows"])
    np.save(work / "retention-parent-logits.npy", parent_ret_logits)

    opt, opt_cfg = reconstruct_optimizer(cfg, model)
    vocab = int(cfg["vocab_size"])
    spans = build_span_index(packed["train_units"])
    clip_limit = float(cfg["gradient_clipping"])

    def loss_fn(m, x, y, w):
        return masked_loss_fn(m, x, y, w, vocab)

    loss_and_grad = nn.value_and_grad(model, loss_fn)
    cursor = initial_cursor(train_stream.size, CTX, BATCH, SEED)
    metrics_path = work / "metrics.jsonl"
    registry_path = work / "checkpoint-registry.json"
    diag_table = []
    light_rows = []
    drift_rows = []
    kl_rows = []
    grad_rows = []
    mix_rows = []
    family_loss_rows = []
    clip_events = []
    cap_evals = {}
    early_stop = {"stopped": False, "reason": "", "step": None}
    last_ckpt = None
    t0 = time.time()
    last_grad_row = None
    pid = os.getpid()
    interruption_log = []

    def save_ckpt(step: int, cursor_now: DatasetCursor, status: str, val_metrics: dict | None):
        nonlocal last_ckpt
        ckpt_id = f"checkpoint-step-{step:06d}"
        dest = work / ckpt_id
        if dest.exists() and (dest / "checkpoint-manifest.json").is_file():
            existing = json.loads((dest / "checkpoint-manifest.json").read_text(encoding="utf-8"))
            if existing.get("complete"):
                last_ckpt = ckpt_id
                return dest, existing
        training_state = {
            "run_id": RUN_ID,
            "global_step": step,
            "epoch": cursor_now.epoch,
            "tokens_seen": cursor_now.tokens_consumed,
            "promotable": False,
            "run_status": status,
            "updated_at": iso_now(),
            "latest_validation_metrics": val_metrics,
        }
        manifest = write_checkpoint_bundle(
            dest_dir=dest,
            checkpoint_id=ckpt_id,
            run_id=RUN_ID,
            step=step,
            epoch=cursor_now.epoch,
            tokens_seen=cursor_now.tokens_consumed,
            model=model,
            optimizer_state=opt.state,
            optimizer_config=opt_cfg,
            rng_blob=capture_rng(rng),
            training_state=training_state,
            dataset_state=cursor_now.to_dict(),
            run_manifest=run_manifest,
            metrics_snapshot={"last_validation": val_metrics},
            parent_checkpoint="WRIM-0" if step == 0 else last_ckpt,
            identities=identities,
        )
        register_checkpoint(registry_path, {
            "checkpoint_id": ckpt_id,
            "run_id": RUN_ID,
            "path": str(dest),
            "step": step,
            "sha": manifest["model_tensor_sha256"],
            "status": "complete",
            "promotable": False,
            "model_id": MODEL_ID,
        })
        last_ckpt = ckpt_id
        return dest, manifest

    def diagnose(step: int, val_metrics: dict | None, train_loss: float | None, full: bool):
        suite_out = run_suite(model, tokenizer, suite["items"])
        sky_sym = symbol_run(suite_out["sky_continuation"])
        suite_out["symbol_run"] = sky_sym["symbol_run"]
        lg = topk_diag(model, tokenizer, "The sky is")
        drift = param_drift_vs_parent(numpy_param_map(model), parent_np)
        drift["step"] = step
        drift_rows.append(drift)
        cur_logits = logits_for_windows(model, ret["windows"])
        kl = {"step": step, **kl_mean_from_logits(parent_ret_logits, cur_logits)}
        kl_rows.append(kl)
        row = {
            "step": step,
            "full": full,
            "train_loss": train_loss,
            "validation_loss": None if val_metrics is None else val_metrics.get("validation_loss"),
            "learning_rate": lr_at_step(max(0, step - 1) if step else 0, SCHEDULER_TOTAL, PEAK_LR, WARMUP, FLOOR_RATIO),
            "logits": {
                "p_period": lg.get("p_period"),
                "p_eos": lg.get("p_eos"),
                "p_pipe": lg.get("p_pipe"),
                "p_underscore": lg.get("p_underscore"),
                "entropy": lg.get("entropy"),
                "top": (lg.get("top") or [None])[0],
                "finite": lg.get("finite"),
            },
            "param_drift": drift,
            "kl_to_wrim0": kl,
            **{k: suite_out[k] for k in suite_out if k != "items"},
            **sky_sym,
        }
        if last_grad_row:
            row["global_grad_l2"] = last_grad_row.get("global_grad_l2")
        dest = work / (f"diagnostic-step-{step:06d}.json" if full else f"light-step-{step:06d}.json")
        dest.write_text(json.dumps({**row, "items": suite_out["items"]}, indent=2, default=str) + "\n")
        (diag_table if full else light_rows).append(row)
        return suite_out, lg, row

    def maybe_cap_eval(step: int):
        if step not in CAP_EVAL_STEPS:
            return
        ev = run_cap_eval(model, tokenizer, cap_suite)
        ev["step"] = step
        ev["model_id"] = MODEL_ID if step else "WRIM-0 (step 0 / parent)"
        ev["delta"] = delta_vs_baseline(ev, baseline)
        cap_evals[str(step)] = ev
        (work / f"cap-eval-step-{step:06d}.json").write_text(json.dumps(ev, indent=2, default=str) + "\n")

    val0 = evaluate_val(model, val_stream, val_mask, cfg, vocab)
    save_ckpt(0, cursor, "OFFICIAL", val0)
    s0, lg0, row0 = diagnose(0, val0, None, full=True)
    maybe_cap_eval(0)
    sky0 = (row0.get("sky_continuation") or "")
    top0 = ((lg0.get("top") or [{}])[0].get("tok") or "")
    if row0["collapsed_probes"] != 2 or not sky0.startswith(" a") or top0 != " a":
        return fail_packet(work, "step-0 mismatch vs WRIM-0 diagnostic baseline", {"row0": row0, "top": top0, "sky": sky0[:80]})

    global_step = 0
    last_train_loss = None
    nan_inf = False
    crash = {"crashed": False, "pid": pid}
    try:
        while global_step < MAX_STEPS:
            x_np, y_np, w_np, cursor = next_batch(train_stream, cursor, loss_mask=train_mask)
            mix = planned[global_step] if global_step < len(planned) else {"pct": {}, "dominant_source_family": "unknown", "seq_starts": []}
            mix_rows.append(mix)
            if not np.array_equal(y_np[:, :-1], x_np[:, 1:]):
                early_stop = {"stopped": True, "reason": "causal target corruption y[t]!=x[t+1]", "step": global_step + 1}
                break
            x = mx.array(x_np)
            y = mx.array(y_np)
            w = mx.array(w_np)
            lr = lr_at_step(global_step, SCHEDULER_TOTAL, PEAK_LR, WARMUP, FLOOR_RATIO)
            if lr > PEAK_LR + 1e-18:
                early_stop = {"stopped": True, "reason": f"LR {lr} exceeded peak", "step": global_step + 1}
                break
            opt.learning_rate = lr
            loss, grads = loss_and_grad(model, x, y, w)
            ginfo = grad_instrumentation(grads)
            last_grad_row = ginfo
            fam_ce = family_ce_on_batch(model, x, y, w, vocab, spans, mix.get("seq_starts") or [], CTX)
            family_loss_rows.append({"step": global_step + 1, "ce_by_family": fam_ce, "mix": mix.get("pct")})
            grad_leaves = [g for _, g in mlx.utils.tree_flatten(grads)]
            grad_norm = mx.sqrt(sum(mx.sum(g.astype(mx.float32) ** 2) for g in grad_leaves))
            clip_coef = mx.minimum(1.0, clip_limit / (grad_norm + 1e-6))
            grads = mlx.utils.tree_map(lambda g: g * clip_coef, grads)
            mx.eval(loss, grad_norm)
            loss_val = float(loss.item())
            grad_val = float(grad_norm.item())
            clipped = grad_val > clip_limit
            grad_rows.append({"step": global_step + 1, **ginfo, "learning_rate": lr, "clip_applied": clipped})
            if clipped:
                clip_events.append({"step": global_step + 1, "global_grad_l2": grad_val})
            if not math.isfinite(loss_val) or not math.isfinite(grad_val):
                nan_inf = True
                early_stop = {"stopped": True, "reason": f"NaN/Inf loss={loss_val} grad={grad_val}", "step": global_step + 1}
                break
            opt.update(model, grads)
            mx.eval(model.parameters(), opt.state)
            mx.clear_cache()
            global_step += 1
            last_train_loss = loss_val
            rec = {
                "kind": "train",
                "step": global_step,
                "epoch": cursor.epoch,
                "tokens_seen": cursor.tokens_consumed,
                "train_loss": loss_val,
                "learning_rate": lr,
                "global_grad_l2": ginfo.get("global_grad_l2"),
                "clip_applied": clipped,
                "dominant_source_family": mix.get("dominant_source_family"),
                "rehearsal_pct": mix.get("rehearsal_pct"),
                "prose_pct": mix.get("prose_pct"),
                "code_pct": mix.get("code_pct"),
                "supervised_pct": mix.get("supervised_pct"),
                "ce_by_family": fam_ce,
                "timestamp": iso_now(),
            }
            val_metrics = None
            if global_step % int(cfg["validation_cadence_steps"]) == 0 or global_step in FULL_DIAG_STEPS or global_step in LIGHT_STEPS:
                val_metrics = evaluate_val(model, val_stream, val_mask, cfg, vocab)
                rec["validation_loss"] = val_metrics.get("validation_loss")
            append_metric(metrics_path, rec)
            do_full = global_step in FULL_DIAG_STEPS
            do_light = global_step in LIGHT_STEPS and not do_full
            if global_step in CKPT_STEPS:
                save_ckpt(global_step, cursor, "OFFICIAL", val_metrics)
            if do_full or do_light:
                suite_out, lg, row = diagnose(global_step, val_metrics, loss_val, full=do_full)
                stop, reason = collapse_gate_004(
                    row0,
                    {**suite_out, **symbol_run(suite_out["sky_continuation"]), "global_grad_l2": ginfo.get("global_grad_l2")},
                    lg,
                    ginfo,
                )
                if nan_inf or stop:
                    early_stop = {"stopped": True, "reason": reason, "step": global_step}
                    if global_step not in CKPT_STEPS:
                        save_ckpt(global_step, cursor, "OFFICIAL_EARLY_STOP", val_metrics)
                    break
            maybe_cap_eval(global_step)
    except Exception as exc:  # noqa: BLE001
        crash = {"crashed": True, "pid": pid, "timestamp": iso_now(), "type": type(exc).__name__, "message": str(exc), "step": global_step}
        (work / "crash-report.json").write_text(json.dumps(crash, indent=2) + "\n")
        early_stop = {"stopped": True, "reason": f"python/mlx crash: {exc}", "step": global_step}

    if not early_stop["stopped"] and global_step not in FULL_DIAG_STEPS:
        val_metrics = evaluate_val(model, val_stream, val_mask, cfg, vocab)
        save_ckpt(global_step, cursor, "OFFICIAL_COMPLETED", val_metrics)
        diagnose(global_step, val_metrics, last_train_loss, full=True)
        maybe_cap_eval(global_step)

    reload_proof = []
    for step in [r["step"] for r in diag_table]:
        ckpt = work / f"checkpoint-step-{step:06d}"
        if not (ckpt / "checkpoint-manifest.json").is_file():
            reload_proof.append({"step": step, "ok": False})
            continue
        bundle = load_bundle(ckpt)
        m2, _, _ = build_from_config(cfg, SEED)
        load_model_weights(m2, bundle["model"], strict=True)
        sha = tensor_tree_sha256(model_to_numpy(m2))
        reload_proof.append({
            "step": step,
            "ok": sha == bundle["manifest"]["model_tensor_sha256"],
            "reloaded_sha": sha,
            "bundle_sha": bundle["manifest"]["model_tensor_sha256"],
        })

    repro = {"ok": False}
    final_step = global_step
    if not early_stop["stopped"] and final_step == MAX_STEPS:
        maybe_cap_eval(MAX_STEPS)
        ckpt = work / f"checkpoint-step-{MAX_STEPS:06d}"
        if (ckpt / "checkpoint-manifest.json").is_file():
            bundle = load_bundle(ckpt)
            m2, _, _ = build_from_config(cfg, SEED)
            load_model_weights(m2, bundle["model"], strict=True)
            live = cap_evals.get(str(MAX_STEPS))
            again = run_cap_eval(m2, tokenizer, cap_suite)
            repro = {
                "ok": live is not None and again["pass_count"] == live["pass_count"],
                "live_pass": None if live is None else live["pass_count"],
                "reload_pass": again["pass_count"],
                "final_sha": bundle["manifest"]["model_tensor_sha256"],
            }
            (work / "cap-eval-reload-step-000502.json").write_text(json.dumps(again, indent=2, default=str) + "\n")

    prod_after = {
        "wrim0_sha_after": sha256_file(wrim0_path),
        "wrim0_unchanged": sha256_file(wrim0_path) == PARENT_CHECKPOINT_SHA256,
        "wrim1_000001_registry_mtime_after": (
            (official_000001 / "checkpoint-registry.json").stat().st_mtime
            if (official_000001 / "checkpoint-registry.json").is_file() else None
        ),
        "production_exists": PRODUCTION_ROOT.exists(),
        "work_dir_is_not_production": str(work.resolve()) != str(PRODUCTION_ROOT.resolve()) if PRODUCTION_ROOT.exists() else True,
        "work_dir_is_not_000001": str(work.resolve()) != str(official_000001.resolve()),
    }
    prod_after["000001_registry_untouched"] = prod_before["wrim1_000001_registry_mtime"] == prod_after["wrim1_000001_registry_mtime_after"]

    final_delta = None
    if str(MAX_STEPS) in cap_evals:
        final_delta = cap_evals[str(MAX_STEPS)]["delta"]
    collapse_final = next((r.get("collapsed_probes") for r in reversed(diag_table) if r.get("collapsed_probes") is not None), None)
    no_collapse = collapse_final is not None and int(collapse_final) < 6
    gates = {
        "no_leak": packed["stream_leak_scan"]["passed"] and packed["stream_leak_scan"]["known_eval_leakage"] == 0,
        "no_collapse": no_collapse and not early_stop["stopped"],
        "reload_ok": all(r.get("ok") for r in reload_proof if r.get("step") is not None),
        "p0_improve": bool(final_delta and final_delta.get("p0_meaningful_improvements")),
        "p0_regression": bool(final_delta and final_delta.get("p0_regressions")),
        "repro_ok": bool(repro.get("ok")),
        "completed_502": (not early_stop["stopped"]) and global_step == MAX_STEPS and not crash["crashed"],
    }
    cand = candidate_verdict(gates) if gates["completed_502"] else "WRIM-1.1 CANDIDATE — NOT BETTER THAN WRIM-0"
    if gates["completed_502"] and cand == "WRIM-1.1 CANDIDATE — BETTER THAN WRIM-0":
        promo = "PROMOTION — RECOMMENDED"
    else:
        promo = "PROMOTION — REJECTED"
    run_verdict = "WRIM1-RUN-000002 — PASS" if gates["completed_502"] else "WRIM1-RUN-000002 — FAIL"

    ckpt_list = []
    if registry_path.is_file():
        ckpt_list = json.loads(registry_path.read_text()).get("checkpoints") or []
    final_sha = None
    final_ckpt = work / f"checkpoint-step-{global_step:06d}"
    if (final_ckpt / "checkpoint-manifest.json").is_file():
        final_sha = json.loads((final_ckpt / "checkpoint-manifest.json").read_text()).get("model_tensor_sha256")

    summary = {
        "run_id": RUN_ID,
        "official": True,
        "promoted": False,
        "parent_id": "WRIM-0",
        "parent_sha256": PARENT_CHECKPOINT_SHA256,
        "tokenizer_id": "WR-TOKENIZER-0",
        "tokenizer_sha256": TOKENIZER_SHA256,
        "curriculum_id": packed["curriculum_id"],
        "curriculum_stream_sha256": train_sha,
        "eval_id": EVAL_ID,
        "eval_suite_sha256": eval_sha,
        "environment": env,
        "architecture": {"id": "WRIM-G-20M-v1-option-A", "parameter_count": nparams},
        "optimizer": opt_cfg,
        "lr_schedule": {"peak": PEAK_LR, "warmup": WARMUP, "floor": PEAK_LR * FLOOR_RATIO, "total_steps": SCHEDULER_TOTAL},
        "planned_steps": MAX_STEPS,
        "completed_steps": global_step,
        "tokens_seen": cursor.tokens_consumed,
        "interruption_resume": interruption_log,
        "elapsed_sec": time.time() - t0,
        "checkpoints": ckpt_list,
        "final_checkpoint_sha256": final_sha,
        "packing": report,
        "mask_proof": packed["mask_proof"],
        "tool_proof": packed["tool_proof"],
        "causal_proof": {k: audit[k] for k in audit if k != "examples"},
        "leakage": packed["stream_leak_scan"],
        "global_mix": packed["token_pct"],
        "local_mix_preflight": {k: preflight[k] for k in preflight if k not in ("rolling_5", "rolling_10")},
        "source_local_ce": family_loss_rows[-8:],
        "n_clip_events": len(clip_events),
        "early_stop": early_stop,
        "nan_inf": nan_inf,
        "crash": crash,
        "reload_proof": reload_proof,
        "cap_eval_steps": {k: {"pass_count": v["pass_count"], "family_stats_short": v["family_stats_short"], "delta": v["delta"]} for k, v in cap_evals.items()},
        "final_delta": final_delta,
        "gates": gates,
        "run_verdict": run_verdict,
        "candidate_verdict": cand,
        "promotion_recommendation": promo,
        "production": {**prod_before, **prod_after},
        "diagnostics": [{"step": r["step"], "collapsed_probes": r.get("collapsed_probes"), "mean_unique_ratio": r.get("mean_unique_ratio"), "train_loss": r.get("train_loss"), "validation_loss": r.get("validation_loss"), "kl": (r.get("kl_to_wrim0") or {}).get("mean_kl_wrim0_to_current")} for r in diag_table],
        "kl_to_wrim0": kl_rows,
        "param_drift": [{"step": d["step"], "l2": d.get("global_param_l2_from_wrim0"), "relative": d.get("relative_param_drift"), "per_layer_cosine": d.get("per_layer_cosine_to_wrim0")} for d in drift_rows],
        "repro": repro,
        "pid": pid,
    }
    (work / "run-summary.json").write_text(json.dumps(summary, indent=2, default=str) + "\n")
    (work / "clip-events.json").write_text(json.dumps(clip_events, indent=2) + "\n")
    (work / "family-loss.json").write_text(json.dumps(family_loss_rows, indent=2) + "\n")
    (work / "actual-step-source-map.json").write_text(json.dumps({"steps": mix_rows}, indent=2) + "\n")

    registry = {
        "updated_at": iso_now(),
        "WRIM-0": {"status": "active_parent_unchanged", "sha256": PARENT_CHECKPOINT_SHA256, "promoted": True},
        "WRIM-1": {"run_id": "WRIM1-RUN-000001", "status": "trained_not_promoted", "promoted": False},
        "WRIM-1.1-CANDIDATE": {
            "run_id": RUN_ID,
            "status": "candidate_evaluated" if gates["completed_502"] else "failed",
            "promoted": False,
            "path": str(work),
            "final_sha256": final_sha,
            "run_verdict": run_verdict,
            "candidate_verdict": cand,
            "promotion_recommendation": promo,
        },
        "active_runtime": "UNCHANGED",
        "production": "UNCHANGED",
    }
    (work.parent / "run-registry.json").write_text(json.dumps(registry, indent=2) + "\n")

    print(json.dumps({
        "run_id": RUN_ID,
        "run_verdict": run_verdict,
        "candidate_verdict": cand,
        "promotion_recommendation": promo,
        "completed_steps": global_step,
        "early_stop": early_stop,
        "elapsed_sec": summary["elapsed_sec"],
        "work_dir": str(work),
    }, indent=2))
    return 0 if gates["completed_502"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
