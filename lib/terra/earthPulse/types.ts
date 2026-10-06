/**
 * Terra Earth Pulse Phase 1 — unified environmental state.
 * Every visual traces to a real source or is labeled presentation behavior.
 * Archival / forecast / computed products are never branded LIVE.
 */

export const EARTH_PULSE_DOMAINS = [
  'solar',
  'clouds',
  'lightning',
  'earthquakes',
  'aurora',
  'night_lights',
  'fires',
  'ocean',
  'human_activity',
] as const
export type EarthPulseDomain = (typeof EARTH_PULSE_DOMAINS)[number]

export const EARTH_PULSE_TRUTH_STATES = [
  'LIVE',
  'RECENT',
  'STALE',
  'UNAVAILABLE',
  'NO_COVERAGE',
] as const
export type EarthPulseTruthState = (typeof EARTH_PULSE_TRUTH_STATES)[number]

export type EarthPulseCoverageKind = 'global' | 'regional' | 'none'

export type EarthPulseCoverage = {
  kind: EarthPulseCoverageKind
  label: string
  west: number | null
  south: number | null
  east: number | null
  north: number | null
  basis: string
}

export type EarthPulseSourceTruth = {
  source: string
  license: string
  auth: 'none' | 'earthdata' | 'unavailable'
  coverage: EarthPulseCoverage
  freshness: EarthPulseTruthState
  temporalResolution: string
  visualState: string
  docsUrl: string
}

export type EarthPulseDomainState = {
  domain: EarthPulseDomain
  source: string
  observedAt: string | null
  updatedAt: string | null
  freshness: EarthPulseTruthState
  coverage: EarthPulseCoverage
  truthState: EarthPulseTruthState
  truth: EarthPulseSourceTruth
  note: string
  itemCount: number
}

export type EarthPulseEngineState = {
  retrievedAt: string
  terraTime: string
  timeMode: 'live' | 'historical'
  domains: Record<EarthPulseDomain, EarthPulseDomainState>
}

export type EarthPulseCloudSatellite = 'GOES-East' | 'GOES-West' | 'Himawari' | 'RealEarth-IR'

export type EarthPulseCloudFrame = {
  id: string
  timestampIso: string
  satellite: EarthPulseCloudSatellite
  layerId: string
  tileUrlTemplate: string
  maximumLevel: number
  product?: 'GEOCOLOR' | 'IR'
  appearance?: 'NATURAL_COLOR' | 'INFRARED'
}

export type EarthPulseCloudFederation = {
  primary: string
  asia: string
  globalFill: string
  himawariAvailable: boolean
  fillAvailable: boolean
  failover: string
}

export type EarthPulseCloudCatalog = {
  frames: EarthPulseCloudFrame[]
  latestBySatellite: Partial<Record<EarthPulseCloudSatellite, EarthPulseCloudFrame>>
  intervalMinutes: number
  cacheBound: number
  truthState: EarthPulseTruthState
  coverage: EarthPulseCoverage
  error: string | null
  fromCache: boolean
  playbackSatellite?: EarthPulseCloudSatellite
  federation?: EarthPulseCloudFederation
}

export type EarthPulseQuakeEvent = {
  id: string
  longitude: number
  latitude: number
  depthKm: number | null
  magnitude: number | null
  place: string | null
  observedAt: string
  updatedAt: string | null
  url: string | null
  pulse: boolean
}

export type EarthPulseLightningFlash = {
  id: string
  longitude: number
  latitude: number
  count: number
  energy: number
  satellite: 'G18' | 'G19'
  observedAt: string
}

export type EarthPulseAuroraCell = {
  longitude: number
  latitude: number
  aurora: number
  hemisphere: 'north' | 'south'
}

export type NightLightsMode = 'DAILY' | 'ARCHIVE'

export type NightLightsCatalog = {
  mode: NightLightsMode
  layerId: string
  productDate: string
  tileUrlTemplate: string
  maximumLevel: number
  truthState: EarthPulseTruthState
  dailyBlackMarble: 'UNAVAILABLE'
  dailyDnb: boolean
  archiveFallback: boolean
  note: string
  fromCache: boolean
}

export const EARTH_PULSE_LIVE_MAX_AGE_MS = 15 * 60_000
export const EARTH_PULSE_RECENT_MAX_AGE_MS = 3 * 60 * 60_000
export const EARTH_PULSE_QUAKE_FRESH_MS = 30 * 60_000
export const EARTH_PULSE_LIGHTNING_LIVE_MS = 2 * 60_000
export const EARTH_PULSE_LIGHTNING_RECENT_MS = 15 * 60_000
export const EARTH_PULSE_AURORA_LIVE_MS = 90 * 60_000
export const EARTH_PULSE_CLOUD_FRAME_MINUTES = 10
export const EARTH_PULSE_CLOUD_FRAME_CACHE = 12
/** Commander playback cadence. Source observations stay 10 minutes apart. */
export const TERRA_CLOUD_DISPLAY_INTERVAL_MS = 1500
export const TERRA_CLOUD_CROSSFADE_MS = 400
/** Two persistent buffers per GOES hemisphere. Never unbounded. */
export const TERRA_CLOUD_LAYER_MAX = 4
/** Orbit-altitude presentation cap. Street/city fade lives in weather/atmosphere/opacity.ts. */
export const TERRA_CLOUD_LAYER_ALPHA = 0.72
export const TERRA_LIGHTNING_FLASH_MS = 220
export const TERRA_LIGHTNING_GLOBE_CAP = 18
export const TERRA_LIGHTNING_CLOSE_CAP = 64
export const EARTH_PULSE_LIGHTNING_CELL_DEG = 0.8
export const EARTH_PULSE_LIGHTNING_CAP = 160
export const EARTH_PULSE_AURORA_CAP = 900
export const EARTH_PULSE_AURORA_MIN = 8
export const EARTH_PULSE_QUAKE_CAP = 80
