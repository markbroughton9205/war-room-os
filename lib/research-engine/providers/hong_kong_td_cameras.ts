import 'server-only'

/**
 * Hong Kong Transport Department traffic snapshot cameras — God's Eye Phase 3 (global traffic
 * expansion). Real endpoints confirmed live this build:
 *   - Camera location list: GET https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.csv
 *     (real HTTP 200, 377 KB, UTF-16LE tab-separated, columns: key / region / district /
 *     description / easting / northing / latitude / longitude / url — 1,013 real cameras,
 *     real WGS84 latitude/longitude supplied per camera by the source itself, never geocoded).
 *   - Snapshot image: GET https://tdcctv.data.one.gov.hk/{key}.JPG — real HTTP 200
 *     (content-type: image/jpeg, 320x240), verified live this build for BC101F. The official
 *     data.gov.hk dataset page (hk-td-tis_2-traffic-snapshot-images) documents this pattern and
 *     notes HTTP 301/302 redirects should be followed.
 *
 * This adapter only ever fetches the CSV metadata endpoint — never the image host — mirroring
 * digitraffic_road_cameras' existing "adapter fetches metadata only, browser/proxy loads the
 * image" split. The image host (tdcctv.data.one.gov.hk) is allowlisted separately for
 * lib/terra/cameraImageProxy.ts, not because this adapter calls it.
 *
 * Encoding note: the CSV is UTF-16LE (real BOM confirmed this build). safeProviderFetch decodes
 * response bodies as UTF-8, so this adapter strips the resulting NUL characters and the leading
 * BOM/replacement-character debris before tab-splitting — correct for this source because its
 * payload is pure-ASCII English text (a non-ASCII cell would be corrupted; none were observed
 * live this build, and the camera keys/coordinates/URLs this adapter actually uses are ASCII).
 *
 * Freshness: the CSV carries no per-image capture timestamp and no refresh-interval field —
 * freshness is honestly 'unknown' (see lib/terra/normalizeHongKongTrafficCameras.ts), never
 * assumed live. The data.gov.hk dataset page documents images updating "about every 2 minutes"
 * but no per-camera capture time is exposed in the metadata feed.
 *
 * Licensing: Hong Kong SAR Government open data (data.gov.hk terms of use) — the feed is
 * keyless and publicly documented as an official open dataset.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'hong_kong_td_cameras' as const
const CAMERA_LOCATIONS_URL = 'https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.csv'
const MAX_RESULTS = 100
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/

type HongKongCameraRow = {
  key: string
  region: string
  district: string
  description: string
  latitude: number
  longitude: number
  url: string
}

/** Recovers the UTF-16LE payload from safeProviderFetch's UTF-8 text decoding: strip the NUL
 * bytes (U+0000) and any leading BOM/replacement-character debris, leaving the pure-ASCII
 * payload this source actually publishes. */
function decodeUtf16LeAsUtf8(text: string): string {
  return text.replace(/\u0000/g, '').replace(/^[^A-Za-z]*(?=key\t)/, '')
}

function parseCameraRows(text: string): HongKongCameraRow[] | null {
  const decoded = decodeUtf16LeAsUtf8(text)
  const lines = decoded.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length < 2) return null
  const header = lines[0].split('\t').map(cell => cell.trim())
  const keyIdx = header.indexOf('key')
  const regionIdx = header.indexOf('region')
  const districtIdx = header.indexOf('district')
  const descriptionIdx = header.indexOf('description')
  const latitudeIdx = header.indexOf('latitude')
  const longitudeIdx = header.indexOf('longitude')
  const urlIdx = header.indexOf('url')
  if (keyIdx < 0 || latitudeIdx < 0 || longitudeIdx < 0 || urlIdx < 0) return null

  const rows: HongKongCameraRow[] = []
  for (const line of lines.slice(1)) {
    const cells = line.split('\t')
    const key = (cells[keyIdx] ?? '').trim()
    const latitude = Number((cells[latitudeIdx] ?? '').trim())
    const longitude = Number((cells[longitudeIdx] ?? '').trim())
    const url = (cells[urlIdx] ?? '').trim()
    if (!key || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !url.startsWith('https://')) continue
    rows.push({
      key,
      region: regionIdx >= 0 ? (cells[regionIdx] ?? '').trim() : '',
      district: districtIdx >= 0 ? (cells[districtIdx] ?? '').trim() : '',
      description: descriptionIdx >= 0 ? (cells[descriptionIdx] ?? '').trim() : '',
      latitude,
      longitude,
      url,
    })
  }
  return rows
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()
  const match = BBOX_PATTERN.exec(text)
  if (!match) {
    throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax" (e.g. "22.20,113.85,22.40,114.25" for urban Hong Kong).')
  }
  const [, laminStr, lominStr, lamaxStr, lomaxStr] = match
  const [lamin, lomin, lamax, lomax] = [laminStr, lominStr, lamaxStr, lomaxStr].map(Number)
  const limit = Math.max(1, Math.min(query.maxResults ?? 60, MAX_RESULTS))
  const cacheKey = `hong_kong_td_cameras:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, CAMERA_LOCATIONS_URL, { timeoutMs: 20_000, maxResponseBytes: 4 * 1024 * 1024 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }
  const cameras = parseCameraRows(result.text)
  if (!cameras) return { ok: false as const, kind: 'malformed' as const, message: 'Hong Kong TD camera locations CSV did not match its documented column layout.' }

  const withinBbox = cameras.filter(camera =>
    camera.latitude >= lamin && camera.latitude <= lamax && camera.longitude >= lomin && camera.longitude <= lomax,
  )

  const documents: ReturnType<typeof makeDocument>[] = []
  for (const camera of withinBbox) {
    if (documents.length >= limit) break
    documents.push(makeDocument({
      id: `hong_kong_td_cameras:${camera.key}`,
      provider: PROVIDER,
      providerRecordId: camera.key,
      title: camera.description || `Traffic camera ${camera.key}`,
      summary: [camera.district, camera.region].filter(Boolean).join(' — ') || null,
      contentSnippet: `lat ${camera.latitude}, lon ${camera.longitude}`,
      canonicalUrl: camera.url,
      sourceUrl: CAMERA_LOCATIONS_URL,
      sourceName: 'Hong Kong Transport Department (data.gov.hk)',
      contentType: 'traffic_camera',
      authors: [],
      organization: 'Transport Department, Government of the Hong Kong SAR',
      publishedAt: null,
      updatedAt: null,
      geography: `lat ${camera.latitude}, lon ${camera.longitude}`,
      language: 'en',
      identifiers: {
        cameraId: camera.key,
        latitude: String(camera.latitude),
        longitude: String(camera.longitude),
        imageUrl: camera.url,
        ...(camera.region ? { region: camera.region } : {}),
        ...(camera.district ? { district: camera.district } : {}),
      },
      subjects: [],
      license: 'Hong Kong SAR Government open data (data.gov.hk terms of use)',
      accessStatus: 'open',
    }))
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
      if (outcome.kind === 'http_error') throw new Error(`Hong Kong TD camera locations request failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, CAMERA_LOCATIONS_URL, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'camera locations endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const hongKongTdCamerasAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
