import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'idb_open_data' as const
const BASE_URL = 'https://data.iadb.org/api/3/action/package_search'
const MAX_RESULTS = 25

// IDB's Open Data portal is CKAN-based (confirmed live), not Socrata as the
// registry entry's "REST (Socrata)" access note assumed.
type CkanOrg = { title?: string }
type CkanDataset = {
  id?: string
  name?: string
  title?: string
  notes?: string
  organization?: CkanOrg
  metadata_created?: string
  metadata_modified?: string
}
type CkanSearchResponse = { success?: boolean; result?: { count?: number; results?: CkanDataset[] } }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `idb_open_data:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('rows', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<CkanSearchResponse>(result.text)
  if (!data?.success || !Array.isArray(data.result?.results)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'IDB Open Data (CKAN) response "result.results" field was missing or not an array.' }
  }

  const documents = data.result.results
    .filter(item => typeof item.id === 'string')
    .map(item => {
      const id = item.id as string
      const canonicalUrl = `https://data.iadb.org/dataset/${item.name ?? id}`
      return makeDocument({
        id: `idb_open_data:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: item.title ?? item.name ?? `Dataset ${id}`,
        summary: item.notes ?? null,
        contentSnippet: item.organization?.title ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'IDB Open Data',
        contentType: 'dataset',
        authors: [],
        organization: item.organization?.title ?? 'Inter-American Development Bank',
        publishedAt: item.metadata_created ?? null,
        updatedAt: item.metadata_modified ?? null,
        geography: 'Latin America and the Caribbean',
        language: 'en',
        identifiers: { idb_dataset_id: id },
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
      if (outcome.kind === 'http_error') throw new Error(`IDB Open Data search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=poverty&rows=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'package_search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const idbOpenDataAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
