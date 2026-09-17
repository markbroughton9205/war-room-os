import 'server-only'

/**
 * New York State traffic cameras via the 511NY public camera JSON.
 *
 * GET https://511ny.org/api/getcameras?key={key}&format=json
 * Env: 511NY_API_KEY (server-side only).
 *
 * DAA: attribution is "powered by 511NY". The product / layer name is "New York State traffic
 * cameras" — never "511NY" as a product name, and never an implied NYSDOT endorsement.
 *
 * Stills only: `Url` is the JPEG. `VideoUrl` is recorded as viewerUrl / link-out only — this
 * adapter never scrapes, embeds, or auto-plays video.
 *
 * Throttle: 10 requests / 60 seconds (in-process). Disabled/Blocked cameras are OFFLINE.
 *
 * Camera arrays come only from the live 511NY HTTP response. Missing 511NY_API_KEY returns
 * not_configured — never a stub/fixture catalog.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'
import { rememberCameraImageUrl } from '@/lib/terra/cameraImageUrlCache'
import { allowThrottledRequest } from '@/lib/terra/providerRequestThrottle'
import {
  bearingFromCameraDirection,
  isValidWgs84Point,
  normalizeCameraDirection,
} from '@/lib/terra/trafficCameraRecord'
import { resolveTerraTrafficCameraFederationHealth } from '@/lib/terra/roadCameraStaleness'

const PROVIDER = 'ny511_cameras' as const
const BASE_URL = 'https://511ny.org/api/getcameras'
const MAX_RESULTS = 120
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/
const ATTRIBUTION = 'powered by 511NY'
const LICENSE = '511NY developer terms — no implied NYSDOT endorsement'

export type Ny511Camera = {
  ID?: string | number
  Id?: string | number
  id?: string | number
  Name?: string
  name?: string
  Latitude?: number
  latitude?: number
  Longitude?: number
  longitude?: number
  Direction?: string
  direction?: string
  Roadway?: string
  roadway?: string
  Url?: string
  url?: string
  VideoUrl?: string
  videoUrl?: string
  Disabled?: boolean
  disabled?: boolean
  Blocked?: boolean
  blocked?: boolean
  Status?: string
  status?: string
}

export function ny511ApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return env['511NY_API_KEY']?.trim() ?? ''
}

function cameraId(camera: Ny511Camera): string | null {
  const raw = camera.ID ?? camera.Id ?? camera.id
  if (raw === undefined || raw === null) return null
  const id = String(raw).trim()
  return id.length > 0 ? id : null
}

function isOffline(camera: Ny511Camera): boolean {
  if (camera.Disabled === true || camera.disabled === true) return true
  if (camera.Blocked === true || camera.blocked === true) return true
  const status = (camera.Status ?? camera.status ?? '').trim().toLowerCase()
  return status === 'disabled' || status === 'blocked' || status === 'offline'
}

export function mapNy511CamerasToDocuments(
  cameras: Ny511Camera[],
  bbox: { lamin: number; lomin: number; lamax: number; lomax: number } | null,
  now: string,
  limit: number,
): ReturnType<typeof makeDocument>[] {
  const documents: ReturnType<typeof makeDocument>[] = []
  for (const camera of cameras) {
    if (documents.length >= limit) break
    const rawId = cameraId(camera)
    const lat = camera.Latitude ?? camera.latitude
    const lon = camera.Longitude ?? camera.longitude
    if (!rawId || typeof lat !== 'number' || typeof lon !== 'number' || !isValidWgs84Point(lat, lon)) continue
    if (bbox && (lat < bbox.lamin || lat > bbox.lamax || lon < bbox.lomin || lon > bbox.lomax)) continue

    const federatedId = `511ny:${rawId}`
    const locationName = (camera.Name ?? camera.name ?? '').trim() || `New York camera ${rawId}`
    const road = (camera.Roadway ?? camera.roadway ?? '').trim() || null
    const direction = normalizeCameraDirection(camera.Direction ?? camera.direction)
    const imageUrl = (camera.Url ?? camera.url ?? '').trim() || null
    const videoUrl = (camera.VideoUrl ?? camera.videoUrl ?? '').trim() || null
    const offline = isOffline(camera)
    const freshnessState = resolveTerraTrafficCameraFederationHealth({
      feedType: 'refreshed_image',
      refreshIntervalSec: null,
      capturedAtIso: null,
      nowIso: now,
      sourceReportsUnavailable: offline || !imageUrl,
    })

    if (imageUrl && !offline) rememberCameraImageUrl(PROVIDER, federatedId, imageUrl, ATTRIBUTION)

    documents.push(makeDocument({
      id: federatedId,
      provider: PROVIDER,
      providerRecordId: federatedId,
      title: road ? `${locationName} — ${road}` : locationName,
      summary: road,
      contentSnippet: `lat ${lat}, lon ${lon}`,
      canonicalUrl: videoUrl || imageUrl || BASE_URL,
      sourceUrl: BASE_URL,
      sourceName: 'New York State traffic cameras',
      contentType: 'traffic_camera',
      authors: [],
      organization: 'New York State',
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
        agency: 'New York State',
        country: 'US',
        region: 'NY',
        feedType: 'REFRESHED_IMAGE',
        freshnessState,
        coverageState: freshnessState,
        authState: 'PUBLIC_KEY_REQUIRED',
        attribution: ATTRIBUTION,
        ...(road ? { road } : {}),
        ...(direction ? { direction } : {}),
        ...(bearingFromCameraDirection(direction) !== null ? { bearing: String(bearingFromCameraDirection(direction)) } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        ...(videoUrl ? { viewerUrl: videoUrl } : {}),
      },
      subjects: [],
      license: LICENSE,
      accessStatus: 'open',
    }))
  }
  return documents
}

function parseNy511Cameras(payload: unknown): Ny511Camera[] | null {
  if (Array.isArray(payload)) return payload as Ny511Camera[]
  if (!payload || typeof payload !== 'object') return null
  const record = payload as { cameras?: unknown; Cameras?: unknown; results?: unknown }
  const list = record.cameras ?? record.Cameras ?? record.results
  return Array.isArray(list) ? (list as Ny511Camera[]) : null
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const key = ny511ApiKey()
  if (!key) return { ok: false as const, kind: 'not_configured' as const, message: '511NY_API_KEY is not configured.' }

  const text = query.text.trim()
  const match = BBOX_PATTERN.exec(text)
  if (!match) {
    throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax" (e.g. "40.6,-74.1,40.9,-73.8" for Manhattan).')
  }
  const [, laminStr, lominStr, lamaxStr, lomaxStr] = match
  const [lamin, lomin, lamax, lomax] = [laminStr, lominStr, lamaxStr, lomaxStr].map(Number)
  const limit = Math.max(1, Math.min(query.maxResults ?? 80, MAX_RESULTS))
  const cacheKey = `ny511_cameras:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  if (!allowThrottledRequest('ny511_cameras', 10, 60_000)) {
    return { ok: false as const, kind: 'http_error' as const, status: 429 }
  }

  const url = new URL(BASE_URL)
  url.searchParams.set('key', key)
  url.searchParams.set('format', 'json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 20_000 })
  if (result.status === 429) return { ok: false as const, kind: 'http_error' as const, status: 429 }
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const cameras = parseNy511Cameras(safeJsonParse(result.text))
  if (!cameras) return { ok: false as const, kind: 'malformed' as const, message: 'New York camera response was not a valid camera list.' }

  const documents = mapNy511CamerasToDocuments(cameras, { lamin, lomin, lamax, lomax }, nowIso(), limit)
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
        const message = outcome.status === 429
          ? 'New York camera request was RATE_LIMITED (HTTP 429).'
          : `New York camera request failed with HTTP ${outcome.status}`
        throw new Error(message)
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
    const url = new URL(BASE_URL)
    url.searchParams.set('key', ny511ApiKey())
    url.searchParams.set('format', 'json')
    const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 10_000 })
    const state = result.ok ? 'ready' : result.status === 401 || result.status === 403 ? 'authentication_failed' : result.status === 429 ? 'rate_limited' : 'degraded'
    return { provider: PROVIDER, state, checkedAt: nowIso(), detail: result.ok ? 'getcameras reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ny511CamerasAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
