/**
 * Compact Nearby God's Eye inventory from layers that actually have data
 * at the active Terra location. Omits empty/uncovered groups.
 */
import { nearbyPublicCameras, type NearbyCameraIndexFeature } from './nearbyCameras'
import { nearbyCameraCoverageForPoint, type NearbyCameraLocationState } from './nearbyCameraCoverage'
import { haversineKm } from '../geographicContext'

export type NearbyGodsEyeRow = {
  id: string
  label: string
  count: number
  state: 'COVERED' | 'PARTIAL' | 'NO_COVERAGE' | 'AUTH_REQUIRED' | 'PROVIDER_AUTH_REQUIRED' | 'NONE_WITHIN_RADIUS' | 'UNAVAILABLE' | 'EMPTY'
  detail: string
}

export type NearbyGodsEyeSnapshot = {
  originLabel: string
  rows: NearbyGodsEyeRow[]
  cameraState: NearbyCameraLocationState
}

const HAZARD_KINDS = new Set([
  'earthquake',
  'tropical_cyclone',
  'wildfire_incident',
  'volcano_event',
  'flood_event',
  'severe_weather_alert',
  'tsunami_alert',
])

type NearbyFeature = {
  kind: string
  latitude: number
  longitude: number
}

export function composeNearbyGodsEye(input: {
  latitude: number
  longitude: number
  originLabel: string
  radiusKm?: number
  cameraFeatures: readonly NearbyCameraIndexFeature[]
  cameraIndexLoaded?: boolean
  cameraAuthRequired?: boolean
  features?: readonly NearbyFeature[]
  localNewsCount?: number
  localNewsState?: string
  landmarkCount?: number
}): NearbyGodsEyeSnapshot {
  const radiusKm = input.radiusKm ?? 40
  const within = (kind: string | ((feature: NearbyFeature) => boolean)) => (
    (input.features ?? []).filter(feature => {
      if (!Number.isFinite(feature.latitude) || !Number.isFinite(feature.longitude)) return false
      if (haversineKm(input.latitude, input.longitude, feature.latitude, feature.longitude) > radiusKm) return false
      return typeof kind === 'string' ? feature.kind === kind : kind(feature)
    })
  )

  const cameras = nearbyPublicCameras({
    latitude: input.latitude,
    longitude: input.longitude,
    features: input.cameraFeatures,
    maxKm: radiusKm,
  })
  const cameraCoverage = nearbyCameraCoverageForPoint({
    latitude: input.latitude,
    longitude: input.longitude,
    nearbyCount: cameras.length,
    indexLoaded: input.cameraIndexLoaded,
    commanderAuthRequired: input.cameraAuthRequired,
    radiusKm,
  })

  const rows: NearbyGodsEyeRow[] = []
  if (typeof input.localNewsCount === 'number') {
    const state = input.localNewsState === 'UNAVAILABLE' ? 'UNAVAILABLE'
      : input.localNewsState === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED'
      : input.localNewsState === 'NO_COVERAGE' ? 'NO_COVERAGE'
      : input.localNewsCount > 0 ? 'COVERED'
      : 'EMPTY'
    rows.push({
      id: 'LOCAL_NEWS',
      label: 'LOCAL NEWS',
      count: input.localNewsCount,
      state,
      detail: `${input.localNewsCount} matching item${input.localNewsCount === 1 ? '' : 's'}`,
    })
  }

  const hazards = within(feature => HAZARD_KINDS.has(feature.kind))
  if (hazards.length) {
    rows.push({ id: 'HAZARDS', label: 'HAZARDS', count: hazards.length, state: 'COVERED', detail: `${hazards.length} sourced hazard${hazards.length === 1 ? '' : 's'} within ${radiusKm} km` })
  }

  if (cameraCoverage.locationState !== 'NO_COVERAGE') {
    rows.push({
      id: 'TRAFFIC_CAMERAS',
      label: 'TRAFFIC CAMERAS',
      count: cameras.length,
      state: cameraCoverage.locationState === 'COVERED' && cameras.length === 0 ? 'EMPTY' : cameraCoverage.locationState,
      detail: cameraCoverage.reason,
    })
  }

  const signals = within('traffic_signal')
  if (signals.length) {
    rows.push({ id: 'TRAFFIC_SIGNALS', label: 'TRAFFIC SIGNALS', count: signals.length, state: 'COVERED', detail: `${signals.length} mapped signal${signals.length === 1 ? '' : 's'}` })
  }
  const incidents = within(feature => feature.kind === 'traffic_event' || feature.kind === 'road_incident')
  if (incidents.length) {
    rows.push({ id: 'ROAD_INCIDENTS', label: 'ROAD INCIDENTS', count: incidents.length, state: 'COVERED', detail: `${incidents.length} sourced incident${incidents.length === 1 ? '' : 's'}` })
  }
  const aircraft = within('aircraft_state')
  if (aircraft.length) {
    rows.push({ id: 'AIRCRAFT', label: 'AIRCRAFT', count: aircraft.length, state: 'COVERED', detail: `${aircraft.length} in nearby airspace` })
  }
  const vessels = within('vessel_position')
  if (vessels.length) {
    rows.push({ id: 'VESSELS', label: 'VESSELS', count: vessels.length, state: 'COVERED', detail: `${vessels.length} in nearby waters` })
  }
  if ((input.landmarkCount ?? 0) > 0) {
    rows.push({
      id: 'PLACES',
      label: 'PLACES',
      count: input.landmarkCount ?? 0,
      state: 'COVERED',
      detail: `${input.landmarkCount} nearby place${input.landmarkCount === 1 ? '' : 's'}`,
    })
  }

  return {
    originLabel: input.originLabel,
    rows,
    cameraState: cameraCoverage.locationState,
  }
}
