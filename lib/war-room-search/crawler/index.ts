export type { CrawlApproval, CrawlDocumentRecord, CrawlResult, BatchCrawlResult, BatchUrlResult, LocalSearchHit, RobotsStatus, IngestCandidateRecord } from './types'
export { WAR_ROOM_BOT_USER_AGENT, WAR_ROOM_LOCAL_SOURCE_ID, WAR_ROOM_STORAGE_ORIGIN, MAX_SOVEREIGN_BATCH_URLS, MAX_RECRAWL_BATCH, MAX_MAINTENANCE_BATCH } from './types'
export { crawlApprovedUrl, checkRobots } from './crawlUrl'
export { crawlApprovedBatch, parseBatchInputJson } from './batchCrawl'
export { searchLocalCorpus } from './localSearch'
export { SovereignCorpus, resolveCorpusPaths } from './corpus'
export {
  proposeIngestCandidates,
  approveIngestCandidates,
  rejectIngestCandidates,
  ingestApprovedCandidates,
  discoverIngestCandidates,
  listIngestCandidates,
} from './candidates'
export { extractHtml, extractPlainText } from './extract'
export { evaluateCrawlDestination, readDomainPolicy } from './policy'
export { evaluateRobotsForPath, parseRobotsTxt } from './robots'
export { hashEvidenceContent } from '@/lib/intelligence/contentHash'
export { canonicalizeUrl } from '@/lib/intelligence/canonicalUrl'
export {
  evaluateDocumentFreshness,
  listDocumentFreshness,
  listDueDocuments,
  corpusLifecycleDiagnostics,
  readFreshnessPolicy,
} from './freshness'
export { recrawlStoredDocument, recrawlDueDocuments } from './recrawl'
