/**
 * #23 Nebula WRIM-1 rebuild training DESIGN. Plan only.
 * No installation. No conversion. No training. No Ra'el. No promotion.
 */
export const WRIM_REBUILD_DESIGN = 'COMPLETE' as const
export const WRIM_REBUILD_DESIGN_RUNTIME_VERSION = 'wrim-rebuild-design-v1' as const
export const WRIM_REBUILD_DESIGN_DECISION = 'READY_FOR_NEBULA_ENVIRONMENT_SETUP' as const
export const NEXT_AUTHORIZED_PASS = 'NEBULA_PYTORCH_CUDA_ENVIRONMENT_SETUP' as const

export const ROADMAP_22_STATUS = 'CLOSED' as const
export const ROADMAP_23_STATUS = 'ACTIVE' as const

export const PARENT_MODEL_ID = 'WRIM-0' as const
export const PARENT_CHECKPOINT_FILE = 'checkpoint-final.safetensors' as const
export const PARENT_SHA256 =
  'd1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015' as const
export const PARENT_STATUS = 'TRAINED_RESEARCH_ARTIFACT' as const
export const PARENT_READ_ONLY = true as const

export const TOKENIZER_ID = 'WR-TOKENIZER-0' as const
export const TOKENIZER_SHA256 =
  '47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7' as const
export const TOKENIZER_FROZEN = true as const
export const WR_TOKENIZER_1_THIS_PASS = false as const

export const ARCHITECTURE_FAMILY = 'WRIM-G-20M-v1-option-A' as const
export const ARCHITECTURE_DENSE = true as const
export const MOE_THIS_PASS = false as const
export const SPARSE_STREAMING_THIS_PASS = false as const

export const VOCAB_SIZE = 15126 as const
export const D_MODEL = 256 as const
export const N_LAYERS = 18 as const
export const N_HEADS = 4 as const
export const HEAD_DIM = 64 as const
export const D_FF = 768 as const
export const ROPE_THETA = 10000 as const
export const CONTEXT_LENGTH = 512 as const
export const DROPOUT = 0 as const
export const BIAS = false as const
export const PARAM_COUNT = 19_217_152 as const
export const RMSNORM_EPS = 1e-5 as const
export const ROPE_TRADITIONAL = false as const
export const TIED_EMBEDDINGS = true as const
export const LM_HEAD_INDEPENDENT = false as const

export const BOS_ID = 1 as const
export const EOS_ID = 2 as const
export const PAD_ID = 0 as const
export const PERIOD_TOKEN_ID = 20 as const
export const SMOKE_ARGMAX_ID = 126 as const
export const SMOKE_ARGMAX_TOKEN = ' a' as const
export const SMOKE_ENTROPY = 6.033060550689697 as const
export const SMOKE_PROMPT = 'The sky is' as const
export const SMOKE_CONTINUATION = ' a\n}_tokenizer_tokenizer_' as const

export const FORBIDDEN_OFFICIAL_RUN_IDS = ['WRIM1-RUN-000001', 'WRIM1-RUN-000002'] as const
export const STAGE0_RUN_ID = 'WRIM1-NEBULA-EQ-000001' as const
export const STAGE1_RUN_ID = 'WRIM1-NEBULA-DIAG-000001' as const
export const STAGE2_RUN_ID = 'WRIM1-NEBULA-STAB-000001' as const
export const STAGE3_OFFICIAL_RUN_ID = 'WRIM1-RUN-000003' as const

export const CURRENT_PRODUCTION_WRIM = 'NOT_IMPLEMENTED' as const
export const CURRENT_WRIM_TRAINING = 'NOT_RUNNING' as const
export const TRAINING_AUTHORIZATION = 'OFF' as const
export const RAEL_STATUS = 'NOT_IMPLEMENTED' as const
export const ASCENSION_AUTONOMY = 'OFF' as const
export const QWEN_INTELLIGENCE_CLASS = 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' as const
export const WRIM_RECONCILIATION = 'COMPLETE' as const
export const WRIM_CONTINUATION_RECOMMENDATION = 'B_REBUILD_WRIM_1_FROM_WRIM_0' as const

