import type { CouncilPath, ReasoningBudget } from './types'
import { classifyReasoningBudget } from './pathClassifier.rules'

export type BudgetPolicy = {
  budget: ReasoningBudget
  path_bias: CouncilPath | null
  max_seats: number
  phoenix: boolean
  reason: string
}

export function resolveReasoningBudget(text: string, path: CouncilPath): BudgetPolicy {
  const budget = classifyReasoningBudget(text)
  if (budget === 'FAST') {
    return {
      budget,
      path_bias: path === 'HANDOFF' ? 'HANDOFF' : path === 'AGENT_PATH' && /status|incident|broke|ram .{0,20}right now/i.test(text) ? 'AGENT_PATH' : 'SHORT_PATH',
      max_seats: path === 'AGENT_PATH' ? 4 : 0,
      phoenix: false,
      reason: 'Commander asked for a quick/brief answer.',
    }
  }
  if (budget === 'DEEP') {
    return {
      budget,
      path_bias: path === 'HANDOFF' ? 'HANDOFF' : 'AGENT_PATH',
      max_seats: 5,
      phoenix: true,
      reason: 'Commander asked for thorough/deep work.',
    }
  }
  return {
    budget: 'STANDARD',
    path_bias: null,
    max_seats: path === 'SHORT_PATH' ? 0 : 4,
    phoenix: path === 'AGENT_PATH',
    reason: 'Default bounded budget.',
  }
}
