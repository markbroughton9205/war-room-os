/**
 * #23 Nebula PyTorch/CUDA environment + Stage 0 equivalence.
 * No training. No backward. No optimizer. No Ra'el. No promotion.
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
export const STAGE1_AUTHORIZED = false as const
export const NEXT_AUTHORIZED_PASS = 'READY_FOR_STAGE1_AUTHORIZATION' as const

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
  'SWITCH_QWEN_TO_WRIM',
  'CALL_WRIM_RAEL',
  'INSTALL_CUDA_TOOLKIT_JUST_IN_CASE',
  'UPLOAD_MODEL_FOR_BENCHMARK',
  'PUSH_CHANGES',
] as const

export type ForbiddenEnvAction = (typeof FORBIDDEN_ENV_ACTIONS)[number]
