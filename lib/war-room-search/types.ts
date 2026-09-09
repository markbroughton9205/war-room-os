import type { GeographicRegion } from '@/lib/council/scout-swarm/types'
import type {
  EvidenceDiscoveryProvider,
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

/** Provider-local retrieval diagnostics. Not on the federated authority/freshness scale. */
export type LocalRetrievalMode = 'FTS_ONLY' | 'SEMANTIC_ONLY' | 'HYBRID_RRF' | 'FTS_FALLBACK'

export type LocalRetrievalSignals = {
  lexicalRank: number | null
  lexicalScore: number | null
  semanticRank: number | null
  semanticScore: number | null
  fusionRank: number | null
  fusionScore: number | null
  matchedChunkId: string | null
  mode: LocalRetrievalMode
}

export type LocalSemanticStatus =
  | 'available'
  | 'modelMissing'
  | 'indexMissing'
  | 'stale'
  | 'corrupt'
  | 'disabled'
  | 'error'

export type LocalSemanticHealth = {
  status: LocalSemanticStatus
  reason: string | null
  modelId: string | null
  revision: string | null
  dimensions: number | null
  chunkVersion: string | null
  indexedDocumentCount: number | null
  indexedChunkCount: number | null
  staleEmbeddingCount: number | null
  vectorIndexBytes: number | null
  semanticQueryMs: number | null
  bruteForceWarning: boolean
  annReconsider: boolean
  inferenceBackend: string | null
}

export type LocalSemanticAdmission = {
  candidateScore: number | null
  secondScore: number | null
  margin: number | null
  threshold: number | null
  marginThreshold: number | null
  admitted: boolean
  abstained: boolean
  strategy: string | null
  profileVersion: string | null
  embeddingModel: string | null
  embeddingRevision: string | null
  chunkingVersion: string | null
  rrfK: number | null
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
  /** Local FTS/semantic/RRF diagnostics. Null for non-local results. Never mixed into rankBreakdown. */
  localRetrievalSignals: LocalRetrievalSignals | null
  alsoReportedBy: SearchAlsoReportedBy | null
  contentHash: string | null
  jurisdiction: string | null
  /** Which search service found the page — not the publisher. */
  discoveredVia: EvidenceDiscoveryProvider | null
  /** Other discovery services that also surfaced this canonical URL. Not independent evidence. */
  alsoDiscoveredVia: EvidenceDiscoveryProvider[] | null
  /** Upstream engines (e.g. SearXNG → brave) that surfaced this URL. Not publisher families. */
  upstreamEngines: string[] | null
  /** Retrieval/storage origin. Never the original publisher. */
  storageOrigin: 'WAR_ROOM_CORPUS' | null
  /** Full Build #6 evidence item for Council handoff. Never flattened to text-only. */
  evidence: IntelligenceEvidenceItem
}

export type SearchSourceSummary = {
  tavilyOk: boolean
  googleOk: boolean
  googleWarning?: string
  searxngOk: boolean
  searxngWarning?: string
  warRoomLocalOk: boolean
  warRoomLocalWarning?: string
  /** Semantic capability is diagnostic only. Missing semantic never marks WAR_ROOM_LOCAL unhealthy. */
  localSemantic: LocalSemanticHealth | null
  /** Relevance admission is not infrastructure health. Abstention can occur while status=available. */
  localSemanticAdmission: LocalSemanticAdmission | null
  researchEngineOk: boolean
  researchEngineProviders: string[]
  publicRssOk: boolean
  region?: GeographicRegion
  primaryAttempted: string[]
  primaryOk: boolean
  genericRssUsedAsFallback: boolean
  fallbackReason?: string
}

export function emptySearchSourceSummary(overrides?: Partial<SearchSourceSummary>): SearchSourceSummary {
  return {
    tavilyOk: false,
    googleOk: false,
    searxngOk: false,
    warRoomLocalOk: false,
    localSemantic: null,
    localSemanticAdmission: null,
    researchEngineOk: false,
    researchEngineProviders: [],
    publicRssOk: false,
    primaryAttempted: [],
    primaryOk: false,
    genericRssUsedAsFallback: false,
    ...overrides,
  }
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
