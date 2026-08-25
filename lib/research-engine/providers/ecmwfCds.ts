import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ecmwf_cds' as const
const BASE_URL = 'https://cds.climate.copernicus.eu/api/catalogue/v1/collections'
const MAX_RESULTS = 25

// The STAC dataset catalogue is real and zero-auth (confirmed live), but
// actual climate-data retrieval is a separate, credential-gated, async
// job-submission workflow (submit request -> poll -> download) that does
// not fit this codebase's synchronous provider contract. This adapter
// covers dataset/collection discovery only, not data retrieval.
type Extent = { spatial?: { bbox?: number[][] }; temporal?: { interval?: (string | null)[][] } }
type Collection = { id?: string; title?: string; description?: string; license?: string; keywords?: string[]; extent?: Extent }
type CollectionsResponse = { collections?: Collection[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().toLowerCase()
  if (!text) throw new Error('Query must be a keyword (e.g. "era5", "reanalysis", "seasonal").')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `ecmwf_cds:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, BASE_URL, { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<CollectionsResponse>(result.text)
  if (!data || !Array.isArray(data.collections)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'ECMWF CDS response "collections" field was missing or not an array.' }
  }

  const documents = data.collections
    .filter(c => typeof c.id === 'string' && (
      c.id.toLowerCase().includes(text) ||
      c.title?.toLowerCase().includes(text) ||
      c.description?.toLowerCase().includes(text) ||
      c.keywords?.some(k => k.toLowerCase().includes(text))
    ))
    .slice(0, limit)
    .map(c => {
      const id = c.id as string
      const canonicalUrl = `https://cds.climate.copernicus.eu/datasets/${id}`
      const bbox = c.extent?.spatial?.bbox?.[0]
      return makeDocument({
        id: `ecmwf_cds:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: c.title ?? id,
        summary: c.description?.slice(0, 400) ?? null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'ECMWF Copernicus Climate Data Store',
        contentType: 'climate_dataset_collection',
        authors: [],
        organization: 'ECMWF / Copernicus',
        publishedAt: c.extent?.temporal?.interval?.[0]?.[0] ?? null,
        updatedAt: null,
        geography: bbox ? `bbox:${bbox.join(',')}` : 'global',
        language: 'en',
        identifiers: { ecmwf_cds_collection: id },
        subjects: c.keywords ?? [],
        license: c.license ?? null,
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
      if (outcome.kind === 'http_error') throw new Error(`ECMWF CDS search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, BASE_URL, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'collections catalogue reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ecmwfCdsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
