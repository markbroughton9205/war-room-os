/**
 * Canonical camera-provider identity mapping.
 * Not a new coverage registry — aliases resolve onto existing layer/adapter ids.
 * Canonical ids are derived from coverage + catalog so a new wired camera provider
 * enters identity, Nearby, discovery, and God's Eye without a UI rewrite.
 */
import { TERRA_COVERAGE_REGISTRY } from './coverageFederation'
import { cameraProviderAdapterContracts, fetchableCameraLayerIds } from './godsEye/cameraFederation'
import { DISCOVERY_CAMERA_LAYER_IDS } from './godsEye/cameraDiscovery'
import { WIRED_NEARBY_CAMERA_ENVELOPES } from './godsEye/nearbyCameraCoverage'
import { ROAD_TRAFFIC_SOURCE_REGISTRY } from './roadTrafficSourceRegistry'

export const CANONICAL_CAMERA_PROVIDER_IDS: readonly string[] = [...new Set([
  ...fetchableCameraLayerIds(),
  ...cameraProviderAdapterContracts().map(row => row.canonicalId),
])]

export type CanonicalCameraProviderId = string

/** Coverage-federation / Nearby envelope aliases → canonical camera layer id. */
export const CAMERA_PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  ohgo: 'ohgo_cameras',
  '511ny': 'ny511_cameras',
  quebec_511_wfs: 'quebec_511_cameras',
  hong_kong_td_traffic_snapshots: 'hong_kong_td_cameras',
}

const CANONICAL_SET = new Set<string>(CANONICAL_CAMERA_PROVIDER_IDS)

export function canonicalCameraProviderId(id: string): string {
  return CAMERA_PROVIDER_ALIASES[id] ?? id
}

export function isCanonicalCameraProviderId(id: string): id is CanonicalCameraProviderId {
  return CANONICAL_SET.has(id)
}

export function cameraLayerIdsOnly(layerIds: readonly string[]): string[] {
  return layerIds.filter(id => isCanonicalCameraProviderId(canonicalCameraProviderId(id)) && !id.includes('events') && !id.includes('weather'))
}

export type CameraIdentityConsistencyIssue = {
  id: string
  detail: string
}

export function cameraProviderIdentityIssues(): CameraIdentityConsistencyIssue[] {
  const issues: CameraIdentityConsistencyIssue[] = []
  const trafficIds = ROAD_TRAFFIC_SOURCE_REGISTRY.filter(row => row.capabilities.includes('camera')).map(row => row.id)
  const seenTraffic = new Set<string>()
  for (const id of trafficIds) {
    if (seenTraffic.has(id)) issues.push({ id, detail: `duplicate camera id in ROAD_TRAFFIC_SOURCE_REGISTRY: ${id}` })
    seenTraffic.add(id)
    if (id === 'quebec_511_wfs' || id === 'hong_kong_td_traffic_snapshots' || id === '511ny') {
      issues.push({ id, detail: `stale camera alias used as registry id; canonical is ${canonicalCameraProviderId(id)}` })
    }
  }

  for (const row of TERRA_COVERAGE_REGISTRY.filter(entry => entry.category === 'cameras')) {
    const eventIds = row.layerIds.filter(id => id.includes('events') || id.includes('weather'))
    if (row.id === 'ohgo') continue
    if (eventIds.length) {
      issues.push({ id: row.id, detail: `camera coverage row includes non-camera layerIds: ${eventIds.join(', ')}` })
    }
  }

  const nearbyIds = new Set(WIRED_NEARBY_CAMERA_ENVELOPES.map(row => canonicalCameraProviderId(row.id)))
  const discoveryIds = new Set(DISCOVERY_CAMERA_LAYER_IDS)

  for (const id of discoveryIds) {
    if (!nearbyIds.has(id) && !nearbyIds.has(canonicalCameraProviderId(id))) {
      issues.push({ id, detail: `discovery camera layer missing Nearby envelope: ${id}` })
    }
  }

  return issues
}
