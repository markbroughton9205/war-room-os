/**
 * Ownable DEM lane — open/ownable terrain beside Cesium World Terrain.
 *
 * Cesium World Terrain remains the active globe terrain by default. Re:Earth Terrain
 * is an evaluation switch only (see lib/terra/godsEye/reEarth.ts) and must not
 * silently replace this lane. This module does not substitute ellipsoid height, does not ingest rasters yet, and does not start
 * Planetary Source Fabric Wave 5. Coverage is reported honestly.
 */
export const TERRA_OWNABLE_DEM_PRODUCTS = [
  {
    id: 'cop30',
    name: 'Copernicus GLO-30 (COP30)',
    license: 'Copernicus DEM licence — free access with attribution; redistribution follows the published Copernicus terms.',
    licenseVerified: true,
    ingestAllowed: true,
    attribution: 'Contains modified Copernicus DEM data.',
    sourceUrl: 'https://spacedata.copernicus.eu/',
  },
  {
    id: 'nasadem',
    name: 'NASADEM',
    license: 'NASA Earth science data — US government public-domain distribution via Earthdata.',
    licenseVerified: true,
    ingestAllowed: true,
    attribution: 'NASADEM / NASA Earthdata.',
    sourceUrl: 'https://earthdata.nasa.gov/',
  },
  {
    id: 'srtm',
    name: 'SRTM',
    license: 'NASA/NGA SRTM — public-domain US government data for the released global product.',
    licenseVerified: true,
    ingestAllowed: true,
    attribution: 'NASA Shuttle Radar Topography Mission.',
    sourceUrl: 'https://www.earthdata.nasa.gov/sensors/srtm',
  },
  {
    id: 'opentopography',
    name: 'OpenTopography Global DEM API',
    license: 'OpenTopography API terms plus the licence of the selected DEM product (COP30 / NASADEM / SRTM / others). API key required. Bounded requests only.',
    licenseVerified: true,
    ingestAllowed: false,
    attribution: 'OpenTopography; underlying DEM licence as selected.',
    sourceUrl: 'https://portal.opentopography.org/apidocs/',
    ingestBlockedReason: 'OPENTOPOGRAPHY_API_KEY and a Commander-approved bounded ingest are required before storing tiles.',
  },
] as const

export type TerraOwnableDemProductId = (typeof TERRA_OWNABLE_DEM_PRODUCTS)[number]['id']

export const TERRA_DEM_COVERAGE_STATES = [
  'LIVE',
  'CACHED',
  'STALE',
  'PARTIAL',
  'NO_COVERAGE',
  'AUTH_REQUIRED',
  'UNAVAILABLE',
] as const
export type TerraDemCoverageState = (typeof TERRA_DEM_COVERAGE_STATES)[number]

export const TERRA_ACTIVE_GLOBE_TERRAIN = 'CESIUM_WORLD_TERRAIN' as const

export type TerraOwnableDemLaneState = {
  activeGlobeTerrain: typeof TERRA_ACTIVE_GLOBE_TERRAIN
  ownableLane: 'NOT_INGESTED'
  coverageState: TerraDemCoverageState
  products: typeof TERRA_OWNABLE_DEM_PRODUCTS
  fallback: 'CESIUM_WORLD_TERRAIN'
  silentlySubstitutesEllipsoid: false
  provenanceRequired: true
}

export function terraOwnableDemLaneState(): TerraOwnableDemLaneState {
  return {
    activeGlobeTerrain: TERRA_ACTIVE_GLOBE_TERRAIN,
    ownableLane: 'NOT_INGESTED',
    coverageState: 'NO_COVERAGE',
    products: TERRA_OWNABLE_DEM_PRODUCTS,
    fallback: 'CESIUM_WORLD_TERRAIN',
    silentlySubstitutesEllipsoid: false,
    provenanceRequired: true,
  }
}

export function demFallbackIsTruthful(state: TerraOwnableDemLaneState): boolean {
  return state.silentlySubstitutesEllipsoid === false
    && state.fallback === 'CESIUM_WORLD_TERRAIN'
    && state.activeGlobeTerrain === 'CESIUM_WORLD_TERRAIN'
    && state.coverageState === 'NO_COVERAGE'
}

export function ownableDemProductLicense(id: TerraOwnableDemProductId) {
  return TERRA_OWNABLE_DEM_PRODUCTS.find(product => product.id === id) ?? null
}
