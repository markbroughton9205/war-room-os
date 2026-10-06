import type { EngineReceipt } from '../types'
import type { ClaimEvidenceBinding, EvidenceConflict } from '../evidence-binding/types'
import type { SourceAssessment } from '../source-authority/types'

export type CalibrationState =
  | 'HIGH_SUPPORT'
  | 'MODERATE_SUPPORT'
  | 'SINGLE_SOURCE'
  | 'CONFLICTING'
  | 'STALE'
  | 'INSUFFICIENT_EVIDENCE'
  | 'LIVE_VERIFICATION_FAILED'
  | 'PARTIALLY_VERIFIED'
  | 'UNVERIFIED'

export type CalibrationSignals = {
  usable_source_count: number
  independent_source_count: number
  authority_accept_count: number
  primary_source_count: number
  freshness_in_window_count: number
  freshness_required: boolean
  contradiction_count: number
  missing_required_evidence: string[]
  tool_failures: number
  stale_evidence_count: number
  verification_coverage: number
  question_ambiguous: boolean
  cross_model_disagreement: boolean
  source_diversity: number
}

export type CalibrationResult = {
  state: CalibrationState
  reasons: string[]
  commander_facing: string
  signals: CalibrationSignals
  receipt: EngineReceipt
}

export type CalibrationInput = {
  mission_id: string
  prompt?: string
  assessments?: readonly SourceAssessment[]
  bindings?: readonly ClaimEvidenceBinding[]
  conflicts?: readonly EvidenceConflict[]
  tool_failures?: number
  question_ambiguous?: boolean
  cross_model_disagreement?: boolean
}
