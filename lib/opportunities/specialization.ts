import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { familyRequiresOpportunity } from '@/lib/opportunities/schema'

const FAMILY_FOCUS: Partial<Record<CouncilOrchestrationFamily, string>> = {
  chatgpt:
    'Practical synthesis: monetizable plays a solo operator can validate in days, with clear first steps and realistic economics.',
  claude:
    'Systems and business infrastructure: durable workflows, invariants, rollback paths, and operational scaffolding.',
  grok:
    'Realtime asymmetry and radar: timing edges, signal gaps competitors miss, and volatility-aware entry windows.',
  gemini:
    'Cross-reference validation: compare patterns across sources, flag contradictions, and stress-test feasibility.',
  red_team:
    'Execution risk: failure modes, hidden costs, compliance traps, and what would kill the play in the first 30 days.',
}

export const OPPORTUNITY_JSON_BLOCK_INSTRUCTION = [
  '### Mandatory actionable opportunities (Phase 32B)',
  'You MUST end your response with a fenced JSON block tagged `actionable_opportunities` containing at least one concrete opportunity.',
  'Do NOT stop at meta-analysis, uncertainty disclaimers, or "need more data" without also supplying at least one candidate opportunity.',
  'Each opportunity object MUST include: opportunityTitle, startupCost, estimatedRevenue, timeToLaunch, toolsRequired (array), targetCustomer, executionDifficulty, confidence (0-100), risks (array), whyNow.',
  'If live signals are unavailable in the prompt, base opportunities on historical/general patterns and set evidenceNote to HISTORICAL_PATTERN_BASED inside each object; never claim VERIFIED live backing without evidence.',
  'Commander approval is required before execution — opportunities are proposals only.',
  'Example shape:',
  '```json actionable_opportunities',
  '{"opportunities":[{"opportunityTitle":"…","startupCost":"$200","estimatedRevenue":"$1,200/mo","timeToLaunch":"7 days","toolsRequired":["…"],"targetCustomer":"…","executionDifficulty":"medium","confidence":62,"risks":["…"],"whyNow":"…","evidenceNote":"HISTORICAL_PATTERN_BASED"}]}',
  '```',
].join('\n')

export function opportunityPromptAddendum(family: CouncilOrchestrationFamily): string {
  if (!familyRequiresOpportunity(family)) return ''
  const focus = FAMILY_FOCUS[family] ?? 'Actionable scoped opportunity with explicit economics and execution path.'
  return [`Family opportunity focus: ${focus}`, OPPORTUNITY_JSON_BLOCK_INSTRUCTION].join('\n\n')
}

export function appendOpportunityMandateToSystem(system: string, family: CouncilOrchestrationFamily): string {
  const addendum = opportunityPromptAddendum(family)
  if (!addendum) return system
  return `${system}\n\n${addendum}`
}

export function buildOpportunityRetryPrompt(basePrompt: string): string {
  return [
    basePrompt,
    '',
    'RETRY — prior response failed opportunity integrity.',
    'You must include the actionable_opportunities JSON block with at least one complete opportunity object.',
    'No vague-only answer: if uncertain, still propose one clearly labeled historical-pattern candidate.',
  ].join('\n')
}
