import 'server-only'

/**
 * Digitraffic Road Weathercams (Fintraffic, Finland) — God's Eye Traffic & Camera Intelligence
 * phase's first camera source. Real endpoints confirmed live this build against the current
 * production API (tie.digitraffic.fi), same organization/terms as the already-integrated
 * digitraffic_marine (meri.digitraffic.fi): zero-auth, keyless, CC BY 4.0.
 *
 * Real shapes confirmed by live GET this build (not assumed from docs alone):
 *   GET /api/weathercam/v1/stations       -> GeoJSON FeatureCollection, every station nationwide,
 *     no bbox param — coordinates + id/name/collectionStatus + a bare preset id list (no imageUrl,
 *     no road/direction). Same "always whole-country, filter server-side" shape as marine.
 *   GET /api/weathercam/v1/stations/data  -> { stations: [{ id, presets: [{ id, measuredTime }] }] }
 *     — real per-PRESET last-capture timestamps for every station nationwide, no imageUrl/coords.
 *   GET /api/weathercam/v1/stations/{id}  -> single station's real preset detail: imageUrl
 *     (confirmed pattern `https://weathercam.digitraffic.fi/{presetId}.jpg`), direction
 *     (INCREASING_DIRECTION/DECREASING_DIRECTION/SPECIAL_DIRECTION — a real controlled vocabulary,
 *     not a numeric heading; never converted into a fabricated bearing), presentationName,
 *     roadAddress, collectionInterval (seconds).
 *
 * Every in-bbox camera gets a real position + a real (pattern-confirmed) image URL + real
 * freshness from the two unconditional bulk calls. Only up to MAX_DETAIL_ENRICH stations also get
 * a per-station detail call to fill road/direction/presentationName — bounded so a wide bbox never
 * fans out into hundreds of individual requests (mission's "fetch detail only when needed"
 * performance requirement). Stations beyond that cap still render with a working image and real
 * freshness; road/direction are honestly null, never guessed.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'digitraffic_road_cameras' as const
const BASE_URL = 'https://tie.digitraffic.fi/api/weathercam/v1'
const MAX_RESULTS = 120
const MAX_DETAIL_ENRICH = 12
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/
// Same "please identify your app" convention already used for digitraffic_marine — raises the
// documented anonymous rate limit, not a credential.
const DIGITRAFFIC_USER_HEADER = 'war-room-os-terra-traffic'

type StationsFeature = {
  id: string
  geometry: { coordinates: [number, number, number?] }
  properties: { id: string; name: string; collectionStatus: string; presets: { id: string; inCollection: boolean }[] }
}
type StationsResponse = { features?: StationsFeature[] | null }
type StationsDataEntry = { id: string; presets: { id: string; measuredTime?: string }[] }
type StationsDataResponse = { stations?: StationsDataEntry[] | null }
type StationDetailPreset = {
  id: string
  presentationName?: string
  imageUrl?: string
  direction?: string
  resolution?: string
}
type StationDetailResponse = {
  properties: {
    presets?: StationDetailPreset[]
    collectionInterval?: number
    roadAddress?: { roadNumber?: number; roadSection?: number; side?: string }
    names?: { en?: string; fi?: string }
  }
}

function deriveImageUrl(presetId: string): string {
  // Documented, source-confirmed convention (verified live this build: /stations/{id} always
  // returns imageUrl exactly equal to this pattern for every preset observed) — not a guess.
  return `https://weathercam.digitraffic.fi/${presetId}.jpg`
}

function roadLabel(roadAddress: StationDetailResponse['properties']['roadAddress']): string | null {
  if (!roadAddress || typeof roadAddress.roadNumber !== 'number') return null
  return `Road ${roadAddress.roadNumber}${typeof roadAddress.roadSection === 'number' ? ` (section ${roadAddress.roadSection})` : ''}`
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()
  const match = BBOX_PATTERN.exec(text)
  if (!match) {
    throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax" (e.g. "59.9,24.5,60.3,25.3" for the Helsinki metro area).')
  }
  const [, laminStr, lominStr, lamaxStr, lomaxStr] = match
  const [lamin, lomin, lamax, lomax] = [laminStr, lominStr, lamaxStr, lomaxStr].map(Number)
  const limit = Math.max(1, Math.min(query.maxResults ?? 60, MAX_RESULTS))
  const cacheKey = `digitraffic_road_cameras:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const headers = { 'Digitraffic-User': DIGITRAFFIC_USER_HEADER }
  const [stationsResult, dataResult] = await Promise.all([
    safeProviderFetch(PROVIDER, `${BASE_URL}/stations`, { timeoutMs: 15_000, headers }),
    safeProviderFetch(PROVIDER, `${BASE_URL}/stations/data`, { timeoutMs: 15_000, headers }),
  ])
  if (!stationsResult.ok) return { ok: false as const, kind: 'http_error' as const, status: stationsResult.status }
  const stationsData = safeJsonParse<StationsResponse>(stationsResult.text)
  if (!stationsData) return { ok: false as const, kind: 'malformed' as const, message: 'Digitraffic weathercam stations response was not valid JSON.' }

  // Freshness is a real but non-essential enrichment the same way marine treats vessel static
  // metadata — a failure here degrades every preset's measuredTime to "not reported" rather than
  // failing the whole layer.
  const dataOk = dataResult.ok
  const measuredTimeByPreset = new Map<string, string>()
  if (dataOk) {
    const parsed = safeJsonParse<StationsDataResponse>(dataResult.text)
    for (const station of parsed?.stations ?? []) {
      for (const preset of station.presets ?? []) {
        if (preset.measuredTime) measuredTimeByPreset.set(preset.id, preset.measuredTime)
      }
    }
  }

  const withinBbox = (stationsData.features ?? []).filter(feature => {
    const [lon, lat] = feature.geometry?.coordinates ?? []
    return typeof lat === 'number' && typeof lon === 'number' && lat >= lamin && lat <= lamax && lon >= lomin && lon <= lomax
  })

  // Bounded fan-out: only the first MAX_DETAIL_ENRICH in-bbox stations get a per-station detail
  // call for real road/direction/presentationName — never the whole in-bbox set, however wide the
  // Commander's current view is.
  const detailTargets = withinBbox.slice(0, MAX_DETAIL_ENRICH)
  const detailResults = await Promise.all(
    detailTargets.map(station => safeProviderFetch(PROVIDER, `${BASE_URL}/stations/${encodeURIComponent(station.id)}`, { timeoutMs: 10_000, headers })),
  )
  const detailByStationId = new Map<string, StationDetailResponse>()
  detailTargets.forEach((station, i) => {
    const result = detailResults[i]
    if (!result.ok) return
    const parsed = safeJsonParse<StationDetailResponse>(result.text)
    if (parsed) detailByStationId.set(station.id, parsed)
  })

  const documents: ReturnType<typeof makeDocument>[] = []
  for (const station of withinBbox) {
    if (documents.length >= limit) break
    const [lon, lat] = station.geometry.coordinates
    const detail = detailByStationId.get(station.id) ?? null
    const detailPresetById = new Map((detail?.properties.presets ?? []).map(p => [p.id, p]))
    const road = roadLabel(detail?.properties.roadAddress)
    const collectionIntervalSec = typeof detail?.properties.collectionInterval === 'number' ? detail.properties.collectionInterval : null
    const stationNameEn = detail?.properties.names?.en ?? null

    for (const preset of station.properties.presets ?? []) {
      if (documents.length >= limit) break
      const detailPreset = detailPresetById.get(preset.id)
      const imageUrl = detailPreset?.imageUrl ?? deriveImageUrl(preset.id)
      const measuredTimeIso = measuredTimeByPreset.get(preset.id) ?? null
      const title = detailPreset?.presentationName
        ? `${stationNameEn ?? station.properties.name} — ${detailPreset.presentationName}`
        : (stationNameEn ?? station.properties.name)
      const canonicalUrl = `https://tie.digitraffic.fi/api/weathercam/v1/stations/${station.id}`

      documents.push(makeDocument({
        id: `digitraffic_road_cameras:${preset.id}`,
        provider: PROVIDER,
        providerRecordId: preset.id,
        title,
        summary: road,
        contentSnippet: `lat ${lat}, lon ${lon}`,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Digitraffic Road Weathercams (Fintraffic)',
        contentType: 'traffic_camera',
        authors: [],
        organization: 'Fintraffic',
        publishedAt: measuredTimeIso,
        updatedAt: null,
        geography: `lat ${lat}, lon ${lon}`,
        language: null,
        identifiers: {
          stationId: station.id,
          presetId: preset.id,
          latitude: String(lat),
          longitude: String(lon),
          imageUrl,
          collectionStatus: station.properties.collectionStatus,
          ...(road ? { road } : {}),
          ...(detailPreset?.direction ? { direction: detailPreset.direction } : {}),
          ...(detailPreset?.resolution ? { resolution: detailPreset.resolution } : {}),
          ...(collectionIntervalSec !== null ? { collectionIntervalSec: String(collectionIntervalSec) } : {}),
          ...(measuredTimeIso ? { measuredTimeIso } : {}),
          detailEnriched: String(detail !== null),
        },
        subjects: [],
        license: 'CC BY 4.0',
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
      if (outcome.kind === 'http_error') throw new Error(`Digitraffic Road Weathercams request failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/stations`, { timeoutMs: 10_000, headers: { 'Digitraffic-User': DIGITRAFFIC_USER_HEADER } })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'stations endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const digitrafficRoadCamerasAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
