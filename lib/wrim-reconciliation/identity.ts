/**
 * #23 WRIM reconciliation — recover, audit, classify. No training. No Ra'el.
 * One architecture family: WRIM-G-20M-v1-option-A. Historical versions WRIM-0 / WRIM-1.
 */
export const WRIM_ARCHITECTURE_FAMILY = 'WRIM-G-20M-v1-option-A' as const
export const WRIM_RECONCILIATION = 'COMPLETE' as const
export const WRIM_RECONCILIATION_RUNTIME_VERSION = 'wrim-reconciliation-v1' as const

export const ROADMAP_22_STATUS = 'CLOSED' as const
export const ROADMAP_23_STATUS = 'ACTIVE' as const

export const HISTORICAL_WRIM_0_ID = 'WRIM-0' as const
export const HISTORICAL_WRIM_0_STATUS = 'TRAINED_RESEARCH_ARTIFACT' as const
export const HISTORICAL_WRIM_0_SHA256 =
  'd1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015' as const
export const HISTORICAL_WRIM_0_WEIGHT_TREE_SHA256 =
  '8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9' as const
export const HISTORICAL_WRIM_0_PARAM_COUNT = 19_217_152 as const
export const HISTORICAL_WRIM_0_STEP = 500 as const
export const HISTORICAL_WRIM_0_TOKENS_SEEN = 2_048_000 as const

export const HISTORICAL_WRIM_1_STATUS = 'REJECTED_COLLAPSED' as const
export const HISTORICAL_WRIM_1_RUN_000001_STATUS = 'COLLAPSED' as const
export const HISTORICAL_WRIM_1_RUN_000002_STATUS = 'FAILED' as const
export const HISTORICAL_WRIM_1_RUN_000001_FINAL_MODEL_SHA256 =
  'e70cc5d20e12566d242fab16205fee701703fe61bd9118e955dbd09559aba830' as const
export const HISTORICAL_WRIM_1_RUN_000002_FINAL_MODEL_SHA256 =
  '71198d968f3734ef4f426360efb745b7ef49d589520563fa674a356e960534c5' as const

export const CURRENT_PRODUCTION_WRIM = 'NOT_IMPLEMENTED' as const
export const CURRENT_WRIM_TRAINING = 'NOT_RUNNING' as const
export const MODEL_TRAINING_STATUS = 'NOT_IMPLEMENTED' as const
export const RAEL_STATUS = 'NOT_IMPLEMENTED' as const
export const ASCENSION_AUTONOMY = 'OFF' as const
export const TRAINING_AUTHORIZATION = 'OFF' as const

export const CURRENT_WR_TOKENIZER = 'WR-TOKENIZER-0' as const
export const HISTORICAL_WR_TOKENIZER_0_SHA256 =
  '47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7' as const
export const WR_CORPUS_STATUS = 'IMPLEMENTED' as const
export const QWEN_INTELLIGENCE_CLASS = 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' as const

export type WrimContinuationRecommendation =
  | 'A_CONTINUE_WRIM_0_DIRECTLY'
  | 'B_REBUILD_WRIM_1_FROM_WRIM_0'
  | 'C_WRIM_2_ARCHITECTURE_FROM_WRIM_0_LINEAGE'
  | 'D_START_NEW_NATIVE_LINEAGE'

export const WRIM_CONTINUATION_RECOMMENDATION: WrimContinuationRecommendation =
  'B_REBUILD_WRIM_1_FROM_WRIM_0'

export const DENSE_BASELINE_REQUIRED = true as const

export const WRIM0_VOCAB_SIZE = 15126 as const
export const WRIM0_D_MODEL = 256 as const
export const WRIM0_N_LAYERS = 18 as const
export const WRIM0_N_HEADS = 4 as const
export const WRIM0_HEAD_DIM = 64 as const
export const WRIM0_D_FF = 768 as const
export const WRIM0_ROPE_THETA = 10000 as const
export const WRIM0_CONTEXT_LENGTH = 512 as const
export const WRIM0_ARCHITECTURE_CONFIG_HASH =
  '9e326070f07811ac89347121e2814eace7dc4b3c1c7f4d8c061c4de1299d8fef' as const

