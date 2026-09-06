import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { NEBULA_IDENTITY_BY_SEAT, type NebulaAgentId } from './identity'
import { isOrchestrationOnly } from './roleContracts'

/**
 * Council round flow foundation.
 *
 * RA'EL MESSAGE
 *   → create CouncilRound
 *   → ASTRA classifies intent (deterministic, no model call)
 *   → select minimum useful Nebula agents
 *   → independent execution through shared blackboard
 *   → persist each response
 *   → record failures in RoundHealth
 *   → AURORA final synthesis
 *   → evaluation events
 *
 * Live execution remains in app/api/chat/execute.ts + lib/council/live-orchestration.
 */

export const NEBULA_ROUND_FLOW = [
  'rael_message',
  'create_council_round',
  'classify_mission',
  'select_participating_agents',
  'independent_execution',
  'persist_responses',
  'record_round_health',
  'optional_verification',
  'aurora_final_synthesis',
  'evaluation_events',
  'possible_lesson_candidates',
] as const

export type NebulaRoundFlowStage = (typeof NEBULA_ROUND_FLOW)[number]

export type AstraIntent =
  | 'STATUS_CHECK'
  | 'ENGINEERING'
  | 'RESEARCH'
  | 'STRATEGY'
  | 'VERIFICATION'
  | 'HUMAN_IMPACT'
  | 'DECISION'
  | 'COMPREHENSIVE'
  | 'GENERAL'
  | 'SOCIAL'

/** Legacy complexity labels kept for existing callers/fixtures. */
export type MissionComplexity = 'social' | 'status' | 'standard' | 'research' | 'adversarial' | 'engineering' | 'constellation'

export type CouncilRoundPlan = {
  roundId: string
  commanderMessage: string
  intent: AstraIntent
  complexity: MissionComplexity
  participatingAgentIds: NebulaAgentId[]
  synthesizerAgentId: 'aurora'
  orchestratorAgentId: 'astra'
  verificationRequested: boolean
}

const ACTIVE_SEAT_AGENTS: NebulaAgentId[] = (Object.values(NEBULA_IDENTITY_BY_SEAT) as Array<NebulaAgentId | undefined>)
  .filter((id): id is NebulaAgentId => Boolean(id) && id !== 'astra')

const INTENT_PARTICIPANTS: Record<AstraIntent, readonly NebulaAgentId[]> = {
  STATUS_CHECK: ['orion', 'lumen', 'aurora'],
  ENGINEERING: ['orion', 'phoenix', 'lumen', 'aurora'],
  RESEARCH: ['pulsar', 'lumen', 'aurora'],
  STRATEGY: ['nova', 'phoenix', 'solara', 'aurora'],
  VERIFICATION: ['lumen', 'pulsar', 'aurora'],
  HUMAN_IMPACT: ['solara', 'nova', 'aurora'],
  DECISION: ['nova', 'phoenix', 'orion', 'aurora'],
  COMPREHENSIVE: ['nova', 'pulsar', 'phoenix', 'orion', 'lumen', 'solara', 'aurora'],
  GENERAL: ['orion', 'lumen', 'aurora'],
  SOCIAL: ['aurora'],
}

export function classifyAstraIntent(message: string): AstraIntent {
  const text = message.trim()
  if (!text) return 'GENERAL'
  if (/^\s*(hi|hello|hey|good\s+(morning|afternoon|evening)|checking in)\b/i.test(text) && text.length < 80) {
    return 'SOCIAL'
  }
  if (
    /(?:status\s+summary\s+of\s+(?:the\s+)?war\s*room|(?:war\s*room|runtime)\s+status|system\s+health|(?:give\s+me\s+(?:a\s+)?)?(?:short\s+)?status\s+summary)/i.test(text)
    || (/\b(status|health|who is (on|available)|runtime)\b/i.test(text) && /\b(war room|council|backend|model)\b/i.test(text))
  ) {
    return 'STATUS_CHECK'
  }
  if (/\b(architect|implement|interface|data model|typescript|runtime|engineer|code|build)\b/i.test(text)) return 'ENGINEERING'
  if (/\b(fail|risk|adversar|attack|recovery|challenge weak)\b/i.test(text) && /\b(research|evidence|source|verify|claim)\b/i.test(text)) {
    return 'COMPREHENSIVE'
  }
  if (/\b(fail|risk|adversar|attack|recovery)\b/i.test(text)) return 'DECISION'
  if (/\b(verify|verification|calibrat|trace|claim support)\b/i.test(text)) return 'VERIFICATION'
  if (/\b(research|evidence|source|signal)\b/i.test(text)) return 'RESEARCH'
  if (/\b(strategy|option|sequence|plan|roadmap)\b/i.test(text)) return 'STRATEGY'
  if (/\b(human|social|people|impact|usability|community)\b/i.test(text)) return 'HUMAN_IMPACT'
  if (/\b(constellation|temporary agent|specialist team|decompose this mission|comprehensive)\b/i.test(text)) return 'COMPREHENSIVE'
  if (/\b(decide|decision|recommend|should we)\b/i.test(text)) return 'DECISION'
  return 'GENERAL'
}

