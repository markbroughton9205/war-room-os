import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'phishstats' as const
// Real host is api.phishstats.info — phishstats.info/api/... now 404s
// (confirmed live; the marketing site no longer proxies the API).
const BASE_URL = 'https://api.phishstats.info/api/phishing'
const MAX_RESULTS = 25

type Entry = { id?: number; url?: string; ip?: string; countryname?: string; title?: string; date?: string; score?: number; host?: string }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a domain/keyword to search phishing URLs for.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `phishstats:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('_where', `(url,like,~${text}~)`)
  url.searchParams.set('_size', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 25_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<Entry[]>(result.text)
  if (!Array.isArray(data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'PhishStats response was not a JSON array.' }
  }

  const documents = data
    .filter(e => typeof e.id === 'number')
    .map(e => {
      const id = String(e.id)
      const canonicalUrl = e.url ?? `https://phishstats.info/#!/search?id=${id}`
      return makeDocument({
        id: `phishstats:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: e.title || e.url || id,
        summary: e.host ? `Host: ${e.host}` : null,
        contentSnippet: typeof e.score === 'number' ? `Score: ${e.score}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'PhishStats',
        contentType: 'phishing_url',
        authors: [],
        organization: null,
        publishedAt: e.date ?? null,
        updatedAt: null,
        geography: e.countryname ?? null,
        language: null,
        identifiers: { phishstats_id: id, ...(e.ip ? { ip: e.ip } : {}) },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`PhishStats search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?_size=1`, { timeoutMs: 20_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'phishing endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const phishstatsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
