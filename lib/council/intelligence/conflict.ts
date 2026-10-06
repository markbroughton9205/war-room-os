/**
 * Disagreement resolution. Aurora must not invent consensus.
 * Unresolved disagreement is a valid final state.
 */

import type { EbcMissionResult } from '@/lib/council/evidence-board/types'
import type { ConflictRecord } from './orchestrationTypes'

export function resolveConflicts(input: {
  ebc: EbcMissionResult | null
  injected?: Array<{ claim: string; evidenceA: string[]; evidenceB: string[] }>
}): ConflictRecord[] {
  const out: ConflictRecord[] = []
  if (input.ebc) {
    const contradicted = input.ebc.board.claims.filter(c => c.status === 'CONTRADICTED')
    for (const claim of contradicted) {
      out.push(conflict({
        disputed_claim: claim.text,
        kind: 'FACTUAL',
        evidence_a: claim.evidence_ids.slice(0, 1),
        evidence_b: claim.evidence_ids.slice(1, 2),
        lumen_verdict: 'UNRESOLVED',
        phoenix_invoked: input.ebc.phoenix.length > 0,
      }))
    }
  }
  for (const row of input.injected ?? []) {
    out.push(conflict({
      disputed_claim: row.claim,
      kind: 'FACTUAL',
      evidence_a: row.evidenceA,
      evidence_b: row.evidenceB,
      lumen_verdict: 'NEEDS_DISCRIMINATING_EVIDENCE',
      phoenix_invoked: true,
    }))
  }
  return out
}

function conflict(partial: Omit<ConflictRecord, 'conflict_id' | 'consensus_invented' | 'unresolved'>): ConflictRecord {
  return Object.freeze({
    conflict_id: `cf-${partial.disputed_claim.slice(0, 12).replace(/\W+/g, '')}`,
    consensus_invented: false,
    unresolved: partial.lumen_verdict === 'UNRESOLVED' || partial.lumen_verdict === 'NEEDS_DISCRIMINATING_EVIDENCE',
    ...partial,
  })
}

export function auroraMayNotInventConsensus(conflicts: readonly ConflictRecord[]): boolean {
  return conflicts.every(row => row.consensus_invented === false)
}
