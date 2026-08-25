import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'mdn_web_docs' as const
const BASE_URL = 'https://developer.mozilla.org/api/v1/search'
const MAX_RESULTS = 25

type Doc = { mdn_url?: string; title?: string; summary?: string; locale?: string }
type SearchResponse = { documents?: Doc[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `mdn_web_docs:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('locale', 'en-US')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.documents)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'MDN Web Docs response "documents" field was missing or not an array.' }
  }

  const documents = data.documents
    .slice(0, limit)
    .filter(d => typeof d.mdn_url === 'string')
    .map(d => {
      const mdnUrl = d.mdn_url as string
      const canonicalUrl = `https://developer.mozilla.org${mdnUrl}`
      return makeDocument({
        id: `mdn_web_docs:${mdnUrl}`,
        provider: PROVIDER,
        providerRecordId: mdnUrl,
        title: d.title ?? mdnUrl,
        summary: d.summary ?? null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'MDN Web Docs',
        contentType: 'documentation',
        authors: [],
        organization: 'Mozilla',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: d.locale ?? 'en',
        identifiers: {},
        subjects: [],
        license: 'CC-BY-SA',
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
      if (outcome.kind === 'http_error') throw new Error(`MDN Web Docs search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=fetch&locale=en-US`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const mdnWebDocsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
