import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'met_office_datahub' as const
const BASE_URL = 'https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point/hourly'
const COORD_PATTERN = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/

// Real Azure-APIM-gated API (confirmed live: unauthenticated calls return a
// real structured "Missing Credentials" error naming the ApiKey header).
// Free self-service key via account registration at metoffice.gov.uk.
type Parameter = { name?: string; unit?: string }
type TimeSeries = { time?: string; screenTemperature?: number; totalPrecipAmount?: number; windSpeed10m?: number }
type Feature = { properties?: { timeSeries?: TimeSeries[]; location?: { name?: string } } }
type Response = { features?: Feature[]; parameters?: Parameter[] }

function apiKey(): string {
  return process.env.MET_OFFICE_DATAHUB_API_KEY?.trim() ?? ''
}

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const match = COORD_PATTERN.exec(query.text.trim())
  if (!match) throw new Error('Query must be "<lat>,<lon>" (e.g. "51.5,-0.1" for London).')
  const [, lat, lon] = match
  const cacheKey = `met_office_datahub:${lat}:${lon}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('latitude', lat)
  url.searchParams.set('longitude', lon)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { apikey: apiKey(), Accept: 'application/json' }, timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<Response>(result.text)
  const feature = data?.features?.[0]
  const series = feature?.properties?.timeSeries
  if (!Array.isArray(series)) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const canonicalUrl = `https://weather.metoffice.gov.uk/`
  const documents = series.slice(0, Math.max(1, Math.min(query.maxResults ?? 10, 25))).map((point, index) => makeDocument({
    id: `met_office_datahub:${lat}:${lon}:${point.time ?? index}`,
    provider: PROVIDER,
    providerRecordId: `${lat}:${lon}:${index}`,
    title: `${feature?.properties?.location?.name ?? `${lat},${lon}`} — ${point.time ?? ''}`,
    summary: point.screenTemperature != null ? `Temperature: ${point.screenTemperature}°C` : null,
    contentSnippet: point.windSpeed10m != null ? `Wind: ${point.windSpeed10m} m/s, Precip: ${point.totalPrecipAmount ?? 0}mm` : null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'Met Office Weather DataHub',
    contentType: 'weather_forecast_point',
    authors: [],
    organization: 'UK Met Office',
    publishedAt: point.time ?? null,
    updatedAt: null,
    geography: `${lat},${lon}`,
    language: 'en',
    identifiers: { met_office_coords: `${lat},${lon}` },
    subjects: [],
    license: null,
    accessStatus: 'open',
  }))
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'MET_OFFICE_DATAHUB_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      throw new Error(`Met Office DataHub lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'MET_OFFICE_DATAHUB_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?latitude=51.5&longitude=-0.1`, { headers: { apikey: apiKey(), Accept: 'application/json' }, timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'hourly point endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const metOfficeDataHubAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
