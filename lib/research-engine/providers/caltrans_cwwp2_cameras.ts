import 'server-only'

/**
 * Caltrans CWWP2 CCTV stills. PUBLIC_NO_AUTH status/image files.
 *
 * Per-district JSON, e.g. https://cwwp2.dot.ca.gov/data/d8/cctv/cctvStatusD08.json (d1–d12)
 * Docs: https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm
 *
 * Stills only for map density. streamingVideoURL is recorded as viewerUrl / link-out — never
 * auto-embedded. Caltrans fair-use: ≥10 concurrent streams need a written agreement; this adapter
 * never opens a stream.
 *
 * Camera arrays come only from the live per-district CWWP2 JSON files. No stub catalog.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'
import { rememberCameraImageUrl } from '@/lib/terra/cameraImageUrlCache'
import { caltransDistrictsIntersecting } from '@/lib/terra/caltransBoundingBox'
import {
  bearingFromCameraDirection,
  isValidWgs84Point,
  normalizeCameraDirection,
} from '@/lib/terra/trafficCameraRecord'
import { resolveTerraTrafficCameraFederationHealth } from '@/lib/terra/roadCameraStaleness'
import type { TerraDegreeRectangle } from '@/lib/terra/aircraftBoundingBox'

const PROVIDER = 'caltrans_cwwp2_cameras' as const
const MAX_RESULTS = 120
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/
const ATTRIBUTION = 'Caltrans CWWP2'
const LICENSE = 'Caltrans CWWP2 public CCTV status/image files — stream fair-use (≥10 concurrent streams need written Caltrans agreement)'

export type CaltransCctv = {
  index?: number | string
  location?: {
    district?: string
    locationName?: string
    nearbyPlace?: string
    latitude?: number | string
    longitude?: number | string
    direction?: string
    county?: string
    route?: string
  }
  inService?: boolean | string
  imageData?: {
    imageCurrent?: string
    currentImageURL?: string
    currentImageUpdateFrequency?: number | string
    streamingVideoURL?: string
  }
}

function districtStatusUrl(districtId: string): string {
  const n = Number(districtId.replace(/^d/i, ''))
  const padded = String(n).padStart(2, '0')
  return `https://cwwp2.dot.ca.gov/data/d${n}/cctv/cctvStatusD${padded}.json`
}

function parseCoord(raw: number | string | undefined): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string') {
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  }
  return null
}

function parseFrequencySec(raw: number | string | undefined): number | null {
  if (raw === undefined) return null
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value) || value <= 0) return null
  // CWWP2 documents update frequency in seconds for most districts; values > 2 minutes are
  // treated as already-seconds (never guessed into minutes).
  return value
}

function inServiceFlag(raw: boolean | string | undefined): boolean {
  if (raw === false || raw === 'false' || raw === 'False' || raw === 'N' || raw === 'n') return false
  return true
}

function unwrapCctv(entry: unknown): CaltransCctv | null {
  if (!entry || typeof entry !== 'object') return null
  const record = entry as { cctv?: CaltransCctv } & CaltransCctv
  return record.cctv ?? record
}

export function mapCaltransCctvToDocuments(
  items: CaltransCctv[],
  bbox: { lamin: number; lomin: number; lamax: number; lomax: number } | null,
  now: string,
  limit: number,
  districtId: string,
): ReturnType<typeof makeDocument>[] {
  const documents: ReturnType<typeof makeDocument>[] = []
  for (const item of items) {
    if (documents.length >= limit) break
    const loc = item.location ?? {}
    const lat = parseCoord(loc.latitude)
    const lon = parseCoord(loc.longitude)
    const index = item.index !== undefined ? String(item.index) : null
    if (lat === null || lon === null || !index || !isValidWgs84Point(lat, lon)) continue
    if (bbox && (lat < bbox.lamin || lat > bbox.lamax || lon < bbox.lomin || lon > bbox.lomax)) continue

    const federatedId = `caltrans:${districtId}:${index}`
    const locationName = (loc.locationName ?? loc.nearbyPlace ?? '').trim() || `Caltrans ${districtId} camera ${index}`
    const road = (loc.route ?? '').trim() || null
    const direction = normalizeCameraDirection(loc.direction)
    const imageUrl = (item.imageData?.currentImageURL ?? item.imageData?.imageCurrent ?? '').trim() || null
    const streamLink = (item.imageData?.streamingVideoURL ?? '').trim() || null
    const online = inServiceFlag(item.inService)
    const refreshIntervalSec = parseFrequencySec(item.imageData?.currentImageUpdateFrequency)
    const freshnessState = resolveTerraTrafficCameraFederationHealth({
      feedType: 'refreshed_image',
      refreshIntervalSec: online ? refreshIntervalSec : null,
      // Status JSON has a refresh interval but no per-still Last-Modified. Don't fabricate LIVE
      // from poll clock — inspect-time image headers can refine this.
      capturedAtIso: null,
      nowIso: now,
      sourceReportsUnavailable: !online || !imageUrl,
    })

    if (imageUrl && online) rememberCameraImageUrl(PROVIDER, federatedId, imageUrl, ATTRIBUTION)

    documents.push(makeDocument({
      id: federatedId,
      provider: PROVIDER,
      providerRecordId: federatedId,
      title: road ? `${locationName} — ${road}` : locationName,
      summary: road,
      contentSnippet: `lat ${lat}, lon ${lon}`,
      canonicalUrl: imageUrl ?? districtStatusUrl(districtId),
      sourceUrl: districtStatusUrl(districtId),
      sourceName: ATTRIBUTION,
      contentType: 'traffic_camera',
      authors: [],
      organization: 'Caltrans',
      publishedAt: null,
      updatedAt: now,
      geography: `lat ${lat}, lon ${lon}`,
      language: 'en',
      identifiers: {
        cameraId: federatedId,
        latitude: String(lat),
        longitude: String(lon),
        locationName,
        provider: 'caltrans',
        agency: 'Caltrans',
        country: 'US',
        region: 'CA',
        feedType: 'REFRESHED_IMAGE',
        freshnessState,
        coverageState: freshnessState,
        authState: 'PUBLIC_NO_AUTH',
        attribution: ATTRIBUTION,
        ...(road ? { road } : {}),
        ...(direction ? { direction } : {}),
        ...(bearingFromCameraDirection(direction) !== null ? { bearing: String(bearingFromCameraDirection(direction)) } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        ...(streamLink ? { viewerUrl: streamLink } : {}),
        ...(refreshIntervalSec !== null ? { collectionIntervalSec: String(refreshIntervalSec) } : {}),
      },
      subjects: [],
      license: LICENSE,
      accessStatus: 'open',
    }))
  }
  return documents
}

function parseCaltransPayload(payload: unknown): CaltransCctv[] {
  if (Array.isArray(payload)) return payload.map(unwrapCctv).filter((item): item is CaltransCctv => item !== null)
  if (!payload || typeof payload !== 'object') return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data.map(unwrapCctv).filter((item): item is CaltransCctv => item !== null)
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()
  const match = BBOX_PATTERN.exec(text)
  if (!match) {
    throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax" (e.g. "33.9,-118.4,34.2,-118.1" for Los Angeles).')
  }
  const [, laminStr, lominStr, lamaxStr, lomaxStr] = match
  const [lamin, lomin, lamax, lomax] = [laminStr, lominStr, lamaxStr, lomaxStr].map(Number)
  const limit = Math.max(1, Math.min(query.maxResults ?? 80, MAX_RESULTS))
  const cacheKey = `caltrans_cwwp2_cameras:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const rectangle: TerraDegreeRectangle = { west: lomin, south: lamin, east: lomax, north: lamax }
  const districts = caltransDistrictsIntersecting(rectangle)
  if (districts.length === 0) {
    const response = okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started })
    cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
    return { ok: true as const, response }
  }

  const documents: ReturnType<typeof makeDocument>[] = []
  let sawRateLimit = false
  let lastErrorStatus: number | null = null
  for (const district of districts) {
    if (documents.length >= limit) break
    const result = await safeProviderFetch(PROVIDER, districtStatusUrl(district), { timeoutMs: 15_000 })
    if (result.status === 429) {
      sawRateLimit = true
      continue
    }
    if (!result.ok) {
      lastErrorStatus = result.status
      continue
    }
    const items = parseCaltransPayload(safeJsonParse(result.text))
    documents.push(...mapCaltransCctvToDocuments(items, { lamin, lomin, lamax, lomax }, nowIso(), limit - documents.length, district))
  }

  if (documents.length === 0 && (sawRateLimit || lastErrorStatus !== null)) {
    return { ok: false as const, kind: 'http_error' as const, status: sawRateLimit ? 429 : lastErrorStatus ?? 502 }
  }

  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      const message = outcome.status === 429
        ? 'Caltrans CWWP2 request was RATE_LIMITED (HTTP 429).'
        : `Caltrans CWWP2 request failed with HTTP ${outcome.status}`
      throw new Error(message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, districtStatusUrl('d8'), { timeoutMs: 10_000 })
    const state = result.ok ? 'ready' : result.status === 429 ? 'rate_limited' : 'degraded'
    return { provider: PROVIDER, state, checkedAt: nowIso(), detail: result.ok ? 'd8 status file reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const caltransCwwp2CamerasAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
