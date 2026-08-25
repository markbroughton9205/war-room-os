import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'gbif' as const
const BASE_URL = 'https://api.gbif.org/v1'
const MAX_RESULTS = 25

type GbifOccurrence = {
  key?: number
  scientificName?: string
  decimalLatitude?: number
  decimalLongitude?: number
  eventDate?: string
  country?: string
  basisOfRecord?: string
  kingdom?: string
  recordedBy?: string
  license?: string
}
type GbifResponse = { count?: number; results?: GbifOccurrence[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `gbif:occurrence:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/occurrence/search`)
  url.searchParams.set('scientificName', text)
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<GbifResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.results)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'GBIF response "results" field was missing or not an array.' }
  }

  const documents = data.results
    .filter(row => typeof row.key === 'number')
    .map(row => {
      const key = String(row.key)
      const canonicalUrl = `https://www.gbif.org/occurrence/${key}`
      const geoFeature = typeof row.decimalLatitude === 'number' && typeof row.decimalLongitude === 'number'
        ? `lat ${row.decimalLatitude}, lon ${row.decimalLongitude}` : null
      return makeDocument({
        id: `gbif:${key}`,
        provider: PROVIDER,
        providerRecordId: key,
        title: row.scientificName ?? `GBIF occurrence ${key}`,
        summary: geoFeature ? `${row.basisOfRecord ?? 'Occurrence'} recorded ${row.eventDate ?? 'unknown date'} at ${geoFeature}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'GBIF',
        contentType: 'biodiversity_occurrence',
        authors: row.recordedBy ? [row.recordedBy] : [],
        organization: null,
        publishedAt: row.eventDate ?? null,
        updatedAt: null,
        geography: row.country ?? null,
        language: null,
        identifiers: { gbif_occurrence_key: key },
        subjects: row.kingdom ? [row.kingdom] : [],
        license: row.license ?? null,
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
      if (outcome.kind === 'http_error') throw new Error(`GBIF search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/occurrence/search?scientificName=Puma%20concolor&limit=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'occurrence search reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const gbifAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
