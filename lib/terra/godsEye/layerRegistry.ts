/**
 * ONE God's Eye layer registry — extends the existing coverage matrix.
 * Do not build a separate engine per feature. Terra/Cesium remains the runtime.
 */
import {
  GODS_EYE_COVERAGE_MATRIX,
  GODS_EYE_LAYER_GROUPS,
  type GodsEyeCoverageRow,
  type GodsEyeLayerGroup,
} from '../godsEyeCoverageMatrix'
import type { GodsEyeLayerTruthState } from './coverageStates'
import { RE_EARTH_BUILDINGS_STATUS, RE_EARTH_TERRAIN_STATUS } from './openStack'

export const GODS_EYE_REGISTRY_GROUPS = ['EARTH', 'URBAN', 'MOBILITY', 'STREET', 'INTELLIGENCE'] as const
export type GodsEyeRegistryGroup = (typeof GODS_EYE_REGISTRY_GROUPS)[number]

export type GodsEyeRegistryLayer = {
  id: string
  group: GodsEyeRegistryGroup
  label: string
  truthState: GodsEyeLayerTruthState
  evaluation: string
  streetLevel: boolean
  defaultOn: boolean
  catalogLayerIds: readonly string[]
  honesty: string
}

function truthFromRow(row: GodsEyeCoverageRow): GodsEyeLayerTruthState {
  if (row.coverageScope === 'NO_COVERAGE' || row.dataMode === 'UNAVAILABLE') return 'UNAVAILABLE'
  if (row.livePhase === 'AUTH_REQUIRED') return 'AUTH_REQUIRED'
  if (row.livePhase === 'NO_COVERAGE') return row.dataMode === 'STATIC' ? 'PARTIAL' : 'NO_COVERAGE'
  if (row.dataMode === 'LIVE') return 'LIVE'
  if (row.dataMode === 'CACHED') return 'CACHED'
  if (row.dataMode === 'STALE') return 'STALE'
  if (row.dataMode === 'PARTIAL' || row.coverageScope === 'PARTIAL' || row.coverageScope === 'REGIONAL' || row.coverageScope === 'LOCAL') {
    return 'PARTIAL'
  }
  if (row.dataMode === 'STATIC') return 'PARTIAL'
  return 'PARTIAL'
}

function registryGroupFromMatrix(group: GodsEyeLayerGroup): GodsEyeRegistryGroup | null {
  if (group === 'TIME') return null
  return group
}

const MATRIX_LAYERS: GodsEyeRegistryLayer[] = GODS_EYE_COVERAGE_MATRIX.flatMap(row => {
  const group = registryGroupFromMatrix(row.group)
  if (!group) return []
  return [{
    id: row.id,
    group,
    label: row.label,
    truthState: truthFromRow(row),
    evaluation: row.livePhase,
    streetLevel: row.streetLevel,
    defaultOn: row.id === 'terrain' || row.id === 'imagery' || row.id === 'buildings' || row.id === 'live_intel' || row.id === 'world_time',
    catalogLayerIds: row.catalogLayerIds,
    honesty: row.honesty,
  }]
})

const OPEN_STACK_LAYERS: readonly GodsEyeRegistryLayer[] = [
  {
    id: 're_earth_buildings',
    group: 'URBAN',
    label: 'Re:Earth Buildings',
    truthState: 'PARTIAL',
    evaluation: RE_EARTH_BUILDINGS_STATUS,
    streetLevel: true,
    defaultOn: false,
    catalogLayerIds: [],
    honesty: 'EVALUATION_ACTIVE. 3D Tiles from Overture/OSM. Not the global default. OSM Buildings stay installed.',
  },
  {
    id: 're_earth_terrain',
    group: 'EARTH',
    label: 'Re:Earth Terrain',
    truthState: 'PARTIAL',
    evaluation: RE_EARTH_TERRAIN_STATUS,
    streetLevel: false,
    defaultOn: false,
    catalogLayerIds: [],
    honesty: 'EVALUATION_ACTIVE. Cesium quantized-mesh. Cesium World Terrain remains the default.',
  },
  {
    id: 'live_signal_phase',
    group: 'MOBILITY',
    label: 'Live signal phase',
    truthState: 'NO_COVERAGE',
    evaluation: 'NO_COVERAGE',
    streetLevel: true,
    defaultOn: false,
    catalogLayerIds: [],
    honesty: 'SPaT/live phase remains NO_COVERAGE. OSM traffic-signal nodes are infrastructure only — never RED/YELLOW/GREEN.',
  },
  {
    id: 'rail_live',
    group: 'MOBILITY',
    label: 'Rail (live)',
    truthState: 'NO_COVERAGE',
    evaluation: 'NO_COVERAGE',
    streetLevel: false,
    defaultOn: false,
    catalogLayerIds: [],
    honesty: 'No live rail feed. OSM railway geometry is not planet-fetched. NO_COVERAGE.',
  },
]

export const GODS_EYE_LAYER_REGISTRY: readonly GodsEyeRegistryLayer[] = [
  ...MATRIX_LAYERS,
  ...OPEN_STACK_LAYERS,
]

export function godsEyeRegistryByGroup(group: GodsEyeRegistryGroup): GodsEyeRegistryLayer[] {
  return GODS_EYE_LAYER_REGISTRY.filter(layer => layer.group === group)
}

export function godsEyeRegistryLayer(id: string): GodsEyeRegistryLayer | null {
  return GODS_EYE_LAYER_REGISTRY.find(layer => layer.id === id) ?? null
}

export { GODS_EYE_LAYER_GROUPS }
