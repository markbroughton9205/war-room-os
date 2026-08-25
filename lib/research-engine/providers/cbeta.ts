import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'cbeta' as const
const BASE_URL = 'https://cbdata.dila.edu.tw/stable/search/'
const MAX_RESULTS = 25

// The search index's "id" field is a numeric Sphinx doc ID, not a string
// (confirmed live) — the real citable CBETA text identifier is "file".
type Result = { id?: number; canon?: string; title?: string; file?: string; work?: string; byline?: string; time_dynasty?: string }
type SearchResponse = { num_found?: number; results?: Result[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a search keyword (Chinese or transliterated).')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `cbeta:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.results)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'CBETA response "results" field was missing or not an array.' }
  }

  const documents = data.results
    .slice(0, limit)
    .filter(r => typeof r.file === 'string' || typeof r.id === 'number')
    .map(r => {
      const id = r.file ?? String(r.id)
      const canonicalUrl = `https://cbetaonline.dila.edu.tw/${id}`
      return makeDocument({
        id: `cbeta:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: r.title ?? id,
        summary: r.byline ?? null,
        contentSnippet: r.time_dynasty ? `Dynasty: ${r.time_dynasty}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'CBETA (Chinese Buddhist Electronic Text Association)',
        contentType: 'buddhist_canon_text',
        authors: r.byline ? [r.byline] : [],
        organization: 'DILA, Taiwan',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: 'zh',
        identifiers: { cbeta_id: id, ...(r.canon ? { canon: r.canon } : {}) },
        subjects: r.time_dynasty ? [r.time_dynasty] : [],
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
      if (outcome.kind === 'http_error') throw new Error(`CBETA search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=般若`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const cbetaAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
