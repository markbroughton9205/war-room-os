import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'bis_stats' as const
const BASE_URL = 'https://stats.bis.org/api/v2/data/dataflow/BIS'
const MAX_RESULTS = 20
const DEFAULT_SERIES = 'WS_CBPOL/D.US' // BIS central bank policy rates, daily, US

type SdmxObservationDim = { id?: string; name?: string; values?: { id?: string; name?: string }[] }
// BIS's observation value is a numeric STRING (e.g. "3.625"), not a JSON
// number, unlike ecb_sdw's numeric values — confirmed live, parsed explicitly.
type SdmxResponse = {
  data?: {
    dataSets?: { series?: Record<string, { observations?: Record<string, (number | string)[]> }> }[]
    structure?: { dimensions?: { observation?: SdmxObservationDim[] } }
  }
}

/** Query text is "<dataflowId>/<key>", e.g. "WS_CBPOL/D.US"; defaults to daily US central bank policy rate. */
function resolveSeries(text: string): string {
  const trimmed = text.trim()
  return /^[A-Z0-9_]+\/[A-Z0-9._-]+$/i.test(trimmed) ? trimmed : DEFAULT_SERIES
}

async function fetchSeries(query: ResearchQuery) {
  const started = Date.now()
  const series = resolveSeries(query.text)
  const [dataflowId, key] = series.split('/')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `bis_stats:${series}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  // BIS's `format=json` query param 406s ("Unsupported format: json") —
  // confirmed live; the correct content negotiation is the SDMX-JSON Accept
  // header instead, with no format param at all. Path order is
  // {dataflowId}/1.0/{key} — the version segment sits BEFORE the key, not after.
  const url = `${BASE_URL}/${dataflowId}/1.0/${key}?lastNObservations=${limit}`
  const result = await safeProviderFetch(PROVIDER, url, { headers: { Accept: 'application/vnd.sdmx.data+json' }, timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const parsed = safeJsonParse<SdmxResponse>(result.text)
  const seriesMap = parsed?.data?.dataSets?.[0]?.series
  const dateValues = parsed?.data?.structure?.dimensions?.observation?.[0]?.values
  if (!seriesMap || !dateValues) {
    return { ok: false as const, kind: 'malformed' as const, message: 'BIS Data Portal response did not contain the expected SDMX-JSON dataSets/structure shape.' }
  }

  const firstSeriesKey = Object.keys(seriesMap)[0]
  const observations = firstSeriesKey ? seriesMap[firstSeriesKey]?.observations : undefined
  if (!observations) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const canonicalUrl = `https://data.bis.org/topics/${dataflowId}`
  const documents = Object.entries(observations)
    .map(([idx, values]) => {
      const dateLabel = dateValues[Number(idx)]?.id ?? dateValues[Number(idx)]?.name ?? idx
      const rawValue = Array.isArray(values) ? values[0] : null
      const value = typeof rawValue === 'string' ? Number(rawValue) : rawValue
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      return makeDocument({
        id: `bis_stats:${series}:${dateLabel}`,
        provider: PROVIDER,
        providerRecordId: `${series}:${dateLabel}`,
        title: `${series} — ${dateLabel}`,
        summary: `Value: ${value}`,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Bank for International Settlements',
        contentType: 'economic_time_series_point',
        authors: [],
        organization: 'BIS',
        publishedAt: String(dateLabel),
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { bis_series: series },
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
      if (outcome.kind === 'http_error') throw new Error(`BIS Data Portal fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const [defaultDataflowId, defaultKey] = DEFAULT_SERIES.split('/')
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${defaultDataflowId}/1.0/${defaultKey}?lastNObservations=1`, { headers: { Accept: 'application/vnd.sdmx.data+json' }, timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'data endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const bisStatsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
