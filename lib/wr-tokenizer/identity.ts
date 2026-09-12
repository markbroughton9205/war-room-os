/**
 * #23 WR-TOKENIZER — one architecture. Historical version WR-TOKENIZER-0.
 * No Tokenizer2 / WRTokenizer2 / RaelTokenizer / WRIMTokenizer.
 * Training remains NOT_STARTED. Vocab is frozen. No silent mutation.
 */
export const WR_TOKENIZER_ARCHITECTURE_ID = 'WR_TOKENIZER' as const
export const WR_TOKENIZER_RUNTIME_VERSION = 'wr-tokenizer-v1' as const
export const HISTORICAL_WR_TOKENIZER_ID = 'WR-TOKENIZER-0' as const

export const HISTORICAL_WR_TOKENIZER_0_SHA256 =
  '47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7' as const
export const HISTORICAL_WR_TOKENIZER_0_STATUS = 'TRAINED_VALIDATED' as const
export const HISTORICAL_WR_TOKENIZER_0_USED_BY = ['WRIM-0', 'WRIM-1'] as const

export const HISTORICAL_VOCAB_REQUESTED = 16384 as const
export const HISTORICAL_VOCAB_PRODUCED = 15126 as const
export const HISTORICAL_ALGORITHM = 'BPE' as const
export const HISTORICAL_FORMAT = 'HuggingFace tokenizer.json' as const

export const EXPECTED_SPECIAL_TOKENS = [
  { id: 0, token: '<|pad|>' },
  { id: 1, token: '<|bos|>' },
  { id: 2, token: '<|eos|>' },
  { id: 3, token: '<|unk|>' },
  { id: 4, token: '<|system|>' },
  { id: 5, token: '<|commander|>' },
  { id: 6, token: '<|assistant|>' },
  { id: 7, token: '<|tool|>' },
  { id: 8, token: '<|evidence|>' },
] as const

/** Training lane — still not running. Distinct from artifact reconciliation. */
export const WR_TOKENIZER_TRAINING_STATUS = 'NOT_STARTED' as const
export const WR_TOKENIZER_STATUS = 'NOT_STARTED' as const

export const WR_TOKENIZER_RECONCILIATION = 'COMPLETE' as const
export const CURRENT_WR_TOKENIZER_LANE = 'RECONCILED' as const
export const CURRENT_WR_TOKENIZER = 'WR-TOKENIZER-0' as const
export const CURRENT_WR_TOKENIZER_PROMOTION = 'CANONICAL_HISTORICAL_KEPT_FOR_LINEAGE' as const

export type WrTokenizerRecommendation =
  | 'KEEP_WR_TOKENIZER_0'
  | 'KEEP_AND_EXTEND_LATER'
  | 'TRAIN_WR_TOKENIZER_1'
  | 'DUAL_LINEAGE_REQUIRED'

export const WR_TOKENIZER_RECOMMENDATION: WrTokenizerRecommendation = 'KEEP_AND_EXTEND_LATER'

export const FORBIDDEN_TOKENIZER_ARCHITECTURES = [
  'Tokenizer2',
  'WRTokenizer2',
  'RaelTokenizer',
  'WRIMTokenizer',
] as const

export const DUMP_TOKENIZER_RELATIVE = [
  'model-lab',
  'manifests',
  'wrim0_tokenizer_v16384',
  'tokenizer.json',
] as const

export const DUMP_TOKENIZER_MANIFEST_RELATIVE = [
  'model-lab',
  'manifests',
  'wrim0_tokenizer_v16384',
  'training-manifest.json',
] as const

export const WRIM0_LINEAGE_RELATIVE = [
  'model-lab',
  'manifests',
  'wrim0_checkpoints',
  'lineage-manifest.json',
] as const

export const WRIM1_RUN_MANIFEST_RELATIVE = [
  'model-lab',
  'manifests',
  'wrim1_checkpoints',
  'checkpoint-step-001893',
  'run-manifest.json',
] as const

export const WRIM0_VOCAB_SIZE = 15126 as const
export const WRIM0_D_MODEL = 256 as const

export function wrTokenizerTruthNotes(): string[] {
  return [
    'WR-TOKENIZER-0 = HISTORICAL TRAINED + VALIDATED ARTIFACT',
    'USED BY: WRIM-0, WRIM-1 lineage',
    `SHA-256 = ${HISTORICAL_WR_TOKENIZER_0_SHA256}`,
    `VOCAB = ${HISTORICAL_VOCAB_PRODUCED} (requested ${HISTORICAL_VOCAB_REQUESTED})`,
    `CURRENT_WR_TOKENIZER = ${CURRENT_WR_TOKENIZER}`,
    `WR_TOKENIZER_RECONCILIATION = ${WR_TOKENIZER_RECONCILIATION}`,
    `RECOMMENDATION = ${WR_TOKENIZER_RECOMMENDATION}`,
    'WR_TOKENIZER training = NOT_STARTED',
    'No Train button. No vocab mutation. No WRIM training. No Ra\'el.',
    '#22 = CLOSED',
    '#23 = ACTIVE',
  ]
}
