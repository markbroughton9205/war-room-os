import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'stack_exchange' as const
const BASE_URL = 'https://api.stackexchange.com/2.3/search/advanced'
const MAX_RESULTS = 25
const DEFAULT_SITE = 'stackoverflow'

// Zero-auth for anonymous, low-volume use (300 requests/day per IP without a
// key, confirmed live — no key required for this codebase's usage pattern).
type Question = { question_id?: number; title?: string; link?: string; tags?: string[]; owner?: { display_name?: string }; score?: number; view_count?: number; answer_count?: number; is_answered?: boolean; creation_date?: number; content_license?: string }
type SearchResponse = { items?: Question[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `stack_exchange:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('site', DEFAULT_SITE)
  url.searchParams.set('order', 'desc')
  url.searchParams.set('sort', 'relevance')
  url.searchParams.set('pagesize', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.items)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Stack Exchange response "items" field was missing or not an array.' }
  }

  const documents = data.items
    .filter(q => q.question_id != null)
    .map(q => {
      const id = String(q.question_id)
      const canonicalUrl = q.link ?? `https://stackoverflow.com/questions/${id}`
      return makeDocument({
        id: `stack_exchange:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: q.title ?? id,
        summary: null,
        contentSnippet: `Score: ${q.score ?? 0}, Answers: ${q.answer_count ?? 0}${q.is_answered ? ' (answered)' : ''}`,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Stack Overflow',
        contentType: 'qa_thread',
        authors: q.owner?.display_name ? [q.owner.display_name] : [],
        organization: null,
        publishedAt: q.creation_date != null ? new Date(q.creation_date * 1000).toISOString() : null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { stack_exchange_question_id: id },
        subjects: q.tags ?? [],
        license: q.content_license ?? null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Stack Exchange search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=test&site=${DEFAULT_SITE}&pagesize=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const stackExchangeAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
