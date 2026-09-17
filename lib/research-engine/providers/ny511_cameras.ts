import 'server-only'

/**
 * 511NY traffic cameras. Iteris developer-key gate — no keyless catalog.
 *
 * GET https://511ny.org/api/v2/get/cameras?key={511NY_API_KEY}
 * Live-confirmed this build: unauthenticated GET returns HTTP 400. Missing 511NY_API_KEY
 * returns not_configured — never a stub/fixture catalog, never a NYC nearby envelope.
 *
 * The key is a query param on the upstream request only. Documents and provenance URLs never
 * include it. Logging redacts `key=` via redactUrlForLogging.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'
import {
  bearingFromCameraDirection,
  isValidWgs84Point,
  normalizeCameraDirection,
} from '@/lib/terra/trafficCameraRecord'
import { resolveTerraTrafficCameraFederationHealth } from '@/lib/terra/roadCameraStaleness'

const PROVIDER = 'ny511_cameras' as const
const BASE_URL = 'https://511ny.org/api/v2/get/cameras'
const MAX_RESULTS = 80
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/
const ATTRIBUTION = '511NY'
const LICENSE = '511NY — developer key required; official map is public at https://511ny.org/'

type Ny511CameraView = { Id?: number; Url?: string; Status?: string; Description?: string }
type Ny511Camera = {
  Id?: number
  Roadway?: string
  Direction?: string
  Latitude?: number
  Longitude?: number
  Location?: string
  Views?: Ny511CameraView[] | null
}

export function ny511ApiKey(env: NodeJS.Dict<string> = process.env): string {
  return env['511NY_API_KEY']?.trim() ?? ''
}

function mapCameras(
  cameras: Ny511Camera[],
  bbox: { lamin: number; lomin: number; lamax: number; lomax: number },
  now: string,
  limit: number,
): ReturnType<typeof makeDocument>[] {
  const documents: ReturnType<typeof makeDocument>[] = []
  for (const camera of cameras) {
    if (documents.length >= limit) break
    const lat = camera.Latitude
    const lon = camera.Longitude
    if (typeof lat !== 'number' || typeof lon !== 'number' || !isValidWgs84Point(lat, lon)) continue
    if (lat < bbox.lamin || lat > bbox.lamax || lon < bbox.lomin || lon > bbox.lomax) continue
    const locationName = (camera.Location ?? '').trim() || `511NY camera ${camera.Id ?? `${lat},${lon}`}`
    const enabledViews = (camera.Views ?? []).filter(view => (view.Status ?? 'Enabled') === 'Enabled' && typeof view.Id === 'number')
    const usable = enabledViews.length > 0 ? enabledViews : [{ Id: camera.Id, Status: 'Enabled' }]
    for (const view of usable) {
      if (documents.length >= limit) break
      const viewId = view.Id
      if (typeof viewId !== 'number') continue
      const federatedId = `ny511:${viewId}`
      const direction = normalizeCameraDirection(camera.Direction)
      const road = (camera.Roadway ?? '').trim() || null
      const imageUrl = typeof view.Url === 'string' && view.Url.startsWith('https://511ny.org/') ? view.Url : null
      const freshnessState = resolveTerraTrafficCameraFederationHealth({
        feedType: 'still',
        refreshIntervalSec: null,
        capturedAtIso: null,
        nowIso: now,
        sourceReportsUnavailable: true,
        liveMultiplier: 5,
      })
      documents.push(makeDocument({
        id: federatedId,
        provider: PROVIDER,
        providerRecordId: federatedId,
        title: road ? `${locationName} — ${road}` : locationName,
        summary: road,
        contentSnippet: `lat ${lat}, lon ${lon}`,
        canonicalUrl: BASE_URL,
        sourceUrl: BASE_URL,
        sourceName: ATTRIBUTION,
        contentType: 'traffic_camera',
        authors: [],
        organization: '511NY',
        publishedAt: null,
        updatedAt: now,
        geography: `lat ${lat}, lon ${lon}`,
        language: 'en',
        identifiers: {
          cameraId: federatedId,
          latitude: String(lat),
          longitude: String(lon),
          locationName,
          provider: '511ny',
          agency: '511NY',
          country: 'US',
          region: 'NY',
          feedType: 'STILL',
          freshnessState,
          coverageState: freshnessState,
          authState: 'PUBLIC_KEY_REQUIRED',
          attribution: ATTRIBUTION,
          ...(road ? { road } : {}),
          ...(direction ? { direction } : {}),
          ...(bearingFromCameraDirection(direction) !== null ? { bearing: String(bearingFromCameraDirection(direction)) } : {}),
          ...(imageUrl ? { imageUrl } : {}),
        },
        subjects: [],
        license: LICENSE,
        accessStatus: 'open',
      }))
    }
  }
  return documents
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const key = ny511ApiKey()
  if (!key) return { ok: false as const, kind: 'not_configured' as const, message: '511NY_API_KEY is not configured.' }

  const match = BBOX_PATTERN.exec(query.text.trim())
  if (!match) {
    throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax".')
  }
  const [, laminStr, lominStr, lamaxStr, lomaxStr] = match
  const [lamin, lomin, lamax, lomax] = [laminStr, lominStr, lamaxStr, lomaxStr].map(Number)
  const limit = Math.max(1, Math.min(query.maxResults ?? 60, MAX_RESULTS))
  const cacheKey = `ny511_cameras:${query.text.trim()}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?key=${encodeURIComponent(key)}`, {
    timeoutMs: 20_000,
    headers: { Accept: 'application/json' },
  })
  if (result.status === 400 || result.status === 401 || result.status === 403) {
    return { ok: false as const, kind: 'http_error' as const, status: result.status }
  }
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }
  const cameras = safeJsonParse<Ny511Camera[]>(result.text)
  if (!cameras || !Array.isArray(cameras)) {
    return { ok: false as const, kind: 'malformed' as const, message: '511NY cameras response was not a camera list.' }
  }
  const documents = mapCameras(cameras, { lamin, lomin, lamax, lomax }, nowIso(), limit)
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, '511NY_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'not_configured') return notConfiguredResponse(PROVIDER, outcome.message)
      if (outcome.kind === 'http_error') {
        throw new Error(`511NY cameras request failed with HTTP ${outcome.status}`)
      }
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: '511NY_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?key=${encodeURIComponent(ny511ApiKey())}`, {
      timeoutMs: 10_000,
      headers: { Accept: 'application/json' },
    })
    const state = result.ok ? 'ready' : result.status === 400 || result.status === 401 || result.status === 403 ? 'authentication_failed' : result.status === 429 ? 'rate_limited' : 'degraded'
    return { provider: PROVIDER, state, checkedAt: nowIso(), detail: result.ok ? 'cameras endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ny511CamerasAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
