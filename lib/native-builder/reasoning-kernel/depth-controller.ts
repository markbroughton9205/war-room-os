/**
 * Reasoning depth is a compute and process level, not an intelligence score.
 */
import type { FoundryDepthSignals, FrkDepth } from './types'
import { FRK_DEPTHS } from './types'

export function selectDepth(signals: FoundryDepthSignals): FrkDepth {
  const deep = signals.ambiguity === 'high'
    && signals.componentCount >= 3
    && signals.blastRadius === 'cross-layer'
    && signals.previousFailures >= 2
    && signals.budgetAllowsDeepSearch
  if (deep) return 'R4'
  if (signals.securitySensitive || signals.regressionRisk === 'high' || signals.previousFailures >= 2) return 'R3'
  if (signals.ambiguity === 'high' || signals.uncertaintyCount >= 2 || signals.componentCount >= 3) return 'R2'
  if (signals.ambiguity === 'medium' || signals.regressionRisk === 'medium' || signals.componentCount > 1) return 'R1'
  return 'R0'
}

function rank(depth: FrkDepth): number {
  return FRK_DEPTHS.indexOf(depth)
}

function atLeast(current: FrkDepth, floor: FrkDepth): FrkDepth {
  return rank(current) >= rank(floor) ? current : floor
}

export function escalateDepth(
  current: FrkDepth,
  reason: 'check_failed' | 'contradiction' | 'repeated_repair' | 'multi_component',
  budgetAllowsDeepSearch: boolean,
): FrkDepth {
  if (reason === 'check_failed' && current === 'R0') return 'R1'
  if (reason === 'contradiction') return atLeast(current, 'R2')
  if (reason === 'repeated_repair') return atLeast(current, 'R3')
  if (reason === 'multi_component') return budgetAllowsDeepSearch ? atLeast(current, 'R4') : current
  return current
}

export function deescalateDepth(current: FrkDepth, uncertaintyCollapsed: boolean): FrkDepth {
  if (!uncertaintyCollapsed) return current
  if (current === 'R0' || current === 'R1') return current
  return 'R1'
}