export const TOOL_USE_POLICY = 'EXCLUDED' as const
export const PACKING_METHOD = 'CONTIGUOUS_UNIT_PACK_DEFICIT_INTERLEAVE' as const
export const HISTORICAL_SHUFFLE_PACKING = 'FORBIDDEN' as const

export const PEAK_LR = 3e-5 as const
export const INITIAL_LR = 0 as const
export const MIN_LR = 3e-6 as const
export const COLLAPSED_PEAK_LR = 3e-3 as const

export const DISK_STOP_GB = 32 as const
export const DISK_WARN_GB = 64 as const

export const CHECKPOINT_ROOT = '%LOCALAPPDATA%\\War Room OS\\data\\wrim-checkpoints\\' as const
export const CHECKPOINT_LANES = ['official/', 'experiments/', 'test-only/', 'rejected/', 'promoted/'] as const

export const FORBIDDEN_REBUILD_ACTIONS = [
  'INSTALL_PYTORCH_NOW',
  'CONVERT_CHECKPOINT_NOW',
  'START_TRAINING_NOW',
  'RESUME_MLX_OPTIMIZER',
  'INIT_FROM_COLLAPSED_WRIM1',
  'AVERAGE_REJECTED_CHECKPOINTS',
  'REUSE_WRIM1_RUN_000001',
  'REUSE_WRIM1_RUN_000002',
  'PER_TOKEN_SHUFFLE_PACKING',
  'INCLUDE_TOOL_USE_IN_BASELINE',
  'TRAIN_WR_TOKENIZER_1',
  'CREATE_RAEL',
  'PROMOTE_MODEL',
  'EXPAND_CONTEXT_IN_BASELINE',
  'START_MOE_OR_SPARSE',
  'REPLACE_QWEN',
  'UPLOAD_MODEL_OR_CORPUS',
  'ENABLE_EXTERNAL_TELEMETRY',
] as const

export type ForbiddenRebuildAction = (typeof FORBIDDEN_REBUILD_ACTIONS)[number]

export function wrimRebuildDesignTruthNotes(): string[] {
  return [
    `WRIM_REBUILD_DESIGN = ${WRIM_REBUILD_DESIGN}`,
    `DECISION = ${WRIM_REBUILD_DESIGN_DECISION}`,
    `NEXT_AUTHORIZED_PASS = ${NEXT_AUTHORIZED_PASS}`,
    `PARENT = ${PARENT_MODEL_ID} ${PARENT_CHECKPOINT_FILE}`,
    `PARENT_SHA256 = ${PARENT_SHA256}`,
    `TOKENIZER = ${TOKENIZER_ID}`,
    `ARCHITECTURE = ${ARCHITECTURE_FAMILY} dense`,
    `OFFICIAL_RUN_ID = ${STAGE3_OFFICIAL_RUN_ID}`,
    `PEAK_LR = ${PEAK_LR} (not ${COLLAPSED_PEAK_LR})`,
    `PACKING = ${PACKING_METHOD}`,
    `TOOL_USE = ${TOOL_USE_POLICY}`,
    `CURRENT_PRODUCTION_WRIM = ${CURRENT_PRODUCTION_WRIM}`,
    `CURRENT_WRIM_TRAINING = ${CURRENT_WRIM_TRAINING}`,
    `TRAINING_AUTHORIZATION = ${TRAINING_AUTHORIZATION}`,
    `RAEL = ${RAEL_STATUS}`,
    `ASCENSION_AUTONOMY = ${ASCENSION_AUTONOMY}`,
    `QWEN = ${QWEN_INTELLIGENCE_CLASS}`,
    'No installation. No conversion. No training. No Train button.',
    '#22 = CLOSED',
    '#23 = ACTIVE',
  ]
}
