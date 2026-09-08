import { classifyEvidenceFreshness } from '@/lib/intelligence/freshnessPolicy'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import type { KimiWaveChunk } from '@/lib/intelligence/kimiWaves/parser'

export function kimiChunkToEvidence(chunk: KimiWaveChunk, nowIso: string): IntelligenceEvidenceItem {
  const freshness = classifyEvidenceFreshness({
    originType: 'KIMI_WAVE',
    nowIso,
    artifactAt: chunk.artifactAt,
  })
  return {
    id: chunk.id,
    source_id: `kimi-wave-${chunk.wave}`,
    source_type: 'direct_fetch',
    source_label: `Kimi Wave ${chunk.wave} · ${chunk.sourceFile}`,
    verified_level: 'unverified',
    title: chunk.section,
    ...(chunk.urls[0] ? { url: chunk.urls[0] } : {}),
    claim: chunk.section,
    content: chunk.text.slice(0, 1600),
    observed_at: chunk.artifactAt,
    confidence: 0.22,
    confidence_tier: 'weak_signal',
    corroboration_count: 0,
    freshness,
    source_reputation: 0.35,
    contradiction_flags: [],
    evidence_density: Math.min(1, chunk.text.length / 900),
    related_evidence_links: [],
    weak_signal: true,
    origin_type: 'KIMI_WAVE',
  }
}
