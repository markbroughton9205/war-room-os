import 'server-only'

import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'
import type { SignalCategory, SignalResult, SignalSourceDefinition } from '../model'
import { insertResults, upsertSources } from '../persistence'
import type { RssFeedPollDiagnostics } from './runtime'

export type RssSourcePollRow = {
  id: string
  label: string
  url: string | null
  configured: boolean
  enabled: boolean
  pollIntervalMinutes: number | null
  lastPollAt: string | null
  lastSuccessAt: string | null
  lastErrorAt: string | null
  lastItemCount: number | null
  staleFeedDetection: boolean
  lastErrorMessage: string
  categories: SignalCategory[]
  reliabilityScore: number
  notes: string
}

type Row = Record<string, unknown>

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function bool(value: unknown, fallback = false): boolean {
  if (value === true || value === false) return value
  if (value === null || value === undefined) return fallback
  return value === 'true'
}

function arrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : []
}

function rssDiagnosticsColumnMissing(message: string): boolean {
  return /last_poll_at|poll_interval_minutes|enabled|column .* does not exist/i.test(message)
}

export function mapRssSourcePollRow(row: Row): RssSourcePollRow {
  return {
    id: text(row.id),
    label: text(row.label),
    url: nullableText(row.url),
    configured: bool(row.configured),
    enabled: row.enabled === undefined ? bool(row.configured, true) : bool(row.enabled, true),
    pollIntervalMinutes: row.poll_interval_minutes === null || row.poll_interval_minutes === undefined
      ? null
      : num(row.poll_interval_minutes),
    lastPollAt: nullableText(row.last_poll_at),
    lastSuccessAt: nullableText(row.last_success_at),
    lastErrorAt: nullableText(row.last_error_at),
    lastItemCount: row.last_item_count === null || row.last_item_count === undefined
      ? null
      : num(row.last_item_count, 0),
    staleFeedDetection: bool(row.stale_feed_detection),
    lastErrorMessage: text(row.last_error_message),
    categories: arrayValue(row.categories) as RssSourcePollRow['categories'],
    reliabilityScore: num(row.reliability_score, 0),
    notes: text(row.notes),
  }
}

export async function loadRssSourcesForPoll(): Promise<RssSourcePollRow[]> {
  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) return []

  const { data, error } = await supabase.client
    .from('war_room_signal_sources')
    .select('*')
    .eq('provider', 'rss')
    .order('label', { ascending: true })

  if (error) {
    if (rssDiagnosticsColumnMissing(error.message)) {
      const fallback = await supabase.client
        .from('war_room_signal_sources')
        .select('*')
        .eq('provider', 'rss')
        .order('label', { ascending: true })
      if (fallback.error) return []
      return ((fallback.data ?? []) as Row[]).map(mapRssSourcePollRow)
    }
    return []
  }

  return ((data ?? []) as Row[]).map(mapRssSourcePollRow)
}

async function updateRssSourceDiagnostics(
  client: WarRoomSupabase,
  sources: RssSourcePollRow[],
  feedDiagnostics: RssFeedPollDiagnostics[],
): Promise<void> {
  const diagnosticById = new Map(feedDiagnostics.map(feed => [feed.sourceId, feed]))
  const payload = sources.map(source => {
    const feed = diagnosticById.get(source.id)
    const base: Record<string, unknown> = {
      id: source.id,
      label: source.label,
      provider: 'rss',
      kind: 'rss',
      categories: source.categories,
      url: source.url,
      query: null,
      configured: source.configured,
      reliability_score: source.reliabilityScore,
      notes: source.notes,
    }
    if (!feed || feed.status === 'skipped') return base
    return {
      ...base,
      enabled: source.enabled,
      poll_interval_minutes: source.pollIntervalMinutes,
      last_poll_at: feed.lastPollAt,
      last_success_at: feed.lastSuccessAt,
      last_error_at: feed.lastErrorAt,
      last_item_count: feed.itemCount,
      stale_feed_detection: feed.staleFeedDetection,
      last_error_message: feed.error ?? '',
    }
  })

  const { error } = await client
    .from('war_room_signal_sources')
    .upsert(payload, { onConflict: 'id' })

  if (error && rssDiagnosticsColumnMissing(error.message)) {
    await upsertSources(client, sources.map(source => ({
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
    })))
    return
  }
  if (error) throw new Error(error.message)
}

export async function persistRssPollResults(input: {
  sources: RssSourcePollRow[]
  feedDiagnostics: RssFeedPollDiagnostics[]
  results: SignalResult[]
  scanId: string
  startedAt: string
}): Promise<{ persistenceAvailable: boolean; persistenceNote: string; client: WarRoomSupabase | null }> {
  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) {
    return {
      persistenceAvailable: false,
      persistenceNote: `Supabase unavailable; RSS poll completed in memory only: ${supabase.configError}`,
      client: null,
    }
  }

  const sourceDefinitions: SignalSourceDefinition[] = input.sources.map(source => ({
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
  }))

  await upsertSources(supabase.client, sourceDefinitions)
  await updateRssSourceDiagnostics(supabase.client, input.sources, input.feedDiagnostics)
  await insertResults(supabase.client, input.results.map(result => ({ ...result, scanId: input.scanId })))

  return {
    persistenceAvailable: true,
    persistenceNote: 'RSS poll results and source diagnostics persisted server-side.',
    client: supabase.client,
  }
}
