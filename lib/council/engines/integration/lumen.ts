import { canMarkExternallySupported, canPromoteToVerified } from '../evidence-binding/engine'
import type { CalibrationState } from '../calibration/types'
import type { EbcClaim, EbcEvidence, EbcMissionClass, LumenVerdict } from '@/lib/council/evidence-board/types'

export function lumenConsumeBinding(input: {
  mission_class: EbcMissionClass
  claim: EbcClaim
  evidence: readonly EbcEvidence[]
  proposed_verdict: LumenVerdict
  evidence_refs?: readonly string[]
  open_conflicts?: boolean
}): { verdict: LumenVerdict; reason: string } {
  if (input.proposed_verdict === 'SUPPORTED' && !canMarkExternallySupported({
    mission_class: input.mission_class,
    claim: input.claim,
    evidence: input.evidence,
  })) {
    return { verdict: 'UNKNOWN', reason: 'no_usable_sources' }
  }
  if (input.proposed_verdict === 'SUPPORTED' && input.open_conflicts) {
    return { verdict: 'CONTRADICTED', reason: 'open_conflict' }
  }
  return { verdict: input.proposed_verdict, reason: 'engine_binding_allows' }
}

export function lumenRefuseModelOnlyPromotion(input: {
  mission_class: EbcMissionClass
  claim: EbcClaim
  evidence: readonly EbcEvidence[]
  open_conflicts: boolean
}): boolean {
  return !canPromoteToVerified({
    mission_class: input.mission_class,
    claim: input.claim,
    evidence: input.evidence,
    lumen_verdict: 'SUPPORTED',
    evidence_refs: input.claim.evidence_ids,
    open_conflicts: input.open_conflicts,
  })
}

export function lumenConsumeCalibration(state: CalibrationState): { may_promote: boolean; reason: string } {
  if (state === 'INSUFFICIENT_EVIDENCE' || state === 'LIVE_VERIFICATION_FAILED' || state === 'CONFLICTING' || state === 'STALE') {
    return { may_promote: false, reason: state }
  }
  return { may_promote: true, reason: state }
}
