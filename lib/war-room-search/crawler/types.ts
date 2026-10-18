import type { EvidenceDiscoveryProvider } from '@/lib/intelligence/intelligencePacket'

export const WAR_ROOM_BOT_USER_AGENT = 'WarRoomBot/1.0'
export const WAR_ROOM_STORAGE_ORIGIN = 'WAR_ROOM_CORPUS'
export const WAR_ROOM_LOCAL_SOURCE_ID = 'war_room_local'
export const WAR_ROOM_LOCAL_PROVIDER = 'WAR_ROOM_LOCAL' as const

export const CRAWL_EVENT_STATES = [
  'QUEUED',
  'ROBOTS_CHECK',
  'BLOCKED_ROBOTS',
  'BLOCKED_POLICY',
  'FETCHING',
  'FETCHED',
  'EXTRACTING',
  'INDEXED',
  'DUPLICATE_URL',
  'DUPLICATE_CONTENT',
  'FAILED',
  'FRESHNESS_EVALUATED',
  'RECRAWL_STARTED',
  'RECRAWL_UNCHANGED',
  'RECRAWL_CHANGED',
  'RECRAWL_BLOCKED',
  'RECRAWL_FAILED',
  'SOURCE_NOT_FOUND',
  'SOURCE_GONE',
  'MAINTENANCE_STARTED',
  'MAINTENANCE_SKIPPED_LOCKED',
  'MAINTENANCE_COMPLETED',
  'MAINTENANCE_FAILED',
  'REEMBED_STARTED',
  'REEMBED_COMPLETED',
  'REEMBED_FAILED',
] as const

export type CrawlEventState = (typeof CRAWL_EVENT_STATES)[number]

export const ROBOTS_STATUSES = [
  'ROBOTS_ALLOWED',
  'ROBOTS_DISALLOWED',
  'ROBOTS_UNKNOWN',
  'ROBOTS_FETCH_ERROR',
] as const

export type RobotsStatus = (typeof ROBOTS_STATUSES)[number]

export const CRAWL_STATUSES = [
  'INDEXED',
  'DUPLICATE_URL',
  'DUPLICATE_CONTENT',
  'BLOCKED_ROBOTS',
  'BLOCKED_POLICY',
  'FAILED',
] as const

export type CrawlStatus = (typeof CRAWL_STATUSES)[number]

export const BATCH_ITEM_STATUSES = [
  'INDEXED',
  'BLOCKED_ROBOTS',
  'BLOCKED_POLICY',
  'DUPLICATE_URL',
  'DUPLICATE_CONTENT',
  'UNSUPPORTED_TYPE',
  'FETCH_FAILED',
  'EXTRACT_FAILED',
] as const

export type BatchItemStatus = (typeof BATCH_ITEM_STATUSES)[number]

export const MAX_SOVEREIGN_BATCH_URLS = 25

export type CrawlApprovalActor = 'commander' | 'trusted_internal_test'

export type CrawlApproval = {
  actor: CrawlApprovalActor
  /** Explicitly permit loopback/private targets for trusted fixture/internal workflows. */
  allowInternalHosts?: boolean
  note?: string
}

export type DomainPolicy = {
  allowlist: string[]
  denylist: string[]
  crawlDisabled: boolean
}

export type CrawlLimits = {
  timeoutMs: number
  maxRedirects: number
  maxBytes: number
}

export type ExtractedPage = {
  title: string | null
  description: string | null
  text: string
  canonicalDeclared: string | null
  language: string | null
  publishedAt: string | null
  author: string | null
}

export type CrawlDocumentRecord = {
  id: number
  originalUrl: string
  finalUrl: string
  canonicalUrl: string
  domain: string
  publisher: string
  title: string | null
  description: string | null
  language: string | null
  publishedAt: string | null
  author: string | null
  firstSeenAt: string
  lastCrawledAt: string
  contentHash: string
  contentText: string
  httpStatus: number
  contentType: string
  robotsStatus: RobotsStatus
  crawlStatus: CrawlStatus
  sourceOrigin: typeof WAR_ROOM_STORAGE_ORIGIN
  discoveredVia: EvidenceDiscoveryProvider | null
  alsoDiscoveredVia: EvidenceDiscoveryProvider[]
  bytesReceived: number
  documentPath: string | null
}

