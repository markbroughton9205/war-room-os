"""Stage 3 runtime primitives: authorization gate, hard stops, review bands, checkpoints.

Generic train remains denied. STAGE3A-only confirmation is gated to 50 optimizer steps.
STAGE3B remains unauthorized.
"""
from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from stage3_schedule import (
    PEAK_LR,
    STAGE3A_MIN_LR,
    STAGE3A_STEPS,
    STAGE3A_WARMUP_STEPS,
    STAGE3B_END_STEP,
    STAGE3B_MIN_LR,
    STAGE3B_START_LR,
    STAGE3B_START_STEP,
    STAGE3B_STEPS,
)

RUN_ID = "WRIM1-RUN-000003"
SEGMENT_A = "STAGE3A"
SEGMENT_B = "STAGE3B"
CLASSIFICATION = "CONTROLLED_CONFIRMATION_RUN"
PARENT_ID = "WRIM-0"
PARENT_SHA = "d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015"
TOKENIZER_ID = "WR-TOKENIZER-0"
TOKENIZER_SHA = "47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7"
ARCHITECTURE = "WRIM-G-20M-v1-option-A"
PARAM_COUNT = 19_217_152
SUITE_ID = "WRIM-EVAL-S3-000001"
SUITE_VERSION = "1.0.0"
SUITE_SHA = "934ff60bcd179ec643257fbfaa30f2a3a7621b175fc7d3c3d0efc30d946d5ac4"
BASELINE_SHA = "7c1cc9fe7d4208d93cd3cdb6b25783daea8947ae26622e706d4a0032f934ed5f"
SEED = 3003
SEQ_LEN = 512
MICRO_BATCH = 8
GRAD_ACCUM = 1
EFFECTIVE_BATCH = 8
TOKENS_PER_STEP = 4096
STAGE3A_TOKEN_BUDGET = STAGE3A_STEPS * TOKENS_PER_STEP
PRECISION = "FP32"
TF32 = "OFF"
ADAMW = {
    "name": "AdamW",
    "fused": False,
    "betas": [0.9, 0.95],
    "eps": 1e-8,
    "weight_decay": 0.1,
    "grad_clip": 1.0,
    "fresh_at_stage3a_start": True,
    "reuse_moments_for_stage3b": True,
}
REHEARSAL = "NATURAL_BASELINE"
PACKING = "contiguous_unit"
BOS = 1
EOS = 2
PER_TOKEN_SHUFFLE = False
CORPUS0_SHARE = 0.30
CORPUS1_SHARE = 0.70
TOOL_USE_SHARE = 0.0
DISK_WARN_GB = 64
DISK_STOP_GB = 32

# STAGE3A confirmation and Commander review completed. Training remains OFF.
STAGE3_AUTHORIZATION = "NO"
TRAINING_AUTHORIZATION = "OFF"
STAGE3B_AUTHORIZATION = "NO"
MAX_AUTHORIZED_OPTIMIZER_STEPS = 50
STAGE3A_STATUS = "REVIEWED"

REVIEW_BANDS = {
    "kind": "REVIEW_TRIGGER_ONLY",
    "not_promotion_thresholds": True,
    "not_automatic_fail": True,
    "stage3a_step_50": {
        "anchor_dnll_review_at_or_above": 0.105,
        "kl_review_at_or_above": 0.018,
        "val0_review_at_or_above": 8.890125,
        "val1_review_at_or_above": 7.971308,
    },
    "also_review": [
        "whole-category regression/collapse",
        "special-token rate materially above frozen WRIM-0 baseline",
        "major repetition collapse",
        "unexpected loss of previously improved behavior",
    ],
    "historical_binary_6_of_6": "COMPATIBILITY_ONLY",
    "do_not_hard_stop_on_binary_flip_alone": True,
}

HARD_STOP_CONDITIONS = [
    "NaN_loss",
    "Inf_loss",
    "NaN_Inf_gradients",
    "gradient_corruption",
    "tokenizer_sha_mismatch",
    "parent_sha_mismatch",
    "suite_sha_mismatch",
    "baseline_sha_mismatch",
    "packing_invariant_failure",
    "leakage_validator_failure",
    "checkpoint_corruption",
    "runtime_corruption",
    "disk_below_32GB",
    "special_token_takeover_loop",
    "extreme_repetition_collapse",
    "invalid_architecture_or_tensor_shape",
    "optimizer_scheduler_state_corruption",
]

