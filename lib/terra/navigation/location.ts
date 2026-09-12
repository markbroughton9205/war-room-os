/**
 * #22 Phase 9 — Location / GNSS observation contract.
 * Explicit input by default. Supplied coordinates ≠ live device GPS.
 */
import { assertValidLatLng } from './geometry'
import type { NavigationLocationObservation, NavigationLocationRuntimeState } from './types'

export type CreateLocationInput = {
  latitude: unknown
  longitude: unknown
  observedAt?: string
  source?: NavigationLocationObservation['source']
  provider?: string
  permissionState?: NavigationLocationObservation['permission_state']
  claimLiveDeviceGps?: boolean
  accuracyMeters?: number | null
  altitudeMeters?: number | null
  headingDegrees?: number | null
  speedMps?: number | null
  deviceId?: string | null
  sessionId?: string | null
  ownerUserId?: string | null
  staleAfterMs?: number
  nowIso?: string
}

export function createLocationObservation(
  input: CreateLocationInput,
): { ok: true; location: NavigationLocationObservation } | { ok: false; reason: string; status: 'LOCATION_UNAVAILABLE' } {
  const coords = assertValidLatLng(input.latitude, input.longitude)
  if (!coords.ok) {
    return { ok: false, reason: coords.reason, status: 'LOCATION_UNAVAILABLE' }
  }

  const now = input.nowIso ?? new Date().toISOString()
  const observedAt = input.observedAt ?? now
  const observedMs = Date.parse(observedAt)
  const nowMs = Date.parse(now)
  const staleAfter = input.staleAfterMs ?? 120_000
  const isStale = Number.isFinite(observedMs) && Number.isFinite(nowMs) && nowMs - observedMs > staleAfter

  // Never claim LIVE_DEVICE_LOCATION unless an explicit supported device path is asserted AND permission granted.
  let runtime_state: NavigationLocationRuntimeState = 'SUPPLIED_LOCATION'
  if (input.claimLiveDeviceGps === true) {
    if (input.permissionState === 'DENIED') runtime_state = 'PERMISSION_DENIED'
    else if (input.source === 'device_gnss' && input.permissionState === 'GRANTED') {
      runtime_state = isStale ? 'STALE_LOCATION' : 'LIVE_DEVICE_LOCATION'
    } else {
      // Unsupported / unproven device path
      runtime_state = 'NOT_SUPPORTED'
    }
  } else if (isStale) {
    runtime_state = 'STALE_LOCATION'
  }

  const source = input.source ?? 'explicit_input'
  // Supplied/explicit/fixture must never be labeled LIVE_DEVICE_LOCATION
  if (source !== 'device_gnss' && runtime_state === 'LIVE_DEVICE_LOCATION') {
    runtime_state = 'SUPPLIED_LOCATION'
  }

  return {
    ok: true,
    location: {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy_meters: input.accuracyMeters ?? null,
      altitude_meters: input.altitudeMeters ?? null,
      heading_degrees: input.headingDegrees ?? null,
      speed_mps: input.speedMps ?? null,
      observed_at: observedAt,
      source,
      provider: input.provider ?? 'explicit_input',
      permission_state: input.permissionState ?? 'NOT_APPLICABLE',
      freshness: isStale ? 'STALE' : runtime_state === 'LIVE_DEVICE_LOCATION' ? 'LIVE' : 'CACHED',
      confidence: isStale ? 'LOW' : 'MEDIUM',
      runtime_state,
      device_id: input.deviceId ?? null,
      session_id: input.sessionId ?? null,
      owner_user_id: input.ownerUserId ?? null,
    },
  }
}

export const LOCATION_PRIVACY_DEFAULTS = Object.freeze({
  scope: 'SESSION_SCOPED',
  collection: 'BOUNDED',
  input: 'EXPLICIT_INPUT',
  background_tracking: false,
  persistent_history_by_default: false,
} as const)
