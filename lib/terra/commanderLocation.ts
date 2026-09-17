/**
 * Authoritative Commander live-location model.
 * Device coordinates never come from Nominatim. Values that the device did not supply stay null.
 * Precise location is COMMANDER_PRIVATE — not logged, not stored as history, not sent to Council.
 */
import { haversineKm } from './geographicContext'

export const COMMANDER_LOCATION_PRIVACY_CLASS = 'COMMANDER_PRIVATE' as const
export const COMMANDER_LOCATION_HISTORY_DEFAULT = 'OFF' as const

export const LOCATION_SOURCES = [
  'DEVICE_GPS',
  'BROWSER_GEOLOCATION',
  'NATIVE_GEOCLUE',
  'PHONE_BRIDGE',
  'NETWORK_COARSE',
] as const
export type CommanderLocationSource = (typeof LOCATION_SOURCES)[number]

export const LOCATION_PERMISSIONS = ['PROMPT', 'GRANTED', 'DENIED', 'UNAVAILABLE'] as const
export type CommanderLocationPermission = (typeof LOCATION_PERMISSIONS)[number]

export const LOCATION_TRACKING = ['OFF', 'LOCATING', 'FOLLOWING', 'DEGRADED', 'ERROR'] as const
export type CommanderLocationTracking = (typeof LOCATION_TRACKING)[number]

export const LOCATION_MODES = ['OFF', 'LOCATE_ONCE', 'FOLLOW_ME'] as const
export type CommanderLocationMode = (typeof LOCATION_MODES)[number]

export const LOCATION_UI_STATES = [
  'GPS_OFF',
  'REQUESTING_PERMISSION',
  'FOLLOWING',
  'LOCATED',
  'LOCATION_DENIED',
  'LOCATION_UNAVAILABLE',
  'LOW_ACCURACY',
  'STALE_LOCATION',
  'NATIVE_LOCATION_UNAVAILABLE',
  'REVERSE_GEOCODE_UNAVAILABLE',
] as const
export type CommanderLocationUiState = (typeof LOCATION_UI_STATES)[number]

/** Marker-only: typical consumer GPS jitter. */
export const SMALL_MOVE_METERS = 25
/** Nearby cameras / local intel / weather / hazards. Matches neighborhood-scale Terra work. */
export const MEANINGFUL_MOVE_METERS = 250
/** City/county-scale shift: refresh all location-sensitive sources + reverse geocode. */
export const JURISDICTION_MOVE_METERS = 5_000
/** Do not reverse-geocode every watchPosition tick. */
export const REVERSE_GEOCODE_MIN_MOVE_METERS = 400
export const REVERSE_GEOCODE_MIN_INTERVAL_MS = 45_000
/** Expensive intel refresh floor even when the Commander is moving. */
export const INTEL_REFRESH_MIN_INTERVAL_MS = 20_000
export const STALE_FIX_MS = 60_000
export const LOW_ACCURACY_METERS = 1_000
export const NETWORK_COARSE_METERS = 500

export type CommanderLocation = {
  lat: number
  lon: number
  accuracyMeters: number | null
  altitude: number | null
  altitudeAccuracy: number | null
  heading: number | null
  speed: number | null
  timestamp: number
  source: CommanderLocationSource
}

export type CommanderLocationDiagnostics = {
  geolocationApi: boolean
  secureContext: boolean
  protocol: string | null
  hostname: string | null
  permissionState: PermissionState | 'unsupported' | null
  platform: string | null
  nativeAdapter: 'ready' | 'unavailable' | 'not_desktop'
  phoneBridge: 'INTERFACE_ONLY'
}

export type CommanderLocationState = {
  location: CommanderLocation | null
  permission: CommanderLocationPermission
  tracking: CommanderLocationTracking
  mode: CommanderLocationMode
  followCamera: boolean
  reason: string
  uiState: CommanderLocationUiState
  diagnostics: CommanderLocationDiagnostics
  lastErrorCode: number | null
  nativeTried: boolean
}

export type LocationMovementClass = 'none' | 'small' | 'meaningful' | 'jurisdiction'

export const EMPTY_LOCATION_DIAGNOSTICS: CommanderLocationDiagnostics = {
  geolocationApi: false,
  secureContext: false,
  protocol: null,
  hostname: null,
  permissionState: null,
  platform: null,
  nativeAdapter: 'not_desktop',
  phoneBridge: 'INTERFACE_ONLY',
}

export const INITIAL_COMMANDER_LOCATION_STATE: CommanderLocationState = {
  location: null,
  permission: 'PROMPT',
  tracking: 'OFF',
  mode: 'OFF',
  followCamera: false,
  reason: 'GPS is off. Location tracking starts only after Commander presses LOCATE ME or FOLLOW ME.',
  uiState: 'GPS_OFF',
  diagnostics: EMPTY_LOCATION_DIAGNOSTICS,
  lastErrorCode: null,
  nativeTried: false,
}

export function metersBetween(
  from: { lat: number; lon: number } | null | undefined,
  to: { lat: number; lon: number } | null | undefined,
): number | null {
  if (!from || !to) return null
  if (![from.lat, from.lon, to.lat, to.lon].every(Number.isFinite)) return null
  return haversineKm(from.lat, from.lon, to.lat, to.lon) * 1000
}

