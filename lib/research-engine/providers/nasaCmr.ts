import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'nasa_cmr' as const
const BASE_URL = 'https://cmr.earthdata.nasa.gov/search/collections.json'
const MAX_RESULTS = 20

type CmrEntry = { entry_id?: string; short_name?: string; dataset_id?: string; version_id?: string; data_center?: string; summary?: string; time_start?: string; time_end?: string }
type CmrResponse = { feed?: { entry?: CmrEntry[] } }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `nasa_cmr:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('keyword', text)
  url.searchParams.set('page_size', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<CmrResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.feed?.entry)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'NASA CMR response "feed.entry" field was missing or not an array.' }
  }

  const documents = data.feed!.entry!
    .filter(entry => entry.short_name || entry.entry_id)
    .map(entry => {
      const id = entry.entry_id ?? `${entry.short_name}:${entry.version_id ?? ''}`
      const canonicalUrl = `https://search.earthdata.nasa.gov/search/granules?p=${encodeURIComponent(id)}`
      return makeDocument({
        id: `nasa_cmr:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: entry.dataset_id ?? entry.short_name ?? id,
        summary: entry.summary ?? null,
        contentSnippet: entry.data_center ? `Data center: ${entry.data_center}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'NASA Earthdata CMR',
        contentType: 'earth_observation_dataset',
        authors: [],
        organization: entry.data_center ?? null,
        publishedAt: entry.time_start ?? null,
        updatedAt: entry.time_end ?? null,
        geography: null,
        language: 'en',
        identifiers: { cmr_entry_id: id, ...(entry.short_name ? { short_name: entry.short_name } : {}) },
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
      if (outcome.kind === 'http_error') throw new Error(`NASA CMR search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?keyword=MODIS&page_size=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'collections endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const nasaCmrAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
