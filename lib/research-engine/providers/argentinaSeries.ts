import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'argentina_series' as const
const BASE_URL = 'https://apis.datos.gob.ar/series/api/series/'
const SERIES_ID_PATTERN = /^[A-Za-z0-9._-]{3,80}$/
const DEFAULT_SERIES = '168.1_T_CAMBIOR_D_0_0_26' // BCRA reference exchange rate

type SeriesMeta = { catalog?: { title?: string }; dataset?: { title?: string; description?: string; source?: string } }
type SeriesResponse = { data?: (string | number)[][]; meta?: [{ frequency?: string; start_date?: string; end_date?: string }, SeriesMeta] }

/** Query text is a datos.gob.ar series ID; defaults to the BCRA reference exchange rate series if not recognized. */
function resolveSeriesId(text: string): string {
  const trimmed = text.trim()
  return SERIES_ID_PATTERN.test(trimmed) ? trimmed : DEFAULT_SERIES
}

async function fetchSeries(query: ResearchQuery) {
  const started = Date.now()
  const seriesId = resolveSeriesId(query.text)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, 25))
  const cacheKey = `argentina_series:${seriesId}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('ids', seriesId)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('format', 'json')
  url.searchParams.set('sort', 'desc')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SeriesResponse>(result.text)
  if (!data || !Array.isArray(data.data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Argentina Series API response "data" field was missing or not an array.' }
  }

  const meta = data.meta?.[1]
  const title = meta?.dataset?.title ?? seriesId
  const canonicalUrl = `https://datos.gob.ar/series/api/series/?ids=${encodeURIComponent(seriesId)}`
  const documents = data.data.map(([date, value], index) => makeDocument({
    id: `argentina_series:${seriesId}:${date}`,
    provider: PROVIDER,
    providerRecordId: `${seriesId}:${index}`,
    title: `${title} — ${date}`,
    summary: meta?.dataset?.description ?? null,
    contentSnippet: `Value: ${value}`,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: meta?.dataset?.source ?? 'Argentina Series de Tiempo (datos.gob.ar)',
    contentType: 'economic_time_series_point',
    authors: [],
    organization: meta?.catalog?.title ?? 'Argentina Ministerio de Economía',
    publishedAt: String(date),
    updatedAt: null,
    geography: 'AR',
    language: 'es',
    identifiers: { argentina_series_id: seriesId },
    subjects: [],
    license: null,
    accessStatus: 'open',
  }))
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await fetchSeries(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Argentina Series fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?ids=${DEFAULT_SERIES}&limit=1&format=json`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'series endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const argentinaSeriesAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
