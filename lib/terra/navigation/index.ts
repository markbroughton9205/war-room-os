/**
 * #22 Phase 9 — Terra Navigation Foundation public exports.
 * FUTURE_NAVIGATION_AGENT remains TARGET / unimplemented.
 */
export * from './types'
export * from './geometry'
export * from './location'
export * from './graph'
export * from './routing'
export * from './guidance'
export * from './ownership'
export * from './runtimeTruth'
export {
  runNavigationFoundation,
  type RunNavigationFoundationInput,
  type NavigationServiceResult,
  type NavigationServiceDenial,
} from './service'
