import type {
  SignalFreshnessStatus,
  SignalOperationalStatus,
  SignalProviderId,
  SignalRawItem,
  SignalResult,
  SignalSourceStatus,
  SignalTimeIntegrityStatus,
} from './model'

export const DEFAULT_NEWS_MAX_AGE_DAYS = 14
export const LIVE_SIGNAL_MAX_AGE_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000
const PROVIDER_MAX_AGE_ENV: Partial<Record<SignalProviderId, string[]>> = {
  guardian: ['GUARDIAN_SIGNAL_MAX_AGE_DAYS', 'SIGNAL_GUARDIAN_MAX_AGE_DAYS'],
  newsapi: ['NEWSAPI_SIGNAL_MAX_AGE_DAYS', 'SIGNAL_NEWSAPI_MAX_AGE_DAYS'],
  rss: ['RSS_SIGNAL_MAX_AGE_DAYS', 'SIGNAL_RSS_MAX_AGE_DAYS'],
  tavily: ['TAVILY_SIGNAL_MAX_AGE_DAYS', 'SIGNAL_TAVILY_MAX_AGE_DAYS'],
}

export type FreshnessEvaluation = {
  status: SignalFreshnessStatus
  /** Canonical article publication instant (ISO), never ingestion time. */
  publishedAt: string | null
  articlePublishedAt: string | null
  ageDays: number | null
  acceptedForLiveSignal: boolean
  recencyPenalty: number
  sourceStatus: SignalSourceStatus
  operationalStatus: SignalOperationalStatus
  timeIntegrityStatus: SignalTimeIntegrityStatus
}

export const PUBLICATION_TIME_UNAVAILABLE = 'Publication time unavailable'

export type FreshnessCounters = {
  maxAgeDays: number
  accepted: number
  live: number
  recent: number
  staleDiscarded: number
  unknownDateDiscarded: number
  oldestAcceptedAgeDays: number | null
}

export function activePublishedAtCutoff(now = new Date()): string {
  const from = new Date(now)
  from.setUTCDate(from.getUTCDate() - LIVE_SIGNAL_MAX_AGE_DAYS)
  return from.toISOString()
}

export function resolveMaxAgeDays(value?: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : DEFAULT_NEWS_MAX_AGE_DAYS
  if (!Number.isFinite(parsed)) return DEFAULT_NEWS_MAX_AGE_DAYS
  return Math.max(1, Math.min(LIVE_SIGNAL_MAX_AGE_DAYS, Math.round(parsed)))
}

export function maxAgeDaysForProvider(provider: SignalProviderId): number {
  const providerValue = PROVIDER_MAX_AGE_ENV[provider]?.map(name => process.env[name]).find(Boolean)
  return resolveMaxAgeDays(providerValue ?? process.env.SIGNAL_NEWS_MAX_AGE_DAYS)
}

export function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export function newsDateWindow(maxAgeDays: number, now = new Date()): { fromDate: string; toDate: string } {
  const from = new Date(now)
  from.setUTCDate(from.getUTCDate() - maxAgeDays)
  return { fromDate: dateOnly(from), toDate: dateOnly(now) }
}

