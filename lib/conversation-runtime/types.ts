import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilCompressedSummary } from '@/lib/council/compression'
import type { ProviderFamilyConversationState } from '@/lib/provider-state/types'

export const CONVERSATION_TURN_TYPES = [
  'commander_message',
  'provider_response',
  'provider_challenge',
  'follow_up',
  'synthesis_update',
] as const

export type ConversationTurnType = (typeof CONVERSATION_TURN_TYPES)[number]

export type ConversationTurnRecord = {
  id: string
  type: ConversationTurnType
  at: string
  family?: CouncilOrchestrationFamily
  messageId?: string
  preview: string
}

export type CouncilConversationRuntime = {
  v: typeof import('./config').CONVERSATION_RUNTIME_VERSION
  sessionId: string
  threadId: string | null
  activeTopic: string
  lastActivityAt: number
  turnCount: number
  burstTurnCount: number
  lastContinuationAt: number | null
  idleExpired: boolean
  turns: ConversationTurnRecord[]
  rollingSummary: string | null
  compressedSnapshot: CouncilCompressedSummary | null
  providerStates: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyConversationState>>
  unresolvedInvestigations: string[]
  contradictionMap: Record<string, string[]>
  latestSynthesis: string | null
  councilMomentum: 'rising' | 'stable' | 'decaying' | 'idle'
  humanAuthorityNote: string
}

export type ConversationRuntimeSnapshot = Pick<
  CouncilConversationRuntime,
  | 'sessionId'
  | 'threadId'
  | 'activeTopic'
  | 'lastActivityAt'
  | 'turnCount'
  | 'unresolvedInvestigations'
  | 'contradictionMap'
  | 'latestSynthesis'
  | 'councilMomentum'
  | 'providerStates'
  | 'rollingSummary'
  | 'idleExpired'
>
