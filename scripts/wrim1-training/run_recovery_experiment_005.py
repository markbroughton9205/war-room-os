#!/usr/bin/env python3
"""TEST-WRIM1.1-RECOVERY-005. TEST_ONLY. Interleaved rehearsal. Does not overwrite 001–004."""
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
    build_expanded_prompts,
    build_retention_windows,
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

EXPERIMENT_ID = "TEST-WRIM1.1-RECOVERY-005"
WORK_REL = "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-005"
PRIOR_SUITE_REL = "model-lab/manifests/wrim1_1_recovery/test-only/WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED.json"
VENV_PYTHON_REL = ".venv-wrim/bin/python"
MAX_STEPS = 50
CKPT_STEPS = (0, 10, 20, 25, 30, 35, 40, 45, 50)
FULL_DIAG_STEPS = (0, 10, 25, 35, 40, 45, 50)
LIGHT_STEPS = tuple(range(0, 51, 5))
PEAK_LR = 3e-4
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
            "RECOVERY-005: hold Recovery-004 LR/optimizer/mix. Peak 3e-4, warmup 25, cosine "
            "floor 10% with scheduler horizon 150 (train only 50). Primary variable is "
            "temporal interleaving of contiguous rehearsal windows."
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


def main() -> int:
    root = repo_root()
    work = root / WORK_REL
    work.mkdir(parents=True, exist_ok=True)
    official = official_ckpt_dir(root)
    prior_root = root / "model-lab/manifests/wrim1_1_recovery/test-only"
    priors = [
        prior_root / "experiment-summary.json",
        prior_root / "TEST-WRIM1.1-RECOVERY-002" / "experiment-summary.json",
        prior_root / "TEST-WRIM1.1-RECOVERY-003" / "experiment-summary.json",
        prior_root / "TEST-WRIM1.1-RECOVERY-004" / "experiment-summary.json",
        prior_root / "TEST-WRIM1.1-RECOVERY-004-FORENSIC-STEP45" / "findings-preview.json",
    ]
    for p in priors:
        if not p.is_file():
            print(f"prior artifact missing ({p}); aborting so 001–004/forensics stay intact", file=sys.stderr)
            return 2
    if work.resolve() in {p.parent.resolve() for p in priors}:
        print("refusing to write 005 into a prior experiment directory", file=sys.stderr)
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
        "authorization": "COMMANDER_RECOVERY_005_INTERLEAVED_REHEARSAL_ONLY",
        "prior_experiment_ids": [
            "TEST-WRIM1.1-RECOVERY-001",
            "TEST-WRIM1.1-RECOVERY-002",
            "TEST-WRIM1.1-RECOVERY-003",
            "TEST-WRIM1.1-RECOVERY-004",
            "TEST-WRIM1.1-RECOVERY-004-FORENSIC-STEP45",
        ],
    }
    (work / "run-manifest.json").write_text(json.dumps(run_manifest, indent=2) + "\n")
    (work / "training-config.json").write_text(json.dumps(cfg, indent=2) + "\n")
    (work / "optimizer-config.json").write_text(json.dumps(optimizer_config_from_training(cfg), indent=2) + "\n")

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
    ret = build_retention_windows(root=root, tokenizer=tokenizer, n_windows=16, win=64, seed=SEED)
    if ret["leak_hits"]:
        print(json.dumps({"error": "retention windows leaked held-out prompts", "hits": ret["leak_hits"]}))
        return 2
    np.save(work / "retention-windows.npy", ret["windows"])
    (work / "retention-windows-meta.json").write_text(json.dumps({
        k: ret[k] for k in ret if k != "windows"
    }, indent=2) + "\n")
    parent_ret_logits = logits_for_windows(model, ret["windows"])
    np.save(work / "retention-parent-logits.npy", parent_ret_logits)
    kl0 = kl_mean_from_logits(parent_ret_logits, parent_ret_logits)

    extra_items = build_expanded_prompts(root=root, tokenizer=tokenizer, n=87, seed=SEED)
    expanded_suite = {
        "suite_id": "WRIM-RECOVERY-005-EXPANDED-100",
        "kind": "DIAGNOSTIC_ONLY",
        "test_only": True,
        "promotable": False,
        "held_out": False,
        "original_13": suite["items"],
        "expanded_87": extra_items,
        "n_total": 13 + len(extra_items),
    }
    (work / "WRIM-RECOVERY-005-EXPANDED-100.json").write_text(json.dumps(expanded_suite, indent=2) + "\n")
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
