"""WRIM retention-repair experiment recipe freeze.

Design only. Does not construct an optimizer. Does not train.
Does not mutate corpus, tokenizer, parent weights, or streams.
Does not create checkpoints. Does not authorize P3 or STAGE3B.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from foundational_p1_refine import npy_payload_sha, sha256_file, write_json
from p2_schedule import FORMULA as P2_LR_FORMULA
from p2_schedule import lr_p2, self_test as p2_sched_self_test
from retention_repair_schedule import FORMULA_B, FORMULA_C, HORIZON_B, WARMUP_STEPS as SCHED_WARMUP
from retention_repair_schedule import lr_schedule_decay_50
from retention_repair_schedule import self_test as repair_sched_self_test
from stop_policy import STOP_POLICY_VERSION

KIND = "WRIM_RETENTION_REPAIR_EXPERIMENTS"
BASELINE_RUN = "WRIM1-RUN-000005"
BASELINE_RECIPE_SHA = "5b6237dcad4321111510453c9bfcb6713a8f61a8218c487afd67952a42d18117"
PARENT_ID = "WRIM-0"
PARENT_SHA = "d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015"
TOKENIZER_ID = "WR-TOKENIZER-0"
TOKENIZER_SHA = "47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7"
SOVEREIGN_SEED = 2303
SOVEREIGN_STREAM_SHA = "5bf8951e364ed9a7f02889d4d96e44c7a9d3a2e6a78464c8fe4b43c9bbe22db5"
SOVEREIGN_PACKED_SOURCE_SHA = "83e9478376386fd2e1d02a26891fab0ec6714063445e5915bbb06376a7ca5011"
SUITE_ID = "WRIM-EVAL-S3-000001"
SUITE_HASH = "934ff60bcd179ec643257fbfaa30f2a3a7621b175fc7d3c3d0efc30d946d5ac4"
SEQ_LEN = 512
MICRO_BATCH = 8
GRAD_ACCUM = 1
TOKENS_PER_STEP = 4096
BETAS = [0.9, 0.95]
EPS = 1e-8
WEIGHT_DECAY = 0.1
GRAD_CLIP = 1.0
PRECISION = "FP32"
RUNTIME_SEED = 5005
EVAL_SEED = 42
PACKER_MODE = "DEFICIT_INTERLEAVE_FAMILIES"
PACKER_VERSION = "deficit-interleave-families-v1"
FIRST_LAMBDA = 0.10
LAMBDA_CANDIDATES = [0.05, 0.10, 0.20]
EXP_A_ID = "RB-EXP-B_FROZEN_WRIM0_KL"
EXP_B_ID = "RB-EXP-A_COSINE_HORIZON_25"
EXP_C_ID = "RB-EXP-C_PEAK_LR_3E-6"
OLD_SCHEDULE_HASH = "75ef284ccdfe56424a98c455d843e043fa6e42cb6dc95744d2603b2eafeb95af"
NEW_SCHEDULE_HASH = "d8e8685d76dc09e61ff1c8f7cf1bf3f7b6aae872d90f03e6617353e9eb3582ba"
PRESERVED_A_HASH = "715610067775261280cd010b4af9eaf8c5e9664535e70663a787709e78cd32b3"
PRESERVED_A_L05_HASH = "3376b4173258ea53e50ab427de74aa5bec7171937e8197d36b0c99d8ab5d9f45"
PRESERVED_A_L20_HASH = "c26a3517f89cdd992bf194be6f85b6c98674583636d20bf59d8cc6bb0f72740d"
PRESERVED_C_HASH = "19ebf831bed855c3fd97c40c12e60c9d0ebfc064ce2cfd627d8fb49748bafa8f"

FROZEN_VARS = [
    "parent_WRIM-0",
    "parent_sha256",
    "tokenizer",
    "tokenizer_sha256",
    "stream",
    "stream_order",
    "stream_sha256",
    "packed_source_sha256",
    "packer",
    "optimizer_family_AdamW",
    "betas",
    "eps",
    "weight_decay",
    "grad_clip_1.0_global_l2",
    "sequence_512",
    "microbatch_8",
    "grad_accum_1",
    "tokens_per_step_4096",
    "precision_FP32",
    "tf32_off",
    "runtime_seed_5005",
    "eval_seed_42",
    "packing_seed_2303",
    "stop_policy_wrim-stop-policy-v1",
    "architecture_WRIM-G-20M-v1-option-A",
    "eval_suite_WRIM-EVAL-S3-000001",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def recipe_hash(recipe: dict[str, Any]) -> str:
    blob = json.dumps(recipe, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def base_fields() -> dict[str, Any]:
    return {
        "parent": PARENT_ID,
        "parent_sha256": PARENT_SHA,
        "tokenizer": TOKENIZER_ID,
        "tokenizer_sha256": TOKENIZER_SHA,
        "stream_sha": SOVEREIGN_STREAM_SHA,
        "packed_source_sha256": SOVEREIGN_PACKED_SOURCE_SHA,
        "seed": SOVEREIGN_SEED,
        "packer": PACKER_MODE,
        "packer_version": PACKER_VERSION,
        "optimizer": "AdamW",
        "optimizer_fused": False,
        "optimizer_fresh": True,
        "betas": BETAS,
        "beta1": BETAS[0],
        "beta2": BETAS[1],
        "eps": EPS,
        "weight_decay": WEIGHT_DECAY,
        "grad_clip": GRAD_CLIP,
        "grad_clip_type": "global_l2_norm",
        "grad_clip_when": "after_backward_before_optimizer_step",
        "grad_scaler": False,
        "precision": PRECISION,
        "tf32": False,
        "sequence_length": SEQ_LEN,
        "micro_batch": MICRO_BATCH,
        "grad_accum": GRAD_ACCUM,
        "effective_tokens_per_step": TOKENS_PER_STEP,
        "resume_policy": "RESTART_REQUIRED_NOT_RESUMABLE",
        "oom_policy": "HARD_ABORT",
        "oom_no_dynamic_recipe_change": True,
        "eval_decoder": "GREEDY",
        "eval_suite_id": SUITE_ID,
        "eval_suite_hash": SUITE_HASH,
        "architecture": "WRIM-G-20M-v1-option-A",
        "parameter_count": 19_217_152,
        "training_authorized": False,
        "P3_AUTHORIZED": False,
        "STAGE3B_AUTHORIZATION": "NO",
        "promotion_forbidden": True,
        "ce_cannot_override_retention_failure": True,
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
            "bitwise_reproducible": False,
        },
    }


def stop_and_success() -> dict[str, Any]:
    return {
        "stop_policy_version": STOP_POLICY_VERSION,
        "stop_policy_unchanged": True,
        "no_weaker_retention_gates": True,
        "continuation_ce_cannot_override_retention_failure": True,
        "stop_policy_enforcement": (
            "After each compact/full eval, call wrim-stop-policy-v1 decide(). "
            "If next_optimizer_step_allowed is false, halt before the next optimizer step. "
            "HARD_ABORT stops immediately. Improved val CE does not authorize continuation."
        ),
        "additional_hard_gates_not_in_stop_policy_json": {
            "item_max_dnll_gt": 0.105,
            "item_max_dnll_reason": "item_dnll_gt_0.105",
            "family_mean_dnll_gt": 0.105,
            "family_mean_dnll_reason": "family_mean_dnll_gt_0.105",
            "note": (
                "These are STRICTER additions on top of wrim-stop-policy-v1. "
                "They do not fork or weaken the canonical policy file."
            ),
        },
        "retained_existing_hard_aborts": [
            "dnll_gt_0.105",
            "kl_gt_0.018",
            "val0_gt_parent",
            "cap_le_3_of_6",
            "special_rate_gt_0.08",
            "NaN_or_Inf",
            "hash_mismatch",
            "contamination",
            "disk_runtime_integrity_failure",
        ],
        "retained_generation_axes": ["looping", "collapse", "unique128", "unique256"],
        "retained_floor_metrics": ["json_valid", "instruction", "entity"],
        "success_requires_both": True,
        "retention_success_vs_RUN_000005": {
            "must_remain_inside_hard_bands": True,
            "mean_dnll_step10_lt": 0.010,
            "mean_dnll_step25_lt": 0.040,
            "mean_dnll_step50_lt_if_reached": 0.080,
            "mean_kl_lt": 0.018,
            "no_item_dnll_gt": 0.105,
            "no_family_mean_dnll_gt": 0.105,
            "run_000005_reference": {
                "step10_mean_dnll": 0.010090807506016323,
                "step25_mean_dnll": 0.0644819872719901,
                "step50_mean_dnll": 0.18126074245997836,
                "step50_mean_kl": 0.024697155359068086,
            },
            "note": "Surviving longer than step 50 is not a pass by itself.",
        },
        "generation_success_vs_WRIM0": {
            "seed": EVAL_SEED,
            "decoding": "greedy_argmax",
            "suite": SUITE_ID,
            "looping_proxy_not_above_parent_plus_2": True,
            "unique128_not_below_parent_minus_0.05": True,
            "unique256_not_below_parent_minus_0.05": True,
            "mean_unique_ratio_not_worse_than_parent_by_gt_10pct_relative": True,
            "parent_mean_unique_ratio_forensic": 0.32176,
            "parent_looping_proxy_forensic": 3,
            "json_valid_not_below_parent": True,
            "code_syntax_valid_not_below_parent": True,
            "parent_json_valid_n": 0,
            "parent_code_syntax_valid_n": 0,
            "collapse_not_materially_worse": True,
            "note": "JSON/code structural checks stay in the gate even if parent is already at floor 0. Leaving the floor is improvement; dropping below parent is fail. Unchanged-at-floor is not a generation pass by itself.",
        },
        "explicit_non_promotion_rules": [
            "No promotion based only on lower validation CE.",
            "No promotion based only on surviving longer.",
            "No promotion based only on lower ΔNLL if generation collapses.",
            "Step 10 of RUN-000005 is not a promotion parent.",
            "No architecture expansion in these experiments.",
        ],
    }


def observability_contract() -> dict[str, Any]:
    return {
        "bus": "scripts/wrim-environment/observability_bus.py",
        "direct_tensorboard_mlflow_aim_from_trainer": False,
        "emit_wrim_observability_events_only": True,
        "historical_unknown_must_be_logged_if_safe": True,
        "per_optimizer_step_required": [
            "pre_clip_gradient_norm",
            "post_clip_gradient_norm",
            "clipping_ratio",
            "was_clipped",
            "lr",
            "cumulative_lr_exposure",
            "train_loss",
            "ce_stream_loss",
            "retention_term_loss",
            "lambda",
            "validation_loss_if_eval_step",
            "parameter_norm",
            "update_norm",
            "update_weight_ratio",
            "tokens_seen",
            "optimizer_step",
            "stream_position",
            "eval_seed",
        ],
        "post_clip_measurement": (
            "After clip_grad_norm_, recompute global L2 of .grad tensors. "
            "Do not store the clip_grad_norm_ return as post-clip. That return is pre-clip."
        ),
        "per_compact_eval_required": [
            "val0",
            "val1",
            "mean_dnll",
            "mean_kl",
            "item_max_dnll",
            "per_family_retention_nll",
            "per_family_retention_kl",
            "per_family_delta_nll",
            "looping",
            "collapse",
            "unique128",
            "unique256",
            "json_valid",
            "code_syntax_valid",
            "generation_sample_ids",
            "layer_family_displacement",
            "stop_policy_decision",
        ],
        "checkpoint_policy_addition": {
            "save_optimizer_at_compact_eval": True,
            "reason": "RUN-000005 left optimizer moments UNKNOWN. Next authorized run must persist optimizer.safetensors at compact steps and halt.",
            "does_not_change_optimizer_hyperparameters": True,
        },
    }


def checkpoint_policy(compact: list[int], full: list[int], weight_saves: list[int], opt_saves: list[int]) -> dict[str, Any]:
    return {
        "step0": "parent_pointer_only",
        "metrics_every_optimizer_step": True,
        "compact_eval_steps": compact,
        "full_eval_steps": full,
        "save_weights_steps": weight_saves,
        "save_optimizer_steps": opt_saves,
        "always_save_weights_on_stop_policy_halt": True,
        "always_save_optimizer_on_stop_policy_halt": True,
        "never_lose_terminal_state": True,
        "analysis_only_interpolants_forbidden_as_official_checkpoints": True,
    }


def lambda_sweep() -> dict[str, Any]:
    return {
        "executed": False,
        "candidates": LAMBDA_CANDIDATES,
        "first_run_lambda": FIRST_LAMBDA,
        "first_run_selection_criteria": [
            "Choose the middle of the bounded sweep so the term is neither a no-op nor a freeze.",
            "λ=0.05: expected weak; KL/ΔNLL at RUN-000005 halt grew while CE~8 dominated. Risk of repeating the halt.",
            "λ=0.10: FIRST RUN. Retention NLL has first-order gradient from step 1 (unlike KL~0 at init). Expected to keep mean ΔNLL inside 0.105 if OBJECTIVE_MISMATCH is primary, while still allowing val0 to fall.",
            "λ=0.20: higher risk of blocking mix-fit (val0 flat/up). Use only if 0.10 still crosses ΔNLL 0.105 with unused CE headroom.",
            "Do not run the three lambdas as a grid in one authorization. Commander authorizes one lambda per training pass.",
        ],
        "per_candidate": {
            "0.05": {
                "expected_retention_effect": "May delay the 25-50 cliff; likely insufficient against CE on 4096 tokens vs 1120 anchor tokens.",
                "risk_of_blocking_learning": "Low.",
                "expected_gradient_interaction": "Retention grad small vs stream CE; clip frequency similar to RUN-000005.",
            },
            "0.10": {
                "expected_retention_effect": "Should hold family mean ΔNLL below 0.105 through step 25; step 50 is the test of whether objective alone beats the peak-LR plateau.",
                "risk_of_blocking_learning": "Moderate. val0 should still drop vs WRIM-0; if it does not, λ is too strong.",
                "expected_gradient_interaction": "Global clip sees CE+λNLL. Log post-clip. Do not split backwards unless a later diagnostic pass is authorized.",
            },
            "0.20": {
                "expected_retention_effect": "Strongest freeze toward WRIM-0 greedy anchors. ΔNLL likely stays small.",
                "risk_of_blocking_learning": "High. May copy WRIM-0 looping into the trained weights.",
                "expected_gradient_interaction": "Retention term can dominate late in the run as stream CE saturates; watch clip ratio and uniqueness.",
            },
        },
        "why_nll_not_kl_as_train_term": (
            "The halt metric is ΔNLL on frozen WRIM-EVAL-S3-000001 historical_32 token IDs. "
            "Teacher-forced NLL on those IDs is the same reduction. KL(p_WRIM0||q) is ~0 at initialization "
            "so it has little first-order gradient when drift starts. KL remains a logged eval metric, not the train term. "
            "Experiment ID keeps FROZEN_WRIM0_KL as the Commander identifier."
        ),
        "anchor_material": {
            "suite_id": SUITE_ID,
            "suite_hash": SUITE_HASH,
            "targets": "items[].historical_32.new_ids from wrim-eval-s3-000001-wrim0-baseline.json",
            "prompts": "STAGE3 prompt_text via encode_prompt_ids",
            "n_items": 35,
            "target_tokens_per_item": 32,
            "new_dataset": False,
        },
    }


def experiment_a(lambda_value: float) -> dict[str, Any]:
    recipe = {
        **base_fields(),
        "experiment_id": EXP_A_ID,
        "priority": 1,
        "principal_variable": "training_objective",
        "one_variable_change": "L = CE_stream + lambda * teacher_forced_NLL_on_frozen_S3_historical_32",
        "lambda": lambda_value,
        "peak_lr": 1e-5,
        "min_lr": 1e-6,
        "warmup_steps": 25,
        "scheduler": "warmup_cosine_1_indexed",
        "scheduler_formula": P2_LR_FORMULA,
        "scheduler_total_steps": 1000,
        "total_steps": 1000,
        "max_authorized_optimizer_steps": 50,
        "max_authorized_tokens": 204_800,
        "objective": {
            "stream_loss": "mean_token_nll_causal_lm",
            "retention_loss": "mean_token_nll_teacher_forced_frozen_s3_historical_32",
            "combine": "L = CE_stream + lambda * CE_anchors",
            "lambda": lambda_value,
            "wrim0_weights": "frozen_no_grad",
            "kl_in_loss": False,
            "kl_logged": True,
        },
        "checkpoint_policy": checkpoint_policy(
            [0, 5, 10, 25, 50],
            [0, 50],
            [5, 10, 25, 50],
            [5, 10, 25, 50],
        ),
        "hypothesis": (
            "Retention breaks primarily because continuation CE has no explicit force preserving WRIM-0 behavior."
        ),
        "primary_question": (
            "Can explicit retention pressure preserve WRIM-0 anchors while continuation CE still improves?"
        ),
        "training_authorized": False,
    }
    recipe["recipe_sha256"] = recipe_hash({k: v for k, v in recipe.items() if k != "recipe_sha256"})
    return recipe


def experiment_b() -> dict[str, Any]:
    if SCHED_WARMUP >= HORIZON_B:
        raise SystemExit("decay experiment invalid: warmup_steps >= total_steps")
    recipe = {
        **base_fields(),
        "experiment_id": EXP_B_ID,
        "priority": 2,
        "principal_variable": "scheduler_total_steps",
        "one_variable_change": "cosine_horizon 1000 -> 50 with warmup 25 frozen; cosine decay occupies steps 26-50; peak_lr stays 1e-5; objective stays CE-only",
        "lambda": 0.0,
        "peak_lr": 1e-5,
        "min_lr": 1e-6,
        "warmup_steps": 25,
        "cosine_decay_steps": 25,
        "scheduler": "warmup_cosine_1_indexed",
        "scheduler_formula": FORMULA_B,
        "scheduler_total_steps": 50,
        "total_steps": 50,
        "max_authorized_optimizer_steps": 50,
        "max_authorized_tokens": 204_800,
        "objective": {
            "stream_loss": "mean_token_nll_causal_lm",
            "retention_loss": None,
            "combine": "L = CE_stream",
            "lambda": 0.0,
            "kl_in_loss": False,
            "kl_logged": True,
        },
        "checkpoint_policy": checkpoint_policy(
            [0, 5, 10, 25, 50],
            [0, 50],
            [5, 10, 25, 50],
            [5, 10, 25, 50],
        ),
        "hypothesis": (
            "The 25-50 retention cliff is amplified because RUN-000005's 1000-step cosine leaves steps 26-50 at peak LR. "
            "A 50-step cosine with the same warmup decays from 1e-5 to 1e-6 across that window."
        ),
        "primary_question": "Does LR decay during steps 26-50 prevent the retention cliff without changing the objective?",
        "expected_diagnostic": (
            "If retention stays inside bands through step 50 while CE still improves, the peak-LR plateau was a major amplifier. "
            "If retention still breaks, objective mismatch is likely dominant."
        ),
        "training_authorized": False,
    }
    recipe["recipe_sha256"] = recipe_hash({k: v for k, v in recipe.items() if k != "recipe_sha256"})
    return recipe


def experiment_c() -> dict[str, Any]:
    recipe = {
        **base_fields(),
        "experiment_id": EXP_C_ID,
        "priority": 3,
        "principal_variable": "peak_lr",
        "one_variable_change": "peak_lr 1e-5 -> 3e-6 and min_lr 1e-6 -> 3e-7 (min remains peak/10); cosine horizon stays 1000",
        "lambda": 0.0,
        "peak_lr": 3e-6,
        "min_lr": 3e-7,
        "warmup_steps": 25,
        "scheduler": "warmup_cosine_1_indexed",
        "scheduler_formula": FORMULA_C,
        "scheduler_total_steps": 1000,
        "total_steps": 1000,
        "max_authorized_optimizer_steps": 50,
        "max_authorized_tokens": 204_800,
        "objective": {
            "stream_loss": "mean_token_nll_causal_lm",
            "retention_loss": None,
            "combine": "L = CE_stream",
            "lambda": 0.0,
            "kl_in_loss": False,
            "kl_logged": True,
        },
        "checkpoint_policy": checkpoint_policy(
            [0, 5, 10, 25, 50],
            [0, 50],
            [5, 10, 25, 50],
            [5, 10, 25, 50],
        ),
        "hypothesis": (
            "Even if the plateau matters, peak 1e-5 may still be too aggressive for continuation from WRIM-0."
        ),
        "primary_question": "Was peak magnitude itself too high, or was the primary problem residence at peak?",
        "training_authorized": False,
    }
    recipe["recipe_sha256"] = recipe_hash({k: v for k, v in recipe.items() if k != "recipe_sha256"})
    return recipe


def one_variable_table(a: dict[str, Any], b: dict[str, Any], c: dict[str, Any]) -> dict[str, Any]:
    return {
        "baseline": {
            "run_id": BASELINE_RUN,
            "recipe_sha256": BASELINE_RECIPE_SHA,
            "objective": "CE_stream_only",
            "peak_lr": 1e-5,
            "min_lr": 1e-6,
            "warmup": 25,
            "cosine_horizon": 1000,
            "max_tokens_observed": 204_800,
        },
        EXP_A_ID: {
            "changed": ["objective", "lambda=0.10"],
            "frozen": FROZEN_VARS + ["peak_lr", "min_lr", "warmup_steps", "scheduler_total_steps_1000", "stream_order"],
            "max_tokens": a["max_authorized_tokens"],
        },
        EXP_B_ID: {
            "changed": ["scheduler_total_steps 1000->50 (cosine decay on steps 26-50)"],
            "frozen": FROZEN_VARS + ["peak_lr", "min_lr", "warmup_steps", "objective_CE_only"],
            "max_tokens": b["max_authorized_tokens"],
            "note": "Warmup 1-25 identical to RUN-000005. Cosine length 25, not 975. Step 50 reaches min 1e-6. Not a stop-at-25 experiment.",
        },
        EXP_C_ID: {
            "changed": ["peak_lr 1e-5->3e-6", "min_lr 1e-6->3e-7"],
            "frozen": FROZEN_VARS + ["warmup_steps", "scheduler_total_steps_1000", "objective_CE_only"],
            "max_tokens": c["max_authorized_tokens"],
            "note": "min_lr remains peak/10, matching the P2 ratio. Not a second scientific variable.",
        },
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--weights", required=True)
    p.add_argument("--tokenizer", required=True)
    p.add_argument("--stream", required=True)
    p.add_argument("--baseline", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--report", required=True)
    args = p.parse_args()
    started = utc_now()

    parent_sha = sha256_file(Path(args.weights))
    tok_sha = sha256_file(Path(args.tokenizer))
    stream_sha = npy_payload_sha(Path(args.stream))
    baseline = json.loads(Path(args.baseline).read_text(encoding="utf-8"))
    suite_hash = str(baseline.get("suite_hash") or "")
    if parent_sha != PARENT_SHA or tok_sha != TOKENIZER_SHA or stream_sha != SOVEREIGN_STREAM_SHA:
        raise SystemExit(f"identity failure parent={parent_sha} tok={tok_sha} stream={stream_sha}")
    if suite_hash != SUITE_HASH:
        raise SystemExit(f"suite hash mismatch {suite_hash}")

    p2_sched = p2_sched_self_test()
    repair_sched = repair_sched_self_test()
    if not p2_sched["ok"] or not repair_sched["ok"]:
        raise SystemExit("schedule self-test failed")
    if abs(lr_p2(25) - 1e-5) > 1e-18:
        raise SystemExit("P2 peak mismatch")

    a = experiment_a(FIRST_LAMBDA)
    a_alts = {f"{lam:.2f}": experiment_a(lam) for lam in LAMBDA_CANDIDATES if abs(lam - FIRST_LAMBDA) > 1e-15}
    b = experiment_b()
    c = experiment_c()
    if int(b["warmup_steps"]) >= int(b["total_steps"]):
        raise SystemExit("warmup_steps >= total_steps is forbidden for the decay experiment")
    if a["recipe_sha256"] != PRESERVED_A_HASH or c["recipe_sha256"] != PRESERVED_C_HASH:
        raise SystemExit("retention/peak recipes unexpectedly changed; hashes must be preserved")
    if a_alts["0.05"]["recipe_sha256"] != PRESERVED_A_L05_HASH or a_alts["0.20"]["recipe_sha256"] != PRESERVED_A_L20_HASH:
        raise SystemExit("lambda-alternate hashes unexpectedly changed")
    if b["recipe_sha256"] == OLD_SCHEDULE_HASH:
        raise SystemExit("revised schedule hash must not equal superseded hash")
    if b["recipe_sha256"] != NEW_SCHEDULE_HASH:
        raise SystemExit(f"revised schedule hash drifted from frozen NEW_SCHEDULE_HASH: {b['recipe_sha256']}")
    sweep = lambda_sweep()
    gates = stop_and_success()
    obs = observability_contract()
    cum = repair_sched["cumulative"]
    lr_table = repair_sched["table"]["schedule_decay_50"]

    payload = {
        "ok": True,
        "kind": KIND,
        "utc": started,
        "ended_utc": utc_now(),
        "baseline_run_id": BASELINE_RUN,
        "baseline_recipe_sha256": BASELINE_RECIPE_SHA,
        "parent_sha256": PARENT_SHA,
        "tokenizer_sha256": TOKENIZER_SHA,
        "stream_sha256": stream_sha,
        "suite_id": SUITE_ID,
        "suite_hash": SUITE_HASH,
        "final_classification": "WRIM_RETENTION_REPAIR_EXPERIMENTS_CORRECTED_AND_FROZEN",
        "TRAINING_AUTHORIZATION": "OFF",
        "training_authorized": False,
        "P3_AUTHORIZED": False,
        "STAGE3B_AUTHORIZATION": "NO",
        "optimizer_steps": 0,
        "optimizer_steps_this_pass": 0,
        "AdamW_constructed": False,
        "tokens_trained": 0,
        "weights_mutated": False,
        "corpus_mutated": False,
        "tokenizer_mutated": False,
        "nothing_pushed": True,
        "nothing_deployed": True,
        "nothing_installed": True,
        "experiments_executed": False,
        "each_run_requires_separate_commander_authorization": True,
        "do_not_automatically_proceed": True,
        "no_capacity_expansion": True,
        "execution_order": [EXP_B_ID, EXP_A_ID, EXP_C_ID],
        "recommended_first_experiment": EXP_B_ID,
        "recommended_first_lambda": FIRST_LAMBDA,
        "schedule_interpretation": {
            "CASE_A": "retention remains healthy through step 50 while continuation CE still improves => schedule plateau was a major causal amplifier",
            "CASE_B": "retention still crosses the same bands despite rapid post-25 decay => objective mismatch is likely dominant; next candidate RB-EXP-B_FROZEN_WRIM0_KL",
            "CASE_C": "retention survives but useful learning disappears => schedule protected anchors but adaptation may be underpowered; DO NOT automatically raise LR",
            "CASE_D": "new unexpected instability => STOP; root-cause model incomplete",
        },
        "retention_objective_semantic_note": (
            "RB-EXP-B_FROZEN_WRIM0_KL tests preservation of WRIM-0 historical behavior. "
            "It is not a final intelligence objective. WRIM-0 has known looping/generation weaknesses. "
            "The retention penalty is a diagnostic constraint against catastrophic behavioral drift. "
            "KL remains an evaluation metric, not the training penalty."
        ),
        "frozen_variables": FROZEN_VARS,
        "one_variable_changes": one_variable_table(a, b, c),
        "lambda_sweep": sweep,
        "stop_gates": gates,
        "observability": obs,
        "revised_schedule": {
            "experiment_id": EXP_B_ID,
            "formula": FORMULA_B,
            "warmup_steps": 25,
            "total_steps": 50,
            "cosine_decay_steps": 25,
            "peak_lr": 1e-5,
            "min_lr": 1e-6,
            "lr_table": lr_table,
            "cumulative_lr": cum["revised_schedule"],
            "comparison_RUN_000005": cum["RUN-000005"],
            "comparison_RUN_000004": cum["RUN-000004"],
            "ratio_26_50_revised_over_000005": cum["ratio_26_50_revised_over_000005"],
            "ratio_1_50_revised_over_000005": cum["ratio_1_50_revised_over_000005"],
            "step_26": lr_schedule_decay_50(26),
            "step_50": lr_schedule_decay_50(50),
        },
        "superseded_unexecuted": {
            EXP_B_ID: {
                "old_recipe_sha256": OLD_SCHEDULE_HASH,
                "status": "SUPERSEDED_UNEXECUTED",
                "reason": "warmup=25 and horizon=25 produced no post-warmup cosine; it tested stop-at-step-25, not decay during 26-50.",
                "not_authorized": True,
                "not_executed": True,
            }
        },
        "schedule_self_test": {"p2": {"ok": p2_sched["ok"]}, "repair": {"ok": repair_sched["ok"], "table": repair_sched["table"], "cumulative": cum}},
        "experiments": {
            EXP_A_ID: a,
            EXP_B_ID: b,
            EXP_C_ID: c,
        },
        "experiment_a_alternate_lambdas_not_authorized": a_alts,
        "recipe_hashes": {
            EXP_A_ID: a["recipe_sha256"],
            f"{EXP_A_ID}__lambda_0.05": a_alts["0.05"]["recipe_sha256"],
            f"{EXP_A_ID}__lambda_0.20": a_alts["0.20"]["recipe_sha256"],
            EXP_B_ID: b["recipe_sha256"],
            f"{EXP_B_ID}__SUPERSEDED_UNEXECUTED": OLD_SCHEDULE_HASH,
            EXP_C_ID: c["recipe_sha256"],
        },
        "recipe_hash_status": {
            EXP_A_ID: "PRESERVED",
            EXP_B_ID: "REGENERATED",
            EXP_C_ID: "PRESERVED",
        },
    }
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    existing_b_path = out_dir / "recipe-B.json"
    superseded_path = out_dir / "recipe-B-SUPERSEDED_UNEXECUTED.json"
    if existing_b_path.exists():
        old_b = json.loads(existing_b_path.read_text(encoding="utf-8"))
        old_hash = str(old_b.get("recipe_sha256") or "")
        if old_hash == OLD_SCHEDULE_HASH or not superseded_path.exists():
            write_json(
                superseded_path,
                {
                    "status": "SUPERSEDED_UNEXECUTED",
                    "old_recipe_sha256": OLD_SCHEDULE_HASH,
                    "observed_recipe_sha256": old_hash,
                    "not_authorized": True,
                    "not_executed": True,
                    "reason": (
                        "warmup=25 and horizon=25 produced no post-warmup cosine; "
                        "it tested stop-at-step-25, not decay during 26-50."
                    ),
                    "recipe": old_b if old_hash == OLD_SCHEDULE_HASH else None,
                    "note": (
                        "Historical recipe evidence retained. This hash must not be used as the "
                        "canonical identifier of the revised 50-step schedule experiment."
                    ),
                },
            )
    elif not superseded_path.exists():
        write_json(
            superseded_path,
            {
                "status": "SUPERSEDED_UNEXECUTED",
                "old_recipe_sha256": OLD_SCHEDULE_HASH,
                "not_authorized": True,
                "not_executed": True,
                "reason": "Previous 25-step stop-at-peak schedule recipe, never executed.",
                "recipe": None,
            },
        )
    write_json(Path(args.report), payload)
    write_json(out_dir / "retention-repair-experiments.json", payload)
    write_json(out_dir / "recipe-A.json", a)
    write_json(out_dir / "recipe-B.json", b)
    write_json(out_dir / "recipe-C.json", c)
    write_json(out_dir / "recipe-hashes.json", payload["recipe_hashes"])
    print(json.dumps({"ok": True, "classification": payload["final_classification"], "hashes": payload["recipe_hashes"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
