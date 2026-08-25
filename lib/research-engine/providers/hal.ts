import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'hal' as const
const BASE_URL = 'https://api.archives-ouvertes.fr/search/'
const MAX_RESULTS = 20
const FIELDS = 'docid,title_s,authFullName_s,producedDate_s,uri_s,abstract_s'

type HalDoc = { docid?: string; title_s?: string[]; authFullName_s?: string[]; producedDate_s?: string; uri_s?: string; abstract_s?: string[] }
type HalResponse = { response?: { numFound?: number; docs?: HalDoc[] } }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `hal:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('rows', String(limit))
  url.searchParams.set('wt', 'json')
  url.searchParams.set('fl', FIELDS)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<HalResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.response?.docs)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'HAL response "response.docs" field was missing or not an array.' }
  }

  const documents = data.response!.docs!
    .filter(doc => doc.docid && doc.uri_s)
    .map(doc => {
      const id = doc.docid as string
      const canonicalUrl = doc.uri_s as string
      return makeDocument({
        id: `hal:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: doc.title_s?.[0] ?? canonicalUrl,
        summary: doc.abstract_s?.[0] ?? null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'HAL (archives ouvertes)',
        contentType: 'scholarly_work',
        authors: doc.authFullName_s ?? [],
        organization: null,
        publishedAt: doc.producedDate_s ?? null,
        updatedAt: null,
        geography: 'FR',
        language: null,
        identifiers: { hal_docid: id },
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
      if (outcome.kind === 'http_error') throw new Error(`HAL search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=test&rows=1&wt=json`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const halAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
