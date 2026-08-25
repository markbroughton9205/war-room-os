import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ehri' as const
const BASE_URL = 'https://portal.ehri-project.eu/api/v1'
const MAX_RESULTS = 25

type Description = { languageCode?: string; name?: string; scopeAndContent?: string }
type Attributes = {
  name?: string
  parallelFormsOfName?: string[]
  descriptions?: Description[]
}
type Item = { id?: string; type?: string; attributes?: Attributes }
type SearchResponse = { data?: Item[]; meta?: { total?: number } }

function titleOf(item: Item): string {
  if (item.attributes?.name) return item.attributes.name
  const firstDesc = item.attributes?.descriptions?.[0]
  return firstDesc?.name ?? item.id ?? 'EHRI record'
}
function summaryOf(item: Item): string | null {
  const firstDesc = item.attributes?.descriptions?.[0]
  return firstDesc?.scopeAndContent ?? null
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `ehri:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/search`)
  url.searchParams.set('q', text)
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'EHRI response "data" field was missing or not an array.' }
  }

  const documents = data.data
    .filter(item => typeof item.id === 'string')
    .map(item => {
      const id = item.id as string
      const canonicalUrl = `https://portal.ehri-project.eu/units/${id}`
      const description = summaryOf(item)
      return makeDocument({
        id: `ehri:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: titleOf(item),
        summary: description,
        contentSnippet: item.type ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'EHRI Portal',
        contentType: 'archival_record',
        authors: [],
        organization: 'European Holocaust Research Infrastructure',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: item.attributes?.descriptions?.[0]?.languageCode ?? null,
        identifiers: { ehri_id: id, ...(item.type ? { ehri_type: item.type } : {}) },
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
      if (outcome.kind === 'http_error') throw new Error(`EHRI search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/search?q=Auschwitz&limit=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ehriAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
