import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilTurnIntent } from '@/lib/council/session-orchestration/types'

export const COUNCIL_ROUND_PHASES = [
  'ROUND_CREATED',
  'CLASSIFYING',
  'RESEARCHING',
  'EVIDENCE_READY',
  'DELIBERATING',
  'RED_TEAM',
  'REVISION',
  'SYNTHESIS',
  'COMPLETE',
  'FAILED',
] as const

export type CouncilRoundPhase = (typeof COUNCIL_ROUND_PHASES)[number]

export const COUNCIL_PARTICIPANT_STATES = [
  'PENDING',
  'WAITING',
  'FLOOR_GRANTED',
  'CONNECTING',
  'STREAMING',
  'COMPLETE',
  'FAILED',
  'SKIPPED',
  'RETRYING',
  'PARTIAL',
] as const

export type CouncilParticipantState = (typeof COUNCIL_PARTICIPANT_STATES)[number]

export const COUNCIL_FAILURE_LAYERS = [
  'AUTH',
  'BILLING',
  'REQUEST',
  'PROVIDER',
  'RATE_LIMIT',
  'TRANSPORT',
  'STREAM_PARSER',
  'TIMEOUT',
  'ORCHESTRATOR',
  'PERSISTENCE',
  'UI',
  'DEPENDENCY',
  'UNKNOWN',
] as const

export type CouncilFailureLayer = (typeof COUNCIL_FAILURE_LAYERS)[number]

export const WAR_ROOM_STREAM_SEMANTICS = [
  'MESSAGE_STARTED',
  'TEXT_DELTA',
  'MESSAGE_COMPLETED',
  'MESSAGE_FAILED',
  'USAGE',
  'TOOL_EVENT',
] as const

export type WarRoomStreamSemantic = (typeof WAR_ROOM_STREAM_SEMANTICS)[number]

export type WarRoomStreamEvent = {
  semantic: WarRoomStreamSemantic
  family: CouncilOrchestrationFamily
  roundId: string
  messageId: string
  attemptId: string
  stage: string
  text?: string
  status?: CouncilParticipantState
  failureLayer?: CouncilFailureLayer
  failureReason?: string
  at: string
}

export const DEFAULT_VISIBLE_FLOOR_ORDER: CouncilOrchestrationFamily[] = [
  'chatgpt',
  'claude',
  'grok',
  'gemini',
  'red_team',
]

export type LiveRoundIntentLane =
  | 'SOCIAL_CHECKIN'
  | 'NORMAL_COUNCIL'
  | 'FRESHNESS_SENSITIVE'
  | 'RESEARCH_REQUEST'
  | 'STRATEGIC_DELIBERATION'
  | 'FOLLOW_UP'
  | 'DIRECTIVE'

export function intentLaneFromTurnIntent(intent: CouncilTurnIntent): LiveRoundIntentLane {
  if (intent === 'GREETING' || intent === 'STATUS_CHECK' || intent === 'SOCIAL_CHECKIN') return 'SOCIAL_CHECKIN'
  if (intent === 'FRESHNESS_SENSITIVE' || intent === 'TIME_SENSITIVE') return 'FRESHNESS_SENSITIVE'
  if (intent === 'RESEARCH_REQUEST') return 'RESEARCH_REQUEST'
  if (intent === 'STRATEGIC_ANALYSIS') return 'STRATEGIC_DELIBERATION'
  if (intent === 'FOLLOW_UP') return 'FOLLOW_UP'
  if (intent === 'DIRECTIVE') return 'DIRECTIVE'
  return 'NORMAL_COUNCIL'
}
