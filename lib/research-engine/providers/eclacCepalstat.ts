import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'eclac_cepalstat' as const
const BASE_URL = 'https://api-cepalstat.cepal.org/cepalstat/api/v1/indicator'
const MAX_RESULTS = 25
const INDICATOR_ID_PATTERN = /^\d+$/

type Metadata = { indicator_id?: number | string; indicator_name?: string; theme?: string; area?: string; unit?: string; definition?: string }
type DataRow = { value?: number | string; iso3?: string } & Record<string, unknown>
type IndicatorResponse = { body?: { metadata?: Metadata; data?: DataRow[] } }

/** CEPALSTAT has no free-text search — only lookup by known numeric indicator
 * ID (confirmed live: /indicator and /theme discovery endpoints both 404). */
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const indicatorId = query.text.trim()
  if (!INDICATOR_ID_PATTERN.test(indicatorId)) {
    throw new Error('Query must be a numeric CEPALSTAT indicator ID (e.g. "145") — CEPALSTAT has no free-text search API.')
  }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `eclac_cepalstat:${indicatorId}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/${indicatorId}/data`)
  url.searchParams.set('format', 'json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<IndicatorResponse>(result.text)
  const metadata = data?.body?.metadata
  const rows = data?.body?.data
  if (!metadata || !Array.isArray(rows)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'CEPALSTAT response "body.metadata"/"body.data" fields were missing.' }
  }

  const canonicalUrl = `https://statistics.cepal.org/portal/cepalstat/dashboard.html?indicator_id=${indicatorId}`
  const documents = rows.slice(0, limit).map((row, index) => {
    const rowId = `${indicatorId}:${row.iso3 ?? index}`
    return makeDocument({
      id: `eclac_cepalstat:${rowId}`,
      provider: PROVIDER,
      providerRecordId: rowId,
      title: metadata.indicator_name ?? `Indicator ${indicatorId}`,
      summary: metadata.definition ?? null,
      contentSnippet: `Value: ${row.value ?? 'n/a'}${metadata.unit ? ` ${metadata.unit}` : ''}`,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'CEPALSTAT (ECLAC)',
      contentType: 'economic_statistic',
      authors: [],
      organization: 'UN Economic Commission for Latin America and the Caribbean',
      publishedAt: null,
      updatedAt: null,
      geography: row.iso3 ?? metadata.area ?? null,
      language: 'en',
      identifiers: { cepalstat_indicator_id: indicatorId, ...(row.iso3 ? { iso3: row.iso3 } : {}) },
      subjects: metadata.theme ? [metadata.theme] : [],
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
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`CEPALSTAT lookup failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/145/data?format=json`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'indicator endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const eclacCepalstatAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