function parseArticlePublishedAt(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

/** Article publication fields only — never ingestion/cache timestamps. */
export function articlePublishedAtFromMetadata(metadata: Record<string, unknown>): unknown {
  return metadata.articlePublishedAt
    ?? metadata.publishedAt
    ?? metadata.webPublicationDate
    ?? metadata.pubDate
}

/** @deprecated Prefer articlePublishedAtFromMetadata — excludes ingestion timestamps. */
export function publicationDateFromMetadata(metadata: Record<string, unknown>): unknown {
  return articlePublishedAtFromMetadata(metadata)
}

export function signalIngestedAtFromResult(result: Pick<SignalResult, 'capturedAt' | 'metadata'>): string {
  const fromMetadata = result.metadata.signalIngestedAt
  if (typeof fromMetadata === 'string' && fromMetadata.trim()) return fromMetadata
  return result.capturedAt
}

export function signalVerifiedAtFromMetadata(metadata: Record<string, unknown>): string | null {
  const value = metadata.signalVerifiedAt
  return typeof value === 'string' && value.trim() ? value : null
}

export function evaluatePublicationIntegrity(
  articlePublishedAt: unknown,
  now = new Date(),
): { parsed: Date | null; timeIntegrityStatus: SignalTimeIntegrityStatus } {
  const parsed = parseArticlePublishedAt(articlePublishedAt)
  if (!parsed) {
    return { parsed: null, timeIntegrityStatus: 'TIME_INTEGRITY_WARNING' }
  }
  if (parsed.getTime() > now.getTime()) {
    return { parsed, timeIntegrityStatus: 'TIME_INTEGRITY_WARNING' }
  }
  return { parsed, timeIntegrityStatus: 'OK' }
}

export function formatRelativeAgeAgo(iso: string | null | undefined, now = new Date()): string | null {
  if (!iso) return null
  const parsed = parseArticlePublishedAt(iso)
  if (!parsed) return null
  const ageMs = now.getTime() - parsed.getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) return null
  const minutes = Math.round(ageMs / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function newsCardTimestampLabel(input: {
  articlePublishedAt: string | null
  signalIngestedAt: string | null
  sourceName: string
  now?: Date
}): string {
  const now = input.now ?? new Date()
  const publishedAgo = formatRelativeAgeAgo(input.articlePublishedAt, now)
  const ingestedAgo = formatRelativeAgeAgo(input.signalIngestedAt, now)
  const publishedPart = publishedAgo ? `Published ${publishedAgo}` : PUBLICATION_TIME_UNAVAILABLE
  const ingestedPart = ingestedAgo ? `Ingested ${ingestedAgo}` : null
  return [publishedPart, ingestedPart, input.sourceName].filter(Boolean).join(' · ')
}

function statusForAge(ageDays: number): SignalFreshnessStatus {
  if (ageDays <= 7) return 'LIVE'
  if (ageDays <= LIVE_SIGNAL_MAX_AGE_DAYS) return 'RECENT'
  return 'ARCHIVAL'
}

function penaltyForAge(ageDays: number): number {
  if (ageDays <= 7) return 0
  if (ageDays <= 14) return 5
  if (ageDays <= LIVE_SIGNAL_MAX_AGE_DAYS) return 14
  return 100
}

export function resolveSourceStatus(provider: SignalProviderId): SignalSourceStatus {
  if (provider === 'guardian' || provider === 'newsapi' || provider === 'rss') return 'VERIFIED'
  if (provider === 'tavily' || provider === 'firecrawl' || provider === 'source_url') return 'UNVERIFIED'
  return 'UNKNOWN'
}

export function resolveOperationalStatus(
  freshness: Pick<FreshnessEvaluation, 'status' | 'acceptedForLiveSignal'>,
): SignalOperationalStatus {
  if (freshness.status === 'UNKNOWN_DATE' || freshness.status === 'ARCHIVAL' || freshness.status === 'STALE') {
    return 'EXCLUDED'
  }
  if (!freshness.acceptedForLiveSignal) return 'EXCLUDED'
  if (freshness.status === 'LIVE' || freshness.status === 'RECENT') return 'ACTIONABLE'
  return 'CONTEXT_ONLY'
}

/** Classify freshness from article publication time only (never ingestion timestamps). */
export function classifyFreshness(
  articlePublishedAt: unknown,
  options?: { now?: Date; maxAgeDays?: number; provider?: SignalProviderId },
): FreshnessEvaluation {
  return evaluateFreshness(articlePublishedAt, options)
}

export function evaluateFreshness(
  articlePublishedAt: unknown,
  options?: { now?: Date; maxAgeDays?: number; provider?: SignalProviderId },
): FreshnessEvaluation {
  const maxAgeDays = resolveMaxAgeDays(options?.maxAgeDays)
  const sourceStatus = resolveSourceStatus(options?.provider ?? 'manual_registry')
  const now = options?.now ?? new Date()
  const integrity = evaluatePublicationIntegrity(articlePublishedAt, now)
  const parsed = integrity.parsed
  if (!parsed) {
    return {
      status: 'UNKNOWN_DATE',
      publishedAt: null,
      articlePublishedAt: null,
      ageDays: null,
      acceptedForLiveSignal: false,
      recencyPenalty: 100,
      sourceStatus,
      operationalStatus: 'EXCLUDED',
      timeIntegrityStatus: 'TIME_INTEGRITY_WARNING',
    }
  }

  const isFuture = integrity.timeIntegrityStatus === 'TIME_INTEGRITY_WARNING'
  const ageDays = isFuture ? null : Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / DAY_MS))
  const status = ageDays === null ? 'UNKNOWN_DATE' : statusForAge(ageDays)
  const withinActiveWindow = ageDays !== null && ageDays <= LIVE_SIGNAL_MAX_AGE_DAYS
  const withinProviderWindow = ageDays !== null && ageDays <= Math.min(maxAgeDays, LIVE_SIGNAL_MAX_AGE_DAYS)
  const acceptedForLiveSignal = !isFuture && withinActiveWindow && withinProviderWindow
  const evaluation: FreshnessEvaluation = {
    status: ageDays === null ? 'UNKNOWN_DATE' : (withinActiveWindow ? status : 'ARCHIVAL'),
    publishedAt: parsed.toISOString(),
    articlePublishedAt: parsed.toISOString(),
    ageDays,
    acceptedForLiveSignal,
    recencyPenalty: ageDays === null ? 100 : penaltyForAge(ageDays),
    sourceStatus,
    operationalStatus: 'EXCLUDED',
    timeIntegrityStatus: integrity.timeIntegrityStatus,
  }
  evaluation.operationalStatus = resolveOperationalStatus(evaluation)
  return evaluation
}

