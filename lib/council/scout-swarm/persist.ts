import type { StoredResearchPacket } from '@/lib/intelligence/storedResearch/types'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { classifyResearchDomain } from '@/lib/research/researchDomainRouter'
import type { CouncilSwarmPersistence, FrozenSeatReport } from './types'

export type { CouncilSwarmPersistence }

export function attachSwarmToStoredPacket(
  packet: StoredResearchPacket,
  swarm: CouncilSwarmPersistence,
): StoredResearchPacket {
  return {
    ...packet,
    summarySource: packet.summarySource ?? 'research_packet_findings',
    councilSwarm: swarm,
  }
}

export function extractSwarmFromStoredPacket(packet: StoredResearchPacket): CouncilSwarmPersistence | null {
  return packet.councilSwarm ?? null
}

export function priorSeatReportsFromPackets(
  packets: StoredResearchPacket[],
  agentId: FrozenSeatReport['agentId'],
): FrozenSeatReport[] {
  return packets.flatMap(packet => (packet.councilSwarm?.reports ?? []).filter(report => report.agentId === agentId))
}

export function swarmPacketStub(input: {
  decree: string
  evidence: IntelligenceEvidenceItem[]
  swarm: CouncilSwarmPersistence
  nowIso?: string
}): StoredResearchPacket {
  const createdAt = input.nowIso ?? new Date().toISOString()
  const aurora = input.swarm.reports.find(report => report.agentId === 'aurora')
  return attachSwarmToStoredPacket({
    id: `stored-swarm-${input.swarm.missionId}`,
    decree: input.decree,
    createdAt,
    conversationId: null,
    roundRequestId: input.swarm.astraMission.roundRequestId,
    logicalRequestId: input.swarm.astraMission.logicalRequestId,
    domain: classifyResearchDomain(input.decree),
    evidence: input.evidence.filter(item => item.origin_type === 'LIVE_WEB' || item.origin_type === 'KIMI_WAVE' || item.origin_type === 'STORED_RESEARCH'),
    sourceFailures: [],
    verifiedSummary: (aurora?.conclusion || input.swarm.reports.map(item => item.conclusion).join('\n')).slice(0, 4000),
    summarySource: aurora ? 'aurora_synthesis' : 'research_packet_findings',
    queryClassification: classifyResearchDomain(input.decree),
    freshness: 'live',
    confidence: aurora?.confidence ?? 0.5,
    confidenceTier: 'emerging',
    contradictions: input.swarm.reports.flatMap(item => item.contradictions),
    unsupportedClaims: input.swarm.reports.flatMap(item => item.unanswered_questions),
    gaps: [],
    origin_type: 'STORED_RESEARCH',
  }, input.swarm)
}
