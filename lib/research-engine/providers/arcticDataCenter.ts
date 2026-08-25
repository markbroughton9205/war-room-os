import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'arctic_data_center' as const
const BASE_URL = 'https://arcticdata.io/metacat/d1/mn/v2/query/solr/'
const MAX_RESULTS = 25

type Doc = { id?: string; title?: string; dataUrl?: string; dateUploaded?: string; abstract?: string }
type SolrResponse = { response?: { docs?: Doc[] } }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100).replace(/["\\]/g, '')
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `arctic_data_center:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', `title:${text}`)
  url.searchParams.set('rows', String(limit))
  url.searchParams.set('wt', 'json')
  url.searchParams.set('fl', 'id,title,dataUrl,dateUploaded,abstract')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SolrResponse>(result.text)
  const docs = data?.response?.docs
  if (!Array.isArray(docs)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Arctic Data Center response "response.docs" field was missing or not an array.' }
  }

  const documents = docs
    .filter(d => typeof d.id === 'string')
    .map(d => {
      const id = d.id as string
      const canonicalUrl = `https://arcticdata.io/catalog/view/${encodeURIComponent(id)}`
      return makeDocument({
        id: `arctic_data_center:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: d.title ?? id,
        summary: d.abstract ?? null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: d.dataUrl ?? canonicalUrl,
        sourceName: 'Arctic Data Center',
        contentType: 'dataset',
        authors: [],
        organization: 'NSF Arctic Data Center',
        publishedAt: d.dateUploaded ?? null,
        updatedAt: null,
        geography: 'Arctic',
        language: 'en',
        identifiers: { arctic_data_center_id: id },
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
      if (outcome.kind === 'http_error') throw new Error(`Arctic Data Center search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=title:permafrost&rows=1&wt=json`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'solr query endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const arcticDataCenterAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
