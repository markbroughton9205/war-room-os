import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'dblp' as const
const BASE_URL = 'https://dblp.org/search/publ/api'
const MAX_RESULTS = 25

type AuthorEntry = { text?: string }
type HitInfo = {
  title?: string
  venue?: string
  year?: string
  type?: string
  key?: string
  doi?: string
  ee?: string
  url?: string
  authors?: { author?: AuthorEntry | AuthorEntry[] }
}
type Hit = { '@id'?: string; info?: HitInfo }
type SearchResponse = { result?: { hits?: { hit?: Hit[] } } }

function authorNames(authors?: { author?: AuthorEntry | AuthorEntry[] }): string[] {
  const author = authors?.author
  if (!author) return []
  const list = Array.isArray(author) ? author : [author]
  return list.map(a => a.text).filter((v): v is string => !!v)
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `dblp:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('format', 'json')
  url.searchParams.set('h', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  const hits = data?.result?.hits?.hit
  if (!Array.isArray(hits)) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const documents = hits
    .filter(hit => hit.info?.key != null)
    .map(hit => {
      const info = hit.info as HitInfo
      const key = info.key as string
      const canonicalUrl = info.url ?? `https://dblp.org/rec/${key}`
      const authors = authorNames(info.authors)
      return makeDocument({
        id: `dblp:${key}`,
        provider: PROVIDER,
        providerRecordId: key,
        title: info.title ?? key,
        summary: authors.length ? `By ${authors.join(', ')}` : null,
        contentSnippet: info.venue ?? null,
        canonicalUrl,
        sourceUrl: info.ee ?? canonicalUrl,
        sourceName: 'DBLP',
        contentType: info.type ?? 'publication',
        authors,
        organization: null,
        publishedAt: info.year ?? null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { dblp_key: key, ...(info.doi ? { doi: info.doi } : {}) },
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
      throw new Error(`DBLP search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=transformer&format=json&h=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const dblpAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
