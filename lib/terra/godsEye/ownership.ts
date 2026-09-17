/**
 * Precise ownership / license classes. Do not label OSM simply OWNABLE.
 */
export const GODS_EYE_OWNERSHIP_CLASSES = [
  'OWNED',
  'SELF_HOSTABLE',
  'STREAM_ONLY',
  'RESEARCH_ONLY',
  'LICENSE_RESTRICTED',
  'AUTH_REQUIRED',
  'PAID',
  'NONCOMMERCIAL',
] as const
export type GodsEyeOwnershipClass = (typeof GODS_EYE_OWNERSHIP_CLASSES)[number]

export type GodsEyeOwnershipRow = {
  id: string
  label: string
  ownership: GodsEyeOwnershipClass
  license: string
  notes: string
}

export const GODS_EYE_OWNERSHIP_MATRIX: readonly GodsEyeOwnershipRow[] = [
  {
    id: 'war_room_own_imagery',
    label: 'Commander-owned captures',
    ownership: 'OWNED',
    license: 'Commander copyright',
    notes: 'OWNED when ingested. Currently NO_COVERAGE.',
  },
  {
    id: 'osm_overpass',
    label: 'OSM / Overpass urban identity',
    ownership: 'SELF_HOSTABLE',
    license: 'ODbL-1.0',
    notes: 'SELF_HOSTABLE + share-alike. Not a possessable exclusive dataset.',
  },
  {
    id: 'overture',
    label: 'Overture identity',
    ownership: 'SELF_HOSTABLE',
    license: 'CDLA-Permissive-2.0 / OSM-derived ODbL',
    notes: 'Additive GERS/ids only when a feature carries them.',
  },
  {
    id: 'opentopography_dem',
    label: 'OpenTopography DEM',
    ownership: 'SELF_HOSTABLE',
    license: 'product-specific; verify before ingest',
    notes: 'NOT_INGESTED. No silent ellipsoid mountains.',
  },
  {
    id: 'reearth_selfhost',
    label: 'Re:Earth terrain/buildings (self-host)',
    ownership: 'SELF_HOSTABLE',
    license: 'ODbL-1.0 (buildings) / mixed terrain attribution',
    notes: 'EVALUATION_ACTIVE. Not the default globe.',
  },
  {
    id: 'panoramax',
    label: 'Panoramax',
    ownership: 'SELF_HOSTABLE',
    license: 'AGPL-3.0 server · contributor photo licenses',
    notes: 'LOCAL/REGIONAL. Not global Street View.',
  },
  {
    id: 'nasa_gibs',
    label: 'NASA GIBS True Color',
    ownership: 'SELF_HOSTABLE',
    license: 'NASA GIBS terms',
    notes: 'Public Earth imagery. Global photographic surface.',
  },
  {
    id: 'cesium_world_terrain',
    label: 'Cesium World Terrain',
    ownership: 'STREAM_ONLY',
    license: 'Cesium ion',
    notes: 'ion streaming. Default globe height.',
  },
  {
    id: 'ion_world_imagery',
    label: 'ion World Imagery',
    ownership: 'STREAM_ONLY',
    license: 'Cesium ion',
    notes: 'Close-range aerial stream.',
  },
  {
    id: 'cesium_osm_buildings',
    label: 'Cesium OSM Buildings',
    ownership: 'STREAM_ONLY',
    license: 'Cesium ion + OSM ODbL',
    notes: 'ion-hosted massing fallback.',
  },
  {
    id: 'mapillary_hosted',
    label: 'Mapillary hosted imagery',
    ownership: 'STREAM_ONLY',
    license: 'Mapillary contributor / provider terms',
    notes: 'Viewer MIT ≠ hosted imagery. AUTH_REQUIRED without token.',
  },
  {
    id: 'google_stream',
    label: 'Google Street View / Photorealistic',
    ownership: 'PAID',
    license: 'Google Maps Platform — visualization only',
    notes: 'Not wired. REFUSE scrape/cache/offline/ML.',
  },
  {
    id: 'mapillary_vistas',
    label: 'Mapillary Vistas',
    ownership: 'RESEARCH_ONLY',
    license: 'NONCOMMERCIAL research license',
    notes: 'Not bundled. Not a commercial runtime dependency.',
  },
]

export function ownershipRows(ownership: GodsEyeOwnershipClass): GodsEyeOwnershipRow[] {
  return GODS_EYE_OWNERSHIP_MATRIX.filter(row => row.ownership === ownership)
}

export function isResearchOnly(id: string): boolean {
  return GODS_EYE_OWNERSHIP_MATRIX.find(row => row.id === id)?.ownership === 'RESEARCH_ONLY'
}

export function osmIsNotSimplyOwnable(): boolean {
  const osm = GODS_EYE_OWNERSHIP_MATRIX.find(row => row.id === 'osm_overpass')
  return osm?.ownership === 'SELF_HOSTABLE' && osm.license.includes('ODbL')
}
