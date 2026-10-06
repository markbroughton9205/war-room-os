import type { ResearchDiscoveryPlan } from '../research-discovery/types'
import type { SourceAssessment } from '../source-authority/types'
import type { ClaimEvidenceGraph, EvidenceConflict } from '../evidence-binding/types'

export type OrionEnginePacket = {
  discovery_plan: ResearchDiscoveryPlan | null
  candidate_assessments: SourceAssessment[]
  evidence_graph: ClaimEvidenceGraph | null
  open_conflicts: EvidenceConflict[]
  missing_evidence: string[]
}

export function orionConsumeEnginePacket(input: {
  question: string
  plan?: ResearchDiscoveryPlan | null
  assessments?: readonly SourceAssessment[]
  graph?: ClaimEvidenceGraph | null
  conflicts?: readonly EvidenceConflict[]
}): OrionEnginePacket {
  const open = (input.conflicts ?? input.graph?.conflicts ?? []).filter(row => row.resolution_state === 'open')
  const missing = [
    ...(input.plan?.remaining_evidence_gap ?? []),
    ...open.map(row => row.needed_evidence),
  ]
  return {
    discovery_plan: input.plan ?? null,
    candidate_assessments: [...(input.assessments ?? [])],
    evidence_graph: input.graph ?? null,
    open_conflicts: open,
    missing_evidence: [...new Set(missing.filter(Boolean))],
  }
}
