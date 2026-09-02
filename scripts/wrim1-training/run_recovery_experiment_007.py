#!/usr/bin/env python3
"""TEST-WRIM1.1-RECOVERY-007. TEST_ONLY. Exact Recovery-006 recipe, 150-step endurance from WRIM-0. Does not overwrite 001–006."""
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
from contiguous_pack import leak_hits, materialize_recovery_mix  # noqa: E402
from dataset_cursor import DatasetCursor, initial_cursor, next_batch  # noqa: E402
from hashes import sha256_file, sha256_json, tensor_tree_sha256  # noqa: E402
from interleave_curriculum import (  # noqa: E402
    build_span_index,
    families_for_positions,
    local_mix_preflight,
    rolling_rehearsal,
    simulate_step_mix,
)
from paths import official_ckpt_dir, repo_root  # noqa: E402
from rng_state import capture_rng, lr_at_step  # noqa: E402
from trainer_core import append_metric, apply_mlx_limits, build_from_config, reconstruct_optimizer  # noqa: E402
from training_config import official_training_config, optimizer_config_from_training  # noqa: E402
from diagnose_collapse import generate, topk_diag  # noqa: E402
from recovery_instrumentation import (  # noqa: E402
    causal_and_mask_audit,
    unit_behavior_mask_audit,
    grad_instrumentation,
    kl_mean_from_logits,
    logits_for_windows,
    numpy_param_map,
    param_drift_vs_parent,
)
from run_recovery_experiment import (  # noqa: E402
    evaluate_val,
    iso_now,
    load_tokenizer,
    masked_loss_fn,
    run_suite,
)
from run_recovery_experiment_004 import collapse_gate_004, symbol_run  # noqa: E402

EXPERIMENT_ID = "TEST-WRIM1.1-RECOVERY-007"
WORK_REL = "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-007"
PRIOR_006_REL = "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-006"
PRIOR_SUITE_REL = "model-lab/manifests/wrim1_1_recovery/test-only/WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED.json"
VENV_PYTHON_REL = ".venv-wrim/bin/python"
MAX_STEPS = 150
CKPT_STEPS = (0, 10, 20, 25, 30, 40, 50, 60, 75, 90, 100, 120, 125, 150)
FULL_DIAG_STEPS = (0, 25, 50, 75, 100, 125, 150)
LIGHT_STEPS = tuple(range(0, 151, 5))
RELOAD_DIAG_STEPS = (0, 50, 100, 150)
PEAK_LR = 3e-5
WARMUP = 25
SCHEDULER_TOTAL = 150
BATCH = 8
CTX = 512
SEED = 20260830
FLOOR_RATIO = 0.1
MAX_REHEARSAL_PCT = 30.5
MIN_REHEARSAL_PCT = 29.5
EXPECTED_PY = (3, 12, 14)
EXPECTED_MLX = "0.32.2"
REPRO_STEPS = (25, 50)


