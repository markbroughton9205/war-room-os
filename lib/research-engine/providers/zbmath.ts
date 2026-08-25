import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'zbmath' as const
const BASE_URL = 'https://api.zbmath.org/v1/document/_search'
const MAX_RESULTS = 20

type ZbmathDoc = { identifier?: string; title?: { title?: string }; contributors?: { authors?: { name?: string }[] }; year?: number; zbmath_url?: string; keywords?: string[] }
type ZbmathResponse = { result?: ZbmathDoc[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `zbmath:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('search_string', text)
  url.searchParams.set('results_per_page', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<ZbmathResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.result)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'zbMATH response "result" field was missing or not an array.' }
  }

  const documents = data.result
    .filter(doc => doc.identifier && doc.title?.title)
    .map(doc => {
      const id = doc.identifier as string
      const canonicalUrl = doc.zbmath_url ?? `https://zbmath.org/?q=an:${id}`
      return makeDocument({
        id: `zbmath:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: doc.title!.title as string,
        summary: null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'zbMATH Open',
        contentType: 'scholarly_work',
        authors: doc.contributors?.authors?.map(a => a.name).filter((n): n is string => Boolean(n)) ?? [],
        organization: null,
        publishedAt: doc.year ? String(doc.year) : null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { zbmath_identifier: id },
        subjects: doc.keywords ?? [],
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
      if (outcome.kind === 'http_error') throw new Error(`zbMATH search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?search_string=test&results_per_page=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const zbmathAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
