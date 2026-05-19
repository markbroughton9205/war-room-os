import type { SignalFreshnessStatus, SignalProviderId, SignalRawItem, SignalResult } from './model'

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
  publishedAt: string | null
  ageDays: number | null
  acceptedForLiveSignal: boolean
  recencyPenalty: number
}

export type FreshnessCounters = {
  maxAgeDays: number
  accepted: number
  live: number
  recent: number
  staleDiscarded: number
  unknownDateDiscarded: number
  oldestAcceptedAgeDays: number | null
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

function parsePublicationDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function statusForAge(ageDays: number): SignalFreshnessStatus {
  if (ageDays <= 7) return 'LIVE'
  if (ageDays <= LIVE_SIGNAL_MAX_AGE_DAYS) return 'RECENT'
  return 'STALE'
}

function penaltyForAge(ageDays: number): number {
  if (ageDays <= 7) return 0
  if (ageDays <= 14) return 5
  if (ageDays <= LIVE_SIGNAL_MAX_AGE_DAYS) return 14
  return 100
}

export function evaluateFreshness(
  publishedAt: unknown,
  options?: { now?: Date; maxAgeDays?: number },
): FreshnessEvaluation {
  const maxAgeDays = resolveMaxAgeDays(options?.maxAgeDays)
  const parsed = parsePublicationDate(publishedAt)
  if (!parsed) {
    return {
      status: 'UNKNOWN_DATE',
      publishedAt: null,
      ageDays: null,
      acceptedForLiveSignal: false,
      recencyPenalty: 100,
    }
  }

  const now = options?.now ?? new Date()
  const ageDays = Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / DAY_MS))
  const status = statusForAge(ageDays)
  return {
    status,
    publishedAt: parsed.toISOString(),
    ageDays,
    acceptedForLiveSignal: status !== 'STALE' && ageDays <= Math.min(maxAgeDays, LIVE_SIGNAL_MAX_AGE_DAYS),
    recencyPenalty: penaltyForAge(ageDays),
  }
}

export function withFreshnessMetadata(
  metadata: Record<string, unknown> | undefined,
  freshness: FreshnessEvaluation,
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    publishedAt: freshness.publishedAt,
    freshnessStatus: freshness.status,
    ageDays: freshness.ageDays,
    recencyPenalty: freshness.recencyPenalty,
  }
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
    if (freshness.status === 'STALE') counters.staleDiscarded += 1
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
    liveCount: counters.live,
    recentCount: counters.recent,
    staleDiscardedCount: counters.staleDiscarded,
    unknownDateDiscardedCount: counters.unknownDateDiscarded,
    oldestAcceptedAgeDays: counters.oldestAcceptedAgeDays,
    staleDiscarded: counters.staleDiscarded,
  }
}

function resultPublicationDate(result: SignalResult): unknown {
  return result.metadata.publishedAt
    ?? result.metadata.webPublicationDate
    ?? result.metadata.pubDate
    ?? result.metadata.updated
}

export function isNewsLikeProvider(provider: SignalProviderId): boolean {
  return provider === 'guardian' || provider === 'newsapi' || provider === 'rss'
}

export function isLiveSignalResult(result: SignalResult): boolean {
  const status = result.metadata.freshnessStatus
  if (status === 'STALE' || status === 'UNKNOWN_DATE') return false
  if (status === 'LIVE' || status === 'RECENT') return true
  if (!isNewsLikeProvider(result.provider)) return true

  const freshness = evaluateFreshness(resultPublicationDate(result), {
    maxAgeDays: maxAgeDaysForProvider(result.provider),
  })
  return freshness.acceptedForLiveSignal
}

export function recencyPenaltyForItem(item: SignalRawItem): number {
  const value = item.metadata?.recencyPenalty
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}