CHECKPOINT_SCHEME = {
    "stage3a": {
        "0": ["parent_pointer_only"],
        "25": ["weights", "manifest", "metrics"],
        "50": [
            "weights",
            "optimizer_state",
            "scheduler_state",
            "rng_state",
            "data_packing_cursor",
            "run_manifest",
            "metrics",
            "sha256",
        ],
    },
    "stage3b_if_later_authorized": {
        "100": ["weights", "metrics"],
        "150": ["weights", "metrics"],
        "250": [
            "weights",
            "optimizer_state",
            "scheduler_state",
            "rng_state",
            "data_packing_cursor",
            "run_manifest",
            "metrics",
            "sha256",
        ],
    },
    "no_per_step_full_checkpoints": True,
    "step_0_is_not_a_trained_checkpoint": True,
}

EVAL_SCHEDULE = {
    "stage3a": {
        "0": "full_suite+val0+val1+CAP-EVAL-0+DIAGNOSTIC-0+continuous_retention",
        "25": "compact_health",
        "50": "full_suite+val0+val1+CAP-EVAL-0+DIAGNOSTIC-0+continuous_retention",
    },
    "stage3b_if_later_authorized": {
        "100": "compact",
        "150": "compact",
        "250": "full",
        "abort": "safe_final_diagnostic_if_integrity_permits",
    },
}

INTERPOLATION_HOOK = {
    "alphas": [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 1.0],
    "reuse": "phase3a_interpolation.lerp_state",
    "classification": "TEST_ONLY",
    "auto_run_during_training": False,
    "auto_promote": False,
    "logit_ensemble": False,
}

