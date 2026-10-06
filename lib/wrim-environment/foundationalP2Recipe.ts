/**
 * Frozen WRIM1-RUN-000005 P2 training recipe.
 * Design only. Does not authorize training. STAGE3B remains NO.
 */
export const P2_RECIPE_ID = 'WRIM1-RUN-000005-P2-RECIPE' as const
export const P2_RECIPE_KIND = 'WRIM_FOUNDATIONAL_P2_RECIPE' as const
export const P2_RECIPE_CLASSIFICATION = 'P2_RECIPE_READY_FOR_COMMANDER_AUTHORIZATION' as const
export const P2_PEAK_LR = 1e-5 as const
export const P2_MIN_LR = 1e-6 as const
export const P2_WARMUP_STEPS = 25 as const
export const P2_TOTAL_STEPS = 1000 as const
export const P2_BETAS = [0.9, 0.95] as const
export const P2_EPS = 1e-8 as const
export const P2_WEIGHT_DECAY = 0.1 as const
export const P2_GRAD_CLIP = 1.0 as const
export const P2_PRECISION = 'FP32' as const
export const P2_TF32 = false as const
export const P2_SEQ_LEN = 512 as const
export const P2_MICRO_BATCH = 8 as const
export const P2_GRAD_ACCUM = 1 as const
export const P2_TOKENS_PER_STEP = 4096 as const
export const P2_RUNTIME_SEED = 5005 as const
export const P2_EVAL_SEED = 42 as const
export const P2_RESUME_POLICY = 'RESTART_REQUIRED_NOT_RESUMABLE' as const
export const P2_OOM_POLICY = 'HARD_ABORT' as const
export const P2_SCHEDULER = 'warmup_cosine_1_indexed' as const
export const P2_TRAINING_AUTHORIZED = false as const
