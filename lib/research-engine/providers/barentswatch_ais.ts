import 'server-only'

/**
 * BarentsWatch Open AIS (Norway) — OAuth2 client-credentials, NLOD.
 * No anonymous path. Without BARENTSWATCH_CLIENT_ID / BARENTSWATCH_CLIENT_SECRET the adapter
 * returns not_configured (mapped to NEEDS_CREDENTIALS). Secrets never leave the server.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { isProviderEnvSatisfied, providerEnvDescriptor } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'
import { makeMaritimeVesselDocument, observationInBbox, parseMaritimeBbox } from '@/lib/research-engine/providers/maritimeAisShared'

const PROVIDER = 'barentswatch_ais' as const
const TOKEN_URL = 'https://id.barentswatch.no/connect/token'
const BASE_URL = 'https://live.ais.barentswatch.no'
const MAX_RESULTS = 150

type TokenResponse = { access_token?: string; expires_in?: number }
type BarentsWatchVessel = {
  mmsi?: number
  latitude?: number
  longitude?: number
  lat?: number
  lon?: number
  name?: string
  callsign?: string
  callSign?: string
  imo?: number
  destination?: string
  draught?: number
  shipType?: number
  speedOverGround?: number
  sog?: number
  courseOverGround?: number
  cog?: number
  heading?: number
  trueHeading?: number
  navStatus?: number
  navigationalStatus?: number
  msgtime?: string
  timeStamp?: string
  geometry?: { type?: string; coordinates?: [number, number] }
  properties?: BarentsWatchVessel
}

let cachedToken: { value: string; expiresAt: number } | null = null

async function fetchAccessToken(): Promise<{ ok: true; token: string } | { ok: false; status: number | null }> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return { ok: true, token: cachedToken.value }
  const clientId = process.env.BARENTSWATCH_CLIENT_ID?.trim() ?? ''
  const clientSecret = process.env.BARENTSWATCH_CLIENT_SECRET?.trim() ?? ''
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: 'ais',
  })
  const result = await safeProviderFetch(PROVIDER, TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    timeoutMs: 10_000,
  })
  if (!result.ok) return { ok: false, status: result.status }
  const data = safeJsonParse<TokenResponse>(result.text)
  if (!data?.access_token) return { ok: false, status: null }
  const ttlMs = Math.max(60_000, (data.expires_in ?? 3600) * 1000 - 60_000)
  cachedToken = { value: data.access_token, expiresAt: Date.now() + ttlMs }
  return { ok: true, token: data.access_token }
}

function asVesselRows(payload: unknown): BarentsWatchVessel[] {
  if (Array.isArray(payload)) return payload as BarentsWatchVessel[]
  if (payload && typeof payload === 'object') {
    const record = payload as { features?: BarentsWatchVessel[]; data?: BarentsWatchVessel[] }
    if (Array.isArray(record.features)) return record.features
    if (Array.isArray(record.data)) return record.data
  }
  return []
}

function readPosition(row: BarentsWatchVessel): { latitude: number; longitude: number } | null {
  const props = row.properties ?? row
  const fromGeometry = row.geometry?.coordinates
  const longitude = typeof fromGeometry?.[0] === 'number' ? fromGeometry[0] : (props.longitude ?? props.lon)
  const latitude = typeof fromGeometry?.[1] === 'number' ? fromGeometry[1] : (props.latitude ?? props.lat)
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const bbox = parseMaritimeBbox(query.text)
  if (!bbox) throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax".')
  const limit = Math.max(1, Math.min(query.maxResults ?? 50, MAX_RESULTS))
  const cacheKey = `barentswatch_ais:${query.text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const tokenOutcome = await fetchAccessToken()
  if (!tokenOutcome.ok) return { ok: false as const, kind: 'auth_error' as const, status: tokenOutcome.status }

  const url = `${BASE_URL}/v1/latest/combined?Xmin=${encodeURIComponent(String(bbox.lomin))}&Xmax=${encodeURIComponent(String(bbox.lomax))}&Ymin=${encodeURIComponent(String(bbox.lamin))}&Ymax=${encodeURIComponent(String(bbox.lamax))}`
  const result = await safeProviderFetch(PROVIDER, url, {
    headers: { Authorization: `Bearer ${tokenOutcome.token}`, Accept: 'application/json' },
    timeoutMs: 15_000,
  })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }
  const rows = asVesselRows(safeJsonParse<unknown>(result.text))
  const documents = rows.flatMap(row => {
    const props = row.properties ?? row
    const mmsi = props.mmsi
    const point = readPosition(row)
    if (typeof mmsi !== 'number' || !Number.isFinite(mmsi) || !point) return []
    if (!observationInBbox(point.latitude, point.longitude, bbox)) return []
    const observedAt = props.msgtime ?? props.timeStamp ?? nowIso()
    return [makeMaritimeVesselDocument(PROVIDER, {
      mmsi,
      latitude: point.latitude,
      longitude: point.longitude,
      name: props.name,
      callSign: props.callsign ?? props.callSign,
      imo: props.imo,
      destination: props.destination,
      draughtMeters: typeof props.draught === 'number' ? props.draught : null,
      shipTypeCode: props.shipType,
      speedKnots: props.speedOverGround ?? props.sog,
      courseDeg: props.courseOverGround ?? props.cog,
      headingDeg: props.heading ?? props.trueHeading,
      navStatCode: props.navStatus ?? props.navigationalStatus,
      observedAtIso: observedAt.includes('T') ? observedAt : new Date(observedAt).toISOString(),
      canonicalUrl: `${BASE_URL}/v1/latest/combined`,
      sourceName: 'BarentsWatch Open AIS (Norway)',
      organization: 'BarentsWatch',
      license: 'NLOD',
    })]
  }).slice(0, limit)

  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'BARENTSWATCH_CLIENT_ID and BARENTSWATCH_CLIENT_SECRET are not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'auth_error') throw new Error(`BarentsWatch token request failed with HTTP ${outcome.status}`)
      throw new Error(`BarentsWatch AIS request failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'BARENTSWATCH_CLIENT_ID / BARENTSWATCH_CLIENT_SECRET missing', durationMs: null }
  }
  try {
    const tokenOutcome = await fetchAccessToken()
    return {
      provider: PROVIDER,
      state: tokenOutcome.ok ? 'ready' : 'degraded',
      checkedAt: nowIso(),
      detail: tokenOutcome.ok ? 'OAuth token reachable' : `token HTTP ${tokenOutcome.status}`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const barentswatchAisAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
