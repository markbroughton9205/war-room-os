import type {
  EvidenceConfidenceTier,
  EvidenceFreshness,
  IntelligenceEvidenceItem,
  IntelligenceSourceFailure,
} from '@/lib/intelligence/intelligencePacket'
import type { OldVsNewComparison } from '@/lib/intelligence/comparison/oldVsNew'
import type { ResearchDomain } from '@/lib/research/researchDomainRouter'
import type { CouncilSwarmPersistence } from '@/lib/council/scout-swarm/types'

export type StoredResearchPacket = {
  id: string
  decree: string
  createdAt: string
  conversationId?: string | null
  roundRequestId?: string | null
  logicalRequestId?: string | null
  domain?: ResearchDomain | string
  evidence: IntelligenceEvidenceItem[]
  sourceFailures: IntelligenceSourceFailure[]
  comparison?: OldVsNewComparison
  verifiedSummary: string
  summarySource: 'research_packet_findings' | 'aurora_synthesis'
  queryClassification?: string
  freshness: EvidenceFreshness
  confidence: number
  confidenceTier: EvidenceConfidenceTier
  contradictions: string[]
  unsupportedClaims: string[]
  gaps: string[]
  origin_type: 'STORED_RESEARCH'
  /** Build #5 additive Council swarm packet. Absent on Build #4B-only records. */
  councilSwarm?: CouncilSwarmPersistence
}

export type StoredResearchWriteResult = {
  ok: boolean
  id?: string
  backend: 'local' | 'supabase' | 'none'
  error?: string
}

export type StoredResearchReadResult = {
  ok: boolean
  packets: StoredResearchPacket[]
  backend: 'local' | 'supabase' | 'none'
  error?: string
  note?: string
}
