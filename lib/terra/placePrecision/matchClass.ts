/**
 * Canonical Terra place-precision model.
 * Precision is an evidence ceiling — a weaker source cannot be visually promoted.
 */

export const TERRA_PLACE_MATCH_CLASSES = [
  'ROOFTOP',
  'BUILDING',
  'PARCEL',
  'ADDRESS_POINT',
  'INTERPOLATED',
  'STREET',
  'PLACE',
  'AMBIGUOUS',
  'COORDINATE',
] as const

export type TerraPlaceMatchClass = (typeof TERRA_PLACE_MATCH_CLASSES)[number]

/** Higher number = more precise. Used only to decide whether Stage 2 may replace Stage 1. */
export const TERRA_PLACE_MATCH_CLASS_RANK: Record<TerraPlaceMatchClass, number> = {
  COORDINATE: 0,
  AMBIGUOUS: 1,
  PLACE: 2,
  STREET: 3,
  INTERPOLATED: 4,
  ADDRESS_POINT: 5,
  PARCEL: 6,
  BUILDING: 7,
  ROOFTOP: 8,
}

export const TERRA_PLACE_MATCH_CLASS_LABELS: Record<TerraPlaceMatchClass, string> = {
  ROOFTOP: 'ROOFTOP',
  BUILDING: 'BUILDING',
  PARCEL: 'PARCEL',
  ADDRESS_POINT: 'ADDRESS POINT',
  INTERPOLATED: 'INTERPOLATED — APPROXIMATE',
  STREET: 'STREET — APPROXIMATE',
  PLACE: 'PLACE',
  AMBIGUOUS: 'AMBIGUOUS — SELECT LOCATION',
  COORDINATE: 'COORDINATE',
}

export type TerraEnrichmentState =
  | 'idle'
  | 'pending'
  | 'refining'
  | 'refined'
  | 'unavailable'
  | 'no_coverage'
  | 'skipped'

export type TerraProviderHealth =
  | 'AVAILABLE'
  | 'AUTH_REQUIRED'
  | 'UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'NO_DATA'
  | 'NO_COVERAGE'

export type TerraGeometryKind = 'point' | 'polygon' | 'polyline' | 'bbox' | 'none'

export type TerraLonLat = { longitude: number; latitude: number }

export type TerraPlaceGeometry = {
  kind: TerraGeometryKind
  longitude: number
  latitude: number
  boundingBox?: { south: number; north: number; west: number; east: number } | null
  /** Closed or open ring in WGS84. Never averaged from multiple providers. */
  ring?: TerraLonLat[] | null
}

export type TerraPlacePrecision = {
  class: TerraPlaceMatchClass
  source: string
  provider: string
  providerPrecisionSignal: string | null
  confidence: number | null
  normalizedAddress: string | null
  coordinates: TerraLonLat
  geometry: TerraPlaceGeometry | null
  provenance: string
  enrichmentState: TerraEnrichmentState
  observedAt: string
}

export function matchClassLabel(value: TerraPlaceMatchClass | null | undefined): string {
  if (!value) return ''
  return TERRA_PLACE_MATCH_CLASS_LABELS[value]
}

export function matchClassRank(value: TerraPlaceMatchClass | null | undefined): number {
  if (!value) return -1
  return TERRA_PLACE_MATCH_CLASS_RANK[value]
}

/** True when next is strictly more precise than current. Never true for equal or weaker. */
export function precisionImproves(
  current: TerraPlaceMatchClass | null | undefined,
  next: TerraPlaceMatchClass | null | undefined,
): boolean {
  return matchClassRank(next) > matchClassRank(current)
}

export function isApproximateMatchClass(value: TerraPlaceMatchClass | null | undefined): boolean {
  return value === 'STREET' || value === 'INTERPOLATED' || value === 'PLACE' || value === 'AMBIGUOUS'
}
