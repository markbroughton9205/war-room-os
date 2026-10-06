import type { TerraGeoFeature } from '@/lib/terra/types'
import { normalizeIcaoHex } from './identity'
import type { AircraftProviderObservation, FlightProviderId, PositionSource, ProviderHealthState } from './types'

const METERS_TO_FEET = 3.280839895
const MPS_TO_KT = 1.943844
const MPS_TO_FPM = 196.850394

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function blankObservation(provider: FlightProviderId, receivedAt: string): AircraftProviderObservation {
  return {
    provider,
    providerAircraftId: null,
    icaoHex: null,
    registration: null,
    callsign: null,
    icaoType: null,
    description: null,
    lat: null,
    lon: null,
    baroAltitudeFt: null,
    geomAltitudeFt: null,
    groundSpeedKt: null,
    indicatedAirSpeedKt: null,
    trueAirSpeedKt: null,
    mach: null,
    trackDeg: null,
    magneticHeadingDeg: null,
    trueHeadingDeg: null,
    baroVerticalRateFpm: null,
    geomVerticalRateFpm: null,
    squawk: null,
    emergency: null,
    positionSource: 'UNKNOWN',
    positionAgeSec: null,
    lastSeenSec: null,
    nic: null,
    nacP: null,
    nacV: null,
    sil: null,
    rc: null,
    category: null,
    providerFlags: [],
    onGround: null,
    originCountry: null,
    sourceTimestamp: null,
    receivedAt,
  }
}

export function positionSourceFromAdsbType(value: string | null): PositionSource {
  const token = (value ?? '').toLowerCase()
  if (token.startsWith('adsb')) return 'ADS-B'
  if (token.startsWith('mlat')) return 'MLAT'
  if (token.startsWith('tisb')) return 'TIS-B'
  if (token.startsWith('adsr')) return 'ADS-R'
  if (token.startsWith('adsc')) return 'ADS-C'
  if (token.startsWith('mode')) return 'MODE-S'
  if (!token) return 'UNKNOWN'
  return 'OTHER'
}

export function observationFromOpenSkyFeature(feature: TerraGeoFeature, receivedAt: string): AircraftProviderObservation | null {
  if (feature.kind !== 'aircraft_state') return null
  const observation = blankObservation('opensky', receivedAt)
  observation.icaoHex = normalizeIcaoHex(str(feature.properties.icao24))
  observation.providerAircraftId = observation.icaoHex
  observation.callsign = str(feature.properties.callsign)
  observation.lat = feature.latitude
  observation.lon = feature.longitude
  observation.originCountry = str(feature.properties.originCountry)
  observation.onGround = feature.properties.onGround === true ? true : feature.properties.onGround === false ? false : null
  const altitudeM = feature.altitude
  if (altitudeM !== null) observation.baroAltitudeFt = altitudeM * METERS_TO_FEET
  const velocity = num(feature.properties.velocityMps)
  if (velocity !== null) observation.groundSpeedKt = velocity * MPS_TO_KT
  observation.trackDeg = num(feature.properties.headingDeg)
  const vertical = num(feature.properties.verticalRateMps)
  if (vertical !== null) observation.baroVerticalRateFpm = vertical * MPS_TO_FPM
  const category = num(feature.properties.emitterCategory)
  observation.category = category !== null ? String(category) : null
  observation.sourceTimestamp = feature.timestamp
  observation.positionSource = 'UNKNOWN'
  if (feature.timestamp) {
    const age = (Date.parse(receivedAt) - Date.parse(feature.timestamp)) / 1000
    if (Number.isFinite(age)) observation.positionAgeSec = Math.max(0, age)
  }
  return observation.icaoHex ? observation : null
}

type AdsbAircraft = Record<string, unknown>

export function observationFromAdsbAircraft(
  provider: Extract<FlightProviderId, 'airplanes_live' | 'adsb_exchange'>,
  row: AdsbAircraft,
  receivedAt: string,
  nowSec: number | null,
): AircraftProviderObservation | null {
  const observation = blankObservation(provider, receivedAt)
  observation.icaoHex = normalizeIcaoHex(str(row.hex))
  observation.providerAircraftId = observation.icaoHex ?? str(row.hex)
  observation.registration = str(row.r)
  observation.callsign = str(row.flight)
  observation.icaoType = str(row.t)?.toUpperCase() ?? null
  observation.description = str(row.desc)
  observation.lat = num(row.lat)
  observation.lon = num(row.lon)
  const baro = row.alt_baro
  if (baro === 'ground') observation.onGround = true
  else if (num(baro) !== null) observation.baroAltitudeFt = num(baro)
  observation.geomAltitudeFt = num(row.alt_geom)
  observation.groundSpeedKt = num(row.gs)
  observation.indicatedAirSpeedKt = num(row.ias)
  observation.trueAirSpeedKt = num(row.tas)
  observation.mach = num(row.mach)
  observation.trackDeg = num(row.track)
  observation.magneticHeadingDeg = num(row.mag_heading)
  observation.trueHeadingDeg = num(row.true_heading)
  observation.baroVerticalRateFpm = num(row.baro_rate)
  observation.geomVerticalRateFpm = num(row.geom_rate)
  observation.squawk = str(row.squawk)
  observation.emergency = str(row.emergency)
  observation.positionSource = positionSourceFromAdsbType(str(row.type))
  observation.nic = num(row.nic)
  observation.nacP = num(row.nac_p)
  observation.nacV = num(row.nac_v)
  observation.sil = num(row.sil)
  observation.rc = num(row.rc)
  observation.category = str(row.category)
  const seenPos = num(row.seen_pos)
  const seen = num(row.seen)
  observation.positionAgeSec = seenPos
  observation.lastSeenSec = seen
  if (nowSec !== null && seenPos !== null) {
    observation.sourceTimestamp = new Date((nowSec - seenPos) * 1000).toISOString()
  }
  const flags = num(row.dbFlags)
  if (flags !== null && (flags & 1) === 1) observation.providerFlags.push('military')
  if (row.mil === true || row.mil === '1') observation.providerFlags.push('military')
  if (!observation.icaoHex && !observation.providerAircraftId && !observation.registration) return null
  return observation
}

export function parseAdsbFeed(provider: Extract<FlightProviderId, 'airplanes_live' | 'adsb_exchange'>, text: string, receivedAt: string): {
  observations: AircraftProviderObservation[]
  state: ProviderHealthState
} {
  let body: { ac?: unknown; now?: unknown; message?: unknown } | null = null
  try {
    body = JSON.parse(text) as { ac?: unknown; now?: unknown; message?: unknown }
  } catch {
    return {
      observations: [],
      state: { provider, state: 'PROVIDER_UNAVAILABLE', detail: 'Response was not JSON.', observationCount: 0 },
    }
  }
  const rows = Array.isArray(body.ac) ? body.ac : []
  const nowSec = num(body.now)
  const observations = rows.flatMap(row => {
    if (!row || typeof row !== 'object') return []
    const observation = observationFromAdsbAircraft(provider, row as AdsbAircraft, receivedAt, nowSec)
    return observation ? [observation] : []
  })
  return {
    observations,
    state: {
      provider,
      state: observations.length > 0 ? 'LIVE' : 'NO_COVERAGE',
      detail: observations.length > 0 ? `${observations.length} observations` : 'Provider returned no aircraft in this query.',
      observationCount: observations.length,
    },
  }
}

export function authRequiredState(provider: FlightProviderId, detail: string): ProviderHealthState {
  return { provider, state: 'AUTH_REQUIRED', detail, observationCount: 0 }
}
