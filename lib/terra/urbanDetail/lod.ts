/**
 * Deterministic camera-altitude LOD for Terra urban geography.
 *
 * Thresholds MUST stay aligned with TERRA_SCALE_THRESHOLDS_M in
 * components/war-room/terra/useTerraCameraScale.ts (global 3_000_000, regional 200_000,
 * city 20_000, local 2_000). Vector urban data is off at global/regional altitude.
 */
import type { TerraUrbanBounds, TerraUrbanLod } from './types'

export const TERRA_URBAN_FLOOR_HEIGHT_M = 3

export const TERRA_URBAN_TILE_ZOOM: Record<TerraUrbanLod, number> = {
  city: 11,
  local: 13,
  building: 15,
}

/** Highway classes fetched at each LOD — closer zoom adds local streets, never the reverse. */
export const TERRA_URBAN_HIGHWAY_CLASSES: Record<TerraUrbanLod, readonly string[]> = {
  city: ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link'],
  local: ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link'],
  building: [
    'motorway', 'motorway_link', 'trunk', 'trunk_link',
    'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
    'residential', 'unclassified', 'living_street', 'service',
  ],
}

export const TERRA_URBAN_INCLUDE_BUILDINGS: Record<TerraUrbanLod, boolean> = {
  city: false,
  local: true,
  building: true,
}

export const TERRA_URBAN_INCLUDE_LABELS: Record<TerraUrbanLod, boolean> = {
  city: false,
  local: false,
  building: true,
}

export const TERRA_URBAN_OBJECT_CAPS: Record<TerraUrbanLod, { roads: number; buildings: number; labels: number }> = {
  city: { roads: 350, buildings: 0, labels: 0 },
  local: { roads: 450, buildings: 600, labels: 0 },
  building: { roads: 500, buildings: 900, labels: 60 },
}

/** Reject a viewport so wide that a fetch would mean "download a state." Degrees. */
export const TERRA_URBAN_MAX_SPAN_DEG: Record<TerraUrbanLod, number> = {
  city: 2.4,
  local: 0.55,
  building: 0.18,
}

const RESIDENTIAL_BUILDING_TYPES = new Set([
  'house',
  'detached',
  'semidetached_house',
  'terrace',
  'bungalow',
  'static_caravan',
  'cabin',
  'allotment_house',
  'residential',
  'apartments',
  'maisonette',
  'duplex',
  'farm',
])

export function isResidentialBuildingType(buildingType: string | null | undefined): boolean {
  if (!buildingType) return false
  return RESIDENTIAL_BUILDING_TYPES.has(buildingType)
}

export function isHouseBuildingType(buildingType: string | null | undefined): boolean {
  if (!buildingType) return false
  return buildingType === 'house'
    || buildingType === 'detached'
    || buildingType === 'semidetached_house'
    || buildingType === 'terrace'
    || buildingType === 'bungalow'
    || buildingType === 'residential'
}

export function urbanLodForScaleLevel(level: string): TerraUrbanLod | null {
  if (level === 'city' || level === 'local' || level === 'building') return level
  return null
}

export function urbanLodForHeightMeters(heightMeters: number): TerraUrbanLod | null {
  if (!Number.isFinite(heightMeters)) return null
  if (heightMeters >= 200_000) return null
  if (heightMeters >= 20_000) return 'city'
  if (heightMeters >= 2_000) return 'local'
  return 'building'
}

export function urbanViewportIsFetchable(bounds: TerraUrbanBounds, lod: TerraUrbanLod): boolean {
  const lonSpan = bounds.east - bounds.west
  const latSpan = bounds.north - bounds.south
  if (![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite)) return false
  if (lonSpan <= 0 || latSpan <= 0) return false
  const max = TERRA_URBAN_MAX_SPAN_DEG[lod]
  return lonSpan <= max && latSpan <= max
}

export function highwayWidthPx(highway: string): number {
  if (highway === 'motorway' || highway === 'motorway_link') return 4.5
  if (highway === 'trunk' || highway === 'trunk_link') return 4
  if (highway === 'primary' || highway === 'primary_link') return 3.2
  if (highway === 'secondary' || highway === 'secondary_link') return 2.6
  if (highway === 'tertiary' || highway === 'tertiary_link') return 2.2
  if (highway === 'residential' || highway === 'unclassified' || highway === 'living_street') return 1.8
  return 1.4
}
