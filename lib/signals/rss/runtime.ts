import 'server-only'

import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import type { SignalRawItem, SignalResult, SignalSourceDefinition } from '../model'
import { getSignalSources } from '../sources'
import { applySignalClassificationPipeline } from '../classification'
import { dedupeAndRankSignals, scoreSignalItem } from '../scoring'
import { dedupeRssInputs } from './dedupe'
import { normalizeRssFeedItems, toSignalRawItem } from './normalize'
import { parseRssXml } from './parser'
import { loadRssSourcesForPoll, persistRssPollResults, type RssSourcePollRow } from './persistence'

export const RSS_FETCH_TIMEOUT_MS = 12_000
export const RSS_DEFAULT_POLL_INTERVAL_MINUTES = 10
export const RSS_MIN_POLL_INTERVAL_MINUTES = 5
export const RSS_MAX_POLL_INTERVAL_MINUTES = 15

export type RssFeedPollDiagnostics = {
  sourceId: string
  label: string
  feedUrl: string
  status: 'success' | 'error' | 'skipped' | 'timeout'
  itemCount: number
  persistedCount: number
  staleFeedDetection: boolean
  error: string | null
  lastPollAt: string | null
  lastSuccessAt: string | null
  lastErrorAt: string | null
}

export type RssIngestionPollResult = {
  ok: boolean
  startedAt: string
  completedAt: string
  pollIntervalMinutes: number
  sourcesEligible: number
  sourcesPolled: number
  sourcesSkippedInterval: number
  itemsNormalized: number
  itemsPersisted: number
  feeds: RssFeedPollDiagnostics[]
  error: string | null
  persistenceAvailable: boolean
  persistenceNote: string
}

export type RssIngestionRuntimeStatus = {
  generatedAt: string
  configuredFeedCount: number
  enabledFeedCount: number
  pollIntervalMinutes: number
  aggregateHealth: 'healthy' | 'degraded' | 'unavailable' | 'unknown'
  lastPollAt: string | null
  lastSuccessAt: string | null
  lastErrorAt: string | null
  staleFeedCount: number
  feeds: Array<{
    sourceId: string
    label: string
    feedUrl: string | null
    configured: boolean
    enabled: boolean
    health: 'healthy' | 'degraded' | 'unavailable' | 'unknown'
    lastPollAt: string | null
    lastSuccessAt: string | null
    lastErrorAt: string | null
    lastItemCount: number | null
    staleFeedDetection: boolean
    lastErrorMessage: string | null
  }>
  guardrails: {
    serverSideOnly: true
    noFakeHealthyOnFailure: true
    browserFetchDisabled: true
  }
}

export function resolvePollIntervalMinutes(source?: Pick<RssSourcePollRow, 'pollIntervalMinutes'>): number {
  const fromSource = source?.pollIntervalMinutes
  if (typeof fromSource === 'number' && Number.isFinite(fromSource)) {
    return Math.max(RSS_MIN_POLL_INTERVAL_MINUTES, Math.min(RSS_MAX_POLL_INTERVAL_MINUTES, Math.round(fromSource)))
  }
  const fromEnv = process.env.RSS_POLL_INTERVAL_MINUTES?.trim()
  if (fromEnv) {
    const parsed = Number(fromEnv)
    if (Number.isFinite(parsed)) {
      return Math.max(RSS_MIN_POLL_INTERVAL_MINUTES, Math.min(RSS_MAX_POLL_INTERVAL_MINUTES, Math.round(parsed)))
    }
  }
  return RSS_DEFAULT_POLL_INTERVAL_MINUTES
}

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /timeout|aborted|abort/i.test(message)
}

async function fetchFeedXml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/rss+xml, application/xml, text/xml',
      'User-Agent': 'WarRoomRssIngestion/1.0',
    },
    signal: AbortSignal.timeout(RSS_FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`RSS feed returned HTTP ${response.status}`)
  return response.text()
}

function shouldPollSource(source: RssSourcePollRow, now: Date, force: boolean): boolean {
  if (force) return true
  if (!source.lastPollAt) return true
  const last = new Date(source.lastPollAt)
  if (!Number.isFinite(last.getTime())) return true
  const intervalMs = resolvePollIntervalMinutes(source) * 60_000
  return now.getTime() - last.getTime() >= intervalMs
}

function staleFeedDetection(
  source: RssSourcePollRow,
  pollSucceeded: boolean,
  now: Date,
): boolean {
  if (!pollSucceeded) return Boolean(source.staleFeedDetection)
  const lastSuccess = source.lastSuccessAt ? new Date(source.lastSuccessAt) : null
  if (!lastSuccess || !Number.isFinite(lastSuccess.getTime())) return false
  const staleAfterMs = resolvePollIntervalMinutes(source) * 60_000 * 3
  return now.getTime() - lastSuccess.getTime() > staleAfterMs
}