PRIMARY_METRICS = [
    "WRIM0_ANCHOR_NLL_DELTA",
    "KL_WRIM0_TO_CANDIDATE",
    "val_loss_corpus0",
    "val_loss_corpus1",
    "per_category_WRIM_EVAL_S3",
    "special_token_emission_rate",
    "repetition_collapse",
    "structured_output",
    "generation_fingerprints",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def disk_gb(path: Path) -> float:
    path.mkdir(parents=True, exist_ok=True)
    return shutil.disk_usage(path).free / (1024**3)


def disk_guard(path: Path) -> dict[str, Any]:
    free = disk_gb(path)
    return {
        "ok": free > DISK_STOP_GB,
        "warn": free < DISK_WARN_GB,
        "hard_stop": free <= DISK_STOP_GB,
        "free_gb": round(free, 3),
        "warn_threshold_gb": DISK_WARN_GB,
        "stop_threshold_gb": DISK_STOP_GB,
        "cleanup_during_training": False,
    }


def authorization_allows_stage3a(
    stage3_authorization: str = STAGE3_AUTHORIZATION,
    training_authorization: str = TRAINING_AUTHORIZATION,
    stage3b_authorization: str = STAGE3B_AUTHORIZATION,
) -> bool:
    return (
        stage3_authorization == "YES_FOR_STAGE3A_ONLY"
        and training_authorization == "ON_FOR_STAGE3A_ONLY"
        and stage3b_authorization == "NO"
    )


def authorization_allows_training(
    stage3_authorization: str = STAGE3_AUTHORIZATION,
    training_authorization: str = TRAINING_AUTHORIZATION,
) -> bool:
    # Generic unbounded train remains denied. STAGE3A uses authorization_allows_stage3a().
    return False


def authorization_gate(
    *,
    requested_mode: str,
    stage3_authorization: str = STAGE3_AUTHORIZATION,
    training_authorization: str = TRAINING_AUTHORIZATION,
) -> dict[str, Any]:
    if requested_mode == "dry-run":
        return {
            "allowed": False,
            "requested_mode": requested_mode,
            "STAGE3_AUTHORIZATION": stage3_authorization,
            "TRAINING_AUTHORIZATION": training_authorization,
            "STAGE3B_AUTHORIZATION": STAGE3B_AUTHORIZATION,
            "decision": "DRY_RUN_OK",
            "max_optimizer_steps": 0,
            "reason": "Dry-run does not create/step an optimizer.",
        }
    if requested_mode == "stage3a":
        allowed = authorization_allows_stage3a(stage3_authorization, training_authorization)
        return {
            "allowed": allowed,
            "requested_mode": requested_mode,
            "STAGE3_AUTHORIZATION": stage3_authorization,
            "TRAINING_AUTHORIZATION": training_authorization,
            "STAGE3B_AUTHORIZATION": STAGE3B_AUTHORIZATION,
            "decision": "STAGE3A_AUTHORIZED" if allowed else "TRAINING_DENIED",
            "max_optimizer_steps": MAX_AUTHORIZED_OPTIMIZER_STEPS if allowed else 0,
            "reason": None
            if allowed
            else "STAGE3A requires STAGE3_AUTHORIZATION=YES_FOR_STAGE3A_ONLY and TRAINING_AUTHORIZATION=ON_FOR_STAGE3A_ONLY and STAGE3B_AUTHORIZATION=NO.",
        }
    return {
        "allowed": False,
        "requested_mode": requested_mode,
        "STAGE3_AUTHORIZATION": stage3_authorization,
        "TRAINING_AUTHORIZATION": training_authorization,
        "STAGE3B_AUTHORIZATION": STAGE3B_AUTHORIZATION,
        "decision": "TRAINING_DENIED",
        "max_optimizer_steps": 0,
        "reason": "Generic train / STAGE3B / step 51 are not authorized. STAGE3A-only CLI is the sole training path.",
    }


def abort_payload(*, reason: str, step: int | None, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    body = {
        "ok": False,
        "kind": "ABORT",
        "run_id": RUN_ID,
        "reason": reason,
        "step": step,
        "timestamp": utc_now(),
        "TRAINING_AUTHORIZATION": "OFF",
        "STAGE3_AUTHORIZATION": "NO_PENDING_REVIEW",
        "STAGE3A_STATUS": "ABORTED",
        "STAGE3B_EXECUTION_READINESS": False,
        "STAGE3B_AUTHORIZATION": "NO",
        "stage3_started": False,
        "promotion_candidate": False,
        **(extra or {}),
    }
    return body


def write_abort(root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    write_json(root / "ABORT.json", payload)
    return payload


def parent_pointer(*, weights_path: Path, parent_sha: str) -> dict[str, Any]:
    return {
        "kind": "PARENT_POINTER_ONLY",
        "step": 0,
        "parent_id": PARENT_ID,
        "parent_sha256": parent_sha,
        "weights_path": str(weights_path),
        "not_a_trained_checkpoint": True,
        "optimizer_state_present": False,
    }


def run_manifest_template() -> dict[str, Any]:
    return {
        "run_id": RUN_ID,
        "segment": SEGMENT_A,
        "classification": CLASSIFICATION,
        "parent_id": PARENT_ID,
        "parent_sha256": PARENT_SHA,
        "tokenizer_id": TOKENIZER_ID,
        "tokenizer_sha256": TOKENIZER_SHA,
        "suite_id": SUITE_ID,
        "suite_version": SUITE_VERSION,
        "suite_sha256": SUITE_SHA,
        "baseline_sha256": BASELINE_SHA,
        "architecture": ARCHITECTURE,
        "param_count": PARAM_COUNT,
        "architecture_class": "dense",
        "seed": SEED,
        "optimizer": ADAMW,
        "schedule": {
            "stage3a": {
                "peak_lr": PEAK_LR,
                "min_lr": STAGE3A_MIN_LR,
                "warmup_steps": STAGE3A_WARMUP_STEPS,
                "steps": STAGE3A_STEPS,
                "warmup": "lr(step)=peak_lr*step/25 for 1<=step<=25",
                "cosine": "progress=(step-25)/25; lr=min_lr+0.5*(peak_lr-min_lr)*(1+cos(pi*progress)) for 25<step<=50",
            },
            "stage3b": {
                "status": "FROZEN_FOR_REVIEW",
                "authorized": False,
                "start_lr": STAGE3B_START_LR,
                "min_lr": STAGE3B_MIN_LR,
                "steps": STAGE3B_STEPS,
                "global_range": [STAGE3B_START_STEP, STAGE3B_END_STEP],
                "progress": "(s-50)/200",
                "no_warmup": True,
                "no_lr_reset": True,
                "no_return_to_peak": True,
            },
        },
        "corpus_mix": {
            "WR-CORPUS-0": CORPUS0_SHARE,
            "WR-CORPUS-1": CORPUS1_SHARE,
            "TOOL_USE": TOOL_USE_SHARE,
        },
        "rehearsal_policy": REHEARSAL,
        "packing": PACKING,
        "bos": BOS,
        "eos": EOS,
        "per_token_shuffle": PER_TOKEN_SHUFFLE,
        "step_range": [1, STAGE3A_STEPS],
        "token_budget": STAGE3A_TOKEN_BUDGET,
        "precision": PRECISION,
        "tf32": TF32,
        "seq_len": SEQ_LEN,
        "micro_batch": MICRO_BATCH,
        "grad_accum": GRAD_ACCUM,
        "effective_batch": EFFECTIVE_BATCH,
        "tokens_per_step": TOKENS_PER_STEP,
        "authorization": {
            "STAGE3_AUTHORIZATION": STAGE3_AUTHORIZATION,
            "TRAINING_AUTHORIZATION": TRAINING_AUTHORIZATION,
        },
        "review_bands": REVIEW_BANDS,
        "hard_stops": HARD_STOP_CONDITIONS,
        "checkpoint_scheme": CHECKPOINT_SCHEME,
        "eval_schedule": EVAL_SCHEDULE,
        "interpolation_hook": INTERPOLATION_HOOK,
        "primary_metrics": PRIMARY_METRICS,
        "created_at": utc_now(),
    }
