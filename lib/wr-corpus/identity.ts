/**
 * #23 WR-CORPUS v1 — canonical identity and historical vs current truth.
 * One architecture. No Corpus2 / WRCorpus2 / TrainingCorpus2 / RaelCorpus.
 */
export const WR_CORPUS_RUNTIME_VERSION = 'wr-corpus-v1' as const
export const WR_CORPUS_ARCHITECTURE_ID = 'WR_CORPUS' as const

export const ROADMAP_22_STATUS = 'CLOSED' as const
export const ROADMAP_23_STATUS = 'ACTIVE' as const

export const WR_CORPUS_STATUS = 'IMPLEMENTED' as const

/** Current #23 tokenizer lane — not the historical Mac artifact. */
export const WR_TOKENIZER_STATUS = 'NOT_STARTED' as const
export const CURRENT_WR_TOKENIZER_LANE = 'NOT_STARTED' as const
export const HISTORICAL_WR_TOKENIZER_0_STATUS = 'TRAINED_VALIDATED' as const
export const HISTORICAL_WR_TOKENIZER_0_SHA256 =
  '47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7' as const

export const MODEL_TRAINING_STATUS = 'NOT_IMPLEMENTED' as const
export const CURRENT_MODEL_TRAINING_STATUS = 'NOT_RUNNING' as const

export const WRIM_STATUS = 'NOT_IMPLEMENTED' as const
export const CURRENT_PRODUCTION_WRIM = 'NOT_IMPLEMENTED' as const
export const HISTORICAL_WRIM_0_STATUS = 'TRAINED_RESEARCH_ARTIFACT' as const
export const HISTORICAL_WRIM_0_SHA256 =
  'd1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015' as const

export const RAEL_STATUS = 'NOT_IMPLEMENTED' as const

export const QWEN_INTELLIGENCE_CLASS = 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' as const

/** Still not a production *training* corpus. Retrieval/RAG ≠ training. */
export const PRODUCTION_CORPUS_PERSISTENCE = false as const
export const AUTONOMOUS_CORPUS_PERSISTENCE = false as const

export const CANONICAL_CORPUS_IDS = ['WR-CORPUS-0', 'WR-CORPUS-1'] as const
export type CanonicalCorpusId = (typeof CANONICAL_CORPUS_IDS)[number]

export const WR_CORPUS_0_HISTORICAL_ID = 'WRM-001' as const
export const WR_CORPUS_0_HISTORICAL_VERSION = '175af25fe1c17cf7630b506d0d6e6e88' as const
export const WR_CORPUS_1_HISTORICAL_ID = 'WR-CORPUS-1-HARDENED' as const
export const WR_CORPUS_1_HISTORICAL_IDENTITY = 'WR-CORPUS-1-HARDENED-CANDIDATE' as const

export const SYSTEM_HISTORICAL_OWNER = 'SYSTEM_HISTORICAL_RECOVERY' as const

export const DEFAULT_RECOVERY_DUMP_RELATIVE = [
  'C:',
  'Users',
  'markb',
  'Documents',
  'Codex',
  '2026-09-04',
  'referenced-chatgpt-conversation-this-is-an-3',
  'outputs',
  'mac-model-recovery-20260904-220419',
] as const

export const FORBIDDEN_COPY_SEGMENTS = Object.freeze([
  'wrim0_checkpoints',
  'wrim1_checkpoints',
  'wrim1_1_official',
  'wrim1_1_recovery',
  'wrim1_1_capability',
  'wrim1_1_tool_curriculum',
  'wr_tool_experiments',
  'wr_tool_curriculum',
  'wr_tool_evals',
  'wr_tool_trajectories',
  'eval-only',
] as const)

export function wrCorpusTruthNotes(): string[] {
  return [
    'HISTORICAL_WR_TOKENIZER_0 = TRAINED_VALIDATED',
    'CURRENT_WR_TOKENIZER_LANE = NOT_STARTED',
    'HISTORICAL_WRIM_0 = TRAINED_RESEARCH_ARTIFACT',
    'CURRENT_PRODUCTION_WRIM = NOT_IMPLEMENTED',
    'RAEL = NOT_IMPLEMENTED',
    'CURRENT_MODEL_TRAINING = NOT_RUNNING',
    'QWEN = THIRD_PARTY_MODEL_RUNNING_LOCALLY',
    'WRIM-1 RUN-000001 = REAL TRAINING, COLLAPSED, PROMOTION REJECTED',
    'WRIM1-RUN-000002 = REAL PARTIAL TRAINING, FAILED, NOT PROMOTED',
    'RECOVERY EXPERIMENTS = TEST_ONLY',
    'RAG != TRAINING',
    '#22 = CLOSED',
    '#23 = ACTIVE',
  ]
}
