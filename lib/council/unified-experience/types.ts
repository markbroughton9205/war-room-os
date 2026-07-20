import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export type CommanderOperationRequestKind =
  | 'decree'
  | 'question'
  | 'status_check'
  | 'research'
  | 'project'
  | 'approval_review'
  | 'troubleshooting'
  | 'direct_invocation'
  | 'council_mission'
  | 'unknown'

export type CommanderOperationMode =
  | 'direct'
  | 'stable_group'
  | 'full_council'
  | 'adaptive'
  | 'system'
  | 'unknown'

export type CommanderOperationStatus =
  | 'received'
  | 'interpreting'
  | 'assembling'
  | 'running'
  | 'synthesizing'
  | 'waiting_approval'
  | 'completed'
  | 'completed_with_failures'
  | 'failed'

export type CommanderOperationEventType =
  | 'request_received'
  | 'request_interpreted'
  | 'family_queued'
  | 'family_started'
  | 'family_responded'
  | 'family_failed'
  | 'family_unavailable'
  | 'family_skipped'
  | 'family_waiting_approval'
  | 'family_waiting_prior_turn'
  | 'synthesis_started'
  | 'synthesis_completed'
  | 'approval_required'
  | 'operation_completed'
  | 'operation_failed'
  | 'system_state_inspected'
  | 'lane_assigned'

export type CommanderOperationEventProvenance =
  | 'runtime_event'
  | 'provider_response'
  | 'system_state'
  | 'approval_state'

export type CommanderOperationEvent = {
  readonly id: string
  readonly sequence: number
  readonly timestamp: string | null
  readonly type: CommanderOperationEventType
  readonly familyId: CouncilOrchestrationFamily | 'system' | 'unknown' | null
  readonly familyLabel: string | null
  readonly roleLabel: string | null
  readonly statusLabel: string
  readonly messageId: string | null
  readonly outputText: string | null
  readonly replyToEventId: string | null
  readonly replyToFamilyId: string | null
  readonly replyToLabel: string | null
  readonly provenance: CommanderOperationEventProvenance
  readonly isActualProviderOutput: boolean
  readonly isFinal: boolean
}

export type CommanderOperationSummary = {
  readonly title: string
  readonly respondedCount: number
  readonly failedCount: number
  readonly unavailableCount: number
  readonly skippedCount: number
  readonly waitingApprovalCount: number
  readonly synthesisCompleted: boolean
  readonly approvalRequired: boolean
  readonly label: string
}

export type CommanderBriefing = {
  readonly heading: string
  readonly body: string
  readonly risks: readonly string[]
  readonly approvalRequirements: readonly string[]
  readonly nextActions: readonly string[]
  readonly evidenceStatus: string
  readonly recommendation: string | null
}

export type CommanderOperation = {
  readonly operationId: string
  readonly requestId: string | null
  readonly sessionId: string | null
  readonly requestKind: CommanderOperationRequestKind
  readonly mode: CommanderOperationMode
  readonly status: CommanderOperationStatus
  readonly events: readonly CommanderOperationEvent[]
  readonly finalResponseId: string | null
  readonly completedAt: string | null
  readonly briefing: CommanderBriefing
  readonly summary: CommanderOperationSummary
  readonly technicalData: unknown | null
}
