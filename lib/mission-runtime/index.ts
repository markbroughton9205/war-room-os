/**
 * War Room Mission Runtime — public entrypoint (Phase 1: Engineering Mission only).
 *
 * This is intentionally thin. It exists so a caller (an API route today; potentially a second
 * mission kind's route later) resolves a strategy by kind rather than importing
 * SingleAgentEngineeringStrategy directly everywhere — the minimum indirection needed for the
 * "Execution Strategy interface" requirement without pre-building a registry more general than
 * one entry currently justifies.
 */
import { SingleAgentEngineeringStrategy } from './engineeringStrategy'
import type { MissionExecutionStrategy, RuntimeMissionKind } from './types'

export * from './types'
export { SingleAgentEngineeringStrategy } from './engineeringStrategy'

const STRATEGIES: { readonly engineering: MissionExecutionStrategy<import('./types').EngineeringMissionRequest> } = {
  engineering: SingleAgentEngineeringStrategy,
}

export function getMissionExecutionStrategy(kind: 'engineering'): typeof SingleAgentEngineeringStrategy
export function getMissionExecutionStrategy(kind: RuntimeMissionKind) {
  return STRATEGIES[kind]
}
