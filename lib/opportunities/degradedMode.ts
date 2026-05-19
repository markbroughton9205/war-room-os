import type { LiveResearchEvidencePacket } from '@/lib/runtime/liveResearchEvidencePacket'
import type { OpportunityEvidenceLabel } from '@/lib/opportunities/schema'

export function liveSignalsAvailable(packet?: LiveResearchEvidencePacket): boolean {
  if (!packet?.usedLiveResearch) return false
  const sources = packet.sources ?? []
  if (sources.some(s => s.ok && (s.urls?.length ?? 0) > 0)) return true
  return packet.findings.trim().length > 24 && packet.confidence >= 0.35
}

export function resolveOpportunityEvidenceLabel(liveAvailable: boolean): OpportunityEvidenceLabel {
  return liveAvailable ? 'LIVE_SIGNAL_BACKED' : 'HISTORICAL_PATTERN_BASED'
}

export function labelOpportunitiesForEvidence<T extends { evidenceLabel: OpportunityEvidenceLabel }>(
  items: T[],
  liveAvailable: boolean,
): T[] {
  const label = resolveOpportunityEvidenceLabel(liveAvailable)
  return items.map(item => ({ ...item, evidenceLabel: label }))
}
