import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'open_meteo' as const
const BASE_URL = 'https://api.open-meteo.com/v1/forecast'
const COORD_PATTERN = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/

type OpenMeteoResponse = {
  latitude?: number
  longitude?: number
  timezone?: string
  current?: { time?: string; temperature_2m?: number; wind_speed_10m?: number }
  current_units?: { temperature_2m?: string; wind_speed_10m?: string }
}

/** Query text is "<lat>,<lon>". */
function parseCoords(text: string): { lat: number; lon: number } | null {
  const match = COORD_PATTERN.exec(text.trim())
  if (!match) return null
  const lat = Number(match[1])
  const lon = Number(match[2])
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return { lat, lon }
}

async function fetchForecast(query: ResearchQuery) {
  const started = Date.now()
  const coords = parseCoords(query.text)
  if (!coords) {
    throw new Error('Query must be "<lat>,<lon>" (e.g. "52.52,13.41").')
  }
  const cacheKey = `open_meteo:${coords.lat}:${coords.lon}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('latitude', String(coords.lat))
  url.searchParams.set('longitude', String(coords.lon))
  url.searchParams.set('current', 'temperature_2m,wind_speed_10m')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 10_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<OpenMeteoResponse>(result.text)
  if (!data || !data.current?.time) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Open-Meteo response did not contain the expected "current" forecast object.' }
  }

  const canonicalUrl = 'https://open-meteo.com/en/docs'
  const documents = [makeDocument({
    id: `open_meteo:${coords.lat}:${coords.lon}:${data.current.time}`,
    provider: PROVIDER,
    providerRecordId: `${coords.lat}:${coords.lon}:${data.current.time}`,
    title: `Weather at ${coords.lat},${coords.lon} — ${data.current.time}`,
    summary: `Temperature: ${data.current.temperature_2m}${data.current_units?.temperature_2m ?? '°C'}, Wind: ${data.current.wind_speed_10m}${data.current_units?.wind_speed_10m ?? 'km/h'}`,
    contentSnippet: null,
    canonicalUrl,
    sourceUrl: url.toString(),
    sourceName: 'Open-Meteo',
    contentType: 'weather_forecast_point',
    authors: [],
    organization: null,
    publishedAt: data.current.time,
    updatedAt: null,
    geography: data.timezone ?? null,
    language: null,
    identifiers: { latitude: String(coords.lat), longitude: String(coords.lon) },
    subjects: [],
    license: null,
    accessStatus: 'open',
  })]
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await fetchForecast(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Open-Meteo fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?latitude=52.52&longitude=13.41&current=temperature_2m`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'forecast endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const openMeteoAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
