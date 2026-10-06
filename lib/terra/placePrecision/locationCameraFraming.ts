/**
 * Precision-aware camera framing. Bands are recommendations pending visual QA —
 * not unquestionable truth. Never use one 3000 m height for every no-bbox result.
 */
import type { TerraLonLat, TerraPlaceMatchClass } from './matchClass'

export type LocationCameraFraming = {
  kind: 'point' | 'rectangle' | 'boundingSphere'
  longitude: number
  latitude: number
  heightMeters: number | null
  rangeMeters: number | null
  headingDegrees: number
  pitchDegrees: number
  rectangle: { west: number; south: number; east: number; north: number } | null
  points: TerraLonLat[]
  sampleTerrain: boolean
  reason: string
  approximateBadge: boolean
}

const ADDRESS_POINT_RANGE_M = 220
const INTERPOLATED_RANGE_M = 650
const STREET_RANGE_M = 1_400
const INSPECT_PITCH_DEG = -45
const STREET_PITCH_DEG = -40

function placeHeightMeters(placeType: string | null | undefined, hasBoundingBox: boolean): number {
  const type = (placeType ?? '').toLowerCase()
  if (type.includes('postcode') || type.includes('postal')) return 8_000
  if (type.includes('city') || type.includes('town') || type.includes('village') || type.includes('suburb')) return 12_000
  if (type.includes('county') || type.includes('state') || type.includes('administrative')) return hasBoundingBox ? 80_000 : 40_000
  if (type.includes('country') || type.includes('continent')) return 1_200_000
  return hasBoundingBox ? 20_000 : 3_000
}

function framedRectangle(
  longitude: number,
  latitude: number,
  box: { south: number; north: number; west: number; east: number } | null | undefined,
): { west: number; south: number; east: number; north: number } | null {
  if (!box) return null
  if (box.east - box.west >= 350) {
    return { west: longitude - 30, south: box.south, east: longitude + 30, north: box.north }
  }
  return {
    west: Math.min(box.west, longitude - 0.002),
    east: Math.max(box.east, longitude + 0.002),
    south: Math.min(box.south, latitude - 0.002),
    north: Math.max(box.north, latitude + 0.002),
  }
}