export function classifyMission(message: string): MissionComplexity {
  const intent = classifyAstraIntent(message)
  if (intent === 'SOCIAL') return 'social'
  if (intent === 'STATUS_CHECK') return 'status'
  if (intent === 'ENGINEERING') return 'engineering'
  if (intent === 'RESEARCH' || intent === 'VERIFICATION') return 'research'
  if (intent === 'DECISION' || intent === 'COMPREHENSIVE') return 'adversarial'
  if (intent === 'STRATEGY' || intent === 'HUMAN_IMPACT') return 'standard'
  return 'standard'
}

export function selectParticipatingNebulaAgents(complexity: MissionComplexity): NebulaAgentId[] {
  const intent =
    complexity === 'social' ? 'SOCIAL'
    : complexity === 'status' ? 'STATUS_CHECK'
    : complexity === 'engineering' ? 'ENGINEERING'
    : complexity === 'research' ? 'RESEARCH'
    : complexity === 'adversarial' ? 'DECISION'
    : complexity === 'constellation' ? 'COMPREHENSIVE'
    : 'GENERAL'
  return selectAgentsForIntent(intent)
}

export function selectAgentsForIntent(intent: AstraIntent): NebulaAgentId[] {
  return unique(INTENT_PARTICIPANTS[intent].filter(id => !isOrchestrationOnly(id)))
}

function unique(ids: readonly NebulaAgentId[]): NebulaAgentId[] {
  return [...new Set(ids)]
}

export function createCouncilRoundPlan(params: {
  roundId: string
  commanderMessage: string
}): CouncilRoundPlan {
  const intent = classifyAstraIntent(params.commanderMessage)
  const participating = selectAgentsForIntent(intent)
  return {
    roundId: params.roundId,
    commanderMessage: params.commanderMessage,
    intent,
    complexity: classifyMission(params.commanderMessage),
    participatingAgentIds: participating,
    synthesizerAgentId: 'aurora',
    orchestratorAgentId: 'astra',
    verificationRequested: intent === 'RESEARCH' || intent === 'VERIFICATION' || intent === 'COMPREHENSIVE',
  }
}

export function astraIsNotACouncilOpinionSeat(plan: CouncilRoundPlan): boolean {
  return !plan.participatingAgentIds.includes('astra') && plan.synthesizerAgentId === 'aurora'
}

export function seatsForParticipatingAgents(agentIds: readonly NebulaAgentId[]): CouncilOrchestrationFamily[] {
  const seats: CouncilOrchestrationFamily[] = []
  for (const [seat, agentId] of Object.entries(NEBULA_IDENTITY_BY_SEAT) as Array<[CouncilOrchestrationFamily, NebulaAgentId]> ) {
    if (agentIds.includes(agentId)) seats.push(seat)
  }
  return seats
}

export function participatingAgentsAreIndependentlyExecutable(plan: CouncilRoundPlan): boolean {
  const executable = plan.participatingAgentIds.filter(id => ACTIVE_SEAT_AGENTS.includes(id) || id === 'nova' || id === 'phoenix' || id === 'solara')
  return executable.length === plan.participatingAgentIds.length
    && plan.synthesizerAgentId === 'aurora'
    && !plan.participatingAgentIds.includes('astra')
}
