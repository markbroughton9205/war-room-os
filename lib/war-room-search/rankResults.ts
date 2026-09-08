import type { IntelligenceEvidenceItem, SourceAuthorityClass } from '@/lib/intelligence/intelligencePacket'
import { hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'
import type { SearchAlsoReportedBy, SearchRankBreakdown, SearchResult, SearchSort, SearchSourceTypeFilter } from './types'
import type { NormalizedSearchRequest } from './searchQuery'
import { formatSearchResult } from './formatSearchResult'

const STOP = new Set([
  'the', 'and', 'for', 'that', 'with', 'from', 'this', 'what', 'when', 'where', 'which',
  'into', 'about', 'latest', 'current', 'developments', 'research',
])

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2 && !STOP.has(token))
}

function relevanceToQuery(query: string, item: IntelligenceEvidenceItem): number {
  const tokens = queryTokens(query)
  if (!tokens.length) return 0.2
  const blob = `${item.title} ${item.claim} ${item.content} ${item.source_label}`.toLowerCase()
  let hits = 0
  for (const token of tokens) {
    if (blob.includes(token)) hits += 1
  }
  const title = (item.title ?? '').toLowerCase()
  const titleHits = tokens.filter(token => title.includes(token)).length
  return Math.min(1, hits / tokens.length * 0.72 + titleHits / tokens.length * 0.28)
}

function authorityScore(authority: SourceAuthorityClass | null | undefined): number {
  if (!authority) return 0.2
  if (authority === 'PRIMARY_GOVERNMENT' || authority === 'PRIMARY_REGULATOR' || authority === 'PRIMARY_COURT') return 1
  if (authority === 'PRIMARY_ACADEMIC' || authority === 'PRIMARY_DATA') return 0.92
  if (authority === 'PRIMARY_CORPORATE') return 0.78
  if (authority === 'SECONDARY_MAJOR_MEDIA') return 0.55
  if (authority === 'SECONDARY_INDUSTRY' || authority === 'SECONDARY_LOCAL_MEDIA') return 0.42
  if (authority === 'TERTIARY_SOCIAL' || authority === 'MODEL_INFERENCE') return 0.12
  return 0.2
}

function freshnessScore(item: IntelligenceEvidenceItem): number {
  if (item.freshness === 'live') return 1
  if (item.freshness === 'recent') return 0.82
  if (item.freshness === 'aging') return 0.45
  if (item.freshness === 'stale') return 0.18
  return 0.3
}

function publishedMs(item: IntelligenceEvidenceItem): number {
  const raw = item.published_at ?? item.observed_at
  if (!raw) return 0
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : 0
}

function matchesSourceType(item: IntelligenceEvidenceItem, types: SearchSourceTypeFilter[]): boolean {
  const authority = item.source_authority_class
  const sourceType = item.source_type
  return types.some(type => {
    if (type === 'web') return sourceType === 'search' || sourceType === 'crawl' || sourceType === 'direct_fetch'
    if (type === 'rss') return sourceType === 'rss'
    if (type === 'government') return authority === 'PRIMARY_GOVERNMENT' || authority === 'PRIMARY_DATA'
    if (type === 'academic') return authority === 'PRIMARY_ACADEMIC'
    if (type === 'regulatory') return authority === 'PRIMARY_REGULATOR' || authority === 'PRIMARY_COURT'
    if (type === 'corporate') return authority === 'PRIMARY_CORPORATE'
    return false
  })
}

function inDateRange(item: IntelligenceEvidenceItem, from?: string | null, to?: string | null): boolean {
  const ms = publishedMs(item)
  if (!ms) return true
  if (from && Number.isFinite(Date.parse(from)) && ms < Date.parse(from)) return false
  if (to && Number.isFinite(Date.parse(to)) && ms > Date.parse(to) + 24 * 60 * 60 * 1000) return false
  return true
}

function isPrimary(item: IntelligenceEvidenceItem): boolean {
  return item.primary_source === true || Boolean(item.source_authority_class?.startsWith('PRIMARY_'))
}

