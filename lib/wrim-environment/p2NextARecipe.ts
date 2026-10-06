/**
 * Frozen P2-NEXT-A_SCHEDULE_HORIZON recipe.
 * Design only. Does not authorize training. Isolates cosine horizon 1000 -> 50.
 */
export const P2_NEXT_A_EXPERIMENT_ID = 'P2-NEXT-A_SCHEDULE_HORIZON' as const
export const P2_NEXT_A_RECIPE_ID = 'WRIM1-P2-NEXT-A-SCHEDULE-HORIZON-RECIPE' as const
export const P2_NEXT_A_KIND = 'WRIM_P2_NEXT_A_SCHEDULE_HORIZON_RECIPE' as const
export const P2_NEXT_A_CLASSIFICATIONS = [
  'P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN',
  'P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_BLOCKED',
] as const
export const P2_NEXT_A_PEAK_LR = 1e-5 as const
export const P2_NEXT_A_MIN_LR = 1e-6 as const
export const P2_NEXT_A_WARMUP_STEPS = 25 as const
export const P2_NEXT_A_TOTAL_STEPS = 50 as const
export const P2_NEXT_A_BETAS = [0.9, 0.95] as const
export const P2_NEXT_A_EPS = 1e-8 as const
export const P2_NEXT_A_WEIGHT_DECAY = 0.1 as const
export const P2_NEXT_A_GRAD_CLIP = 1.0 as const
export const P2_NEXT_A_PRECISION = 'FP32' as const
export const P2_NEXT_A_TOKENS_PER_STEP = 4096 as const
export const P2_NEXT_A_MAX_TOKENS = 204_800 as const
export const P2_NEXT_A_TRAINING_AUTHORIZED = false as const
export const P2_NEXT_A_KL_IN_LOSS = false as const
export const P2_NEXT_A_OBJECTIVE = 'ordinary_continuation_ce' as const
export const P2_NEXT_A_RECIPE_SHA256 =
  '528c250d6546c4fdbb4853207b57f477b9f9adaf8d754ec6c038c087ed3f5ed3' as const
