/**
 * Terra globe navigation ownership.
 *
 * Commander intent wins. Automatic cinematic/orbit motion yields when the Commander
 * searches, jumps, views a camera, inspects a building/ground point, or opens Area Live media.
 * Camera discovery is data retrieval and must not own the globe pose.
 */

export const TERRA_NAV_STATES = [
  'IDLE',
  'AUTO_ORBIT',
  'SEARCH_FLY',
  'CAMERA_FLY',
  'COMMANDER_INSPECT',
  'MANUAL_GLOBE',
] as const

export type TerraNavState = (typeof TERRA_NAV_STATES)[number]

export const TERRA_NAV_ACTIONS = [
  'SEARCH_GO',
  'JUMP',
  'CAMERA_VIEW',
  'CAMERA_MARKER_CLICK',
  'BUILDING_INSPECT',
  'GROUND_INSPECT',
  'AREA_LIVE_MEDIA',
  'FLIGHT_COMPLETE',
  'FLIGHT_CANCELLED',
  'MANUAL_DRAG',
  'RESUME_ORBIT',
  'ORBIT_STARTED',
] as const

export type TerraNavAction = (typeof TERRA_NAV_ACTIONS)[number]

/**
 * Provider-independent camera inspection altitude (meters above ellipsoid).
 * Below the CITY (20 km) and LOCAL (2 km) scale floors so VIEW settles in BUILDING/STREET
 * context: marker, roads, footprints, inspect card, and camera media stay in frame.
 * Not a city-overview and not a planet pullback.
 */
export const CAMERA_INSPECT_ALTITUDE_M = 1_800

/**
 * Provider-independent inspect pitch (degrees). 0 is horizon; negative looks down at the
 * pin/road. Not a fabricated camera heading — heading is applied only when the provider
 * already published a bearing/direction.
 */
export const CAMERA_INSPECT_PITCH_DEG = -48

/**
 * Cluster overview altitude (meters above ellipsoid). A Cesium pin cluster is many cameras,
 * not one inspect target. Stays at CITY/REGION overview — never CAMERA_INSPECT_ALTITUDE_M.
 */
export const CAMERA_CLUSTER_ALTITUDE_M = 28_000

export function orbitMayAutoResume(state: TerraNavState): boolean {
  return state === 'IDLE' || state === 'AUTO_ORBIT'
}

export function actionSuspendsOrbit(action: TerraNavAction): boolean {
  return action !== 'RESUME_ORBIT' && action !== 'ORBIT_STARTED' && action !== 'FLIGHT_COMPLETE'
}

export function nextTerraNavState(current: TerraNavState, action: TerraNavAction): TerraNavState {
  switch (action) {
    case 'SEARCH_GO':
    case 'JUMP':
      return 'SEARCH_FLY'
    case 'CAMERA_VIEW':
    case 'CAMERA_MARKER_CLICK':
    case 'AREA_LIVE_MEDIA':
      return 'CAMERA_FLY'
    case 'BUILDING_INSPECT':
    case 'GROUND_INSPECT':
      return 'COMMANDER_INSPECT'
    case 'FLIGHT_COMPLETE':
      if (current === 'CAMERA_FLY' || current === 'SEARCH_FLY') return 'COMMANDER_INSPECT'
      return current
    case 'FLIGHT_CANCELLED':
    case 'MANUAL_DRAG':
      return 'MANUAL_GLOBE'
    case 'RESUME_ORBIT':
      return 'AUTO_ORBIT'
    case 'ORBIT_STARTED':
      return current === 'IDLE' || current === 'AUTO_ORBIT' ? 'AUTO_ORBIT' : current
    default:
      return current
  }
}

export function isCameraInspectPlaceType(placeType: string | null | undefined): boolean {
  const type = (placeType ?? '').toLowerCase()
  if (!type || type.includes('cluster')) return false
  return type.includes('traffic_camera') || type === 'camera'
}

export function isCameraClusterPlaceType(placeType: string | null | undefined): boolean {
  return (placeType ?? '').toLowerCase().includes('camera_cluster')
}

export function isStreetInspectPlaceType(placeType: string | null | undefined): boolean {
  const type = (placeType ?? '').toLowerCase()
  if (!type || type.includes('cluster')) return false
  // Needles stay source-backed OSM class/type fragments only.
  const needles = [
    'building',
    'house',
    'amenity',
    'shop',
    'highway',
    'address',
    'street',
    'traffic_camera',
    'tourism',
    'attraction',
    'landmark',
    'man_made',
    'historic',
    'office',
    'leisure',
  ]
  return needles.some(needle => type.includes(needle))
}

export function isAdminOverviewPlaceType(placeType: string | null | undefined): boolean {
  const type = (placeType ?? '').toLowerCase()
  const needles = [
    'city',
    'town',
    'village',
    'suburb',
    'postcode',
    'postal',
    'county',
    'state',
    'administrative',
    'country',
    'continent',
  ]
  return needles.some(needle => type.includes(needle))
}
