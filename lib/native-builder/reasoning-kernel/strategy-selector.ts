/**
 * Strategy selection. The maximum depth is not the default.
 */
import type { FoundryDepthSignals, FoundryReasoningStrategy } from './types'

export function selectStrategy(signals: FoundryDepthSignals): FoundryReasoningStrategy {
  if (signals.designTask) return 'ARCHITECTURE_COMPARISON'
  if (signals.symptomMayDifferFromCause) return 'ROOT_CAUSE'
  if (signals.ambiguity === 'high' || signals.uncertaintyCount >= 2) return 'HYPOTHESIS_COMPETITION'
  if (signals.separable && signals.componentCount > 1) return 'DECOMPOSE'
  if (signals.previousFailures >= 2) return 'REPAIR_LOOP'
  if (signals.securitySensitive || signals.regressionRisk === 'high') return 'COUNTEREXAMPLE_SEARCH'
  if (signals.wantsPlanSearch) return 'PLAN_SEARCH'
  if (signals.verificationFirst) return 'VERIFICATION_FIRST'
  return 'DIRECT'
}
