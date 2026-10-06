import type { ToolNeed } from './types'
import { matchPathRules, pickRuleWinner } from './pathClassifier.rules'

export type ToolNeedDecision = {
  need: ToolNeed
  use_tool: boolean
  reason: string
}

export function classifyToolNeed(text: string): ToolNeedDecision {
  const raw = typeof text === 'string' ? text.trim() : ''
  const winner = pickRuleWinner(matchPathRules(raw))
  if (winner?.tool_need && winner.tool_need !== 'NONE') {
    return { need: winner.tool_need, use_tool: true, reason: `${winner.id} requires ${winner.tool_need}` }
  }
  if (/screenshot|look at this image|what does this (?:screenshot|image) show/i.test(raw)) {
    return { need: 'VISION', use_tool: true, reason: 'Image understanding is not a browser fetch.' }
  }
  if (/^what is https?\??$/i.test(raw) || /what is photosynthesis/i.test(raw)) {
    return { need: 'NONE', use_tool: false, reason: 'General knowledge. No browser.' }
  }
  if (/2\s*\+\s*2/.test(raw)) {
    return { need: 'CALCULATOR', use_tool: true, reason: 'Closed-form arithmetic.' }
  }
  return { need: 'NONE', use_tool: false, reason: 'No live world state required.' }
}