export async function pollRssFeed(
  source: SignalSourceDefinition,
  signalIngestedAt: string,
): Promise<{ items: SignalRawItem[]; itemCount: number; error: string | null; timedOut: boolean }> {
  if (!source.url) {
    return { items: [], itemCount: 0, error: 'RSS source has no feed URL', timedOut: false }
  }
  try {
    const xml = await fetchFeedXml(source.url)
    const parsed = parseRssXml(xml)
    const normalized = normalizeRssFeedItems(parsed, source, signalIngestedAt)
    const deduped = dedupeRssInputs(normalized)
    const items = deduped.filter(item => item.persistable).map(toSignalRawItem)
    return { items, itemCount: parsed.length, error: null, timedOut: false }
  } catch (error) {
    return {
      items: [],
      itemCount: 0,
      error: error instanceof Error ? error.message : String(error),
      timedOut: isTimeoutError(error),
    }
  }
}

export function mergeRssSources(
  dbSources: RssSourcePollRow[],
  registrySources: SignalSourceDefinition[],
): RssSourcePollRow[] {
  const byId = new Map<string, RssSourcePollRow>()
  for (const row of dbSources) byId.set(row.id, row)
  for (const source of registrySources.filter(s => s.provider === 'rss' && s.url && s.configured)) {
    if (!byId.has(source.id)) {
      byId.set(source.id, {
        id: source.id,
        label: source.label,
        url: source.url,
        configured: source.configured,
        enabled: true,
        pollIntervalMinutes: null,
        lastPollAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastItemCount: null,
        staleFeedDetection: false,
        lastErrorMessage: '',
        categories: source.categories,
        reliabilityScore: source.reliabilityScore,
        notes: source.notes,
      })
    }
  }
  return [...byId.values()].filter(source => source.enabled && source.configured && source.url)
}

export async function runRssIngestionPoll(options?: { force?: boolean }): Promise<RssIngestionPollResult> {
  const startedAt = new Date().toISOString()
  const now = new Date()
  const force = Boolean(options?.force)
  const pollIntervalMinutes = resolvePollIntervalMinutes()
  const registrySources = getSignalSources().filter(s => s.provider === 'rss')
  const dbSources = await loadRssSourcesForPoll()
  const sources = mergeRssSources(dbSources, registrySources)

  if (!sources.length) {
    return {
      ok: false,
      startedAt,
      completedAt: new Date().toISOString(),
      pollIntervalMinutes,
      sourcesEligible: 0,
      sourcesPolled: 0,
      sourcesSkippedInterval: 0,
      itemsNormalized: 0,
      itemsPersisted: 0,
      feeds: [],
      error: 'No enabled RSS sources are configured',
      persistenceAvailable: false,
      persistenceNote: 'Configure NEWS_RSS_FEEDS or enable RSS rows in war_room_signal_sources.',
    }
  }

  const scanId = `rss-poll-${startedAt.replace(/[^0-9]/g, '').slice(0, 14)}`
  const rawItems: SignalRawItem[] = []
  const feedDiagnostics: RssFeedPollDiagnostics[] = []
  let sourcesSkippedInterval = 0

  for (const source of sources) {
    const pollAt = new Date().toISOString()
    if (!shouldPollSource(source, now, force)) {
      sourcesSkippedInterval += 1
      feedDiagnostics.push({
        sourceId: source.id,
        label: source.label,
        feedUrl: source.url ?? '',
        status: 'skipped',
        itemCount: source.lastItemCount ?? 0,
        persistedCount: 0,
        staleFeedDetection: source.staleFeedDetection,
        error: null,
        lastPollAt: source.lastPollAt,
        lastSuccessAt: source.lastSuccessAt,
        lastErrorAt: source.lastErrorAt,
      })
      continue
    }

    const definition: SignalSourceDefinition = {
      id: source.id,
      label: source.label,
      provider: 'rss',
      kind: 'rss',
      categories: source.categories,
      url: source.url,
      query: null,
      configured: source.configured,
      reliabilityScore: source.reliabilityScore,
      notes: source.notes,
    }

    const poll = await pollRssFeed(definition, pollAt)
    const success = !poll.error
    const lastSuccessAt = success ? pollAt : source.lastSuccessAt
    const lastErrorAt = poll.error ? pollAt : source.lastErrorAt
    const stale = staleFeedDetection(source, success, now)

    feedDiagnostics.push({
      sourceId: source.id,
      label: source.label,
      feedUrl: source.url ?? '',
      status: poll.timedOut ? 'timeout' : poll.error ? 'error' : 'success',
      itemCount: poll.itemCount,
      persistedCount: poll.items.length,
      staleFeedDetection: stale,
      error: poll.error,
      lastPollAt: pollAt,
      lastSuccessAt,
      lastErrorAt,
    })

    source.lastPollAt = pollAt
    source.lastSuccessAt = lastSuccessAt
    source.lastErrorAt = lastErrorAt
    source.lastItemCount = poll.itemCount
    source.staleFeedDetection = stale
    source.lastErrorMessage = poll.error ?? ''

    if (poll.items.length) rawItems.push(...poll.items)
  }

  const scored = dedupeAndRankSignals(rawItems.map(item => scoreSignalItem(item, scanId)))
  const classified = applySignalClassificationPipeline(scored, { sources: registrySources })
  const results: SignalResult[] = classified.results

  const persistence = await persistRssPollResults({
    sources,
    feedDiagnostics,
    results,
    scanId,
    startedAt,
  })

  const completedAt = new Date().toISOString()
  const sourcesPolled = feedDiagnostics.filter(feed => feed.status !== 'skipped').length
  const pollOk = sourcesPolled > 0 && feedDiagnostics.some(feed => feed.status === 'success')

  if (persistence.client) {
    await insertWarRoomAuditLog(persistence.client, {
      actor: 'system',
      category: 'runtime',
      action_id: 'rss_ingestion_poll',
      message: `RSS ingestion poll ${pollOk ? 'completed' : 'degraded'}: ${results.length} results from ${sourcesPolled} feeds.`,
      metadata: {
        sourcesEligible: sources.length,
        sourcesPolled,
        sourcesSkippedInterval,
        itemsPersisted: results.length,
        failures: feedDiagnostics.filter(feed => feed.status === 'error' || feed.status === 'timeout').length,
      },
    })
  }

  return {
    ok: pollOk,
    startedAt,
    completedAt,
    pollIntervalMinutes,
    sourcesEligible: sources.length,
    sourcesPolled,
    sourcesSkippedInterval,
    itemsNormalized: rawItems.length,
    itemsPersisted: results.length,
    feeds: feedDiagnostics,
    error: pollOk ? null : 'No RSS feeds returned successful polls in this cycle',
    persistenceAvailable: persistence.persistenceAvailable,
    persistenceNote: persistence.persistenceNote,
  }
}

