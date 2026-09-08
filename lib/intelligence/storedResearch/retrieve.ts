import { classifyEvidenceFreshness } from '@/lib/intelligence/freshnessPolicy'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { relevanceScore } from '@/lib/intelligence/relevance'
import { loadAllStoredResearchPackets } from '@/lib/intelligence/storedResearch/store'
import type { StoredResearchPacket, StoredResearchReadResult } from '@/lib/intelligence/storedResearch/types'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

export type StoredResearchHit = {
  packet: StoredResearchPacket
  score: number
}

export async function retrieveStoredResearch(
  query: string,
  opts?: { supabase?: WarRoomSupabase | null; limit?: number; nowIso?: string },
): Promise<StoredResearchReadResult & { hits: StoredResearchHit[] }> {
  const loaded = await loadAllStoredResearchPackets(opts?.supabase)
  if (!loaded.ok) return { ...loaded, hits: [] }
  const nowIso = opts?.nowIso ?? new Date().toISOString()
  const hits = loaded.packets
    .map(packet => ({
      packet: withCurrentFreshness(packet, nowIso),
      score: relevanceScore(
        query,
        `${packet.decree}\n${packet.verifiedSummary}\n${packet.evidence.map(item => item.claim).join('\n')}`,
      ),
    }))
    .filter(hit => hit.score >= 0.22)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts?.limit ?? 5)

  if (!hits.length) {
    return {
      ...loaded,
      hits: [],
      note: loaded.note ?? 'No relevant stored War Room research matched this mission.',
    }
  }
  return { ...loaded, hits }
}

function withCurrentFreshness(packet: StoredResearchPacket, nowIso: string): StoredResearchPacket {
  return {
    ...packet,
    freshness: classifyEvidenceFreshness({
      originType: 'STORED_RESEARCH',
      nowIso,
      retrievedAt: packet.createdAt,
    }),
  }
}

export function storedPacketToEvidence(
  packet: StoredResearchPacket,
  nowIso: string,
  limit = 6,
): IntelligenceEvidenceItem[] {
  const freshness = classifyEvidenceFreshness({
    originType: 'STORED_RESEARCH',
    nowIso,
    retrievedAt: packet.createdAt,
  })
  return packet.evidence
    .filter(item => item.origin_type === 'LIVE_WEB' || item.origin_type === 'STORED_RESEARCH' || !item.origin_type)
    .slice(0, limit)
    .map((item, index) => ({
      ...item,
      id: `stored-${packet.id}-${item.id}-${index + 1}`,
      origin_type: 'STORED_RESEARCH',
      freshness,
      verified_level: item.verified_level === 'verified' ? 'semi_verified' : item.verified_level,
      confidence_tier: item.confidence_tier === 'verified' ? 'emerging' : item.confidence_tier,
      source_label: `Stored research · ${item.source_label}`,
    }))
}