def recovery_config() -> dict:
    cfg = official_training_config()
    cfg.update({
        "learning_rate": PEAK_LR,
        "warmup_steps": WARMUP,
        "total_steps": SCHEDULER_TOTAL,
        "planned_train_steps": MAX_STEPS,
        "batch_size": BATCH,
        "context_length": CTX,
        "validation_cadence_steps": 10,
        "checkpoint_cadence_steps": 10,
        "seed": SEED,
        "shuffle_strategy": "deficit_interleave_contiguous_windows",
        "test_only": True,
        "promotable": False,
        "lineage": "NOT_OFFICIAL_WRIM_LINEAGE",
        "experiment_id": EXPERIMENT_ID,
        "lr_rationale": (
            "RECOVERY-007: exact Recovery-006 LR recipe. Peak 3e-5, warmup 25, cosine "
            "horizon 150, floor 10% (3e-6). Horizon was already 150 in 006 (train 50). "
            "007 trains the full defined 150 steps; it does NOT stretch or redesign cosine."
        ),
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
        "python_version_tuple": list(sys.version_info[:3]),
        "python_ok": tuple(sys.version_info[:3]) == EXPECTED_PY,
        "machine": platform.machine(),
        "arm64": platform.machine() == "arm64",
        "mlx_version": mlx_ver,
        "mlx_ok": mlx_ver == EXPECTED_MLX,
        "device": device,
        "metal_available": metal,
        "gpu_device": device.startswith("Device(gpu"),
        "TEST_ONLY": True,
        "NOT_PRODUCTION": True,
    }
    info["passed"] = bool(
        info["executable_match"]
        and info["python_ok"]
        and info["arm64"]
        and info["mlx_ok"]
        and info["gpu_device"]
        and metal
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
        # target at t predicts stream[start+1+t]
        positions = np.arange(start + 1, start + 1 + ctx, dtype=np.int64)
        fams = families_for_positions(spans, positions)
        for t, fam in enumerate(fams):
            wt = float(w_np[i, t])
            if wt <= 0:
                continue
            acc[fam][0] += float(ce_np[i, t]) * wt
            acc[fam][1] += wt
    out = {}
    for fam, (s, n) in acc.items():
        out[fam] = None if n <= 0 else float(s / n)
    return out


def inspect_family_batches(rows: list[dict], train_stream, tokenizer) -> list[dict]:
    wanted = ["wr_corpus_0", "prose", "code", "json", "behavior"]
    found = {k: None for k in wanted}
    for r in rows:
        fam = r["dominant_source_family"]
        if fam in found and found[fam] is None:
            start = int(r["seq_starts"][0])
            sl = train_stream[start:start + 64]
            found[fam] = {
                "step": r["step"],
                "family": fam,
                "decode_prefix": tokenizer.decode(sl.tolist(), skip_special_tokens=False)[:240],
                "pct": r["pct"],
            }
        if all(v is not None for v in found.values()):
            break
    return [found[k] for k in wanted if found[k] is not None]


def planned_lr_schedule() -> list[dict]:
    rows = []
    for step in range(MAX_STEPS):
        lr = lr_at_step(step, SCHEDULER_TOTAL, PEAK_LR, WARMUP, FLOOR_RATIO)
        rows.append({
            "step": step,
            "learning_rate": lr,
            "exceeds_peak": lr > PEAK_LR + 1e-18,
        })
    return rows


def first50_schedule_payload(steps: list[dict]) -> list[dict]:
    out = []
    for r in steps[:50]:
        out.append({
            "step": r.get("step"),
            "seq_starts": r.get("seq_starts"),
            "token_counts": r.get("token_counts"),
            "pct": r.get("pct"),
            "dominant_source_family": r.get("dominant_source_family"),
            "rehearsal_pct": r.get("rehearsal_pct"),
            "prose_pct": r.get("prose_pct"),
            "code_pct": r.get("code_pct"),
            "json_pct": r.get("json_pct"),
            "behavior_pct": r.get("behavior_pct"),
        })
    return out


def compare_local_mix_to_006(planned: list[dict], prior_006: Path) -> dict:
    prev = json.loads((prior_006 / "planned-step-source-map.json").read_text(encoding="utf-8"))
    prev_steps = prev.get("steps") or []
    n = min(50, len(planned), len(prev_steps))
    mismatches = []
    for i in range(n):
        a = planned[i]
        b = prev_steps[i]
        if a.get("seq_starts") != b.get("seq_starts"):
            mismatches.append({"step": i + 1, "field": "seq_starts"})
        if a.get("dominant_source_family") != b.get("dominant_source_family"):
            mismatches.append({"step": i + 1, "field": "dominant_source_family"})
        for key in ("rehearsal_pct", "prose_pct", "code_pct", "json_pct", "behavior_pct"):
            da = float(a.get(key) or 0)
            db = float(b.get(key) or 0)
            if abs(da - db) > 1e-6:
                mismatches.append({"step": i + 1, "field": key, "007": da, "006": db})
    hash_007 = sha256_json(first50_schedule_payload(planned))
    hash_006 = sha256_json(first50_schedule_payload(prev_steps))
    return {
        "compared_steps": n,
        "seq_and_pct_mismatches": mismatches[:20],
        "n_mismatches": len(mismatches),
        "first50_input_schedule_sha256_007": hash_007,
        "first50_input_schedule_sha256_006": hash_006,
        "first50_input_schedule_match": hash_007 == hash_006,
        "material_difference": bool(mismatches) or hash_007 != hash_006,
        "passed": (not mismatches) and hash_007 == hash_006,
    }


def row_repro_metrics(row: dict) -> dict:
    kl = row.get("kl_to_wrim0") or {}
    dr = row.get("param_drift") or {}
    lg = row.get("logits") or {}
    return {
        "collapsed_probes": row.get("collapsed_probes"),
        "mean_unique_ratio": row.get("mean_unique_ratio"),
        "kl": kl.get("mean_kl_wrim0_to_current"),
        "param_l2": dr.get("global_param_l2_from_wrim0"),
        "entropy": lg.get("entropy"),
        "train_loss": row.get("train_loss"),
        "p_period": lg.get("p_period"),
        "p_pipe": lg.get("p_pipe"),
        "p_underscore": lg.get("p_underscore"),
        "sky": row.get("sky_continuation"),
        "symbol_run": row.get("symbol_run"),
    }


def reproduction_gate(step: int, row: dict, prior_006: Path) -> dict:
    ref_path = prior_006 / f"diagnostic-step-{step:06d}.json"
    if not ref_path.is_file():
        return {"step": step, "passed": False, "radical": True, "reason": f"missing 006 diagnostic {ref_path}"}
    ref = json.loads(ref_path.read_text(encoding="utf-8"))
    a = row_repro_metrics(row)
    b = row_repro_metrics(ref)
    reasons = []
    if a["collapsed_probes"] is None or abs(int(a["collapsed_probes"]) - int(b["collapsed_probes"])) >= 2:
        reasons.append(f"collapse {a['collapsed_probes']} vs 006 {b['collapsed_probes']}")
    if a["mean_unique_ratio"] is None or abs(float(a["mean_unique_ratio"]) - float(b["mean_unique_ratio"])) > 0.08:
        reasons.append(f"unique {a['mean_unique_ratio']} vs 006 {b['mean_unique_ratio']}")
    if a["kl"] is None or abs(float(a["kl"]) - float(b["kl"])) > 0.015:
        reasons.append(f"kl {a['kl']} vs 006 {b['kl']}")
    if a["param_l2"] is None or abs(float(a["param_l2"]) - float(b["param_l2"])) > 1.0:
        reasons.append(f"param_l2 {a['param_l2']} vs 006 {b['param_l2']}")
    return {
        "step": step,
        "passed": len(reasons) == 0,
        "radical": len(reasons) > 0,
        "reasons": reasons,
        "007": a,
        "006": b,
    }


def main() -> int:
    root = repo_root()
    work = root / WORK_REL
    work.mkdir(parents=True, exist_ok=True)
    official = official_ckpt_dir(root)
    prior_root = root / "model-lab/manifests/wrim1_1_recovery/test-only"
    prior_006 = root / PRIOR_006_REL
    priors = [
        prior_root / "experiment-summary.json",
        prior_root / "TEST-WRIM1.1-RECOVERY-002" / "experiment-summary.json",
        prior_root / "TEST-WRIM1.1-RECOVERY-003" / "experiment-summary.json",
        prior_root / "TEST-WRIM1.1-RECOVERY-004" / "experiment-summary.json",
        prior_root / "TEST-WRIM1.1-RECOVERY-004-FORENSIC-STEP45" / "findings-preview.json",
        prior_root / "TEST-WRIM1.1-RECOVERY-005" / "experiment-summary.json",
        prior_006 / "experiment-summary.json",
        prior_006 / "train.npy",
        prior_006 / "train-mask.npy",
        prior_006 / "planned-step-source-map.json",
        prior_006 / "retention-windows.npy",
        prior_006 / "lr-schedule.json",
        prior_006 / "optimizer-config.json",
        prior_006 / "diagnostic-step-000050.json",
        prior_006 / "WRIM-RECOVERY-006-EXPANDED-100.json",
    ]
    for p in priors:
        if not p.is_file():
            print(f"prior artifact missing ({p}); aborting so 001–006 stay intact", file=sys.stderr)
            return 2
    forbidden = {p.parent.resolve() for p in priors if "TEST-WRIM1.1-RECOVERY-" in str(p)}
    if work.resolve() in forbidden or work.resolve() == prior_006.resolve():
        print("refusing to write 007 into a prior experiment directory", file=sys.stderr)
        return 2

    env = verify_wrim_env(root)
    (work / "environment.json").write_text(json.dumps(env, indent=2) + "\n")
    if not env["passed"]:
        print(json.dumps({"error": "WRIM python/MLX environment failed", "env": env}, indent=2))
        return 2

    suite = json.loads((root / PRIOR_SUITE_REL).read_text(encoding="utf-8"))
    if len(suite.get("items") or []) != 13:
        print("diagnostic suite is not the frozen 13-probe extension; aborting", file=sys.stderr)
        return 2
    (work / "WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED.json").write_text(json.dumps(suite, indent=2) + "\n")

    tokenizer = load_tokenizer(root)
    packed = materialize_recovery_mix(
        root=root,
        tokenizer=tokenizer,
        seed=SEED,
        target_tokens=400_000,
        rehearsal_frac=0.30,
        mix_profile="recovery_005_interleaved",
    )
    report = packed["report"]
    (work / "data-mix-report.json").write_text(json.dumps(report, indent=2) + "\n")
    if report["held_out_leak_count"] != 0:
        print("held-out leak scan failed; experiment not started", file=sys.stderr)
        return 2
    if float(report["rehearsal_pct"]) > MAX_REHEARSAL_PCT or float(report["rehearsal_pct"]) < MIN_REHEARSAL_PCT:
        print(json.dumps({"error": "rehearsal band failed", "rehearsal_pct": report["rehearsal_pct"]}))
        return 2
    mix_gate = report.get("mix_gate") or {}
    if not mix_gate.get("passed", False):
        print(json.dumps({"error": "data-mix gate failed; not training", "mix_gate": mix_gate}))
        return 2

    np.save(work / "train.npy", packed["train_stream"])
    np.save(work / "train-mask.npy", packed["train_mask"])
    np.save(work / "val.npy", packed["val_stream"])
    np.save(work / "val-mask.npy", packed["val_mask"])
    train_stream = packed["train_stream"]
    train_mask = packed["train_mask"]
    val_stream = packed["val_stream"]
    val_mask = packed["val_mask"]
    if train_stream.size < CTX + 1 or val_stream.size < CTX + 1:
        print(json.dumps({"error": "packed streams too short", "train": int(train_stream.size)}))
        return 2

    prev_train = np.load(prior_006 / "train.npy")
    prev_mask = np.load(prior_006 / "train-mask.npy")
    prev_val = np.load(prior_006 / "val.npy")
    stream_cmp = {
        "train_equal": bool(np.array_equal(train_stream, prev_train)),
        "train_mask_equal": bool(np.array_equal(train_mask, prev_mask)),
        "val_equal": bool(np.array_equal(val_stream, prev_val)),
        "train_len_007": int(train_stream.size),
        "train_len_006": int(prev_train.size),
        "train_sha256_007": sha256_file(work / "train.npy"),
        "train_sha256_006": sha256_file(prior_006 / "train.npy"),
    }
    (work / "stream-identity-vs-006.json").write_text(json.dumps(stream_cmp, indent=2) + "\n")
    if not (stream_cmp["train_equal"] and stream_cmp["train_mask_equal"]):
        print(json.dumps({
            "error": "packed train stream differs from Recovery-006; comparability broken; not training",
            "stream_cmp": stream_cmp,
        }, indent=2))
        return 2

    planned = simulate_step_mix(
        train_stream=train_stream,
        train_mask=train_mask,
        units=packed["train_units"],
        ctx=CTX,
        batch=BATCH,
        seed=SEED,
        n_steps=MAX_STEPS,
    )
    preflight = local_mix_preflight(planned)
    planned_out = {
        "steps": planned,
        "preflight": {k: preflight[k] for k in preflight if k not in ("rolling_5", "rolling_10")},
        "rolling_5": preflight["rolling_5"],
        "rolling_10": preflight["rolling_10"],
    }
    (work / "planned-step-source-map.json").write_text(json.dumps(planned_out, indent=2) + "\n")
    (work / "contiguity-proof.json").write_text(json.dumps({
        "split": (report.get("interleave") or {}).get("split_preserves_tokens"),
        "interleave_unit_order_only": (report.get("interleave") or {}).get("interleave_unit_order_only"),
        "shuffle": report.get("shuffle"),
        "contiguous": report.get("contiguous"),
        "no_token_permutation": True,
        "no_new_bos_eos_policy": True,
    }, indent=2) + "\n")
    if not preflight["passed"]:
        print(json.dumps({
            "error": "local mix preflight failed; not training",
            "stop_reasons": preflight["stop_reasons"],
        }, indent=2))
        return 2
    mix_cmp = compare_local_mix_to_006(planned, prior_006)
    (work / "local-mix-vs-006.json").write_text(json.dumps(mix_cmp, indent=2) + "\n")
    if not mix_cmp["passed"]:
        print(json.dumps({
            "error": "first-50 local scheduling differs from Recovery-006; not training",
            "mix_cmp": mix_cmp,
        }, indent=2))
        return 2
    longest_reh = preflight.get("longest_rehearsal_only_steps")
    if longest_reh is None or int(longest_reh) != 0:
        print(json.dumps({
            "error": "longest 100% rehearsal-only run is not 0; not training",
            "longest": longest_reh,
        }, indent=2))
        return 2

    audit = causal_and_mask_audit(
        train_stream=train_stream,
        train_mask=train_mask,
        tokenizer=tokenizer,
        ctx=CTX,
        batch=BATCH,
        seed=SEED,
        n_batches=12,
    )
    audit["family_batch_samples"] = inspect_family_batches(planned, train_stream, tokenizer)
    (work / "causal-batch-audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    if not audit["passed"]:
        print(json.dumps({"error": "causal-target audit failed; not training"}))
        return 2
    unit_masks = unit_behavior_mask_audit(packed["train_units"], tokenizer)
    (work / "unit-mask-audit.json").write_text(json.dumps(unit_masks, indent=2) + "\n")
    if not unit_masks["passed"]:
        print(json.dumps({"error": "unit-level mask audit failed; not training"}))
        return 2

    cfg = recovery_config()
    identities = {
        "test_only": True,
        "promotable": False,
        "lineage": "NOT_OFFICIAL_WRIM_LINEAGE",
        "NOT_PRODUCTION": True,
        "experiment_id": EXPERIMENT_ID,
        "parent_checkpoint_path": str(root / PARENT_CHECKPOINT_REL),
        "parent_checkpoint_sha256": PARENT_CHECKPOINT_SHA256,
        "tokenizer_sha256": TOKENIZER_SHA256,
        "training_config_sha256": sha256_json(cfg),
    }
    run_manifest = {
        "run_id": EXPERIMENT_ID,
        "test_only": True,
        "promotable": False,
        "NOT_OFFICIAL_WRIM_LINEAGE": True,
        "NOT_PRODUCTION": True,
        "NOT_PROMOTABLE": True,
        "parent_checkpoint_sha256": PARENT_CHECKPOINT_SHA256,
        "training_config_sha256": identities["training_config_sha256"],
        "authorization": "COMMANDER_RECOVERY_007_LOW_LR_ENDURANCE_ONLY",
        "prior_experiment_ids": [
            "TEST-WRIM1.1-RECOVERY-001",
            "TEST-WRIM1.1-RECOVERY-002",
            "TEST-WRIM1.1-RECOVERY-003",
            "TEST-WRIM1.1-RECOVERY-004",
            "TEST-WRIM1.1-RECOVERY-004-FORENSIC-STEP45",
            "TEST-WRIM1.1-RECOVERY-005",
            "TEST-WRIM1.1-RECOVERY-006",
        ],
    }
    (work / "run-manifest.json").write_text(json.dumps(run_manifest, indent=2) + "\n")
    (work / "training-config.json").write_text(json.dumps(cfg, indent=2) + "\n")
    opt_cfg_now = optimizer_config_from_training(cfg)
    (work / "optimizer-config.json").write_text(json.dumps(opt_cfg_now, indent=2) + "\n")
    lr_rows = planned_lr_schedule()
    initial_lr = lr_rows[0]["learning_rate"]
    floor_lr = PEAK_LR * FLOOR_RATIO
    prev_lr = json.loads((prior_006 / "lr-schedule.json").read_text(encoding="utf-8"))
    prev_lr_first50 = (prev_lr.get("schedule") or [])[:50]
    lr_first50_007 = [{"step": r["step"], "learning_rate": r["learning_rate"]} for r in lr_rows[:50]]
    lr_first50_006 = [{"step": r["step"], "learning_rate": r["learning_rate"]} for r in prev_lr_first50]
    lr_hash_007 = sha256_json(lr_first50_007)
    lr_hash_006 = sha256_json(lr_first50_006)
    prev_opt = json.loads((prior_006 / "optimizer-config.json").read_text(encoding="utf-8"))
    opt_match = {
        k: opt_cfg_now.get(k) == prev_opt.get(k)
        for k in ("optimizer", "learning_rate", "betas", "eps", "weight_decay", "gradient_clipping")
    }
    lr_plan = {
        "peak_lr": PEAK_LR,
        "warmup_steps": WARMUP,
        "scheduler_total_steps": SCHEDULER_TOTAL,
        "floor_ratio": FLOOR_RATIO,
        "floor_lr": floor_lr,
        "initial_lr": initial_lr,
        "horizon_note": (
            "Recovery-006 already defined cosine total_steps=150 and trained 50. "
            "Recovery-007 trains 150 steps on that same defined horizon. Cosine is not stretched."
        ),
        "max_planned_lr": max(r["learning_rate"] for r in lr_rows),
        "any_exceeds_peak": any(r["exceeds_peak"] for r in lr_rows),
        "first50_lr_sha256_007": lr_hash_007,
        "first50_lr_sha256_006": lr_hash_006,
        "first50_lr_match": lr_hash_007 == lr_hash_006,
        "schedule": lr_rows,
    }
    (work / "lr-schedule.json").write_text(json.dumps(lr_plan, indent=2) + "\n")
    comparability = {
        "stream_identity_vs_006": stream_cmp,
        "local_mix_vs_006": mix_cmp,
        "first50_lr_match": lr_plan["first50_lr_match"],
        "first50_lr_sha256_007": lr_hash_007,
        "first50_lr_sha256_006": lr_hash_006,
        "optimizer_field_match": opt_match,
        "optimizer_match": all(opt_match.values()),
        "scheduler_horizon_unmodified": SCHEDULER_TOTAL == 150,
        "passed": (
            stream_cmp["train_equal"]
            and stream_cmp["train_mask_equal"]
            and mix_cmp["passed"]
            and lr_plan["first50_lr_match"]
            and all(opt_match.values())
        ),
    }
    (work / "first50-comparability.json").write_text(json.dumps(comparability, indent=2) + "\n")
    if lr_plan["any_exceeds_peak"] or lr_plan["max_planned_lr"] > PEAK_LR + 1e-18:
        print(json.dumps({"error": "planned LR exceeds 3e-5; not training", "lr_plan": lr_plan}))
        return 2
    if not comparability["passed"]:
        print(json.dumps({
            "error": "first-50 comparability vs Recovery-006 failed; not training",
            "comparability": comparability,
        }, indent=2))
        return 2

    import mlx.core as mx
    import mlx.nn as nn
    import mlx.utils
    import random

    apply_mlx_limits(cfg)
    mx.random.seed(SEED)
    rng = np.random.default_rng(SEED)
    random.seed(SEED)

    model, arch, nparams = build_from_config(cfg, SEED)
    parent_path = root / PARENT_CHECKPOINT_REL
    parent_file_sha = sha256_file(parent_path)
    if parent_file_sha != PARENT_CHECKPOINT_SHA256:
        raise RuntimeError("WRIM-0 file hash mismatch")
    load_info = load_parent_wrim0_weights(model, parent_path, PARENT_CHECKPOINT_SHA256)
    loaded = model_to_numpy(model)
    loaded_sha = tensor_tree_sha256(loaded)
    raw = load_file(str(parent_path))
    parent_tensors = {k[6:]: v for k, v in raw.items() if k.startswith("model.")}
    parent_sha = tensor_tree_sha256(parent_tensors)
    max_abs = 0.0
    for k in loaded:
        max_abs = max(max_abs, float(np.max(np.abs(loaded[k].astype(np.float64) - parent_tensors[k].astype(np.float64)))))
    parent_proof = {
        "file_sha256": parent_file_sha,
        "expected": PARENT_CHECKPOINT_SHA256,
        "file_match": parent_file_sha == PARENT_CHECKPOINT_SHA256,
        "loaded_tensor_tree_sha256": loaded_sha,
        "parent_tensor_tree_sha256": parent_sha,
        "tensor_tree_match": loaded_sha == parent_sha,
        "max_abs_diff": max_abs,
        "nparams": nparams,
        "load_info": load_info,
        "before_optimizer_step": True,
    }
    (work / "wrim0-load-proof.json").write_text(json.dumps(parent_proof, indent=2) + "\n")
    if not parent_proof["file_match"] or not parent_proof["tensor_tree_match"] or max_abs != 0.0:
        print("WRIM-0 load proof failed", file=sys.stderr)
        return 2

    parent_np = numpy_param_map(model)
    frozen_windows = np.load(prior_006 / "retention-windows.npy")
    frozen_meta = json.loads((prior_006 / "retention-windows-meta.json").read_text(encoding="utf-8"))
    ret = {**frozen_meta, "windows": frozen_windows, "frozen_from": "TEST-WRIM1.1-RECOVERY-006"}
    if ret.get("leak_hits"):
        print(json.dumps({"error": "frozen retention windows leaked held-out prompts", "hits": ret["leak_hits"]}))
        return 2
    np.save(work / "retention-windows.npy", ret["windows"])
    (work / "retention-windows-meta.json").write_text(json.dumps({
        **{k: ret[k] for k in ret if k != "windows"},
        "equal_to_006": bool(np.array_equal(frozen_windows, np.load(prior_006 / "retention-windows.npy"))),
    }, indent=2) + "\n")
    parent_ret_logits = logits_for_windows(model, ret["windows"])
    np.save(work / "retention-parent-logits.npy", parent_ret_logits)
    kl0 = kl_mean_from_logits(parent_ret_logits, parent_ret_logits)

    expanded_suite = json.loads((prior_006 / "WRIM-RECOVERY-006-EXPANDED-100.json").read_text(encoding="utf-8"))
    extra_items = expanded_suite.get("expanded_87") or []
    expanded_suite = {
        **expanded_suite,
        "suite_id": "WRIM-RECOVERY-007-EXPANDED-100",
        "frozen_from": "TEST-WRIM1.1-RECOVERY-006",
        "original_13": suite["items"],
        "n_total": 13 + len(extra_items),
    }
    (work / "WRIM-RECOVERY-007-EXPANDED-100.json").write_text(json.dumps(expanded_suite, indent=2) + "\n")
    if any(leak_hits(it["input"]) for it in extra_items):
        print("expanded suite leak; not training", file=sys.stderr)
        return 2

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
    logit_rows = []
    light_rows = []
    drift_rows = []
    kl_rows = []
    grad_rows = []
    mix_rows = []
    family_loss_rows = []
    transitions = []
    clip_events = []
    repro_rows = []
    early_stop = {"stopped": False, "reason": "", "step": None}
    last_ckpt = None
    t0 = time.time()
    last_grad_row = None
    prev_fam = None
    prev_loss = None
    prev_grad = None
    pid = os.getpid()

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
            "run_id": EXPERIMENT_ID,
            "global_step": step,
            "epoch": cursor_now.epoch,
            "tokens_seen": cursor_now.tokens_consumed,
            "test_only": True,
            "promotable": False,
            "run_status": status,
            "updated_at": iso_now(),
            "latest_validation_metrics": val_metrics,
        }
        manifest = write_checkpoint_bundle(
            dest_dir=dest,
            checkpoint_id=ckpt_id,
            run_id=EXPERIMENT_ID,
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
            "run_id": EXPERIMENT_ID,
            "path": str(dest),
            "step": step,
            "sha": manifest["model_tensor_sha256"],
            "status": "complete",
            "promotable": False,
            "test_only": True,
            "lineage": "NOT_OFFICIAL_WRIM_LINEAGE",
        })
        last_ckpt = ckpt_id
        return dest, manifest

    def diagnose(step: int, val_metrics: dict | None, train_loss: float | None, full: bool):
        suite_out = run_suite(model, tokenizer, suite["items"])
        sky_sym = symbol_run(suite_out["sky_continuation"])
        suite_out["symbol_run"] = sky_sym["symbol_run"]
        lg = topk_diag(model, tokenizer, "The sky is")
        lg["step"] = step
        logit_rows.append(lg)
        samp = generate(model, tokenizer, "The sky is", 24, temperature=0.7)
        drift = param_drift_vs_parent(numpy_param_map(model), parent_np)
        drift["step"] = step
        drift_rows.append(drift)
        cur_logits = logits_for_windows(model, ret["windows"])
        kl = {"step": step, **kl_mean_from_logits(parent_ret_logits, cur_logits)}
        kl_rows.append(kl)
        expanded = None
        if full and extra_items:
            expanded = run_suite(model, tokenizer, extra_items, max_new=16)
        row = {
            "step": step,
            "full": full,
            "train_loss": train_loss,
            "validation_loss": None if val_metrics is None else val_metrics.get("validation_loss"),
            "learning_rate": lr_at_step(max(0, step - 1) if step else 0, SCHEDULER_TOTAL, PEAK_LR, WARMUP, FLOOR_RATIO) if step else lr_at_step(0, SCHEDULER_TOTAL, PEAK_LR, WARMUP, FLOOR_RATIO),
            "logits": {
                "p_period": lg.get("p_period"),
                "p_eos": lg.get("p_eos"),
                "p_pipe": lg.get("p_pipe"),
                "p_underscore": lg.get("p_underscore"),
                "entropy": lg.get("entropy"),
                "top": (lg.get("top") or [None])[0],
                "finite": lg.get("finite"),
            },
            "temp07_sky": samp["continuation"],
            "param_drift": drift,
            "kl_to_wrim0": kl,
            "expanded_collapsed_probes": None if expanded is None else expanded["collapsed_probes"],
            "expanded_mean_unique_ratio": None if expanded is None else expanded["mean_unique_ratio"],
            "expanded_n": None if expanded is None else expanded["n_probes"],
            **{k: suite_out[k] for k in suite_out if k != "items"},
            **sky_sym,
            "language_outputs": {it["id"]: it["continuation"] for it in suite_out["items"]},
        }
        if last_grad_row:
            row["global_grad_l2"] = last_grad_row.get("global_grad_l2")
            row["per_layer_grad_l2"] = last_grad_row.get("per_layer_grad_l2")
        dest = work / (f"diagnostic-step-{step:06d}.json" if full else f"light-step-{step:06d}.json")
        dest.write_text(json.dumps({**row, "items": suite_out["items"]}, indent=2, default=str) + "\n")
        if full:
            diag_table.append(row)
        else:
            light_rows.append(row)
        return suite_out, lg, row

    val0 = evaluate_val(model, val_stream, val_mask, cfg, vocab)
    save_ckpt(0, cursor, "TEST_ONLY", val0)
    s0, lg0, row0 = diagnose(0, val0, None, full=True)
    step0_row = diag_table[0]
    sky0 = (step0_row.get("sky_continuation") or "")
    top0 = ((lg0.get("top") or [{}])[0].get("tok") or "")
    if step0_row["collapsed_probes"] != 2 or not sky0.startswith(" a") or top0 != " a":
        early_stop = {
            "stopped": True,
            "reason": (
                f"step-0 mismatch vs RECOVERY-001/WRIM-0 baseline "
                f"collapsed={step0_row['collapsed_probes']} top={top0!r} sky={sky0[:40]!r}"
            ),
            "step": 0,
        }
        (work / "experiment-summary.json").write_text(json.dumps({
            "experiment_id": EXPERIMENT_ID,
            "early_stop": early_stop,
            "step0": step0_row,
            "parent_load_proof": parent_proof,
        }, indent=2, default=str) + "\n")
        print(json.dumps({"status": "STEP0_MISMATCH", "early_stop": early_stop}, indent=2))
        return 2

    global_step = 0
    last_train_loss = None
    nan_inf = False
    crash = {"crashed": False, "pid": pid}
    try:
        while global_step < MAX_STEPS:
            x_np, y_np, w_np, cursor = next_batch(train_stream, cursor, loss_mask=train_mask)
            planned_row = planned[global_step] if global_step < len(planned) else None
            mix = planned_row
            if mix is None:
                mix = {"step": global_step + 1, "pct": {}, "dominant_source_family": "unknown", "token_counts": {}}
            mix_rows.append(mix)
            seq_starts = mix.get("seq_starts") or []
            if not np.array_equal(y_np[:, :-1], x_np[:, 1:]):
                early_stop = {"stopped": True, "reason": "causal target corruption y[t]!=x[t+1]", "step": global_step + 1}
                break
            x = mx.array(x_np)
            y = mx.array(y_np)
            w = mx.array(w_np)
            lr = lr_at_step(global_step, SCHEDULER_TOTAL, PEAK_LR, WARMUP, FLOOR_RATIO)
            if lr > PEAK_LR + 1e-18:
                early_stop = {"stopped": True, "reason": f"LR {lr} exceeded peak {PEAK_LR}", "step": global_step + 1}
                break
            opt.learning_rate = lr
            loss, grads = loss_and_grad(model, x, y, w)
            ginfo = grad_instrumentation(grads)
            last_grad_row = ginfo
            fam_ce = family_ce_on_batch(model, x, y, w, vocab, spans, seq_starts, CTX)
            family_loss_rows.append({"step": global_step + 1, "ce_by_family": fam_ce, "mix": mix.get("pct")})
            grad_leaves = [g for _, g in mlx.utils.tree_flatten(grads)]
            grad_norm_sq = sum(mx.sum(g.astype(mx.float32) ** 2) for g in grad_leaves)
            grad_norm = mx.sqrt(grad_norm_sq)
            clip_coef = mx.minimum(1.0, clip_limit / (grad_norm + 1e-6))
            grads = mlx.utils.tree_map(lambda g: g * clip_coef, grads)
            mx.eval(loss, grad_norm)
            loss_val = float(loss.item())
            grad_val = float(grad_norm.item())
            clipped = grad_val > clip_limit
            grad_rows.append({
                "step": global_step + 1,
                **ginfo,
                "learning_rate": lr,
                "clip_applied": clipped,
                "clip_coef": float(min(1.0, clip_limit / (grad_val + 1e-6))),
            })
            if clipped:
                clip_events.append({"step": global_step + 1, "global_grad_l2": grad_val, "clip_limit": clip_limit})
            fam = mix.get("dominant_source_family")
            if prev_fam is not None and fam != prev_fam:
                transitions.append({
                    "step": global_step + 1,
                    "previous_family": prev_fam,
                    "next_family": fam,
                    "train_loss_before": prev_loss,
                    "train_loss_after": loss_val,
                    "grad_norm_before": prev_grad,
                    "grad_norm_after": ginfo.get("global_grad_l2"),
                })
            if not math.isfinite(loss_val) or not math.isfinite(grad_val):
                nan_inf = True
                early_stop = {"stopped": True, "reason": f"NaN/Inf loss={loss_val} grad={grad_val}", "step": global_step + 1}
                break
            if loss_val > 50:
                early_stop = {"stopped": True, "reason": f"exploding loss {loss_val}", "step": global_step + 1}
                break
            opt.update(model, grads)
            mx.eval(model.parameters(), opt.state)
            mx.clear_cache()
            global_step += 1
            last_train_loss = loss_val
            prev_fam = fam
            prev_loss = loss_val
            prev_grad = ginfo.get("global_grad_l2")
            rec = {
                "kind": "train",
                "step": global_step,
                "epoch": cursor.epoch,
                "tokens_seen": cursor.tokens_consumed,
                "train_loss": loss_val,
                "learning_rate": lr,
                "global_grad_l2": ginfo.get("global_grad_l2"),
                "clip_applied": clipped,
                "dominant_source_family": fam,
                "rehearsal_pct": mix.get("rehearsal_pct"),
                "prose_pct": mix.get("prose_pct"),
                "code_pct": mix.get("code_pct"),
                "json_pct": mix.get("json_pct"),
                "behavior_pct": mix.get("behavior_pct"),
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
                save_ckpt(global_step, cursor, "TEST_ONLY", val_metrics)
            if do_full or do_light:
                suite_out, lg, row = diagnose(global_step, val_metrics, loss_val, full=do_full)
                stop, reason = collapse_gate_004(
                    step0_row,
                    {**suite_out, **symbol_run(suite_out["sky_continuation"]), "global_grad_l2": ginfo.get("global_grad_l2")},
                    lg,
                    ginfo,
                )
                if nan_inf or stop:
                    early_stop = {"stopped": True, "reason": reason, "step": global_step}
                    if global_step not in CKPT_STEPS:
                        save_ckpt(global_step, cursor, "TEST_ONLY_EARLY_STOP", val_metrics)
                    break
                if global_step in REPRO_STEPS:
                    gate = reproduction_gate(global_step, row, prior_006)
                    repro_rows.append(gate)
                    (work / f"reproduction-gate-step-{global_step:06d}.json").write_text(
                        json.dumps(gate, indent=2, default=str) + "\n"
                    )
                    if not gate["passed"]:
                        early_stop = {
                            "stopped": True,
                            "reason": f"Recovery-006 reproduction failed at step {global_step}: {gate.get('reasons')}",
                            "step": global_step,
                        }
                        if global_step not in CKPT_STEPS:
                            save_ckpt(global_step, cursor, "TEST_ONLY_REPRO_FAIL", val_metrics)
                        break
    except Exception as exc:  # noqa: BLE001
        crash = {
            "crashed": True,
            "pid": pid,
            "timestamp": iso_now(),
            "type": type(exc).__name__,
            "message": str(exc),
            "step": global_step,
        }
        (work / "crash-report.json").write_text(json.dumps(crash, indent=2) + "\n")
        early_stop = {"stopped": True, "reason": f"python/mlx crash: {exc}", "step": global_step}
        print(json.dumps({"error": "training crash", "crash": crash}, indent=2))
        # fall through to write summary; do not silently resume

    if not early_stop["stopped"] and global_step not in FULL_DIAG_STEPS:
        val_metrics = evaluate_val(model, val_stream, val_mask, cfg, vocab)
        save_ckpt(global_step, cursor, "TEST_ONLY_COMPLETED", val_metrics)
        diagnose(global_step, val_metrics, last_train_loss, full=True)
    elif not early_stop["stopped"] and global_step in CKPT_STEPS:
        pass

    actual_preflight = local_mix_preflight(mix_rows) if mix_rows else preflight
    (work / "actual-step-source-map.json").write_text(json.dumps({
        "steps": mix_rows,
        "rolling_5": rolling_rehearsal(mix_rows, 5) if mix_rows else [],
        "rolling_10": rolling_rehearsal(mix_rows, 10) if mix_rows else [],
        "longest_rehearsal_only": {
            "steps": actual_preflight.get("longest_rehearsal_only_steps"),
            "span": actual_preflight.get("longest_rehearsal_only_span"),
        },
        "longest_non_rehearsal_only": {
            "steps": actual_preflight.get("longest_non_rehearsal_only_steps"),
            "span": actual_preflight.get("longest_non_rehearsal_only_span"),
        },
    }, indent=2) + "\n")
    (work / "source-transitions.json").write_text(json.dumps(transitions, indent=2) + "\n")
    (work / "family-loss.json").write_text(json.dumps(family_loss_rows, indent=2) + "\n")
    (work / "clip-events.json").write_text(json.dumps(clip_events, indent=2) + "\n")

    reload_proof = []
    for step in [r["step"] for r in diag_table]:
        ckpt = work / f"checkpoint-step-{step:06d}"
        if not (ckpt / "checkpoint-manifest.json").is_file():
            reload_proof.append({"step": step, "ok": False, "detail": "missing"})
            continue
        bundle = load_bundle(ckpt)
        m2, _, _ = build_from_config(cfg, SEED)
        load_model_weights(m2, bundle["model"], strict=True)
        sha = tensor_tree_sha256(model_to_numpy(m2))
        reload_proof.append({
            "step": step,
            "ok": True,
            "reloaded_sha": sha,
            "bundle_sha": bundle["manifest"]["model_tensor_sha256"],
            "sha_match": sha == bundle["manifest"]["model_tensor_sha256"],
        })
    if diag_table:
        m0 = build_from_config(cfg, SEED)[0]
        b0 = load_bundle(work / "checkpoint-step-000000")
        load_model_weights(m0, b0["model"], strict=True)
        reload_proof.append({"step0_matches_wrim0": tensor_tree_sha256(model_to_numpy(m0)) == parent_sha})

    reload_diag = []
    for step in RELOAD_DIAG_STEPS:
        if step > global_step:
            continue
        ckpt = work / f"checkpoint-step-{step:06d}"
        if not (ckpt / "checkpoint-manifest.json").is_file():
            reload_diag.append({"step": step, "ok": False, "detail": "missing checkpoint"})
            continue
        bundle = load_bundle(ckpt)
        m2, _, _ = build_from_config(cfg, SEED)
        load_model_weights(m2, bundle["model"], strict=True)
        suite_reload = run_suite(m2, tokenizer, suite["items"])
        live = next((r for r in diag_table if r["step"] == step), None)
        live_c = None if live is None else live.get("collapsed_probes")
        reload_diag.append({
            "step": step,
            "ok": True,
            "reloaded_collapsed_probes": suite_reload["collapsed_probes"],
            "reloaded_mean_unique_ratio": suite_reload["mean_unique_ratio"],
            "live_collapsed_probes": live_c,
            "collapse_match_live": live_c is None or suite_reload["collapsed_probes"] == live_c,
        })

    official_entries = []
    if (official / "checkpoint-registry.json").is_file():
        official_entries = json.loads((official / "checkpoint-registry.json").read_text()).get("checkpoints") or []

    initial_lr = lr_at_step(0, SCHEDULER_TOTAL, PEAK_LR, WARMUP, FLOOR_RATIO)
    floor_lr = PEAK_LR * FLOOR_RATIO
    summary = {
        "experiment_id": EXPERIMENT_ID,
        "test_only": True,
        "NOT_PROMOTABLE": True,
        "NOT_OFFICIAL_WRIM_LINEAGE": True,
        "NOT_PRODUCTION": True,
        "prior_experiment_ids": run_manifest["prior_experiment_ids"],
        "environment": env,
        "parent_sha256": PARENT_CHECKPOINT_SHA256,
        "parent_load_proof": parent_proof,
        "data_mix": report,
        "stream_identity_vs_006": stream_cmp,
        "local_mix_vs_006": mix_cmp,
        "first50_comparability": comparability,
        "reproduction_gates": repro_rows,
        "reload_diagnostics": reload_diag,
        "lr_schedule": {
            "peak_lr": PEAK_LR,
            "initial_lr": initial_lr,
            "warmup_steps": WARMUP,
            "scheduler_total_steps": SCHEDULER_TOTAL,
            "floor_lr": floor_lr,
            "floor_ratio": FLOOR_RATIO,
        },
        "causal_batch_audit": {k: audit[k] for k in audit if k != "examples"},
        "unit_mask_audit": unit_masks,
        "local_mix_preflight_passed": preflight["passed"],
        "retention_kl_step0": kl0,
        "expanded_suite_n": 13 + len(extra_items),
        "planned_steps": MAX_STEPS,
        "completed_steps": global_step,
        "early_stop": early_stop,
        "nan_inf": nan_inf,
        "crash": crash,
        "pid": pid,
        "peak_lr": PEAK_LR,
        "initial_lr": initial_lr,
        "warmup_steps": WARMUP,
        "scheduler_total_steps": SCHEDULER_TOTAL,
        "floor_lr": floor_lr,
        "optimizer": opt_cfg,
        "elapsed_sec": time.time() - t0,
        "diagnostics": diag_table,
        "light_diagnostics": light_rows,
        "logit_drift": logit_rows,
        "grad_instrumentation": grad_rows,
        "param_drift": drift_rows,
        "kl_to_wrim0": kl_rows,
        "n_source_transitions": len(transitions),
        "n_clip_events": len(clip_events),
        "reload_proof": reload_proof,
        "official_wrim1_checkpoint_count": len(official_entries),
        "official_dir_untouched_by_path": str(work.resolve()) != str(official.resolve()),
        "collapse_detected": bool(early_stop["stopped"]),
    }
    (work / "experiment-summary.json").write_text(json.dumps(summary, indent=2, default=str) + "\n")
    print(json.dumps({
        "experiment_id": EXPERIMENT_ID,
        "completed_steps": global_step,
        "early_stop": early_stop,
        "elapsed_sec": summary["elapsed_sec"],
        "rehearsal_pct": report["rehearsal_pct"],
        "held_out_leak_count": report["held_out_leak_count"],
        "train_tokens": report["train_tokens"],
        "preflight_passed": preflight["passed"],
        "crash": crash,
        "work_dir": str(work),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