export async function getRssIngestionRuntimeStatus(): Promise<RssIngestionRuntimeStatus> {
  const generatedAt = new Date().toISOString()
  const pollIntervalMinutes = resolvePollIntervalMinutes()
  const registrySources = getSignalSources().filter(s => s.provider === 'rss')
  const dbSources = await loadRssSourcesForPoll()
  const sources = mergeRssSources(dbSources, registrySources)

  const feeds = sources.map(source => {
    const pollFailed = Boolean(source.lastErrorAt && source.lastErrorAt >= (source.lastSuccessAt ?? ''))
    const health: RssIngestionRuntimeStatus['aggregateHealth'] =
      !source.configured || !source.enabled
        ? 'unavailable'
        : source.staleFeedDetection || pollFailed
          ? 'degraded'
          : source.lastSuccessAt
            ? 'healthy'
            : 'unknown'
    return {
      sourceId: source.id,
      label: source.label,
      feedUrl: source.url,
      configured: source.configured,
      enabled: source.enabled,
      health,
      lastPollAt: source.lastPollAt,
      lastSuccessAt: source.lastSuccessAt,
      lastErrorAt: source.lastErrorAt,
      lastItemCount: source.lastItemCount,
      staleFeedDetection: source.staleFeedDetection,
      lastErrorMessage: source.lastErrorMessage || null,
    }
  })

  const lastPollAt = feeds.map(feed => feed.lastPollAt).filter(Boolean).sort().reverse()[0] ?? null
  const lastSuccessAt = feeds.map(feed => feed.lastSuccessAt).filter(Boolean).sort().reverse()[0] ?? null
  const lastErrorAt = feeds.map(feed => feed.lastErrorAt).filter(Boolean).sort().reverse()[0] ?? null
  const staleFeedCount = feeds.filter(feed => feed.staleFeedDetection).length
  const configuredFeedCount = feeds.filter(feed => feed.configured).length
  const enabledFeedCount = feeds.filter(feed => feed.enabled && feed.configured).length

  let aggregateHealth: RssIngestionRuntimeStatus['aggregateHealth'] = 'unknown'
  if (!enabledFeedCount) aggregateHealth = 'unavailable'
  else if (feeds.some(feed => feed.health === 'healthy')) {
    aggregateHealth = feeds.some(feed => feed.health === 'degraded') ? 'degraded' : 'healthy'
  } else if (feeds.every(feed => feed.health === 'degraded')) aggregateHealth = 'degraded'
  else aggregateHealth = 'unavailable'

  return {
    generatedAt,
    configuredFeedCount,
    enabledFeedCount,
    pollIntervalMinutes,
    aggregateHealth,
    lastPollAt,
    lastSuccessAt,
    lastErrorAt,
    staleFeedCount,
    feeds,
    guardrails: {
      serverSideOnly: true,
      noFakeHealthyOnFailure: true,
      browserFetchDisabled: true,
    },
  }
}
