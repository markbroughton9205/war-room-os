export const WRIM1_RUN_ID = 'WRIM1-RUN-000001'
export const HARDENED_CORPUS_SHA = '76ddac51d8132b375e541723045f89714fe060d04a88a5ef51373319d4cdbd27'
export const WR_TOKENIZER_0_SHA = '47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7'
export const WRIM0_CHECKPOINT_SHA = 'd1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015'

export type AuthorizationState =
  | 'NOT_READY'
  | 'READY'
  | 'AWAITING_COMMANDER_AUTHORIZATION'
  | 'AUTHORIZED'
  | 'TRAINING'
  | 'COMPLETED'
  | 'FAILED'

export type PromotionState =
  | 'TRAINING_NOT_STARTED'
  | 'TRAINING'
  | 'TRAINED'
  | 'EVALUATING'
  | 'EVALUATED'
  | 'PROMOTION_RECOMMENDED'
  | 'PROMOTION_REJECTED'
  | 'AWAITING_COMMANDER_PROMOTION'
  | 'PROMOTED'

export type EstimateClass = 'MEASURED' | 'DERIVED' | 'SPECULATIVE'

export type ComparisonRow = {
  evalId: string
  capability: string
  wrim0Result: number | null
  wrim0Support: 'SUPPORTED' | 'UNSUPPORTED'
  wrim1Result: 'NOT_RUN'
  delta: null
  improvement: false
  regression: false
  unsupported: boolean
  evidenceRefs: string[]
}

export type PythonProof = {
  expected: number
  total: number
  passed: number
  failed: Array<{ name: string; ok: boolean; detail?: string }>
  results: Array<{ name: string; ok: boolean; detail?: string }>
  official_training_started: boolean
  test_only: boolean
}
