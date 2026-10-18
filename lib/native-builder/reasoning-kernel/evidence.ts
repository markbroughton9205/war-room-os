/**
 * Evidence with provenance. Tool and runtime evidence outrank model assertion.
 */
import type { FoundryEvidence, FrkEvidenceAuthority, FrkEvidenceSource } from './types'
import { clipText } from './text'

const TOOL_SOURCES: readonly FrkEvidenceSource[] = [
  'SOURCE_CODE',
  'FILE_CONTENT',
  'TEST_RESULT',
  'BUILD_RESULT',
  'RUNTIME_OUTPUT',
  'HTTP_RESULT',
  'DATABASE_STATE',
  'DEBUG_STATE',
  'SCM_STATE',
  'STATIC_ANALYSIS',
  'TOOL_OBSERVATION',
]

export function authorityForSource(source: FrkEvidenceSource): FrkEvidenceAuthority {
  if (source === 'MODEL_ASSERTION') return 'MODEL_ASSERTION'
  if (source === 'USER_CONSTRAINT' || source === 'MISSION_CONTRACT') return 'MISSION'
  if (TOOL_SOURCES.includes(source)) return 'TOOL_RUNTIME'
  return 'MISSION'
}

export function createEvidence(input: {
  evidenceId: string
  source: FrkEvidenceSource
  statement: string
  actor: string
  ref: string
  observedAt: string
  supportsHypothesisIds?: string[]
  contradictsHypothesisIds?: string[]
}): { ok: true; evidence: FoundryEvidence } | { ok: false; reason: string } {
  if (!input.actor || !input.ref || !input.observedAt) {
    return { ok: false, reason: 'Evidence requires provenance: actor, ref, and observedAt.' }
  }
  return {
    ok: true,
    evidence: {
      evidenceId: input.evidenceId,
      source: input.source,
      statement: clipText(input.statement),
      provenance: { actor: input.actor, ref: input.ref, observedAt: input.observedAt },
      authority: authorityForSource(input.source),
      supportsHypothesisIds: input.supportsHypothesisIds ?? [],
      contradictsHypothesisIds: input.contradictsHypothesisIds ?? [],
    },
  }
}

export function evidenceOutranks(left: FoundryEvidence, right: FoundryEvidence): boolean {
  const rank: Record<FrkEvidenceAuthority, number> = {
    TOOL_RUNTIME: 3,
    MISSION: 2,
    MODEL_ASSERTION: 1,
  }
  return rank[left.authority] > rank[right.authority]
}
