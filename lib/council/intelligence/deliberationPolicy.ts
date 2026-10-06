/**
 * Deliberation happens only where it adds value.
 * Do not hold a six-agent meeting for everything.
 */

import type { CognitiveStrategy, DeliberationPolicy } from './orchestrationTypes'

export function resolveDeliberationPolicy(strategy: CognitiveStrategy, text: string): DeliberationPolicy {
  if (strategy.id === 'DIRECT') return 'NONE'
  if (strategy.id === 'DATA_ANALYSIS' || strategy.id === 'DOCUMENT_ANALYSIS') return 'PAIR_CHECK'
  if (strategy.id === 'REVIEW' || strategy.id === 'DEBATE' || strategy.id === 'COMPARE' || strategy.id === 'DESIGN') return 'ADVERSARIAL'
  if (strategy.id === 'INCIDENT_RESPONSE') return 'ADVERSARIAL'
  if (/\bfull council\b/i.test(text)) return 'FULL_COUNCIL'
  return strategy.deliberation
}

export function fullCouncilForbiddenByDefault(policy: DeliberationPolicy, seatCount: number): boolean {
  return policy !== 'FULL_COUNCIL' && seatCount < 6
}
