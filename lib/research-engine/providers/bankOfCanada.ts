import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'bank_of_canada' as const
const BASE_URL = 'https://www.bankofcanada.ca/valet/observations'
const MAX_RESULTS = 30
const DEFAULT_SERIES = 'FXUSDCAD'
const SERIES_NAME_PATTERN = /^[A-Z0-9._]{2,30}$/i

type Observation = { d?: string } & Record<string, { v?: string } | string | undefined>
type SeriesDetail = { label?: string; description?: string }
type ValetResponse = { seriesDetail?: Record<string, SeriesDetail>; observations?: Observation[] }

function resolveSeriesName(text: string): string {
  const trimmed = text.trim()
  return SERIES_NAME_PATTERN.test(trimmed) ? trimmed.toUpperCase() : DEFAULT_SERIES
}

async function fetchSeries(query: ResearchQuery) {
  const started = Date.now()
  const seriesName = resolveSeriesName(query.text)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `bank_of_canada:${seriesName}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/${seriesName}/json?recent=${limit}`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 12_000 })
  if (result.status === 404) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<ValetResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.observations)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Bank of Canada Valet response "observations" field was missing or not an array.' }
  }

  const label = data.seriesDetail?.[seriesName]?.label ?? seriesName
  const canonicalUrl = `https://www.bankofcanada.ca/valet/observations/${seriesName}`
  const documents = data.observations
    .map(obs => {
      const date = obs.d
      const cell = obs[seriesName]
      const value = cell && typeof cell === 'object' ? cell.v : undefined
      if (!date || typeof value !== 'string') return null
      return makeDocument({
        id: `bank_of_canada:${seriesName}:${date}`,
        provider: PROVIDER,
        providerRecordId: `${seriesName}:${date}`,
        title: `${label} — ${date}`,
        summary: `Value: ${value}`,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Bank of Canada Valet',
        contentType: 'economic_time_series_point',
        authors: [],
        organization: 'Bank of Canada',
        publishedAt: date,
        updatedAt: null,
        geography: 'CA',
        language: 'en',
        identifiers: { boc_series: seriesName },
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
      if (outcome.kind === 'http_error') throw new Error(`Bank of Canada Valet fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${DEFAULT_SERIES}/json?recent=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'observations endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const bankOfCanadaAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
