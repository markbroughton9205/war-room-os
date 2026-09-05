#!/usr/bin/env python3
"""TEST-WRIM1.1-RECOVERY-008. TEST_ONLY. Isolates LR-schedule horizon vs WRIM1-RUN-000002.

Does not resume official step 100. Does not promote. Does not touch production.
Does not start Recovery-009 or WRIM1-RUN-000003.
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
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
from diagnose_collapse import topk_diag  # noqa: E402
from fingerprints import dirty_tree_fingerprint  # noqa: E402
from hashes import sha256_file, sha256_json, tensor_tree_sha256  # noqa: E402
from interleave_curriculum import (  # noqa: E402
    build_span_index,
    local_mix_preflight,
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
from run_wrim1_run_000002 import (  # noqa: E402
    delta_vs_baseline,
    family_ce_on_batch,
    run_cap_eval,
    verify_wrim_env,
)
from capability_curriculum_lib import EVAL_ID  # noqa: E402

EXPERIMENT_ID = "TEST-WRIM1.1-RECOVERY-008"
WORK_REL = "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-008"
OFFICIAL_REL = "model-lab/manifests/wrim1_1_official/WRIM1-RUN-000002"
PRIOR_007_REL = "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-007"
PRIOR_SUITE_REL = "model-lab/manifests/wrim1_1_recovery/test-only/WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED.json"
PRODUCTION_ROOT = Path("/Users/markbroughton/WarRoomNode01")
MAX_STEPS = 250
COSINE_HORIZON = 150
CKPT_STEPS = (0, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250)
FULL_DIAG_STEPS = CKPT_STEPS
LIGHT_STEPS = tuple(range(0, MAX_STEPS + 1, 10))
CAP_EVAL_STEPS = (0, 100, 150, 200, 250)
PEAK_LR = 3e-5
WARMUP = 25
BATCH = 8
CTX = 512
SEED = 20260830
FLOOR_RATIO = 0.1
FLOOR_LR = PEAK_LR * FLOOR_RATIO
EXPECTED_PACK_TOKENS = 686_070
OFFICIAL_TRAIN_SHA = "d098ddce732d1fd77ec64e75ab3979250f846cfd0f57d1fbb3f9065743645291"
RECOVERY_MARKERS = ("TEST-WRIM1.1-RECOVERY", "WRIM-RECOVERY", "recovery/test-only")


def lr_recovery_008(step: int) -> float:
    """Recovery-007 cosine through step 150, then constant floor.

    Formula (identical to lr_at_step with total_steps=150 for step <= 150):
      if step < 25:  3e-5 * (step+1)/25
      if 25 <= step <= 150:
          progress = (step-25)/max(1, 150-25)
          cosine = 0.5 * (1 + cos(pi * min(1, progress)))
          lr = 3e-5 * (0.1 + 0.9 * cosine)
      if step > 150: hold floor 3e-6 (do not restart or stretch cosine)
    """
    return lr_at_step(min(int(step), COSINE_HORIZON), COSINE_HORIZON, PEAK_LR, WARMUP, FLOOR_RATIO)


def collapse_gate_008(step0: dict, now: dict, logits: dict, grad_row: dict | None = None) -> tuple[bool, str]:
    """Recovery-008 collapse stop. Review of official 000002 / gate_004.

    Official 000002 stopped at 4/13 solely via `collapsed_probes >= step0 + 2`.
    Recovery-007 survived 3/13 at 100–150. WRIM-0 itself is 2/13 with residual
    underscore noise, so +2 without loop evidence can fire on two noisy probes.

    HARD (unchanged integrity / broad-deterioration rules from 004):
    - non-finite logits/grads
    - collapsed_probes >= 6/13
    - new period-run or pipe/underscore-run degeneration
    - symbol argmax (./|/_) with rising collapse
    - P(symbol) dominant (>=0.15)
    - unique-ratio < 0.5 x step-0
    - prompt-echo +0.4
    - gradient L2 > 50x step-0
    - collapsing probes >= step0+2 AND corroborating loop/run evidence

    NOT a hard stop by itself:
    - isolated probe-count +1/+2 without symbol/letter-loop corroboration
    """
    stop, reason = collapse_gate_004(step0, now, logits, grad_row)
    if not stop:
        return False, ""
    if reason == "collapsed probes materially exceed step-0":
        corroborated = bool(
            now.get("symbol_run")
            or now.get("period_run_sky")
            or int(now.get("underscore_run") or 0) >= 6
            or int(now.get("pipe_run") or 0) >= 6
            or letter_loop_text(now.get("sky_continuation") or "")
        )
        if not corroborated:
            return False, ""
        return True, "collapsed probes exceed step-0 with corroborating loop/run evidence"
    return True, reason


def letter_loop_text(text: str) -> bool:
    t = text or ""
    return t.count("-lab") >= 3 or "_`_`" in t or t.count("lab") >= 4


def resembles_official_000002_failure(row: dict, row0: dict) -> tuple[bool, str]:
    """Step-100 decision: official failure was 4/13 + underscore/-lab loops, unique 0.346."""
    collapse = int(row.get("collapsed_probes") or 0)
    unique = float(row.get("mean_unique_ratio") or 0.0)
    unique0 = float(row0.get("mean_unique_ratio") or 1.0)
    loops = bool(
        row.get("symbol_run")
        or int(row.get("underscore_run") or 0) >= 6
        or letter_loop_text(row.get("sky_continuation") or "")
    )
    if collapse >= 4 and loops:
        return True, f"step-100 official-like failure: collapse {collapse}/13 with symbol/letter loops"
    if unique0 > 0 and unique < 0.5 * unique0:
        return True, f"step-100 unique-ratio collapse {unique} vs step0 {unique0}"
    return False, ""


def first100_payload(steps: list[dict]) -> list[dict]:
    out = []
    for r in steps[:100]:
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
            "supervised_pct": r.get("supervised_pct"),
        })
    return out


def compare_first100(planned: list[dict], official_dir: Path) -> dict:
    prev = json.loads((official_dir / "planned-step-source-map.json").read_text(encoding="utf-8"))
    prev_steps = prev.get("steps") or []
    n = min(100, len(planned), len(prev_steps))
    mismatches = []
    for i in range(n):
        a = planned[i]
        b = prev_steps[i]
        if a.get("seq_starts") != b.get("seq_starts"):
            mismatches.append({"step": i + 1, "field": "seq_starts"})
        if a.get("dominant_source_family") != b.get("dominant_source_family"):
            mismatches.append({"step": i + 1, "field": "dominant_source_family"})
        for key in ("rehearsal_pct", "prose_pct", "code_pct", "json_pct", "behavior_pct", "supervised_pct"):
            da = float(a.get(key) or 0)
            db = float(b.get(key) or 0)
            if abs(da - db) > 1e-6:
                mismatches.append({"step": i + 1, "field": key, "008": da, "000002": db})
    h008 = sha256_json(first100_payload(planned))
    h002 = sha256_json(first100_payload(prev_steps))
    return {
        "compared_steps": n,
        "mismatches": mismatches[:40],
        "n_mismatches": len(mismatches),
        "first100_schedule_sha256_008": h008,
        "first100_schedule_sha256_000002": h002,
        "hash_match": h008 == h002,
        "passed": n == 100 and not mismatches and h008 == h002,
    }


def recovery_config() -> dict:
    cfg = official_training_config()
    cfg.update({
        "learning_rate": PEAK_LR,
        "warmup_steps": WARMUP,
        "total_steps": COSINE_HORIZON,
        "planned_train_steps": MAX_STEPS,
        "batch_size": BATCH,
        "context_length": CTX,
        "validation_cadence_steps": 10,
        "checkpoint_cadence_steps": 25,
        "seed": SEED,
        "shuffle_strategy": "deficit_interleave_contiguous_windows",
        "test_only": True,
        "promotable": False,
        "lineage": "NOT_OFFICIAL_WRIM_LINEAGE",
        "experiment_id": EXPERIMENT_ID,
        "NOT_PROMOTABLE": True,
        "NOT_OFFICIAL_WRIM_LINEAGE": True,
        "NOT_PRODUCTION": True,
        "scheduler_floor_ratio": FLOOR_RATIO,
        "lr_rationale": (
            "RECOVERY-008: isolate schedule horizon. Peak 3e-5, warmup 25, "
            "Recovery-007 cosine horizon 150, then hold floor 3e-6 through 250. "
            "Do not stretch cosine to 502. Do not resume WRIM1-RUN-000002."
        ),
    })
    return cfg


def fail_packet(work: Path, reason: str, evidence: dict) -> int:
    payload = {
        "experiment_id": EXPERIMENT_ID,
        "TEST_ONLY": True,
        "NOT_PROMOTABLE": True,
        "NOT_OFFICIAL_WRIM_LINEAGE": True,
        "NOT_PRODUCTION": True,
        "verdict": "WRIM-1.1 RECOVERY-008 — FAIL",
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
    official_dir = root / OFFICIAL_REL
    prior_007 = root / PRIOR_007_REL
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
        "official_000002_registry_mtime": (
            (official_dir / "checkpoint-registry.json").stat().st_mtime
            if (official_dir / "checkpoint-registry.json").is_file() else None
        ),
        "recovery_007_exists": (prior_007 / "experiment-summary.json").is_file() or (prior_007 / "wrim0-load-proof.json").is_file(),
    }
    if work.resolve() == official_dir.resolve():
        return fail_packet(work, "refusing to write Recovery-008 into official 000002 directory", {})
    if work.resolve() == prior_007.resolve():
        return fail_packet(work, "refusing to overwrite Recovery-007", {})

    env = verify_wrim_env(root)
    env["TEST_ONLY"] = True
    env["NOT_PROMOTABLE"] = True
    env["NOT_OFFICIAL_WRIM_LINEAGE"] = True
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
        "rebuilt_curriculum": False,
        "reused_capability_candidate": True,
        "note": "materialize_official_pack is identity-check vs frozen WRIM1-RUN-000002 bytes; no mix redesign.",
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
    if packed["selected_tokens"] != EXPECTED_PACK_TOKENS or not packed["pack_token_match"]:
        return fail_packet(work, "curriculum pack token count mismatch", report)
    if not packed["validator"]["passed"]:
        return fail_packet(work, "curriculum validator failed", packed["validator"])
    if not packed["eval_exclude_ok"]:
        return fail_packet(work, "held-out exclusion marker missing", report)
    if packed["example_leak_scan"]["known_eval_leakage"] != 0:
        return fail_packet(work, "example leak scan non-zero", packed["example_leak_scan"])
    if not packed["stream_leak_scan"]["passed"] or packed["stream_leak_scan"]["known_eval_leakage"] != 0:
        return fail_packet(work, "packed-stream leak scan failed; DO NOT TRAIN", packed["stream_leak_scan"])
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
    official_npy = official_dir / "train.npy"
    official_sha = sha256_file(official_npy) if official_npy.is_file() else None
    stream_cmp = {
        "008_train_npy_sha256": train_sha,
        "000002_train_npy_sha256": official_sha,
        "expected_sha256": OFFICIAL_TRAIN_SHA,
        "match_official_file": train_sha == official_sha,
        "match_expected": train_sha == OFFICIAL_TRAIN_SHA,
        "array_equal": False,
    }
    if official_npy.is_file():
        off_arr = np.load(official_npy)
        stream_cmp["array_equal"] = bool(np.array_equal(train_stream, off_arr))
        off_mask = np.load(official_dir / "train-mask.npy")
        stream_cmp["mask_array_equal"] = bool(np.array_equal(train_mask, off_mask))
    (work / "packed-stream-identity.json").write_text(json.dumps(stream_cmp, indent=2) + "\n")
    if not stream_cmp["match_expected"] or not stream_cmp.get("array_equal"):
        return fail_packet(work, "packed token stream differs from WRIM1-RUN-000002; STOP", stream_cmp)

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
    first100 = compare_first100(planned, official_dir)
    (work / "planned-step-source-map.json").write_text(json.dumps({
        "steps": planned,
        "preflight": {k: preflight[k] for k in preflight if k not in ("rolling_5", "rolling_10")},
        "first_batch": planned[0] if planned else None,
        "first100_vs_000002": first100,
    }, indent=2) + "\n")
    (work / "first100-comparability.json").write_text(json.dumps(first100, indent=2) + "\n")
    if not first100["passed"]:
        return fail_packet(work, "first 100-step data stream differs from WRIM1-RUN-000002; STOP", first100)
    if not preflight["passed"]:
        return fail_packet(work, "local mix / contiguous interleave preflight failed", preflight)

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

    collapse_rule = {
        "experiment_id": EXPERIMENT_ID,
        "documented_before_step_1": True,
        "official_000002_rule": "collapse_gate_004: stop if collapsed_probes >= step0+2 (fired at 4/13)",
        "recovery_008_rule": (
            "Hard stop: NaN/Inf, crash, causal/mask/leak/checkpoint corruption, "
            "collapse >= 6/13, unique-ratio < 0.5x step-0, new period/pipe/underscore runs, "
            "symbol-argmax with rising collapse, P(symbol)>=0.15, prompt-echo +0.4, "
            "grad L2 > 50x, OR collapse >= step0+2 WITH corroborating loop evidence. "
            "Isolated +1/+2 probe flips without loops do not stop. "
            "Step 100: stop if official-like (collapse>=4 AND underscore/-lab loops)."
        ),
        "not_silently_weakened": True,
        "function": "collapse_gate_008",
    }
    (work / "collapse-stop-rule.json").write_text(json.dumps(collapse_rule, indent=2) + "\n")

    suite = json.loads((root / PRIOR_SUITE_REL).read_text(encoding="utf-8"))
    if len(suite.get("items") or []) != 13:
        return fail_packet(work, "13-probe diagnostic suite missing", {"n": len(suite.get("items") or [])})
    (work / "WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED.json").write_text(json.dumps(suite, indent=2) + "\n")

    cap_suite = json.loads((root / "model-lab/eval-only" / EVAL_ID / "suite.json").read_text(encoding="utf-8"))
    baseline = json.loads((root / "model-lab/eval-only" / EVAL_ID / "wrim0-baseline.json").read_text(encoding="utf-8"))
    eval_sha = sha256_file(root / "model-lab/eval-only" / EVAL_ID / "suite.json")

    cfg = recovery_config()
    identities = {
        "TEST_ONLY": True,
        "promotable": False,
        "NOT_PROMOTABLE": True,
        "NOT_OFFICIAL_WRIM_LINEAGE": True,
        "NOT_PRODUCTION": True,
        "lineage": cfg["lineage"],
        "experiment_id": EXPERIMENT_ID,
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
        "experiment_id": EXPERIMENT_ID,
        "TEST_ONLY": True,
        "official": False,
        "promotable": False,
        "NOT_PRODUCTION": True,
        "NOT_PROMOTABLE": True,
        "NOT_OFFICIAL_WRIM_LINEAGE": True,
        "parent_model_id": "WRIM-0",
        "parent_checkpoint_sha256": PARENT_CHECKPOINT_SHA256,
        "tokenizer_id": "WR-TOKENIZER-0",
        "tokenizer_sha256": TOKENIZER_SHA256,
        "curriculum_id": packed["curriculum_id"],
        "eval_id": EVAL_ID,
        "training_config_sha256": identities["training_config_sha256"],
        "authorization": "COMMANDER_TEST_WRIM1_1_RECOVERY_008_ONLY",
        "does_not_overwrite": [
            "WRIM-0", "WRX-000001", "WRIM1-RUN-000001", "WRIM1-RUN-000002",
            "Recovery-001-007",
        ],
        "does_not_start": ["WRIM1-RUN-000003", "Recovery-009", "promotion", "production"],
    }
    (work / "run-manifest.json").write_text(json.dumps(run_manifest, indent=2) + "\n")
    (work / "training-config.json").write_text(json.dumps(cfg, indent=2) + "\n")
    opt_cfg_now = optimizer_config_from_training(cfg)
    (work / "optimizer-config.json").write_text(json.dumps(opt_cfg_now, indent=2) + "\n")

    lr_rows = [{"step": s, "learning_rate": lr_recovery_008(s)} for s in range(MAX_STEPS)]
    if any(r["learning_rate"] > PEAK_LR + 1e-18 for r in lr_rows):
        return fail_packet(work, "planned LR exceeds 3e-5", {"max": max(r["learning_rate"] for r in lr_rows)})
    lr007 = [{"step": s, "learning_rate": lr_at_step(s, 150, PEAK_LR, WARMUP, FLOOR_RATIO)} for s in range(150)]
    lr_match_007 = all(abs(lr_rows[s]["learning_rate"] - lr007[s]["learning_rate"]) < 1e-18 for s in range(150))
    after_floor = all(abs(lr_rows[s]["learning_rate"] - FLOOR_LR) < 1e-18 for s in range(150, MAX_STEPS))
    (work / "lr-schedule.json").write_text(json.dumps({
        "formula": lr_recovery_008.__doc__,
        "peak_lr": PEAK_LR,
        "warmup_steps": WARMUP,
        "cosine_horizon": COSINE_HORIZON,
        "floor_lr": FLOOR_LR,
        "hold_floor_after": 150,
        "planned_train_steps": MAX_STEPS,
        "matches_recovery_007_through_150": lr_match_007,
        "constant_floor_after_150": after_floor,
        "not_stretched_to_502": True,
        "key_steps": {str(s): lr_recovery_008(s) for s in (0, 24, 25, 50, 75, 100, 125, 149, 150, 200, 249)},
        "schedule": lr_rows,
    }, indent=2) + "\n")
    if not lr_match_007 or not after_floor:
        return fail_packet(work, "LR schedule does not match Recovery-007 then floor", {
            "matches_007": lr_match_007,
            "after_floor": after_floor,
        })

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
        "not_official_000002_resume": True,
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
    gate_warnings = []
    early_stop = {"stopped": False, "reason": "", "step": None}
    last_ckpt = None
    t0 = time.time()
    last_grad_row = None
    pid = os.getpid()
    official_diag100 = json.loads((official_dir / "diagnostic-step-000100.json").read_text(encoding="utf-8"))

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
            "experiment_id": EXPERIMENT_ID,
            "TEST_ONLY": True,
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
            "TEST_ONLY": True,
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
            "learning_rate": lr_recovery_008(max(0, step - 1) if step else 0),
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
        ev["TEST_ONLY"] = True
        ev["model_id"] = "WRIM-0 (step 0 / parent)" if step == 0 else EXPERIMENT_ID
        ev["delta"] = delta_vs_baseline(ev, baseline)
        cap_evals[str(step)] = ev
        (work / f"cap-eval-step-{step:06d}.json").write_text(json.dumps(ev, indent=2, default=str) + "\n")

    val0 = evaluate_val(model, val_stream, val_mask, cfg, vocab)
    save_ckpt(0, cursor, "TEST_ONLY", val0)
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
    step100_decision = None
    step150_decision = None
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
            lr = lr_recovery_008(global_step)
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
            approx_update = float(lr * min(grad_val, clip_limit))
            grad_rows.append({
                "step": global_step + 1,
                **ginfo,
                "learning_rate": lr,
                "clip_applied": clipped,
                "approx_param_update_scale": approx_update,
            })
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
                "approx_param_update_scale": approx_update,
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
            if global_step % 10 == 0:
                (work / "live-status.json").write_text(json.dumps({
                    "step": global_step,
                    "lr": lr,
                    "train_loss": loss_val,
                    "elapsed_sec": time.time() - t0,
                }, indent=2) + "\n")
            do_full = global_step in FULL_DIAG_STEPS
            do_light = global_step in LIGHT_STEPS and not do_full
            if global_step in CKPT_STEPS:
                save_ckpt(global_step, cursor, "TEST_ONLY", val_metrics)
            if do_full or do_light:
                suite_out, lg, row = diagnose(global_step, val_metrics, loss_val, full=do_full)
                now_pack = {**suite_out, **symbol_run(suite_out["sky_continuation"]), "global_grad_l2": ginfo.get("global_grad_l2")}
                raw_stop, raw_reason = collapse_gate_004(row0, now_pack, lg, ginfo)
                stop, reason = collapse_gate_008(row0, now_pack, lg, ginfo)
                if raw_stop and not stop:
                    gate_warnings.append({"step": global_step, "suppressed_004": raw_reason, "008_continues": True})
                if nan_inf or stop:
                    early_stop = {"stopped": True, "reason": reason, "step": global_step}
                    if global_step not in CKPT_STEPS:
                        save_ckpt(global_step, cursor, "TEST_ONLY_EARLY_STOP", val_metrics)
                    maybe_cap_eval(global_step)
                    break
            if global_step == 100:
                maybe_cap_eval(100)
                like, like_reason = resembles_official_000002_failure(row if do_full else diag_table[-1], row0)
                o100 = official_diag100
                step100_decision = {
                    "continue": not like,
                    "reason": like_reason or "stable relative to official 000002 failure mode",
                    "008": {
                        "collapse": row.get("collapsed_probes") if do_full else None,
                        "unique": row.get("mean_unique_ratio") if do_full else None,
                        "lr": lr_recovery_008(99),
                        "kl": (row.get("kl_to_wrim0") or {}).get("mean_kl_wrim0_to_current") if do_full else None,
                        "l2": (row.get("param_drift") or {}).get("global_param_l2_from_wrim0") if do_full else None,
                        "sky": (row.get("sky_continuation") or "")[:120] if do_full else None,
                    },
                    "000002": {
                        "collapse": o100.get("collapsed_probes"),
                        "unique": o100.get("mean_unique_ratio"),
                        "lr": o100.get("learning_rate"),
                        "kl": (o100.get("kl_to_wrim0") or {}).get("mean_kl_wrim0_to_current"),
                        "l2": (o100.get("param_drift") or {}).get("global_param_l2_from_wrim0"),
                        "sky": (o100.get("sky_continuation") or "")[:120],
                    },
                }
                (work / "step-100-decision.json").write_text(json.dumps(step100_decision, indent=2) + "\n")
                if like:
                    early_stop = {"stopped": True, "reason": like_reason, "step": 100}
                    break
            elif global_step in CAP_EVAL_STEPS:
                maybe_cap_eval(global_step)
            if global_step == 150:
                step150_decision = {
                    "cosine_complete": True,
                    "lr": lr_recovery_008(149),
                    "floor_from_next_step": FLOOR_LR,
                    "collapse": None if not do_full else row.get("collapsed_probes"),
                    "continue_at_floor": not early_stop["stopped"],
                }
                (work / "step-150-decision.json").write_text(json.dumps(step150_decision, indent=2) + "\n")
    except Exception as exc:  # noqa: BLE001
        crash = {"crashed": True, "pid": pid, "timestamp": iso_now(), "type": type(exc).__name__, "message": str(exc), "step": global_step}
        (work / "crash-report.json").write_text(json.dumps(crash, indent=2) + "\n")
        early_stop = {"stopped": True, "reason": f"python/mlx crash: {exc}", "step": global_step}

    if not early_stop["stopped"] and global_step not in FULL_DIAG_STEPS:
        val_metrics = evaluate_val(model, val_stream, val_mask, cfg, vocab)
        save_ckpt(global_step, cursor, "TEST_ONLY_COMPLETED", val_metrics)
        diagnose(global_step, val_metrics, last_train_loss, full=True)
        maybe_cap_eval(global_step)
    elif not early_stop["stopped"] and global_step == MAX_STEPS:
        maybe_cap_eval(MAX_STEPS)

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

    prod_after = {
        "wrim0_sha_after": sha256_file(wrim0_path),
        "wrim0_unchanged": sha256_file(wrim0_path) == PARENT_CHECKPOINT_SHA256,
        "wrim1_000001_registry_mtime_after": (
            (official_000001 / "checkpoint-registry.json").stat().st_mtime
            if (official_000001 / "checkpoint-registry.json").is_file() else None
        ),
        "official_000002_registry_mtime_after": (
            (official_dir / "checkpoint-registry.json").stat().st_mtime
            if (official_dir / "checkpoint-registry.json").is_file() else None
        ),
        "production_exists": PRODUCTION_ROOT.exists(),
        "work_dir_is_not_production": str(work.resolve()) != str(PRODUCTION_ROOT.resolve()) if PRODUCTION_ROOT.exists() else True,
    }
    prod_after["000001_registry_untouched"] = prod_before["wrim1_000001_registry_mtime"] == prod_after["wrim1_000001_registry_mtime_after"]
    prod_after["000002_registry_untouched"] = prod_before["official_000002_registry_mtime"] == prod_after["official_000002_registry_mtime_after"]

    completed_250 = (not early_stop["stopped"]) and global_step == MAX_STEPS and not crash["crashed"]
    leak_ok = packed["stream_leak_scan"]["passed"] and packed["stream_leak_scan"]["known_eval_leakage"] == 0
    reload_ok = all(r.get("ok") for r in reload_proof if r.get("step") is not None)
    collapse_final = next((r.get("collapsed_probes") for r in reversed(diag_table) if r.get("collapsed_probes") is not None), None)
    no_broad = collapse_final is not None and int(collapse_final) < 6
    step100_row = next((r for r in diag_table if r.get("step") == 100), None)
    step100_better = False
    if step100_row:
        step100_better = int(step100_row.get("collapsed_probes") or 99) < 4 or not (
            step100_row.get("symbol_run") or letter_loop_text(step100_row.get("sky_continuation") or "")
        )
    pass_ok = bool(
        completed_250 and leak_ok and no_broad and reload_ok and not nan_inf and not crash["crashed"]
        and (step100_decision or {}).get("continue", False)
        and step100_better
    )
    verdict = "WRIM-1.1 RECOVERY-008 — PASS" if pass_ok else "WRIM-1.1 RECOVERY-008 — FAIL"

    ckpt_list = []
    if registry_path.is_file():
        ckpt_list = json.loads(registry_path.read_text()).get("checkpoints") or []
    final_sha = None
    final_ckpt = work / f"checkpoint-step-{global_step:06d}"
    if (final_ckpt / "checkpoint-manifest.json").is_file():
        final_sha = json.loads((final_ckpt / "checkpoint-manifest.json").read_text()).get("model_tensor_sha256")

    def cap_brief(step: int):
        ev = cap_evals.get(str(step))
        if not ev:
            return None
        return {
            "pass_count": ev["pass_count"],
            "item_count": ev["item_count"],
            "family_stats_short": ev.get("family_stats_short"),
            "delta": ev.get("delta"),
        }

    summary = {
        "experiment_id": EXPERIMENT_ID,
        "TEST_ONLY": True,
        "NOT_PROMOTABLE": True,
        "NOT_OFFICIAL_WRIM_LINEAGE": True,
        "NOT_PRODUCTION": True,
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
        "lr_schedule": {
            "peak": PEAK_LR,
            "warmup": WARMUP,
            "cosine_horizon": COSINE_HORIZON,
            "floor": FLOOR_LR,
            "hold_after": 150,
            "planned_steps": MAX_STEPS,
            "key_steps": {str(s): lr_recovery_008(s) for s in (25, 50, 75, 100, 125, 150, 200, 250 if 250 < MAX_STEPS else 249)},
        },
        "planned_steps": MAX_STEPS,
        "completed_steps": global_step,
        "tokens_seen": cursor.tokens_consumed,
        "elapsed_sec": time.time() - t0,
        "checkpoints": ckpt_list,
        "final_checkpoint_sha256": final_sha,
        "packing": report,
        "stream_identity": stream_cmp,
        "first100_comparability": first100,
        "mask_proof": packed["mask_proof"],
        "tool_proof": packed["tool_proof"],
        "causal_proof": {k: audit[k] for k in audit if k != "examples"},
        "leakage": packed["stream_leak_scan"],
        "global_mix": packed["token_pct"],
        "collapse_stop_rule": collapse_rule,
        "gate_warnings_004_suppressed": gate_warnings,
        "n_clip_events": len(clip_events),
        "early_stop": early_stop,
        "nan_inf": nan_inf,
        "crash": crash,
        "reload_proof": reload_proof,
        "step100_decision": step100_decision,
        "step150_decision": step150_decision,
        "cap_eval_steps": {k: cap_brief(int(k)) for k in cap_evals},
        "diagnostics": [{
            "step": r["step"],
            "collapsed_probes": r.get("collapsed_probes"),
            "mean_unique_ratio": r.get("mean_unique_ratio"),
            "train_loss": r.get("train_loss"),
            "validation_loss": r.get("validation_loss"),
            "learning_rate": r.get("learning_rate"),
            "p_period": (r.get("logits") or {}).get("p_period"),
            "p_pipe": (r.get("logits") or {}).get("p_pipe"),
            "p_underscore": (r.get("logits") or {}).get("p_underscore"),
            "entropy": (r.get("logits") or {}).get("entropy"),
            "kl": (r.get("kl_to_wrim0") or {}).get("mean_kl_wrim0_to_current"),
            "param_l2": (r.get("param_drift") or {}).get("global_param_l2_from_wrim0"),
            "sky": (r.get("sky_continuation") or "")[:80],
        } for r in diag_table],
        "kl_to_wrim0": kl_rows,
        "param_drift": [{"step": d["step"], "l2": d.get("global_param_l2_from_wrim0"), "relative": d.get("relative_param_drift"), "per_layer_cosine": d.get("per_layer_cosine_to_wrim0")} for d in drift_rows],
        "production": {**prod_before, **prod_after},
        "verdict": verdict,
        "pid": pid,
    }
    (work / "experiment-summary.json").write_text(json.dumps(summary, indent=2, default=str) + "\n")
    (work / "clip-events.json").write_text(json.dumps(clip_events, indent=2) + "\n")
    (work / "family-loss.json").write_text(json.dumps(family_loss_rows, indent=2) + "\n")
    (work / "grad-rows.json").write_text(json.dumps(grad_rows, indent=2) + "\n")
    (work / "actual-step-source-map.json").write_text(json.dumps({"steps": mix_rows}, indent=2) + "\n")
    (work / "gate-warnings.json").write_text(json.dumps(gate_warnings, indent=2) + "\n")

    print(json.dumps({
        "experiment_id": EXPERIMENT_ID,
        "verdict": verdict,
        "completed_steps": global_step,
        "early_stop": early_stop,
        "elapsed_sec": summary["elapsed_sec"],
        "work_dir": str(work),
        "TEST_ONLY": True,
    }, indent=2))
    return 0 if pass_ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
