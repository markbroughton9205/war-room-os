"""WRIM1-RUN-000008 identity. Does not train. Does not construct an optimizer."""
from __future__ import annotations

RUN_ID = "WRIM1-RUN-000008"
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

RESERVED_HISTORICAL_RUN_IDS = (
    "WRIM1-RUN-000001",
    "WRIM1-RUN-000002",
    "WRIM1-RUN-000003",
    "WRIM1-RUN-000004",
    "WRIM1-RUN-000005",
    "WRIM1-RUN-000006",
    "WRIM1-RUN-000007",
)

STEPS = 20
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
PEAK_LR = 5e-6
MIN_LR = 1e-6
WARMUP_STEPS = 6
SEED = 8008
EVAL_SEED = 42
REHEARSAL_MODE = "BALANCED_GENESIS"
REHEARSAL_RATIO = 0.30
GENERAL_RATIO = 0.45
CAPABILITY_RATIO = 0.25
LOCKED_MIX = {
    "wr_corpus_0": 0.300,
    "prose": 0.219,
    "code": 0.165,
    "json": 0.055,
    "behavior": 0.011,
    "cap_instruction": 0.0875,
    "cap_json": 0.0750,
    "cap_code": 0.0625,
    "cap_stopping": 0.0250,
}
CAPABILITY_WITHIN_SHARE = {
    "cap_instruction": 0.35,
    "cap_json": 0.30,
    "cap_code": 0.25,
    "cap_stopping": 0.10,
}
AUX_KL_LOSS = False
FULL_EVAL_STEPS = (0, 5, 6, 10, 15, 20)
WEIGHT_STEPS = (5, 6, 10, 15, 20)
OPTIMIZER_STATE_STEPS = (20,)
REQUIRE_GREEDY_256 = True
COMPACT_EVAL_FORBIDDEN_FOR_GATES = True
MAX_DOC_SHARE_ABORT = 0.50
STARVED_DOCS_ALLOWED = 0
PARENT_VAL0 = 8.890125
PARENT_VAL1 = 7.971308
RUN000006_STEP10_VAL0 = 8.834181
RUN000006_STEP10_VAL1 = 7.933425
RUN000007_STEP10_VAL0 = 8.856793
RUN000007_STEP10_VAL1 = 7.947591
PACK_TARGET_TOKENS = 24 * TOKENS_PER_STEP
TRAINING_AUTHORIZATION = "OFF"
STAGE3B_AUTHORIZATION = "NO"
AUTHORIZE_FLAG = "--authorize-wrim1-run-000008"
AUTHORIZE_ENV = "WRIM_TRAINING_AUTHORIZATION"
AUTHORIZE_ENV_VALUE = "ON_FOR_WRIM1_RUN_000008_ONLY"
KIND = "WRIM1_RUN_000008_CAPABILITY_TRAINING"
CONFIG_KIND = "WRIM1_RUN_000008_TRAINING_CONFIG"
ARCHITECTURE = "WRIM-G-20M-v1-option-A"
PRECISION = "FP32"
TF32 = "OFF"
NEXT_UNAUTHORIZED_STEP = 21
PACKER_VERSION = "balanced-genesis-excerpt-v1-stdlib-run000008-capability"
FILTER_VERSION = "wrim1-run-000007-packer-filter-v1"
DATASET_ID = "WR-CORPUS-CAPABILITY-1"
DATASET_VERSION = "WR-CORPUS-CAPABILITY-1-v1.0.0"
MIX_TOLERANCE = {
    "wr_corpus_0": 0.020,
    "prose": 0.030,
    "code": 0.025,
    "json": 0.020,
    "behavior": 0.010,
    "cap_instruction": 0.020,
    "cap_json": 0.020,
    "cap_code": 0.020,
    "cap_stopping": 0.012,
}
OVERALL_MIX_TOLERANCE = {
    "rehearsal": 0.020,
    "general": 0.035,
    "capability": 0.030,
}
LINUX_VENV_PYTHON = "/home/chosenone/.local/share/war-room-os/venvs/wrim-pytorch-linux/bin/python"
REQUIRED_FREE_VRAM_MIB = 4096
RUN000006_OOM_FREE_MIB = 340.12
ATTRACTOR_WARN_MAX_RUN = 60
ATTRACTOR_REVIEW_MAX_RUN = 70
ATTRACTOR_HARD_MAX_RUN = 85
KNOWN_EVAL_DUMP_CHUNK_IDS = (
    "w81chk_d70284b0e574f3bc4205_0",
    "w81chk_c16fd86f5952356582b3_1",
    "w81chk_940925b697848429c05b_2",
)
EXCLUDED_SOURCE_PATHS = (
    "model-lab/manifests/wrim0_eval_results.json",
    "model-lab/manifests/GENESIS_REPORT.md",
)
PRIVILEGE_REPAIR_PATH = "docs/architecture/PRODUCTION_DATABASE_PRIVILEGE_REPAIR.md"
ADDENDUM_NEEDLES = (
    "VESPER-OXIDE-BADGE",
    "NOK-17",
    "NIMBUS-WICK",
    "OX-4417",
    "BEGIN|MID|END",
    "KELVARRE-QUAY-MARKER",
)
BANNED_STAGE3_KEYS = (
    "quay_id",
    "crate_count",
    "inner_flag",
    "tally_quayside",
)
LINUX_DATA_ROOT = "/home/chosenone/.local/share/war-room-os/data/wrim-environment"
LINUX_CKPT_ROOT = "/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only/WRIM1-RUN-000008"
