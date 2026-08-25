import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'oeis' as const
// The api.oeis.org subdomain is a deprecated/unmaintained alias — the main
// host works fine and is used directly.
const BASE_URL = 'https://oeis.org/search'
const MAX_RESULTS = 20

type OeisEntry = { number?: number; data?: string; name?: string; author?: string }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `oeis:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('fmt', 'json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  // OEIS returns `null` (not an array) for a zero-result query — an honest
  // empty result, distinct from a malformed response.
  const parsed = safeJsonParse<OeisEntry[] | null>(result.text)
  if (parsed === null) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  if (!Array.isArray(parsed)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'OEIS response was neither a JSON array nor null.' }
  }

  const documents = parsed
    .filter(entry => typeof entry.number === 'number')
    .slice(0, limit)
    .map(entry => {
      const aNumber = `A${String(entry.number).padStart(6, '0')}`
      const canonicalUrl = `https://oeis.org/${aNumber}`
      return makeDocument({
        id: `oeis:${aNumber}`,
        provider: PROVIDER,
        providerRecordId: aNumber,
        title: entry.name ?? aNumber,
        summary: entry.data ? `Sequence: ${entry.data}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'OEIS (Online Encyclopedia of Integer Sequences)',
        contentType: 'integer_sequence',
        authors: entry.author ? [entry.author] : [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { oeis_a_number: aNumber },
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
      if (outcome.kind === 'http_error') throw new Error(`OEIS search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=1,1,2,3,5,8&fmt=json`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const oeisAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
