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
