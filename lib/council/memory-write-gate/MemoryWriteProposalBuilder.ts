import type {
  MemoryConfidence,
  MemoryEvidence,
  MemoryProposedBy,
  MemoryRiskLevel,
  MemoryScope,
  MemorySource,
  MemoryType,
  PrivacySensitivity,
  MemoryWriteProposal,
} from './types'

export type MemoryWriteProposalBuilderInput = {
  proposalId: string
  source: MemorySource
  proposedBy: MemoryProposedBy
  memoryType: MemoryType
  memoryScope: MemoryScope
  targetEntityId?: string | null
  content: string
  rationale: string
  evidence?: MemoryEvidence[]
  confidence?: MemoryConfidence
  riskLevel?: MemoryRiskLevel
  privacySensitivity?: PrivacySensitivity
  proposedAt: string
}

export class MemoryWriteProposalBuilder {
  build(input: MemoryWriteProposalBuilderInput): MemoryWriteProposal {
    return {
      proposalId: input.proposalId,
      source: input.source,
      proposedBy: input.proposedBy,
      memoryType: input.memoryType,
      memoryScope: input.memoryScope,
      targetEntityId: input.targetEntityId ?? null,
      content: input.content.trim(),
      rationale: input.rationale.trim(),
      evidence: input.evidence ?? [],
      confidence: input.confidence ?? (input.evidence?.length ? 'medium' : 'low'),
      riskLevel: input.riskLevel ?? 'medium',
      privacySensitivity: input.privacySensitivity ?? 'medium',
      proposedAt: input.proposedAt,
    }
  }
}

