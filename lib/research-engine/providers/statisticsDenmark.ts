import 'server-only'

import type { ResearchHealthStatus, ResearchQuery, ResearchTimeSeriesPoint } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, resolveBaseUrl } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'
import { flattenJsonStat2, parseTableOverride, type JsonStat2Dataset } from '@/lib/research-engine/providers/pxwebShared'

/**
 * Statistics Denmark's own StatBank Data API (api.statbank.dk) — related to, but a genuinely
 * different protocol from, the classic PxWebApi hosts this file's siblings (scbSweden.ts,
 * ssbNorway.ts, statfinFinland.ts) use: table discovery is a plain GET
 * /v1/tableinfo/{id}?lang=en (id/text value pairs, not PxWeb's parallel values/valueTexts
 * arrays), and the data query is POST /v1/data with a `{table, format, variables}` body rather
 * than PxWeb's `{query, response}` shape. Only the response payload converges — Denmark's is the
 * same JSON-stat2 dataset shape (https://json-stat.org/format/) as the others, nested one level
 * deeper under a `dataset` key — so only `flattenJsonStat2` is reused from pxwebShared.ts.
 *
 * Confirmed live during this mission: omitting every dimension except Tid (time) from the query
 * returns Denmark's own real national aggregate for that dimension directly (every eliminable
 * dimension here lists a real "Total"/"All Denmark" code first and defaults to it when omitted),
 * so no per-dimension code guessing is needed — a genuine, verified property of this specific
 * API, not assumed from the sibling PxWebApi hosts' different omission behavior.
 */
const PROVIDER = 'statistics_denmark' as const
const DEFAULT_TABLE = 'folk1a'
const PERIODS = 5

type DenmarkTableInfoVariable = { id: string; elimination?: boolean; values: { id: string; text: string }[] }
type DenmarkTableInfo = { id: string; text: string; variables: DenmarkTableInfoVariable[] }

function baseUrl(): string {
  const descriptor = providerEnvDescriptor(PROVIDER)
  return (descriptor && resolveBaseUrl('STATISTICS_DENMARK_API_BASE_URL', descriptor)) || 'https://api.statbank.dk/v1'
}

async function fetchTableInfo(table: string): Promise<DenmarkTableInfo | null> {
  const result = await safeProviderFetch(PROVIDER, `${baseUrl()}/tableinfo/${encodeURIComponent(table)}?lang=en`, { timeoutMs: 12_000 })
  if (!result.ok) return null
  const data = safeJsonParse<DenmarkTableInfo>(result.text)
  if (!data || !Array.isArray(data.variables)) return null
  return data
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const table = (parseTableOverride(query.text) ?? DEFAULT_TABLE).toLowerCase()
  const cacheKey = `statistics_denmark:${table}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const info = await fetchTableInfo(table)
  if (!info) return { ok: false as const, message: `Could not read Statistics Denmark table info for "${table}". Use "table <id>" with a real table id, e.g. table folk1a.` }

  const tidVariable = info.variables.find(v => v.id === 'Tid')
  if (!tidVariable) return { ok: false as const, message: `Table "${table}" has no Tid (time) dimension — this adapter only supports time-indexed tables.` }
  const recentPeriods = tidVariable.values.slice(-PERIODS).map(v => v.id)

  const result = await safeProviderFetch(PROVIDER, `${baseUrl()}/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ table, format: 'JSONSTAT', lang: 'en', variables: [{ code: 'Tid', values: recentPeriods }] }),
    timeoutMs: 15_000,
  })
  if (!result.ok) return { ok: false as const, message: `Statistics Denmark data query failed with HTTP ${result.status}` }
  const raw = safeJsonParse<{ dataset?: { dimension: Record<string, unknown>; value: (number | null)[] } }>(result.text)
  if (!raw?.dataset || typeof raw.dataset.dimension !== 'object') return { ok: false as const, message: 'Statistics Denmark response was not a recognizable JSON-stat2 dataset.' }

  // Confirmed live during this mission: unlike the classic PxWebApi hosts, Statistics Denmark
  // nests `id`/`size`/`role` as extra sibling keys INSIDE `dataset.dimension` itself, alongside
  // the real per-dimension entries — not at the dataset root where the JSON-stat2 spec (and every
  // other host this file's siblings talk to) places them. Extracted here, once, rather than
  // teaching the shared flattenJsonStat2 about this one host's non-conformant shape.
  const rawDimension = raw.dataset.dimension
  const id = Array.isArray((rawDimension as { id?: unknown }).id) ? (rawDimension as { id: string[] }).id : Object.keys(rawDimension).filter(key => !['id', 'size', 'role'].includes(key))
  const dimension = Object.fromEntries(id.map(dimId => [dimId, rawDimension[dimId as keyof typeof rawDimension]])) as JsonStat2Dataset['dimension']
  const dataset: JsonStat2Dataset = { id, dimension, value: raw.dataset.value }

  const cells = flattenJsonStat2(dataset)
  const points: ResearchTimeSeriesPoint[] = cells.map(cell => ({
    date: cell.labels.Tid ?? 'unknown',
    value: cell.value,
    note: Object.entries(cell.labels)
      .filter(([code]) => code !== 'Tid')
      .map(([, label]) => label)
      .join('; ') || null,
  }))

  const documents = [makeDocument({
    id: `statistics_denmark:${table}`,
    provider: PROVIDER,
    providerRecordId: table,
    title: info.text || `Statistics Denmark table ${table}`,
    summary: `Statistics Denmark (Danmarks Statistik) StatBank table ${table}.`,
    contentSnippet: null,
    canonicalUrl: `${baseUrl()}/tableinfo/${table}?lang=en`,
    sourceUrl: `${baseUrl()}/tableinfo/${table}?lang=en`,
    sourceName: 'Statistics Denmark (Danmarks Statistik)',
    contentType: 'national_statistics_table',
    authors: [],
    organization: 'Danmarks Statistik',
    publishedAt: null,
    updatedAt: null,
    geography: 'Denmark',
    language: 'en',
    identifiers: { statistics_denmark_table_id: table },
    subjects: [],
    license: null,
    accessStatus: 'open',
  })]

  const timeSeries = [{ seriesId: `statistics_denmark:${table}`, title: info.text || table, unit: null, frequency: null, points }]

  const response = okResponse(PROVIDER, { documents, timeSeries, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${baseUrl()}/tableinfo/${DEFAULT_TABLE}?lang=en`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'table info endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const statisticsDenmarkAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
