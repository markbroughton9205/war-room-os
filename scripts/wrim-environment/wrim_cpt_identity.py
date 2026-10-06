"""WRIM1-CPT-000001 identity. Continued pretraining namespace. Does not train.

Separate from WRIM1-RUN-00000N SFT numbering. Does not construct an optimizer.
"""
from __future__ import annotations

CPT_RUN_ID = "WRIM1-CPT-000001"
RUN_ID = CPT_RUN_ID
NAMESPACE = "WRIM1-CPT"
STAGE = "A"
KIND = "WRIM1_CPT_000001_CONTINUED_PRETRAINING_STAGE_A"
MISSION_ORIGIN = "WRIM_CONTINUED_PRETRAINING_FOUNDATION"
PARENT_ID = "WRIM-0"
PARENT_SHA = "d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015"
TOKENIZER_ID = "WR-TOKENIZER-0"
TOKENIZER_SHA = "47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7"
ARCHITECTURE = "WRIM-G-20M-v1-option-A"
PARAM_COUNT = 19_217_152
SUITE_ID = "WRIM-EVAL-S3-000001"
SUITE_SHA = "934ff60bcd179ec643257fbfaa30f2a3a7621b175fc7d3c3d0efc30d946d5ac4"
ADDENDUM_SHA = "4e9a6206c09e933d9c7de3be33617ff698839f59854ce71ddd3d5a4a5de9f4fd"
BASELINE_SHA = "7c1cc9fe7d4208d93cd3cdb6b25783daea8947ae26622e706d4a0032f934ed5f"
CORPUS_ID = "WR-CORPUS-CPT-1"
CORPUS_VERSION = "WR-CORPUS-CPT-1-v1.0.0"
FOUNDATION_EVAL_ID = "WRIM-FOUNDATION-EVAL-1"
FOUNDATION_EVAL_VERSION = "WRIM-FOUNDATION-EVAL-1-v1.0.0"

BOS_ID = 1
EOS_ID = 2
SYSTEM_ID = 4
COMMANDER_ID = 5
ASSISTANT_ID = 6
NEWLINE_ID = 112  # Ċ in WR-TOKENIZER-0

TOKENS_PER_STEP = 4096
SEQ_LEN = 512
MICRO_BATCH = 8
GRAD_ACCUM = 1
# 1220 * 4096 = 4,997,120 < 5,000,000 hard cap
STEPS = 1220
MAX_TOKENS = STEPS * TOKENS_PER_STEP
MAX_ADDITIONAL_TOKENS_CAP = 5_000_000
# +1 for next-token labels on the last position of the last sequence
PACK_TARGET_TOKENS = MAX_TOKENS + 1
LINUX_VENV_PYTHON = "/home/chosenone/.local/share/war-room-os/venvs/wrim-pytorch-linux/bin/python"

OPTIMIZER = "AdamW"
FUSED = False
BETAS = (0.9, 0.95)
EPS = 1e-8
WEIGHT_DECAY = 0.1
GRAD_CLIP = 1.0
# Continued pretrain from a finished WRIM-0 run that ended at 3e-4, not from-scratch 3e-3.
PEAK_LR = 3e-4
MIN_LR = 3e-5
WARMUP_STEPS = 60
SEED = 20260921
EVAL_SEED = 42

LOCKED_MIX = {
    "natural": 0.35,
    "code": 0.25,
    "technical": 0.15,
    "json": 0.10,
    "role": 0.10,
    "genesis": 0.05,
}
MIX_TOLERANCE = {k: 0.03 for k in LOCKED_MIX}

OBJECTIVE = "full_stream_next_token_ce"
MASK_PROMPT_TOKENS = False

FULL_EVAL_STEPS = (0, 100, 200, 400, 610, 800, 1000, 1220)
WEIGHT_STEPS = FULL_EVAL_STEPS
OPTIMIZER_STATE_STEPS = FULL_EVAL_STEPS
STAGE3_OBSERVE_STEPS = (0, 610, 1220)

TRAINING_AUTHORIZATION = "OFF"
STAGE3B_AUTHORIZATION = "NO"
AUTHORIZE_FLAG = "--authorize-wrim1-cpt-000001"
AUTHORIZE_ENV = "WRIM_TRAINING_AUTHORIZATION"
AUTHORIZE_ENV_VALUE = "ON_FOR_WRIM1_CPT_000001_STAGE_A_ONLY"

LINUX_DATA_ROOT = "/home/chosenone/.local/share/war-room-os/data/wrim-environment"
LINUX_CKPT_ROOT = "/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only/WRIM1-CPT-000001"
CHECKPOINT_CONTRACT = "wrim_resumable_checkpoint.v1"
PACKER_VERSION = "cpt-v1-full-stream-role-boundary"

RESERVED_HISTORICAL_RUN_IDS = (
    "WRIM1-RUN-000001",
    "WRIM1-RUN-000002",
    "WRIM1-RUN-000003",
    "WRIM1-RUN-000004",
    "WRIM1-RUN-000005",
    "WRIM1-RUN-000006",
    "WRIM1-RUN-000007",
    "WRIM1-RUN-000008",
    "WRIM1-RUN-000009",
    "WRIM1-RUN-000010",
    "WRIM1-RUN-000011",
    "WRIM1-RUN-000012",
    "WRIM1-RUN-000013",
)

ORIGINAL_PRETRAIN_RECIPE = {
    "source": "mac-model-recovery wrim0_train_stdout.log + wrim0_train_log.jsonl",
    "ORIGINAL_PRETRAIN_LR_PEAK": 3e-3,
    "ORIGINAL_PRETRAIN_LR_START": 1e-4,
    "ORIGINAL_PRETRAIN_LR_FINAL": 3e-4,
    "ORIGINAL_OPTIMIZER": "UNKNOWN_EXPLICIT_CLASS (MLX trainer logged Adam-like step/lr/gradNorm; WRIM1 later standardized AdamW)",
    "ORIGINAL_WARMUP": "linear ~30 steps 1e-4 → 3e-3",
    "ORIGINAL_WEIGHT_DECAY": "UNKNOWN_FROM_RECOVERED_LOG",
    "ORIGINAL_CLIP": "UNKNOWN_FROM_RECOVERED_LOG (gradNorm logged, clip not named)",
    "ORIGINAL_SCHEDULE": "warmup 30 then cosine 3e-3 → 3e-4 over 500 steps",
    "ORIGINAL_TOKENS_PER_STEP": 4096,
    "ORIGINAL_STEPS": 500,
    "ORIGINAL_TOKENS": 2_048_000,
    "ORIGINAL_FINAL_TRAIN_LOSS": 4.518,
    "ORIGINAL_FINAL_VAL_LOSS": 8.730,
}
