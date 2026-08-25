import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'imf_sdmx' as const
const BASE_URL = 'https://api.imf.org/external/sdmx/3.0/data/dataflow'
const MAX_RESULTS = 20
// CPI, Brazil+Chile+Colombia, all-items index, monthly — confirmed live
// (this mission) via a real populated response; the documented, publicly
// posted example query for this API (bd-econ.com/imfapi3.html).
const DEFAULT_QUERY = 'IMF.STA/CPI/~/BRA+CHL+COL.CPI._T.IX.M'

type SdmxResponse = {
  data?: {
    dataSets?: { series?: Record<string, { observations?: Record<string, (string | number | null)[]> }> }[]
    structures?: { dimensions?: { observation?: { id?: string; values?: { value?: string }[] }[] } }[]
  }
}

// Confirmed live (this mission) via a direct probe: the IMF_API_SUBSCRIPTION_KEY
// declared in this provider's env descriptor is NOT required for this
// endpoint — GET /external/sdmx/3.0/data/dataflow/{agency}/{dataflow}/{version}/{key}
// with Accept: application/vnd.sdmx.data+json is real, zero-auth, and
// returns real populated observations for a real query. Structure-only
// probes (dataflow listing, an unconstrained "all"/"...." key) return a
// well-formed but empty dataset — a real, fully-specified series key
// (agency/dataflow/version/dot-separated-dimension-key) is required to get
// actual observation values, matching the SDMX-JSON decode pattern already
// used by this codebase's oecd_data_explorer adapter.
function resolveQuery(text: string): string {
  const trimmed = text.trim()
  return /^[A-Za-z0-9_.]+\/[A-Za-z0-9_]+\/[A-Za-z0-9~.]+\/[A-Za-z0-9._+]*$/.test(trimmed) ? trimmed : DEFAULT_QUERY
}

async function fetchSeries(query: ResearchQuery) {
  const started = Date.now()
  const seriesQuery = resolveQuery(query.text)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `imf_sdmx:${seriesQuery}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/${seriesQuery}`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 15_000, headers: { Accept: 'application/vnd.sdmx.data+json;version=2.0.0' } })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const parsed = safeJsonParse<SdmxResponse>(result.text)
  const seriesMap = parsed?.data?.dataSets?.[0]?.series
  const timeDim = parsed?.data?.structures?.[0]?.dimensions?.observation?.find(d => d.id === 'TIME_PERIOD') ?? parsed?.data?.structures?.[0]?.dimensions?.observation?.[0]
  const timeValues = timeDim?.values
  if (!seriesMap || !timeValues) {
    return { ok: false as const, kind: 'malformed' as const, message: 'IMF SDMX response did not contain the expected data.dataSets/data.structures shape.' }
  }
  if (Object.keys(seriesMap).length === 0) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const [dataflowRef] = seriesQuery.split('/')
  const canonicalUrl = `https://data.imf.org/en/datasets/${encodeURIComponent(seriesQuery.split('/')[1] ?? dataflowRef)}`
  const documents = Object.entries(seriesMap)
    .flatMap(([seriesKey, series]) => Object.entries(series?.observations ?? {}).map(([idx, values]) => ({ seriesKey, idx, values })))
    .slice(0, limit)
    .map(({ seriesKey, idx, values }) => {
      const dateLabel = timeValues[Number(idx)]?.value ?? idx
      const rawValue = Array.isArray(values) ? values[0] : null
      const value = typeof rawValue === 'string' ? Number(rawValue) : rawValue
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      return makeDocument({
        id: `imf_sdmx:${seriesQuery}:${seriesKey}:${dateLabel}`,
        provider: PROVIDER,
        providerRecordId: `${seriesQuery}:${seriesKey}:${dateLabel}`,
        title: `${seriesQuery} (series ${seriesKey}) — ${dateLabel}`,
        summary: `Value: ${value}`,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'IMF Data (SDMX)',
        contentType: 'economic_time_series_point',
        authors: [],
        organization: 'International Monetary Fund',
        publishedAt: String(dateLabel),
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { imf_sdmx_query: seriesQuery },
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
      if (outcome.kind === 'http_error') throw new Error(`IMF SDMX fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${DEFAULT_QUERY}`, { timeoutMs: 10_000, headers: { Accept: 'application/vnd.sdmx.data+json;version=2.0.0' } })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'data endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const imfSdmxAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
