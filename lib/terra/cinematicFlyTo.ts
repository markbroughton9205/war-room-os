/**
 * Pure cinematic fly-to planner for Terra. Cesium types stay out of this module so validation
 * can run in Node. TerraShell/useTerraCinematicFlight converts the plan into camera.flyTo.
 *
 * Never teleports unless reduced-motion is active, the hop is extremely short, or the Commander
 * explicitly requested an instant jump. Coordinates are never invented here — the destination
 * must already be a resolved TerraLocationTarget / observed event position.
 */
import { CAMERA_CLUSTER_ALTITUDE_M, CAMERA_INSPECT_ALTITUDE_M, CAMERA_INSPECT_PITCH_DEG, isAdminOverviewPlaceType, isCameraClusterPlaceType, isCameraInspectPlaceType, isStreetInspectPlaceType } from './godsEye/navigationOwnership'

export type CinematicFlyOrigin = {
  longitude: number
  latitude: number
  heightMeters: number
}

export type CinematicFlyDestination = {
  longitude: number
  latitude: number
  boundingBox?: { south: number; north: number; west: number; east: number } | null
  placeType?: string | null
  altitudeMeters?: number | null
  headingDegrees?: number | null
}

export type CinematicFlyPlan = {
  mode: 'instant' | 'direct' | 'cinematic'
  durationSeconds: number
  destination:
    | { kind: 'point'; longitude: number; latitude: number; heightMeters: number }
    | { kind: 'rectangle'; west: number; south: number; east: number; north: number }
  maximumHeightMeters: number | null
  flyOverLongitude: number | null
  pitchAdjustHeightMeters: number | null
  headingDegrees: number | null
  pitchDegrees: number | null
  reason: string
}

const EXTREMELY_SHORT_KM = 3
const PULLBACK_DISTANCE_KM = 400
const PULLBACK_CURRENT_HEIGHT_M = 250_000
const PULLBACK_HEIGHT_M = 6_500_000
const FLYOVER_LONGITUDE_DELTA_DEG = 40
const EARTH_RADIUS_KM = 6371

const DEGENERATE_LONGITUDE_SPAN_DEG = 350
const RECENTERED_LONGITUDE_SPAN_DEG = 60
const MIN_RECTANGLE_SPAN_DEG = 0.004

