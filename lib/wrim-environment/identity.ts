/**
 * #23 Nebula PyTorch/CUDA environment + Stage 0/1 + Stage 2 stability + STAGE3A confirmation.
 * STAGE3A Commander review complete. Candidate selection complete. Training OFF. STAGE3B not authorized. No Ra'el. No promotion.
 */
export const WRIM_ENVIRONMENT_RUNTIME_VERSION = 'wrim-environment-v1' as const
export const WRIM_REBUILD_DESIGN = 'COMPLETE' as const
export const ROADMAP_22_STATUS = 'CLOSED' as const
export const ROADMAP_23_STATUS = 'ACTIVE' as const

export const PARENT_MODEL_ID = 'WRIM-0' as const
export const PARENT_SHA256 =
  'd1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015' as const
export const TOKENIZER_ID = 'WR-TOKENIZER-0' as const
export const TOKENIZER_SHA256 =
  '47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7' as const

export const CURRENT_PRODUCTION_WRIM = 'NOT_IMPLEMENTED' as const
export const CURRENT_WRIM_TRAINING = 'NOT_RUNNING' as const
export const TRAINING_AUTHORIZATION = 'OFF' as const
export const RAEL_STATUS = 'NOT_IMPLEMENTED' as const
export const ASCENSION_AUTONOMY = 'OFF' as const
export const QWEN_INTELLIGENCE_CLASS = 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' as const

export const VENV_RELATIVE = ['venvs', 'wrim-pytorch'] as const
export const PLANNED_PYTHON = '3.13.15' as const
export const PLANNED_TORCH = '2.13.0+cu130' as const
export const PLANNED_INDEX = 'https://download.pytorch.org/whl/cu130' as const
export const CUDA_TOOLKIT_INSTALLED = false as const
export const STAGE1_AUTHORIZED = true as const
export const STAGE1_RUN_ID = 'WRIM1-NEBULA-DIAG-000001' as const
export const STAGE1_STATUS = 'STAGE1_VERIFIED' as const
export const STAGE2_AUTHORIZED = true as const
export const STAGE2_RUN_ID = 'WRIM1-NEBULA-STAB-000001' as const
export const STAGE2_STATUS = 'STAGE2_STOPPED_BY_SENTINEL' as const
export const STAGE2_CLASSIFICATION = 'TEST_ONLY / STOPPED_BY_SENTINEL / REJECTED_FOR_STAGE3' as const
export const READY_FOR_STAGE3_TRAINING_AUTHORIZATION = false as const
export const STAGE3_RUN_ID = 'WRIM1-RUN-000003' as const
export const STAGE3_DESIGN_STATUS = 'ACCEPTED_FOR_PREPARATION' as const
export const STAGE3_EXECUTION_REVIEW = 'PASS' as const
export const STAGE3_TRAINER_STATUS = 'STAGE3A_REVIEWED' as const
export const STAGE3_EXECUTION_READINESS = true as const
export const STAGE3A_EXECUTION_READINESS = false as const
export const STAGE3B_EXECUTION_READINESS = false as const
export const STAGE3_AUTHORIZATION = 'NO' as const
export const STAGE3A_STATUS = 'REVIEWED' as const
export const STAGE3A_REVIEW_STATUS = 'COMPLETE' as const
export const STAGE3A_CANDIDATE_STATE = 'EVALUATION_CANDIDATE' as const
export const STAGE3A_CLASSIFICATION = 'B. REVIEW_REQUIRED_CONTINUOUS_DRIFT' as const
export const STAGE3A_HEALTHY_FOR_CONTINUATION = false as const
export const STAGE3A_CANDIDATE_SELECTION_STATUS = 'COMPLETE' as const
export const PREFERRED_STAGE3A_EVALUATION_CANDIDATE = 'STEP50_A0.5' as const
export const STAGE3A_PREFERRED_KIND = 'TEST_ONLY_MERGE' as const
export const CONTROLLED_STABILITY_EXPERIMENT_ID = 'WRIM1-NEBULA-CTRL-STAB-000001' as const
export const PHASE0_STATUS = 'REVIEWED_ACCEPTED' as const
export const PHASE1_STATUS = 'PHASE1_GREEDY_DETERMINISM_PASS' as const
export const PHASE2_EXPERIMENT_ID = 'WRIM1-NEBULA-STABILITY-GRID-000001' as const
export const PHASE2_STATUS = 'PHASE2_GRID_COMPLETE' as const
export const CONTROLLED_STABILITY_CLASSIFICATION = 'TEST_ONLY / CONTROLLED_EXPERIMENT / PHASE2_GRID_COMPLETE / INCONCLUSIVE / PHASE3A_COMPLETE / MULTIPLE_FINDINGS' as const
export const PHASE3A_STATUS = 'PHASE3A_COMPLETE' as const
export const NEXT_AUTHORIZED_PASS = 'STAGE3A_CANDIDATE_SELECTION_COMPLETE' as const

export const SMOKE_ARGMAX_ID = 126 as const
export const SMOKE_ENTROPY = 6.033060550689697 as const
export const CPU_ENTROPY_TOL = 1e-4 as const
export const CUDA_ENTROPY_TOL = 0.02 as const

export const FORBIDDEN_ENV_ACTIONS = [
  'JUST_RUN_10_STEPS',
  'TEST_ONE_OPTIMIZER_STEP',
  'CONVERT_AND_OVERWRITE_MAC',
  'USE_COLLAPSED_WRIM1',
  'ENABLE_TRAIN_BUTTON',
  'START_STAGE_1',
  'START_STAGE_2',
  'START_STAGE_3',
  'CONTINUE_TO_100',
  'PROMOTE_STAGE_2',
  'MIX_TOOL_CURRICULUM',
  'RAISE_LR',
  'IGNORE_REHEARSAL_OVERSHOOT',
  'ENABLE_BF16_FOR_SPEED',
  'SWITCH_QWEN_TO_WRIM',
  'CALL_WRIM_RAEL',
  'INSTALL_CUDA_TOOLKIT_JUST_IN_CASE',
  'UPLOAD_MODEL_FOR_BENCHMARK',
  'PUSH_CHANGES',
] as const

export type ForbiddenEnvAction = (typeof FORBIDDEN_ENV_ACTIONS)[number]
