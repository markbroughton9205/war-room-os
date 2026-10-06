"""WRIM1-RUN-000009 identity. Does not train. Does not construct an optimizer."""
from __future__ import annotations

RUN_ID = "WRIM1-RUN-000009"
PARENT_ID = "WRIM-0"
PARENT_SHA = "d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015"
TOKENIZER_ID = "WR-TOKENIZER-0"
TOKENIZER_SHA = "47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7"
SUITE_ID = "WRIM-EVAL-S3-000001"
SUITE_VERSION = "1.0.0"
SUITE_SHA = "934ff60bcd179ec643257fbfaa30f2a3a7621b175fc7d3c3d0efc30d946d5ac4"
ADDENDUM_ID = "WRIM-EVAL-S3-INSTRUCTION-ADDENDUM-000001"
ADDENDUM_SHA = "4e9a6206c09e933d9c7de3be33617ff698839f59854ce71ddd3d5a4a5de9f4fd"
BASELINE_SHA = "7c1cc9fe7d4208d93cd3cdb6b25783daea8947ae26622e706d4a0032f934ed5f"
REFERENCE_NLL_CANONICAL_LF_SHA = "43c57b52610cbdaf7a6edf4791b05e2d360936b3341a0b6ca1838d940dd27dfe"
CAPABILITY_DATASET_ID = "WR-CORPUS-CAPABILITY-1-v1.0.0"
CAPABILITY_DATASET_HASH = "7fba73f434538a6cbbabe4edad775764f7fcaf4681837652ac713bb8c4ddca1d"

RESERVED_HISTORICAL_RUN_IDS = (
    "WRIM1-RUN-000001",
    "WRIM1-RUN-000002",
    "WRIM1-RUN-000003",
    "WRIM1-RUN-000004",
    "WRIM1-RUN-000005",
    "WRIM1-RUN-000006",
    "WRIM1-RUN-000007",
    "WRIM1-RUN-000008",
)

