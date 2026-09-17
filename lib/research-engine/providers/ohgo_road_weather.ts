import 'server-only'

/**
 * OHGO weather sensor sites (RWIS). PUBLIC_KEY. Bounded map-bounds query.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { ohgoApiKey, ohgoGetJson, ohgoLatLon, ohgoParseId, parseOhgoList, OHGO_API_BASE } from './ohgo_shared'
import { TERRA_OFFICIAL_VIEWERS } from '@/lib/terra/terraPublicIdentity'

const PROVIDER = 'ohgo_road_weather' as const
const MAX_RESULTS = 60
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/

type OhgoSite = {
  Id?: string | number
  id?: string | number
  Latitude?: number
  latitude?: number
  Longitude?: number
  longitude?: number
  Location?: string
  location?: string
  Description?: string
  description?: string
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const key = ohgoApiKey()
  if (!key) return { ok: false as const, kind: 'not_configured' as const, message: 'OHGO_API_KEY is not configured.' }
  const match = BBOX_PATTERN.exec(query.text.trim())
  if (!match) throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax".')
  const [, laminStr, lominStr, lamaxStr, lomaxStr] = match
  const bbox = { lamin: Number(laminStr), lomin: Number(lominStr), lamax: Number(lamaxStr), lomax: Number(lomaxStr) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 40, MAX_RESULTS))
  const cacheKey = `ohgo_road_weather:${query.text.trim()}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await ohgoGetJson(PROVIDER, 'weather-sensor-sites', key, bbox)
  if (result.status === 429) return { ok: false as const, kind: 'http_error' as const, status: 429 }
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }
  const rows = parseOhgoList<OhgoSite>(safeJsonParse(result.text))
  if (!rows) return { ok: false as const, kind: 'malformed' as const, message: 'OHGO weather-sensor-sites response was not a list.' }

  const documents = rows.slice(0, limit).flatMap(row => {
    const id = ohgoParseId(row)
    const point = ohgoLatLon(row)
    if (!id || !point) return []
    const title = (row.Description ?? row.description ?? row.Location ?? row.location ?? `OHGO RWIS ${id}`).trim()
    return [makeDocument({
      id: `ohgo_road_weather:${id}`,
      provider: PROVIDER,
      providerRecordId: id,
      title,
      summary: 'OHGO weather sensor site',
      contentSnippet: `lat ${point.lat}, lon ${point.lon}`,
      canonicalUrl: TERRA_OFFICIAL_VIEWERS.ohgo,
      sourceUrl: `${OHGO_API_BASE}/weather-sensor-sites`,
      sourceName: 'ODOT / OHGO',
      contentType: 'road_weather_observation',
      authors: [],
      organization: 'ODOT',
      publishedAt: null,
      updatedAt: null,
      geography: `lat ${point.lat}, lon ${point.lon}`,
      language: 'en',
      identifiers: {
        latitude: String(point.lat),
        longitude: String(point.lon),
        viewerUrl: TERRA_OFFICIAL_VIEWERS.ohgo,
      },
      subjects: ['rwis'],
      license: 'OHGO Public API',
      accessStatus: 'open',
    })]
  })

  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'OHGO_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'not_configured') return notConfiguredResponse(PROVIDER, outcome.message)
      if (outcome.kind === 'http_error') throw new Error(outcome.status === 429 ? 'OHGO weather sensors RATE_LIMITED (HTTP 429).' : `OHGO weather sensors failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const key = ohgoApiKey()
  if (!key) return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'OHGO_API_KEY missing', durationMs: null }
  try {
    const result = await ohgoGetJson(PROVIDER, 'weather-sensor-sites', key, { lamin: 41.0, lomin: -81.7, lamax: 41.2, lomax: -81.3 })
    const state = result.ok ? 'ready' : result.status === 401 || result.status === 403 ? 'authentication_failed' : result.status === 429 ? 'rate_limited' : 'degraded'
    return { provider: PROVIDER, state, checkedAt: nowIso(), detail: result.ok ? 'weather-sensor-sites reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ohgoRoadWeatherAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
