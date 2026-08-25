import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'software_heritage' as const
const BASE_URL = 'https://archive.softwareheritage.org/api/1/origin/search'
const MAX_RESULTS = 25

type Origin = { url?: string; nb_visits?: number; last_visit_date?: string | null }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a repository name/keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `software_heritage:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/${encodeURIComponent(text)}/`)
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<Origin[]>(result.text)
  if (!Array.isArray(data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Software Heritage response was not a JSON array.' }
  }

  // The API returns origin URLs, not titles/descriptions (confirmed live) —
  // the origin URL itself is the record's identity for display.
  const documents = data
    .filter(o => typeof o.url === 'string')
    .map(o => {
      const originUrl = o.url as string
      const canonicalUrl = `https://archive.softwareheritage.org/browse/origin/?origin_url=${encodeURIComponent(originUrl)}`
      return makeDocument({
        id: `software_heritage:${originUrl}`,
        provider: PROVIDER,
        providerRecordId: originUrl,
        title: originUrl,
        summary: typeof o.nb_visits === 'number' ? `${o.nb_visits} archival visits` : null,
        contentSnippet: o.last_visit_date ? `Last visit: ${o.last_visit_date}` : null,
        canonicalUrl,
        sourceUrl: originUrl,
        sourceName: 'Software Heritage',
        contentType: 'code_repository',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: o.last_visit_date ?? null,
        geography: null,
        language: null,
        identifiers: { swh_origin_url: originUrl },
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
      if (outcome.kind === 'http_error') throw new Error(`Software Heritage search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/linux/?limit=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'origin search reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const softwareHeritageAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
