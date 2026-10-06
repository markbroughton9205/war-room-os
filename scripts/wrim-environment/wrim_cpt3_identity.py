"""WRIM1-CPT-000003 Stage B packer-fix validation run identity.

Training is fail-closed unless BOTH are present:
  --authorize-wrim1-cpt-000003
  env WRIM_TRAINING_AUTHORIZATION=ON_FOR_WRIM1_CPT_000003_ONLY

Does not resume WRIM1-CPT-000002. Does not use the CPT-000002 abort dump as parent.
Does not mutate the frozen WR-CORPUS-CPT-2-v1.0.0, tokenizer, or architecture.
"""
from __future__ import annotations

from wrim_cpt2_identity import (
    ARCHITECTURE_ID,
    BETAS,
    CORPUS_ID,
    CORPUS_VERSION,
    EPS,
    EVAL_SEED,
    EXPECTED_CORPUS_HASH,
    GRAD_CLIP,
    INDEPENDENT_NL_MANIFEST_HASH_EXPECTED,
    INDEPENDENT_NL_PACK,
    INDEPENDENT_NL_PACK_HASH_EXPECTED,
    MASK_PROMPT_TOKENS,
    MICRO_BATCH,
    OBJECTIVE,
    PARAMETER_COUNT,
    PARENT_CHECKPOINT,
    PARENT_HASH,
    PARENT_WRIM0_HASH,
    REQUESTED_MIX,
    SEED,
    SEQ_LEN,
    TOKENIZER_EXPECTED_SHA,
    TOKENIZER_ID,
    TOKENS_PER_STEP,
    WEIGHT_DECAY,
)
from wrim_cpt_identity import AUTHORIZE_ENV, LINUX_DATA_ROOT

CPT_RUN_ID = "WRIM1-CPT-000003"
NAMESPACE = "WRIM1-CPT"
RETIRED_CPT_RUN = "WRIM1-CPT-000002"
RESERVED_SFT_RUN = "WRIM1-RUN-000013"
FORBIDDEN_PARENT_PREFIX = "04cbbd9a"

B1_STEPS = 50
B1_MAX_TOKENS = B1_STEPS * TOKENS_PER_STEP  # 204800
B1_WARMUP = 10
B1_LR = 5e-5
PACK_TARGET_TOKENS = B1_MAX_TOKENS + 1
PACKER_PREVIEW_STEPS = 100

PACKER_VERSION = "cpt2-v2-all12-capped-highgrad-docdiv"
PACKER_PREVIOUS_VERSION = "cpt2-v1-sentence-boundary-family-homogeneous"
AUTHORIZE_ENV_NAME = AUTHORIZE_ENV
STAGE_B_AUTHORIZE_ENV_VALUE = "ON_FOR_WRIM1_CPT_000003_ONLY"
STAGE_A_STALE_VALUE = "ON_FOR_WRIM1_CPT_000001_STAGE_A_ONLY"
STAGE_B_CPT000002_STALE_VALUE = "ON_FOR_WRIM1_CPT_000002_ONLY"
AUTHORIZE_FLAG = "--authorize-wrim1-cpt-000003"
MISSION_ORIGIN = "WRIM_CONTINUED_PRETRAINING_STAGE_B_CPT000003"
LR_SCHEDULE_ID = "wrim_cpt3_train.lr_cpt_000003"

EXPECTED_MANIFEST_HASH = "5c7d096f3636d43c39d8ba1d767c8c5871b849734a72d0da16e8643162553ef3"
EXPECTED_TRAIN_HASH = "091a0c205744f0bd0217ccf383729759fe1db0a1ae8e18047d2fc11893b27544"
EXPECTED_VAL_HASH = "a957588766a81976114d0225c83d7ffb5ce57f7d8420f8a0eb491b95a1ecf780"

DATA_ROOT = LINUX_DATA_ROOT
CKPT_ROOT = "/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only/WRIM1-CPT-000003"
RETIRED_CKPT_ROOT = "/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only/WRIM1-CPT-000002"

B1_EVAL_STEPS = (0, 10, 20, 25, 30, 40, 50)
STAGE3_OBSERVE_STEPS = B1_EVAL_STEPS
GRAD_WARN = 5.0
GRAD_REVIEW = 6.5
GRAD_HARD = 8.0

CAPPED_FAMILIES = {
    "genesis_rehearsal": 2,
    "structured_json": 2,
    "role_boundary_rehearsal": 2,
    "technical_explanation_non_repo": 2,
}
MAX_SAME_DOCUMENT_PER_BATCH = 2
MIXED_MAX_PER_FAMILY = 7  # mixed batches may not be 8/8 of any family

REPORT_FILENAME = "WRIM1_CPT_000003_PACKER_FIX_VALIDATION_REPORT.json"
