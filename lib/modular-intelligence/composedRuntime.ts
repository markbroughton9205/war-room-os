import { WRIM0_CHECKPOINT_SHA, WRIM0_ID, type ActiveRuntimeState } from './types'

export function composedRuntimeId(coreId: string, moduleIds: string[]): string {
  const mods = [...moduleIds].sort().join(',')
  return mods.length === 0 ? `composed:${coreId}+[]` : `composed:${coreId}+[${mods}]`
}

export function officialActiveCore(): ActiveRuntimeState {
  return {
    kind: 'CORE',
    activeCoreId: WRIM0_ID,
    activeCoreCheckpointSha: WRIM0_CHECKPOINT_SHA,
    activeModuleIds: [],
    composedRuntimeId: composedRuntimeId(WRIM0_ID, []),
  }
}

export function composeRuntime(core: ActiveRuntimeState, moduleId: string): ActiveRuntimeState {
  if (core.activeModuleIds.includes(moduleId)) return core
  const modules = [...core.activeModuleIds, moduleId]
  return {
    kind: 'COMPOSED_RUNTIME',
    activeCoreId: core.activeCoreId,
    activeCoreCheckpointSha: core.activeCoreCheckpointSha,
    activeModuleIds: modules,
    composedRuntimeId: composedRuntimeId(core.activeCoreId, modules),
  }
}

export function stripModule(core: ActiveRuntimeState, moduleId: string): ActiveRuntimeState {
  const modules = core.activeModuleIds.filter((id) => id !== moduleId)
  return {
    kind: modules.length ? 'COMPOSED_RUNTIME' : 'CORE',
    activeCoreId: core.activeCoreId,
    activeCoreCheckpointSha: core.activeCoreCheckpointSha,
    activeModuleIds: modules,
    composedRuntimeId: composedRuntimeId(core.activeCoreId, modules),
  }
}
