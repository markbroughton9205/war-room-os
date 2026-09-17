import 'server-only'

/**
 * OHGO / ODOT traffic cameras (Ohio). Lawful public API, PUBLIC_KEY.
 *
 * GET https://publicapi.ohgo.com/api/v1/cameras
 * Docs: https://publicapi.ohgo.com/docs/v1/cameras
 * Auth: Authorization: ApiKey {OHGO_API_KEY} — server-side only, never a client query param.
 * Live-confirmed scheme is `ApiKey` (Bearer / X-API-Key / ?apiKey= were 401).
 * Snapshots refresh every 5 seconds. This adapter fetches the camera *catalog* only — it never
 * GETs LargeUrl/SmallUrl for every camera (don't hammer stills). Inspect/hover load one still
 * through the camera-image proxy.
 *
 * ETag / If-None-Match: the previous catalog response is reused on HTTP 304.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'
import { rememberCameraImageUrl } from '@/lib/terra/cameraImageUrlCache'
import {
  bearingFromCameraDirection,
  isValidWgs84Point,
  normalizeCameraDirection,
} from '@/lib/terra/trafficCameraRecord'
import { resolveTerraTrafficCameraFederationHealth } from '@/lib/terra/roadCameraStaleness'

const PROVIDER = 'ohgo_cameras' as const
const BASE_URL = 'https://publicapi.ohgo.com/api/v1/cameras'
const MAX_RESULTS = 120
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/
const OHGO_REFRESH_INTERVAL_SEC = 5
const ATTRIBUTION = 'ODOT / OHGO'
const LICENSE = 'OHGO Public API — https://publicapi.ohgo.com/docs/terms-of-use'

export type OhgoCameraView = {
  Direction?: string
  direction?: string
  SmallUrl?: string
  smallUrl?: string
  LargeUrl?: string
  largeUrl?: string
  MainRoute?: string
  mainRoute?: string
}

export type OhgoCamera = {
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
  CameraViews?: OhgoCameraView[] | null
  cameraViews?: OhgoCameraView[] | null
}

type OhgoListEnvelope = { results?: OhgoCamera[]; Results?: OhgoCamera[] }

const catalogStore: { etag: string | null; cameras: OhgoCamera[] } = { etag: null, cameras: [] }

export function ohgoApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.OHGO_API_KEY?.trim() ?? ''
}

function pickViews(camera: OhgoCamera): OhgoCameraView[] {
  const views = camera.CameraViews ?? camera.cameraViews ?? []
  return Array.isArray(views) ? views : []
}

function cameraId(camera: OhgoCamera): string | null {
  const raw = camera.Id ?? camera.id
  if (raw === undefined || raw === null) return null
  const id = String(raw).trim()
  return id.length > 0 ? id : null
}

export function mapOhgoCamerasToDocuments(
  cameras: OhgoCamera[],
  bbox: { lamin: number; lomin: number; lamax: number; lomax: number } | null,
  now: string,
  limit: number,
): ReturnType<typeof makeDocument>[] {
  const documents: ReturnType<typeof makeDocument>[] = []
  for (const camera of cameras) {
    if (documents.length >= limit) break
    const id = cameraId(camera)
    const lat = camera.Latitude ?? camera.latitude
    const lon = camera.Longitude ?? camera.longitude
    if (!id || typeof lat !== 'number' || typeof lon !== 'number' || !isValidWgs84Point(lat, lon)) continue
    if (bbox && (lat < bbox.lamin || lat > bbox.lamax || lon < bbox.lomin || lon > bbox.lomax)) continue

    const locationName = (camera.Location ?? camera.location ?? '').trim() || `OHGO camera ${id}`
    const views = pickViews(camera)
    const usableViews = views.length > 0 ? views : [{}]

    usableViews.forEach((view, viewIndex) => {
      if (documents.length >= limit) return
      const multi = usableViews.length > 1
      const federatedId = multi ? `ohgo:${id}:${viewIndex}` : `ohgo:${id}`
      const direction = normalizeCameraDirection(view.Direction ?? view.direction)
      const road = (view.MainRoute ?? view.mainRoute ?? '').trim() || null
      const imageUrl = (view.LargeUrl ?? view.largeUrl ?? view.SmallUrl ?? view.smallUrl ?? '').trim() || null
      // Catalog poll does not HEAD LargeUrl (don't hammer stills). Without Last-Modified,
      // freshness is UNAVAILABLE — never fabricated LIVE. Inspect-time image fetch can refine it.
      const freshnessState = resolveTerraTrafficCameraFederationHealth({
        feedType: 'refreshed_image',
        refreshIntervalSec: imageUrl ? OHGO_REFRESH_INTERVAL_SEC : null,
        capturedAtIso: null,
        nowIso: now,
        sourceReportsUnavailable: !imageUrl,
        liveMultiplier: 5,
      })

      if (imageUrl) rememberCameraImageUrl(PROVIDER, federatedId, imageUrl, ATTRIBUTION)

      documents.push(makeDocument({
        id: federatedId,
        provider: PROVIDER,
        providerRecordId: federatedId,
        title: road ? `${locationName} — ${road}` : locationName,
        summary: road,
        contentSnippet: `lat ${lat}, lon ${lon}`,
        canonicalUrl: `${BASE_URL}/${encodeURIComponent(id)}`,
        sourceUrl: BASE_URL,
        sourceName: ATTRIBUTION,
        contentType: 'traffic_camera',
        authors: [],
        organization: 'ODOT',
        publishedAt: null,
        updatedAt: now,
        geography: `lat ${lat}, lon ${lon}`,
        language: 'en',
        identifiers: {
          cameraId: federatedId,
          siteId: id,
          ...(multi ? { viewIndex: String(viewIndex) } : {}),
          latitude: String(lat),
          longitude: String(lon),
          locationName,
          provider: 'ohgo',
          agency: 'ODOT',
          country: 'US',
          region: 'OH',
          feedType: 'REFRESHED_IMAGE',
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
    })
  }
  return documents
}

function parseOhgoCameras(payload: unknown): OhgoCamera[] | null {
  if (Array.isArray(payload)) return payload as OhgoCamera[]
  if (!payload || typeof payload !== 'object') return null
  const envelope = payload as OhgoListEnvelope
  const results = envelope.results ?? envelope.Results
  return Array.isArray(results) ? results : null
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const key = ohgoApiKey()
  if (!key) return { ok: false as const, kind: 'not_configured' as const, message: 'OHGO_API_KEY is not configured.' }

  const text = query.text.trim()
  const match = BBOX_PATTERN.exec(text)
  if (!match) {
    throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax" (e.g. "39.0,-84.6,39.3,-84.3" for Cincinnati).')
  }
  const [, laminStr, lominStr, lamaxStr, lomaxStr] = match
  const [lamin, lomin, lamax, lomax] = [laminStr, lominStr, lamaxStr, lomaxStr].map(Number)
  const limit = Math.max(1, Math.min(query.maxResults ?? 80, MAX_RESULTS))
  const cacheKey = `ohgo_cameras:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const headers: Record<string, string> = { Authorization: `ApiKey ${key}`, Accept: 'application/json' }
  if (catalogStore.etag) headers['If-None-Match'] = catalogStore.etag

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?page-all=true`, { timeoutMs: 20_000, headers })
  if (result.status === 429) return { ok: false as const, kind: 'http_error' as const, status: 429 }
  if (result.status === 304 && catalogStore.cameras.length > 0) {
    const documents = mapOhgoCamerasToDocuments(catalogStore.cameras, { lamin, lomin, lamax, lomax }, nowIso(), limit)
    const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
    cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
    return { ok: true as const, response }
  }
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const cameras = parseOhgoCameras(safeJsonParse(result.text))
  if (!cameras) return { ok: false as const, kind: 'malformed' as const, message: 'OHGO cameras response was not a valid camera list.' }
  if (cameras.length === 0 && catalogStore.cameras.length === 0) {
    return { ok: false as const, kind: 'empty' as const, message: 'OHGO cameras response was empty.' }
  }

  catalogStore.cameras = cameras.length > 0 ? cameras : catalogStore.cameras
  catalogStore.etag = result.etag
  const documents = mapOhgoCamerasToDocuments(catalogStore.cameras, { lamin, lomin, lamax, lomax }, nowIso(), limit)
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
      if (outcome.kind === 'http_error') {
        const message = outcome.status === 429
          ? 'OHGO cameras request was RATE_LIMITED (HTTP 429).'
          : `OHGO cameras request failed with HTTP ${outcome.status}`
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
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'OHGO_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?page-all=true`, {
      timeoutMs: 10_000,
      headers: { Authorization: `ApiKey ${ohgoApiKey()}`, Accept: 'application/json' },
    })
    const state = result.ok ? 'ready' : result.status === 401 || result.status === 403 ? 'authentication_failed' : result.status === 429 ? 'rate_limited' : 'degraded'
    return { provider: PROVIDER, state, checkedAt: nowIso(), detail: result.ok ? 'cameras endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export function __resetOhgoCatalogCacheForTests(): void {
  catalogStore.etag = null
  catalogStore.cameras = []
}

export const ohgoCamerasAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
