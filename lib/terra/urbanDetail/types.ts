/**
 * Terra automatic urban geography — shared types for OSM-derived roads, building
 * footprints, and extruded massing. This is the BASE WORLD layer, not intelligence.
 *
 * Height truth:
 *   SOURCE   — OSM `height` (or equivalent measured tag) was present and parsed
 *   INFERRED — extruded from `building:levels` or a conservative type default
 * Guessed heights are never presented as observed measurements.
 */

export const TERRA_URBAN_TILE_VERSION = 'v3' as const
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
  lanes: string | null
  maxspeed: string | null
  geometry: TerraUrbanCoordinate[]
}

/** OSM traffic-signal infrastructure — geometry only. Never a live RED/YELLOW/GREEN phase. */
export const TERRA_URBAN_SIGNAL_NODE_KINDS = ['intersection', 'signalized_crossing', 'traffic_light_node', 'pedestrian_signal'] as const
export type TerraUrbanSignalNodeKind = (typeof TERRA_URBAN_SIGNAL_NODE_KINDS)[number]

export const TERRA_SIGNAL_INFRASTRUCTURE_STATUS = 'STATIC INFRASTRUCTURE' as const
export const TERRA_LIVE_SIGNAL_PHASE = 'NO_COVERAGE' as const

export type TerraUrbanSignal = {
  id: string
  osmType: 'node'
  osmId: number
  nodeKind: TerraUrbanSignalNodeKind
  name: string | null
  direction: string | null
  longitude: number
  latitude: number
  status: typeof TERRA_SIGNAL_INFRASTRUCTURE_STATUS
  livePhase: typeof TERRA_LIVE_SIGNAL_PHASE
}

export type TerraUrbanBuilding = {
  id: string
  osmType: 'way' | 'relation'
  osmId: number
  buildingType: string
  name: string | null
  address: string | null
  houseNumber: string | null
  streetName: string | null
  entrance: string | null
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
  kind: 'street' | 'building' | 'house_number'
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
  signals: TerraUrbanSignal[]
  labels: TerraUrbanLabel[]
  diagnostics: {
    roads: TerraUrbanDiagnosticState
    buildings: TerraUrbanDiagnosticState
    signals: TerraUrbanDiagnosticState
    labels: TerraUrbanDiagnosticState
  }
  error: string | null
  rateLimited?: boolean
  retryAfterMs?: number | null
}

export type TerraUrbanSelection = {
  osmId: string
  osmType: 'way' | 'relation' | 'cesium_osm_buildings' | 'reearth_buildings'
  buildingType: string | null
  name: string | null
  address: string | null
  houseNumber: string | null
  streetName: string | null
  entrance: string | null
  overtureId: string | null
  gersId: string | null
  levels: number | null
  heightMeters: number | null
  heightSource: TerraUrbanHeightSource | null
  heightMethod: TerraUrbanHeightMethod | null
  footprint: TerraUrbanCoordinate[] | null
  longitude: number
  latitude: number
  provider: 'osm_overpass' | 'cesium_osm_buildings' | 'reearth_buildings'
}
