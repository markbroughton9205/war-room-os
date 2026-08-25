import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'nara_catalog' as const
// The documented /api/v2/records/search path returns the SPA's HTML shell
// (confirmed live) — the real working path is /proxy/records/search.
const BASE_URL = 'https://catalog.archives.gov/proxy/records/search'
const MAX_RESULTS = 25

type ControlGroup = { naId?: number | string }
type RecordMeta = { title?: string; levelOfDescription?: string; recordType?: string }
type Source = { metadata?: { controlGroup?: ControlGroup }; record?: RecordMeta }
type Hit = { _id?: string; _source?: Source }
type SearchResponse = { body?: { hits?: { hits?: Hit[] } } }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `nara_catalog:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  const hits = data?.body?.hits?.hits
  if (!Array.isArray(hits)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'NARA Catalog response "body.hits.hits" field was missing or not an array.' }
  }

  const documents = hits
    .filter(hit => typeof hit._id === 'string')
    .map(hit => {
      const id = hit._id as string
      const naId = hit._source?.metadata?.controlGroup?.naId
      const canonicalUrl = naId != null ? `https://catalog.archives.gov/id/${naId}` : `https://catalog.archives.gov/id/${id}`
      const record = hit._source?.record
      return makeDocument({
        id: `nara_catalog:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: record?.title ?? id,
        summary: record?.levelOfDescription ? `Level: ${record.levelOfDescription}` : null,
        contentSnippet: record?.recordType ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'National Archives Catalog (NARA)',
        contentType: 'archival_record',
        authors: [],
        organization: 'National Archives and Records Administration',
        publishedAt: null,
        updatedAt: null,
        geography: 'United States',
        language: 'en',
        identifiers: { nara_record_id: id, ...(naId != null ? { na_id: String(naId) } : {}) },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`NARA Catalog search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=test&limit=1`, { timeoutMs: 10_000 })
    // This undocumented endpoint intermittently serves the SPA's HTML shell
    // instead of JSON at the CDN edge, with a 200 status either way
    // (confirmed live) — a plain result.ok check would misreport readiness.
    const looksLikeJson = result.ok && result.text.trimStart().startsWith('{')
    return { provider: PROVIDER, state: looksLikeJson ? 'ready' : 'degraded', checkedAt: nowIso(), detail: looksLikeJson ? 'search endpoint reachable' : `HTTP ${result.status} (real but intermittently serves an HTML shell instead of JSON)`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const naraCatalogAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
