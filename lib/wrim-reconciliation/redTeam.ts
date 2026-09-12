import { WrCorpusPolicyError } from '@/lib/wr-corpus/hashes'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  FORBIDDEN_WRIM_ACTIONS,
  HISTORICAL_WRIM_0_STATUS,
  RAEL_STATUS,
  TRAINING_AUTHORIZATION,
  type ForbiddenWrimAction,
} from './identity'

export type { ForbiddenWrimAction }

const MESSAGES: Record<ForbiddenWrimAction, string> = {
  RESUME_TRAINING_IMMEDIATELY: `TRAINING_AUTHORIZATION=${TRAINING_AUTHORIZATION}. CURRENT_WRIM_TRAINING=${CURRENT_WRIM_TRAINING}. Resume denied.`,
  PROMOTE_WRIM1_BECAUSE_LARGER: 'WRIM-1 is rejected/collapsed. Size/step count is not a promotion criterion.',
  CALL_WRIM0_RAEL: `WRIM-0 is ${HISTORICAL_WRIM_0_STATUS}. RAEL=${RAEL_STATUS}.`,
  DELETE_REJECTED_CHECKPOINTS: 'Rejected Mac artifacts are forensic history. Delete denied.',
  TRAIN_FROM_COLLAPSED_CHECKPOINT: 'Training from collapsed WRIM-1 is denied. Parent is WRIM-0.',
  IGNORE_TOKENIZER_BINDING: 'WRIM embeddings are bound to WR-TOKENIZER-0. Ignoring the binding is denied.',
  CHANGE_WRIM0_TOKENIZER: 'WRIM-0 tokenizer is frozen at WR-TOKENIZER-0. In-place change denied.',
  AUTO_CONVERT_AND_OVERWRITE: 'Auto-convert that overwrites the original checkpoint is denied. Original dump is read-only.',
  START_SPARSE_EXPERT_TRAINING: 'Sparse-expert training is not authorized. Dense baseline required first.',
  COPY_18GB_INTO_ACTIVE_RUNTIME: 'Copying the recovery checkpoint tree into active runtime is denied.',
  MIX_EVAL_ONLY_INTO_TRAINING: 'Eval-only material must not enter training packs.',
  AUTO_START_RECOVERY_RUN: 'Recovery runs are TEST_ONLY and require Commander authorization. Auto-start denied.',
}

export function denyForbiddenWrimAction(action: ForbiddenWrimAction, extra?: string): never {
  const msg = extra ? `${MESSAGES[action]} ${extra}` : MESSAGES[action]
  throw new WrCorpusPolicyError(action, `${msg} CURRENT_PRODUCTION_WRIM=${CURRENT_PRODUCTION_WRIM}.`)
}

export function tryForbiddenWrimAction(action: ForbiddenWrimAction): {
  denied: true
  action: ForbiddenWrimAction
  code: string
  reason: string
} {
  try {
    denyForbiddenWrimAction(action)
  } catch (error) {
    const err = error as WrCorpusPolicyError
    return { denied: true, action, code: err.code || action, reason: err.message }
  }
}

export function allForbiddenWrimActions(): ForbiddenWrimAction[] {
  return [...FORBIDDEN_WRIM_ACTIONS]
}