export type CrawlEventRecord = {
  id: number
  documentId: number | null
  state: CrawlEventState
  url: string
  canonicalUrl: string | null
  httpStatus: number | null
  bytesReceived: number | null
  contentType: string | null
  contentHash: string | null
  robotsStatus: RobotsStatus | null
  errorCategory: string | null
  durationMs: number
  createdAt: string
}

export type CrawlResult = {
  ok: boolean
  status: CrawlStatus
  document: CrawlDocumentRecord | null
  duplicateOfDocumentId: number | null
  robotsStatus: RobotsStatus | null
  errorCategory: string | null
  error: string | null
  durationMs: number
  events: CrawlEventRecord[]
}

export type BatchUrlInput = {
  url: string
  discoveredVia?: EvidenceDiscoveryProvider | null
  alsoDiscoveredVia?: EvidenceDiscoveryProvider[]
}

export type BatchUrlResult = {
  url: string
  status: BatchItemStatus
  ok: boolean
  documentId: number | null
  canonicalUrl: string | null
  publisher: string | null
  contentHash: string | null
  discoveredVia: EvidenceDiscoveryProvider | null
  robotsStatus: RobotsStatus | null
  errorCategory: string | null
  error: string | null
  durationMs: number
}

export type BatchCrawlSummary = {
  requested: number
  processed: number
  indexed: number
  duplicateUrl: number
  duplicateContent: number
  blockedRobots: number
  blockedPolicy: number
  failed: number
  durationMs: number
}

export type BatchCrawlResult = {
  ok: boolean
  error: string | null
  errorCategory: string | null
  items: BatchUrlResult[]
  summary: BatchCrawlSummary
}

export type LocalSearchHit = {
  document: CrawlDocumentRecord
  rank: number
  snippet: string
}

export const INGEST_CANDIDATE_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'INGESTED',
  'FAILED',
  'EXPIRED',
  'ALREADY_INDEXED',
] as const

export type IngestCandidateStatus = (typeof INGEST_CANDIDATE_STATUSES)[number]

export const INGEST_CANDIDATE_EVENT_TYPES = [
  'CREATED',
  'PROVENANCE_MERGED',
  'APPROVED',
  'REJECTED',
  'RECOMMENDED',
  'INGEST_STARTED',
  'INGESTED',
  'FAILED',
  'ALREADY_INDEXED',
  'EXPIRED',
] as const

export type IngestCandidateEventType = (typeof INGEST_CANDIDATE_EVENT_TYPES)[number]

export type IngestCandidateActor = CrawlApprovalActor | 'council' | 'model'

export type IngestCandidateRecord = {
  id: number
  url: string
  canonicalCandidateUrl: string
  title: string | null
  snippet: string | null
  publisher: string | null
  domain: string | null
  discoveredVia: EvidenceDiscoveryProvider | null
  alsoDiscoveredVia: EvidenceDiscoveryProvider[]
  discoveredAt: string
  queryContext: string | null
  status: IngestCandidateStatus
  approvedBy: CrawlApprovalActor | null
  approvedAt: string | null
  rejectedBy: CrawlApprovalActor | null
  rejectedAt: string | null
  ingestStatus: string | null
  documentId: number | null
  councilRecommendation: string | null
  councilRecommendedAt: string | null
  createdAt: string
  updatedAt: string
}

export type IngestCandidateEventRecord = {
  id: number
  candidateId: number
  eventType: IngestCandidateEventType
  actor: IngestCandidateActor | null
  detail: string | null
  createdAt: string
}

export const FRESHNESS_STATES = [
  'FRESH',
  'DUE',
  'STALE',
  'UNKNOWN',
] as const

export type FreshnessState = (typeof FRESHNESS_STATES)[number]

export const LIFECYCLE_STATUSES = [
  'FRESH',
  'DUE',
  'STALE',
  'UNKNOWN',
  'RECRAWL_BLOCKED',
  'RECRAWL_FAILED',
] as const

export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number]

export const SOURCE_AVAILABILITY_STATES = [
  'AVAILABLE',
  'NOT_FOUND',
  'GONE',
  'UNKNOWN',
] as const

export type SourceAvailability = (typeof SOURCE_AVAILABILITY_STATES)[number]

export const RECRAWL_OUTCOMES = [
  'UNCHANGED',
  'CHANGED',
  'BLOCKED',
  'FAILED',
  'NOT_FOUND',
  'GONE',
  'CANONICAL_CHANGED',
] as const

