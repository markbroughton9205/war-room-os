import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, cacheTtlFromExpiresHeader, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'
import { TERRA_PUBLIC_USER_AGENT, TERRA_OFFICIAL_VIEWERS } from '@/lib/terra/terraPublicIdentity'

const PROVIDER = 'met_no' as const
const BASE_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact'
const COORD_PATTERN = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/

type MetNoResponse = {
  geometry?: { coordinates?: [number, number, number] }
  properties?: { meta?: { updated_at?: string }; timeseries?: { time?: string; data?: { instant?: { details?: Record<string, number> } } }[] }
}

/**
 * Descriptive User-Agent required by policy, but met.no's WAF specifically
 * blocks the literal substring "test@example.com" in any User-Agent
 * (confirmed live) — a real, non-placeholder contact string is used instead.
 */
function userAgent(): string {
  return TERRA_PUBLIC_USER_AGENT
}

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
  const cacheKey = `met_no:${coords.lat}:${coords.lon}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('lat', String(coords.lat))
  url.searchParams.set('lon', String(coords.lon))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { 'User-Agent': userAgent(), Accept: 'application/json' }, timeoutMs: 10_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<MetNoResponse>(result.text)
  const first = data?.properties?.timeseries?.[0]
  if (!first?.time) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Met.no response did not contain the expected timeseries data.' }
  }

  const details = first.data?.instant?.details ?? {}
  const canonicalUrl = TERRA_OFFICIAL_VIEWERS.metNorway
  const documents = [makeDocument({
    id: `met_no:${coords.lat}:${coords.lon}:${first.time}`,
    provider: PROVIDER,
    providerRecordId: `${coords.lat}:${coords.lon}:${first.time}`,
    title: `Weather at ${coords.lat},${coords.lon} — ${first.time}`,
    summary: `Temperature: ${details.air_temperature ?? 'unknown'}°C, Pressure: ${details.air_pressure_at_sea_level ?? 'unknown'} hPa`,
    contentSnippet: result.lastModified ? `Last-Modified: ${result.lastModified}` : null,
    canonicalUrl,
    sourceUrl: url.toString(),
    sourceName: 'Met.no (Norwegian Meteorological Institute)',
    contentType: 'weather_forecast_point',
    authors: [],
    organization: 'Norwegian Meteorological Institute',
    publishedAt: first.time,
    updatedAt: data?.properties?.meta?.updated_at ?? result.lastModified ?? null,
    geography: `lat ${coords.lat}, lon ${coords.lon}`,
    language: null,
    identifiers: {
      latitude: String(coords.lat),
      longitude: String(coords.lon),
      viewerUrl: canonicalUrl,
      ...(result.expires ? { expires: result.expires } : {}),
      ...(result.lastModified ? { lastModified: result.lastModified } : {}),
    },
    subjects: [],
    license: 'CC BY 4.0',
    accessStatus: 'open',
  })]
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, cacheTtlFromExpiresHeader(result.expires, CACHE_TTL.liveFeed))
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await fetchForecast(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') {
        const status = outcome.status
        const category = status === 429 ? 'rate_limited' : 'upstream_error'
        const message = status === 429
          ? 'MET Norway RATE_LIMITED (HTTP 429).'
          : status === 403
            ? 'MET Norway UPSTREAM_403 — identifying User-Agent required; request was rejected.'
            : `MET Norway fetch failed with HTTP ${status}`
        return errorResponse(PROVIDER, { provider: PROVIDER, category, message, httpStatus: status }, 0)
      }
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?lat=52.52&lon=13.41`, { headers: { 'User-Agent': userAgent() }, timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'forecast endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const metNoAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