export function classifyLocationMovement(
  from: { lat: number; lon: number } | null | undefined,
  to: { lat: number; lon: number } | null | undefined,
): LocationMovementClass {
  const meters = metersBetween(from, to)
  if (meters == null) return 'jurisdiction'
  if (meters < SMALL_MOVE_METERS) return 'none'
  if (meters < MEANINGFUL_MOVE_METERS) return 'small'
  if (meters < JURISDICTION_MOVE_METERS) return 'meaningful'
  return 'jurisdiction'
}

export function shouldRefreshLocalIntel(input: {
  previous: { lat: number; lon: number; at: number } | null
  next: { lat: number; lon: number }
  now?: number
}): boolean {
  const now = input.now ?? Date.now()
  if (!input.previous) return true
  const movement = classifyLocationMovement(input.previous, input.next)
  if (movement === 'jurisdiction') return true
  if (movement === 'meaningful' && now - input.previous.at >= INTEL_REFRESH_MIN_INTERVAL_MS) return true
  if (now - input.previous.at >= 120_000 && movement !== 'none') return true
  return false
}

export function shouldReverseGeocode(input: {
  previous: { lat: number; lon: number; at: number } | null
  next: { lat: number; lon: number }
  now?: number
}): boolean {
  const now = input.now ?? Date.now()
  if (!input.previous) return true
  const meters = metersBetween(input.previous, input.next)
  if (meters == null) return true
  if (meters >= JURISDICTION_MOVE_METERS) return true
  if (meters >= REVERSE_GEOCODE_MIN_MOVE_METERS && now - input.previous.at >= REVERSE_GEOCODE_MIN_INTERVAL_MS) return true
  if (now - input.previous.at >= 10 * 60_000) return true
  return false
}

export function classifyBrowserSource(accuracyMeters: number | null): CommanderLocationSource {
  if (accuracyMeters != null && Number.isFinite(accuracyMeters) && accuracyMeters > NETWORK_COARSE_METERS) {
    return 'NETWORK_COARSE'
  }
  if (accuracyMeters != null && Number.isFinite(accuracyMeters) && accuracyMeters <= 50) {
    return 'DEVICE_GPS'
  }
  return 'BROWSER_GEOLOCATION'
}

export function classifyNativeSource(accuracyMeters: number | null): CommanderLocationSource {
  if (accuracyMeters != null && Number.isFinite(accuracyMeters) && accuracyMeters > NETWORK_COARSE_METERS) {
    return 'NETWORK_COARSE'
  }
  return 'NATIVE_GEOCLUE'
}

export function optionalFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function readCommanderLocationFromPosition(
  position: GeolocationPosition,
  source: CommanderLocationSource,
): CommanderLocation {
  const coords = position.coords
  return {
    lat: coords.latitude,
    lon: coords.longitude,
    accuracyMeters: optionalFinite(coords.accuracy),
    altitude: optionalFinite(coords.altitude),
    altitudeAccuracy: optionalFinite(coords.altitudeAccuracy),
    heading: optionalFinite(coords.heading),
    speed: optionalFinite(coords.speed),
    timestamp: position.timestamp,
    source,
  }
}

export function deriveUiState(state: Pick<CommanderLocationState, 'tracking' | 'permission' | 'location' | 'mode' | 'reason'>): CommanderLocationUiState {
  if (state.permission === 'DENIED' && state.tracking !== 'LOCATING') return 'LOCATION_DENIED'
  if (state.tracking === 'OFF' && !state.location) return 'GPS_OFF'
  if (state.tracking === 'LOCATING') return 'REQUESTING_PERMISSION'
  if (state.tracking === 'ERROR' && /native/i.test(state.reason)) return 'NATIVE_LOCATION_UNAVAILABLE'
  if (state.permission === 'UNAVAILABLE' || state.tracking === 'ERROR') {
    return state.location ? 'STALE_LOCATION' : 'LOCATION_UNAVAILABLE'
  }
  if (state.tracking === 'DEGRADED') return 'LOW_ACCURACY'
  if (state.tracking === 'FOLLOWING') {
    if (state.location && Date.now() - state.location.timestamp > STALE_FIX_MS) return 'STALE_LOCATION'
    if (state.location?.accuracyMeters != null && state.location.accuracyMeters > LOW_ACCURACY_METERS) return 'LOW_ACCURACY'
    return 'FOLLOWING'
  }
  if (state.location) return 'LOCATED'
  return 'GPS_OFF'
}

export function formatLocationAge(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 1) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  return `${minutes}m ago`
}

export function formatAccuracy(accuracyMeters: number | null): string | null {
  if (accuracyMeters == null || !Number.isFinite(accuracyMeters)) return null
  return `± ${Math.round(accuracyMeters)} m`
}

export function formatCoordinateFallback(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`
}

export function sourceDisplayLabel(source: CommanderLocationSource): string {
  if (source === 'DEVICE_GPS') return 'DEVICE GPS'
  if (source === 'BROWSER_GEOLOCATION') return 'BROWSER'
  if (source === 'NATIVE_GEOCLUE') return 'GEOCLUE'
  if (source === 'PHONE_BRIDGE') return 'PHONE'
  return 'NETWORK'
}

export type DesktopNativeLocationResult =
  | {
    ok: true
    lat: number
    lon: number
    accuracyMeters: number | null
    altitude: number | null
    heading: number | null
    speed: number | null
    timestamp: number
    source: 'NATIVE_GEOCLUE' | 'NETWORK_COARSE'
  }
  | { ok: false; reason: string }

export type WarRoomDesktopBridge = {
  invoke(channel: 'terra.nativeLocation.getFix'): Promise<DesktopNativeLocationResult>
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}
