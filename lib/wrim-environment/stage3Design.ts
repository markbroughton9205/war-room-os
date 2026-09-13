/**
 * WRIM1-RUN-000003 Stage 3 design constants.
 * Evaluation suite is authored and WRIM-0 baseline is frozen.
 * Does not train. Does not authorize STAGE3A/STAGE3B execution.
 */
export const STAGE3_RUN_ID = 'WRIM1-RUN-000003' as const
export const STAGE3_DESIGN_ID = 'WRIM1-NEBULA-STAGE3-DESIGN-000001' as const
export const STAGE3_DESIGN_DECISION = 'ACCEPTED_FOR_PREPARATION' as const
export const STAGE3_EXECUTION_READINESS = true as const
export const STAGE3_AUTHORIZATION = 'NO' as const
export const STAGE3_EVAL_SUITE_ID = 'WRIM-EVAL-S3-000001' as const
export const STAGE3_EVAL_SUITE_STATUS = 'AUTHORED_FROZEN' as const
export const STAGE3B_LR_FORMULA = 'REQUIRED_BEFORE_STAGE3B_AUTHORIZATION' as const

export const STAGE3_PARENT_ID = 'WRIM-0' as const
export const STAGE3_PARENT_SHA256 =
  'd1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015' as const
export const STAGE3_TOKENIZER_ID = 'WR-TOKENIZER-0' as const
export const STAGE3_TOKENIZER_SHA256 =
  '47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7' as const
export const STAGE3_ARCHITECTURE = 'WRIM-G-20M-v1-option-A' as const
export const STAGE3_PARAM_COUNT = 19_217_152 as const
export const STAGE3_ARCHITECTURE_CLASS = 'dense' as const

export const STAGE3_PRECISION = 'FP32' as const
export const STAGE3_TF32 = 'OFF' as const
export const STAGE3_SEQ_LEN = 512 as const
export const STAGE3_MICRO_BATCH = 8 as const
export const STAGE3_GRAD_ACCUM = 1 as const
export const STAGE3_EFFECTIVE_BATCH = 8 as const
export const STAGE3_TOKENS_PER_STEP = 4096 as const

export const STAGE3_OPTIMIZER = 'AdamW' as const
export const STAGE3_ADAMW = {
  fused: false,
  betas: [0.9, 0.95] as const,
  eps: 1e-8,
  weight_decay: 0.1,
  grad_clip: 1.0,
  fresh_at_stage3a_start: true,
} as const

export const STAGE3_PEAK_LR = 2e-5 as const
export const STAGE3_MIN_LR_RATIO = 0.1 as const
export const STAGE3_WARMUP_STEPS = 25 as const
export const STAGE3A_STEPS = 50 as const
export const STAGE3B_STEPS = 200 as const
export const STAGE3_BLIND_1500_STEPS = 1500 as const
export const STAGE3_BLIND_1500_REJECTED = true as const
export const STAGE3A_TOKENS = STAGE3A_STEPS * STAGE3_TOKENS_PER_STEP
export const STAGE3B_TOKENS = STAGE3B_STEPS * STAGE3_TOKENS_PER_STEP
export const STAGE3_TOTAL_TOKENS_IF_BOTH = STAGE3A_TOKENS + STAGE3B_TOKENS
export const STAGE3_OFFICIAL_SEED = 3003 as const
export const STAGE3_PACKING = 'contiguous_unit' as const
export const STAGE3_BOS = 1 as const
export const STAGE3_EOS = 2 as const
export const STAGE3_PER_TOKEN_SHUFFLE = false as const
export const STAGE3_REHEARSAL_POLICY = 'NATURAL_BASELINE' as const
export const STAGE3_BALANCED_GENESIS_CLAIM = 'NOT_PROVEN_SUPERIOR' as const
export const STAGE3_CORPUS0_SHARE = 0.3 as const
export const STAGE3_CORPUS1_SHARE = 0.7 as const
export const STAGE3_TOOL_USE_SHARE = 0 as const
export const STAGE3_WR_CORPUS_ACTIVE = false as const
export const STAGE3_CODE_CAP_18 = false as const
export const STAGE3_ADAPTIVE_REPLAY = false as const

export const PHASE2_WRIM0_VAL0 = 8.890125 as const
export const PHASE2_WRIM0_VAL1 = 7.971308 as const
export const PHASE2_NATURAL_2E5_MEAN = {
  anchor_nll_delta: 0.0885,
  kl: 0.0141,
  val0: 8.458,
  val1: 7.685,
  displacement: 0.00537,
  sd_anchor_nll_delta: 0.00831,
  sd_kl: 0.00186,
  sd_val0: 0.0506,
  sd_val1: 0.00460,
} as const

export const STAGE3_CANDIDATE_STATES = [
  'TRAINING_ARTIFACT',
  'EVALUATION_CANDIDATE',
  'PROMOTION_REVIEW',
  'PROMOTED_WRIM1',
  'REJECTED',
] as const

export const STAGE3_PRIMARY_METRICS = [
  'WRIM0_ANCHOR_NLL_DELTA',
  'KL_WRIM0_TO_CANDIDATE',
  'val_loss_corpus0',
  'val_loss_corpus1',
] as const

export const STAGE3_HISTORICAL_BINARY = 'COMPATIBILITY_ONLY' as const
export const STAGE3_INTERPOLATION_REQUIRED_FOR_PROMOTION_REVIEW = true as const
export const STAGE3_INTERPOLATION_AUTO_PROMOTE = false as const
export const STAGE3_INTERPOLATION_ALPHAS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 1.0] as const
export const STAGE3_LOGIT_ENSEMBLE = false as const

export const STAGE3_KEEP_STORAGE = [
  'authoritative Phase 2/3A summaries',
  'four Phase 3A representative checkpoints',
  'WRIM-0 parent',
  'INTERPOLATION_SELECTION.json and eval JSON',
  'critical ABORT/reproduction checkpoints if any',
] as const

export const STAGE3_OPTIONAL_DELETE_AFTER_APPROVAL = [
  '36 non-selected Phase 2 per-seed checkpoints',
  'dominated interpolation merged weights (keep eval JSON)',
  'superseded accum=4 SKEWED_BASELINE artifacts',
] as const

export const STAGE3_RECLAIMABLE_GB_ESTIMATE = {
  non_selected_phase2_runs: 28.4,
  dominated_interpolation_weights: 1.1,
  superseded_accum4: 2.0,
  total_low: 29.5,
  total_high: 32.0,
  delete_this_pass: false,
} as const
