import { WrCorpusPolicyError } from '@/lib/wr-corpus/hashes'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  FORBIDDEN_ENV_ACTIONS,
  RAEL_STATUS,
  TRAINING_AUTHORIZATION,
  type ForbiddenEnvAction,
} from './identity'

export type { ForbiddenEnvAction }

const MESSAGES: Record<ForbiddenEnvAction, string> = {
  JUST_RUN_10_STEPS: `Stage 1 is training. TRAINING_AUTHORIZATION=${TRAINING_AUTHORIZATION}. Denied.`,
  TEST_ONE_OPTIMIZER_STEP: 'Optimizer steps are not authorized in Stage 0. Denied.',
  CONVERT_AND_OVERWRITE_MAC: 'Historical WRIM-0 checkpoint is read-only. Overwrite denied.',
  USE_COLLAPSED_WRIM1: 'Collapsed WRIM-1 weights are not a parent. Denied.',
  ENABLE_TRAIN_BUTTON: 'No Train button. TRAINING_AUTHORIZATION=OFF.',
  START_STAGE_1: 'Stage 1 is not authorized. Return READY_FOR_STAGE1_AUTHORIZATION only.',
  START_STAGE_2: 'Stage 2 is not authorized.',
  START_STAGE_3: 'WRIM1-RUN-000003 is not authorized.',
  SWITCH_QWEN_TO_WRIM: 'Qwen remains THIRD_PARTY_MODEL_RUNNING_LOCALLY. WRIM is not production.',
  CALL_WRIM_RAEL: `RAEL=${RAEL_STATUS}. WRIM-0 is a research artifact, not Ra'el.`,
  INSTALL_CUDA_TOOLKIT_JUST_IN_CASE: 'CUDA Toolkit is not required. PyTorch cu130 bundled runtime works. Denied.',
  UPLOAD_MODEL_FOR_BENCHMARK: 'No model upload. Benchmarks stay on Nebula.',
  PUSH_CHANGES: 'This pass does not push.',
}

export function denyForbiddenEnvAction(action: ForbiddenEnvAction, extra?: string): never {
  const msg = extra ? `${MESSAGES[action]} ${extra}` : MESSAGES[action]
  throw new WrCorpusPolicyError(action, `${msg} CURRENT_WRIM_TRAINING=${CURRENT_WRIM_TRAINING}. CURRENT_PRODUCTION_WRIM=${CURRENT_PRODUCTION_WRIM}.`)
}

export function tryForbiddenEnvAction(action: ForbiddenEnvAction): {
  denied: true
  action: ForbiddenEnvAction
  code: string
  reason: string
} {
  try {
    denyForbiddenEnvAction(action)
  } catch (error) {
    const err = error as WrCorpusPolicyError
    return { denied: true, action, code: err.code || action, reason: err.message }
  }
}

export function allForbiddenEnvActions(): ForbiddenEnvAction[] {
  return [...FORBIDDEN_ENV_ACTIONS]
}
