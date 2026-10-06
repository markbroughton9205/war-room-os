/**
 * WRIM1-RUN-000004 STAGE3A corrective generation-stability pilot design.
 * Does not train. Does not overwrite WRIM1-RUN-000003. STAGE3B remains unauthorized.
 */
export const CORRECTIVE_STAGE3A_RUN_ID = 'WRIM1-RUN-000004' as const
export const CORRECTIVE_STAGE3A_DESIGN_ID = 'WRIM1-NEBULA-STAGE3A-CORRECTIVE-DESIGN-000001' as const
export const CORRECTIVE_STAGE3A_DESIGN_STATUS = 'READY' as const
export const CORRECTIVE_STAGE3A_EXECUTION_READINESS = false as const
export const CORRECTIVE_STAGE3A_PARENT = 'WRIM-0' as const
export const CORRECTIVE_STAGE3A_PARENT_SHA256 =
  'd1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015' as const
export const CORRECTIVE_STAGE3A_SEED = 4004 as const
export const CORRECTIVE_STAGE3A_STEPS = 25 as const
export const CORRECTIVE_STAGE3A_PEAK_LR = 1e-5 as const
export const CORRECTIVE_STAGE3A_MIN_LR = 1e-6 as const
export const CORRECTIVE_STAGE3A_WARMUP_STEPS = 8 as const
export const CORRECTIVE_STAGE3A_SEQ_LEN = 512 as const
export const CORRECTIVE_STAGE3A_MICRO_BATCH = 8 as const
export const CORRECTIVE_STAGE3A_GRAD_ACCUM = 1 as const
export const CORRECTIVE_STAGE3A_TOKENS_PER_STEP = 4096 as const
export const CORRECTIVE_STAGE3A_TOTAL_TOKENS = 102_400 as const
export const CORRECTIVE_STAGE3A_PACKING = 'DOCUMENT_MAJOR_CONTIGUOUS' as const
export const CORRECTIVE_STAGE3A_MIX = {
  wr_corpus_0: 0.15,
  prose: 0.4,
  code: 0.2,
  json: 0.21,
  behavior: 0.04,
} as const
export const CORRECTIVE_STAGE3A_ALICE_CAP = 0.03 as const
export const CORRECTIVE_DEV_SUITE_ID = 'WRIM-DEV-S3A-COR-000001' as const
export const CORRECTIVE_DEV_SUITE_STATUS = 'DEVELOPMENT_ONLY' as const
export const HISTORICAL_STAGE3_RUN_ID = 'WRIM1-RUN-000003' as const
export const CORRECTIVE_STAGE3A_UNLIKELIHOOD = false as const
export const CORRECTIVE_STAGE3A_REP_PENALTY = false as const
export const CORRECTIVE_STAGE3A_AUX_LOSS = false as const
export const CORRECTIVE_DNLL_ABORT_GT = 0.105 as const
export const CORRECTIVE_KL_ABORT_GT = 0.018 as const
export const CORRECTIVE_VAL0_ABORT_GT = 8.890125 as const
export const CORRECTIVE_CAP_ABORT_LE = 3 as const
export const CORRECTIVE_CAP_SUCCESS_GE = 5 as const
export const CORRECTIVE_SPECIAL_RATE_ABORT_GT = 0.08 as const
export const CORRECTIVE_CHECKPOINTS = [0, 5, 10, 15, 20, 25] as const
export const CORRECTIVE_STAGE3A_PILOT_STATUS = 'COMPLETE' as const
export const CORRECTIVE_STAGE3A_PILOT_CLASSIFICATION = 'CORRECTIVE_STAGE3A_PILOT_FAILED' as const
export const CORRECTIVE_STAGE3A_CONTINUATION_RECOMMENDATION = 'NO' as const
export const CORRECTIVE_STAGE3A_STEPS_EXECUTED = 25 as const
export const CORRECTIVE_STAGE3A_TOKENS_TRAINED = 102_400 as const
