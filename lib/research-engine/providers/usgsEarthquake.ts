import 'server-only'

import type { ResearchGeoFeature, ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, resolveBaseUrl } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'usgs_earthquake' as const

type UsgsFeature = {
  id: string
  properties: { mag: number | null; place: string; time: number; updated: number; url: string; tsunami: number; alert: string | null; type: string; status: string }
  geometry: { type: string; coordinates: [number, number, number] }
}
type UsgsFeatureCollection = { features: UsgsFeature[] }

function baseUrl(): string {
  const descriptor = providerEnvDescriptor(PROVIDER)
  return (descriptor && resolveBaseUrl('USGS_EARTHQUAKE_API_BASE_URL', descriptor)) || 'https://earthquake.usgs.gov/fdsnws/event/1'
}

/** Accepts a free-text minimum magnitude like "M5" or "magnitude 4.5"; defaults to 4.5 over the last 30 days. */
function parseMinMagnitude(text: string): number {
  const match = /\bm(?:agnitude)?\s*(\d+(?:\.\d+)?)/i.exec(text)
  return match ? Number(match[1]) : 4.5
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const minMagnitude = parseMinMagnitude(query.text)
  const starttime = query.dateFrom ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  const endtime = query.dateTo ?? new Date().toISOString().slice(0, 10)
  const limit = Math.max(1, Math.min(query.maxResults ?? 15, 50))
  const cacheKey = `usgs_earthquake:${minMagnitude}:${starttime}:${endtime}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${baseUrl()}/query`)
  url.searchParams.set('format', 'geojson')
  url.searchParams.set('minmagnitude', String(minMagnitude))
  url.searchParams.set('starttime', starttime)
  url.searchParams.set('endtime', endtime)
  url.searchParams.set('orderby', 'time')
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, status: result.status }

  const data = safeJsonParse<UsgsFeatureCollection>(result.text)
  const features = data?.features ?? []
  const geoFeatures: ResearchGeoFeature[] = features.map(feature => ({
    id: feature.id,
    geometryType: feature.geometry.type,
    coordinates: feature.geometry.coordinates,
    properties: feature.properties as unknown as Record<string, unknown>,
  }))
  const documents = features.map(feature => makeDocument({
    id: `usgs_earthquake:${feature.id}`,
    provider: PROVIDER,
    providerRecordId: feature.id,
    title: `M${feature.properties.mag ?? '?'} — ${feature.properties.place}`,
    summary: `${feature.properties.type} reported ${new Date(feature.properties.time).toISOString()}${feature.properties.tsunami ? ' — tsunami flag set' : ''}.`,
    contentSnippet: null,
    canonicalUrl: feature.properties.url,
    sourceUrl: feature.properties.url,
    sourceName: 'USGS Earthquake Catalog',
    contentType: 'hazard_event',
    authors: [],
    organization: 'USGS',
    publishedAt: new Date(feature.properties.time).toISOString(),
    updatedAt: new Date(feature.properties.updated).toISOString(),
    geography: feature.properties.place,
    language: 'en',
    identifiers: { usgs_event_id: feature.id },
    subjects: feature.properties.alert ? [`alert:${feature.properties.alert}`] : [],
    license: null,
    accessStatus: 'open',
  }))

  const response = okResponse(PROVIDER, { documents, geoFeatures, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (!outcome.ok) throw new Error(`USGS Earthquake search failed with HTTP ${outcome.status}`)
      return outcome.response
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${baseUrl()}/query?format=geojson&limit=1&minmagnitude=6`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'query endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const usgsEarthquakeAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
