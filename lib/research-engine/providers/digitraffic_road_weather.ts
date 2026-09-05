import 'server-only'

/**
 * Digitraffic Road Weather (Fintraffic, Finland) — God's Eye Phase 2's road-weather source.
 * Same organization/host/terms as the already-integrated digitraffic_road_cameras
 * (tie.digitraffic.fi) — reuses that adapter's exact shape (safeProviderFetch/withProviderGate/
 * ttlCache), not a second Digitraffic client, per mission instruction.
 *
 * Real shapes confirmed by live GET this build (not assumed from docs alone):
 *   GET /api/weather/v1/stations       -> GeoJSON FeatureCollection, every station nationwide, no
 *     bbox param — id/name/coordinates/collectionStatus/dataUpdatedTime/state. Same
 *     "always whole-country, filter server-side" shape as every other Digitraffic feed integrated
 *     so far.
 *   GET /api/weather/v1/stations/{id}/data -> { id, dataUpdatedTime, sensorValues: [{ id, name,
 *     shortName, measuredTime, unit, value }] } — real per-sensor readings, fetched only for
 *     in-bbox stations (bounded fan-out, mirroring digitraffic_road_cameras' MAX_DETAIL_ENRICH
 *     convention) rather than the always-whole-country /stations/data bulk endpoint, since this
 *     capability needs full per-sensor detail (not just a freshness timestamp) for every station it
 *     renders.
 *
 * Only sensor codes this adapter can decode with documented confidence are mapped to named fields
 * (air/road/ground temperature °C, relative humidity %, visibility km, average/max wind speed m/s,
 * wind direction °, precipitation intensity mm/h and running sum mm). Every other real sensor code
 * Digitraffic returns for a station (road-condition codes KELI_1/KELI_2, ice-frequency/conductivity
 * diagnostics, station status codes, etc.) is preserved verbatim in `rawSensorCodes` — Digitraffic
 * does not publish a fetchable code-table endpoint for these this build, so guessing a decoded label
 * would violate the mission's "do not synthesize conditions" rule. Never fabricated, never dropped.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'digitraffic_road_weather' as const
const BASE_URL = 'https://tie.digitraffic.fi/api/weather/v1'
const MAX_RESULTS = 80
// Every in-bbox station gets its own /stations/{id}/data call (unlike the road-cameras adapter's
// bulk /stations/data + bounded detail-enrich split) since road weather has no useful
// "position + freshness only" degraded mode — a station without sensor data is not a useful
// Observed Data record for this capability. Bounded the same way road-cameras bounds its detail
// fan-out, so a wide bbox never triggers hundreds of individual upstream requests.
const MAX_STATIONS = 40
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/
const DIGITRAFFIC_USER_HEADER = 'war-room-os-terra-road-weather'

// Real Digitraffic sensor `name` codes this adapter decodes with documented unit confidence
// (confirmed live this build against /stations/{id}/data). Every other real code the source
// returns is honestly passed through raw, never guessed.
const SENSOR_AIR_TEMP_C = 'ILMA'
const SENSOR_ROAD_TEMP_C = 'TIE_1'
const SENSOR_ROAD_TEMP_C_SECONDARY = 'TIE_2'
const SENSOR_GROUND_TEMP_C = 'MAA_1'
const SENSOR_DEW_POINT_C = 'KASTEPISTE'
const SENSOR_HUMIDITY_PCT = 'ILMAN_KOSTEUS'
const SENSOR_VISIBILITY_KM = 'NÄKYVYYS_KM'
const SENSOR_WIND_AVG_MS = 'KESKITUULI'
const SENSOR_WIND_MAX_MS = 'MAKSIMITUULI'
const SENSOR_WIND_DIR_DEG = 'TUULENSUUNTA'
const SENSOR_PRECIP_INTENSITY_MMH = 'SADE_INTENSITEETTI'
const SENSOR_PRECIP_SUM_MM = 'SADESUMMA'
// Confirmed live this build (not present on every probed station, but present with a real unit
// of "µ" — the standard friction-coefficient symbol — where the station carries a KITKA1 grip
// sensor): a real, decodable friction reading, unlike the KELI_*/JÄÄTAAJUUS_* diagnostics this
// file leaves raw.
const SENSOR_FRICTION_COEFFICIENT = 'KITKA1'
const DECODED_SENSOR_NAMES = new Set([
  SENSOR_AIR_TEMP_C, SENSOR_ROAD_TEMP_C, SENSOR_ROAD_TEMP_C_SECONDARY, SENSOR_GROUND_TEMP_C,
  SENSOR_DEW_POINT_C, SENSOR_HUMIDITY_PCT, SENSOR_VISIBILITY_KM, SENSOR_WIND_AVG_MS,
  SENSOR_WIND_MAX_MS, SENSOR_WIND_DIR_DEG, SENSOR_PRECIP_INTENSITY_MMH, SENSOR_PRECIP_SUM_MM,
  SENSOR_FRICTION_COEFFICIENT,
])

type StationsFeature = {
  geometry: { coordinates: [number, number, number?] }
  properties: { id: number; name: string; collectionStatus: string; dataUpdatedTime?: string; state?: string | null }
}
type StationsResponse = { features?: StationsFeature[] | null }
type SensorValue = { id: number; name: string; shortName?: string; measuredTime?: string; unit?: string; value: number }
type StationDataResponse = { id: number; dataUpdatedTime?: string; sensorValues?: SensorValue[] | null }

