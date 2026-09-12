/**
 * #22 Phase 9 — Geometry helpers for navigation foundation.
 * Reuses Terra live coordinate validation.
 */
import { isValidLiveCoordinate } from '@/lib/terra/liveGeoIntelligence'

const EARTH_RADIUS_M = 6_371_000

export function assertValidLatLng(latitude: unknown, longitude: unknown): {
  ok: true
  latitude: number
  longitude: number
} | { ok: false; reason: string } {
  if (!isValidLiveCoordinate(latitude, longitude)) {
    return { ok: false, reason: 'Invalid latitude/longitude (non-finite or out of range).' }
  }
  return { ok: true, latitude: latitude as number, longitude: longitude as number }
}

export function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function bearingDegrees(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const φ1 = toRad(a.latitude)
  const φ2 = toRad(b.latitude)
  const Δλ = toRad(b.longitude - a.longitude)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** Distance from point to polyline (meters) + closest segment index. */
export function distanceToPolylineMeters(
  point: { latitude: number; longitude: number },
  line: Array<{ latitude: number; longitude: number }>,
): { distance_meters: number; closest_index: number } {
  if (line.length === 0) return { distance_meters: Number.POSITIVE_INFINITY, closest_index: -1 }
  if (line.length === 1) {
    return { distance_meters: haversineMeters(point, line[0]!), closest_index: 0 }
  }
  let best = Number.POSITIVE_INFINITY
  let bestIdx = 0
  for (let i = 0; i < line.length - 1; i++) {
    const d = distancePointToSegmentMeters(point, line[i]!, line[i + 1]!)
    if (d < best) {
      best = d
      bestIdx = i
    }
  }
  return { distance_meters: best, closest_index: bestIdx }
}

function distancePointToSegmentMeters(
  p: { latitude: number; longitude: number },
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  // Local equirectangular projection around segment midpoint for stability at small scales.
  const midLat = ((a.latitude + b.latitude) / 2) * (Math.PI / 180)
  const cos = Math.cos(midLat)
  const ax = a.longitude * cos
  const ay = a.latitude
  const bx = b.longitude * cos
  const by = b.latitude
  const px = p.longitude * cos
  const py = p.latitude
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const qx = ax + t * dx
  const qy = ay + t * dy
  return haversineMeters(p, { latitude: qy, longitude: qx / (cos || 1e-9) })
}

export function polylineLengthMeters(line: Array<{ latitude: number; longitude: number }>): number {
  let total = 0
  for (let i = 0; i < line.length - 1; i++) {
    total += haversineMeters(line[i]!, line[i + 1]!)
  }
  return total
}

export function isFiniteGeometry(line: Array<{ latitude: number; longitude: number }>): boolean {
  if (!Array.isArray(line) || line.length < 2) return false
  return line.every(p => isValidLiveCoordinate(p.latitude, p.longitude))
}
