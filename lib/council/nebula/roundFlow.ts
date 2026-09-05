import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { NEBULA_IDENTITY_BY_SEAT, type NebulaAgentId } from './identity'
import { isOrchestrationOnly } from './roleContracts'

/**
 * Council round flow foundation.
 *
 * RA'EL MESSAGE
 *   → create CouncilRound
 *   → classify mission
 *   → select participating Nebula agents
 *   → independent execution
 *   → persist each response
 *   → record failures in RoundHealth
 *   → optional verification / follow-up
 *   → AURORA final synthesis
 *   → evaluation events
 *   → possible lesson candidates
 *
 * This is the round architecture, not a second live orchestrator. Live execution
 * remains in app/api/chat/execute.ts + lib/council/live-orchestration.
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

export type MissionComplexity = 'social' | 'status' | 'standard' | 'research' | 'adversarial' | 'engineering' | 'constellation'

export type CouncilRoundPlan = {
  roundId: string
  commanderMessage: string
  complexity: MissionComplexity
  participatingAgentIds: NebulaAgentId[]
  synthesizerAgentId: 'aurora'
  orchestratorAgentId: 'astra' | null
  verificationRequested: boolean
}

const ACTIVE_SEAT_AGENTS: NebulaAgentId[] = (Object.values(NEBULA_IDENTITY_BY_SEAT) as Array<NebulaAgentId | undefined>)
  .filter((id): id is NebulaAgentId => Boolean(id) && id !== 'astra')

export function classifyMission(message: string): MissionComplexity {
  const text = message.trim()
  if (!text) return 'standard'
  if (/^\s*(hi|hello|hey|good\s+(morning|afternoon|evening)|checking in)\b/i.test(text) && text.length < 80) {
    return 'social'
  }
  if (/\b(status|health|who is (on|available)|runtime)\b/i.test(text) && /\b(war room|council|backend|model)\b/i.test(text)) {
    return 'status'
  }
  if (/\b(architect|implement|interface|data model|typescript|runtime)\b/i.test(text)) return 'engineering'
  if (/\b(fail|risk|adversar|attack|recovery)\b/i.test(text)) return 'adversarial'
  if (/\b(research|evidence|source|verify|claim|signal)\b/i.test(text)) return 'research'
  if (/\b(constellation|temporary agent|specialist team|decompose this mission)\b/i.test(text)) return 'constellation'
  return 'standard'
}

export function selectParticipatingNebulaAgents(complexity: MissionComplexity): NebulaAgentId[] {
  const core: NebulaAgentId[] = ['aurora', 'orion', 'pulsar', 'lumen']
  if (complexity === 'social' || complexity === 'status') return ['aurora', 'orion', 'pulsar', 'lumen']
  if (complexity === 'engineering') return unique([...core, 'nova', 'phoenix'])
  if (complexity === 'adversarial') return unique([...core, 'phoenix', 'nova'])
  if (complexity === 'research') return unique([...core, 'nova', 'phoenix'])
  if (complexity === 'constellation') return unique([...core, 'nova', 'phoenix'])
  return unique([...core, 'nova'])
}

function unique(ids: NebulaAgentId[]): NebulaAgentId[] {
  return [...new Set(ids)]
}

export function createCouncilRoundPlan(params: {
  roundId: string
  commanderMessage: string
}): CouncilRoundPlan {
  const complexity = classifyMission(params.commanderMessage)
  const participating = selectParticipatingNebulaAgents(complexity).filter(id => !isOrchestrationOnly(id))
  return {
    roundId: params.roundId,
    commanderMessage: params.commanderMessage,
    complexity,
    participatingAgentIds: participating,
    synthesizerAgentId: 'aurora',
    orchestratorAgentId: complexity === 'constellation' ? 'astra' : null,
    verificationRequested: complexity === 'research' || complexity === 'adversarial',
  }
}

export function astraIsNotACouncilOpinionSeat(plan: CouncilRoundPlan): boolean {
  return !plan.participatingAgentIds.includes('astra') && plan.synthesizerAgentId === 'aurora'
}

export function seatsForParticipatingAgents(agentIds: readonly NebulaAgentId[]): CouncilOrchestrationFamily[] {
  const seats: CouncilOrchestrationFamily[] = []
  for (const [seat, agentId] of Object.entries(NEBULA_IDENTITY_BY_SEAT) as Array<[CouncilOrchestrationFamily, NebulaAgentId]>) {
    if (agentIds.includes(agentId)) seats.push(seat)
  }
  return seats
}

export function participatingAgentsAreIndependentlyExecutable(plan: CouncilRoundPlan): boolean {
  return plan.participatingAgentIds.every(id => ACTIVE_SEAT_AGENTS.includes(id) || id === 'nova' || id === 'phoenix')
    && plan.synthesizerAgentId === 'aurora'
    && !plan.participatingAgentIds.includes('astra')
}
