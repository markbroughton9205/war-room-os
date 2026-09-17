import 'server-only'

/**
 * Caltrans CWWP2 CCTV stills — keyless public JSON per district.
 * Docs: https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm
 * Fair use: stills only. streamingVideoURL is never bulk-played and never used as the inspect
 * still. Catalog freshness is UNAVAILABLE without a per-still capture timestamp — recordEpoch is
 * not treated as Last-Modified.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'
import { rememberCameraImageUrl } from '@/lib/terra/cameraImageUrlCache'
import { caltransDistrictsForRectangle } from '@/lib/terra/caltransBoundingBox'
import { buildCaltransStillUrl, parseCaltransStillPath } from '@/lib/terra/caltransStillPath'
import type { TerraDegreeRectangle } from '@/lib/terra/aircraftBoundingBox'
import { TERRA_PUBLIC_USER_AGENT, TERRA_OFFICIAL_VIEWERS } from '@/lib/terra/terraPublicIdentity'
import {
  bearingFromCameraDirection,
  isValidWgs84Point,
  normalizeCameraDirection,
} from '@/lib/terra/trafficCameraRecord'
import { resolveTerraTrafficCameraFederationHealth } from '@/lib/terra/roadCameraStaleness'

const PROVIDER = 'caltrans_cctv' as const
const MAX_RESULTS = 80
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/
const ATTRIBUTION = 'Caltrans CWWP2'
const LICENSE = 'Caltrans CWWP2 stills — fair use; no bulk streaming'

type CctvLocation = {
  locationName?: string
  nearbyPlace?: string
  longitude?: number | string
  latitude?: number | string
  direction?: string
  county?: string
  route?: string
}
type CctvImage = {
  imageDescription?: string
  streamingVideoURL?: string
  static?: { currentImageURL?: string; currentImageUpdateFrequency?: string }
}
type CctvRow = {
  cctv?: {
    index?: string
    inService?: string | boolean
    location?: CctvLocation
    imageData?: CctvImage
  }
}

function toNumber(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  return Number.isFinite(value) ? value : null
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const match = BBOX_PATTERN.exec(query.text.trim())
  if (!match) {
    throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax".')
  }
  const [, laminStr, lominStr, lamaxStr, lomaxStr] = match
  const [lamin, lomin, lamax, lomax] = [laminStr, lominStr, lamaxStr, lomaxStr].map(Number)
  const rectangle: TerraDegreeRectangle = { west: lomin, south: lamin, east: lomax, north: lamax }
  const districts = caltransDistrictsForRectangle(rectangle)
  if (!districts.length) {
    const response = okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started })
    return { ok: true as const, response }
  }

  const limit = Math.max(1, Math.min(query.maxResults ?? 60, MAX_RESULTS))
  const cacheKey = `caltrans_cctv:${query.text.trim()}:${limit}:${districts.map(d => d.id).join(',')}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const now = nowIso()
  const documents: ReturnType<typeof makeDocument>[] = []
  for (const district of districts) {
    const result = await safeProviderFetch(PROVIDER, district.statusUrl, {
      timeoutMs: 25_000,
      headers: { 'User-Agent': TERRA_PUBLIC_USER_AGENT, Accept: 'application/json' },
    })
    if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }
    const payload = safeJsonParse<{ data?: CctvRow[] }>(result.text)
    const rows = Array.isArray(payload?.data) ? payload.data : null
    if (!rows) return { ok: false as const, kind: 'malformed' as const, message: `Caltrans D${district.id} CCTV JSON was not the documented {data:[]} shape.` }
    for (const row of rows) {
      if (documents.length >= limit) break
      const cctv = row.cctv
      const loc = cctv?.location
      const lat = toNumber(loc?.latitude)
      const lon = toNumber(loc?.longitude)
      if (lat === null || lon === null || !isValidWgs84Point(lat, lon)) continue
      if (lat < lamin || lat > lamax || lon < lomin || lon > lomax) continue
      const inService = cctv?.inService
      if (inService === false || inService === 'false' || inService === 'No') continue
      const rawImageUrl = cctv?.imageData?.static?.currentImageURL?.trim() || null
      const imagePath = rawImageUrl ? parseCaltransStillPath(rawImageUrl) : null
      const imageUrl = imagePath ? buildCaltransStillUrl(imagePath) : null
      if (!imageUrl || !imagePath) continue
      const id = `caltrans:d${district.id}:${cctv?.index ?? `${lat},${lon}`}`
      const title = loc?.locationName?.trim() || `Caltrans D${district.id} CCTV`
      const direction = normalizeCameraDirection(loc?.direction)
      const intervalRaw = cctv?.imageData?.static?.currentImageUpdateFrequency
      const intervalSec = intervalRaw ? Number(intervalRaw) : null
      const freshnessState = resolveTerraTrafficCameraFederationHealth({
        feedType: 'still',
        refreshIntervalSec: Number.isFinite(intervalSec) ? intervalSec : null,
        capturedAtIso: null,
        nowIso: now,
        sourceReportsUnavailable: false,
        liveMultiplier: 5,
      })
      rememberCameraImageUrl(PROVIDER, id, imageUrl, ATTRIBUTION)
      documents.push(makeDocument({
        id,
        provider: PROVIDER,
        providerRecordId: id,
        title,
        summary: loc?.route ? `Route ${loc.route}` : loc?.county ?? null,
        contentSnippet: `lat ${lat}, lon ${lon}`,
        canonicalUrl: TERRA_OFFICIAL_VIEWERS.caltrans,
        sourceUrl: district.statusUrl,
        sourceName: ATTRIBUTION,
        contentType: 'traffic_camera',
        authors: [],
        organization: 'Caltrans',
        publishedAt: null,
        updatedAt: now,
        geography: `lat ${lat}, lon ${lon}`,
        language: 'en',
        identifiers: {
          cameraId: id,
          latitude: String(lat),
          longitude: String(lon),
          locationName: title,
          provider: 'caltrans',
          agency: 'Caltrans',
          country: 'US',
          region: 'CA',
          feedType: 'STILL',
          freshnessState,
          coverageState: freshnessState,
          authState: 'PUBLIC_NO_AUTH',
          attribution: ATTRIBUTION,
          viewerUrl: TERRA_OFFICIAL_VIEWERS.caltrans,
          imageUrl,
          imagePath,
          ...(loc?.route ? { road: String(loc.route) } : {}),
          ...(direction ? { direction } : {}),
          ...(bearingFromCameraDirection(direction) !== null ? { bearing: String(bearingFromCameraDirection(direction)) } : {}),
          ...(Number.isFinite(intervalSec) && intervalSec !== null ? { collectionIntervalSec: String(intervalSec) } : {}),
          ...(cctv?.imageData?.imageDescription ? { viewDescription: cctv.imageData.imageDescription } : {}),
        },
        subjects: [],
        license: LICENSE,
        accessStatus: 'open',
      }))
    }
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
      throw new Error(`Caltrans CCTV fetch failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, 'https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json', {
      timeoutMs: 15_000,
      headers: { 'User-Agent': TERRA_PUBLIC_USER_AGENT, Accept: 'application/json' },
    })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'D07 CCTV JSON reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const caltransCctvAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
