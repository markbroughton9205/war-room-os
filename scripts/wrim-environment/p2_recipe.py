"""WRIM1-RUN-000005 P2 training-recipe freeze.

Design only. Does not construct an optimizer. Does not train.
Does not mutate WR-CORPUS, tokenizer, parent weights, or streams.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from foundational_p1_refine import npy_payload_sha, sha256_file, write_json
from p2_schedule import FORMULA, MIN_LR, PEAK_LR, TOTAL_STEPS, WARMUP_STEPS, lr_p2, self_test
from stop_policy import STOP_POLICY_VERSION

RECIPE_ID = "WRIM1-RUN-000005-P2-RECIPE"
KIND = "WRIM_FOUNDATIONAL_P2_RECIPE"
RUN_ID = "WRIM1-RUN-000005"
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
COMPACT_CADENCE = [0, 5, 10, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
FULL_CADENCE = [0, 100, 500, 1000]
WEIGHT_SAVE_STEPS = [5, 10, 25, 50, 100, 500, 1000]
OPTIMIZER_SAVE_STEPS = [100, 500, 1000]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def probe_precision() -> dict[str, Any]:
    info: dict[str, Any] = {
        "chosen_precision": PRECISION,
        "chosen_tf32": TF32,
        "rationale": (
            "Every recorded Nebula WRIM training run used FP32 with TF32 off. "
            "Stage 0 measured BF16/FP16/TF32 as SUPPORTED on this GPU but ENABLE_BF16_FOR_SPEED "
            "is denied. P2 eval NLL/KL must remain comparable to WRIM-0 / STAGE3A / RUN-000004."
        ),
    }
    try:
        import torch

        info["pytorch"] = torch.__version__
        info["cuda_compiled"] = str(getattr(torch.version, "cuda", None))
        info["cuda_available"] = bool(torch.cuda.is_available())
        if torch.cuda.is_available():
            major, minor = torch.cuda.get_device_capability(0)
            info["gpu"] = torch.cuda.get_device_name(0)
            info["cuda_capability"] = [int(major), int(minor)]
            info["vram_bytes"] = int(torch.cuda.get_device_properties(0).total_memory)
            info["fp16_capability_ge_5"] = int(major) >= 5
            if hasattr(torch.cuda, "is_bf16_supported"):
                info["bf16_is_bf16_supported"] = bool(torch.cuda.is_bf16_supported())
            else:
                info["bf16_is_bf16_supported"] = None
            tf32_flag = getattr(getattr(torch.backends.cuda, "matmul", None), "allow_tf32", None)
            info["tf32_matmul_flag_exists"] = tf32_flag is not None
            info["tf32_matmul_default"] = bool(tf32_flag) if tf32_flag is not None else None
        else:
            info["gpu"] = None
    except Exception as exc:
        info["probe_error"] = str(exc)
    return info


def vram_estimate() -> dict[str, Any]:
    bytes_param = PARAM_COUNT * 4
    grads = bytes_param
    adam = bytes_param * 2
    # Historical Metal occupancy ~3.3GB for batch 8 / ctx 512 including activations.
    activations_est = int(3.3 * 1024**3) - bytes_param - grads - adam
    activations_est = max(activations_est, 0)
    total_est = bytes_param + grads + adam + activations_est
    return {
        "parameter_count": PARAM_COUNT,
        "weights_fp32_bytes": bytes_param,
        "grads_fp32_bytes": grads,
        "adamw_moments_fp32_bytes": adam,
        "activations_historical_metal_remainder_bytes": activations_est,
        "total_est_bytes": total_est,
        "total_est_gib": round(total_est / (1024**3), 3),
        "historical_metal_fit_gib": 3.3,
        "available_vram_bytes_recorded": 17_074_421_760,
        "headroom_policy": "Do not maximize VRAM. Do not raise microbatch. Leave allocator/eval/checkpoint margin.",
        "fits_with_margin": True,
        "note": "Activation bytes are estimated from historical Metal occupancy, not a new CUDA profile. No training probe.",
    }


def ledger_has_excluded(ledger: dict[str, Any]) -> list[str]:
    hits: list[str] = []
    for doc in ledger.get("documents") or []:
        path = str(doc.get("source_path") or doc.get("document_id") or "")
        for banned in EXCLUDED_DOCS:
            if path == banned or path.endswith("/" + banned) or path.endswith("\\" + banned):
                hits.append(path)
    return hits


def historical_audit(paths: dict[str, Path]) -> dict[str, Any]:
    s1 = load_json(paths["stage1"])
    s2 = load_json(paths["stage2"])
    p2grid = load_json(paths["phase2"])
    s3a = load_json(paths["stage3a"])
    cor = load_json(paths["corrective"])
    cells = ((p2grid or {}).get("analysis") or {}).get("cells") or {}
    nat_high = cells.get("NATURAL_BASELINE__3e-5") or {}
    nat_low = cells.get("NATURAL_BASELINE__2e-5") or {}
    factor = ((p2grid or {}).get("analysis") or {}).get("factor_effects") or {}
    return {
        "WRIM-0_mac_genesis": {
            "source": "lib/wrim-reconciliation/reconcile.ts + budget.ts",
            "peak_lr": 0.003,
            "warmup": 50,
            "optimizer": "AdamW",
            "betas": "UNKNOWN",
            "eps": "UNKNOWN",
            "weight_decay": "UNKNOWN",
            "grad_clip": "UNKNOWN",
            "precision": "MLX_MAC_NOT_PYTORCH",
            "microbatch": 8,
            "grad_accumulation": 1,
            "tokens_per_optimizer_step": 4096,
            "scheduler": "warmup 50, cosine to 10% floor",
            "total_steps": 500,
            "retention": "UNKNOWN_ON_NEBULA_METRICS",
            "kl": "UNKNOWN",
            "looping": "UNKNOWN",
            "unique128": "UNKNOWN",
            "unique256": "UNKNOWN",
            "collapse": "later_recovery_showed_3e-4_collapses; 3e-3_is_not_reusable",
            "stop_reason": "completed_historical_genesis",
        },
        "recovery_001_to_005": {
            "peak_lr": 3e-4,
            "result": "collapsed / not reusable as P2 peak",
            "unique128": "UNKNOWN",
        },
        "recovery_006_plus": {
            "peak_lr": 3e-5,
            "result": "first_stable_short_horizon_recipe_on_Mac_recovery",
            "looping": "UNKNOWN",
            "unique128": "UNKNOWN",
        },
        "Stage1_WRIM1-NEBULA-DIAG-000001": {
            "peak_lr": 3e-5,
            "warmup": 25,
            "optimizer": "AdamW",
            "betas": [0.9, 0.95],
            "eps": 1e-8,
            "weight_decay": 0.1,
            "grad_clip": 1.0,
            "precision": "FP32",
            "tf32": False,
            "microbatch": 8,
            "grad_accumulation": 1,
            "tokens_per_optimizer_step": 4096,
            "scheduler": "linear warmup 0->3e-5 over 25; run stayed in warmup",
            "total_steps": 10,
            "retention": (s1 or {}).get("stop_reason") or "completed_10_steps",
            "kl": "UNKNOWN",
            "looping": "UNKNOWN",
            "unique128": "UNKNOWN",
            "unique256": "UNKNOWN",
            "collapse": "UNKNOWN",
            "stop_reason": "exactly_10_then_STOP",
            "on_disk_optimizer_steps": (s1 or {}).get("n_steps") or (s1 or {}).get("optimizer_steps"),
        },
        "Stage2_WRIM1-NEBULA-STAB-000001": {
            "peak_lr": 3e-5,
            "min_lr": 3e-6,
            "warmup": 25,
            "optimizer": "AdamW",
            "betas": [0.9, 0.95],
            "eps": 1e-8,
            "weight_decay": 0.1,
            "grad_clip": 1.0,
            "precision": (s2 or {}).get("precision"),
            "tf32": (s2 or {}).get("tf32_enabled"),
            "microbatch": (s2 or {}).get("batch"),
            "grad_accumulation": (s2 or {}).get("accumulation"),
            "tokens_per_optimizer_step": 4096,
            "scheduler": "warmup 25 then cosine over remaining 25; peak 3e-5 min 3e-6",
            "total_steps_authorized": 50,
            "actual_steps": (s2 or {}).get("n_steps"),
            "retention": "binary_retention dropped vs step-0",
            "kl": "UNKNOWN_AS_NAMED_FIELD",
            "looping": "UNKNOWN",
            "unique128": "UNKNOWN",
            "unique256": "UNKNOWN",
            "collapse": "UNKNOWN",
            "stop_reason": (s2 or {}).get("stop_reason"),
        },
        "Stage2_retry_STAB-000002": {
            "peak_lr": 2e-5,
            "min_lr": 2e-6,
            "warmup": 25,
            "optimizer": "AdamW",
            "betas": [0.9, 0.95],
            "eps": 1e-8,
            "weight_decay": 0.1,
            "grad_clip": 1.0,
            "precision": "FP32",
            "microbatch": 8,
            "grad_accumulation": 1,
            "tokens_per_optimizer_step": 4096,
            "scheduler": "warmup 25 then cosine; peak 2e-5 min 2e-6",
            "total_steps": 50,
            "looping": "UNKNOWN",
            "unique128": "UNKNOWN",
            "unique256": "UNKNOWN",
            "note": "config recorded in stage2_retry.py; not used as P2 parent",
        },
        "Stage2_grid_WRIM1-NEBULA-STABILITY-GRID-000001": {
            "n_healthy": ((p2grid or {}).get("analysis") or {}).get("n_healthy"),
            "n_aborted": ((p2grid or {}).get("analysis") or {}).get("n_aborted"),
            "classification": (p2grid or {}).get("classification"),
            "peak_lrs": [3e-5, 2e-5],
            "warmup": 25,
            "optimizer": "AdamW",
            "betas": [0.9, 0.95],
            "eps": 1e-8,
            "weight_decay": 0.1,
            "grad_clip": 1.0,
            "precision": "FP32",
            "tf32": False,
            "microbatch": 8,
            "grad_accumulation": 1,
            "tokens_per_optimizer_step": 4096,
            "scheduler": "warmup 25 then cosine; min_lr=peak/10; 50 steps",
            "NATURAL_BASELINE_3e-5_mean_anchor_dnll": (nat_high.get("final_mean_anchor_nll_delta") or {}).get("mean"),
            "NATURAL_BASELINE_3e-5_mean_kl": (nat_high.get("final_mean_kl") or {}).get("mean"),
            "NATURAL_BASELINE_3e-5_clip_rate": (nat_high.get("clip_rate") or {}).get("mean"),
            "NATURAL_BASELINE_2e-5_mean_anchor_dnll": (nat_low.get("final_mean_anchor_nll_delta") or {}).get("mean"),
            "NATURAL_BASELINE_2e-5_mean_kl": (nat_low.get("final_mean_kl") or {}).get("mean"),
            "NATURAL_BASELINE_2e-5_clip_rate": (nat_low.get("clip_rate") or {}).get("mean"),
            "peak_lr_effect_LOW_minus_HIGH_anchor_dnll": factor.get("peak_lr_effect_LOW_minus_HIGH"),
            "lr_matters_declared": factor.get("lr_matters"),
            "looping": "UNKNOWN",
            "unique128": "UNKNOWN",
            "unique256": "UNKNOWN",
            "collapse": "0_aborts_in_40_runs",
            "stop_reason": "grid_completed_50_steps_each",
        },
        "RUN-000003_STAGE3A": {
            "peak_lr": 2e-5,
            "min_lr": 2e-6,
            "warmup": 25,
            "optimizer": "AdamW",
            "betas": [0.9, 0.95],
            "eps": 1e-8,
            "weight_decay": 0.1,
            "grad_clip": 1.0,
            "precision": (s3a or {}).get("precision") or "FP32",
            "tf32": "OFF",
            "microbatch": 8,
            "grad_accumulation": 1,
            "tokens_per_optimizer_step": 4096,
            "scheduler": "1-indexed warmup-cosine over 50 steps",
            "total_steps": 50,
            "retention": "anchor_dnll 0.2139 >= 0.105; historical_binary 6/6 -> 5/6",
            "kl": 0.03715927643435342,
            "val0": 8.48145604133606,
            "looping": "UNKNOWN_DEDICATED_COUNT",
            "unique128": "UNKNOWN",
            "unique256": "UNKNOWN",
            "collapse": "n_collapsed parent 1 -> step50 2 (suite compact)",
            "stop_reason": "completed_50; later_review_retention_broke_hard_bands",
        },
        "RUN-000004_STAGE3A_corrective": {
            "peak_lr": 1e-5,
            "min_lr": 1e-6,
            "warmup": 8,
            "optimizer": "AdamW",
            "betas": [0.9, 0.95],
            "eps": 1e-8,
            "weight_decay": 0.1,
            "grad_clip": 1.0,
            "precision": "FP32_TF32_OFF",
            "microbatch": 8,
            "grad_accumulation": 1,
            "tokens_per_optimizer_step": 4096,
            "scheduler": "1-indexed warmup-8 cosine-to-1e-6 over 25 steps",
            "total_steps": 25,
            "tokens_trained": (cor or {}).get("tokens_trained"),
            "retention": "terminal dnll 0.0622 < 0.105; kl 0.00447 < 0.018",
            "kl": 0.004468380982455398,
            "looping": "14 -> 13 -> 12 then 13 -> 17 -> 17 (worsened after ~step 15)",
            "unique128": "0.267 -> 0.255 -> 0.269 then 0.242 -> 0.234 -> 0.234",
            "unique256": "0.171 -> 0.159 -> 0.188 then 0.134 -> 0.153 -> 0.147",
            "collapse": "2 -> 2 -> 3 -> 3 -> 3 -> 3",
            "stop_reason": (cor or {}).get("final_classification") or "CORRECTIVE_STAGE3A_PILOT_FAILED",
        },
    }


def canonical_recipe() -> dict[str, Any]:
    return {
        "recipe_id": RECIPE_ID,
        "run_id": RUN_ID,
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
        "precision": PRECISION,
        "tf32": TF32,
        "sequence_length": SEQ_LEN,
        "micro_batch": MICRO_BATCH,
        "grad_accum": GRAD_ACCUM,
        "effective_batch_sequences": MICRO_BATCH * GRAD_ACCUM,
        "effective_tokens_per_step": TOKENS_PER_STEP,
        "max_authorized_tokens": TOTAL_STEPS * TOKENS_PER_STEP,
        "checkpoint_policy": {
            "step0": "parent_pointer_only",
            "metrics_every_optimizer_step": True,
            "compact_eval_steps": COMPACT_CADENCE,
            "full_eval_steps": FULL_CADENCE,
            "save_weights_steps": WEIGHT_SAVE_STEPS,
            "save_optimizer_steps": OPTIMIZER_SAVE_STEPS,
            "always_save_weights_on_stop_policy_halt": True,
            "never_lose_terminal_state": True,
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
        "stop_policy_enforcement": (
            "After each compact/full eval, call wrim-stop-policy-v1 decide(). "
            "If next_optimizer_step_allowed is false, halt before the next optimizer.step. "
            "HARD_ABORT stops immediately."
        ),
        "eval_decoder": "GREEDY",
        "training_authorized": False,
    }


def recipe_hash(recipe: dict[str, Any]) -> str:
    blob = json.dumps(recipe, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--weights", required=True)
    p.add_argument("--tokenizer", required=True)
    p.add_argument("--stream", required=True)
    p.add_argument("--ledger", required=True)
    p.add_argument("--sovereignty-report", required=True)
    p.add_argument("--stage1", required=True)
    p.add_argument("--stage2", required=True)
    p.add_argument("--phase2", required=True)
    p.add_argument("--stage3a", required=True)
    p.add_argument("--corrective", required=True)
    p.add_argument("--claude-md", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--report", required=True)
    args = p.parse_args()
    started = utc_now()

    parent_sha = sha256_file(Path(args.weights))
    tok_sha = sha256_file(Path(args.tokenizer))
    stream_sha = npy_payload_sha(Path(args.stream))
    sovereignty = load_json(Path(args.sovereignty_report)) or {}
    packed_source_sha = str((sovereignty.get("new_stream") or {}).get("packed_source_sha256") or "")
    seed = int((sovereignty.get("new_stream") or {}).get("seed") or 0)
    ledger = load_json(Path(args.ledger)) or {"documents": []}
    excluded_hits = ledger_has_excluded(ledger)
    claude_on_disk = Path(args.claude_md).exists()
    sched = self_test()
    if not sched["ok"]:
        raise SystemExit(f"P2 schedule self-test failed: {sched['failed']}")
    if TOKENS_PER_STEP != 4096:
        raise SystemExit("tokens/step arithmetic failed")
    if SEQ_LEN * MICRO_BATCH * GRAD_ACCUM != 4096:
        raise SystemExit("512 x 8 x 1 must equal 4096")

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
    precision = probe_precision()
    history = historical_audit(
        {
            "stage1": Path(args.stage1),
            "stage2": Path(args.stage2),
            "phase2": Path(args.phase2),
            "stage3a": Path(args.stage3a),
            "corrective": Path(args.corrective),
        }
    )
    redteam = {
        "lr_too_high_for_retention": {
            "risk": "2e-5 and 3e-5 over 50 steps already approached or exceeded retention bands; STAGE3A 2e-5 hit ΔNLL 0.214 / KL 0.037.",
            "mitigation": "peak_lr=1e-5, the only recorded Nebula peak that stayed inside ΔNLL/KL bands on RUN-000004, plus cosine decay over 975 steps.",
        },
        "lr_too_low_to_answer_diagnostic": {
            "risk": "RUN-000004 at 1e-5 did not produce sustained unique128/looping gains by step 25.",
            "mitigation": "P2 has 40× the token budget. Cosine keeps most of the run between 1e-6 and 1e-5 rather than collapsing LR immediately. Choosing below 1e-5 would leave the recorded empirical range.",
        },
        "warmup_hides_early_movement": {
            "risk": "Long warmup would make steps 5/10 almost zero LR.",
            "mitigation": "warmup=25 (2.5%). Step 5=2e-6, step 10=4e-6, step 25=peak. Not an 8-step or 50%-of-run stretch.",
        },
        "schedule_decays_too_early": {
            "risk": "STAGE3A cosine over 25 post-warmup steps reached min at step 50.",
            "mitigation": "Cosine horizon is 975 steps. Mid-run (step 500) remains ~5e-6, still in the 000004 operating band.",
        },
        "weight_decay_on_tiny_budget": {
            "risk": "wd=0.1 on 4.096M tokens could over-regularize.",
            "mitigation": "Every recorded Nebula AdamW used 0.1. Changing wd would confound comparison with Stage 2/3A/000004.",
        },
        "grad_accum_alters_adamw": {
            "risk": "accum>1 changes update frequency vs historical 4096-token steps.",
            "mitigation": "grad_accum=1, matching every recorded Nebula trainer and slice_contiguous_batches.",
        },
        "precision_instability": {
            "risk": "BF16/TF32 could shift NLL/KL vs WRIM-0 baseline.",
            "mitigation": "FP32, TF32 off. Runtime shows BF16 may be supported; it is not chosen.",
        },
        "checkpoint_eval_overhead": {
            "risk": "Eval every compact step changes wall-clock but not optimizer math if eval is inference-only.",
            "mitigation": "Eval in eval/no-grad. Do not step the optimizer during eval. Compact cadence unchanged.",
        },
        "resume_breaks_stream_order": {
            "risk": "CUDA RNG and unsaved accum would desynchronize batches.",
            "mitigation": "RESTART_REQUIRED_NOT_RESUMABLE. Official P2 trajectory is a single uninterrupted process, or a full restart from WRIM-0 with the identical recipe.",
        },
    }

    payload = {
        "ok": True,
        "kind": KIND,
        "recipe_id": RECIPE_ID,
        "final_classification": "P2_RECIPE_READY_FOR_COMMANDER_AUTHORIZATION",
        "optimizer_steps": 0,
        "optimizer_steps_this_pass": 0,
        "tokens_trained": 0,
        "AdamW_constructed": False,
        "P2_TRAINING_AUTHORIZED": False,
        "training_authorized": False,
        "TRAINING_AUTHORIZATION": "OFF",
        "P3_AUTHORIZED": False,
        "STAGE3B_AUTHORIZATION": "NO",
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "start_timestamp": started,
        "end_timestamp": utc_now(),
        "parent_sha256": parent_sha,
        "tokenizer_sha256": tok_sha,
        "seed": seed,
        "stream_sha256": stream_sha,
        "packed_source_sha256": packed_source_sha,
        "identity_ok": identity_ok,
        "sovereignty_exclusions_unchanged": excluded_hits == [] and "CLAUDE.md" in (sovereignty.get("exclusions_applied") or []),
        "claude_md_on_disk_untouched": claude_on_disk,
        "excluded_present_in_ledger": excluded_hits,
        "historical_configs_audited": history,
        "schedule_self_test": {"ok": sched["ok"], "passed": sched["passed"], "table": sched["table"], "formula": sched["formula"]},
        "precision_probe": precision,
        "vram_estimate": vram_estimate(),
        "tokens_per_step_arithmetic": {
            "sequence_length": SEQ_LEN,
            "micro_batch": MICRO_BATCH,
            "grad_accum": GRAD_ACCUM,
            "product": TOKENS_PER_STEP,
            "loader": "slice_contiguous_batches(stream, 1000, 8, 512): each step stacks 8 windows of 512 tokens; offset += 512 per window; 8*512*1=4096",
        },
        "red_team": redteam,
        "recipe": recipe,
        "recipe_sha256": rhash,
        "stop_policy_version": STOP_POLICY_VERSION,
        "stop_policy_unchanged": True,
        "corpus_mutated": False,
        "tokenizer_mutated": False,
        "stream_mutated": False,
        "nothing_pushed": True,
        "nothing_deployed": True,
        "local_commit_created": False,
    }
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    write_json(out_dir / "recipe.json", recipe)
    write_json(out_dir / "recipe-hash.json", {"recipe_id": RECIPE_ID, "recipe_sha256": rhash})
    write_json(Path(args.report), payload)
    print(
        json.dumps(
            {
                "ok": True,
                "final_classification": payload["final_classification"],
                "optimizer_steps": 0,
                "tokens_trained": 0,
                "peak_lr": PEAK_LR,
                "min_lr": MIN_LR,
                "warmup_steps": WARMUP_STEPS,
                "recipe_sha256": rhash,
                "TRAINING_AUTHORIZATION": "OFF",
            },
            indent=2,
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
