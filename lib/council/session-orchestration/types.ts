/**
 * Council session / turn / round / stage identity.
 * Session entity is existing `war_room_conversations.id` (UUID). No parallel session table.
 */

export const COUNCIL_MESSAGE_STAGES = [
  'COMMANDER',
  'OPENING',
  'RESPONSE',
  'DEBATE',
  'RED_TEAM',
  'REVISION',
  'SYNTHESIS',
  'RESEARCH_STATUS',
  'SYSTEM',
  'LEGACY',
  'UNKNOWN_STAGE',
] as const

export type CouncilMessageStage = (typeof COUNCIL_MESSAGE_STAGES)[number]

export const COUNCIL_TURN_INTENTS = [
  'GREETING',
  'STATUS_CHECK',
  'SOCIAL_CHECKIN',
  'KNOWLEDGE_QUESTION',
  'FRESHNESS_SENSITIVE',
  'TIME_SENSITIVE',
  'RESEARCH_REQUEST',
  'STRATEGIC_ANALYSIS',
  'DIRECTIVE',
  'FOLLOW_UP',
  'EXPLICIT_MEMORY',
] as const

export type CouncilTurnIntent = (typeof COUNCIL_TURN_INTENTS)[number]

export type CouncilOrchestrationDepth = 'FAST' | 'FULL'

export type CouncilContextLayerId =
  | 'current_turn'
  | 'session_history'
  | 'durable_memory'
  | 'council_working_state'
  | 'turn_evidence'
  | 'terra'
  | 'standing_instructions'

export type MemoryInfluenceDecision = {
  include: boolean
  reason: string
  memoryId: string
  layer: 'durable_memory' | 'standing_instructions'
}

export type AssembleInfluencePolicy = {
  depth: CouncilOrchestrationDepth
  intent: CouncilTurnIntent
  commanderText: string
  /** When false, skip global/project memory, open loops, world knowledge, and thread summaries. */
  allowDurableMemory: boolean
  /** When false, skip assembler recent_messages (caller already supplies bounded session history). */
  includeAssemblerRecentMessages: boolean
  includeProjectState: boolean
  includeTerra: boolean
}

export type ContextProvenanceTrace = {
  sessionId: string | null
  turnId: string
  intent: CouncilTurnIntent
  depth: CouncilOrchestrationDepth
  layersIncluded: CouncilContextLayerId[]
  durableMemoryInjected: boolean
  historicalSynthesisInjected: boolean
  profilePlanningContentInjected: boolean
  notes: string[]
}
