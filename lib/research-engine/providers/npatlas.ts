import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'npatlas' as const
const BASE_URL = 'https://www.npatlas.org/api/v1/compounds/basicSearch'
const MAX_RESULTS = 25

type Compound = { npaid?: string; original_name?: string; mol_formula?: string; original_organism?: string; original_doi?: string }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a natural product compound name.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `npatlas:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  // NPAtlas's search only works via POST with the name as a query param
  // (confirmed live: the GET /compounds list endpoint ignores name filters).
  const url = new URL(BASE_URL)
  url.searchParams.set('name', text)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { method: 'POST', timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<Compound[]>(result.text)
  if (!Array.isArray(data)) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const documents = data
    .slice(0, limit)
    .filter(c => typeof c.npaid === 'string')
    .map(c => {
      const npaid = c.npaid as string
      const canonicalUrl = `https://www.npatlas.org/explore/compounds/${npaid}`
      return makeDocument({
        id: `npatlas:${npaid}`,
        provider: PROVIDER,
        providerRecordId: npaid,
        title: c.original_name ?? npaid,
        summary: c.mol_formula ? `Formula: ${c.mol_formula}` : null,
        contentSnippet: c.original_organism ? `Organism: ${c.original_organism}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Natural Products Atlas',
        contentType: 'natural_product_compound',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { npatlas_id: npaid, ...(c.original_doi ? { doi: c.original_doi } : {}) },
        subjects: c.original_organism ? [c.original_organism] : [],
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
      throw new Error(`NPAtlas search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const url = new URL(BASE_URL)
    url.searchParams.set('name', 'penicillin')
    const result = await safeProviderFetch(PROVIDER, url.toString(), { method: 'POST', timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'basicSearch endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const npatlasAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
