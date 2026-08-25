import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'bdl_poland' as const
const BASE_URL = 'https://bdl.stat.gov.pl/api/v1/variables/search'
const MAX_RESULTS = 25

// Zero-auth confirmed live (subjects/variables/data-by-variable all real).
// Free-text search is exact-spelling/diacritic-sensitive (a plain-ASCII
// query for a Polish-diacritic term returns 0 results — not a broken
// endpoint, confirmed by testing both forms live).
type Variable = { id?: number; n1?: string; subjectId?: string; level?: number; measureUnitName?: string }
type SearchResponse = { totalRecords?: number; results?: Variable[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a Polish-language statistical variable name (e.g. "ludność").')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `bdl_poland:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('name', text)
  url.searchParams.set('format', 'json')
  url.searchParams.set('page-size', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.results)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'BDL response "results" field was missing or not an array.' }
  }

  const documents = data.results
    .filter(v => v.id != null)
    .map(v => {
      const id = String(v.id)
      const canonicalUrl = `https://bdl.stat.gov.pl/bdl/metadane/podgrupy/${id}`
      return makeDocument({
        id: `bdl_poland:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: v.n1 ?? id,
        summary: v.measureUnitName ? `Unit: ${v.measureUnitName}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Bank Danych Lokalnych (Statistics Poland)',
        contentType: 'statistical_variable',
        authors: [],
        organization: 'GUS (Statistics Poland)',
        publishedAt: null,
        updatedAt: null,
        geography: 'PL',
        language: 'pl',
        identifiers: { bdl_variable_id: id, ...(v.subjectId ? { bdl_subject_id: v.subjectId } : {}) },
        subjects: [],
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
      if (outcome.kind === 'http_error') throw new Error(`BDL Poland search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, 'https://bdl.stat.gov.pl/api/v1/subjects?format=json&page-size=1', { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'subjects endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const bdlPolandAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