export function withFreshnessMetadata(
  metadata: Record<string, unknown> | undefined,
  freshness: FreshnessEvaluation,
  signalIngestedAt?: string,
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    publishedAt: freshness.publishedAt,
    articlePublishedAt: freshness.articlePublishedAt,
    signalIngestedAt: signalIngestedAt ?? metadata?.signalIngestedAt,
    freshnessStatus: freshness.status,
    sourceStatus: freshness.sourceStatus,
    operationalStatus: freshness.operationalStatus,
    timeIntegrityStatus: freshness.timeIntegrityStatus,
    ageDays: freshness.ageDays,
    recencyPenalty: freshness.recencyPenalty,
  }
}

export function enrichSignalResult(result: SignalResult, now = new Date()): SignalResult {
  const signalIngestedAt = signalIngestedAtFromResult(result)
  const freshness = classifyFreshness(articlePublishedAtFromMetadata(result.metadata), {
    now,
    maxAgeDays: maxAgeDaysForProvider(result.provider),
    provider: result.provider,
  })
  return {
    ...result,
    metadata: withFreshnessMetadata(result.metadata, freshness, signalIngestedAt),
  }
}

export function isActiveOperationalStatus(status: unknown): boolean {
  return status === 'ACTIONABLE'
}

export function isActiveFreshnessStatus(status: unknown): boolean {
  return status === 'LIVE' || status === 'RECENT'
}

export function isActiveSignalResult(result: SignalResult, now = new Date()): boolean {
  const enriched = enrichSignalResult(result, now)
  return isActiveOperationalStatus(enriched.metadata.operationalStatus)
    && isActiveFreshnessStatus(enriched.metadata.freshnessStatus)
}

export function signalCardDisplayLabel(metadata: Record<string, unknown>): string {
  const sourceStatus = metadata.sourceStatus
  const freshnessStatus = metadata.freshnessStatus
  const operationalStatus = metadata.operationalStatus
  const sourcePrefix = sourceStatus === 'VERIFIED'
    ? 'SOURCE VERIFIED'
    : sourceStatus === 'UNVERIFIED'
      ? 'SOURCE UNVERIFIED'
      : 'SOURCE UNKNOWN'
  if (operationalStatus === 'EXCLUDED') {
    if (freshnessStatus === 'ARCHIVAL') return `${sourcePrefix} · ARCHIVAL`
    if (freshnessStatus === 'UNKNOWN_DATE') return `${sourcePrefix} · UNKNOWN DATE`
    return `${sourcePrefix} · STALE EXCLUDED`
  }
  if (freshnessStatus === 'LIVE') return `${sourcePrefix} · LIVE`
  if (freshnessStatus === 'RECENT') return `${sourcePrefix} · RECENT`
  if (freshnessStatus === 'ARCHIVAL') return `${sourcePrefix} · ARCHIVAL`
  return `${sourcePrefix} · CONTEXT`
}

export function createFreshnessCounters(maxAgeDays: number): FreshnessCounters {
  return {
    maxAgeDays,
    accepted: 0,
    live: 0,
    recent: 0,
    staleDiscarded: 0,
    unknownDateDiscarded: 0,
    oldestAcceptedAgeDays: null,
  }
}