export function planLocationCameraFraming(input: {
  matchClass: TerraPlaceMatchClass | null | undefined
  longitude: number
  latitude: number
  boundingBox?: { south: number; north: number; west: number; east: number } | null
  placeType?: string | null
  ring?: TerraLonLat[] | null
  altitudeMeters?: number | null
}): LocationCameraFraming {
  const matchClass = input.matchClass ?? 'PLACE'
  if (matchClass === 'ROOFTOP' || matchClass === 'BUILDING') {
    const points = input.ring && input.ring.length >= 3 ? input.ring : [{ longitude: input.longitude, latitude: input.latitude }]
    return {
      kind: points.length >= 3 ? 'boundingSphere' : 'point',
      longitude: input.longitude,
      latitude: input.latitude,
      heightMeters: points.length >= 3 ? null : 180,
      rangeMeters: points.length >= 3 ? rangeFromRing(points, 1.8, 80, 280) : 180,
      headingDegrees: 0,
      pitchDegrees: INSPECT_PITCH_DEG,
      rectangle: null,
      points,
      sampleTerrain: true,
      reason: 'property/building inspection framing (recommendation pending visual QA)',
      approximateBadge: false,
    }
  }
  if (matchClass === 'PARCEL') {
    const points = input.ring && input.ring.length >= 3 ? input.ring : bboxRing(input.boundingBox, input)
    return {
      kind: 'boundingSphere',
      longitude: input.longitude,
      latitude: input.latitude,
      heightMeters: null,
      rangeMeters: rangeFromRing(points, 2.2, 140, 480),
      headingDegrees: 0,
      pitchDegrees: -42,
      rectangle: null,
      points,
      sampleTerrain: true,
      reason: 'parcel framing with margin (recommendation pending visual QA)',
      approximateBadge: false,
    }
  }
  if (matchClass === 'ADDRESS_POINT' || matchClass === 'COORDINATE') {
    return {
      kind: 'point',
      longitude: input.longitude,
      latitude: input.latitude,
      heightMeters: ADDRESS_POINT_RANGE_M,
      rangeMeters: ADDRESS_POINT_RANGE_M,
      headingDegrees: 0,
      pitchDegrees: INSPECT_PITCH_DEG,
      rectangle: null,
      points: [{ longitude: input.longitude, latitude: input.latitude }],
      sampleTerrain: true,
      reason: 'address-point close inspection ~120–350 m band (recommendation pending visual QA)',
      approximateBadge: false,
    }
  }
  if (matchClass === 'INTERPOLATED') {
    return {
      kind: 'point',
      longitude: input.longitude,
      latitude: input.latitude,
      heightMeters: INTERPOLATED_RANGE_M,
      rangeMeters: INTERPOLATED_RANGE_M,
      headingDegrees: 0,
      pitchDegrees: STREET_PITCH_DEG,
      rectangle: null,
      points: [{ longitude: input.longitude, latitude: input.latitude }],
      sampleTerrain: true,
      reason: 'interpolated neighborhood view ~400–900 m band',
      approximateBadge: true,
    }
  }
  if (matchClass === 'STREET') {
    return {
      kind: 'point',
      longitude: input.longitude,
      latitude: input.latitude,
      heightMeters: STREET_RANGE_M,
      rangeMeters: STREET_RANGE_M,
      headingDegrees: 0,
      pitchDegrees: STREET_PITCH_DEG,
      rectangle: null,
      points: [{ longitude: input.longitude, latitude: input.latitude }],
      sampleTerrain: true,
      reason: 'street/corridor context ~800–2000 m band',
      approximateBadge: true,
    }
  }

  const rectangle = framedRectangle(input.longitude, input.latitude, input.boundingBox)
  const heightMeters = input.altitudeMeters ?? placeHeightMeters(input.placeType, Boolean(input.boundingBox))
  return {
    kind: rectangle ? 'rectangle' : 'point',
    longitude: input.longitude,
    latitude: input.latitude,
    heightMeters: rectangle ? null : heightMeters,
    rangeMeters: null,
    headingDegrees: 0,
    pitchDegrees: -90,
    rectangle,
    points: [{ longitude: input.longitude, latitude: input.latitude }],
    sampleTerrain: false,
    reason: 'admin/place bbox framing',
    approximateBadge: matchClass === 'PLACE' || matchClass === 'AMBIGUOUS',
  }
}

export function framingToCinematicDestination(framing: LocationCameraFraming):
  | { kind: 'point'; longitude: number; latitude: number; heightMeters: number }
  | { kind: 'rectangle'; west: number; south: number; east: number; north: number }
  | {
    kind: 'boundingSphere'
    longitude: number
    latitude: number
    points: TerraLonLat[]
    rangeMeters: number
    headingDegrees: number
    pitchDegrees: number
  } {
  if (framing.kind === 'rectangle' && framing.rectangle) {
    return { kind: 'rectangle', ...framing.rectangle }
  }
  if (framing.kind === 'boundingSphere') {
    return {
      kind: 'boundingSphere',
      longitude: framing.longitude,
      latitude: framing.latitude,
      points: framing.points,
      rangeMeters: framing.rangeMeters ?? 220,
      headingDegrees: framing.headingDegrees,
      pitchDegrees: framing.pitchDegrees,
    }
  }
  return {
    kind: 'point',
    longitude: framing.longitude,
    latitude: framing.latitude,
    heightMeters: framing.heightMeters ?? 220,
  }
}

function bboxRing(
  box: { south: number; north: number; west: number; east: number } | null | undefined,
  point: { longitude: number; latitude: number },
): TerraLonLat[] {
  if (!box) return [{ longitude: point.longitude, latitude: point.latitude }]
  return [
    { longitude: box.west, latitude: box.south },
    { longitude: box.east, latitude: box.south },
    { longitude: box.east, latitude: box.north },
    { longitude: box.west, latitude: box.north },
  ]
}

function rangeFromRing(points: TerraLonLat[], margin: number, min: number, max: number): number {
  if (points.length < 2) return min
  const lats = points.map(p => p.latitude)
  const lons = points.map(p => p.longitude)
  const dLat = (Math.max(...lats) - Math.min(...lats)) * 111_320
  const dLon = (Math.max(...lons) - Math.min(...lons)) * 111_320 * Math.cos((points[0].latitude * Math.PI) / 180)
  return Math.min(max, Math.max(min, Math.hypot(dLat, dLon) * margin))
}
