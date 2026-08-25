import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'abs_australia' as const
const BASE_URL = 'https://data.api.abs.gov.au/rest/data'
const DATAFLOW_PATTERN = /^[A-Z0-9_]{2,30}$/i
const DEFAULT_DATAFLOW = 'CPI'

type ObsDimValue = { id?: string; name?: string }
type ObsDim = { id?: string; values?: ObsDimValue[] }
type Structure = { dimensions?: { observation?: ObsDim[] } }
type SdmxResponse = {
  data?: {
    dataSets?: { series?: Record<string, { observations?: Record<string, number[]> }> }[]
    structures?: Structure[]
  }
}

/** Query text is a bare ABS dataflow ID (e.g. "CPI"); qualified IDs like "ABS,CPI,1.0.0" 404 (confirmed live). */
function resolveDataflow(text: string): string {
  const trimmed = text.trim()
  return DATAFLOW_PATTERN.test(trimmed) ? trimmed.toUpperCase() : DEFAULT_DATAFLOW
}

async function fetchSeries(query: ResearchQuery) {
  const started = Date.now()
  const dataflow = resolveDataflow(query.text)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, 25))
  const cacheKey = `abs_australia:${dataflow}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/${dataflow}/all?startPeriod=${new Date().getFullYear() - 1}&format=json`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SdmxResponse>(result.text)
  const seriesMap = data?.data?.dataSets?.[0]?.series
  const dateValues = data?.data?.structures?.[0]?.dimensions?.observation?.find(d => d.id === 'TIME_PERIOD')?.values
  if (!seriesMap || !dateValues) {
    return { ok: false as const, kind: 'malformed' as const, message: 'ABS response did not contain the expected SDMX-JSON dataSets/structures shape.' }
  }

  const firstSeriesKey = Object.keys(seriesMap)[0]
  const observations = firstSeriesKey ? seriesMap[firstSeriesKey]?.observations : undefined
  if (!observations) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const canonicalUrl = `https://explore.data.abs.gov.au/${dataflow}`
  const documents = Object.entries(observations)
    .slice(-limit)
    .map(([idx, values]) => {
      const dateLabel = dateValues[Number(idx)]?.id ?? dateValues[Number(idx)]?.name ?? idx
      const value = Array.isArray(values) ? values[0] : null
      if (typeof value !== 'number') return null
      return makeDocument({
        id: `abs_australia:${dataflow}:${dateLabel}`,
        provider: PROVIDER,
        providerRecordId: `${dataflow}:${dateLabel}`,
        title: `${dataflow} — ${dateLabel}`,
        summary: `Value: ${value}`,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Australian Bureau of Statistics Data API',
        contentType: 'economic_time_series_point',
        authors: [],
        organization: 'Australian Bureau of Statistics',
        publishedAt: String(dateLabel),
        updatedAt: null,
        geography: 'AU',
        language: 'en',
        identifiers: { abs_dataflow: dataflow },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
    .filter((doc): doc is NonNullable<typeof doc> => doc !== null)
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await fetchSeries(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`ABS Australia fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${DEFAULT_DATAFLOW}/all?startPeriod=${new Date().getFullYear() - 1}&format=json`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'data endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const absAustraliaAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
