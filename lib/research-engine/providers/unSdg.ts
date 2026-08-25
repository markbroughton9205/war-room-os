import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'un_sdg' as const
const BASE_URL = 'https://unstats.un.org/SDGAPI/v1/sdg/Series/Data'
const MAX_RESULTS = 25
const DEFAULT_SERIES_CODE = 'SI_POV_DAY1' // poverty headcount ratio at $1.90/day

type DataRow = {
  series?: string
  seriesDescription?: string
  geoAreaCode?: string
  geoAreaName?: string
  timePeriodStart?: number
  value?: string | number
  source?: string
}
type SeriesResponse = { data?: DataRow[] }

/** Query text is an SDG series code (e.g. "SI_POV_DAY1"); free text falls back to the default. */
function resolveSeriesCode(text: string): string {
  const trimmed = text.trim().toUpperCase()
  return /^[A-Z0-9_]{3,40}$/.test(trimmed) ? trimmed : DEFAULT_SERIES_CODE
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const seriesCode = resolveSeriesCode(query.text)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `un_sdg:${seriesCode}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('seriesCode', seriesCode)
  url.searchParams.set('pageSize', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SeriesResponse>(result.text)
  if (!data || !Array.isArray(data.data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'UN SDG API response "data" field was missing or not an array.' }
  }

  const canonicalUrl = `https://unstats.un.org/sdgs/dataportal`
  const documents = data.data
    .slice(0, limit)
    .map((row, index) => {
      const rowId = `${seriesCode}:${row.geoAreaCode ?? index}:${row.timePeriodStart ?? ''}`
      return makeDocument({
        id: `un_sdg:${rowId}`,
        provider: PROVIDER,
        providerRecordId: rowId,
        title: row.seriesDescription ?? seriesCode,
        summary: `${row.geoAreaName ?? row.geoAreaCode ?? 'unknown area'}: ${row.value ?? 'n/a'}`,
        contentSnippet: row.source ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'UN SDG Global Database',
        contentType: 'sdg_indicator_value',
        authors: [],
        organization: 'UN Statistics Division',
        publishedAt: row.timePeriodStart ? String(row.timePeriodStart) : null,
        updatedAt: null,
        geography: row.geoAreaName ?? row.geoAreaCode ?? null,
        language: 'en',
        identifiers: { un_sdg_series: seriesCode, ...(row.geoAreaCode ? { geo_area_code: row.geoAreaCode } : {}) },
        subjects: ['sustainable_development_goals'],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`UN SDG search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?seriesCode=${DEFAULT_SERIES_CODE}&pageSize=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'series data endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const unSdgAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
