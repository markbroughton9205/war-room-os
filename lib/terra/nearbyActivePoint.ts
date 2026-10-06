/**
 * Nearby / God's Eye / Area Live origin.
 * Uses the accepted Terra location — never globe/camera/viewport center.
 * Worldwide: SEARCH, GPS, map click, camera/event inspect, coordinates, Council handoff.
 */

import type { TerraActiveLocation, TerraContextType } from './activeLocation'

export const NEARBY_ACTIVE_POINT_SOURCES = [
  'SEARCH',
  'GPS',
  'CLICK',
  'CAMERA',
  'EVENT',
  'COORDINATE',
  'HANDOFF',
] as const
export type NearbyActivePointSource = (typeof NEARBY_ACTIVE_POINT_SOURCES)[number]

export type NearbyActivePoint = {
  latitude: number
  longitude: number
  label: string
  source: NearbyActivePointSource
  contextType: TerraContextType | null
}

function finitePoint(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
}

function isGpsTrackingActive(tracking: string | null | undefined): boolean {
  return tracking === 'FOLLOWING' || tracking === 'LOCATING' || tracking === 'DEGRADED'
}

/** Viewport/globe center is never an accepted Nearby origin. */
export function isViewportContext(contextType: TerraContextType | null | undefined): boolean {
  return contextType === 'VIEWPORT'
}

export function nearbySourceFromContext(contextType: TerraContextType | null | undefined): NearbyActivePointSource | null {
  if (!contextType || contextType === 'VIEWPORT') return null
  if (contextType === 'SEARCH' || contextType === 'FLY_TO') return 'SEARCH'
  if (contextType === 'GPS') return 'GPS'
  if (contextType === 'CLICK') return 'CLICK'
  if (contextType === 'CAMERA') return 'CAMERA'
  if (contextType === 'EVENT') return 'EVENT'
  if (contextType === 'COORDINATE') return 'COORDINATE'
  if (contextType === 'HANDOFF') return 'HANDOFF'
  return null
}

export function resolveNearbyActivePoint(input: {
  activeLocation: Pick<TerraActiveLocation, 'latitude' | 'longitude' | 'label' | 'contextType' | 'source'> | null
  gps?: { lat: number; lon: number; tracking?: string | null } | null
}): NearbyActivePoint | null {
  const location = input.activeLocation
  const gps = input.gps && finitePoint(input.gps.lat, input.gps.lon) ? input.gps : null
  const gpsActive = Boolean(gps && isGpsTrackingActive(gps.tracking))

  if (location && finitePoint(location.latitude, location.longitude) && !isViewportContext(location.contextType)) {
    const source = nearbySourceFromContext(location.contextType)
      ?? (location.source === 'coordinates' ? 'COORDINATE' : null)
    if (source) {
      return {
        latitude: location.latitude,
        longitude: location.longitude,
        label: location.label,
        source,
        contextType: location.contextType ?? (source === 'COORDINATE' ? 'COORDINATE' : null),
      }
    }
  }

  if (gps && (gpsActive || !location || isViewportContext(location.contextType))) {
    return {
      latitude: gps.lat,
      longitude: gps.lon,
      label: 'Commander GPS (local only)',
      source: 'GPS',
      contextType: 'GPS',
    }
  }

  return null
}