export const EXPECTED_MODEL_TENSOR_COUNT = 164 as const
export const EXPECTED_WRIM0_FILE_TENSOR_COUNT = 494 as const
export const EXPECTED_OPT_TENSOR_COUNT = 330 as const

export const DUMP_WRIM0_DIR = ['model-lab', 'manifests', 'wrim0_checkpoints'] as const
export const DUMP_WRIM1_DIR = ['model-lab', 'manifests', 'wrim1_checkpoints'] as const
export const DUMP_WRIM1_OFFICIAL_DIR = ['model-lab', 'manifests', 'wrim1_1_official', 'WRIM1-RUN-000002'] as const
export const DUMP_RECOVERY_DIR = ['model-lab', 'manifests', 'wrim1_1_recovery', 'test-only'] as const
export const DUMP_EVAL_ONLY_DIR = ['model-lab', 'eval-only'] as const

export const FORBIDDEN_WRIM_ACTIONS = [
  'RESUME_TRAINING_IMMEDIATELY',
  'PROMOTE_WRIM1_BECAUSE_LARGER',
  'CALL_WRIM0_RAEL',
  'DELETE_REJECTED_CHECKPOINTS',
  'TRAIN_FROM_COLLAPSED_CHECKPOINT',
  'IGNORE_TOKENIZER_BINDING',
  'CHANGE_WRIM0_TOKENIZER',
  'AUTO_CONVERT_AND_OVERWRITE',
  'START_SPARSE_EXPERT_TRAINING',
  'COPY_18GB_INTO_ACTIVE_RUNTIME',
  'MIX_EVAL_ONLY_INTO_TRAINING',
  'AUTO_START_RECOVERY_RUN',
] as const

export type ForbiddenWrimAction = (typeof FORBIDDEN_WRIM_ACTIONS)[number]

export function wrimReconciliationTruthNotes(): string[] {
  return [
    `WRIM_RECONCILIATION = ${WRIM_RECONCILIATION}`,
    `HISTORICAL_WRIM_0 = ${HISTORICAL_WRIM_0_STATUS}`,
    `HISTORICAL_WRIM_1 = ${HISTORICAL_WRIM_1_STATUS}`,
    `WRIM1-RUN-000001 = ${HISTORICAL_WRIM_1_RUN_000001_STATUS}`,
    `WRIM1-RUN-000002 = ${HISTORICAL_WRIM_1_RUN_000002_STATUS}`,
    'RECOVERY EXPERIMENTS = TEST_ONLY',
    `CURRENT_PRODUCTION_WRIM = ${CURRENT_PRODUCTION_WRIM}`,
    `CURRENT_WRIM_TRAINING = ${CURRENT_WRIM_TRAINING}`,
    `WR_TOKENIZER = ${CURRENT_WR_TOKENIZER}`,
    `WR_CORPUS = ${WR_CORPUS_STATUS}`,
    `RAEL = ${RAEL_STATUS}`,
    `ASCENSION_AUTONOMY = ${ASCENSION_AUTONOMY}`,
    `TRAINING_AUTHORIZATION = ${TRAINING_AUTHORIZATION}`,
    `CONTINUATION = ${WRIM_CONTINUATION_RECOMMENDATION}`,
    `DENSE_BASELINE_REQUIRED = ${DENSE_BASELINE_REQUIRED ? 'YES' : 'NO'}`,
    `QWEN = ${QWEN_INTELLIGENCE_CLASS}`,
    'No Train button. No weight mutation. No Ra\'el.',
    '#22 = CLOSED',
    '#23 = ACTIVE',
  ]
}
