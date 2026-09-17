export const NWS_WEATHER_PROVIDER = 'nws_weather' as const
export const NWS_WEATHER_LAYER_ID = 'nws_severe_weather_alerts' as const
export const NWS_ATTRIBUTION = 'National Weather Service / NOAA — US government work'

export const WEATHER_LIFECYCLE_STATES = ['ACTIVE', 'UPCOMING', 'EXPIRED', 'CANCELLED', 'UNKNOWN'] as const
export type WeatherLifecycleState = (typeof WEATHER_LIFECYCLE_STATES)[number]

export const WEATHER_GEOMETRY_BASES = ['POLYGON', 'BBOX', 'ZONE', 'REPRESENTATIVE_POINT', 'UNKNOWN'] as const
export type WeatherGeometryBasis = (typeof WEATHER_GEOMETRY_BASES)[number]

export const DEFAULT_WEATHER_TOAST_SEVERITIES = ['Extreme', 'Severe'] as const
export type WeatherToastSeverity = (typeof DEFAULT_WEATHER_TOAST_SEVERITIES)[number]

export type WeatherAlert = {
  id: string
  event: string | null
  headline: string | null
  severity: string | null
  urgency: string | null
  certainty: string | null
  status: string | null
  messageType: string | null
  sent: string | null
  effective: string | null
  onset: string | null
  ends: string | null
  expires: string | null
  updated: string | null
  areaDesc: string | null
  instruction: string | null
  description: string | null
  sourceUrl: string | null
  provider: typeof NWS_WEATHER_PROVIDER
  affectedZones: string[]
  rings: number[][][] | null
  bbox: { west: number; south: number; east: number; north: number } | null
  representativePoint: { latitude: number; longitude: number } | null
  geometryBasis: WeatherGeometryBasis
  lifecycle: WeatherLifecycleState
  retrievedAt: string | null
  liveIntelId: string
}

export type WeatherFlyPlan =
  | {
      action: 'fit-polygon'
      basis: 'POLYGON'
      west: number
      south: number
      east: number
      north: number
      longitude: number
      latitude: number
    }
  | {
      action: 'fit-bbox'
      basis: 'BBOX'
      west: number
      south: number
      east: number
      north: number
      longitude: number
      latitude: number
    }
  | {
      action: 'no-fly'
      basis: 'ZONE' | 'REPRESENTATIVE_POINT' | 'UNKNOWN'
      reason: string
    }

export type WeatherDedupeRecord = {
  id: string
  firstSeen: string
  lastSeen: string
  lastNotifiedAt: string | null
  lastFingerprint: string | null
}

export type WeatherToastCandidate = {
  alert: WeatherAlert
  kind: 'new' | 'updated'
}
