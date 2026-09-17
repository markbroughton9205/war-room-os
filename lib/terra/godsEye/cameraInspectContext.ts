/**
 * Whether a selected traffic-camera inspect may survive an active-location change.
 * Zoom/camera-move is not a context change. Provider-auth / no-coverage / other catalog /
 * outside-radius cameras must not keep their inspect card.
 */
import { haversineKm } from '../geographicContext'
import { CAMERA_DISCOVERY_RADIUS_KM, planCameraDiscovery, type CameraDiscoveryPlan } from './cameraDiscovery'

export type SelectedTrafficCameraContext = {
  layerId: string
  latitude: number
  longitude: number
}

/**
 * Explicit SEARCH / JUMP starts a new investigation. Being inside the discovery radius
 * does not keep a previously inspected camera as the active object.
 */
export function cameraInspectSurvivesOriginChange(input: {
  contextType: string | null | undefined
  navState: string | null | undefined
}): boolean {
  if (input.contextType === 'SEARCH') return false
  if (input.navState === 'SEARCH_FLY') return false
  return true
}

export function selectedCameraFitsActiveContext(input: {
  camera: SelectedTrafficCameraContext
  origin: { latitude: number; longitude: number }
  radiusKm?: number
  plan?: CameraDiscoveryPlan
}): boolean {
  const radiusKm = input.radiusKm ?? CAMERA_DISCOVERY_RADIUS_KM
  const plan = input.plan ?? planCameraDiscovery(input.origin.latitude, input.origin.longitude, radiusKm)
  if (plan.providerAuthRequired) return false
  if (!plan.hasApiCoverage) return false
  if (!plan.cameraLayerIds.includes(input.camera.layerId)) return false
  const distanceKm = haversineKm(
    input.origin.latitude,
    input.origin.longitude,
    input.camera.latitude,
    input.camera.longitude,
  )
  return Number.isFinite(distanceKm) && distanceKm <= radiusKm
}
