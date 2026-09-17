/**
 * Commander-facing camera discovery plan from the ACTIVE TERRA LOCATION.
 * Reuses TERRA_COVERAGE_REGISTRY (coverageProvidersForPoint). Does not add a fourth registry.
 * Queries only camera layer ids that geographically cover the point.
 */
import type { TerraDegreeRectangle } from '../aircraftBoundingBox'
import { coverageProvidersForPoint, type TerraCoverageProviderRecord } from '../coverageFederation'
import { fetchableCameraLayerIds } from './cameraFederation'

/** Camera catalog layers Terra can fetch — derived from coverage + traffic_camera catalog rows. */
export const DISCOVERY_CAMERA_LAYER_IDS: readonly string[] = fetchableCameraLayerIds()

export type DiscoveryCameraLayerId = string

const CAMERA_LAYER_SET = new Set<string>(DISCOVERY_CAMERA_LAYER_IDS)

export const CAMERA_DISCOVERY_RADIUS_KM = 40
export const CAMERA_DISCOVERY_EXPANDED_RADIUS_KM = 80
/** Historical city-scale query window (meters). Discovery uses radiusKm for the catalog bbox.
 * MUST NOT be used as a fly-to / camera destination — discovery is data retrieval, not navigation. */
export const CAMERA_DISCOVERY_ALTITUDE_M = 22_000

export type CameraDiscoveryPlan = {
  latitude: number
  longitude: number
  coveringProviders: TerraCoverageProviderRecord[]
  cameraLayerIds: DiscoveryCameraLayerId[]
  skippedLayerIds: DiscoveryCameraLayerId[]
  viewerOnlyProviders: TerraCoverageProviderRecord[]
  commanderPrivateProviders: TerraCoverageProviderRecord[]
  rectangle: TerraDegreeRectangle
  hasApiCoverage: boolean
  requiresCommanderSession: boolean
  providerAuthRequired: boolean
  radiusKm: number
}

export function cameraDiscoveryRectangle(latitude: number, longitude: number, radiusKm = CAMERA_DISCOVERY_RADIUS_KM): TerraDegreeRectangle {
  const dLat = radiusKm / 111
  const cos = Math.cos((latitude * Math.PI) / 180)
  const dLon = radiusKm / (111 * (Math.abs(cos) < 0.08 ? 0.08 : Math.abs(cos)))
  return {
    west: longitude - dLon,
    south: latitude - dLat,
    east: longitude + dLon,
    north: latitude + dLat,
  }
}

export function planCameraDiscovery(latitude: number, longitude: number, radiusKm = CAMERA_DISCOVERY_RADIUS_KM): CameraDiscoveryPlan {
  const coveringProviders = coverageProvidersForPoint(latitude, longitude, 'cameras')
  const commanderPrivateProviders = coveringProviders.filter(row => row.authModel === 'COMMANDER_PRIVATE')
  const queryable = coveringProviders.filter(row => row.authModel !== 'COMMANDER_PRIVATE')
  const cameraLayerIds = [...new Set(queryable.flatMap(row => row.layerIds))]
    .filter((id): id is DiscoveryCameraLayerId => CAMERA_LAYER_SET.has(id))
  const skippedLayerIds = DISCOVERY_CAMERA_LAYER_IDS.filter(id => !cameraLayerIds.includes(id))
  const viewerOnlyProviders = coveringProviders.filter(row => row.endpointType === 'OFFICIAL_VIEWER')
  return {
    latitude,
    longitude,
    coveringProviders,
    cameraLayerIds,
    skippedLayerIds,
    viewerOnlyProviders,
    commanderPrivateProviders,
    rectangle: cameraDiscoveryRectangle(latitude, longitude, radiusKm),
    hasApiCoverage: cameraLayerIds.length > 0,
    requiresCommanderSession: commanderPrivateProviders.some(row => row.layerIds.some(id => CAMERA_LAYER_SET.has(id))),
    providerAuthRequired: cameraLayerIds.length === 0 && viewerOnlyProviders.some(row => row.authModel === 'PROVIDER_AUTH'),
    radiusKm,
  }
}