export type RecrawlOutcome = (typeof RECRAWL_OUTCOMES)[number]

export const DEFAULT_FRESHNESS_INTERVAL_HOURS = 720
export const DEFAULT_FRESHNESS_STALE_MULTIPLIER = 2
export const MIN_FRESHNESS_INTERVAL_HOURS = 1
export const MAX_RECRAWL_BATCH = MAX_SOVEREIGN_BATCH_URLS
export const MAX_MAINTENANCE_BATCH = MAX_SOVEREIGN_BATCH_URLS
export const MAINTENANCE_LOCK_NAME = 'sovereign-search-maintenance'
export const DEFAULT_MAINTENANCE_LEASE_MS = 15 * 60 * 1000

export type FreshnessPolicy = {
  defaultIntervalHours: number
  staleMultiplier: number
  domainIntervalHours: Record<string, number>
}

export type DocumentLifecycleMeta = {
  freshnessIntervalHours: number | null
  lastRecrawlAt: string | null
  lastRecrawlOutcome: RecrawlOutcome | null
  previousContentHash: string | null
  lastChangeAt: string | null
  sourceAvailability: SourceAvailability
  lastObservedCanonicalUrl: string | null
  canonicalChanged: boolean
  lastErrorCategory: string | null
}

export type DocumentVersionRecord = {
  id: number
  documentId: number
  canonicalUrl: string
  previousHash: string | null
  newHash: string | null
  changeStatus: RecrawlOutcome
  httpStatus: number | null
  robotsStatus: RobotsStatus | null
  observedCanonicalUrl: string | null
  canonicalChanged: boolean
  createdAt: string
}

export type RecrawlRunRecord = {
  id: number
  startedAt: string
  finishedAt: string
  requested: number
  processed: number
  changed: number
  unchanged: number
  blocked: number
  failed: number
  notFound: number
  gone: number
  actor: string | null
}

export const MAINTENANCE_RUN_STATUSES = [
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'SKIPPED_LOCKED',
] as const

export type MaintenanceRunStatus = (typeof MAINTENANCE_RUN_STATUSES)[number]

export const MAINTENANCE_LOCK_STATUSES = [
  'FREE',
  'HELD',
  'EXPIRED',
] as const

export type MaintenanceLockStatus = (typeof MAINTENANCE_LOCK_STATUSES)[number]

export type MaintenanceLockRecord = {
  lockName: string
  runId: number | null
  ownerPid: number | null
  acquiredAt: string
  leaseExpiresAt: string
}

export type MaintenanceRunRecord = {
  id: number
  startedAt: string
  finishedAt: string | null
  status: MaintenanceRunStatus
  actor: string | null
  recrawlEnabled: boolean
  reembedEnabled: boolean
  requested: number
  recrawled: number
  changed: number
  unchanged: number
  blocked: number
  failed: number
  notFound: number
  gone: number
  reembedded: number
  reembedFailures: number
  skippedCurrent: number
  staleVectorDocuments: number
  error: string | null
  recoveredExpiredLock: boolean
  leaseExpiresAt: string | null
}

export type CorpusLifecycleDiagnostics = {
  documentCount: number
  freshCount: number
  dueCount: number
  staleCount: number
  unknownCount: number
  blockedCount: number
  failedCount: number
  notFoundCount: number
  goneCount: number
  changedCount: number
  unchangedCount: number
  lastRecrawlRunAt: string | null
  lastSuccessfulRecrawlAt: string | null
  staleVectorDocumentCount: number
  lastMaintenanceRunAt: string | null
  lastSuccessfulMaintenanceRunAt: string | null
  lastMaintenanceStatus: MaintenanceRunStatus | null
  documentsRecrawled: number
  documentsReembedded: number
  reembedFailures: number
  maintenanceLockStatus: MaintenanceLockStatus
  maintenanceLockExpiresAt: string | null
}

export type DocumentFreshness = {
  documentId: number
  canonicalUrl: string
  domain: string
  lastCrawledAt: string
  intervalHours: number
  dueAt: string | null
  staleAt: string | null
  freshness: FreshnessState
  lifecycleStatus: LifecycleStatus
  sourceAvailability: SourceAvailability
  lastRecrawlOutcome: RecrawlOutcome | null
  contentHash: string
}
