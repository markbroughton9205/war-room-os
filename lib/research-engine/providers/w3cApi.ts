import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'w3c_api' as const
const BASE_URL = 'https://api.w3.org/specifications'
const MAX_RESULTS = 20

type W3cSpec = { shortname?: string; title?: string; description?: string; status?: string; shortlink?: string }
type W3cSpecsResponse = { page?: number; pages?: number; total?: number; _links?: { specifications?: { href?: string } }; _embedded?: { specifications?: W3cSpec[] } }

// Confirmed live (this mission) via a direct probe: GET /specifications?embed=true
// is paginated (page=1&limit=100 by default; probe returned pages=18, total=1711)
// with NO free-text search parameter. A first version of this adapter fetched
// only page 1 (100/1711 specs) and would have silently missed any spec not in
// that arbitrary first page — caught by re-verifying the fork's research
// against a real HTTP call before wiring it in. This version walks every page
// (bounded to MAX_PAGES as a hard safety cap against a misbehaving upstream)
// once, then caches the merged list for CACHE_TTL.codelist (7 days) and
// filters client-side by title/shortname, the congress_gov pattern.
const MAX_PAGES = 25

async function fetchAllSpecs(): Promise<{ ok: true; specs: W3cSpec[] } | { ok: false; kind: 'http_error'; status: number } | { ok: false; kind: 'malformed'; message: string }> {
  const all: W3cSpec[] = []
  let page = 1
  let totalPages = 1
  do {
    const url = new URL(BASE_URL)
    url.searchParams.set('embed', 'true')
    url.searchParams.set('page', String(page))
    const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
    if (!result.ok) return { ok: false, kind: 'http_error', status: result.status }
    const data = safeJsonParse<W3cSpecsResponse>(result.text)
    const embedded = data?._embedded?.specifications
    if (!Array.isArray(embedded)) return { ok: false, kind: 'malformed', message: 'W3C API response was missing _embedded.specifications.' }
    all.push(...embedded)
    totalPages = Math.min(data?.pages ?? 1, MAX_PAGES)
    page += 1
  } while (page <= totalPages)
  return { ok: true, specs: all }
}

/**
 * The public W3C API has no free-text search parameter for specifications —
 * query text narrows the fetched (paginated, then merged) list client-side
 * by title/shortname.
 */
async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().toLowerCase()
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `w3c_api:specifications`
  let specs = cacheGet<W3cSpec[]>(cacheKey)
  if (!specs) {
    const outcome = await fetchAllSpecs()
    if (!outcome.ok) return outcome
    specs = outcome.specs
    cacheSet(cacheKey, specs, CACHE_TTL.codelist)
  }

  const filtered = specs
    .filter(spec => !text || (spec.title ?? '').toLowerCase().includes(text) || (spec.shortname ?? '').toLowerCase().includes(text))
    .slice(0, limit)

  const documents = filtered
    .filter(spec => spec.shortname)
    .map(spec => {
      const shortname = spec.shortname as string
      const canonicalUrl = spec.shortlink ?? `https://www.w3.org/TR/${shortname}/`
      return makeDocument({
        id: `w3c_api:${shortname}`,
        provider: PROVIDER,
        providerRecordId: shortname,
        title: spec.title ?? shortname,
        summary: spec.description ?? null,
        contentSnippet: spec.status ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'W3C',
        contentType: 'web_specification',
        authors: [],
        organization: 'World Wide Web Consortium',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { w3c_shortname: shortname },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`W3C API search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?embed=true`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'specifications endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const w3cApiAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
