"""WRIM1-P2-NEXT-A-SCHEDULE-HORIZON-RECIPE freeze.

Design only. Does not construct an optimizer. Does not train.
Does not mutate WR-CORPUS, tokenizer, parent weights, or streams.
Does not create checkpoints. Isolates cosine horizon 1000 -> 50.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from foundational_p1_refine import npy_payload_sha, sha256_file, write_json
from p2_next_a_schedule import FORMULA, MIN_LR, PEAK_LR, TOTAL_STEPS, WARMUP_STEPS, lr_next_a, self_test
from p2_recipe import ledger_has_excluded, probe_precision, vram_estimate
from p2_schedule import lr_p2
from stage3a_corrective_schedule import lr_corrective
from stop_policy import STOP_POLICY_VERSION

EXPERIMENT_ID = "P2-NEXT-A_SCHEDULE_HORIZON"
RECIPE_ID = "WRIM1-P2-NEXT-A-SCHEDULE-HORIZON-RECIPE"
KIND = "WRIM_P2_NEXT_A_SCHEDULE_HORIZON_RECIPE"
BASELINE_RUN = "WRIM1-RUN-000005"
BASELINE_RECIPE_SHA = "5b6237dcad4321111510453c9bfcb6713a8f61a8218c487afd67952a42d18117"
PARENT_ID = "WRIM-0"
PARENT_SHA = "d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015"
TOKENIZER_ID = "WR-TOKENIZER-0"
TOKENIZER_SHA = "47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7"
SOVEREIGN_SEED = 2303
SOVEREIGN_STREAM_SHA = "5bf8951e364ed9a7f02889d4d96e44c7a9d3a2e6a78464c8fe4b43c9bbe22db5"
SOVEREIGN_PACKED_SOURCE_SHA = "83e9478376386fd2e1d02a26891fab0ec6714063445e5915bbb06376a7ca5011"
FORBIDDEN_P1_STREAM = "166139473acf7edc5d12210cfa3b456b3bcbc2b56efb0674671da7e8a09796ed"
FORBIDDEN_2302_STREAM = "a783785a579f6983f25d4157ab801d6d7b6f331edf4b2aedc4c9127070734ba0"
PACKER_MODE = "DEFICIT_INTERLEAVE_FAMILIES"
PACKER_VERSION = "deficit-interleave-families-v1"
SEQ_LEN = 512
MICRO_BATCH = 8
GRAD_ACCUM = 1
TOKENS_PER_STEP = SEQ_LEN * MICRO_BATCH * GRAD_ACCUM
PARAM_COUNT = 19_217_152
BETAS = [0.9, 0.95]
EPS = 1e-8
WEIGHT_DECAY = 0.1
GRAD_CLIP = 1.0
PRECISION = "FP32"
TF32 = False
RUNTIME_SEED = 5005
EVAL_SEED = 42
EXCLUDED_DOCS = [
    "CLAUDE.md",
    "docs/ENGINEERING_COMPLETION_STANDARD.md",
    "docs/WAVE_3_ACTIVE_LEARNING_REPORT.md",
]
COMPACT_CADENCE = [0, 5, 10, 25, 50]
FULL_CADENCE = [0, 50]
WEIGHT_SAVE_STEPS = [5, 10, 25, 50]
OPTIMIZER_SAVE_STEPS = [5, 10, 25, 50]
PARENT_VAL0 = 8.890125
PARENT_LOOPING = 14
PARENT_COLLAPSE = 2
PARENT_UNIQUE128 = 0.26655294117647055
PARENT_UNIQUE256 = 0.1709
RUN000005_STEP25_DNLL = 0.0644819872719901
RUN000005_STEP25_KL = 0.0038027051570160048
RUN000005_STEP25_U256 = 0.185525
RUN000005_STEP50_DNLL = 0.18126074245997836
RUN000005_STEP50_KL = 0.024697155359068086
RUN000005_STEP50_U256 = 0.13672499999999999
RUN000005_STEP50_LOOPING = 18


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def recipe_hash(recipe: dict[str, Any]) -> str:
    blob = json.dumps(recipe, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def sum_lr(fn, start: int, end: int) -> float:
    return float(sum(fn(s) for s in range(start, end + 1)))


def canonical_recipe() -> dict[str, Any]:
    return {
        "recipe_id": RECIPE_ID,
        "experiment_id": EXPERIMENT_ID,
        "kind": KIND,
        "baseline_run_id": BASELINE_RUN,
        "baseline_recipe_sha256": BASELINE_RECIPE_SHA,
        "principal_variable": "scheduler_total_steps",
        "one_variable_change": "cosine_horizon 1000 -> 50; peak_lr stays 1e-5; warmup stays 25; objective stays ordinary CE",
        "forbidden_mixins": [
            "KL_anchor_term",
            "lower_peak_lr",
            "different_stream",
            "data_shuffle",
            "new_behavior_records",
            "changed_clipping",
            "changed_optimizer",
            "architecture_changes",
        ],
        "parent": PARENT_ID,
        "parent_sha256": PARENT_SHA,
        "tokenizer": TOKENIZER_ID,
        "tokenizer_sha256": TOKENIZER_SHA,
        "stream_sha": SOVEREIGN_STREAM_SHA,
        "packed_source_sha256": SOVEREIGN_PACKED_SOURCE_SHA,
        "seed": SOVEREIGN_SEED,
        "packer": PACKER_MODE,
        "packer_version": PACKER_VERSION,
        "stream_order": "UNCHANGED_SOVEREIGN_P2_PREFIX",
        "shuffle": False,
        "repack": False,
        "optimizer": "AdamW",
        "optimizer_fused": False,
        "optimizer_fresh": True,
        "peak_lr": PEAK_LR,
        "min_lr": MIN_LR,
        "betas": BETAS,
        "beta1": BETAS[0],
        "beta2": BETAS[1],
        "eps": EPS,
        "weight_decay": WEIGHT_DECAY,
        "grad_clip": GRAD_CLIP,
        "grad_clip_type": "global_l2_norm",
        "grad_clip_when": "after_backward_before_optimizer_step",
        "grad_scaler": False,
        "unscale_not_applicable": True,
        "scheduler": "warmup_cosine_1_indexed",
        "scheduler_formula": FORMULA,
        "warmup_steps": WARMUP_STEPS,
        "warmup_fraction": WARMUP_STEPS / TOTAL_STEPS,
        "total_steps": TOTAL_STEPS,
        "scheduler_total_steps": TOTAL_STEPS,
        "cosine_denominator": TOTAL_STEPS - WARMUP_STEPS,
        "max_authorized_optimizer_steps": TOTAL_STEPS,
        "no_step_51": True,
        "next_unauthorized_step": 51,
        "precision": PRECISION,
        "tf32": TF32,
        "sequence_length": SEQ_LEN,
        "micro_batch": MICRO_BATCH,
        "grad_accum": GRAD_ACCUM,
        "effective_batch_sequences": MICRO_BATCH * GRAD_ACCUM,
        "effective_tokens_per_step": TOKENS_PER_STEP,
        "max_authorized_tokens": TOTAL_STEPS * TOKENS_PER_STEP,
        "architecture": "WRIM-G-20M-v1-option-A",
        "parameter_count": PARAM_COUNT,
        "capacity_lock": True,
        "objective": {
            "stream_loss": "mean_token_nll_causal_lm",
            "combine": "L = CE_stream",
            "retention_loss": None,
            "lambda": 0.0,
            "kl_in_loss": False,
            "kl_logged": True,
            "ordinary_continuation_ce": True,
        },
        "checkpoint_policy": {
            "step0": "parent_pointer_only",
            "metrics_every_optimizer_step": True,
            "compact_eval_steps": COMPACT_CADENCE,
            "full_eval_steps": FULL_CADENCE,
            "save_weights_steps": WEIGHT_SAVE_STEPS,
            "save_optimizer_steps": OPTIMIZER_SAVE_STEPS,
            "always_save_weights_on_stop_policy_halt": True,
            "always_save_optimizer_on_stop_policy_halt": True,
            "never_lose_terminal_state": True,
            "optimizer_saved_because_run_000005_left_moments_unknown": True,
        },
        "resume_policy": "RESTART_REQUIRED_NOT_RESUMABLE",
        "oom_policy": "HARD_ABORT",
        "oom_no_dynamic_recipe_change": True,
        "rng_policy": {
            "python_seed": RUNTIME_SEED,
            "numpy_seed": RUNTIME_SEED,
            "torch_cpu_seed": RUNTIME_SEED,
            "torch_cuda_seed": RUNTIME_SEED,
            "eval_seed": EVAL_SEED,
            "packing_seed": SOVEREIGN_SEED,
            "dataloader_seed": None,
            "dataloader": "none_pre_sliced_numpy_stream",
            "cudnn_deterministic": True,
            "cudnn_benchmark": False,
            "reproducibility_class": "STATISTICALLY_REPRODUCIBLE",
            "bitwise_reproducible": False,
        },
        "stop_policy_version": STOP_POLICY_VERSION,
        "stop_policy_unchanged": True,
        "stop_policy_enforcement": (
            "After each compact/full eval, call wrim-stop-policy-v1 decide(). "
            "If next_optimizer_step_allowed is false, halt before the next optimizer.step. "
            "HARD_ABORT stops immediately. Improved validation CE does not authorize continuation."
        ),
        "eval_decoder": "GREEDY",
        "training_authorized": False,
        "TRAINING_AUTHORIZATION": "OFF",
        "P3_AUTHORIZED": False,
        "STAGE3B_AUTHORIZATION": "NO",
        "hardware_assumptions": {
            "device": "NVIDIA GeForce RTX 5060 Ti",
            "precision": PRECISION,
            "tf32": TF32,
            "historical_p2_peak_gib": 3.40,
            "do_not_raise_microbatch": True,
        },
    }


def stop_gates() -> dict[str, Any]:
    return {
        "stop_policy_version": STOP_POLICY_VERSION,
        "stop_policy_unchanged": True,
        "no_weaker_retention_gates": True,
        "continuation_ce_cannot_override_retention_failure": True,
        "hard_abort_canonical": {
            "dnll_gt": 0.105,
            "kl_gt": 0.018,
            "val0_gt": PARENT_VAL0,
            "cap_le": 3,
            "special_rate_gt": 0.08,
        },
        "generation_degrade_canonical_vs_WRIM0": {
            "looping_degraded_if_ge": PARENT_LOOPING + 2,
            "collapse_degraded_if_ge": PARENT_COLLAPSE + 2,
            "unique128_degraded_if_lt": PARENT_UNIQUE128 - 0.05,
            "unique256_degraded_if_lt": PARENT_UNIQUE256 - 0.05,
            "soft_stop_min_hits": 2,
            "review_required_hits": 1,
        },
        "parent_reference": {
            "looping": PARENT_LOOPING,
            "collapse": PARENT_COLLAPSE,
            "unique128": PARENT_UNIQUE128,
            "unique256": PARENT_UNIQUE256,
            "val0": PARENT_VAL0,
        },
        "run_000005_reference": {
            "step25_mean_dnll": RUN000005_STEP25_DNLL,
            "step25_mean_kl": RUN000005_STEP25_KL,
            "step25_unique256": RUN000005_STEP25_U256,
            "step50_mean_dnll": RUN000005_STEP50_DNLL,
            "step50_mean_kl": RUN000005_STEP50_KL,
            "step50_unique256": RUN000005_STEP50_U256,
            "step50_looping": RUN000005_STEP50_LOOPING,
        },
    }


def success_criteria() -> dict[str, Any]:
    return {
        "step_25_legal_band": {
            "must_not_hard_abort": True,
            "mean_dnll_le": 0.105,
            "mean_kl_le": 0.018,
            "val0_le": PARENT_VAL0,
            "note": "Same wrim-stop-policy-v1 hard band as RUN-000005 step 25, which was 0.064 / 0.0038.",
        },
        "step_50_schedule_success_requires_all": {
            "1_mean_dnll_materially_below_run000005": {
                "mean_dnll_lt": RUN000005_STEP50_DNLL,
                "and_inside_hard_gate": 0.105,
            },
            "2_no_hard_retention_gate_breached": {
                "mean_dnll_le": 0.105,
                "mean_kl_le": 0.018,
                "val0_le": PARENT_VAL0,
                "cap_gt": 3,
                "special_rate_le": 0.08,
            },
            "3_kl_materially_below_run000005": {
                "mean_kl_lt": RUN000005_STEP50_KL,
                "and_inside_hard_gate": 0.018,
            },
            "4_unique256_must_not_collapse_to_run000005": {
                "unique256_gt": RUN000005_STEP50_U256,
                "and_not_degraded_vs_WRIM0": PARENT_UNIQUE256 - 0.05,
            },
            "5_looping_must_not_worsen_beyond_run000005": {
                "looping_lt": RUN000005_STEP50_LOOPING,
                "and_not_degraded_vs_WRIM0": PARENT_LOOPING + 2,
            },
            "6_validation_ce_alone_is_not_pass": True,
            "7_generation_no_new_degeneration_vs_WRIM0_or_this_run_step25": {
                "vs_WRIM0": "no generation-axis DEGRADED under wrim-stop-policy-v1",
                "vs_this_run_step25": "looping/collapse/unique128/unique256 must not be worse than this run's own step-25 snapshot",
                "greedy_samples": "no new loop/collapse/template lock-in relative to WRIM-0 and this-run step 25",
            },
        },
        "pass_requires_legal_band_and_material_schedule_success": True,
        "fail_if_hard_abort": True,
        "fail_if_only_val0_improves": True,
    }


def observability() -> dict[str, Any]:
    return {
        "bus": "scripts/wrim-environment/observability_bus.py",
        "direct_tensorboard_mlflow_aim_prometheus_from_trainer": False,
        "emit_wrim_observability_events_only": True,
        "post_clip_measurement": (
            "After clip_grad_norm_, recompute global L2 of .grad tensors. "
            "Do not store the clip_grad_norm_ return as post-clip. That return is pre-clip. "
            "Do not infer post-clip as min(preclip, 1.0)."
        ),
        "per_optimizer_step_required": [
            "pre_clip_gradient_norm",
            "post_clip_gradient_norm",
            "clip_coefficient",
            "clipping_ratio",
            "was_clipped",
            "parameter_norm",
            "update_norm",
            "update_weight_ratio",
            "lr",
            "cumulative_lr_exposure",
            "train_ce",
            "ce_stream_loss",
            "tokens_seen",
            "optimizer_step",
            "stream_position",
            "rng_state_digest",
            "eval_seed",
        ],
        "per_compact_eval_required": [
            "validation_ce_val0",
            "validation_ce_val1",
            "mean_dnll",
            "mean_kl",
            "per_item_dnll",
            "per_family_retention_nll",
            "per_family_retention_kl",
            "unique128",
            "unique256",
            "looping",
            "generation_degeneration",
            "layer_family_displacement",
            "stop_policy_decision",
        ],
        "adapters_must_not_be_imported_by_trainer": ["tensorboard", "mlflow", "aim", "prometheus"],
    }


def interpretation_matrix() -> dict[str, Any]:
    return {
        "CASE_A": {
            "if": "Retention stays substantially healthier through step 50 AND continuation CE still improves",
            "interpretation": "schedule exposure was a major causal component",
            "next_experiment_candidate": "P2-NEXT-B_OBJECTIVE_KL_ANCHOR",
            "do_not_auto_launch": True,
        },
        "CASE_B": {
            "if": "Retention still breaks near the same token count despite rapid decay",
            "interpretation": "objective mismatch dominates schedule",
            "next_experiment_candidate": "P2-NEXT-B_OBJECTIVE_KL_ANCHOR",
            "do_not_auto_launch": True,
        },
        "CASE_C": {
            "if": "Retention improves but learning/generation movement disappears",
            "interpretation": "schedule protected anchors but may have underpowered adaptation",
            "next": "Analyze first. Do not immediately increase LR.",
            "do_not_auto_launch": True,
        },
        "CASE_D": {
            "if": "Run fails earlier or destabilizes unexpectedly",
            "interpretation": "root-cause model incomplete",
            "next": "STOP. Do not automatically launch another experiment.",
            "do_not_auto_launch": True,
        },
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--weights", required=True)
    p.add_argument("--tokenizer", required=True)
    p.add_argument("--stream", required=True)
    p.add_argument("--ledger", required=True)
    p.add_argument("--sovereignty-report", required=True)
    p.add_argument("--claude-md", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--report", required=True)
    args = p.parse_args()
    started = utc_now()

    parent_sha = sha256_file(Path(args.weights))
    tok_sha = sha256_file(Path(args.tokenizer))
    stream_sha = npy_payload_sha(Path(args.stream))
    sovereignty = json.loads(Path(args.sovereignty_report).read_text(encoding="utf-8"))
    packed_source_sha = str((sovereignty.get("new_stream") or {}).get("packed_source_sha256") or "")
    seed = int((sovereignty.get("new_stream") or {}).get("seed") or 0)
    ledger = json.loads(Path(args.ledger).read_text(encoding="utf-8"))
    excluded_hits = ledger_has_excluded(ledger)
    sched = self_test()
    if not sched["ok"]:
        raise SystemExit(f"P2-NEXT-A schedule self-test failed: {sched['failed']}")
    if TOKENS_PER_STEP != 4096 or SEQ_LEN * MICRO_BATCH * GRAD_ACCUM != 4096:
        raise SystemExit("tokens/step arithmetic failed")
    identity_ok = (
        parent_sha == PARENT_SHA
        and tok_sha == TOKENIZER_SHA
        and stream_sha == SOVEREIGN_STREAM_SHA
        and packed_source_sha == SOVEREIGN_PACKED_SOURCE_SHA
        and seed == SOVEREIGN_SEED
        and stream_sha not in {FORBIDDEN_P1_STREAM, FORBIDDEN_2302_STREAM}
        and not excluded_hits
    )
    if not identity_ok:
        raise SystemExit(
            f"identity failure parent={parent_sha} tok={tok_sha} stream={stream_sha} packed={packed_source_sha} seed={seed} excluded={excluded_hits}"
        )

    recipe = canonical_recipe()
    rhash = recipe_hash(recipe)
    lr_table = {str(s): lr_next_a(s) for s in (1, 5, 10, 25, 26, 30, 35, 40, 45, 50)}
    cum = {
        "next_a_1_25": sum_lr(lr_next_a, 1, 25),
        "next_a_26_50": sum_lr(lr_next_a, 26, 50),
        "next_a_1_50": sum_lr(lr_next_a, 1, 50),
        "run_000005_1_25": sum_lr(lr_p2, 1, 25),
        "run_000005_26_50": sum_lr(lr_p2, 26, 50),
        "run_000005_1_50": sum_lr(lr_p2, 1, 50),
        "run_000004_1_25": sum_lr(lr_corrective, 1, 25),
    }
    payload = {
        "ok": True,
        "kind": KIND,
        "recipe_id": RECIPE_ID,
        "experiment_id": EXPERIMENT_ID,
        "final_classification": "P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN",
        "optimizer_steps": 0,
        "optimizer_steps_this_pass": 0,
        "tokens_trained": 0,
        "AdamW_constructed": False,
        "weights_unchanged": True,
        "corpus_unchanged": True,
        "tokenizer_unchanged": True,
        "stream_unchanged": True,
        "TRAINING_AUTHORIZATION": "OFF",
        "training_authorized": False,
        "P3_AUTHORIZED": False,
        "STAGE3B_AUTHORIZATION": "NO",
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "recipe_executed": False,
        "start_timestamp": started,
        "end_timestamp": utc_now(),
        "parent_sha256": parent_sha,
        "tokenizer_sha256": tok_sha,
        "stream_sha256": stream_sha,
        "packed_source_sha256": packed_source_sha,
        "seed": seed,
        "identity_ok": identity_ok,
        "sovereignty_exclusions_unchanged": excluded_hits == [],
        "claude_md_on_disk_untouched": Path(args.claude_md).exists(),
        "schedule_self_test": {"ok": sched["ok"], "passed": sched["passed"], "table": sched["table"], "formula": sched["formula"]},
        "lr_table": lr_table,
        "cumulative_lr": cum,
        "cumulative_comparison": sched["cumulative"],
        "precision_probe": probe_precision(),
        "vram_estimate": vram_estimate(),
        "recipe": recipe,
        "recipe_sha256": rhash,
        "stop_gates": stop_gates(),
        "success_criteria": success_criteria(),
        "observability": observability(),
        "interpretation_matrix": interpretation_matrix(),
        "stop_policy_version": STOP_POLICY_VERSION,
        "stop_policy_unchanged": True,
        "corpus_mutated": False,
        "tokenizer_mutated": False,
        "stream_mutated": False,
        "nothing_pushed": True,
        "nothing_deployed": True,
        "nothing_installed": True,
        "local_commit_created": False,
    }
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    write_json(out_dir / "recipe.json", recipe)
    write_json(out_dir / "recipe-hash.json", {"recipe_id": RECIPE_ID, "recipe_sha256": rhash, "experiment_id": EXPERIMENT_ID})
    write_json(Path(args.report), payload)
    print(
        json.dumps(
            {
                "ok": True,
                "final_classification": payload["final_classification"],
                "experiment_id": EXPERIMENT_ID,
                "recipe_sha256": rhash,
                "optimizer_steps_this_pass": 0,
                "TRAINING_AUTHORIZATION": "OFF",
                "lr_table": lr_table,
                "cumulative_lr": {k: cum[k] for k in ("next_a_1_25", "next_a_26_50", "next_a_1_50")},
            },
            indent=2,
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
