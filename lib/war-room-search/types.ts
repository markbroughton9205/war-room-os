import type { GeographicRegion } from '@/lib/council/scout-swarm/types'
import type {
  EvidenceFreshness,
  EvidenceOriginType,
  IntelligenceEvidenceItem,
  SourceAuthorityClass,
} from '@/lib/intelligence/intelligencePacket'
import type { IntelligenceSourceType } from '@/lib/intelligence/sourceRegistry'

export const SEARCH_REGIONS = [
  'ALL',
  'NORTH_AMERICA',
  'LATIN_AMERICA',
  'EUROPE',
  'AFRICA',
  'MIDDLE_EAST',
  'EAST_ASIA',
  'SOUTH_ASIA',
  'OCEANIA',
] as const

export type SearchRegionFilter = (typeof SEARCH_REGIONS)[number]
export type SearchSort = 'RELEVANCE' | 'NEWEST'
export type SearchSourceTypeFilter =
  | 'web'
  | 'rss'
  | 'government'
  | 'academic'
  | 'regulatory'
  | 'corporate'

export type SearchDateRange = {
  from?: string | null
  to?: string | null
}

export type SearchRequestOptions = {
  limit?: number
  region?: SearchRegionFilter | null
  language?: string | null
  dateRange?: SearchDateRange | null
  sourceTypes?: SearchSourceTypeFilter[] | null
  primaryOnly?: boolean
  sort?: SearchSort
  safeSearch?: boolean
  timeoutMs?: number
}

export type SearchRequest = {
  query: string
  options?: SearchRequestOptions
}

export type SearchBadge = 'PRIMARY' | 'OFFICIAL' | 'ACADEMIC' | 'REGIONAL' | 'CURRENT'

export type SearchAlsoReportedBy = {
  count: number
  publishers: string[]
}

/** Explainable ranking components — not a hidden 0–100 truth score. */
export type SearchRankBreakdown = {
  relevance: number
  authority: number
  freshness: number
  primary: number
  independence: number
  regional: number
  duplicatePenalty: number
}

export type SearchResult = {
  id: string
  title: string
  url: string | null
  canonicalUrl: string | null
  displayDomain: string | null
  snippet: string
  publisher: string | null
  publishedAt: string | null
  observedAt: string | null
  sourceType: IntelligenceSourceType | null
  originType: EvidenceOriginType | null
  authorityClass: SourceAuthorityClass | null
  region: string | null
  language: string | null
  primarySource: boolean | null
  sourceFamily: string | null
  clusterId: string | null
  independenceKey: string | null
  freshness: EvidenceFreshness | null
  score: number
  badges: SearchBadge[]
  rankBreakdown: SearchRankBreakdown
  alsoReportedBy: SearchAlsoReportedBy | null
  contentHash: string | null
  jurisdiction: string | null
  /** Full Build #6 evidence item for Council handoff. Never flattened to text-only. */
  evidence: IntelligenceEvidenceItem
}

export type SearchSourceSummary = {
  tavilyOk: boolean
  researchEngineOk: boolean
  researchEngineProviders: string[]
  publicRssOk: boolean
  region?: GeographicRegion
  primaryAttempted: string[]
  primaryOk: boolean
  genericRssUsedAsFallback: boolean
  fallbackReason?: string
}

export type FederatedSearchResponse = {
  query: string
  tookMs: number
  resultCount: number
  rawCount: number
  deduplicatedCount: number
  results: SearchResult[]
  sourceSummary: SearchSourceSummary
  fallbackUsed: boolean
  warnings: string[]
  aborted: boolean
  timedOut: boolean
  profile: 'STANDARD_RESEARCH'
}

export const SEARCH_HANDOFF_STORAGE_KEY = 'war-room-search-handoff'
export const SEARCH_RECENT_STORAGE_KEY = 'war-room-search-recent'

export type SearchCouncilHandoffPayload = {
  query: string
  resultIds?: string[]
  results: SearchResult[]
}