export function filterEvidenceForSearch(
  items: IntelligenceEvidenceItem[],
  request: NormalizedSearchRequest,
): IntelligenceEvidenceItem[] {
  return items.filter(item => {
    if (item.origin_type === 'MODEL_INFERENCE') return false
    if (!item.url && !item.canonical_url) return false
    if (request.primaryOnly && !isPrimary(item)) return false
    if (request.sourceTypes && !matchesSourceType(item, request.sourceTypes)) return false
    if (request.dateRange && !inDateRange(item, request.dateRange.from, request.dateRange.to)) return false
    return true
  })
}

export function scoreSearchEvidence(query: string, item: IntelligenceEvidenceItem, request: NormalizedSearchRequest): SearchRankBreakdown {
  const clusterHead = !item.derivative_of || item.cluster_head_id === item.id
  const regionMatch = request.region && item.region === request.region ? 1 : request.region ? 0.15 : 0.4
  const duplicatePenalty = clusterHead ? 0 : 0.55
  return {
    relevance: relevanceToQuery(query, item),
    authority: authorityScore(item.source_authority_class),
    freshness: freshnessScore(item),
    primary: isPrimary(item) ? 1 : 0.15,
    independence: clusterHead ? 1 : 0.2,
    regional: regionMatch,
    duplicatePenalty,
  }
}

export function combinedSearchScore(breakdown: SearchRankBreakdown): number {
  const raw =
    breakdown.relevance * 0.38
    + breakdown.authority * 0.2
    + breakdown.freshness * 0.16
    + breakdown.primary * 0.1
    + breakdown.independence * 0.1
    + breakdown.regional * 0.06
    - breakdown.duplicatePenalty * 0.35
  return Math.max(0, Math.min(1, raw))
}

export function collapseToClusterHeads(items: IntelligenceEvidenceItem[]): {
  heads: IntelligenceEvidenceItem[]
  alsoReportedBy: Map<string, SearchAlsoReportedBy>
} {
  const byCluster = new Map<string, IntelligenceEvidenceItem[]>()
  for (const item of items) {
    const key = item.semantic_cluster_id || item.canonical_url || item.content_hash || item.id
    const list = byCluster.get(key) ?? []
    list.push(item)
    byCluster.set(key, list)
  }
  const heads: IntelligenceEvidenceItem[] = []
  const alsoReportedBy = new Map<string, SearchAlsoReportedBy>()
  for (const members of byCluster.values()) {
    const head = members.find(item => item.id === item.cluster_head_id) ?? members[0]!
    heads.push(head)
    const others = members.filter(item => item.id !== head.id)
    if (others.length) {
      const publishers = [...new Set(others.map(item => item.source_label || hostnameFromUrl(item.url) || item.source_family || 'source').filter(Boolean))]
      alsoReportedBy.set(head.id, { count: others.length, publishers: publishers.slice(0, 6) })
    }
  }
  return { heads, alsoReportedBy }
}

export function rankSearchResults(
  query: string,
  items: IntelligenceEvidenceItem[],
  request: NormalizedSearchRequest,
): SearchResult[] {
  const filtered = filterEvidenceForSearch(items, request)
  const { heads, alsoReportedBy } = collapseToClusterHeads(filtered)
  const scored = heads.map(item => {
    const rankBreakdown = scoreSearchEvidence(query, item, request)
    return formatSearchResult({
      item,
      score: combinedSearchScore(rankBreakdown),
      rankBreakdown,
      alsoReportedBy: alsoReportedBy.get(item.id) ?? null,
    })
  })
  return sortSearchResults(scored, request.sort)
}

export function sortSearchResults(results: SearchResult[], sort: SearchSort): SearchResult[] {
  const copy = [...results]
  if (sort === 'NEWEST') {
    copy.sort((a, b) => {
      const aMs = a.publishedAt ? Date.parse(a.publishedAt) : 0
      const bMs = b.publishedAt ? Date.parse(b.publishedAt) : 0
      if (aMs !== bMs) return bMs - aMs
      return b.score - a.score
    })
    return copy
  }
  copy.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const aMs = a.publishedAt ? Date.parse(a.publishedAt) : 0
    const bMs = b.publishedAt ? Date.parse(b.publishedAt) : 0
    return bMs - aMs
  })
  return copy
}
