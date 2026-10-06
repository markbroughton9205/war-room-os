/**
 * LUMEN verification scheduler. Verify material claims first, not every sentence.
 */

import type { EbcMissionResult } from '@/lib/council/evidence-board/types'
import type { VerificationPriority } from './orchestrationTypes'

export function scheduleVerification(ebc: EbcMissionResult | null): VerificationPriority[] {
  if (!ebc) return []
  return ebc.board.claims.map(claim => {
    const thin = claim.evidence_ids.length < 2
    const unverified = claim.status === 'UNVERIFIED' || claim.status === 'PROPOSED'
    const contradicted = claim.status === 'CONTRADICTED'
    const impact: VerificationPriority['impact'] = contradicted || claim.critical ? 'HIGH' : thin ? 'MED' : 'LOW'
    const uncertainty: VerificationPriority['uncertainty'] = contradicted || unverified ? 'HIGH' : thin ? 'MED' : 'LOW'
    const score =
      (impact === 'HIGH' ? 4 : impact === 'MED' ? 2 : 0)
      + (uncertainty === 'HIGH' ? 3 : uncertainty === 'MED' ? 1 : 0)
      + (thin ? 2 : 0)
      + (claim.temporal_layer === 'CURRENT_LIVE' ? 1 : 0)
    return {
      claim_id: claim.claim_id,
      impact,
      uncertainty,
      novelty: /new|first|latest/i.test(claim.text),
      temporal_sensitivity: claim.temporal_layer === 'CURRENT_LIVE',
      decision_relevance: claim.critical === true,
      evidence_thinness: thin,
      score,
      verify: score >= 3 || contradicted || claim.critical === true,
    }
  }).sort((a, b) => b.score - a.score)
}

export function materialOnly(rows: readonly VerificationPriority[]): VerificationPriority[] {
  return rows.filter(row => row.verify)
}
