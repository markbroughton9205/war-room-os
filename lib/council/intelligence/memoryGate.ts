/**
 * Mission/project Memory Gate.
 * Extends existing memory-write-gate + nebula scopes. Speculative model output is not project truth.
 * Does not claim learning.
 */

import { decideMemoryCandidatePrompt } from '@/lib/council/live-orchestration/memoryCandidateGate'
import { MEMORY_GATE_SCHEMA, type MemoryCandidate, type MemoryDecision, type MemoryGateResult, type TruthState } from './types'

export function gateMemoryFact(candidate: MemoryCandidate, commanderText: string): {
  decision: MemoryDecision
  reason: string
  scope: MemoryGateResult['decisions'][number]['scope']
} {
  if (candidate.sensitivity === 'SECRET') {
    return { decision: 'REJECTED', reason: 'Secret material is never stored in mission/project memory.', scope: null }
  }
  if (candidate.speculative || candidate.truth_state === 'UNKNOWN' || candidate.source_quality === 'INFERRED') {
    return { decision: 'EPHEMERAL', reason: 'Speculative or inferred output is not durable project truth.', scope: 'SESSION' }
  }
  if (candidate.temporal_state === 'SUPERSEDED' || candidate.temporal_state === 'HISTORICAL' || candidate.temporal_state === 'STALE') {
    return { decision: 'SUPERSEDED', reason: 'Historical/stale fact is retained as history, not current project truth.', scope: 'MISSION' }
  }
  if (candidate.truth_state === 'CONFLICTED') {
    return { decision: 'MISSION_ONLY', reason: 'Conflicted fact stays mission-scoped until resolved by evidence.', scope: 'MISSION' }
  }
  const prompt = decideMemoryCandidatePrompt({ commanderText, anySuccess: true })
  if (!prompt.durable && candidate.scope === 'SESSION') {
    return { decision: 'EPHEMERAL', reason: prompt.reason, scope: 'SESSION' }
  }
  if (candidate.truth_state === 'VERIFIED' && (candidate.source_quality === 'LIVE_TELEMETRY' || candidate.source_quality === 'TOOL_RESULT' || candidate.source_quality === 'PRIMARY_EXTERNAL')) {
    if (candidate.scope === 'PROJECT' || prompt.durable) {
      return { decision: 'PROJECT_CANDIDATE', reason: 'Verified, useful, temporally current. Candidate only — not auto-promoted. Not learning.', scope: 'PROJECT' }
    }
    return { decision: 'MISSION_ONLY', reason: 'Verified for this mission. Not automatically project memory.', scope: 'MISSION' }
  }
  if (candidate.truth_state === 'SUPPORTED' || candidate.truth_state === 'PARTIALLY_SUPPORTED') {
    return { decision: 'MISSION_ONLY', reason: 'Supported but not fully verified. Mission-scoped only.', scope: 'MISSION' }
  }
  return { decision: 'REJECTED', reason: 'Does not meet stability/evidence/usefulness bar.', scope: null }
}

export function gateMissionMemory(input: {
  missionId: string
  commanderText: string
  candidates: readonly MemoryCandidate[]
}): MemoryGateResult {
  return Object.freeze({
    schema: MEMORY_GATE_SCHEMA,
    mission_id: input.missionId,
    decisions: input.candidates.map(candidate => {
      const gated = gateMemoryFact(candidate, input.commanderText)
      return { fact_id: candidate.fact_id, decision: gated.decision, reason: gated.reason, scope: gated.scope }
    }),
  })
}

export function rememberableTruth(state: TruthState): boolean {
  return state === 'VERIFIED' || state === 'SUPPORTED'
}
