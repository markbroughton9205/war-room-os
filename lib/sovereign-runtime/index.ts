/**
 * #22 Phase 10 — Sovereign runtime public exports.
 */
export * from './constants'
export * from './dependenceInventory'
export * from './runtimeTruth'
export * from './boot'
export * from './session'
export * from './desktopSecurity'
export {
  startLocalCoreServer,
  buildLocalHealth,
  simulateDomainUnavailable,
  simulateTunnelUnavailable,
  simulateInternetUnavailable,
  type LocalCoreServerOptions,
  type LocalCoreHandle,
} from './localCoreServer'
