/**
 * God's Eye / Terra federated traffic-camera record — the shared, provider-agnostic schema every
 * US still-camera adapter (OHGO, New York State cameras, Caltrans CWWP2) normalizes into before
 * anything Cesium- or inspect-card-specific happens.
 *
 * Distinct from TerraIntelligenceEvent (the broader intelligence record). This type is the
 * camera-specific payload stored on `TerraIntelligenceEvent.properties` (and readable from a
 * TerraGeoFeature) so every consumer — Cesium markers, hover preview, inspect card, nearby-camera
 * index — reads the same fields.
 *
 * Health vocabulary is the federation set LIVE / STALE / OFFLINE / NO_COVERAGE / AUTH_REQUIRED /
 * RATE_LIMITED / UNAVAILABLE. A refreshed JPEG that is current is LIVE, never "live video"
 * (feedType stays REFRESHED_IMAGE). Stale media is never labeled LIVE.
 */
export const TERRA_TRAFFIC_CAMERA_FEED_TYPES = ['REFRESHED_IMAGE', 'STILL', 'VIDEO', 'HTML_VIEWER'] as const
export type TerraTrafficCameraFeedType = (typeof TERRA_TRAFFIC_CAMERA_FEED_TYPES)[number]

export const TERRA_TRAFFIC_CAMERA_HEALTH_STATES = [
  'LIVE',
  'STALE',
  'OFFLINE',
  'NO_COVERAGE',
  'AUTH_REQUIRED',
  'RATE_LIMITED',
  'UNAVAILABLE',
] as const
export type TerraTrafficCameraHealthState = (typeof TERRA_TRAFFIC_CAMERA_HEALTH_STATES)[number]

export const TERRA_TRAFFIC_CAMERA_AUTH_STATES = [
  'PUBLIC_KEY_REQUIRED',
  'PUBLIC_NO_AUTH',
  'SESSION_REQUIRED',
] as const
export type TerraTrafficCameraAuthState = (typeof TERRA_TRAFFIC_CAMERA_AUTH_STATES)[number]

export const TERRA_TRAFFIC_CAMERA_HEALTH_LABELS: Record<TerraTrafficCameraHealthState, string> = {
  LIVE: 'LIVE',
  STALE: 'STALE',
  OFFLINE: 'OFFLINE',
  NO_COVERAGE: 'NO COVERAGE',
  AUTH_REQUIRED: 'AUTH REQUIRED',
  RATE_LIMITED: 'RATE LIMITED',
  UNAVAILABLE: 'UNAVAILABLE',
}

export type TerraTrafficCameraRecord = {
  id: string
  provider: string
  agency: string
  country: string
  region: string
  road: string | null
  locationName: string
  lat: number
  lon: number
  direction: string | null
  bearing: number | null
  feedType: TerraTrafficCameraFeedType
  imageUrl: string | null
  streamUrl: string | null
  viewerUrl: string | null
  lastUpdated: string | null
  catalogStatus?: 'LIVE' | 'STALE' | 'UNAVAILABLE'
  imageFreshness?: 'LIVE' | 'STALE' | 'UNKNOWN' | 'UNAVAILABLE'
  freshnessState: TerraTrafficCameraHealthState
  coverageState: TerraTrafficCameraHealthState
  authState: TerraTrafficCameraAuthState
  license: string | null
  attribution: string
  sourceUrl: string | null
}

const CARDINAL_BEARING: Record<string, number> = {
  N: 0,
  NB: 0,
  NORTH: 0,
  NORTHBOUND: 0,
  NE: 45,
  NORTHEAST: 45,
  E: 90,
  EB: 90,
  EAST: 90,
  EASTBOUND: 90,
  SE: 135,
  SOUTHEAST: 135,
  S: 180,
  SB: 180,
  SOUTH: 180,
  SOUTHBOUND: 180,
  SW: 225,
  SOUTHWEST: 225,
  W: 270,
  WB: 270,
  WEST: 270,
  WESTBOUND: 270,
  NW: 315,
  NORTHWEST: 315,
}

/** PTZ has no fixed bearing. Other documented cardinals map to degrees; anything else is null. */
export function bearingFromCameraDirection(direction: string | null | undefined): number | null {
  if (!direction) return null
  const key = direction.trim().toUpperCase()
  if (!key || key === 'PTZ' || key === 'UNKNOWN') return null
  return CARDINAL_BEARING[key] ?? null
}

