import 'server-only'

import type { ResearchGeoFeature, ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, resolveBaseUrl } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'usgs_earthquake_feed' as const

// Fixed, documented allowlists — the adapter can never be pointed at an
// arbitrary feed path. Any unrecognized selection falls back to the
// conservative documented default (4.5 / day).
const MAGNITUDE_ALLOWLIST = ['significant', '4.5', '2.5', '1.0', 'all'] as const
const PERIOD_ALLOWLIST = ['hour', 'day', 'week', 'month'] as const
const DEFAULT_MAGNITUDE: (typeof MAGNITUDE_ALLOWLIST)[number] = '4.5'
const DEFAULT_PERIOD: (typeof PERIOD_ALLOWLIST)[number] = 'day'

const MAX_EVENTS = 100

type FeedMetadata = { generated?: number; url?: string; title?: string }
type FeedFeatureProperties = {
  mag: number | null
  place: string | null
  time: number
  updated: number
  url: string
  alert: string | null
  status: string | null
  tsunami: number | null
  sig: number | null
  code?: string | null
  ids?: string | null
  type?: string | null
}
type FeedFeature = {
  id: string
  properties: FeedFeatureProperties
  geometry: { type: string; coordinates: [number, number, number] } | null
}
type FeedCollection = { metadata?: FeedMetadata; features?: FeedFeature[] }

class UsgsEarthquakeFeedProviderError extends Error {
  category: 'upstream_error' | 'parse_error'
  constructor(message: string, category: 'upstream_error' | 'parse_error') {
    super(message)
    this.category = category
  }
}

function baseUrl(): string {
  const descriptor = providerEnvDescriptor(PROVIDER)
  return (descriptor && resolveBaseUrl('USGS_EARTHQUAKE_FEED_BASE_URL', descriptor)) || 'https://earthquake.usgs.gov/earthquakes/feed/v1.0'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** GeoJSON [lon, lat, depth?] — longitude/latitude must be finite and in-range; depth, if present, must be finite. */
function isValidFeedCoordinates(coordinates: unknown): coordinates is [number, number, number?] {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return false
  const [lon, lat, depth] = coordinates
  if (!isFiniteNumber(lon) || lon < -180 || lon > 180) return false
  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) return false
  if (depth !== undefined && depth !== null && !isFiniteNumber(depth)) return false
  return true
}

/** Matches only the fixed allowlisted tokens (whole-word), never arbitrary caller text, and falls back to the documented conservative default otherwise. */
function parseFeedSelection(text: string): { magnitude: (typeof MAGNITUDE_ALLOWLIST)[number]; period: (typeof PERIOD_ALLOWLIST)[number] } {
  const magnitude = MAGNITUDE_ALLOWLIST.find(candidate => new RegExp(`\\b${candidate.replace('.', '\\.')}\\b`, 'i').test(text)) ?? DEFAULT_MAGNITUDE
  const period = PERIOD_ALLOWLIST.find(candidate => new RegExp(`\\b${candidate}\\b`, 'i').test(text)) ?? DEFAULT_PERIOD
  return { magnitude, period }
}

async function fetchFeed(query: ResearchQuery) {
  const started = Date.now()
  const { magnitude, period } = parseFeedSelection(query.text)
  const cacheKey = `usgs_earthquake_feed:${magnitude}:${period}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  // Fixed path template only — magnitude/period are drawn exclusively from the allowlists above.
  const url = `${baseUrl()}/summary/${magnitude}_${period}.geojson`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<FeedCollection>(result.text)
  if (data === null || typeof data !== 'object') {
    return { ok: false as const, kind: 'malformed' as const, message: 'USGS Real-Time Earthquake Feed response could not be parsed as JSON.' }
  }
  // No independently verifiable official contract in this repo shows that a
  // completely missing `features` field is a valid empty response, so this
  // fails closed: `features` must be an explicit array. Missing, null, or
  // any non-array shape is a malformed upstream response, never a
  // fabricated empty success. Only an explicit `features: []` is honest.
  if (!Array.isArray(data.features)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'USGS Real-Time Earthquake Feed response "features" field was missing or not an array.' }
  }
  const features = data.features.slice(0, MAX_EVENTS)

  const geoFeatures: ResearchGeoFeature[] = features
    .filter(feature => feature.geometry && isValidFeedCoordinates(feature.geometry.coordinates))
    .map(feature => ({
      id: feature.id,
      geometryType: feature.geometry!.type,
      coordinates: feature.geometry!.coordinates,
      properties: feature.properties as unknown as Record<string, unknown>,
    }))

  const documents = features.map(feature => {
    const magText = typeof feature.properties.mag === 'number' ? `M${feature.properties.mag}` : 'M?'
    const place = feature.properties.place ?? 'Unknown location'
    return makeDocument({
      id: `usgs_earthquake_feed:${feature.id}`,
      provider: PROVIDER,
      providerRecordId: feature.id,
      title: `${magText} — ${place}`,
      summary: `${feature.properties.type ?? 'seismic event'} reported ${new Date(feature.properties.time).toISOString()}${feature.properties.tsunami ? ' — tsunami flag set' : ''}; feed=${magnitude}_${period}.`,
      contentSnippet: null,
      canonicalUrl: feature.properties.url,
      sourceUrl: feature.properties.url,
      sourceName: 'USGS Real-Time Earthquake Feeds',
      contentType: 'hazard_event_feed',
      authors: [],
      organization: 'USGS',
      publishedAt: new Date(feature.properties.time).toISOString(),
      updatedAt: new Date(feature.properties.updated).toISOString(),
      geography: place,
      language: 'en',
      identifiers: {
        usgs_event_id: feature.id,
        ...(feature.properties.code ? { usgs_event_code: feature.properties.code } : {}),
        ...(feature.properties.ids ? { usgs_event_ids: feature.properties.ids } : {}),
      },
      subjects: [
        ...(feature.properties.alert ? [`alert:${feature.properties.alert}`] : []),
        ...(typeof feature.properties.sig === 'number' ? [`significance:${feature.properties.sig}`] : []),
      ],
      license: null,
      accessStatus: 'open',
      warnings: feature.properties.mag === null ? ['Magnitude not yet available for this event.'] : [],
    })
  })

  const response = okResponse(PROVIDER, { documents, geoFeatures, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await fetchFeed(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new UsgsEarthquakeFeedProviderError(`USGS Real-Time Earthquake Feed request failed with HTTP ${outcome.status}`, 'upstream_error')
      throw new UsgsEarthquakeFeedProviderError(outcome.message, 'parse_error')
    })
  } catch (error) {
    if (error instanceof UsgsEarthquakeFeedProviderError) {
      return errorResponse(PROVIDER, { provider: PROVIDER, category: error.category, message: error.message, httpStatus: null }, 0)
    }
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${baseUrl()}/summary/significant_hour.geojson`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'summary feed reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const usgsEarthquakeFeedAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
