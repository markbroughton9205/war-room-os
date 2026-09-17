/**
 * Official Re:Earth Buildings + Terrain evaluation adapters.
 *
 * Additive only. Cesium World Terrain and Cesium OSM Buildings remain the default globe stack.
 * These providers load behind an evaluation switch and are never the global default this pass.
 *
 * Licenses (from the live tileset/layer documents, 2026-09-16):
 *   Buildings — ODbL: OpenStreetMap contributors + Overture Maps Foundation.
 *   Terrain — Re:Earth Terrain, Mapterhorn, EGM2008 (NGA), Protomaps, OpenStreetMap.
 */
import { RE_EARTH_BUILDINGS_STATUS, RE_EARTH_TERRAIN_STATUS } from './openStack'

export const RE_EARTH_BUILDINGS_TILESET_URL = 'https://buildings.reearth.land/tileset.json'
export const RE_EARTH_BUILDINGS_SOURCE_URL = 'https://buildings.reearth.land/'
export const RE_EARTH_BUILDINGS_REPO_URL = 'https://github.com/reearth/reearth-buildings'
export const RE_EARTH_TERRAIN_PROVIDER_URL = 'https://terrain.reearth.land/cesium-mesh/ellipsoid'
export const RE_EARTH_TERRAIN_SOURCE_URL = 'https://terrain.reearth.land/'
export const RE_EARTH_TERRAIN_REPO_URL = 'https://github.com/reearth/reearth-terrain'

export const TERRA_TERRAIN_PROVIDER_CHOICES = [
  'CESIUM_WORLD_TERRAIN',
  'RE_EARTH_TERRAIN',
  'OWNABLE_DEM_FUTURE',
] as const
export type TerraTerrainProviderChoice = (typeof TERRA_TERRAIN_PROVIDER_CHOICES)[number]

export const TERRA_BUILDING_PROVIDER_CHOICES = [
  'OSM_OVERPASS',
  'CESIUM_OSM_BUILDINGS',
  'RE_EARTH_BUILDINGS',
] as const
export type TerraBuildingProviderChoice = (typeof TERRA_BUILDING_PROVIDER_CHOICES)[number]

/** Default globe terrain — do not change this to Re:Earth this pass. */
export const TERRA_DEFAULT_TERRAIN_PROVIDER: TerraTerrainProviderChoice = 'CESIUM_WORLD_TERRAIN'
/** Default buildings — OSM Overpass identities/footprints; crude extrusion is off unless Commander enables it. */
export const TERRA_DEFAULT_BUILDING_PROVIDER: TerraBuildingProviderChoice = 'OSM_OVERPASS'

export const RE_EARTH_BUILDINGS_LICENSE = 'ODbL-1.0'
export const RE_EARTH_BUILDINGS_ATTRIBUTION =
  'Re:Earth Buildings — Buildings © OpenStreetMap contributors, Overture Maps Foundation (ODbL) · Terrain by Re:Earth Terrain (Mapterhorn / EGM2008)'
export const RE_EARTH_TERRAIN_ATTRIBUTION =
  'Re:Earth Terrain, Mapterhorn, EGM2008 (NGA), Protomaps, OpenStreetMap'

export type ReEarthEvaluationSnapshot = {
  buildings: {
    status: typeof RE_EARTH_BUILDINGS_STATUS
    defaultOn: false
    tilesetUrl: typeof RE_EARTH_BUILDINGS_TILESET_URL
    license: typeof RE_EARTH_BUILDINGS_LICENSE
    attribution: typeof RE_EARTH_BUILDINGS_ATTRIBUTION
    sourceUrl: typeof RE_EARTH_BUILDINGS_SOURCE_URL
    removesOsmBuildings: false
    tilesetFormat: '3D_TILES_1.1'
    identitySource: 'OVERTURE_PLUS_OSM'
    coverageHonesty: string
  }
  terrain: {
    status: typeof RE_EARTH_TERRAIN_STATUS
    defaultOn: false
    providerUrl: typeof RE_EARTH_TERRAIN_PROVIDER_URL
    format: 'quantized-mesh-1.0'
    projection: 'EPSG:4326'
    minzoom: 0
    maxzoom: 14
    attribution: typeof RE_EARTH_TERRAIN_ATTRIBUTION
    sourceUrl: typeof RE_EARTH_TERRAIN_SOURCE_URL
    replacesCesiumWorldTerrain: false
    coverageHonesty: string
  }
}

export function reEarthEvaluationSnapshot(): ReEarthEvaluationSnapshot {
  return {
    buildings: {
      status: RE_EARTH_BUILDINGS_STATUS,
      defaultOn: false,
      tilesetUrl: RE_EARTH_BUILDINGS_TILESET_URL,
      license: RE_EARTH_BUILDINGS_LICENSE,
      attribution: RE_EARTH_BUILDINGS_ATTRIBUTION,
      sourceUrl: RE_EARTH_BUILDINGS_SOURCE_URL,
      removesOsmBuildings: false,
      tilesetFormat: '3D_TILES_1.1',
      identitySource: 'OVERTURE_PLUS_OSM',
      coverageHonesty:
        'Global 3D Tiles generated from Overture footprints. Not the default Terra building layer. OSM Overpass identities stay installed; crude extrusion and Cesium OSM Buildings stay opt-in, not auto-on.',
    },
    terrain: {
      status: RE_EARTH_TERRAIN_STATUS,
      defaultOn: false,
      providerUrl: RE_EARTH_TERRAIN_PROVIDER_URL,
      format: 'quantized-mesh-1.0',
      projection: 'EPSG:4326',
      minzoom: 0,
      maxzoom: 14,
      attribution: RE_EARTH_TERRAIN_ATTRIBUTION,
      sourceUrl: RE_EARTH_TERRAIN_SOURCE_URL,
      replacesCesiumWorldTerrain: false,
      coverageHonesty:
        'Cesium-compatible quantized-mesh. Evaluation switch only. Cesium World Terrain remains the default globe terrain. Self-hostable DEM stays NOT_INGESTED.',
    },
  }
}

export function isDefaultTerrainProvider(choice: TerraTerrainProviderChoice): boolean {
  return choice === TERRA_DEFAULT_TERRAIN_PROVIDER
}

export function isDefaultBuildingProvider(choice: TerraBuildingProviderChoice): boolean {
  return choice === TERRA_DEFAULT_BUILDING_PROVIDER
}
