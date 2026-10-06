import type { CalibrationResult } from '../calibration/types'
import type { ClaimEvidenceBinding } from '../evidence-binding/types'
import type { AuroraSynthesisV1 } from '@/lib/council/evidence-board/types'

export function auroraConsumeEngines(input: {
  aurora: AuroraSynthesisV1
  calibration?: CalibrationResult | null
  bindings?: readonly ClaimEvidenceBinding[]
}): {
  commander_facing: string[]
  unbound_external_claims_excluded: boolean
  commander_authority: 'REQUIRED_FOR_ACTION'
} {
  const unbound = (input.bindings ?? []).some(row =>
    (row.verification_state === 'VERIFIED' || row.verification_state === 'SUPPORTED') && row.evidence_refs.length === 0,
  )
  const phrases = [
    input.calibration?.commander_facing,
    input.aurora.conflicts.length ? 'sources conflict' : null,
  ].filter((row): row is string => Boolean(row))
  return {
    commander_facing: [...new Set(phrases)],
    unbound_external_claims_excluded: !unbound && input.aurora.verified_facts.every(row => row.evidence_ids.length > 0),
    commander_authority: 'REQUIRED_FOR_ACTION',
  }
}
