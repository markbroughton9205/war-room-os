/**
 * ENGINE-07 Deliberation. Evidence-first. Majority is not truth. Aurora cannot invent consensus.
 */
import { ENGINE_07_VERSION } from '../types'
import { createEngineReceipt } from '../receipts'
import type { ConflictKind, CouncilPosition, DeliberationCase, DeliberationResult } from './types'

export function classifyConflict(input: {
  factual?: boolean
  temporal?: boolean
  value?: boolean
  risk?: boolean
  missing?: boolean
}): ConflictKind {
  if (input.factual) return 'FACT_CONFLICT'
  if (input.temporal) return 'TEMPORAL_CONFLICT'
  if (input.value) return 'VALUE_TRADEOFF'
  if (input.risk) return 'RISK_TRADEOFF'
  if (input.missing) return 'MISSING_EVIDENCE'
  return 'INTERPRETATION_CONFLICT'
}

export function adjudicatePositions(positions: readonly CouncilPosition[], kind: ConflictKind): {
  winner: CouncilPosition | null
  minority_evidence_wins: boolean
  reason: string
} {
  if (kind === 'VALUE_TRADEOFF' || kind === 'RISK_TRADEOFF') {
    return { winner: null, minority_evidence_wins: false, reason: 'value/risk tradeoff is not a factual resolution' }
  }
  const withEvidence = positions.filter(p => p.supporting_evidence_refs.length > 0)
  const without = positions.filter(p => p.supporting_evidence_refs.length === 0)
  if (without.length > withEvidence.length && withEvidence.length === 1) {
    return { winner: withEvidence[0], minority_evidence_wins: true, reason: 'minority verified evidence beats unsupported majority' }
  }
  if (withEvidence.length === 1) return { winner: withEvidence[0], minority_evidence_wins: false, reason: 'single evidenced position' }
  if (withEvidence.length > 1) return { winner: null, minority_evidence_wins: false, reason: 'FACT_CONFLICT remains open for EBC/LUMEN' }
  return { winner: null, minority_evidence_wins: false, reason: 'MISSING_EVIDENCE' }
}

export function runDeliberation(input: {
  deliberation: DeliberationCase
  positions: CouncilPosition[]
  conflict: ConflictKind
}): DeliberationResult {
  const started = Date.now()
  const adj = adjudicatePositions(input.positions, input.conflict)
  const phoenix = input.positions.find(p => p.role === 'PHOENIX')
  const stop = adj.winner
    ? 'question answered'
    : input.conflict === 'VALUE_TRADEOFF' || input.conflict === 'RISK_TRADEOFF'
      ? 'remaining disagreement is value/risk tradeoff'
      : input.deliberation.budget <= 0
        ? 'budget reached'
        : 'Commander decision required'
  const synthesis = [
    adj.winner ? `verified: ${adj.winner.claim}` : 'no fabricated consensus',
    `uncertainty: ${input.positions.flatMap(p => p.uncertainties).join('; ') || 'none stated'}`,
    phoenix ? `PHOENIX challenge preserved: ${phoenix.claim}` : 'PHOENIX not seated',
    `adjudication: ${adj.reason}`,
    stop === 'Commander decision required' ? 'Commander decision point' : stop,
  ].join('\n')
  return {
    case: input.deliberation,
    positions: input.positions,
    conflict_kind: input.conflict,
    adjudication: adj.reason,
    minority_evidence_wins: adj.minority_evidence_wins,
    majority_is_truth: false,
    stop_reason: stop,
    aurora_synthesis: synthesis,
    invented_consensus: false,
    decision_quality: {
      evidence_coverage: input.positions.filter(p => p.supporting_evidence_refs.length).length / Math.max(1, input.positions.length),
      conflict_resolution: adj.reason,
      unknowns_surfaced: input.positions.flatMap(p => p.uncertainties),
      risk_completeness: input.positions.some(p => p.role === 'SENTINEL') ? 'sentinel_present' : 'sentinel_absent',
      scenario_coverage: input.positions.some(p => p.role === 'JANUS') ? 'janus_present' : 'janus_absent',
      authority_compliance: input.deliberation.authority_constraints.includes('no_spend'),
      opaque_wisdom_score: false,
    },
    grants_authority: false,
    receipt: createEngineReceipt({
      engine: 'deliberation',
      mission_id: input.deliberation.mission_id,
      started_at: started,
      decision_count: input.positions.length,
      decision: `${stop};${ENGINE_07_VERSION};invented_consensus=false`,
    }),
  }
}

