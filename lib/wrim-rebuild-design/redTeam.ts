import { WrCorpusPolicyError } from '@/lib/wr-corpus/hashes'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  FORBIDDEN_REBUILD_ACTIONS,
  RAEL_STATUS,
  TRAINING_AUTHORIZATION,
  type ForbiddenRebuildAction,
} from './identity'

export type { ForbiddenRebuildAction }

const MESSAGES: Record<ForbiddenRebuildAction, string> = {
  INSTALL_PYTORCH_NOW: 'This design pass does not authorize package installation.',
  CONVERT_CHECKPOINT_NOW: 'No checkpoint conversion in this pass. Parent remains read-only.',
  START_TRAINING_NOW: `TRAINING_AUTHORIZATION=${TRAINING_AUTHORIZATION}. CURRENT_WRIM_TRAINING=${CURRENT_WRIM_TRAINING}. Training denied.`,
  RESUME_MLX_OPTIMIZER: 'Historical MLX optimizer state is framework-specific. Resume denied. Fresh AdamW only.',
  INIT_FROM_COLLAPSED_WRIM1: 'Collapsed/failed WRIM-1 checkpoints are not parents. Parent is WRIM-0.',
  AVERAGE_REJECTED_CHECKPOINTS: 'Averaging rejected checkpoints is denied.',
  REUSE_WRIM1_RUN_000001: 'WRIM1-RUN-000001 is retired. New official ID is WRIM1-RUN-000003.',
  REUSE_WRIM1_RUN_000002: 'WRIM1-RUN-000002 is retired. New official ID is WRIM1-RUN-000003.',
  PER_TOKEN_SHUFFLE_PACKING: 'Historical per-token shuffle is FORBIDDEN. Contiguous unit packing required.',
  INCLUDE_TOOL_USE_IN_BASELINE: 'TOOL_USE = EXCLUDED for the first dense baseline (Recovery-010).',
  TRAIN_WR_TOKENIZER_1: 'WR-TOKENIZER-0 is frozen. WR-TOKENIZER-1 is not trained in this pass.',
  CREATE_RAEL: `RAEL=${RAEL_STATUS}. Creation denied.`,
  PROMOTE_MODEL: `CURRENT_PRODUCTION_WRIM=${CURRENT_PRODUCTION_WRIM}. Promotion denied in the design pass.`,
  EXPAND_CONTEXT_IN_BASELINE: 'Context stays 512 for the controlled dense rebuild.',
  START_MOE_OR_SPARSE: 'Sparse-expert / MoE / NVMe streaming is a later lane. Dense baseline required first.',
  REPLACE_QWEN: 'Qwen remains THIRD_PARTY_MODEL_RUNNING_LOCALLY.',
  UPLOAD_MODEL_OR_CORPUS: 'No model or corpus upload. Training stays on Nebula.',
  ENABLE_EXTERNAL_TELEMETRY: 'External telemetry is OFF unless explicitly approved.',
}

export function denyForbiddenRebuildAction(action: ForbiddenRebuildAction, extra?: string): never {
  const msg = extra ? `${MESSAGES[action]} ${extra}` : MESSAGES[action]
  throw new WrCorpusPolicyError(action, msg)
}

export function tryForbiddenRebuildAction(action: ForbiddenRebuildAction): {
  denied: true
  action: ForbiddenRebuildAction
  code: string
  reason: string
} {
  try {
    denyForbiddenRebuildAction(action)
  } catch (error) {
    const err = error as WrCorpusPolicyError
    return { denied: true, action, code: err.code || action, reason: err.message }
  }
}

export function allForbiddenRebuildActions(): ForbiddenRebuildAction[] {
  return [...FORBIDDEN_REBUILD_ACTIONS]
}