STEPS = 50
TOKENS_PER_STEP = 4096
MAX_TOKENS = STEPS * TOKENS_PER_STEP
SEQ_LEN = 512
MICRO_BATCH = 8
GRAD_ACCUM = 1
OPTIMIZER = "AdamW"
FUSED = False
BETAS = (0.9, 0.95)
EPS = 1e-8
WEIGHT_DECAY = 0.1
GRAD_CLIP = 1.0
PEAK_LR = 7.5e-6
LR_HARD_CAP = 8e-6
MIN_LR = 1e-6
WARMUP_STEPS = 8
SEED = 9009
EVAL_SEED = 42
REHEARSAL_MODE = "BALANCED_GENESIS"
REHEARSAL_RATIO = 0.25
GENERAL_RATIO = 0.30
CAPABILITY_RATIO = 0.45
CAPABILITY_HARD_CAP = 0.50
GENERAL_WITHIN = {
    "prose": 0.146,
    "code": 0.110,
    "json": 0.037,
    "behavior": 0.007,
}
STAGES = (
    {
        "name": "A_MODE_ENTRY",
        "first_step": 1,
        "last_step": 10,
        "n_steps": 10,
        "cap_within": {
            "cap_instruction": 0.55,
            "cap_stopping": 0.30,
            "cap_json": 0.10,
            "cap_code": 0.05,
        },
    },
    {
        "name": "B_STRUCTURE",
        "first_step": 11,
        "last_step": 20,
        "n_steps": 10,
        "cap_within": {
            "cap_instruction": 0.35,
            "cap_stopping": 0.20,
            "cap_json": 0.35,
            "cap_code": 0.10,
        },
    },
    {
        "name": "C_CODE_ACQUISITION",
        "first_step": 21,
        "last_step": 35,
        "n_steps": 15,
        "cap_within": {
            "cap_instruction": 0.25,
            "cap_stopping": 0.15,
            "cap_json": 0.25,
            "cap_code": 0.35,
        },
    },
    {
        "name": "D_CONSOLIDATION",
        "first_step": 36,
        "last_step": 50,
        "n_steps": 15,
        "cap_within": {
            "cap_instruction": 0.30,
            "cap_stopping": 0.15,
            "cap_json": 0.30,
            "cap_code": 0.25,
        },
    },
)
AUX_KL_LOSS = False
FULL_EVAL_STEPS = (0, 5, 8, 10, 15, 20, 25, 30, 35, 40, 45, 50)
WEIGHT_STEPS = (5, 8, 10, 15, 20, 25, 30, 35, 40, 45, 50)
OPTIMIZER_STATE_STEPS = (50,)
REQUIRE_GREEDY_256 = True
MAX_DOC_SHARE_ABORT = 0.50
PARENT_VAL0 = 8.890125
PARENT_VAL1 = 7.971308
TRAINING_AUTHORIZATION = "OFF"
STAGE3B_AUTHORIZATION = "NO"
AUTHORIZE_FLAG = "--authorize-wrim1-run-000009"
AUTHORIZE_ENV = "WRIM_TRAINING_AUTHORIZATION"
AUTHORIZE_ENV_VALUE = "ON_FOR_WRIM1_RUN_000009_ONLY"
KIND = "WRIM1_RUN_000009_STAGED_CAPABILITY"
ARCHITECTURE = "WRIM-G-20M-v1-option-A"
PRECISION = "FP32"
TF32 = "OFF"
NEXT_UNAUTHORIZED_STEP = 51
PACKER_VERSION = "staged-capability-v1-run000009"
FILTER_VERSION = "wrim1-run-000007-packer-filter-v1"
LINUX_VENV_PYTHON = "/home/chosenone/.local/share/war-room-os/venvs/wrim-pytorch-linux/bin/python"
REQUIRED_FREE_VRAM_MIB = 4096
ATTRACTOR_WARN_MAX_RUN = 60
ATTRACTOR_REVIEW_MAX_RUN = 70
ATTRACTOR_HARD_MAX_RUN = 85
LINUX_DATA_ROOT = "/home/chosenone/.local/share/war-room-os/data/wrim-environment"
LINUX_CKPT_ROOT = "/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only/WRIM1-RUN-000009"
ADDENDUM_NEEDLES = (
    "VESPER-OXIDE-BADGE",
    "NOK-17",
    "NIMBUS-WICK",
    "OX-4417",
    "BEGIN|MID|END",
    "KELVARRE-QUAY-MARKER",
)
KNOWN_EVAL_DUMP_CHUNK_IDS = (
    "w81chk_d70284b0e574f3bc4205_0",
    "w81chk_c16fd86f5952356582b3_1",
    "w81chk_940925b697848429c05b_2",
)
MIX_TOLERANCE = {
    "wr_corpus_0": 0.030,
    "prose": 0.035,
    "code": 0.030,
    "json": 0.020,
    "behavior": 0.010,
    "cap_instruction": 0.040,
    "cap_json": 0.040,
    "cap_code": 0.040,
    "cap_stopping": 0.030,
}
OVERALL_MIX_TOLERANCE = {
    "rehearsal": 0.030,
    "general": 0.040,
    "capability": 0.040,
}


def stage_locked_mix(cap_within: dict[str, float]) -> dict[str, float]:
    mix = {
        "wr_corpus_0": REHEARSAL_RATIO,
        **GENERAL_WITHIN,
        "cap_instruction": CAPABILITY_RATIO * float(cap_within["cap_instruction"]),
        "cap_json": CAPABILITY_RATIO * float(cap_within["cap_json"]),
        "cap_code": CAPABILITY_RATIO * float(cap_within["cap_code"]),
        "cap_stopping": CAPABILITY_RATIO * float(cap_within["cap_stopping"]),
    }
    return mix


def stage_for_step(step: int) -> dict[str, object] | None:
    for st in STAGES:
        if int(st["first_step"]) <= step <= int(st["last_step"]):
            return st
    return None
