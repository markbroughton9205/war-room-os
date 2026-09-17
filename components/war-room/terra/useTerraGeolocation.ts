'use client'

/**
 * Compatibility mapping from CommanderLocationProvider onto the older Terra GPS hook shape.
 * New Terra surfaces should call useCommanderLocation(). This file no longer talks to
 * navigator.geolocation — the controller is the only geolocation owner.
 */
import { useCommanderLocation } from './CommanderLocationProvider'
import type { CommanderLocation, CommanderLocationState } from '@/lib/terra/commanderLocation'

export type TerraGpsStatus =
  | 'OFF'
  | 'PERMISSION_REQUIRED'
  | 'ACQUIRING'
  | 'ACTIVE'
  | 'DENIED'
  | 'UNAVAILABLE'
  | 'ERROR'

export type TerraGpsFix = {
  latitude: number
  longitude: number
  accuracyMeters: number | null
  altitudeMeters: number | null
  heading: number | null
  speed: number | null
  timestamp: string
  source: CommanderLocation['source']
}

export type TerraGpsDiagnostics = CommanderLocationState['diagnostics']

export type TerraGpsState = {
  status: TerraGpsStatus
  fix: TerraGpsFix | null
  following: boolean
  reason: string
  diagnostics: TerraGpsDiagnostics
}

function mapStatus(state: CommanderLocationState): TerraGpsStatus {
  if (state.permission === 'DENIED' || state.uiState === 'LOCATION_DENIED') return 'DENIED'
  if (state.tracking === 'LOCATING') return 'ACQUIRING'
  if (state.location && (state.tracking === 'FOLLOWING' || state.tracking === 'DEGRADED' || state.tracking === 'OFF')) return 'ACTIVE'
  if (state.tracking === 'ERROR' || state.uiState === 'LOCATION_UNAVAILABLE' || state.uiState === 'NATIVE_LOCATION_UNAVAILABLE') {
    return state.permission === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'ERROR'
  }
  if (state.uiState === 'REQUESTING_PERMISSION') return 'PERMISSION_REQUIRED'
  return 'OFF'
}

function mapFix(location: CommanderLocation | null): TerraGpsFix | null {
  if (!location) return null
  return {
    latitude: location.lat,
    longitude: location.lon,
    accuracyMeters: location.accuracyMeters,
    altitudeMeters: location.altitude,
    heading: location.heading,
    speed: location.speed,
    timestamp: new Date(location.timestamp).toISOString(),
    source: location.source,
  }
}

export function useTerraGeolocation(): TerraGpsState & {
  enable: () => void
  disable: () => void
  follow: () => void
  unfollow: () => void
} {
  const commander = useCommanderLocation()
  return {
    status: mapStatus(commander),
    fix: mapFix(commander.location),
    following: commander.followCamera,
    reason: commander.reason,
    diagnostics: commander.diagnostics,
    enable: commander.locateOnce,
    disable: commander.stop,
    follow: () => commander.setFollowCamera(true),
    unfollow: () => commander.setFollowCamera(false),
  }
}