function findSensor(sensors: SensorValue[], name: string): SensorValue | null {
  return sensors.find(s => s.name === name) ?? null
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
  const limit = Math.max(1, Math.min(query.maxResults ?? 50, MAX_RESULTS))
  const cacheKey = `digitraffic_road_weather:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const headers = { 'Digitraffic-User': DIGITRAFFIC_USER_HEADER }
  const stationsResult = await safeProviderFetch(PROVIDER, `${BASE_URL}/stations`, { timeoutMs: 15_000, headers })
  if (!stationsResult.ok) return { ok: false as const, kind: 'http_error' as const, status: stationsResult.status }
  const stationsData = safeJsonParse<StationsResponse>(stationsResult.text)
  if (!stationsData) return { ok: false as const, kind: 'malformed' as const, message: 'Digitraffic weather stations response was not valid JSON.' }

  const withinBbox = (stationsData.features ?? []).filter(feature => {
    const [lon, lat] = feature.geometry?.coordinates ?? []
    return typeof lat === 'number' && typeof lon === 'number' && lat >= lamin && lat <= lamax && lon >= lomin && lon <= lomax
  })

  const targets = withinBbox.slice(0, Math.min(limit, MAX_STATIONS))
  const dataResults = await Promise.all(
    targets.map(station => safeProviderFetch(PROVIDER, `${BASE_URL}/stations/${station.properties.id}/data`, { timeoutMs: 10_000, headers })),
  )

  const documents: ReturnType<typeof makeDocument>[] = []
  targets.forEach((station, i) => {
    const result = dataResults[i]
    if (!result.ok) return
    const parsed = safeJsonParse<StationDataResponse>(result.text)
    if (!parsed) return
    const sensors = parsed.sensorValues ?? []
    const [lon, lat] = station.geometry.coordinates
    const stationId = station.properties.id
    const sourceReportsUnavailable = station.properties.collectionStatus !== 'GATHERING'

    const rawSensorCodes: Record<string, string> = {}
    for (const sensor of sensors) {
      if (!DECODED_SENSOR_NAMES.has(sensor.name)) {
        rawSensorCodes[sensor.name] = `${sensor.value}${sensor.unit ? ` ${sensor.unit}` : ''}`
      }
    }

    const airTemp = findSensor(sensors, SENSOR_AIR_TEMP_C)
    const roadTemp = findSensor(sensors, SENSOR_ROAD_TEMP_C)
    const roadTemp2 = findSensor(sensors, SENSOR_ROAD_TEMP_C_SECONDARY)
    const groundTemp = findSensor(sensors, SENSOR_GROUND_TEMP_C)
    const dewPoint = findSensor(sensors, SENSOR_DEW_POINT_C)
    const humidity = findSensor(sensors, SENSOR_HUMIDITY_PCT)
    const visibility = findSensor(sensors, SENSOR_VISIBILITY_KM)
    const windAvg = findSensor(sensors, SENSOR_WIND_AVG_MS)
    const windMax = findSensor(sensors, SENSOR_WIND_MAX_MS)
    const windDir = findSensor(sensors, SENSOR_WIND_DIR_DEG)
    const precipIntensity = findSensor(sensors, SENSOR_PRECIP_INTENSITY_MMH)
    const precipSum = findSensor(sensors, SENSOR_PRECIP_SUM_MM)
    const friction = findSensor(sensors, SENSOR_FRICTION_COEFFICIENT)
    const measuredTimeIso = parsed.dataUpdatedTime ?? station.properties.dataUpdatedTime ?? null
    const canonicalUrl = `https://tie.digitraffic.fi/api/weather/v1/stations/${stationId}`

    documents.push(makeDocument({
      id: `digitraffic_road_weather:${stationId}`,
      provider: PROVIDER,
      providerRecordId: String(stationId),
      title: station.properties.name,
      summary: null,
      contentSnippet: `lat ${lat}, lon ${lon}`,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'Digitraffic Road Weather (Fintraffic)',
      contentType: 'road_weather_observation',
      authors: [],
      organization: 'Fintraffic',
      publishedAt: measuredTimeIso,
      updatedAt: null,
      geography: `lat ${lat}, lon ${lon}`,
      language: null,
      identifiers: {
        stationId: String(stationId),
        latitude: String(lat),
        longitude: String(lon),
        collectionStatus: station.properties.collectionStatus,
        sourceReportsUnavailable: String(sourceReportsUnavailable),
        ...(measuredTimeIso ? { measuredTimeIso } : {}),
        ...(airTemp ? { airTemperatureC: String(airTemp.value) } : {}),
        ...(roadTemp ? { roadSurfaceTemperatureC: String(roadTemp.value) } : {}),
        ...(roadTemp2 ? { roadSurfaceTemperatureC2: String(roadTemp2.value) } : {}),
        ...(groundTemp ? { groundTemperatureC: String(groundTemp.value) } : {}),
        ...(dewPoint ? { dewPointC: String(dewPoint.value) } : {}),
        ...(humidity ? { relativeHumidityPct: String(humidity.value) } : {}),
        ...(visibility ? { visibilityKm: String(visibility.value) } : {}),
        ...(windAvg ? { windAverageMs: String(windAvg.value) } : {}),
        ...(windMax ? { windMaxMs: String(windMax.value) } : {}),
        ...(windDir ? { windDirectionDeg: String(windDir.value) } : {}),
        ...(precipIntensity ? { precipitationIntensityMmH: String(precipIntensity.value) } : {}),
        ...(precipSum ? { precipitationSumMm: String(precipSum.value) } : {}),
        ...(friction ? { frictionCoefficient: String(friction.value) } : {}),
        ...(Object.keys(rawSensorCodes).length ? { rawSensorCodesJson: JSON.stringify(rawSensorCodes) } : {}),
      },
      subjects: [],
      license: 'CC BY 4.0',
      accessStatus: 'open',
    }))
  })

  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Digitraffic Road Weather request failed with HTTP ${outcome.status}`)
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

export const digitrafficRoadWeatherAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
