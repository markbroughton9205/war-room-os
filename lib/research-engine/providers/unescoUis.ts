import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'unesco_uis' as const
const BASE_URL = 'https://api.uis.unesco.org/api/public/data/indicators'
const MAX_RESULTS = 25
const ISO3_PATTERN = /^[A-Za-z]{3}$/

type Record_ = { indicatorId?: string; geoUnit?: string; year?: number; value?: number | string; qualifier?: string }
type IndicatorsResponse = { records?: Record_[] }

/** Query text is a 3-letter ISO geoUnit code (e.g. "USA"); no free-text search exists. */
async function search(query: ResearchQuery) {
  const started = Date.now()
  const geoUnit = query.text.trim().toUpperCase()
  if (!ISO3_PATTERN.test(geoUnit)) {
    throw new Error('Query must be a 3-letter ISO country/geoUnit code (e.g. "USA", "BRA") — UNESCO UIS has no free-text search API.')
  }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `unesco_uis:${geoUnit}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('geoUnit', geoUnit)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<IndicatorsResponse>(result.text)
  if (!data || !Array.isArray(data.records)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'UNESCO UIS response "records" field was missing or not an array.' }
  }

  const canonicalUrl = 'https://data.uis.unesco.org/'
  const documents = data.records
    .slice(0, limit)
    .filter(r => r.indicatorId != null)
    .map(row => {
      const rowId = `${row.indicatorId}:${geoUnit}:${row.year ?? ''}`
      return makeDocument({
        id: `unesco_uis:${rowId}`,
        provider: PROVIDER,
        providerRecordId: rowId,
        title: `${row.indicatorId} — ${geoUnit} (${row.year ?? 'unknown year'})`,
        summary: `Value: ${row.value ?? 'n/a'}${row.qualifier ? ` (${row.qualifier})` : ''}`,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'UNESCO Institute for Statistics',
        contentType: 'education_statistic',
        authors: [],
        organization: 'UNESCO',
        publishedAt: row.year ? String(row.year) : null,
        updatedAt: null,
        geography: geoUnit,
        language: 'en',
        identifiers: { unesco_uis_indicator: String(row.indicatorId), geo_unit: geoUnit },
        subjects: ['education_statistics'],
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
      if (outcome.kind === 'http_error') throw new Error(`UNESCO UIS search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?geoUnit=USA`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'indicators endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const unescoUisAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
