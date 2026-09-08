import { hydrateLiveIntelligencePacket } from '@/lib/intelligence/sources/livePacketHydrator'
import { buildRetrievalOrchestration } from '@/lib/intelligence/sources/retrievalOrchestrator'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import {
  emptyLiveResearchEvidencePacket,
  type LiveResearchEvidencePacket,
  type LiveResearchSourceRecord,
} from '@/lib/runtime/liveResearchEvidencePacket'
import type { SearchCouncilHandoffPayload, SearchResult } from './types'

const MAX_HANDOFF_RESULTS = 20

export function evidenceFromSearchResults(results: SearchResult[]): IntelligenceEvidenceItem[] {
  return results
    .slice(0, MAX_HANDOFF_RESULTS)
    .map(result => {
      if (result.evidence?.id) return result.evidence
      if (!result.id) return null
      return {
        id: result.id,
        source_id: result.sourceFamily ?? result.displayDomain ?? 'search',
        source_type: result.sourceType ?? 'search',
        source_label: result.publisher ?? result.displayDomain ?? 'search',
        verified_level: 'semi_verified',
        title: result.title,
        url: result.url ?? undefined,
        claim: result.title,
        content: result.snippet,
        observed_at: result.observedAt ?? new Date().toISOString(),
        published_at: result.publishedAt ?? undefined,
        confidence: 0.5,
        confidence_tier: 'emerging',
        corroboration_count: result.alsoReportedBy?.count ?? 0,
        freshness: result.freshness ?? 'unknown',
        source_reputation: 0.5,
        contradiction_flags: [],
        evidence_density: 0.3,
        related_evidence_links: [],
        weak_signal: false,
        origin_type: result.originType ?? 'LIVE_WEB',
        source_family: result.sourceFamily,
        canonical_url: result.canonicalUrl,
        content_hash: result.contentHash,
        semantic_cluster_id: result.clusterId,
        region: result.region,
        language: result.language,
        source_authority_class: result.authorityClass,
        primary_source: result.primarySource,
        independence_key: result.independenceKey,
        jurisdiction: result.jurisdiction,
      } satisfies IntelligenceEvidenceItem
    })
    .filter((item): item is IntelligenceEvidenceItem => Boolean(item))
}

export function selectHandoffResults(payload: SearchCouncilHandoffPayload): SearchResult[] {
  const all = payload.results.slice(0, MAX_HANDOFF_RESULTS)
  if (!payload.resultIds?.length) return all
  const wanted = new Set(payload.resultIds)
  const selected = all.filter(result => wanted.has(result.id))
  return selected.length ? selected : all
}

/**
 * Convert War Room Search results into the existing live-research evidence packet so Council
 * (PULSAR/LUMEN/PHOENIX/AURORA) consumes structured Build #6 evidence rather than a concatenated
 * transcript. Does not invoke a parallel Council runtime.
 */
export function buildSearchHandoffEvidencePacket(payload: SearchCouncilHandoffPayload): LiveResearchEvidencePacket {
  const query = payload.query.trim()
  const generatedAt = new Date().toISOString()
  if (!query) return emptyLiveResearchEvidencePacket(generatedAt, 'Search handoff missing query.')

  const results = selectHandoffResults(payload)
  const evidence = evidenceFromSearchResults(results)
  if (!evidence.length) {
    return emptyLiveResearchEvidencePacket(generatedAt, 'Search handoff contained no structured evidence.')
  }

  const urls = results.map(result => result.url).filter((url): url is string => Boolean(url))
  const sources: LiveResearchSourceRecord[] = [{
    kind: 'research_engine_bridge',
    ok: evidence.length > 0,
    queriedAt: generatedAt,
    urls: urls.slice(0, 12),
    note: 'war_room_search_handoff',
  }]
  const tavilyUrls = results.filter(result => result.evidence.source_id === 'tavily').map(result => result.url).filter((url): url is string => Boolean(url))
  const rssUrls = results.filter(result => result.evidence.source_id === 'public_news_rss').map(result => result.url).filter((url): url is string => Boolean(url))
  if (tavilyUrls.length) {
    sources.push({ kind: 'tavily', ok: true, queriedAt: generatedAt, urls: tavilyUrls.slice(0, 8), note: 'war_room_search_handoff' })
  }
  if (rssUrls.length) {
    sources.push({ kind: 'public_rss', ok: true, queriedAt: generatedAt, urls: rssUrls.slice(0, 8), note: 'war_room_search_handoff' })
  }

  const retrieval = buildRetrievalOrchestration({
    decree: query,
    generatedAt,
    tavilyOk: evidence.some(item => item.origin_type === 'LIVE_WEB'),
    grokOk: false,
    directOk: false,
  })
  const intelligencePacket = hydrateLiveIntelligencePacket({
    decree: query,
    timestamp: generatedAt,
    rawSources: [],
    extraEvidence: evidence,
    unsupportedClaims: [],
    retrieval,
  })
  intelligencePacket.evidence = evidence
  intelligencePacket.sources_used = [...new Set(evidence.map(item => item.source_id))]
  intelligencePacket.gaps = intelligencePacket.gaps.filter(gap => !/search handoff/i.test(gap))

  const findings = evidence
    .slice(0, 8)
    .map(item => `${item.title} (${item.source_label}${item.url ? `; ${item.url}` : ''})`)
    .join('\n')

  return {
    usedLiveResearch: true,
    generatedAt,
    sources,
    findings: findings || 'Search evidence attached. Do not invent URLs or federal rules not present in the packet.',
    confidence: Math.min(0.86, 0.35 + evidence.length * 0.06),
    freshness: evidence.some(item => item.freshness === 'live' || item.freshness === 'recent') ? 'recent' : 'unknown',
    contradictions: [],
    unresolvedQuestions: [],
    intelligencePacket,
    honestyNotes: [
      'Evidence originated from War Room Search retrieval, not a new parallel research engine.',
      'Preserve origin_type, canonical_url, content_hash, source_family, cluster identity, and independence_key.',
    ],
  }
}

export function isSearchHandoffBody(value: unknown): value is SearchCouncilHandoffPayload {
  if (!value || typeof value !== 'object') return false
  const rec = value as Record<string, unknown>
  return typeof rec.query === 'string' && Array.isArray(rec.results)
}
