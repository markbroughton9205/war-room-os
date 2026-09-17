/**
 * Explicit cinematic navigation outcomes. ARRIVED is never inferred from flying === false.
 * Cesium types stay out so validation can run in Node.
 */
import { haversineKm, type CinematicFlyPlan } from './cinematicFlyTo'

export const TERRA_CINEMATIC_FLIGHT_STATES = [
  'IDLE',
  'FLYING',
  'ARRIVED',
  'INTERRUPTED',
  'CANCELLED',
  'SUPERSEDED',
  'FAILED',
] as const

export type TerraCinematicFlightState = (typeof TERRA_CINEMATIC_FLIGHT_STATES)[number]

export type TerraCinematicFlightPurpose = 'search' | 'jump' | 'camera' | 'event' | 'gps' | 'inspect'

export type TerraCinematicCameraSample = {
  latitude: number
  longitude: number
  heightMeters: number
}

export type TerraCinematicFlightEndEvent = {
  generationMatches: boolean
  completeFired: boolean
  cancelled: boolean
  interrupted: boolean
  superseded: boolean
  settled: boolean
}

export function destinationSettleToleranceKm(input: {
  destinationHeightMeters: number
  rectangleSpanKm?: number | null
}): number {
  if (input.rectangleSpanKm && Number.isFinite(input.rectangleSpanKm)) {
    return Math.max(25, Math.min(900, input.rectangleSpanKm * 0.6))
  }
  const height = input.destinationHeightMeters
  if (height <= 2_000) return 12
  if (height <= 25_000) return 80
  if (height <= 120_000) return 250
  if (height <= 1_500_000) return 800
  return 2_000
}

function rectangleSpanKm(destination: Extract<CinematicFlyPlan['destination'], { kind: 'rectangle' }>): number {
  const latKm = Math.abs(destination.north - destination.south) * 111
  const midLat = (destination.north + destination.south) / 2
  const lonKm = Math.abs(destination.east - destination.west) * 111 * Math.cos((midLat * Math.PI) / 180)
  return Math.max(latKm, lonKm)
}

export function cameraSettledAtDestination(
  camera: TerraCinematicCameraSample,
  destination: CinematicFlyPlan['destination'],
  options?: { instant?: boolean },
): boolean {
  if (destination.kind === 'rectangle') {
    const latPad = Math.max(0.12, (destination.north - destination.south) * 0.25)
    const lonPad = Math.max(0.12, (destination.east - destination.west) * 0.25)
    const inside =
      camera.latitude >= destination.south - latPad
      && camera.latitude <= destination.north + latPad
      && camera.longitude >= destination.west - lonPad
      && camera.longitude <= destination.east + lonPad
    if (inside) return true
    const center = {
      latitude: (destination.south + destination.north) / 2,
      longitude: (destination.west + destination.east) / 2,
    }
    const tolerance = destinationSettleToleranceKm({
      destinationHeightMeters: camera.heightMeters,
      rectangleSpanKm: rectangleSpanKm(destination),
    })
    return haversineKm(camera, center) <= (options?.instant ? Math.max(tolerance, 120) : tolerance)
  }
  const tolerance = destinationSettleToleranceKm({ destinationHeightMeters: destination.heightMeters })
  const allowed = options?.instant ? Math.max(tolerance, 120) : tolerance
  if (haversineKm(camera, destination) > allowed) return false
  const destH = destination.heightMeters
  const camH = camera.heightMeters
  if (destH <= 2_000) return camH < 8_000
  if (destH <= 25_000) return camH < 80_000
  return Math.abs(camH - destH) <= Math.max(destH, 400_000)
}

export function resolveCinematicFlightOutcome(event: TerraCinematicFlightEndEvent): TerraCinematicFlightState {
  if (!event.generationMatches) return 'SUPERSEDED'
  if (event.superseded) return 'SUPERSEDED'
  if (event.interrupted) return 'INTERRUPTED'
  if (event.cancelled) return 'CANCELLED'
  if (!event.completeFired) return 'FAILED'
  if (!event.settled) return 'FAILED'
  return 'ARRIVED'
}

export function formatCinematicFlightStatus(input: {
  outcome: TerraCinematicFlightState
  label: string
  instant?: boolean
}): string {
  const name = input.label.trim() || 'destination'
  switch (input.outcome) {
    case 'FLYING':
      return input.instant ? `Jumping to ${name}` : `Flying to ${name}`
    case 'ARRIVED':
      return `Arrived · ${name}`
    case 'INTERRUPTED':
      return 'Interrupted · MANUAL CONTROL'
    case 'CANCELLED':
      return 'Cancelled'
    case 'SUPERSEDED':
      return `Superseded · ${name}`
    case 'FAILED':
      return 'Flight did not reach destination'
    default:
      return ''
  }
}
