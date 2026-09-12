/**
 * #22 Phase 10/11A/11B — Sovereign runtime public exports.
 */
export * from './constants'
export * from './dependenceInventory'
export * from './runtimeTruth'
export * from './boot'
export * from './session'
export * from './desktopSecurity'
export * from './uiAudit'
export * from './local-model'
export * from './local-ownership'
export {
  startLocalCoreServer,
  buildLocalHealth,
  simulateDomainUnavailable,
  simulateTunnelUnavailable,
  simulateInternetUnavailable,
  type LocalCoreServerOptions,
  type LocalCoreHandle,
} from './localCoreServer'
export {
  ensureLocalWarRoomUi,
  probeLocalWarRoomUi,
  assertLocalNextArtifacts,
  desktopShutdownUiPlan,
  type LocalUiHandle,
} from './localUiRuntime'
