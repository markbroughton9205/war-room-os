import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'oecd_data_explorer' as const
const BASE_URL = 'https://sdmx.oecd.org/public/rest/data'
const MAX_RESULTS = 20
// Unemployment rate, monthly, Australia — a real confirmed-live default series.
const DEFAULT_SERIES = 'OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/AUS........'

type SdmxDimensionValue = { id?: string; name?: string }
// OECD's new sdmx.oecd.org API wraps the payload under a top-level "data"
// key (confirmed live) — unlike ecb_sdw's flat top-level dataSets/structure
// shape. Not a docs guess: an unwrapped assumption 404s the shape check.
type SdmxResponse = {
  data?: {
    dataSets?: { series?: Record<string, { observations?: Record<string, (number | string)[]> }> }[]
    structures?: { dimensions?: { observation?: { id?: string; values?: SdmxDimensionValue[] }[] } }[]
  }
}

/** Query text is "<agency>,<dataflow>,<version>/<key>" (OECD SDMX series
 * reference, dots as unconstrained-dimension wildcards), e.g. the default. */
function resolveSeries(text: string): string {
  const trimmed = text.trim()
  return /^[A-Za-z0-9_.@]+\/[A-Za-z0-9._-]*$/.test(trimmed) ? trimmed : DEFAULT_SERIES
}

async function fetchSeries(query: ResearchQuery) {
  const started = Date.now()
  const series = resolveSeries(query.text)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `oecd_data_explorer:${series}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  // dimensionAtObservation=AllDimensions is deliberately NOT set — that
  // switches to a flat dimension-key-indexed format requiring a full
  // structure decode; the default series-keyed shape (mirrors ecb_sdw) is
  // simpler and was confirmed live to work.
  const url = `${BASE_URL}/${series}?startPeriod=2023-01`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 15_000, headers: { Accept: 'application/vnd.sdmx.data+json' } })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const parsed = safeJsonParse<SdmxResponse>(result.text)
  const seriesMap = parsed?.data?.dataSets?.[0]?.series
  const timeDim = parsed?.data?.structures?.[0]?.dimensions?.observation?.find(d => d.id === 'TIME_PERIOD') ?? parsed?.data?.structures?.[0]?.dimensions?.observation?.[0]
  const timeValues = timeDim?.values
  if (!seriesMap || !timeValues) {
    return { ok: false as const, kind: 'malformed' as const, message: 'OECD Data Explorer response did not contain the expected SDMX-JSON data.dataSets/data.structures shape.' }
  }

  const firstSeriesKey = Object.keys(seriesMap)[0]
  const observations = firstSeriesKey ? seriesMap[firstSeriesKey]?.observations : undefined
  if (!observations) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const [flowRef] = series.split('/')
  const canonicalUrl = `https://data-explorer.oecd.org/vis?df[ds]=${flowRef}`
  const documents = Object.entries(observations)
    .slice(0, limit)
    .map(([idx, values]) => {
      const dateLabel = timeValues[Number(idx)]?.id ?? idx
      const rawValue = Array.isArray(values) ? values[0] : null
      const value = typeof rawValue === 'string' ? Number(rawValue) : rawValue
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      return makeDocument({
        id: `oecd_data_explorer:${series}:${dateLabel}`,
        provider: PROVIDER,
        providerRecordId: `${series}:${dateLabel}`,
        title: `${series} — ${dateLabel}`,
        summary: `Value: ${value}`,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'OECD Data Explorer',
        contentType: 'economic_time_series_point',
        authors: [],
        organization: 'OECD',
        publishedAt: String(dateLabel),
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { oecd_series: series },
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
      if (outcome.kind === 'http_error') throw new Error(`OECD Data Explorer fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${DEFAULT_SERIES}?startPeriod=2023-01`, { timeoutMs: 10_000, headers: { Accept: 'application/vnd.sdmx.data+json' } })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'data endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const oecdDataExplorerAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
