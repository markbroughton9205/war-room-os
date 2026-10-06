/**
 * WRIM retention-repair experiment freeze.
 * Design / recipe only. Does not authorize training. STAGE3B remains NO.
 */
export const RETENTION_REPAIR_KIND = 'WRIM_RETENTION_REPAIR_EXPERIMENTS' as const
export const RETENTION_REPAIR_CLASSIFICATIONS = [
  'WRIM_RETENTION_REPAIR_EXPERIMENTS_FROZEN',
  'WRIM_RETENTION_REPAIR_EXPERIMENTS_CORRECTED_AND_FROZEN',
  'WRIM_RETENTION_REPAIR_EXPERIMENTS_CORRECTION_BLOCKED',
  'WRIM_RETENTION_REPAIR_EXPERIMENTS_BLOCKED',
] as const
export type RetentionRepairClassification = (typeof RETENTION_REPAIR_CLASSIFICATIONS)[number]

export const RETENTION_REPAIR_BASELINE_RUN = 'WRIM1-RUN-000005' as const
export const RETENTION_REPAIR_BASELINE_RECIPE_SHA256 =
  '5b6237dcad4321111510453c9bfcb6713a8f61a8218c487afd67952a42d18117' as const

export const RB_EXP_A_ID = 'RB-EXP-B_FROZEN_WRIM0_KL' as const
export const RB_EXP_B_ID = 'RB-EXP-A_COSINE_HORIZON_25' as const
export const RB_EXP_C_ID = 'RB-EXP-C_PEAK_LR_3E-6' as const
export const RB_EXP_ORDER = [RB_EXP_B_ID, RB_EXP_A_ID, RB_EXP_C_ID] as const

export const RB_FIRST_LAMBDA = 0.1 as const
export const RB_LAMBDA_CANDIDATES = [0.05, 0.1, 0.2] as const
export const RB_RETENTION_TERM = 'teacher_forced_nll_frozen_s3_historical_32' as const

export const RB_EXP_A_MAX_TOKENS = 204_800 as const
export const RB_EXP_B_MAX_TOKENS = 204_800 as const
export const RB_EXP_C_MAX_TOKENS = 204_800 as const
export const RB_EXP_A_MAX_STEPS = 50 as const
export const RB_EXP_B_MAX_STEPS = 50 as const
export const RB_EXP_C_MAX_STEPS = 50 as const

export const RB_EXP_B_HORIZON = 50 as const
export const RB_EXP_B_WARMUP = 25 as const
export const RB_EXP_B_COSINE_DECAY_STEPS = 25 as const
export const RB_EXP_C_PEAK_LR = 3e-6 as const
export const RB_EXP_C_MIN_LR = 3e-7 as const

export const RB_EXP_A_RECIPE_SHA256 =
  '715610067775261280cd010b4af9eaf8c5e9664535e70663a787709e78cd32b3' as const
export const RB_EXP_B_RECIPE_SHA256 =
  'd8e8685d76dc09e61ff1c8f7cf1bf3f7b6aae872d90f03e6617353e9eb3582ba' as const
export const RB_EXP_C_RECIPE_SHA256 =
  '19ebf831bed855c3fd97c40c12e60c9d0ebfc064ce2cfd627d8fb49748bafa8f' as const
export const RB_EXP_B_OLD_RECIPE_SHA256 =
  '75ef284ccdfe56424a98c455d843e043fa6e42cb6dc95744d2603b2eafeb95af' as const

export const RB_TRAINING_AUTHORIZED = false as const
export const RB_EACH_RUN_REQUIRES_SEPARATE_COMMANDER_AUTHORIZATION = true as const
