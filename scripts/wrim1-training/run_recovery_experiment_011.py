#!/usr/bin/env python3
"""TEST-WRIM1.1-RECOVERY-011. TEST_ONLY. Compact TOOL V2 reintroduction vs Recovery-010 control.

Does not resume Recovery-010. Does not promote. Does not touch production.
Does not start Recovery-012 or WRIM1-RUN-000003.
"""
from __future__ import annotations

import json
import math
import os
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
from diagnose_collapse import topk_diag  # noqa: E402
from fingerprints import dirty_tree_fingerprint  # noqa: E402
from hashes import sha256_file, sha256_json, tensor_tree_sha256  # noqa: E402
from interleave_curriculum import (  # noqa: E402
    build_span_index,
    local_mix_preflight,
    simulate_step_mix,
)
from pack_recovery_010 import OFFICIAL_TRAIN_SHA  # noqa: E402
from pack_recovery_011 import (  # noqa: E402
    PACK_ID,
    classify,
    materialize_recovery_011_pack,
    objective_of,
)
from forensic_tool_use_curriculum import V2_EVAL_ID, score_compact  # noqa: E402
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
from run_wrim0_cap_eval_baseline import generate as cap_generate  # noqa: E402
from pack_recovery_010 import is_tool_use_unit  # noqa: E402
from capability_curriculum_lib import EVAL_ID  # noqa: E402

EXPERIMENT_ID = "TEST-WRIM1.1-RECOVERY-011"
WORK_REL = "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-011"
OFFICIAL_REL = "model-lab/manifests/wrim1_1_official/WRIM1-RUN-000002"
PRIOR_008_REL = "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-008"
PRIOR_009_REL = "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-009"
PRIOR_010_REL = "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-010"
PRIOR_007_REL = "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-007"
PRIOR_SUITE_REL = "model-lab/manifests/wrim1_1_recovery/test-only/WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED.json"
PRODUCTION_ROOT = Path("/Users/markbroughton/WarRoomNode01")
MAX_STEPS = 250
COSINE_HORIZON = 150
CKPT_STEPS = (0, 25, 50, 75, 100, 120, 125, 150, 175, 200, 225, 250)
FULL_DIAG_STEPS = CKPT_STEPS
LIGHT_STEPS = tuple(range(0, MAX_STEPS + 1, 10))
CAP_EVAL_STEPS = (0, 75, 100, 120, 150, 200, 250)
PEAK_LR = 3e-5
WARMUP = 25
BATCH = 8
CTX = 512
SEED = 20260830
FLOOR_RATIO = 0.1
FLOOR_LR = PEAK_LR * FLOOR_RATIO
EXPECTED_PACK_TOKENS = 686_070
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


