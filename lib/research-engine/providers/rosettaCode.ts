import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'rosetta_code' as const
const BASE_URL = 'https://rosettacode.org/w/api.php'
const MAX_RESULTS = 25

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

type SearchHit = { pageid?: number; title?: string; snippet?: string; wordcount?: number; timestamp?: string }
type SearchResponse = { query?: { search?: SearchHit[] } }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `rosetta_code:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('action', 'query')
  url.searchParams.set('list', 'search')
  url.searchParams.set('srsearch', text)
  url.searchParams.set('srlimit', String(limit))
  url.searchParams.set('format', 'json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  const hits = data?.query?.search
  if (!Array.isArray(hits)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Rosetta Code response "query.search" field was missing or not an array.' }
  }

  const documents = hits
    .filter(h => typeof h.pageid === 'number')
    .map(h => {
      const pageId = String(h.pageid)
      const canonicalUrl = `https://rosettacode.org/wiki/${encodeURIComponent((h.title ?? '').replace(/ /g, '_'))}`
      return makeDocument({
        id: `rosetta_code:${pageId}`,
        provider: PROVIDER,
        providerRecordId: pageId,
        title: h.title ?? pageId,
        summary: h.snippet ? stripHtml(h.snippet) : null,
        contentSnippet: typeof h.wordcount === 'number' ? `${h.wordcount} words` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Rosetta Code',
        contentType: 'programming_example',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: h.timestamp ?? null,
        geography: null,
        language: 'en',
        identifiers: { rosetta_code_page_id: pageId },
        subjects: [],
        license: 'CC-BY-SA-3.0',
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
      if (outcome.kind === 'http_error') throw new Error(`Rosetta Code search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?action=query&list=search&srsearch=quicksort&format=json`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const rosettaCodeAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
