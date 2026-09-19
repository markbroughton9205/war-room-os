/**
 * WRIM1-RUN-000006 pre-training gate identity.
 * Does not authorize training. Does not construct an optimizer.
 */
export const RUN_000006_ID = 'WRIM1-RUN-000006' as const
export const RUN_000006_KIND = 'WRIM1_RUN_000006_PRETRAINING_GATE' as const
export const RUN_000006_CONFIG_KIND = 'WRIM1_RUN_000006_TRAINING_CONFIG' as const
export const RUN_000006_STEPS = 25 as const
export const RUN_000006_TOKENS_PER_STEP = 4096 as const
export const RUN_000006_MAX_TOKENS = 102400 as const
export const RUN_000006_PEAK_LR = 1e-5 as const
export const RUN_000006_MIN_LR = 1e-6 as const
export const RUN_000006_WARMUP = 12 as const
export const RUN_000006_SEED = 6006 as const
export const RUN_000006_REHEARSAL = 'BALANCED_GENESIS' as const
export const RUN_000006_FULL_EVAL_STEPS = [0, 5, 10, 15, 20, 25] as const
export const RUN_000006_AUTHORIZE_FLAG = '--authorize-wrim1-run-000006' as const
export const REFERENCE_NLL_CANONICAL_LF_SHA256 =
  '43c57b52610cbdaf7a6edf4791b05e2d360936b3341a0b6ca1838d940dd27dfe' as const
export const FROZEN_GENESIS_TRAIN_IDS = [
  '3aad6a56-039d-45c7-ba1b-3642f3293196',
  '7180f321-8186-424a-b995-f3298b29d5c2',
  'a1211375-318b-4866-92ba-70bb10241766',
  'af0163c6-478f-4541-aab0-7ad84e592222',
  'bdbb17d6-5e32-4672-980f-7cdb68d0ab5a',
] as const