def origin_ce_and_density(model, x, y, w, vocab, spans, seq_starts, ctx) -> dict:
    """Per-origin CE plus trainable target density. Does not change the training loss."""
    import mlx.core as mx
    import mlx.nn as nn
    logits = model(x)
    ce = nn.losses.cross_entropy(logits.reshape(-1, vocab), y.reshape(-1), reduction="none")
    mx.eval(ce)
    ce_np = np.array(ce, dtype=np.float64).reshape(x.shape[0], x.shape[1])
    w_np = np.array(w)
    acc = defaultdict(lambda: [0.0, 0.0])
    dens = defaultdict(lambda: [0.0, 0.0])
    bounds = np.array([s["end"] for s in spans], dtype=np.int64)
    for i, start in enumerate(seq_starts):
        positions = np.arange(start + 1, start + 1 + ctx, dtype=np.int64)
        idx = np.searchsorted(bounds, positions, side="right")
        for t, (si, pos) in enumerate(zip(idx.tolist(), positions.tolist())):
            wt = float(w_np[i, t])
            if si >= len(spans) or pos < spans[si]["start"] or pos >= spans[si]["end"]:
                fam = "other"
            else:
                fam = classify(spans[si]["bucket"], spans[si]["origin"])
            dens[fam][0] += wt
            dens[fam][1] += 1.0
            if wt > 0:
                acc[fam][0] += float(ce_np[i, t]) * wt
                acc[fam][1] += wt
    ce_out = {fam: (None if n <= 0 else float(s / n)) for fam, (s, n) in acc.items()}
    dens_out = {}
    for fam, (tr, tot) in dens.items():
        dens_out[fam] = {
            "trainable_target_tokens": float(tr),
            "total_tokens": float(tot),
            "target_density": (float(tr / tot) if tot else 0.0),
        }
    trainable = float(np.sum(w_np))
    total = float(w_np.size)
    return {
        "ce_by_class": ce_out,
        "density_by_class": dens_out,
        "batch_trainable_target_tokens": trainable,
        "batch_total_tokens": total,
        "batch_target_density": trainable / total if total else 0.0,
        "supervised_ce_aggregate": (
            None if not any(k in acc and acc[k][1] > 0 for k in (
                "INSTRUCTION", "JSON", "WR_CONCEPT", "EVIDENCE", "CORRECTION", "CODE_SUPERVISED", "TOOL", "TOOL_V2"
            )) else float(sum(acc[k][0] for k in acc if k in (
                "INSTRUCTION", "JSON", "WR_CONCEPT", "EVIDENCE", "CORRECTION", "CODE_SUPERVISED", "TOOL", "TOOL_V2"
            )) / max(1.0, sum(acc[k][1] for k in acc if k in (
                "INSTRUCTION", "JSON", "WR_CONCEPT", "EVIDENCE", "CORRECTION", "CODE_SUPERVISED", "TOOL", "TOOL_V2"
            ))))
        ),
    }


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
            "RECOVERY-011: hold Recovery-010/008 LR exactly. Peak 3e-5, warmup 25, "
            "cosine horizon 150, then hold floor 3e-6 through 250. "
            "Only curriculum change: compact TOOL V2 in Recovery-010 former V1 tool slots, "
            "padded with WR-CORPUS-0 rehearsal. Do not reintroduce TOOL_USE V1 JSON."
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
        "verdict": "WRIM-1.1 RECOVERY-011 — FAIL",
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
    prior_008 = root / PRIOR_008_REL
    prior_009 = root / PRIOR_009_REL
    prior_010 = root / PRIOR_010_REL
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
        "recovery_008_registry_mtime": (
            (prior_008 / "checkpoint-registry.json").stat().st_mtime
            if (prior_008 / "checkpoint-registry.json").is_file() else None
        ),
        "recovery_007_exists": (prior_007 / "experiment-summary.json").is_file() or (prior_007 / "wrim0-load-proof.json").is_file(),
        "recovery_008_exists": (prior_008 / "experiment-summary.json").is_file(),
        "recovery_009_exists": (prior_009 / "experiment-summary.json").is_file(),
        "recovery_010_exists": (prior_010 / "experiment-summary.json").is_file(),
        "recovery_009_registry_mtime": (
            (prior_009 / "checkpoint-registry.json").stat().st_mtime
            if (prior_009 / "checkpoint-registry.json").is_file() else None
        ),
        "recovery_010_registry_mtime": (
            (prior_010 / "checkpoint-registry.json").stat().st_mtime
            if (prior_010 / "checkpoint-registry.json").is_file() else None
        ),
    }
    if work.resolve() == official_dir.resolve():
        return fail_packet(work, "refusing to write Recovery-011 into official 000002 directory", {})
    if work.resolve() == prior_008.resolve():
        return fail_packet(work, "refusing to overwrite Recovery-008", {})
    if work.resolve() == prior_009.resolve():
        return fail_packet(work, "refusing to overwrite Recovery-009", {})
    if work.resolve() == prior_010.resolve():
        return fail_packet(work, "refusing to overwrite Recovery-010", {})
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
    packed = materialize_recovery_011_pack(root=root, tokenizer=tokenizer)
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
        "v1_absence_passed": packed["v1_absence_proof"]["passed"],
        "eval_sha256": packed["eval_sha256"],
        "eval_id": packed["eval_id"],
        "commander_corrections": packed["account"]["commander_correction_count"],
        "terra_training_observations": packed["account"]["terra_training_observations"],
        "design_content_sha256": packed["design_manifest"].get("content_sha256"),
        "rebuilt_curriculum": True,
        "test_only_pack": True,
        "official_candidate_not_modified_in_place": True,
        "v2_counts": packed["v2_counts"],
        "v2_validator_passed": packed["v2_validator"]["passed"],
        "v2_gradient_passed": packed["v2_gradient_proof"]["passed"],
        "quality_code_retained": packed["quality_code_retained"],
        "token_delta_report": packed["token_delta_report"],
        "composition_008": packed["composition_008"],
        "composition_010": packed["composition_010"],
        "composition_011": packed["composition_011"],
        "non_tool_identity": packed["non_tool_identity"],
        "tool_eval_id": packed["tool_eval_id"],
        "tool_eval_sha256": packed["tool_eval_sha256"],
        "v2_target_density": packed["v2_target_density"],
        "note": "TEST_ONLY Recovery-011 pack: compact TOOL V2 in former V1 tool slots on the Recovery-010 control; QUALITY_CODE leftover retained.",
    }
    (work / "pack-report.json").write_text(json.dumps({
        **report,
        "token_counts": packed["token_counts"],
        "mask_proof": packed["mask_proof"],
        "v1_absence_proof": packed["v1_absence_proof"],
        "v2_gradient_proof": packed["v2_gradient_proof"],
        "v2_validator": packed["v2_validator"],
        "stream_leak_scan": packed["stream_leak_scan"],
        "stream_leak_scan_tool_eval_1": packed["stream_leak_scan_tool_eval_1"],
        "example_leak_scan_tool_eval_1": packed["example_leak_scan_tool_eval_1"],
        "validator": packed["validator"],
        "interleave_unit_order_only": packed["interleave_unit_order_only"],
        "supervised_identity": packed["supervised_identity"],
        "changed_windows": packed["changed_windows"],
        "unchanged_windows": packed["unchanged_windows"],
        "v2_tool_windows": packed["v2_tool_windows"],
        "rehearsal_padding_windows": packed["rehearsal_padding_windows"],
        "rehearsal_pad_tokens": packed["rehearsal_pad_tokens"],
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
    if not packed["split_preserves_tokens"]:
        return fail_packet(work, "contiguous-unit split proof failed", report)
    if not packed["non_tool_identity"]["passed"]:
        return fail_packet(work, "non-tool windows are not identical to Recovery-010", packed["non_tool_identity"])
    v2c = packed["v2_counts"]
    if int(v2c.get("examples") or 0) != 88:
        return fail_packet(work, "V2 tool example count != 88; DO NOT TRAIN", v2c)
    if int(v2c.get("target_tokens_from_examples") or 0) != 1694:
        return fail_packet(work, "V2 target tokens != 1694; DO NOT TRAIN", v2c)
    if not packed["v2_validator"]["passed"]:
        return fail_packet(work, "V2 compact representation validator failed; DO NOT TRAIN", packed["v2_validator"])
    if not packed.get("tool_eval_exclude_ok"):
        return fail_packet(work, "TOOL-EVAL-1 exclusion marker missing; DO NOT TRAIN", {"tool_eval_id": packed.get("tool_eval_id")})
    if int(packed["example_leak_scan_tool_eval_1"].get("known_eval_leakage") or 0) != 0 or not packed["example_leak_scan_tool_eval_1"].get("passed", True):
        return fail_packet(work, "TOOL-EVAL-1 example leak non-zero; DO NOT TRAIN", packed["example_leak_scan_tool_eval_1"])
    if not packed["stream_leak_scan_tool_eval_1"]["passed"] or packed["stream_leak_scan_tool_eval_1"]["known_eval_leakage"] != 0:
        return fail_packet(work, "packed-stream TOOL-EVAL-1 leak scan failed; DO NOT TRAIN", packed["stream_leak_scan_tool_eval_1"])
    if not packed["v2_gradient_proof"]["passed"]:
        return fail_packet(work, "V2 tool targets do not receive gradient; DO NOT TRAIN", packed["v2_gradient_proof"])
    if not packed["v1_absence_proof"]["passed"]:
        return fail_packet(work, "V1 TOOL_USE targets present in V2 windows; DO NOT TRAIN", packed["v1_absence_proof"])
    if not packed["quality_code_retained"]["passed"]:
        return fail_packet(work, "QUALITY_CODE leftover was not retained vs Recovery-008", packed["quality_code_retained"])
    if not packed["supervised_identity"]["passed"]:
        return fail_packet(work, "supervised-set identity mismatch", packed["supervised_identity"])
    if packed["token_delta_report"]["rehearsal_011"] >= 300_000:
        return fail_packet(work, "rehearsal mix looks like Recovery-009 (too high); DO NOT TRAIN", packed["token_delta_report"])
    if packed["token_delta_report"]["token_delta_vs_010"] != 0:
        return fail_packet(work, "011 pack length differs from Recovery-010; DO NOT TRAIN", packed["token_delta_report"])
    if not packed["mask_proof"]["passed"]:
        return fail_packet(work, "mask correctness failed", packed["mask_proof"])

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
    prior008_npy = prior_008 / "train.npy"
    prior010_npy = prior_010 / "train.npy"
    stream_cmp = {
        "011_train_npy_sha256": train_sha,
        "010_train_npy_sha256": sha256_file(prior010_npy) if prior010_npy.is_file() else None,
        "008_train_npy_sha256": sha256_file(prior008_npy) if prior008_npy.is_file() else None,
        "009_train_npy_sha256": sha256_file(prior_009 / "train.npy") if (prior_009 / "train.npy").is_file() else None,
        "000002_train_npy_sha256": sha256_file(official_npy) if official_npy.is_file() else None,
        "expected_008_sha256": OFFICIAL_TRAIN_SHA,
        "intentionally_differs_from_010": True,
        "array_equal_010": False,
        "length_equal_010": int(train_stream.size) == EXPECTED_PACK_TOKENS,
        "pack_id": PACK_ID,
        "control_pack_id": packed["parent_curriculum_id_010"],
    }
    if prior010_npy.is_file():
        off_arr = np.load(prior010_npy)
        stream_cmp["array_equal_010"] = bool(np.array_equal(train_stream, off_arr))
        off_mask = np.load(prior_010 / "train-mask.npy")
        stream_cmp["mask_array_equal_010"] = bool(np.array_equal(train_mask, off_mask))
        mapping = packed["window_mapping"]
        same_ok = 0
        diff_ok = 0
        pad_ok = 0
        bad = []
        for m in mapping:
            sl_new = train_stream[m["stream_start"]:m["stream_end"]]
            sl_old = off_arr[m["stream_start"]:m["stream_end"]]
            eq = bool(np.array_equal(sl_new, sl_old))
            if m["changed"]:
                if eq:
                    bad.append({"window": m["window_index"], "reason": "V2 slot identical to 010 rehearsal window"})
                else:
                    diff_ok += 1
                v2n = int(m.get("v2_n_tokens") or 0)
                if v2n and int(m.get("rehearsal_pad_tokens") or 0) > 0:
                    if bool(np.array_equal(sl_new[v2n:], sl_old[v2n:])):
                        pad_ok += 1
                    else:
                        bad.append({"window": m["window_index"], "reason": "rehearsal pad tail != 010 window tail"})
            else:
                if not eq:
                    bad.append({"window": m["window_index"], "reason": "non-tool window drifted vs Recovery-010"})
                else:
                    same_ok += 1
        stream_cmp["unchanged_windows_byte_equal"] = same_ok
        stream_cmp["v2_tool_windows"] = diff_ok
        stream_cmp["rehearsal_padding_tails_match_010"] = pad_ok
        stream_cmp["window_byte_mismatches"] = bad[:20]
        stream_cmp["window_byte_proof_passed"] = len(bad) == 0
    (work / "packed-stream-identity.json").write_text(json.dumps(stream_cmp, indent=2) + "\n")
    if stream_cmp.get("array_equal_010"):
        return fail_packet(work, "011 stream is identical to 010; V2 was not inserted", stream_cmp)
    if not stream_cmp.get("length_equal_010"):
        return fail_packet(work, "011 stream length differs from 010 token budget", stream_cmp)
    if prior010_npy.is_file() and not stream_cmp.get("window_byte_proof_passed"):
        return fail_packet(work, "window-level 010→011 identity proof failed", stream_cmp)

    planned = packed["planned_011"]
    preflight = packed["local_mix_preflight"]
    step_map = packed["step_mapping_010_to_011"]
    (work / "planned-step-source-map.json").write_text(json.dumps({
        "steps": planned,
        "preflight": {k: preflight[k] for k in preflight if k not in ("rolling_5", "rolling_10")},
        "first_batch": planned[0] if planned else None,
        "rolling_5_sample": packed["rolling_5"][:15],
        "rolling_10_sample": packed["rolling_10"][:15],
        "rolling_5": packed["rolling_5"],
        "rolling_10": packed["rolling_10"],
    }, indent=2) + "\n")
    (work / "window-mapping-010-to-011.json").write_text(json.dumps({
        "n_windows": len(packed["window_mapping"]),
        "changed_windows": packed["changed_windows"],
        "unchanged_windows": packed["unchanged_windows"],
        "v2_tool_windows": packed["v2_tool_windows"],
        "rehearsal_padding_windows": packed["rehearsal_padding_windows"],
        "windows": packed["window_mapping"],
    }, indent=2) + "\n")
    (work / "step-mapping-010-to-011.json").write_text(json.dumps({
        k: step_map[k] for k in step_map if k != "steps"
    } | {"steps": step_map["steps"]}, indent=2) + "\n")
    (work / "curriculum-delta.json").write_text(json.dumps({
        "008": packed["composition_008"],
        "010": packed["composition_010"],
        "011": packed["composition_011"],
        "delta": packed["token_delta_report"],
        "v2_target_density": packed["v2_target_density"],
    }, indent=2) + "\n")
    if not step_map["seq_starts_identical"]:
        return fail_packet(work, "seq_starts drifted vs Recovery-010; window lengths not preserved", step_map)
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
    (work / "v1-absence-proof.json").write_text(json.dumps(packed["v1_absence_proof"], indent=2) + "\n")
    (work / "v2-gradient-proof.json").write_text(json.dumps(packed["v2_gradient_proof"], indent=2) + "\n")

    collapse_rule = {
        "experiment_id": EXPERIMENT_ID,
        "documented_before_step_1": True,
        "same_as_recovery_008": True,
        "official_000002_rule": "collapse_gate_004: stop if collapsed_probes >= step0+2 (fired at 4/13)",
        "recovery_010_rule": (
            "Same documented Recovery-008 stability logic (collapse_gate_008). "
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
    eval_identity = {
        "eval_id": cap_suite.get("suite_id"),
        "eval_sha256": sha256_file(root / "model-lab/eval-only" / EVAL_ID / "suite.json"),
        "item_count": cap_suite.get("item_count") or len(cap_suite.get("items") or []),
        "family_counts": cap_suite.get("family_counts"),
        "EVAL_TOOL": int((cap_suite.get("family_counts") or {}).get("EVAL-TOOL") or 0),
        "pack_eval_sha256": packed.get("eval_sha256"),
        "byte_identical_to_WRIM_1_1_CAP_EVAL_0": True,
        "unchanged": True,
    }
    eval_sha = eval_identity["eval_sha256"]
    eval_identity["matches_pack"] = eval_sha == packed.get("eval_sha256")
    tool1_path = root / "model-lab/eval-only" / V2_EVAL_ID / "suite.json"
    tool1_suite = json.loads(tool1_path.read_text(encoding="utf-8"))
    eval_identity["tool_eval_1"] = {
        "eval_id": tool1_suite.get("suite_id"),
        "eval_sha256": sha256_file(tool1_path),
        "item_count": len(tool1_suite.get("items") or []),
        "EXCLUDE_FROM_TRAINING": all(bool(it.get("EXCLUDE_FROM_TRAINING")) for it in (tool1_suite.get("items") or [])),
        "does_not_overwrite_cap_eval_0": True,
    }
    (work / "eval-identity.json").write_text(json.dumps(eval_identity, indent=2) + "\n")
    if eval_identity["EVAL_TOOL"] != 10 or eval_identity["eval_id"] != EVAL_ID or not eval_identity["matches_pack"]:
        return fail_packet(work, "held-out CAP-EVAL-0 TOOL identity changed", eval_identity)
    if eval_identity["tool_eval_1"]["eval_id"] != V2_EVAL_ID or eval_identity["tool_eval_1"]["item_count"] != 12:
        return fail_packet(work, "TOOL-EVAL-1 identity failed", eval_identity["tool_eval_1"])
    baseline = json.loads((root / "model-lab/eval-only" / EVAL_ID / "wrim0-baseline.json").read_text(encoding="utf-8"))

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
        "tool_eval_id": V2_EVAL_ID,
        "tool_eval_suite_sha256": eval_identity["tool_eval_1"]["eval_sha256"],
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
        "authorization": "COMMANDER_TEST_WRIM1_1_RECOVERY_011_ONLY",
        "does_not_overwrite": [
            "WRIM-0", "WRX-000001", "WRIM1-RUN-000001", "WRIM1-RUN-000002",
            "Recovery-010/008/009", "WR-CORPUS-1.1-CAPABILITY-CANDIDATE", "WR-CORPUS-1.1-RECOVERY-010-NO-TOOL",
        ],
        "does_not_start": ["WRIM1-RUN-000003", "Recovery-012", "promotion", "production", "WRIM-1.2"],
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
    packed.pop("official_pack", None)
    packed.pop("planned_008", None)
    packed.pop("planned_010", None)
    packed.pop("rolling_5", None)
    packed.pop("rolling_10", None)
    packed.pop("v2_examples", None)
    packed.pop("packed010_train_units", None)
    packed.pop("packed008_train_units", None)
    packed.pop("eval1_suite", None)
    family_grad_rows = []
    last_objective = None
    n_objective_switches = 0
    tool_use_batches = 0
    quality_code_batches = 0
    tool_dominant_steps = []
    degeneration_trace = []
    density_rows = []
    switch_events = []
    tool_evals = {}

    def class_mix_for_starts(starts: list[int]) -> dict:
        by: dict[str, int] = defaultdict(int)
        origin_by: dict[str, int] = defaultdict(int)
        for st in starts:
            for s in spans:
                lo = max(st, s["start"])
                hi = min(st + CTX, s["end"])
                if hi > lo:
                    cls = classify(s["bucket"], s["origin"])
                    by[cls] += hi - lo
                    origin_by[str(s["origin"])] += hi - lo
        tot = int(sum(by.values())) or 1
        dominant = max(by.items(), key=lambda kv: (kv[1], kv[0]))[0] if by else "none"
        return {
            "class_counts": dict(by),
            "origin_counts": dict(origin_by),
            "dominant_class": dominant,
            "quality_code_tokens": int(by.get("QUALITY_CODE") or 0),
            "tool_tokens": int(by.get("TOOL_V2") or by.get("TOOL") or 0),
            "tool_pct": 100.0 * int(by.get("TOOL_V2") or by.get("TOOL") or 0) / tot,
        }

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
        sky = suite_out.get("sky_continuation") or ""
        hello = suite_out.get("hello_continuation") or suite_out.get("hello_probe") or ""
        joined = " ".join(str(it.get("continuation") or "") for it in (suite_out.get("items") or []))
        blob = sky + "\n" + str(hello) + "\n" + joined
        row["degeneration"] = {
            "underscore_run": int(row.get("underscore_run") or sky_sym.get("underscore_run") or 0),
            "pipe_run": int(row.get("pipe_run") or sky_sym.get("pipe_run") or 0),
            "not_loop": blob.count("_not_") >= 3 or "_not__not_" in blob,
            "not_count": blob.count("_not_"),
            "model_lab_hits": blob.count("model-lab") + blob.count("model_lab") + blob.count("-lab"),
            "letter_loop": letter_loop_text(sky) or letter_loop_text(blob),
        }
        degeneration_trace.append({"step": step, **row["degeneration"], "sky": sky[:120]})
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

    def score_tool_eval_item(item: dict, output: str) -> dict:
        text = output or ""
        idx = text.find("TOOL=")
        if idx < 0:
            return {"evalId": item.get("evalId"), "pass": False, "score": 0.0, "reason": "no TOOL="}
        return score_compact(item, text[idx:])

    def maybe_tool_eval(step: int):
        if step not in CAP_EVAL_STEPS:
            return
        results = []
        family_stats: dict[str, dict[str, int]] = {}
        for item in tool1_suite["items"]:
            gen = cap_generate(model, tokenizer, item["generation_prompt"], 64)
            scored = score_tool_eval_item(item, gen["continuation"])
            fam = item["family"]
            family_stats.setdefault(fam, {"n": 0, "pass": 0, "fail": 0})
            family_stats[fam]["n"] += 1
            if scored.get("pass"):
                family_stats[fam]["pass"] += 1
            else:
                family_stats[fam]["fail"] += 1
            none_ok = False
            exp = item.get("expected") or {}
            if exp.get("tool") == "none":
                none_ok = bool(scored.get("pass"))
            results.append({
                "evalId": item["evalId"],
                "family": fam,
                "level": item.get("level"),
                "difficulty": item.get("difficulty"),
                "expected_tool": exp.get("tool"),
                "output": (gen.get("continuation") or "")[:400],
                "n_new": gen.get("n_new"),
                **{k: v for k, v in scored.items() if k != "evalId"},
                "none_item": exp.get("tool") == "none",
                "none_pass": none_ok,
            })
        ev = {
            "suite_id": tool1_suite.get("suite_id"),
            "EXCLUDE_FROM_TRAINING": True,
            "INFERENCE_ONLY": True,
            "step": step,
            "TEST_ONLY": True,
            "pass_count": sum(1 for r in results if r.get("pass")),
            "item_count": len(results),
            "family_stats": family_stats,
            "results": results,
        }
        tool_evals[str(step)] = ev
        (work / f"tool-eval-1-step-{step:06d}.json").write_text(json.dumps(ev, indent=2, default=str) + "\n")

    val0 = evaluate_val(model, val_stream, val_mask, cfg, vocab)
    save_ckpt(0, cursor, "TEST_ONLY", val0)
    s0, lg0, row0 = diagnose(0, val0, None, full=True)
    maybe_cap_eval(0)
    maybe_tool_eval(0)
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
            cmix = class_mix_for_starts(list(mix.get("seq_starts") or []))
            obj = objective_of(mix)
            if last_objective is not None and obj != last_objective:
                n_objective_switches += 1
                switch_events.append({
                    "step": global_step + 1,
                    "from": last_objective,
                    "to": obj,
                    "loss_before": last_train_loss,
                    "grad_before": None if not last_grad_row else last_grad_row.get("global_grad_l2"),
                })
            last_objective = obj
            mix = {**mix, **cmix, "objective": obj, "objective_switch_count_so_far": n_objective_switches}
            mix_rows.append(mix)
            if cmix["quality_code_tokens"] > 0:
                quality_code_batches += 1
            if cmix["tool_tokens"] > 0:
                tool_use_batches += 1
            if cmix["dominant_class"] in ("TOOL", "TOOL_V2") or float(cmix["tool_pct"]) >= 15:
                tool_dominant_steps.append(global_step + 1)
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
            origin_stats = origin_ce_and_density(model, x, y, w, vocab, spans, mix.get("seq_starts") or [], CTX)
            fam_ce = origin_stats["ce_by_class"]
            family_loss_rows.append({
                "step": global_step + 1,
                "ce_by_family": fam_ce,
                "ce_by_class": origin_stats["ce_by_class"],
                "supervised_ce_aggregate": origin_stats["supervised_ce_aggregate"],
                "mix": mix.get("pct"),
            })
            density_rows.append({
                "step": global_step + 1,
                "batch_target_density": origin_stats["batch_target_density"],
                "batch_trainable_target_tokens": origin_stats["batch_trainable_target_tokens"],
                "batch_total_tokens": origin_stats["batch_total_tokens"],
                "density_by_class": origin_stats["density_by_class"],
                "objective": obj,
            })
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
                "dominant_class": cmix["dominant_class"],
                "objective": obj,
                "quality_code_tokens": cmix["quality_code_tokens"],
                "tool_pct": cmix["tool_pct"],
            })
            family_grad_rows.append({
                "step": global_step + 1,
                "dominant_class": cmix["dominant_class"],
                "class_counts": cmix["class_counts"],
                "global_grad_l2": ginfo.get("global_grad_l2"),
                "clip_applied": clipped,
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
            if switch_events and switch_events[-1].get("step") == global_step:
                switch_events[-1]["loss_after"] = loss_val
                switch_events[-1]["grad_after"] = ginfo.get("global_grad_l2")
                switch_events[-1]["clip_after"] = clipped
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
                    maybe_tool_eval(global_step)
                    break
            if global_step == 100:
                maybe_cap_eval(100)
                maybe_tool_eval(100)
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
                maybe_tool_eval(global_step)
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
        maybe_tool_eval(global_step)
    elif not early_stop["stopped"] and global_step == MAX_STEPS:
        maybe_cap_eval(MAX_STEPS)
        maybe_tool_eval(MAX_STEPS)

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
        "recovery_008_registry_mtime_after": (
            (prior_008 / "checkpoint-registry.json").stat().st_mtime
            if (prior_008 / "checkpoint-registry.json").is_file() else None
        ),
        "recovery_009_registry_mtime_after": (
            (prior_009 / "checkpoint-registry.json").stat().st_mtime
            if (prior_009 / "checkpoint-registry.json").is_file() else None
        ),
        "recovery_010_registry_mtime_after": (
            (prior_010 / "checkpoint-registry.json").stat().st_mtime
            if (prior_010 / "checkpoint-registry.json").is_file() else None
        ),
        "production_exists": PRODUCTION_ROOT.exists(),
        "work_dir_is_not_production": str(work.resolve()) != str(PRODUCTION_ROOT.resolve()) if PRODUCTION_ROOT.exists() else True,
    }
    prod_after["000001_registry_untouched"] = prod_before["wrim1_000001_registry_mtime"] == prod_after["wrim1_000001_registry_mtime_after"]
    prod_after["000002_registry_untouched"] = prod_before["official_000002_registry_mtime"] == prod_after["official_000002_registry_mtime_after"]
    prod_after["008_registry_untouched"] = prod_before["recovery_008_registry_mtime"] == prod_after["recovery_008_registry_mtime_after"]
    prod_after["009_registry_untouched"] = prod_before.get("recovery_009_registry_mtime") == prod_after["recovery_009_registry_mtime_after"]
    prod_after["010_registry_untouched"] = prod_before.get("recovery_010_registry_mtime") == prod_after["recovery_010_registry_mtime_after"]

    completed_250 = (not early_stop["stopped"]) and global_step == MAX_STEPS and not crash["crashed"]
    leak_ok = packed["stream_leak_scan"]["passed"] and packed["stream_leak_scan"]["known_eval_leakage"] == 0
    leak_ok = leak_ok and packed["stream_leak_scan_tool_eval_1"]["passed"] and packed["stream_leak_scan_tool_eval_1"]["known_eval_leakage"] == 0
    reload_ok = all(r.get("ok") for r in reload_proof if r.get("step") is not None)
    collapse_final = next((r.get("collapsed_probes") for r in reversed(diag_table) if r.get("collapsed_probes") is not None), None)
    no_broad = collapse_final is not None and int(collapse_final) < 6
    step100_row = next((r for r in diag_table if r.get("step") == 100), None)
    step120_row = next((r for r in diag_table if r.get("step") == 120), None)
    step75_row = next((r for r in diag_table if r.get("step") == 75), None)

    def loopish(row: dict | None) -> bool:
        if not row:
            return False
        deg = row.get("degeneration") or {}
        return bool(
            row.get("symbol_run")
            or letter_loop_text(row.get("sky_continuation") or "")
            or deg.get("not_loop")
            or int(deg.get("model_lab_hits") or 0) >= 3
            or int(row.get("underscore_run") or 0) >= 6
        )

    survived_009_region = (not early_stop["stopped"]) or (int(early_stop.get("step") or 0) > 75)
    survived_008_region = (not early_stop["stopped"]) or (int(early_stop.get("step") or 0) > 120)
    better_100_120 = True
    if step100_row and int(step100_row.get("collapsed_probes") or 99) >= 4 and loopish(step100_row):
        better_100_120 = False
    if step120_row and int(step120_row.get("collapsed_probes") or 99) >= 4 and loopish(step120_row):
        better_100_120 = False
    if early_stop["stopped"] and int(early_stop.get("step") or 0) <= 120:
        better_100_120 = False
    step100_better = False
    if step100_row:
        step100_better = int(step100_row.get("collapsed_probes") or 99) < 4 or not loopish(step100_row)
    v2_executed = tool_use_batches > 0
    comparable_to_010 = completed_250 and no_broad and int(collapse_final or 99) <= 4
    pass_ok = bool(
        completed_250 and leak_ok and no_broad and reload_ok and not nan_inf and not crash["crashed"]
        and (step100_decision or {}).get("continue", False)
        and step100_better
        and survived_008_region
        and survived_009_region
        and better_100_120
        and v2_executed
        and packed["v2_validator"]["passed"]
        and comparable_to_010
    )
    verdict = "WRIM-1.1 RECOVERY-011 — PASS" if pass_ok else "WRIM-1.1 RECOVERY-011 — FAIL"

    ckpt_list = []
    if registry_path.is_file():
        ckpt_list = json.loads(registry_path.read_text()).get("checkpoints") or []
    final_sha = None
    final_ckpt = work / f"checkpoint-step-{global_step:06d}"
    if (final_ckpt / "checkpoint-manifest.json").is_file():
        final_sha = json.loads((final_ckpt / "checkpoint-manifest.json").read_text()).get("model_tensor_sha256")

    def load_prior_diag(rel: Path, step: int) -> dict | None:
        p = rel / f"diagnostic-step-{step:06d}.json"
        if p.is_file():
            return json.loads(p.read_text(encoding="utf-8"))
        return None

    def brief_diag(row: dict | None) -> dict | None:
        if not row:
            return None
        return {
            "collapse": row.get("collapsed_probes"),
            "unique": row.get("mean_unique_ratio"),
            "lr": row.get("learning_rate"),
            "kl": (row.get("kl_to_wrim0") or {}).get("mean_kl_wrim0_to_current"),
            "param_l2": (row.get("param_drift") or {}).get("global_param_l2_from_wrim0"),
            "train_loss": row.get("train_loss"),
            "p_underscore": (row.get("logits") or {}).get("p_underscore"),
            "p_pipe": (row.get("logits") or {}).get("p_pipe"),
            "p_period": (row.get("logits") or {}).get("p_period"),
            "sky": (row.get("sky_continuation") or "")[:120],
            "degeneration": row.get("degeneration"),
            "symbol_run": row.get("symbol_run"),
            "underscore_run": row.get("underscore_run"),
            "global_grad_l2": row.get("global_grad_l2"),
        }

    compare_010 = {
        str(s): {
            "011": brief_diag(next((r for r in diag_table if r.get("step") == s), None)),
            "010": brief_diag(load_prior_diag(prior_010, s)),
        }
        for s in (25, 50, 75, 100, 120, 150, 200, 250)
    }
    compare_008 = {
        str(s): {
            "011": brief_diag(next((r for r in diag_table if r.get("step") == s), None)),
            "008": brief_diag(load_prior_diag(prior_008, s)),
        }
        for s in (50, 75, 100, 120)
    }
    compare_009 = {
        str(s): {
            "011": brief_diag(next((r for r in diag_table if r.get("step") == s), None)),
            "009": brief_diag(load_prior_diag(prior_009, s)),
        }
        for s in (50, 75)
    }
    by_fam_g = defaultdict(list)
    for r in family_grad_rows:
        g = r.get("global_grad_l2")
        if g is None:
            continue
        by_fam_g[r.get("dominant_class") or "OTHER"].append(float(g))
    family_grad_summary = {}
    for fam, xs in sorted(by_fam_g.items()):
        arr = np.array(xs, dtype=np.float64)
        family_grad_summary[fam] = {
            "n": int(arr.size),
            "mean": float(arr.mean()),
            "median": float(np.median(arr)),
            "max": float(arr.max()),
            "clip_count": int(sum(1 for r in family_grad_rows if r.get("dominant_class") == fam and r.get("clip_applied"))),
        }
    if "TOOL_V2" not in family_grad_summary:
        family_grad_summary["TOOL_V2"] = {"n": 0, "mean": None, "median": None, "max": None, "clip_count": 0}

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

    def tool_brief(step: int):
        ev = tool_evals.get(str(step))
        if not ev:
            return None
        return {
            "pass_count": ev["pass_count"],
            "item_count": ev["item_count"],
            "family_stats": ev.get("family_stats"),
        }

    tool_ce_series = []
    for r in family_loss_rows:
        ce = (r.get("ce_by_class") or {}).get("TOOL_V2")
        if ce is not None:
            tool_ce_series.append({"step": r["step"], "TOOL_V2_ce": ce})

    t0_tool = tool_evals.get("0") or {}
    t_final = tool_evals.get(str(global_step)) or tool_evals.get("250") or {}
    tool_acq = "INCONCLUSIVE"
    if t0_tool and t_final and t_final.get("item_count"):
        if int(t_final.get("pass_count") or 0) > int(t0_tool.get("pass_count") or 0):
            tool_acq = "DEMONSTRATED"
        else:
            tool_acq = "NOT DEMONSTRATED"

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
        "control_curriculum_id": packed["parent_curriculum_id_010"],
        "curriculum_stream_sha256": train_sha,
        "eval_id": EVAL_ID,
        "eval_suite_sha256": eval_sha,
        "tool_eval_id": V2_EVAL_ID,
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
            "key_steps": {str(s): lr_recovery_008(s) for s in (25, 50, 75, 100, 125, 150, 200, 249)},
        },
        "planned_steps": MAX_STEPS,
        "completed_steps": global_step,
        "tokens_seen": cursor.tokens_consumed,
        "elapsed_sec": time.time() - t0,
        "checkpoints": ckpt_list,
        "final_checkpoint_sha256": final_sha,
        "packing": report,
        "stream_identity": stream_cmp,
        "step_mapping_010_to_011": {k: packed["step_mapping_010_to_011"][k] for k in packed["step_mapping_010_to_011"] if k != "steps"},
        "mask_proof": packed["mask_proof"],
        "v1_absence_proof": packed["v1_absence_proof"],
        "v2_gradient_proof": packed["v2_gradient_proof"],
        "causal_proof": {k: audit[k] for k in audit if k != "examples"},
        "leakage_cap_eval_0": packed["stream_leak_scan"],
        "leakage_tool_eval_1": packed["stream_leak_scan_tool_eval_1"],
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
        "tool_eval_1_steps": {k: tool_brief(int(k)) for k in tool_evals},
        "tool_v2_ce_series": tool_ce_series,
        "tool_capability_acquisition": tool_acq,
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
        "compare_vs_010": compare_010,
        "compare_vs_008": compare_008,
        "compare_vs_009": compare_009,
        "quality_code_batches": quality_code_batches,
        "tool_v2_batches": tool_use_batches,
        "n_objective_switches": n_objective_switches,
        "objective_switch_events": switch_events,
        "tool_associated_steps": tool_dominant_steps,
        "family_grad_summary": family_grad_summary,
        "target_density_n": len(density_rows),
        "v2_target_density": packed["v2_target_density"],
        "degeneration_trace": degeneration_trace,
        "better_than_008_around_100_120": better_100_120,
        "survived_008_failure_region": survived_008_region,
        "survived_009_failure_region": survived_009_region,
        "v2_curriculum_executed": v2_executed,
        "verdict": verdict,
        "pid": pid,
    }
    (work / "experiment-summary.json").write_text(json.dumps(summary, indent=2, default=str) + "\n")
    (work / "clip-events.json").write_text(json.dumps(clip_events, indent=2) + "\n")
    (work / "family-loss.json").write_text(json.dumps(family_loss_rows, indent=2) + "\n")
    (work / "grad-rows.json").write_text(json.dumps(grad_rows, indent=2) + "\n")
    (work / "actual-step-source-map.json").write_text(json.dumps({"steps": mix_rows}, indent=2) + "\n")
    (work / "gate-warnings.json").write_text(json.dumps(gate_warnings, indent=2) + "\n")
    (work / "family-grad.json").write_text(json.dumps({"rows": family_grad_rows, "summary": family_grad_summary}, indent=2) + "\n")
    (work / "degeneration-trace.json").write_text(json.dumps(degeneration_trace, indent=2) + "\n")
    (work / "compare-vs-010.json").write_text(json.dumps(compare_010, indent=2) + "\n")
    (work / "compare-vs-008.json").write_text(json.dumps(compare_008, indent=2) + "\n")
    (work / "compare-vs-009.json").write_text(json.dumps(compare_009, indent=2) + "\n")
    dens_vals = [r["batch_target_density"] for r in density_rows]
    density_summary = {}
    if dens_vals:
        arr = np.array(dens_vals, dtype=np.float64)
        density_summary["all_batches"] = {
            "n": int(arr.size),
            "mean": float(arr.mean()),
            "median": float(np.median(arr)),
            "min": float(arr.min()),
            "max": float(arr.max()),
        }
    by_obj = defaultdict(list)
    for r in density_rows:
        by_obj[r.get("objective") or "UNK"].append(r["batch_target_density"])
    for obj_k, xs in by_obj.items():
        a = np.array(xs, dtype=np.float64)
        density_summary[obj_k] = {"n": int(a.size), "mean": float(a.mean()), "median": float(np.median(a))}
    (work / "target-density.json").write_text(json.dumps({"rows": density_rows, "summary": density_summary}, indent=2, default=str) + "\n")
    (work / "objective-switching.json").write_text(json.dumps({
        "n_switches": n_objective_switches,
        "events": switch_events,
        "quality_code_batches": quality_code_batches,
        "tool_use_batches": tool_use_batches,
        "tool_associated_steps": tool_dominant_steps,
        "switch_algorithm_unchanged": True,
        "objective_of": "supervised>=50 SUPERVISED; >=15 MIXED; else CAUSAL",
    }, indent=2) + "\n")

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
