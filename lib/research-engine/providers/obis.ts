import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'obis' as const
const BASE_URL = 'https://api.obis.org/v3'
const MAX_RESULTS = 20

type Occurrence = {
  id?: string
  scientificName?: string
  vernacularName?: string
  decimalLatitude?: number
  decimalLongitude?: number
  eventDate?: string
  datasetName?: string
  institutionCode?: string
  basisOfRecord?: string
  waterBody?: string
}
type OccurrenceResponse = { total?: number; results?: Occurrence[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 150)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `obis:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/occurrence`)
  url.searchParams.set('scientificname', text)
  url.searchParams.set('size', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<OccurrenceResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.results)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'OBIS response "results" field was missing or not an array.' }
  }

  const documents = data.results
    .filter(occ => occ.id)
    .map(occ => {
      const id = occ.id as string
      const canonicalUrl = `https://obis.org/occurrence/${id}`
      const geo = typeof occ.decimalLatitude === 'number' && typeof occ.decimalLongitude === 'number' ? `lat ${occ.decimalLatitude}, lon ${occ.decimalLongitude}` : null
      return makeDocument({
        id: `obis:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: occ.scientificName ?? occ.vernacularName ?? `OBIS occurrence ${id}`,
        summary: geo ? `${occ.basisOfRecord ?? 'Occurrence'} at ${geo}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: occ.datasetName ?? 'OBIS',
        contentType: 'biodiversity_occurrence',
        authors: [],
        organization: occ.institutionCode ?? null,
        publishedAt: occ.eventDate ?? null,
        updatedAt: null,
        geography: occ.waterBody ?? null,
        language: null,
        identifiers: { obis_occurrence_id: id },
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
      if (outcome.kind === 'http_error') throw new Error(`OBIS search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/occurrence?scientificname=Orcinus%20orca&size=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'occurrence endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const obisAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
