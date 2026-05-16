import type { IntelligenceClientMetadata } from '@/lib/intelligence/intelligencePacket'

export type IntelligenceNewsCard = {
  id: string
  title: string
  sourceName: string
  imageUrl?: string
  timestampLabel: string
  confidenceLabel: string
  badge: 'verified' | 'corroborated' | 'emerging' | 'weak_signal' | 'contradictory' | 'unsupported'
  detail: string
}

export function buildNewsCardsFromIntelligence(metadata: IntelligenceClientMetadata | undefined): IntelligenceNewsCard[] {
  if (!metadata || metadata.sourcesUsed === 0) return []
  const sources = metadata.sourcesPreview
    ? metadata.sourcesPreview.split(',').map(source => source.trim()).filter(Boolean)
    : metadata.sourceLabels

  return sources.slice(0, 3).map((source, index) => ({
    id: `${metadata.packetId}-card-${index}`,
    title: index === 0 ? 'Latest source-backed intelligence' : 'Supporting intelligence source',
    sourceName: source,
    timestampLabel: metadata.freshness,
    confidenceLabel: metadata.confidenceLevel,
    badge: metadata.confidenceLevel,
    detail: 'Image thumbnail appears only when source-backed media metadata is available.',
  }))
}
