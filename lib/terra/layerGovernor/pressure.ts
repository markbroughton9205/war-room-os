import {
  GOVERNOR_HEAVY_BUDGET_NORMAL,
  GOVERNOR_HEAVY_BUDGET_PRESSURE,
  GOVERNOR_PRESSURE_FPS,
  GOVERNOR_RECOVERY_FPS,
  type ResourceState,
} from './types'

/** FPS from Cesium postRender is a measured signal. GPU util is not invented here. */
export function resolveResourceState(input: {
  fps: number | null
  previous?: ResourceState
}): ResourceState {
  if (input.fps == null) return input.previous === 'PRESSURE' || input.previous === 'RECOVERY' ? input.previous : 'NORMAL'
  if (input.fps < GOVERNOR_PRESSURE_FPS) return 'PRESSURE'
  if (input.previous === 'PRESSURE' && input.fps < GOVERNOR_RECOVERY_FPS) return 'PRESSURE'
  if (input.previous === 'PRESSURE' && input.fps >= GOVERNOR_RECOVERY_FPS) return 'RECOVERY'
  if (input.previous === 'RECOVERY' && input.fps >= GOVERNOR_RECOVERY_FPS) return 'NORMAL'
  return 'NORMAL'
}

export function heavyLayerBudget(resource: ResourceState): number {
  return resource === 'PRESSURE' ? GOVERNOR_HEAVY_BUDGET_PRESSURE : GOVERNOR_HEAVY_BUDGET_NORMAL
}
