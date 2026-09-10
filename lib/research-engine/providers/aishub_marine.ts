import 'server-only'

/**
 * AISHub community aggregate feed.
 *
 * Access is reciprocal: a real AIS receiver feed (coverage + uptime) must be contributed before
 * AISHub issues a username. Without AISHUB_USERNAME the adapter returns not_configured
 * (NEEDS_CREDENTIALS). No purchase path exists. Terms: contributor-only use of the aggregate.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { isProviderEnvSatisfied, providerEnvDescriptor } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'
import { makeMaritimeVesselDocument, observationInBbox, parseMaritimeBbox } from '@/lib/research-engine/providers/maritimeAisShared'

const PROVIDER = 'aishub_marine' as const
const BASE_URL = 'https://data.aishub.net/ws.php'
const MAX_RESULTS = 150

type AisHubVessel = {
  MMSI?: number
  LATITUDE?: number
  LONGITUDE?: number
  NAME?: string
  CALLSIGN?: string
  IMO?: number
  DEST?: string
  DRAUGHT?: number
  TYPE?: number
  SOG?: number
  COG?: number
  HEADING?: number
  NAVSTAT?: number
  TIME?: string
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const bbox = parseMaritimeBbox(query.text)
  if (!bbox) throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax".')
  const username = process.env.AISHUB_USERNAME?.trim() ?? ''
  const limit = Math.max(1, Math.min(query.maxResults ?? 50, MAX_RESULTS))
  const cacheKey = `aishub_marine:${query.text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}?username=${encodeURIComponent(username)}&format=1&output=json&compress=0&latmin=${bbox.lamin}&latmax=${bbox.lamax}&lonmin=${bbox.lomin}&lonmax=${bbox.lomax}`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const parsed = safeJsonParse<unknown>(result.text)
  const rows: AisHubVessel[] = Array.isArray(parsed) && Array.isArray(parsed[1])
    ? parsed[1] as AisHubVessel[]
    : Array.isArray(parsed)
      ? parsed as AisHubVessel[]
      : []

  const documents = rows.flatMap(row => {
    const mmsi = row.MMSI
    const latitude = row.LATITUDE
    const longitude = row.LONGITUDE
    if (typeof mmsi !== 'number' || typeof latitude !== 'number' || typeof longitude !== 'number') return []
    if (!observationInBbox(latitude, longitude, bbox)) return []
    const observedAt = row.TIME ? new Date(row.TIME).toISOString() : nowIso()
    return [makeMaritimeVesselDocument(PROVIDER, {
      mmsi,
      latitude,
      longitude,
      name: row.NAME,
      callSign: row.CALLSIGN,
      imo: row.IMO,
      destination: row.DEST,
      draughtMeters: row.DRAUGHT,
      shipTypeCode: row.TYPE,
      speedKnots: row.SOG,
      courseDeg: row.COG,
      headingDeg: row.HEADING,
      navStatCode: row.NAVSTAT,
      observedAtIso: Number.isFinite(Date.parse(observedAt)) ? observedAt : nowIso(),
      canonicalUrl: 'https://www.aishub.net/api',
      sourceName: 'AISHub community aggregate feed',
      organization: 'AISHub',
      license: 'AISHub contributor terms',
    })]
  }).slice(0, limit)

  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'AISHUB_USERNAME is not configured. AISHub access is earned by contributing a real AIS feed.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      throw new Error(`AISHub request failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'AISHUB_USERNAME missing', durationMs: null }
  }
  return { provider: PROVIDER, state: 'ready', checkedAt: nowIso(), detail: 'Username present; reciprocal feed still required by AISHub', durationMs: 0 }
}

export const aishubMarineAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