export function recordFreshness(counters: FreshnessCounters, freshness: FreshnessEvaluation): void {
  if (!freshness.acceptedForLiveSignal) {
    if (freshness.status === 'UNKNOWN_DATE') counters.unknownDateDiscarded += 1
    if (freshness.status === 'STALE' || freshness.status === 'ARCHIVAL') counters.staleDiscarded += 1
    return
  }

  counters.accepted += 1
  if (freshness.status === 'LIVE') counters.live += 1
  if (freshness.status === 'RECENT') counters.recent += 1
  if (freshness.ageDays !== null) {
    counters.oldestAcceptedAgeDays = counters.oldestAcceptedAgeDays === null
      ? freshness.ageDays
      : Math.max(counters.oldestAcceptedAgeDays, freshness.ageDays)
  }
}

export function freshnessDiagnostics(counters: FreshnessCounters): Record<string, unknown> {
  return {
    maxAgeDays: counters.maxAgeDays,
    freshResultCount: counters.accepted,
    freshAcceptedCount: counters.accepted,
    liveCount: counters.live,
    recentCount: counters.recent,
    recentAcceptedCount: counters.recent,
    staleDiscardedCount: counters.staleDiscarded,
    staleSuppressedCount: counters.staleDiscarded,
    unknownDateDiscardedCount: counters.unknownDateDiscarded,
    oldestAcceptedAgeDays: counters.oldestAcceptedAgeDays,
    oldestActiveResultAgeDays: counters.oldestAcceptedAgeDays,
    staleDiscarded: counters.staleDiscarded,
  }
}

export function isNewsLikeProvider(provider: SignalProviderId): boolean {
  return provider === 'guardian' || provider === 'newsapi' || provider === 'rss'
}

/** @deprecated Use isActiveSignalResult — kept for existing imports */
export function isLiveSignalResult(result: SignalResult): boolean {
  return isActiveSignalResult(result)
}

export function recencyPenaltyForItem(item: SignalRawItem): number {
  const value = item.metadata?.recencyPenalty
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

export function collectCacheFreshnessDiagnostics(
  stored: SignalResult[],
  active: SignalResult[],
): import('./model').SignalCacheFreshnessDiagnostics {
  const now = new Date()
  let oldestStoredAgeDays: number | null = null
  for (const result of stored) {
    const enriched = enrichSignalResult(result, now)
    const ageDays = typeof enriched.metadata.ageDays === 'number' ? enriched.metadata.ageDays : null
    if (ageDays !== null) {
      oldestStoredAgeDays = oldestStoredAgeDays === null ? ageDays : Math.max(oldestStoredAgeDays, ageDays)
    }
  }

  let oldestActiveResultAgeDays: number | null = null
  let freshAcceptedCount = 0
  let recentAcceptedCount = 0
  for (const result of active) {
    const status = result.metadata.freshnessStatus
    const ageDays = typeof result.metadata.ageDays === 'number' ? result.metadata.ageDays : null
    if (status === 'LIVE') freshAcceptedCount += 1
    if (status === 'RECENT') recentAcceptedCount += 1
    if (ageDays !== null) {
      oldestActiveResultAgeDays = oldestActiveResultAgeDays === null ? ageDays : Math.max(oldestActiveResultAgeDays, ageDays)
    }
  }

  return {
    freshAcceptedCount,
    recentAcceptedCount,
    staleSuppressedCount: Math.max(0, stored.length - active.length),
    oldestActiveResultAgeDays,
    oldestStoredResultAgeDays: oldestStoredAgeDays,
    cacheFilteredCount: Math.max(0, stored.length - active.length),
  }
}

export function isActiveNewsPublishedAt(publishedAt: string | null, provider?: SignalProviderId): boolean {
  const freshness = evaluateFreshness(publishedAt, {
    maxAgeDays: LIVE_SIGNAL_MAX_AGE_DAYS,
    provider: provider ?? 'rss',
  })
  return freshness.acceptedForLiveSignal && isActiveFreshnessStatus(freshness.status)
}

export function newsCardDisplayLabel(input: {
  sourceStatus: SignalSourceStatus
  freshnessStatus: SignalFreshnessStatus
  operationalStatus: SignalOperationalStatus
}): string {
  return signalCardDisplayLabel({
    sourceStatus: input.sourceStatus,
    freshnessStatus: input.freshnessStatus,
    operationalStatus: input.operationalStatus,
  })
}
