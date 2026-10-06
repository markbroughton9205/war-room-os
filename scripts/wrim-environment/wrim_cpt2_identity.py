"""WR-CORPUS-CPT-2-v1.0.0 / WRIM1-CPT-000002 Stage B identity.

Training is fail-closed unless BOTH are present:
  --authorize-wrim1-cpt-000002
  env WRIM_TRAINING_AUTHORIZATION=ON_FOR_WRIM1_CPT_000002_ONLY
Does not reuse WRIM1-RUN-000013. Does not mutate STEP_400, WRIM-0, or tokenizer.
"""
from __future__ import annotations

from wrim_cpt_identity import (
    ARCHITECTURE,
    AUTHORIZE_ENV,
    LINUX_CKPT_ROOT,
    LINUX_DATA_ROOT,
    PARAM_COUNT,
    PARENT_SHA,
    TOKENIZER_SHA,
)
from wrim_cpt_stage_b_identity import (
    INDEPENDENT_NL_MANIFEST_HASH,
    INDEPENDENT_NL_PACK_HASH,
    INDEPENDENT_NL_PACK_ID,
    PROPOSED_STAGE_B_CPT_RUN_ID,
    PROVISIONAL_STAGE_B_PARENT,
    PROVISIONAL_STAGE_B_PARENT_HASH,
)

CPT_RUN_ID = PROPOSED_STAGE_B_CPT_RUN_ID  # WRIM1-CPT-000002 if later authorized
NAMESPACE = "WRIM1-CPT"
RESERVED_SFT_RUN = "WRIM1-RUN-000013"

CORPUS_ID = "WR-CORPUS-CPT-2"
CORPUS_VERSION = "WR-CORPUS-CPT-2-v1.0.0"
TOKENIZER_ID = "WR-TOKENIZER-0"
TOKENIZER_EXPECTED_SHA = TOKENIZER_SHA
PARENT_CHECKPOINT = "STEP_400"
PARENT_HASH = PROVISIONAL_STAGE_B_PARENT_HASH
PARENT_WRIM0_HASH = PARENT_SHA
ARCHITECTURE_ID = ARCHITECTURE
PARAMETER_COUNT = PARAM_COUNT

BOS_ID = 1
EOS_ID = 2
PAD_ID = 0
SYSTEM_ID = 4
COMMANDER_ID = 5
ASSISTANT_ID = 6
NEWLINE_ID = 112
SEQ_LEN = 512
MICRO_BATCH = 8
TOKENS_PER_STEP = 4096
B1_STEPS = 200
B1_MAX_TOKENS = B1_STEPS * TOKENS_PER_STEP  # 819200
B1_WARMUP = 10
B1_LR = 5e-5
OBJECTIVE = "full_stream_next_token_ce"
MASK_PROMPT_TOKENS = False
SEED = 20260922
VAL_DOC_FRACTION = 0.10
MIX_TOLERANCE_PP = 1.0

REQUESTED_MIX = {
    "genuine_general_prose": 0.22,
    "expository_prose": 0.12,
    "factual_explanation": 0.10,
    "instructional_prose": 0.08,
    "dialogue": 0.06,
    "narrative": 0.06,
    "descriptive": 0.04,
    "code": 0.12,
    "structured_json": 0.06,
    "technical_explanation_non_repo": 0.08,
    "genesis_rehearsal": 0.05,
    "role_boundary_rehearsal": 0.01,
}

GENUINE_PROSE_CATEGORIES = (
    "genuine_general_prose",
    "expository_prose",
    "factual_explanation",
    "instructional_prose",
    "dialogue",
    "narrative",
    "descriptive",
    "technical_explanation_non_repo",
)

PACKER_VERSION = "cpt2-v1-sentence-boundary-family-homogeneous"
AUTHORIZE_ENV_NAME = AUTHORIZE_ENV
STAGE_B_AUTHORIZE_ENV_VALUE = "ON_FOR_WRIM1_CPT_000002_ONLY"
STAGE_A_STALE_VALUE = "ON_FOR_WRIM1_CPT_000001_STAGE_A_ONLY"
AUTHORIZE_FLAG = "--authorize-wrim1-cpt-000002"
MISSION_ORIGIN = "WRIM_CONTINUED_PRETRAINING_STAGE_B"
EVAL_SEED = 42
GRAD_CLIP = 1.0
WEIGHT_DECAY = 0.1
BETAS = (0.9, 0.95)
EPS = 1e-8
PACK_TARGET_TOKENS = B1_MAX_TOKENS + 1  # +1 for last next-token label
EXPECTED_CORPUS_HASH = "87ecdc3497eaf3e9c39c2beeac515528740be48c8e41d56f28f0f59e99015738"
LR_SCHEDULE_ID = "wrim_cpt2_train.lr_cpt_000002"

DATA_ROOT = LINUX_DATA_ROOT
CKPT_ROOT = LINUX_CKPT_ROOT  # Stage A parent lives here; do not write Stage B into it
PROPOSED_CKPT_ROOT = "/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only/WRIM1-CPT-000002"
STAGE3_OBSERVE_STEPS = (0, 100, 200)

INDEPENDENT_NL_PACK = INDEPENDENT_NL_PACK_ID
INDEPENDENT_NL_PACK_HASH_EXPECTED = INDEPENDENT_NL_PACK_HASH
INDEPENDENT_NL_MANIFEST_HASH_EXPECTED = INDEPENDENT_NL_MANIFEST_HASH

REPORT_FILENAME = "WRIM1_CPT_STAGE_B_CORPUS_AND_READINESS_REPORT.json"
DRY_CONFIG_FILENAME = "WRIM1-CPT-000002-B1-DRY-CONFIG.json"

B1_EVAL_STEPS = (0, 25, 50, 75, 100, 125, 150, 175, 200)
