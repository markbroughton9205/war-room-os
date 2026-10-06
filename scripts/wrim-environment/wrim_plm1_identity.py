"""WRIM1-PLM-000001 identity. Prefix-LM response-entry probe.

Does not train. Does not construct an optimizer.
Canonical remains STEP_400. Experimental parent is CPT-000005/step-75.
Not CPT-000006. Not Stage 3B. Not full SFT.
"""
from __future__ import annotations

from wrim_cpt_identity import AUTHORIZE_ENV, LINUX_DATA_ROOT
from wrim_cpt5_identity import (
    CANONICAL_CHECKPOINT,
    CANONICAL_HASH,
    STEP400_STAGE3_COLLAPSE,
    STEP400_STAGE3_DELTA_VS_WRIM0,
    TOKENIZER_EXPECTED_SHA,
    TOKENIZER_ID,
)

RUN_ID = "WRIM1-PLM-000001"
NAMESPACE = "WRIM1-PLM"
AUTHORIZE_FLAG = "--authorize-wrim1-plm-000001"
AUTHORIZE_ENV_NAME = AUTHORIZE_ENV
AUTHORIZE_ENV_VALUE = "ON_FOR_WRIM1_PLM_000001_ONLY"
MISSION_ORIGIN = "WRIM_GENESIS_PREFIX_LM_RESPONSE_ENTRY_PROBE"

EXPERIMENTAL_PARENT_CHECKPOINT = "WRIM1-CPT-000005/step-75"
EXPERIMENTAL_PARENT_CKPT = (
    "/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only/WRIM1-CPT-000005/step-75"
)
EXPECTED_PARENT_MODEL_HASH = "8ad01d8faf1619f20c3d1d5ddd2f49e91bf73c9a63e95bf077b8157709573271"
EXPECTED_PARENT_OPTIMIZER_HASH = "b0616e551966ffdefbd2acd1df57896bc5fc844b77cee81a9e2133cb5f15574d"
PARENT_STAGE3_DELTA_VS_WRIM0 = 1.380640002659389
PARENT_STAGE3_DRIFT_VS_STEP400 = 0.5322056906563896
PARENT_FOUNDATION_RANK = 2013.40625
PARENT_FOUNDATION_TOP5 = 5
PARENT_GREEDY_STOP = 4
STAGE3_PARENT_DRIFT_HARD = 0.848
REMAINING_STAGE3_HEADROOM = STAGE3_PARENT_DRIFT_HARD - PARENT_STAGE3_DRIFT_VS_STEP400

FORBIDDEN_RUNS = (
    "WRIM1-CPT-000002",
    "WRIM1-CPT-000003",
    "WRIM1-CPT-000006",
    "WRIM1-RUN-000013",
)
STALE_AUTH_VALUES = (
    "ON_FOR_WRIM1_CPT_000001_STAGE_A_ONLY",
    "ON_FOR_WRIM1_CPT_000002_ONLY",
    "ON_FOR_WRIM1_CPT_000003_ONLY",
    "ON_FOR_WRIM1_CPT_000004_ONLY",
    "ON_FOR_WRIM1_CPT_000005_ONLY",
    "ON_FOR_WRIM1_RUN_000012_ONLY",
)

CORPUS_ID = "WR-CORPUS-PLM-PROBE-1"
CORPUS_VERSION = "WR-CORPUS-PLM-PROBE-1-v1.0.0"
OBJECTIVE = "prefix_lm_response_ce"
MASK_PROMPT_TOKENS = True
ASSISTANT_DELIMITER_POLICY = "A_ASSISTANT_CONTEXT_ONLY"
# Inference inserts <|assistant|> then generates. Supervising assistant would
# teach a token the eval prefix already contains. Policy A matches greedy eval.
PROMPT_TOKENS_SUPERVISED = False
TARGET_TOKENS_SUPERVISED = True
EOS_SUPERVISED = True

STEPS = 10
TOKENS_PER_STEP = 4096
MAX_TOKENS = STEPS * TOKENS_PER_STEP
SEQ_LEN = 512
MICRO_BATCH = 8
NEXT_UNAUTHORIZED_STEP = 11
EVAL_STEPS = (0, 2, 5, 8, 10)
CKPT_STEPS = EVAL_STEPS

OPTIMIZER_STATE_POLICY = "RESET_FOR_NEW_OBJECTIVE"
LEARNING_RATE = 5e-6
WARMUP_STEPS = 0
LR_SCHEDULE_ID = "wrim_plm1_train.lr_plm_000001_constant"
WHY_SELECTED_LR = (
    "Prior WRIM instruction/mode-entry/target-only runs used 4e-6..7.5e-6 "
    "(RUN-000007/010/011 at 5e-6, RUN-000012 at 4e-6). CPT 5e-5 is a full-stream "
    "document CE rate; prefix-LM supervises far fewer tokens per step so 5e-5 would "
    "be ~10x too hot. 5e-6 is the proven 10-step probe scale. No warmup: 6-step "
    "warmup would consume most of a 10-step budget (RUN-000007 lesson)."
)
WHY_RESET_OPTIMIZER = (
    "New objective (masked prefix-LM) vs CPT full-stream CE. CPT AdamW moments "
    "are for unmasked mixed-family next-token loss. Prior WRIM capability runs "
    "always constructed a fresh AdamW on loaded weights. Weights still come from "
    "CPT-000005/step-75; only moments reset."
)

BETAS = (0.9, 0.95)
EPS = 1e-8
WEIGHT_DECAY = 0.1
GRAD_CLIP = 1.0
GRAD_WARN = 5.0
GRAD_REVIEW = 6.5
GRAD_HARD = 8.0
SEED = 8001
EVAL_SEED = 42
PRECISION = "FP32"

DATA_ROOT = LINUX_DATA_ROOT
CKPT_ROOT = "/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only/WRIM1-PLM-000001"
REPORT_FILENAME = "WRIM1_PLM_000001_PREFIX_LM_PROBE_REPORT.json"
CORPUS_DIRNAME = CORPUS_VERSION

STAGE3_REVIEW_DELTA = 1.15
STEP400_STAGE3_DELTA_VS_WRIM0 = STEP400_STAGE3_DELTA_VS_WRIM0
STEP400_STAGE3_COLLAPSE = STEP400_STAGE3_COLLAPSE
CANONICAL_CHECKPOINT = CANONICAL_CHECKPOINT
CANONICAL_HASH = CANONICAL_HASH
TOKENIZER_ID = TOKENIZER_ID
TOKENIZER_EXPECTED_SHA = TOKENIZER_EXPECTED_SHA
