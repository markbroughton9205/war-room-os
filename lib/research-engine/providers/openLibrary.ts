import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'open_library' as const
const BASE_URL = 'https://openlibrary.org'
const MAX_RESULTS = 25

type Doc = {
  key?: string
  title?: string
  author_name?: string[]
  first_publish_year?: number
  isbn?: string[]
  cover_i?: number
  language?: string[]
  subject?: string[]
}
type SearchResponse = { docs?: Doc[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `open_library:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/search.json`)
  url.searchParams.set('q', text)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('fields', 'key,title,author_name,first_publish_year,isbn,cover_i,language,subject')

  const result = await safeProviderFetch(PROVIDER, url.toString(), {
    timeoutMs: 12_000,
    headers: { 'User-Agent': 'WarRoomOS-ResearchEngine/1.0 (research-engine@warroom.internal)' },
  })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.docs)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Open Library response "docs" field was missing or not an array.' }
  }

  const documents = data.docs
    .filter(doc => typeof doc.key === 'string')
    .map(doc => {
      const workId = (doc.key as string).replace(/^\/works\//, '')
      const canonicalUrl = `https://openlibrary.org${doc.key}`
      const isbn = doc.isbn?.[0] ?? null
      return makeDocument({
        id: `open_library:${workId}`,
        provider: PROVIDER,
        providerRecordId: workId,
        title: doc.title ?? `Work ${workId}`,
        summary: doc.author_name?.length ? `By ${doc.author_name.join(', ')}` : null,
        contentSnippet: typeof doc.first_publish_year === 'number' ? `First published ${doc.first_publish_year}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Open Library',
        contentType: 'book',
        authors: doc.author_name ?? [],
        organization: null,
        publishedAt: typeof doc.first_publish_year === 'number' ? String(doc.first_publish_year) : null,
        updatedAt: null,
        geography: null,
        language: doc.language?.[0] ?? null,
        identifiers: { open_library_work_id: workId, ...(isbn ? { isbn } : {}) },
        subjects: doc.subject?.slice(0, 10) ?? [],
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
      if (outcome.kind === 'http_error') throw new Error(`Open Library search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/search.json?q=hobbit&limit=1`, {
      timeoutMs: 8_000,
      headers: { 'User-Agent': 'WarRoomOS-ResearchEngine/1.0 (research-engine@warroom.internal)' },
    })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const openLibraryAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
