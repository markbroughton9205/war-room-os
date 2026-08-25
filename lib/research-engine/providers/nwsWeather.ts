import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'nws_weather' as const
const BASE_URL = 'https://api.weather.gov'
const COORD_PATTERN = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/
const USER_AGENT = 'WarRoomOS-ResearchEngine/1.0 (research-engine@warroom.internal)'

type PointsResponse = { properties?: { forecast?: string; relativeLocation?: { properties?: { city?: string; state?: string } } } }
type Period = {
  name?: string
  startTime?: string
  temperature?: number
  temperatureUnit?: string
  windSpeed?: string
  windDirection?: string
  shortForecast?: string
  detailedForecast?: string
}
type ForecastResponse = { properties?: { periods?: Period[] } }

/** NWS is a real two-hop API — /points/{lat},{lon} resolves the forecast
 * office grid, whose returned forecast URL must be fetched separately
 * (confirmed live; cannot fetch a forecast directly from lat/lon). */
async function search(query: ResearchQuery) {
  const started = Date.now()
  const match = COORD_PATTERN.exec(query.text.trim())
  if (!match) throw new Error('Query must be "lat,lon" coordinates within the US (e.g. "38.8894,-77.0352").')
  const [, lat, lon] = match
  const cacheKey = `nws_weather:${lat}:${lon}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const pointsResult = await safeProviderFetch(PROVIDER, `${BASE_URL}/points/${lat},${lon}`, { timeoutMs: 12_000, headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' } })
  if (!pointsResult.ok) return { ok: false as const, kind: 'http_error' as const, status: pointsResult.status }

  const pointsData = safeJsonParse<PointsResponse>(pointsResult.text)
  const forecastUrl = pointsData?.properties?.forecast
  if (!forecastUrl) {
    return { ok: false as const, kind: 'malformed' as const, message: 'NWS points response did not include a "properties.forecast" URL.' }
  }

  const forecastResult = await safeProviderFetch(PROVIDER, forecastUrl, { timeoutMs: 12_000, headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' } })
  if (!forecastResult.ok) return { ok: false as const, kind: 'http_error' as const, status: forecastResult.status }

  const forecastData = safeJsonParse<ForecastResponse>(forecastResult.text)
  const periods = forecastData?.properties?.periods
  if (!Array.isArray(periods)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'NWS forecast response did not include a "properties.periods" array.' }
  }

  const locationLabel = pointsData?.properties?.relativeLocation?.properties
  const geography = locationLabel?.city && locationLabel?.state ? `${locationLabel.city}, ${locationLabel.state}` : `${lat},${lon}`
  const documents = periods.slice(0, 14).map((period, index) => makeDocument({
    id: `nws_weather:${lat}:${lon}:${index}`,
    provider: PROVIDER,
    providerRecordId: `${lat}:${lon}:${period.name ?? index}`,
    title: `${period.name ?? 'Forecast period'} — ${geography}`,
    summary: period.detailedForecast ?? period.shortForecast ?? null,
    contentSnippet: typeof period.temperature === 'number' ? `${period.temperature}°${period.temperatureUnit ?? 'F'}, wind ${period.windSpeed ?? 'n/a'} ${period.windDirection ?? ''}`.trim() : null,
    canonicalUrl: forecastUrl,
    sourceUrl: forecastUrl,
    sourceName: 'National Weather Service',
    contentType: 'weather_forecast',
    authors: [],
    organization: 'NOAA/NWS',
    publishedAt: period.startTime ?? null,
    updatedAt: null,
    geography,
    language: 'en',
    identifiers: { lat, lon },
    subjects: [],
    license: null,
    accessStatus: 'open',
  }))
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`NWS Weather fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/points/38.8894,-77.0352`, { timeoutMs: 10_000, headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' } })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'points endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const nwsWeatherAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
