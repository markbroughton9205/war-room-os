import 'server-only'

import type { ResearchGeoFeature, ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'nws_weather' as const
const BASE_URL = 'https://api.weather.gov'
const COORD_PATTERN = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/
const USER_AGENT = 'WarRoomOS-ResearchEngine/1.0 (research-engine@warroom.internal)'
const MAX_ALERTS = 60

// Dispatch patterns for the alerts capability (Terra Phase 5) — kept on this same provider/host
// rather than a second nws_* adapter, since it is the exact same organization and API
// (api.weather.gov) the existing forecast capability already uses.
const ALERTS_BARE_PATTERN = /^alerts$/i
const ALERTS_NEAR_PATTERN = /^alerts\s+near\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/i
const ALERTS_AREA_PATTERN = /^alerts\s+area\s+([A-Za-z]{2})$/i

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

type NwsAlertGeometry = { type?: string; coordinates?: unknown } | null
type NwsAlertProperties = {
  id?: string
  areaDesc?: string
  event?: string
  severity?: string
  certainty?: string
  urgency?: string
  status?: string
  messageType?: string
  category?: string
  headline?: string | null
  description?: string | null
  instruction?: string | null
  senderName?: string
  sent?: string
  effective?: string
  onset?: string | null
  expires?: string
  ends?: string | null
  web?: string
}
type NwsAlertFeature = { id?: string; geometry?: NwsAlertGeometry; properties?: NwsAlertProperties }
type NwsAlertsResponse = { features?: NwsAlertFeature[] }

/** NWS is a real two-hop API — /points/{lat},{lon} resolves the forecast
 * office grid, whose returned forecast URL must be fetched separately
 * (confirmed live; cannot fetch a forecast directly from lat/lon). */
async function searchForecast(lat: string, lon: string, started: number) {
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

/**
 * NWS's real CAP-based active-alerts feed (Terra Phase 5) — genuine severe-weather-warning
 * products (Severe Thunderstorm Warning, Flash Flood Warning, Red Flag Warning, etc.), not point
 * forecasts. Many alerts carry a real GeoJSON Polygon; some are zone-only (`geometry: null`) —
 * both are preserved as documents, but only polygon-bearing alerts also get a geoFeature (never a
 * fabricated point for a zone-only alert).
 */
async function searchAlerts(scope: { kind: 'bare' } | { kind: 'point'; lat: string; lon: string } | { kind: 'area'; state: string }, started: number) {
  const cacheKey = scope.kind === 'bare' ? 'nws_weather:alerts:bare' : scope.kind === 'point' ? `nws_weather:alerts:point:${scope.lat}:${scope.lon}` : `nws_weather:alerts:area:${scope.state}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/alerts/active`)
  if (scope.kind === 'point') url.searchParams.set('point', `${scope.lat},${scope.lon}`)
  if (scope.kind === 'area') url.searchParams.set('area', scope.state.toUpperCase())

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000, headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' } })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<NwsAlertsResponse>(result.text)
  if (!data || !Array.isArray(data.features)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'NWS alerts response "features" field was missing or not an array.' }
  }

  const alerts = data.features.filter(f => f.properties?.id).slice(0, MAX_ALERTS)

  const documents = alerts.map(alert => {
    const props = alert.properties as NwsAlertProperties
    const id = props.id as string
    return makeDocument({
      id: `nws_weather:alert:${id}`,
      provider: PROVIDER,
      providerRecordId: id,
      title: `${props.event ?? 'Alert'} — ${props.areaDesc ?? 'Unknown area'}`,
      summary: props.headline ?? props.description ?? null,
      contentSnippet: props.instruction ?? null,
      canonicalUrl: props.web ?? 'https://alerts.weather.gov/',
      sourceUrl: props.web ?? 'https://alerts.weather.gov/',
      sourceName: props.senderName ?? 'National Weather Service',
      contentType: 'severe_weather_alert',
      authors: [],
      organization: 'NOAA/NWS',
      publishedAt: props.effective ?? props.sent ?? null,
      updatedAt: props.sent ?? null,
      geography: props.areaDesc ?? null,
      language: 'en',
      identifiers: {
        event: props.event ?? '',
        severity: props.severity ?? 'Unknown',
        certainty: props.certainty ?? 'Unknown',
        urgency: props.urgency ?? 'Unknown',
        status: props.status ?? '',
        ...(props.expires ? { expires: props.expires } : {}),
        ...(props.onset ? { onset: props.onset } : {}),
        ...(props.ends ? { ends: props.ends } : {}),
      },
      subjects: [],
      license: null,
      accessStatus: 'open',
    })
  })

  const geoFeatures: ResearchGeoFeature[] = alerts
    .filter(alert => alert.geometry && alert.geometry.type === 'Polygon' && Array.isArray(alert.geometry.coordinates))
    .map(alert => ({
      id: alert.properties?.id as string,
      geometryType: 'Polygon',
      coordinates: alert.geometry?.coordinates,
      properties: { event: alert.properties?.event ?? null, severity: alert.properties?.severity ?? 'Unknown' },
    }))

  const response = okResponse(PROVIDER, { documents, geoFeatures, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()

  if (ALERTS_BARE_PATTERN.test(text)) return searchAlerts({ kind: 'bare' }, started)
  const nearMatch = ALERTS_NEAR_PATTERN.exec(text)
  if (nearMatch) return searchAlerts({ kind: 'point', lat: nearMatch[1], lon: nearMatch[2] }, started)
  const areaMatch = ALERTS_AREA_PATTERN.exec(text)
  if (areaMatch) return searchAlerts({ kind: 'area', state: areaMatch[1] }, started)

  const coordMatch = COORD_PATTERN.exec(text)
  if (!coordMatch) {
    throw new Error('Query must be "lat,lon" coordinates within the US for a forecast (e.g. "38.8894,-77.0352"), or "alerts" / "alerts near <lat,lon>" / "alerts area <ST>" for active severe-weather alerts.')
  }
  const [, lat, lon] = coordMatch
  return searchForecast(lat, lon, started)
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
