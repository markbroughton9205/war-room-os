import type { CalibrationResult } from '../calibration/types'
import type { ClaimEvidenceBinding, EvidenceConflict } from '../evidence-binding/types'
import type { SourceAssessment } from '../source-authority/types'
import type { PhoenixChallengeType } from '@/lib/council/evidence-board/types'

export type PhoenixEngineTarget = {
  claim_id: string
  challenge_type: PhoenixChallengeType
  weakness: string
}

export function phoenixTargetsFromEngines(input: {
  bindings: readonly ClaimEvidenceBinding[]
  assessments?: readonly SourceAssessment[]
  conflicts?: readonly EvidenceConflict[]
  calibration?: CalibrationResult | null
}): PhoenixEngineTarget[] {
  const targets: PhoenixEngineTarget[] = []
  for (const conflict of input.conflicts ?? []) {
    if (conflict.resolution_state !== 'open') continue
    for (const claim_id of conflict.claim_ids) {
      targets.push({
        claim_id,
        challenge_type: 'CONTRADICTION',
        weakness: conflict.reason,
      })
    }
  }
  for (const binding of input.bindings) {
    if (binding.support_type === 'INSUFFICIENT') {
      targets.push({ claim_id: binding.claim_id, challenge_type: 'MISSING_TEST', weakness: 'no usable evidence refs' })
    } else if (binding.source_refs.length <= 1 && binding.verification_state !== 'UNVERIFIED') {
      targets.push({ claim_id: binding.claim_id, challenge_type: 'SINGLE_SOURCE', weakness: 'single independent source' })
    }
  }
  const rejected = (input.assessments ?? []).filter(row => row.decision === 'REJECT_WRONG_AUTHORITY' || row.decision === 'REJECT_STALE' || row.decision === 'DATE_UNKNOWN')
  if (rejected.some(row => row.decision === 'REJECT_WRONG_AUTHORITY') && input.bindings[0]) {
    targets.push({ claim_id: input.bindings[0].claim_id, challenge_type: 'AUTHORITY_RISK', weakness: 'authority gap vs required source class' })
  }
  if (rejected.some(row => row.decision === 'REJECT_STALE' || row.decision === 'DATE_UNKNOWN') && input.bindings[0]) {
    targets.push({ claim_id: input.bindings[0].claim_id, challenge_type: 'STALE_EVIDENCE', weakness: 'freshness gap' })
  }
  if (input.calibration?.state === 'INSUFFICIENT_EVIDENCE' && input.bindings[0]) {
    targets.push({ claim_id: input.bindings[0].claim_id, challenge_type: 'MISSING_TEST', weakness: 'unresolved evidence requirement' })
  }
  const seen = new Set<string>()
  return targets.filter(row => {
    const key = `${row.claim_id}:${row.challenge_type}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
