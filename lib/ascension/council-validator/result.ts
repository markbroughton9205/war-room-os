/**
 * #22 Phase 7 — Council validator result + claim contracts. No hidden CoT.
 */
import type { CouncilValidatorIdentity } from './identity'
import type { CouncilValidatorScope } from './scope'

export const COUNCIL_CLAIM_VALIDATION_STATES = [
  'PASS',
  'PASS_WITH_LIMITATIONS',
  'FAIL',
  'PARTIAL',
  'INSUFFICIENT_EVIDENCE',
  'CONFLICTING_EVIDENCE',
  'STALE_EVIDENCE',
  'POLICY_CONFLICT',
  'RUNTIME_TRUTH_CONFLICT',
  'OWNERSHIP_DENIED',
  'NOT_IMPLEMENTED',
  'UNAVAILABLE',
] as const
export type CouncilClaimValidationState = (typeof COUNCIL_CLAIM_VALIDATION_STATES)[number]

export const COUNCIL_VALIDATOR_STATUSES = [
  'COMPLETE',
  'PARTIAL',
  'DEGRADED',
  'FAILED',
  'DENIED',
] as const
export type CouncilValidatorStatus = (typeof COUNCIL_VALIDATOR_STATUSES)[number]

export const COUNCIL_CORRECTION_RECOMMENDATIONS = [
  'REVISE_CLAIM',
  'LOWER_CONFIDENCE',
  'ADD_LIMITATION',
  'MARK_STALE',
  'MARK_CONFLICTING',
  'REQUEST_MORE_EVIDENCE',
  'CORRECT_RUNTIME_TRUTH',
  'REMOVE_UNSUPPORTED_ASSERTION',
] as const
export type CouncilCorrectionRecommendation = (typeof COUNCIL_CORRECTION_RECOMMENDATIONS)[number]

export type ValidatedClaim = {
  claim_id: string
  claim_text_summary: string
  claim_type: string
  evidence_refs: string[]
  support_state: string
  freshness_state: string
  confidence_state: string
  conflicts: string[]
  policy_state: string
  runtime_truth_state: string
  validation_result: CouncilClaimValidationState
  limitations: string[]
}

export type CouncilValidatorDenial = {
  capability_or_action: string
  reason_code: string
  reason: string
}

export type CouncilValidatorResult = {
  agent_id: string
  agent_role: 'COUNCIL_VALIDATOR'
  status: CouncilValidatorStatus
  conversation_id: string
  round_id: string | null
  validation_summary: string
  claims_checked: ValidatedClaim[]
  evidence_summary: string
  freshness_summary: string
  conflicts: string[]
  policy_conflicts: string[]
  runtime_truth_conflicts: string[]
  ownership_state: string
  limitations: string[]
  recommended_corrections: CouncilCorrectionRecommendation[]
  requires_council_revision: boolean
  requires_commander_review: boolean
  /** Explicit separation: validation PASS never implies execution authorization. */
  validation_pass: boolean
  execution_authorized: false
  denials: CouncilValidatorDenial[]
  audit_id: string | null
  started_at: string
  completed_at: string
  scope: CouncilValidatorScope
  identity: CouncilValidatorIdentity
  boundary_notes: readonly string[]
  plan_summary: string
  session_intelligence_mutated: false
  deliberation_pipeline_replaced: false
  revision_requests: number
  max_revision_requests: number
}

export const COUNCIL_VALIDATOR_BOUNDARY_NOTES = Object.freeze([
  'COUNCIL_VALIDATOR != COUNCIL MEMBER',
  'COUNCIL_VALIDATOR != EXECUTOR',
  'VALIDATION PASS != ACTION AUTHORIZATION',
  'VALIDATION FAIL != AUTOMATIC RETRY / REPAIR',
  'VALIDATED != AUTHORIZED',
  'TERRA FINDING != ACTION AUTHORIZATION',
  'ASTRA MISSION != ACTION AUTHORIZED',
  'COUNCIL RECOMMENDATION != COMMANDER APPROVAL',
  'PATCH READY != COMMITTED',
  'BUILD PASS != DEPLOYED',
  'NO ACTION AUTHORITY',
  'ASCENSION AUTONOMY OFF',
  '#16 DELIBERATION NOT REPLACED',
  '#17 SESSION INTELLIGENCE NOT MUTATED',
] as const)

export function makeValidatedClaim(
  partial: Omit<ValidatedClaim, 'claim_id'> & { claim_id?: string },
): ValidatedClaim {
  return {
    claim_id: partial.claim_id ?? `claim_${Math.random().toString(36).slice(2, 10)}`,
    claim_text_summary: partial.claim_text_summary,
    claim_type: partial.claim_type,
    evidence_refs: partial.evidence_refs,
    support_state: partial.support_state,
    freshness_state: partial.freshness_state,
    confidence_state: partial.confidence_state,
    conflicts: partial.conflicts,
    policy_state: partial.policy_state,
    runtime_truth_state: partial.runtime_truth_state,
    validation_result: partial.validation_result,
    limitations: partial.limitations,
  }
}
