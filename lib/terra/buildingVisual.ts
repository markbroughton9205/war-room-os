/**
 * Terra building visual doctrine — imagery first.
 * Crude OSM/Overpass extrusion, Cesium OSM Buildings, and Re:Earth Buildings stay Commander opt-in.
 * Footprints + OSM ids remain pickable without 3D masses.
 */
export const TERRA_DEFAULT_BUILDING_MODE = 'IMAGERY_FIRST' as const
export const TERRA_CRUDE_EXTRUSION_DEFAULT = false
export const TERRA_ION_OSM_BUILDINGS_DEFAULT = false
export const TERRA_REEARTH_BUILDINGS_DEFAULT = false
export const TERRA_OSM_BUILDINGS_AUTOLOAD = false
export const TERRA_FOOTPRINT_PICKABILITY = true

export const TERRA_BUILDING_RENDER_PATHS = [
  'OSM_OVERPASS_FOOTPRINTS',
  'OSM_OVERPASS_CRUDE_EXTRUSION',
  'CESIUM_OSM_BUILDINGS',
  'REEARTH_BUILDINGS',
  'IMAGERY_ONLY',
] as const

export type TerraBuildingRenderPath = (typeof TERRA_BUILDING_RENDER_PATHS)[number]
