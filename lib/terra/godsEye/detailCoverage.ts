/**
 * Honest terrain/building/address/pickability coverage.
 * Do not claim global detail if the provider is partial.
 */
import type { GodsEyeLayerTruthState } from './coverageStates'

export const GODS_EYE_DETAIL_COVERAGE_IDS = [
  'GLOBAL_TERRAIN_COVERAGE',
  'GLOBAL_BUILDING_COVERAGE',
  'STREET_LEVEL_BUILDING_DETAIL',
  'FEATURE_PICKABILITY',
  'ADDRESS_COVERAGE',
  'HOUSE_NUMBER_COVERAGE',
] as const
export type GodsEyeDetailCoverageId = (typeof GODS_EYE_DETAIL_COVERAGE_IDS)[number]

export type GodsEyeDetailCoverageRow = {
  id: GodsEyeDetailCoverageId
  state: GodsEyeLayerTruthState
  scope: string
  honesty: string
}

export const GODS_EYE_DETAIL_COVERAGE: readonly GodsEyeDetailCoverageRow[] = [
  {
    id: 'GLOBAL_TERRAIN_COVERAGE',
    state: 'LIVE',
    scope: 'GLOBAL / STREAM_ONLY',
    honesty: 'Cesium World Terrain when ion is configured. Ownable DEM is NOT_INGESTED. No silent ellipsoid mountains. Re:Earth Terrain is EVALUATION_ACTIVE and not default.',
  },
  {
    id: 'GLOBAL_BUILDING_COVERAGE',
    state: 'PARTIAL',
    scope: 'GLOBAL / PARTIAL DETAIL',
    honesty: 'OSM footprints follow OSM density, not a photoreal global city model. Cesium OSM Buildings is a STREAM_ONLY fallback. Re:Earth Buildings is EVALUATION_ACTIVE and not default.',
  },
  {
    id: 'STREET_LEVEL_BUILDING_DETAIL',
    state: 'PARTIAL',
    scope: 'NEIGHBORHOOD / STREET',
    honesty: 'Overpass extrusions at neighborhood/street LOD. Height is SOURCE or INFERRED. Footprint is not a blueprint. Hidden at planet/country.',
  },
  {
    id: 'FEATURE_PICKABILITY',
    state: 'LIVE',
    scope: 'CLICK → INFO',
    honesty: 'Map-mode pick works for building, road, signal, camera, event, aircraft, vessel, and ground. Street View is not required. Pixel-perfect facade identity is not claimed.',
  },
  {
    id: 'ADDRESS_COVERAGE',
    state: 'PARTIAL',
    scope: 'SOURCED OSM addr:*',
    honesty: 'Addresses exist only where OSM/Overture tags are present on that object. No competing address store. Missing tags stay unlabeled.',
  },
  {
    id: 'HOUSE_NUMBER_COVERAGE',
    state: 'PARTIAL',
    scope: 'STREET / SOURCED ONLY',
    honesty: 'Rendered only when addr:housenumber is present. Neighboring properties never fill a missing number.',
  },
]

export function godsEyeDetailCoverage(id: GodsEyeDetailCoverageId): GodsEyeDetailCoverageRow {
  return GODS_EYE_DETAIL_COVERAGE.find(row => row.id === id)!
}
