import { WrCorpusPolicyError } from '@/lib/wr-corpus/hashes'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  FORBIDDEN_ENV_ACTIONS,
  RAEL_STATUS,
  type ForbiddenEnvAction,
} from './identity'

export type { ForbiddenEnvAction }

const MESSAGES: Record<ForbiddenEnvAction, string> = {
  JUST_RUN_10_STEPS: 'Ad-hoc extra optimizer steps are denied. WRIM1-NEBULA-DIAG-000001 already ran exactly 10 steps and STOPPED.',
  TEST_ONE_OPTIMIZER_STEP: 'Optimizer steps are not authorized outside the bounded Stage 1 CLI diagnostic. Denied.',
  CONVERT_AND_OVERWRITE_MAC: 'Historical WRIM-0 checkpoint is read-only. Overwrite denied.',
  USE_COLLAPSED_WRIM1: 'Collapsed WRIM-1 weights are not a parent. Denied.',
  ENABLE_TRAIN_BUTTON: 'No Train button. TRAINING_AUTHORIZATION=OFF after Phase 2 grid completion.',
  START_STAGE_1: 'HTTP Stage 1 is denied. Authorized diagnostic is CLI WRIM1-NEBULA-DIAG-000001 only. No Train button.',
  START_STAGE_2: 'HTTP Stage 2 is denied. WRIM1-NEBULA-STAB-000001 already ran and STOPPED at the retention sentinel. Do not continue.',
  START_STAGE_3: 'WRIM1-RUN-000003 STAGE3A candidate selection is COMPLETE. Preferred evaluation candidate is STEP50_A0.5 TEST_ONLY_MERGE. Raw step50 remains B. REVIEW_REQUIRED_CONTINUOUS_DRIFT. HEALTHY_FOR_CONTINUATION=false. TRAINING_AUTHORIZATION=OFF. Do not start STAGE3B. Do not train. Do not promote.',
  CONTINUE_TO_100: 'Stage 2 maximum is 50 optimizer steps. Continuation denied. Sentinel stop is final for this run.',
  PROMOTE_STAGE_2: 'Stage 2 is TEST_ONLY. Promotion denied.',
  MIX_TOOL_CURRICULUM: 'TOOL_USE remains 0% for this dense baseline. Denied.',
  RAISE_LR: 'Raising LR is denied. Stage 3 design peak_lr is 2e-5. Do not restore 3e-5 because loss looks slow.',
  IGNORE_REHEARSAL_OVERSHOOT: 'Rehearsal ratio control is a hard packer gate. Ignoring overshoot is denied.',
  ENABLE_BF16_FOR_SPEED: 'Stage 2 remains FP32 with TF32 off. BF16 for speed is denied.',
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
