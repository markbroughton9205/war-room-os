import 'server-only'

import type { ResearchGeoFeature, ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, resolveBaseUrl } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

/**
 * UN DESA Population Division Data Portal API (WPP) — reference-metadata only, deliberately.
 *
 * Confirmed live during this mission: /locations/ and /indicators/ (300 and 86 rows respectively
 * — both fit in one unpaginated page) are genuinely zero-auth. The actual population-FIGURE query
 * endpoint (/data/indicators/{id}/locations/{id}/start/{y}/end/{y}) returned a real
 * WWW-Authenticate: Bearer 401 in this mission's live probe — a real, current access-policy
 * requirement this session has no credential for. Building only the metadata surface and being
 * explicit about that boundary (rather than either skipping the source entirely or building a
 * data-query path this session cannot verify) is the honest middle path: every document this
 * adapter returns is reference metadata (what indicators/locations exist and their real codes),
 * never a population figure.
 */
const PROVIDER = 'un_desa_population' as const
const MAX_RESULTS_PER_KIND = 15

type UnLocation = { id: number; name: string; iso3: string | null; iso2: string | null; longitude: number | null; latitude: number | null }
type UnIndicator = { id: number; name: string; shortName: string | null; description: string | null }
type UnListResponse<T> = { data: T[] }

function baseUrl(): string {
  const descriptor = providerEnvDescriptor(PROVIDER)
  return (descriptor && resolveBaseUrl('UN_DESA_POPULATION_API_BASE_URL', descriptor)) || 'https://population.un.org/dataportalapi/api/v1'
}

async function fetchAllLocations(): Promise<UnLocation[] | null> {
  const cacheKey = 'un_desa_population:locations'
  const cached = cacheGet<UnLocation[]>(cacheKey)
  if (cached) return cached
  const result = await safeProviderFetch(PROVIDER, `${baseUrl()}/locations/?pageSize=1000`, { timeoutMs: 15_000 })
  if (!result.ok) return null
  const data = safeJsonParse<UnListResponse<UnLocation>>(result.text)
  if (!data || !Array.isArray(data.data)) return null
  cacheSet(cacheKey, data.data, CACHE_TTL.codelist)
  return data.data
}

async function fetchAllIndicators(): Promise<UnIndicator[] | null> {
  const cacheKey = 'un_desa_population:indicators'
  const cached = cacheGet<UnIndicator[]>(cacheKey)
  if (cached) return cached
  const result = await safeProviderFetch(PROVIDER, `${baseUrl()}/indicators/?pageSize=200`, { timeoutMs: 15_000 })
  if (!result.ok) return null
  const data = safeJsonParse<UnListResponse<UnIndicator>>(result.text)
  if (!data || !Array.isArray(data.data)) return null
  cacheSet(cacheKey, data.data, CACHE_TTL.codelist)
  return data.data
}

function matches(text: string, haystack: string): boolean {
  return text.length === 0 || haystack.toLowerCase().includes(text.toLowerCase())
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()

  const [locations, indicators] = await Promise.all([fetchAllLocations(), fetchAllIndicators()])
  if (!locations || !indicators) return { ok: false as const, message: 'UN DESA Population Data Portal locations/indicators endpoints did not return a valid response.' }

  const matchedLocations = locations.filter(loc => matches(text, loc.name)).slice(0, MAX_RESULTS_PER_KIND)
  const matchedIndicators = indicators.filter(ind => matches(text, ind.name)).slice(0, MAX_RESULTS_PER_KIND)

  const locationDocuments = matchedLocations.map(loc => makeDocument({
    id: `un_desa_population:location:${loc.id}`,
    provider: PROVIDER,
    providerRecordId: String(loc.id),
    title: loc.name,
    summary: 'UN DESA Population Division reference location — code/coordinates only. Actual population figures require the data-query endpoint, which requires a bearer token not available to this build.',
    contentSnippet: null,
    canonicalUrl: `https://population.un.org/dataportalapi/api/v1/locations/${loc.id}`,
    sourceUrl: `https://population.un.org/dataportalapi/api/v1/locations/${loc.id}`,
    sourceName: 'UN DESA Population Division Data Portal',
    contentType: 'population_location_metadata',
    authors: [],
    organization: 'UN Department of Economic and Social Affairs, Population Division',
    publishedAt: null,
    updatedAt: null,
    geography: loc.latitude !== null && loc.longitude !== null ? `lat ${loc.latitude}, lon ${loc.longitude}` : loc.iso3,
    language: 'en',
    identifiers: { un_location_id: String(loc.id), ...(loc.iso3 ? { iso3: loc.iso3 } : {}), ...(loc.iso2 ? { iso2: loc.iso2 } : {}) },
    subjects: ['population', 'reference-location'],
    license: null,
    accessStatus: 'open',
  }))

  const indicatorDocuments = matchedIndicators.map(ind => makeDocument({
    id: `un_desa_population:indicator:${ind.id}`,
    provider: PROVIDER,
    providerRecordId: String(ind.id),
    title: ind.name,
    summary: ind.description ?? 'UN DESA Population Division reference indicator — definition only. Actual figures require the data-query endpoint, which requires a bearer token not available to this build.',
    contentSnippet: null,
    canonicalUrl: `https://population.un.org/dataportalapi/api/v1/indicators/${ind.id}`,
    sourceUrl: `https://population.un.org/dataportalapi/api/v1/indicators/${ind.id}`,
    sourceName: 'UN DESA Population Division Data Portal',
    contentType: 'population_indicator_metadata',
    authors: [],
    organization: 'UN Department of Economic and Social Affairs, Population Division',
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: { un_indicator_id: String(ind.id), ...(ind.shortName ? { short_name: ind.shortName } : {}) },
    subjects: ['population', 'reference-indicator'],
    license: null,
    accessStatus: 'open',
  }))

  const geoFeatures: ResearchGeoFeature[] = matchedLocations
    .filter(loc => loc.latitude !== null && loc.longitude !== null)
    .map(loc => ({
      id: `un_desa_population:location:${loc.id}`,
      geometryType: 'Point',
      coordinates: [loc.longitude, loc.latitude],
      properties: { name: loc.name, iso3: loc.iso3, iso2: loc.iso2 },
    }))

  const response = okResponse(PROVIDER, { documents: [...indicatorDocuments, ...locationDocuments], geoFeatures, durationMs: Date.now() - started })
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${baseUrl()}/locations/?pageSize=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'locations endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const unDesaPopulationAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
