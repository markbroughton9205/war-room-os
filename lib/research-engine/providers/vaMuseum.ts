import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'va_museum' as const
const BASE_URL = 'https://api.vam.ac.uk/v2'
const MAX_RESULTS = 25

type PrimaryMaker = { name?: string }
type Record_ = {
  systemNumber?: string
  objectType?: string
  _primaryTitle?: string
  _primaryMaker?: PrimaryMaker
  _primaryDate?: string
  _primaryPlace?: string
}
type SearchResponse = { records?: Record_[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `va_museum:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/objects/search`)
  url.searchParams.set('q', text)
  url.searchParams.set('page_size', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.records)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'V&A response "records" field was missing or not an array.' }
  }

  const documents = data.records
    .filter(r => typeof r.systemNumber === 'string')
    .map(r => {
      const id = r.systemNumber as string
      const canonicalUrl = `https://collections.vam.ac.uk/item/${id}`
      return makeDocument({
        id: `va_museum:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: r._primaryTitle ?? r.objectType ?? `Object ${id}`,
        summary: r._primaryMaker?.name ?? null,
        contentSnippet: r._primaryDate ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Victoria and Albert Museum',
        contentType: 'museum_object',
        authors: r._primaryMaker?.name ? [r._primaryMaker.name] : [],
        organization: 'Victoria and Albert Museum',
        publishedAt: null,
        updatedAt: null,
        geography: r._primaryPlace ?? null,
        language: 'en',
        identifiers: { va_system_number: id },
        subjects: r.objectType ? [r.objectType] : [],
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
      if (outcome.kind === 'http_error') throw new Error(`V&A search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/objects/search?q=teapot&page_size=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'objects search reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const vaMuseumAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