export function haversineKm(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(to.latitude - from.latitude)
  const dLon = toRad(to.longitude - from.longitude)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function settleAltitudeMeters(placeType: string | null | undefined, hasBoundingBox: boolean): number {
  const type = (placeType ?? '').toLowerCase()
  if (isCameraClusterPlaceType(placeType)) return CAMERA_CLUSTER_ALTITUDE_M
  if (type.includes('traffic_camera') || type === 'camera') return CAMERA_INSPECT_ALTITUDE_M
  if (type.includes('building') || type.includes('house') || type.includes('amenity') || type.includes('shop')) return 900
  if (type.includes('highway') || type.includes('address') || type.includes('street')) return 1_400
  if (isStreetInspectPlaceType(placeType) && !isAdminOverviewPlaceType(placeType)) return 900
  if (type.includes('postcode') || type.includes('postal')) return 8_000
  if (type.includes('city') || type.includes('town') || type.includes('village') || type.includes('suburb')) return 12_000
  if (type.includes('county') || type.includes('state') || type.includes('administrative')) return hasBoundingBox ? 80_000 : 40_000
  if (type.includes('country') || type.includes('continent')) return 1_200_000
  return hasBoundingBox ? 20_000 : 3_000
}

const CAMERA_CLUSTER_MIN_SPAN_DEG = 0.08

function cameraClusterDestination(to: CinematicFlyDestination): CinematicFlyPlan['destination'] {
  const requested = to.altitudeMeters
  const heightMeters = typeof requested === 'number' && Number.isFinite(requested) && requested >= 20_000
    ? requested
    : CAMERA_CLUSTER_ALTITUDE_M
  const box = to.boundingBox
  if (box) {
    const half = CAMERA_CLUSTER_MIN_SPAN_DEG / 2
    return {
      kind: 'rectangle',
      west: Math.min(box.west, to.longitude - half),
      east: Math.max(box.east, to.longitude + half),
      south: Math.min(box.south, to.latitude - half),
      north: Math.max(box.north, to.latitude + half),
    }
  }
  return { kind: 'point', longitude: to.longitude, latitude: to.latitude, heightMeters }
}

function cinematicDestination(to: CinematicFlyDestination): CinematicFlyPlan['destination'] {
  if (isCameraClusterPlaceType(to.placeType)) return cameraClusterDestination(to)
  if (isCameraInspectPlaceType(to.placeType)) return cameraInspectPoint(to)
  const heightMeters = to.altitudeMeters ?? settleAltitudeMeters(to.placeType, Boolean(to.boundingBox))
  const point = { kind: 'point' as const, longitude: to.longitude, latitude: to.latitude, heightMeters }
  const inspectAltitude = typeof to.altitudeMeters === 'number' && to.altitudeMeters <= 2_000
  const streetInspect = isStreetInspectPlaceType(to.placeType) && !isAdminOverviewPlaceType(to.placeType)
  if (inspectAltitude || streetInspect) return point
  const rectangle = framedSearchRectangle(to)
  return rectangle ? { kind: 'rectangle' as const, ...rectangle } : point
}

export function framedSearchRectangle(
  destination: CinematicFlyDestination,
): { west: number; south: number; east: number; north: number } | null {
  const box = destination.boundingBox
  if (!box) return null
  const { south, north, west, east } = box
  if (east - west >= DEGENERATE_LONGITUDE_SPAN_DEG) {
    const half = RECENTERED_LONGITUDE_SPAN_DEG / 2
    return { west: destination.longitude - half, south, east: destination.longitude + half, north }
  }
  const halfMin = MIN_RECTANGLE_SPAN_DEG / 2
  return {
    west: Math.min(west, destination.longitude - halfMin),
    east: Math.max(east, destination.longitude + halfMin),
    south: Math.min(south, destination.latitude - halfMin),
    north: Math.max(north, destination.latitude + halfMin),
  }
}

function sourcedHeadingDegrees(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return ((value % 360) + 360) % 360
}

function cameraInspectPoint(to: CinematicFlyDestination): Extract<CinematicFlyPlan['destination'], { kind: 'point' }> {
  const requested = to.altitudeMeters
  const heightMeters = typeof requested === 'number' && Number.isFinite(requested) && requested > 0 && requested <= 2_000
    ? requested
    : CAMERA_INSPECT_ALTITUDE_M
  return { kind: 'point', longitude: to.longitude, latitude: to.latitude, heightMeters }
}

function cameraInspectPlan(input: {
  from: CinematicFlyOrigin | null
  to: CinematicFlyDestination
  instant: boolean
  reason: string
}): CinematicFlyPlan {
  const destination = cameraInspectPoint(input.to)
  const headingDegrees = sourcedHeadingDegrees(input.to.headingDegrees)
  const origin = input.from
  const distanceKm = origin
    ? haversineKm({ latitude: origin.latitude, longitude: origin.longitude }, input.to)
    : Number.POSITIVE_INFINITY
  const heightDelta = origin ? Math.abs(origin.heightMeters - destination.heightMeters) : destination.heightMeters
  const durationSeconds = input.instant
    ? 0
    : origin && distanceKm < EXTREMELY_SHORT_KM
      ? 0.9
      : Number.isFinite(distanceKm)
        ? Math.min(6, Math.max(1.4, 1.4 + Math.min(distanceKm, 400) / 180 + Math.min(heightDelta, 250_000) / 180_000))
        : 2.4
  return {
    mode: input.instant ? 'instant' : distanceKm < 80 ? 'direct' : 'cinematic',
    durationSeconds,
    destination,
    maximumHeightMeters: null,
    flyOverLongitude: null,
    pitchAdjustHeightMeters: null,
    headingDegrees,
    pitchDegrees: CAMERA_INSPECT_PITCH_DEG,
    reason: input.reason,
  }
}

function emptyOrientation(): Pick<CinematicFlyPlan, 'headingDegrees' | 'pitchDegrees'> {
  return { headingDegrees: null, pitchDegrees: null }
}

function shortestLongitudeDelta(from: number, to: number): number {
  let delta = to - from
  while (delta > 180) delta -= 360
  while (delta < -180) delta += 360
  return delta
}

export function planCinematicFlyTo(input: {
  from: CinematicFlyOrigin | null
  to: CinematicFlyDestination
  prefersReducedMotion: boolean
  instantRequested: boolean
}): CinematicFlyPlan {
  if (isCameraInspectPlaceType(input.to.placeType)) {
    const instant = input.prefersReducedMotion || input.instantRequested
    return cameraInspectPlan({
      from: input.from,
      to: input.to,
      instant,
      reason: instant
        ? (input.prefersReducedMotion
          ? 'camera inspect — instant (reduced motion)'
          : 'camera inspect — instant jump')
        : 'camera inspect — camera coordinate, no planet pullback, no coverage rectangle',
    })
  }

  const destination = cinematicDestination(input.to)

  if (input.prefersReducedMotion) {
    return {
      mode: 'instant',
      durationSeconds: 0,
      destination,
      maximumHeightMeters: null,
      flyOverLongitude: null,
      pitchAdjustHeightMeters: null,
      ...emptyOrientation(),
      reason: 'prefers-reduced-motion — instant jump, no cinematic traversal',
    }
  }
  if (input.instantRequested) {
    return {
      mode: 'instant',
      durationSeconds: 0,
      destination,
      maximumHeightMeters: null,
      flyOverLongitude: null,
      pitchAdjustHeightMeters: null,
      ...emptyOrientation(),
      reason: 'Commander requested instant jump',
    }
  }

  const origin = input.from
  const distanceKm = origin
    ? haversineKm({ latitude: origin.latitude, longitude: origin.longitude }, input.to)
    : Number.POSITIVE_INFINITY

  if (origin && distanceKm < EXTREMELY_SHORT_KM) {
    return {
      mode: 'direct',
      durationSeconds: 0.9,
      destination,
      maximumHeightMeters: null,
      flyOverLongitude: null,
      pitchAdjustHeightMeters: null,
      ...emptyOrientation(),
      reason: `extremely short hop (${distanceKm.toFixed(2)} km) — no globe traversal`,
    }
  }

  const durationSeconds = Number.isFinite(distanceKm)
    ? Math.min(8, Math.max(2.2, 2.2 + (distanceKm / 2_500) * 5))
    : 4.5
  const needsPullback = !origin || (origin.heightMeters < PULLBACK_CURRENT_HEIGHT_M && distanceKm > PULLBACK_DISTANCE_KM)
  const longitudeDelta = origin ? Math.abs(shortestLongitudeDelta(origin.longitude, input.to.longitude)) : 180
  const flyOver = !origin || longitudeDelta >= FLYOVER_LONGITUDE_DELTA_DEG
    ? input.to.longitude
    : null

  return {
    mode: 'cinematic',
    durationSeconds,
    destination,
    maximumHeightMeters: needsPullback ? PULLBACK_HEIGHT_M : null,
    flyOverLongitude: flyOver,
    pitchAdjustHeightMeters: needsPullback ? 400_000 : null,
    ...emptyOrientation(),
    reason: origin
      ? `cinematic traversal ${distanceKm.toFixed(0)} km`
      : 'cinematic traversal from unknown camera origin',
  }
}
