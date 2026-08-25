import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'brave_search' as const
const BASE_URL = 'https://api.search.brave.com/res/v1/web/search'
const MAX_RESULTS = 25

// Auth mechanism (x-subscription-token header, real 422 missing-field
// error) confirmed live. Free self-service tier (~2000 queries/month) via
// account registration. Response body shape not independently re-verified
// live (no key available this build).
type WebResult = { url?: string; title?: string; description?: string }
type SearchResponse = { web?: { results?: WebResult[] } }

function apiKey(): string {
  return process.env.BRAVE_SEARCH_API_KEY?.trim() ?? ''
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `brave_search:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('count', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { 'x-subscription-token': apiKey(), Accept: 'application/json' }, timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  const results = data?.web?.results
  if (!Array.isArray(results)) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const documents = results
    .slice(0, limit)
    .filter(r => typeof r.url === 'string')
    .map(r => {
      const resultUrl = r.url as string
      return makeDocument({
        id: `brave_search:${resultUrl}`,
        provider: PROVIDER,
        providerRecordId: resultUrl,
        title: r.title ?? resultUrl,
        summary: r.description ?? null,
        contentSnippet: null,
        canonicalUrl: resultUrl,
        sourceUrl: resultUrl,
        sourceName: 'Brave Search',
        contentType: 'web_result',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: {},
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'BRAVE_SEARCH_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      throw new Error(`Brave Search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'BRAVE_SEARCH_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=test&count=1`, { headers: { 'x-subscription-token': apiKey(), Accept: 'application/json' }, timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'web search reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const braveSearchAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
