import { hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'
import type { EvidenceDiscoveryProvider, IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'

export const EVIDENCE_DISCOVERY_PROVIDERS = [
  'GOOGLE',
  'TAVILY',
  'RESEARCH_ENGINE',
  'RSS',
  'SEARXNG',
  'WAR_ROOM_LOCAL',
  'COMMANDER',
] as const satisfies readonly EvidenceDiscoveryProvider[]

export function isEvidenceDiscoveryProvider(value: unknown): value is EvidenceDiscoveryProvider {
  return typeof value === 'string' && (EVIDENCE_DISCOVERY_PROVIDERS as readonly string[]).includes(value)
}

const RESEARCH_ENGINE_SOURCE_IDS = new Set([
  'tavily',
  'google_web_search',
  'searxng',
  'war_room_local',
  'public_news_rss',
  'direct_fetch',
  'x_twitter_discussions',
  'nws_weather_alerts',
  'firecrawl',
])

export function discoveryProviderFromSourceId(sourceId: string | null | undefined): EvidenceDiscoveryProvider | null {
  if (!sourceId) return null
  if (sourceId === 'google_web_search') return 'GOOGLE'
  if (sourceId === 'tavily') return 'TAVILY'
  if (sourceId === 'searxng') return 'SEARXNG'
  if (sourceId === 'war_room_local') return 'WAR_ROOM_LOCAL'
  if (sourceId === 'public_news_rss') return 'RSS'
  if (RESEARCH_ENGINE_SOURCE_IDS.has(sourceId)) return null
  return 'RESEARCH_ENGINE'
}

/**
 * Stamp discovery-provider provenance without changing publisher / source family.
 * `discovered_via` is which search service found the page, not who authored it.
 */
export function stampDiscoveryProvenance(items: IntelligenceEvidenceItem[]): IntelligenceEvidenceItem[] {
  return items.map(item => {
    const discovered_via = item.discovered_via ?? discoveryProviderFromSourceId(item.source_id)
    const host = hostnameFromUrl(item.url) ?? hostnameFromUrl(item.canonical_url)
    const genericDiscoveryLabel = (item.source_id === 'google_web_search' && (!item.source_label || /google/i.test(item.source_label)))
      || (item.source_id === 'searxng' && (!item.source_label || /searx/i.test(item.source_label)))
      || (item.source_id === 'war_room_local' && (!item.source_label || /war\s*room/i.test(item.source_label)))
    return {
      ...item,
      discovered_via,
      source_label: genericDiscoveryLabel && host ? host : item.source_label,
    }
  })
}
