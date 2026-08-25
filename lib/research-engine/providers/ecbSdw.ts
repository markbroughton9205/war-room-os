import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ecb_sdw' as const
const BASE_URL = 'https://data-api.ecb.europa.eu/service/data'
const MAX_RESULTS = 20
const DEFAULT_SERIES = 'EXR/D.USD.EUR.SP00.A' // ECB reference exchange rate, USD/EUR daily

type SdmxObservationDim = { id?: string; name?: string; values?: { id?: string; name?: string }[] }
type SdmxResponse = {
  dataSets?: { series?: Record<string, { observations?: Record<string, number[]> }> }[]
  structure?: { dimensions?: { observation?: SdmxObservationDim[] } }
}

/** Query text is "<flowRef>/<key>", e.g. "EXR/D.USD.EUR.SP00.A"; defaults to the daily USD/EUR reference rate. */
function resolveSeries(text: string): string {
  const trimmed = text.trim()
  return /^[A-Z0-9_]+\/[A-Z0-9._-]+$/i.test(trimmed) ? trimmed : DEFAULT_SERIES
}

async function fetchSeries(query: ResearchQuery) {
  const started = Date.now()
  const series = resolveSeries(query.text)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `ecb_sdw:${series}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/${series}?lastNObservations=${limit}&format=jsondata`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SdmxResponse>(result.text)
  const seriesMap = data?.dataSets?.[0]?.series
  const dateValues = data?.structure?.dimensions?.observation?.[0]?.values
  if (!seriesMap || !dateValues) {
    return { ok: false as const, kind: 'malformed' as const, message: 'ECB SDW response did not contain the expected SDMX-JSON dataSets/structure shape.' }
  }

  const firstSeriesKey = Object.keys(seriesMap)[0]
  const observations = firstSeriesKey ? seriesMap[firstSeriesKey]?.observations : undefined
  if (!observations) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const canonicalUrl = `https://data.ecb.europa.eu/data/datasets/${series.split('/')[0]}`
  const documents = Object.entries(observations)
    .map(([idx, values]) => {
      const dateLabel = dateValues[Number(idx)]?.id ?? dateValues[Number(idx)]?.name ?? idx
      const value = Array.isArray(values) ? values[0] : null
      if (typeof value !== 'number') return null
      return makeDocument({
        id: `ecb_sdw:${series}:${dateLabel}`,
        provider: PROVIDER,
        providerRecordId: `${series}:${dateLabel}`,
        title: `${series} — ${dateLabel}`,
        summary: `Value: ${value}`,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'ECB Statistical Data Warehouse',
        contentType: 'economic_time_series_point',
        authors: [],
        organization: 'European Central Bank',
        publishedAt: String(dateLabel),
        updatedAt: null,
        geography: 'EU',
        language: 'en',
        identifiers: { ecb_series: series },
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
      if (outcome.kind === 'http_error') throw new Error(`ECB SDW fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${DEFAULT_SERIES}?lastNObservations=1&format=jsondata`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'data endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ecbSdwAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
