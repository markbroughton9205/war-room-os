/**
 * Mission budget governor. May limit optional work. Must not skip required authority/safety/verification.
 */

import { parseCommanderBudget } from './strategy'
import type { BudgetState, CognitiveStrategy, MissionBudget } from './orchestrationTypes'

export { parseCommanderBudget }

export function initBudget(text: string, strategy: CognitiveStrategy): BudgetState {
  let budget = parseCommanderBudget(text)
  if (strategy.id === 'DIRECT' && budget !== 'MAXIMUM') budget = 'FAST'
  if (strategy.id === 'RESEARCH' && budget === 'STANDARD' && /\bprimary sources\b/i.test(text)) budget = 'DEEP'
  return Object.freeze({
    budget,
    model_calls: 0,
    tool_calls: 0,
    browser_calls: 0,
    agent_turns: 0,
    latency_ms: 0,
    context_chars: 0,
    optional_work_skipped: budget === 'FAST' && strategy.adversarial_requirement === 'THRESHOLD' ? ['optional PHOENIX'] : [],
    safety_not_skipped: true,
  })
}

export function recordBudget(state: BudgetState, patch: Partial<Omit<BudgetState, 'safety_not_skipped' | 'budget'>>): BudgetState {
  return Object.freeze({
    ...state,
    ...patch,
    safety_not_skipped: true as const,
  })
}

export function budgetAllowsOptional(budget: MissionBudget, kind: 'phoenix' | 'janus' | 'atlas'): boolean {
  if (budget === 'FAST' && kind === 'phoenix') return false
  if (budget === 'FAST' && kind === 'janus') return false
  return true
}
