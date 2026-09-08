import { hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'
import type { IntelligenceEvidenceItem, SourceAuthorityClass } from '@/lib/intelligence/intelligencePacket'
import type { SearchAlsoReportedBy, SearchBadge, SearchRankBreakdown, SearchResult } from './types'

const EMPTY_BREAKDOWN: SearchRankBreakdown = {
  relevance: 0,
  authority: 0,
  freshness: 0,
  primary: 0,
  independence: 0,
  regional: 0,
  duplicatePenalty: 0,
}

export function badgesForEvidence(item: IntelligenceEvidenceItem): SearchBadge[] {
  const badges: SearchBadge[] = []
  const authority = item.source_authority_class ?? null
  if (item.primary_source === true || authority?.startsWith('PRIMARY_')) badges.push('PRIMARY')
  if (isOfficialAuthority(authority)) badges.push('OFFICIAL')
  if (authority === 'PRIMARY_ACADEMIC') badges.push('ACADEMIC')
  if (item.region) badges.push('REGIONAL')
  if (item.freshness === 'live' || item.freshness === 'recent') badges.push('CURRENT')
  return badges
}

export function isOfficialAuthority(authority: SourceAuthorityClass | null | undefined): boolean {
  return authority === 'PRIMARY_GOVERNMENT' || authority === 'PRIMARY_REGULATOR' || authority === 'PRIMARY_COURT'
}

export function snippetFromEvidence(item: IntelligenceEvidenceItem): string {
  const content = (item.content ?? '').trim()
  if (content) return content.slice(0, 420)
  const claim = (item.claim ?? '').trim()
  if (claim) return claim.slice(0, 420)
  return (item.title ?? '').slice(0, 420)
}

export function formatSearchResult(args: {
  item: IntelligenceEvidenceItem
  score: number
  rankBreakdown: SearchRankBreakdown
  alsoReportedBy?: SearchAlsoReportedBy | null
}): SearchResult {
  const { item, score, rankBreakdown, alsoReportedBy = null } = args
  const url = item.url?.trim() || null
  return {
    id: item.id,
    title: item.title || item.claim || 'Untitled source',
    url,
    canonicalUrl: item.canonical_url ?? null,
    displayDomain: hostnameFromUrl(url) ?? hostnameFromUrl(item.canonical_url) ?? null,
    snippet: snippetFromEvidence(item),
    publisher: item.source_label?.trim() || item.publisher_family || item.source_family || null,
    publishedAt: item.published_at ?? null,
    observedAt: item.observed_at ?? null,
    sourceType: item.source_type ?? null,
    originType: item.origin_type ?? null,
    authorityClass: item.source_authority_class ?? null,
    region: item.region ?? null,
    language: item.language ?? item.original_language ?? null,
    primarySource: item.primary_source ?? null,
    sourceFamily: item.source_family ?? null,
    clusterId: item.semantic_cluster_id ?? null,
    independenceKey: item.independence_key ?? null,
    freshness: item.freshness ?? null,
    score,
    badges: badgesForEvidence(item),
    rankBreakdown: rankBreakdown ?? EMPTY_BREAKDOWN,
    alsoReportedBy,
    contentHash: item.content_hash ?? null,
    jurisdiction: item.jurisdiction ?? null,
    evidence: item,
  }
}
