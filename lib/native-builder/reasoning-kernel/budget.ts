/**
 * Reasoning budget. Limits come from the Resource Governor defaults.
 * FRK does not raise them.
 */
import { FOUNDRY_RESOURCE_DEFAULT_LIMITS, type FoundryResourceActionKind } from '../foundryResourceGovernorTypes'
import type { FoundryReasoningResourceState, FrkChargeKindMap, FrkResourceCharge } from './types'
import { FRK_MAX_STEPS } from './types'

export const FRK_CHARGE_KIND: FrkChargeKindMap = {
  workerCalls: 'model',
  tokens: 'model',
  toolCalls: 'tool',
  tests: 'test',
  builds: 'build',
  replans: 'replan-l1',
  wallTimeMs: null,
  searchBranches: null,
}

export function createResourceState(overrides?: Partial<FoundryReasoningResourceState['limits']>): FoundryReasoningResourceState {
  return {
    workerCalls: 0,
    tokens: 0,
    toolCalls: 0,
    tests: 0,
    builds: 0,
    replans: 0,
    wallTimeMs: 0,
    searchBranches: 0,
    limits: {
      workerCalls: overrides?.workerCalls ?? FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxModelCalls,
      tokens: overrides?.tokens ?? FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxTotalTokens,
      toolCalls: overrides?.toolCalls ?? FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxToolCalls,
      tests: overrides?.tests ?? FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxTestRuns,
      builds: overrides?.builds ?? FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxBuildRuns,
      replans: overrides?.replans ?? FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxTaskReplans,
      wallTimeMs: overrides?.wallTimeMs ?? FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxWallClockMs,
      searchBranches: overrides?.searchBranches ?? 4,
      maxSteps: overrides?.maxSteps ?? FRK_MAX_STEPS,
    },
    automaticIncreaseRefused: 0,
  }
}

export function chargeResource(
  state: FoundryReasoningResourceState,
  charge: FrkResourceCharge,
  amount = 1,
): { ok: boolean; code: 'ALLOWED' | 'RESOURCE_BUDGET_EXHAUSTED'; governorKind: FoundryResourceActionKind | null } {
  const next = state[charge] + amount
  if (next > state.limits[charge]) {
    return { ok: false, code: 'RESOURCE_BUDGET_EXHAUSTED', governorKind: FRK_CHARGE_KIND[charge] }
  }
  state[charge] = next
  return { ok: true, code: 'ALLOWED', governorKind: FRK_CHARGE_KIND[charge] }
}

export function refuseBudgetIncrease(state: FoundryReasoningResourceState): { ok: false; code: 'AUTOMATIC_BUDGET_INCREASE_REFUSED' } {
  state.automaticIncreaseRefused += 1
  return { ok: false, code: 'AUTOMATIC_BUDGET_INCREASE_REFUSED' }
}

export function tightenSearchForDeepLevel(state: FoundryReasoningResourceState): void {
  state.limits.searchBranches = Math.min(state.limits.searchBranches, 4)
  state.limits.workerCalls = Math.min(state.limits.workerCalls, 8)
}
