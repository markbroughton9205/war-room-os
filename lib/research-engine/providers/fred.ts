import 'server-only'

import type { ResearchHealthStatus, ResearchQuery, ResearchTimeSeries } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'fred' as const

type FredSeries = { id: string; title: string; frequency: string; units: string; notes?: string; observation_start: string; observation_end: string; last_updated: string }
type FredObservation = { date: string; value: string }

// FRED has no Commander-configurable base-URL env var in the inventory — this
// is a stable official host used as an internal default (see hostAllowlist.ts).
function baseUrl(): string {
  return 'https://api.stlouisfed.org/fred'
}

function apiKey(): string {
  return process.env.FRED_API_KEY?.trim() ?? ''
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const cacheKey = `fred:search:${query.text}:${query.maxResults ?? 5}`
  const cached = cacheGet<{ documents: ReturnType<typeof makeDocument>[]; timeSeries: ResearchTimeSeries[] }>(cacheKey)
  if (cached) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: cached.documents, timeSeries: cached.timeSeries, durationMs: Date.now() - started, fromCache: true }) }
  }

  const limit = Math.max(1, Math.min(query.maxResults ?? 5, 10))
  const searchUrl = new URL(`${baseUrl()}/series/search`)
  searchUrl.searchParams.set('search_text', query.text)
  searchUrl.searchParams.set('api_key', apiKey())
  searchUrl.searchParams.set('file_type', 'json')
  searchUrl.searchParams.set('limit', String(limit))

  const searchResult = await safeProviderFetch(PROVIDER, searchUrl.toString(), { timeoutMs: 10_000 })
  if (!searchResult.ok) return { ok: false as const, status: searchResult.status }

  const searchData = safeJsonParse<{ seriess?: FredSeries[] }>(searchResult.text)
  const seriesList = searchData?.seriess ?? []

  const documents = seriesList.map(series => makeDocument({
    id: `fred:${series.id}`,
    provider: PROVIDER,
    providerRecordId: series.id,
    title: series.title,
    summary: series.notes ?? null,
    contentSnippet: series.notes ?? null,
    canonicalUrl: `https://fred.stlouisfed.org/series/${series.id}`,
    sourceUrl: `https://fred.stlouisfed.org/series/${series.id}`,
    sourceName: 'FRED (Federal Reserve Bank of St. Louis)',
    contentType: 'economic_time_series',
    authors: [],
    organization: 'Federal Reserve Bank of St. Louis',
    publishedAt: series.observation_start,
    updatedAt: series.last_updated,
    geography: null,
    language: 'en',
    identifiers: { fred_series_id: series.id },
    subjects: [],
    license: null,
    accessStatus: 'open',
    warnings: ['Preliminary/revised values are labeled by FRED itself; this adapter does not reinterpret revision status.'],
  }))

  const timeSeries: ResearchTimeSeries[] = []
  const topSeries = seriesList[0]
  if (topSeries) {
    const obsUrl = new URL(`${baseUrl()}/series/observations`)
    obsUrl.searchParams.set('series_id', topSeries.id)
    obsUrl.searchParams.set('api_key', apiKey())
    obsUrl.searchParams.set('file_type', 'json')
    obsUrl.searchParams.set('sort_order', 'desc')
    obsUrl.searchParams.set('limit', '24')
    const obsResult = await safeProviderFetch(PROVIDER, obsUrl.toString(), { timeoutMs: 10_000 })
    if (obsResult.ok) {
      const obsData = safeJsonParse<{ observations?: FredObservation[] }>(obsResult.text)
      const points = (obsData?.observations ?? []).map(observation => ({
        date: observation.date,
        value: observation.value === '.' ? null : Number(observation.value),
        note: observation.value === '.' ? 'not available for this period' : null,
      })).reverse()
      timeSeries.push({ seriesId: topSeries.id, title: topSeries.title, unit: topSeries.units, frequency: topSeries.frequency, points })
    }
  }

  cacheSet(cacheKey, { documents, timeSeries }, CACHE_TTL.timeSeries)
  return { ok: true as const, response: okResponse(PROVIDER, { documents, timeSeries, durationMs: Date.now() - started }) }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) return notConfiguredResponse(PROVIDER, 'FRED_API_KEY is not configured.')
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (!outcome.ok) throw new Error(`FRED search failed with HTTP ${outcome.status}`)
      return outcome.response
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'FRED_API_KEY missing', durationMs: null }
  }
  try {
    const url = new URL(`${baseUrl()}/series`)
    url.searchParams.set('series_id', 'GNPCA')
    url.searchParams.set('api_key', apiKey())
    url.searchParams.set('file_type', 'json')
    const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 8_000 })
    return {
      provider: PROVIDER,
      state: result.ok ? 'ready' : result.status === 400 || result.status === 403 ? 'authentication_failed' : 'degraded',
      checkedAt: nowIso(),
      detail: result.ok ? 'series endpoint reachable' : `HTTP ${result.status}`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const fredAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
