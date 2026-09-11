/**
 * Terra automatic urban geography — shared types for OSM-derived roads, building
 * footprints, and extruded massing. This is the BASE WORLD layer, not intelligence.
 *
 * Height truth:
 *   SOURCE   — OSM `height` (or equivalent measured tag) was present and parsed
 *   INFERRED — extruded from `building:levels` or a conservative type default
 * Guessed heights are never presented as observed measurements.
 */

export const TERRA_URBAN_TILE_VERSION = 'v1' as const
export const TERRA_URBAN_SOURCE = 'openstreetmap_overpass' as const
export const TERRA_URBAN_LICENSE = 'ODbL-1.0' as const
export const TERRA_URBAN_ATTRIBUTION = '© OpenStreetMap contributors'

export const TERRA_URBAN_DIAGNOSTIC_STATES = ['LIVE', 'CACHED', 'STALE', 'DEGRADED', 'RATE_LIMITED', 'UNAVAILABLE'] as const
export type TerraUrbanDiagnosticState = (typeof TERRA_URBAN_DIAGNOSTIC_STATES)[number]

/** Honest ellipsoid fallback copy — never imply mountains exist without a real DEM provider. */
export const TERRA_TERRAIN_REQUIRES_PROVIDER = 'REAL TERRAIN REQUIRES CONFIGURED TERRAIN PROVIDER'

export const TERRA_URBAN_HEIGHT_SOURCES = ['SOURCE', 'INFERRED'] as const
export type TerraUrbanHeightSource = (typeof TERRA_URBAN_HEIGHT_SOURCES)[number]

export const TERRA_URBAN_HEIGHT_METHODS = ['height_tag', 'building_levels', 'type_default'] as const
export type TerraUrbanHeightMethod = (typeof TERRA_URBAN_HEIGHT_METHODS)[number]

/** LOD bands that fetch urban vector data. Global/regional stay photographic-only. */
export const TERRA_URBAN_LODS = ['city', 'local', 'building'] as const
export type TerraUrbanLod = (typeof TERRA_URBAN_LODS)[number]

export type TerraUrbanBounds = {
  west: number
  south: number
  east: number
  north: number
}

export type TerraUrbanTileKey = {
  z: number
  x: number
  y: number
  lod: TerraUrbanLod
}

export type TerraUrbanCoordinate = {
  longitude: number
  latitude: number
}

export type TerraUrbanRoad = {
  id: string
  osmType: 'way' | 'relation'
  osmId: number
  highway: string
  name: string | null
  geometry: TerraUrbanCoordinate[]
}

export type TerraUrbanBuilding = {
  id: string
  osmType: 'way' | 'relation'
  osmId: number
  buildingType: string
  name: string | null
  address: string | null
  levels: number | null
  heightMeters: number
  heightSource: TerraUrbanHeightSource
  heightMethod: TerraUrbanHeightMethod
  footprint: TerraUrbanCoordinate[]
  longitude: number
  latitude: number
}

export type TerraUrbanLabel = {
  id: string
  osmId: number
  kind: 'street' | 'building'
  text: string
  longitude: number
  latitude: number
}

export type TerraUrbanTilePayload = {
  version: typeof TERRA_URBAN_TILE_VERSION
  source: typeof TERRA_URBAN_SOURCE
  license: typeof TERRA_URBAN_LICENSE
  attribution: typeof TERRA_URBAN_ATTRIBUTION
  key: TerraUrbanTileKey
  bounds: TerraUrbanBounds
  fetchedAt: string
  fromCache: boolean
  truncated: boolean
  roads: TerraUrbanRoad[]
  buildings: TerraUrbanBuilding[]
  labels: TerraUrbanLabel[]
  diagnostics: {
    roads: TerraUrbanDiagnosticState
    buildings: TerraUrbanDiagnosticState
    labels: TerraUrbanDiagnosticState
  }
  error: string | null
  rateLimited?: boolean
  retryAfterMs?: number | null
}

export type TerraUrbanSelection = {
  osmId: string
  osmType: 'way' | 'relation' | 'cesium_osm_buildings'
  buildingType: string | null
  name: string | null
  address: string | null
  levels: number | null
  heightMeters: number | null
  heightSource: TerraUrbanHeightSource | null
  heightMethod: TerraUrbanHeightMethod | null
  footprint: TerraUrbanCoordinate[] | null
  longitude: number
  latitude: number
}
