import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ariadne_portal' as const
const BASE_URL = 'https://portal.ariadne-infrastructure.eu/api/search'
const MAX_RESULTS = 25

type LangText = { text?: string; language?: string }
type Agent = { name?: string; institution?: string }
type HitData = {
  title?: LangText
  description?: LangText
  identifier?: string
  landingPage?: string
  issued?: string
  modified?: string
  accessRights?: string
  country?: string[]
  contributor?: Agent[]
  nativeSubject?: { prefLabel?: string }[]
}
type Hit = { id?: string; data?: HitData }
type SearchResponse = { total?: { value?: number }; hits?: Hit[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 150)
  if (!text) throw new Error('Query must be an archaeological search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `ariadne_portal:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('size', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.hits)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'ARIADNE portal response "hits" field was missing or not an array.' }
  }

  const documents = data.hits
    .filter(h => typeof h.id === 'string')
    .map(h => {
      const id = h.id as string
      const record = h.data ?? {}
      const canonicalUrl = record.landingPage ?? record.identifier ?? `https://portal.ariadne-infrastructure.eu/resource/${id}`
      return makeDocument({
        id: `ariadne_portal:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: record.title?.text ?? id,
        summary: record.description?.text ?? null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'ARIADNE Research Infrastructure',
        contentType: 'archaeological_resource',
        authors: record.contributor?.map(a => a.name).filter((n): n is string => typeof n === 'string') ?? [],
        organization: record.contributor?.[0]?.institution ?? null,
        publishedAt: record.issued ?? null,
        updatedAt: record.modified ?? null,
        geography: record.country?.[0] ?? null,
        language: record.title?.language ?? null,
        identifiers: record.identifier ? { ariadne_identifier: record.identifier } : {},
        subjects: record.nativeSubject?.map(s => s.prefLabel).filter((s): s is string => typeof s === 'string') ?? [],
        license: record.accessRights ?? null,
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
      if (outcome.kind === 'http_error') throw new Error(`ARIADNE portal search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=pottery&size=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ariadnePortalAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