export function normalizeCameraDirection(direction: string | null | undefined): string | null {
  if (!direction) return null
  const trimmed = direction.trim()
  if (!trimmed) return null
  const upper = trimmed.toUpperCase()
  if (upper === 'PTZ') return 'PTZ'
  return trimmed
}

export function isValidWgs84Point(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}

export function trafficCameraRecordToProperties(record: TerraTrafficCameraRecord): Record<string, unknown> {
  return {
    cameraId: record.id,
    provider: record.provider,
    agency: record.agency,
    country: record.country,
    region: record.region,
    road: record.road,
    locationName: record.locationName,
    lat: record.lat,
    lon: record.lon,
    direction: record.direction,
    bearing: record.bearing,
    feedType: record.feedType,
    imageUrl: record.imageUrl,
    streamUrl: record.streamUrl,
    viewerUrl: record.viewerUrl,
    lastUpdated: record.lastUpdated,
    catalogStatus: record.catalogStatus ?? null,
    imageFreshness: record.imageFreshness ?? null,
    freshnessState: record.freshnessState,
    coverageState: record.coverageState,
    authState: record.authState,
    license: record.license,
    attribution: record.attribution,
    sourceUrl: record.sourceUrl,
    // Legacy inspect/hover field: refreshed stills that are current stay `still_image`, never
    // `live_video`. Federation health lives in freshnessState.
    freshness: record.freshnessState === 'LIVE' && record.feedType !== 'VIDEO' ? 'still_image' : record.freshnessState === 'STALE' ? 'stale' : record.freshnessState === 'OFFLINE' ? 'offline' : 'unknown',
    capturedAt: record.lastUpdated,
  }
}

export function trafficCameraRecordFromProperties(properties: Record<string, unknown>): Partial<TerraTrafficCameraRecord> {
  const str = (key: string): string | null => (typeof properties[key] === 'string' ? properties[key] : null)
  const num = (key: string): number | null => (typeof properties[key] === 'number' && Number.isFinite(properties[key]) ? properties[key] : null)
  return {
    id: str('cameraId') ?? str('id') ?? undefined,
    provider: str('provider') ?? undefined,
    agency: str('agency') ?? undefined,
    country: str('country') ?? undefined,
    region: str('region') ?? undefined,
    road: str('road'),
    locationName: str('locationName') ?? undefined,
    lat: num('lat') ?? undefined,
    lon: num('lon') ?? undefined,
    direction: str('direction'),
    bearing: num('bearing'),
    feedType: TERRA_TRAFFIC_CAMERA_FEED_TYPES.includes(properties.feedType as TerraTrafficCameraFeedType)
      ? (properties.feedType as TerraTrafficCameraFeedType)
      : undefined,
    imageUrl: str('imageUrl'),
    streamUrl: str('streamUrl'),
    viewerUrl: str('viewerUrl'),
    lastUpdated: str('lastUpdated') ?? str('capturedAt'),
    catalogStatus: properties.catalogStatus === 'LIVE' || properties.catalogStatus === 'STALE' || properties.catalogStatus === 'UNAVAILABLE'
      ? properties.catalogStatus
      : undefined,
    imageFreshness: properties.imageFreshness === 'LIVE' || properties.imageFreshness === 'STALE' || properties.imageFreshness === 'UNKNOWN' || properties.imageFreshness === 'UNAVAILABLE'
      ? properties.imageFreshness
      : undefined,
    freshnessState: TERRA_TRAFFIC_CAMERA_HEALTH_STATES.includes(properties.freshnessState as TerraTrafficCameraHealthState)
      ? (properties.freshnessState as TerraTrafficCameraHealthState)
      : undefined,
    coverageState: TERRA_TRAFFIC_CAMERA_HEALTH_STATES.includes(properties.coverageState as TerraTrafficCameraHealthState)
      ? (properties.coverageState as TerraTrafficCameraHealthState)
      : undefined,
    authState: TERRA_TRAFFIC_CAMERA_AUTH_STATES.includes(properties.authState as TerraTrafficCameraAuthState)
      ? (properties.authState as TerraTrafficCameraAuthState)
      : undefined,
    license: str('license'),
    attribution: str('attribution') ?? undefined,
    sourceUrl: str('sourceUrl'),
  }
}
