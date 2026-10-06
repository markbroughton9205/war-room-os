/**
 * Terra Flight Intelligence observations. One provider report is not aircraft truth.
 * Missing fields stay null. Coordinates are never averaged across providers.
 */

export const FLIGHT_PROVIDERS = ['opensky', 'airplanes_live', 'adsb_exchange'] as const
export type FlightProviderId = (typeof FLIGHT_PROVIDERS)[number]

export const POSITION_SOURCES = ['ADS-B', 'MLAT', 'TIS-B', 'ADS-R', 'ADS-C', 'MODE-S', 'OTHER', 'UNKNOWN'] as const
export type PositionSource = (typeof POSITION_SOURCES)[number]

export const FLIGHT_FRESHNESS = [
  'LIVE',
  'RECENT',
  'STALE',
  'LOST',
  'POSITION_UNAVAILABLE',
  'PROVIDER_UNAVAILABLE',
  'AUTH_REQUIRED',
  'NO_COVERAGE',
  'UNKNOWN',
] as const
export type FlightFreshness = (typeof FLIGHT_FRESHNESS)[number]

export const AIRCRAFT_CLASSES = [
  'COMMERCIAL',
  'GENERAL_AVIATION',
  'CARGO',
  'BUSINESS',
  'HELICOPTER',
  'MILITARY',
  'GOVERNMENT',
  'LAW_ENFORCEMENT',
  'MEDICAL',
  'SPECIAL_MISSION',
  'STRATEGIC',
  'UNKNOWN',
] as const
export type AircraftClass = (typeof AIRCRAFT_CLASSES)[number]

export type AircraftProviderObservation = {
  provider: FlightProviderId
  providerAircraftId: string | null
  icaoHex: string | null
  registration: string | null
  callsign: string | null
  icaoType: string | null
  description: string | null
  lat: number | null
  lon: number | null
  baroAltitudeFt: number | null
  geomAltitudeFt: number | null
  groundSpeedKt: number | null
  indicatedAirSpeedKt: number | null
  trueAirSpeedKt: number | null
  mach: number | null
  trackDeg: number | null
  magneticHeadingDeg: number | null
  trueHeadingDeg: number | null
  baroVerticalRateFpm: number | null
  geomVerticalRateFpm: number | null
  squawk: string | null
  emergency: string | null
  positionSource: PositionSource
  positionAgeSec: number | null
  lastSeenSec: number | null
  nic: number | null
  nacP: number | null
  nacV: number | null
  sil: number | null
  rc: number | null
  category: string | null
  providerFlags: string[]
  onGround: boolean | null
  originCountry: string | null
  sourceTimestamp: string | null
  receivedAt: string
}

export type AircraftIdentityBasis = 'icao_hex' | 'provider_aircraft_id' | 'registration' | 'temporary'

export type TerraAircraftIdentity = {
  key: string
  icaoHex: string | null
  registration: string | null
  basis: AircraftIdentityBasis
}

export type AircraftClassification = {
  id: string | null
  label: string | null
  icaoType: string | null
  classes: AircraftClass[]
  missionInferred: false
}

export type ProviderHealthState = {
  provider: FlightProviderId
  state: FlightFreshness
  detail: string
  observationCount: number
}

export type TerraAircraftTruth = {
  identity: TerraAircraftIdentity
  primary: AircraftProviderObservation | null
  alternates: AircraftProviderObservation[]
  classification: AircraftClassification
  freshness: FlightFreshness
  qualityReason: string
  alternateSourceCount: number
  sessionFirstSeen: string | null
  sessionLastSeen: string | null
  watched: boolean
}

export type FlightSearchKind = 'PLACE' | 'AIRCRAFT' | 'AIRCRAFT_TYPE' | 'WATCHLIST'
