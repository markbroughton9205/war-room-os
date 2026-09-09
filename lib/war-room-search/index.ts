export type { SearchRequest, SearchResult, FederatedSearchResponse, SearchCouncilHandoffPayload } from './types'
export { SEARCH_HANDOFF_STORAGE_KEY, SEARCH_RECENT_STORAGE_KEY, emptySearchSourceSummary } from './types'
export { federatedSearch } from './federatedSearch'
export { normalizeSearchRequest, isSearchRequestEmpty } from './searchQuery'
export { rankSearchResults, collapseToClusterHeads } from './rankResults'
export { formatSearchResult } from './formatSearchResult'
export { buildSearchHandoffEvidencePacket, isSearchHandoffBody } from './councilHandoff'
export { runGoogleWebSearch, GOOGLE_WEB_SEARCH_ENDPOINT } from './providers/googleWebSearch'
export { runSearxngSearch, SEARXNG_PROVIDER_ID } from './providers/searxng'
export { runWarRoomLocalSearch } from './providers/warRoomLocal'
export { stampDiscoveryProvenance, discoveryProviderFromSourceId } from './discoveryProvider'
export { crawlApprovedUrl } from './crawler/crawlUrl'
export { crawlApprovedBatch, parseBatchInputJson } from './crawler/batchCrawl'
export { searchLocalCorpus } from './crawler/localSearch'
export { planLexicalQuery, LEXICAL_STOP_WORDS } from './crawler/lexicalPlan'
export { recrawlStoredDocument, recrawlDueDocuments } from './crawler/recrawl'
export {
  evaluateDocumentFreshness,
  listDocumentFreshness,
  listDueDocuments,
  corpusLifecycleDiagnostics,
} from './crawler/freshness'
export {
  proposeIngestCandidates,
  approveIngestCandidates,
  rejectIngestCandidates,
  ingestApprovedCandidates,
  discoverIngestCandidates,
  listIngestCandidates,
} from './crawler/candidates'
export { WAR_ROOM_LOCAL_SOURCE_ID, WAR_ROOM_STORAGE_ORIGIN, MAX_SOVEREIGN_BATCH_URLS } from './crawler/types'
export { searchLocalHybrid, indexCorpusDocuments, createQueryEmbedder, inspectLocalSemanticHealth, getRetrievalProfile, runSovereignMaintenance, reembedStaleDocuments } from './hybrid'
