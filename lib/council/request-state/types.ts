import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilFlowMode } from '@/lib/council/councilMode'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'

export const COUNCIL_REQUEST_STATE_SCHEMA_VERSION = '47c1.council-request-state.v1' as const

export type CouncilRequestId = string & { readonly __brand: 'CouncilRequestId' }
export type CouncilFamilyExecutionId = string & { readonly __brand: 'CouncilFamilyExecutionId' }
export type CouncilRequestEventId = string & { readonly __brand: 'CouncilRequestEventId' }
export type CouncilParentRequestId = CouncilRequestId

export type CouncilProviderReadiness =
  | 'configured'
  | 'connected'
  | 'unavailable'
  | 'paused'
  | 'disabled'
  | 'unknown'

export type CouncilFamilyLifecycle =
  | 'waiting'
  | 'queued'
  | 'dispatched'
  | 'retrieving'
  | 'reviewing_previous_family'
  | 'responding'
  | 'stopped_by_commander'
  | 'not_reached'
  | 'terminal'

export type CouncilFamilyOutcome =
  | 'complete'
  | 'incomplete'
  | 'timed_out'
  | 'failed'
  | 'fallback_used'
  | 'skipped_by_policy'
  | 'stopped'
  | 'not_reached'

export type CouncilAuditScope =
  | 'complete_record'
  | 'partial_record'
  | 'unknown_scope'
  | 'not_audited'

export type CouncilAuditReviewType =
  | 'external_family'
  | 'synthetic_integrity'
  | 'not_audited'

export type CouncilSelectionAuthority =
  | 'commander_requested'
  | 'system_selected'
  | 'direct_invocation'
  | 'stable_group_member'
  | 'continuation_selected'
  | 'diagnostic_only'
  | 'skipped_by_command'
  | 'skipped_by_policy'

export type CouncilExecutionStrategy =
  | 'frontend_parallel_single_family'
  | 'frontend_sequential_single_family'
  | 'server_parallel'
  | 'server_sequential_streaming_future'
  | 'single_family_direct'
  | 'diagnostic_trace'

export type CouncilVisibilityState = {
  rendered: boolean
  omitted: boolean
  substituted: boolean
  persisted: boolean
  suppressed: boolean
  diagnosticOnly: boolean
}

export type CouncilReadinessSnapshot = {
  readiness: CouncilProviderReadiness
  source: 'canonical_runtime' | 'engine_control' | 'client_snapshot' | 'unknown'
  checkedAt: string | null
  providerLabel?: string
}

export type CouncilTimeoutMetadata = {
  timeoutMs: number
  timedOutAt: string | null
  source: 'client_gather' | 'provider_budget' | 'attendance_hard_close' | 'unknown'
}

export type CouncilPriorResponseLineage = {
  priorFamily: CouncilOrchestrationFamily
  priorExecutionId: CouncilFamilyExecutionId
  delivered: boolean
  deliveryOrder: number
  contentFingerprint: string | null
  deliveryPurpose: 'sequential_context' | 'red_team_audit' | 'final_synthesis' | 'diagnostic'
  omissionReason?: 'not_available' | 'not_reached' | 'suppressed' | 'policy' | 'not_needed'
}

export type CouncilFallbackLineage = {
  primaryFamily: CouncilOrchestrationFamily
  primaryProvider: string
  primaryOutcome: Exclude<CouncilFamilyOutcome, 'fallback_used'>
  primaryFailureCategory: 'incomplete' | 'timeout' | 'provider_error' | 'policy_block' | 'unknown'
  fallbackProviderOrMechanism: string
  fallbackOutcome: Exclude<CouncilFamilyOutcome, 'fallback_used'>
  fallbackOutputRendered: boolean
  fallbackReplacedVisiblePrimary: boolean
  commanderInformed: boolean
  safeDiagnosticReason: string
}

export type CouncilAuditMetadata = {
  scope: CouncilAuditScope
  reviewType: CouncilAuditReviewType
  expectedFamilies: CouncilOrchestrationFamily[]
  receivedFamilies: CouncilOrchestrationFamily[]
  missingFamilies: CouncilOrchestrationFamily[]
  currentTurnPriorResponsesReceived: boolean
  notes?: string
}

export type CouncilFamilyExecutionRecord = {
  schemaVersion: typeof COUNCIL_REQUEST_STATE_SCHEMA_VERSION
  executionId: CouncilFamilyExecutionId
  requestId: CouncilRequestId
  family: CouncilOrchestrationFamily
  selectionAuthority: CouncilSelectionAuthority
  readinessSnapshot: CouncilReadinessSnapshot
  lifecycle: CouncilFamilyLifecycle
  outcome: CouncilFamilyOutcome | null
  createdAt: string
  queuedAt?: string | null
  dispatchedAt?: string | null
  completedAt?: string | null
  timeout?: CouncilTimeoutMetadata | null
  priorResponseLineage: CouncilPriorResponseLineage[]
  respondingToFamilyExecutionIds: CouncilFamilyExecutionId[]
  fallbackLineage?: CouncilFallbackLineage | null
  visibility: CouncilVisibilityState
  auditRelevance: 'auditable' | 'not_auditable' | 'diagnostic_only'
  safeDiagnosticCode?: string | null
  safeDiagnosticMessage?: string | null
}

export type CouncilRequestCompletionSummary = {
  derivedFrom: 'family_outcomes'
  expectedCount: number
  selectedCount: number
  dispatchedCount: number
  terminalCount: number
  completeCount: number
  incompleteCount: number
  timedOutCount: number
  failedCount: number
  fallbackUsedCount: number
  skippedByPolicyCount: number
  stoppedCount: number
  notReachedCount: number
  missingTerminalFamilies: CouncilOrchestrationFamily[]
}

export type CouncilCancellationState = {
  cancelled: boolean
  reason?: 'commander_stop' | 'client_abort' | 'superseded' | 'unknown'
  cancelledAt?: string | null
}

export type CouncilRequestStateRecord = {
  schemaVersion: typeof COUNCIL_REQUEST_STATE_SCHEMA_VERSION
  requestId: CouncilRequestId
  parentRequestId?: CouncilParentRequestId | null
  createdAt: string
  commanderTurnRef: string
  flowMode: CouncilFlowMode
  executionStrategy: CouncilExecutionStrategy
  expectedFamilies: CouncilOrchestrationFamily[]
  selectedFamilies: CouncilOrchestrationFamily[]
  familyExecutions: CouncilFamilyExecutionRecord[]
  completionSummary: CouncilRequestCompletionSummary
  cancellation: CouncilCancellationState
  redTeamAudit: CouncilAuditMetadata
}

export type CouncilRequestStateValidationIssue = {
  code: string
  path: string
  message: string
}

export type CouncilRequestStateValidationResult = {
  ok: boolean
  issues: CouncilRequestStateValidationIssue[]
}

export type CouncilRequestStateValidationCase = {
  caseId: string
  description: string
  expected: 'valid' | 'invalid'
  observed: 'valid' | 'invalid'
  result: 'PASS' | 'FAIL'
  details: string[]
}

export type LegacyProviderConnectionStatus = 'online' | 'standby' | 'error' | 'not_connected' | string

export function councilRequestId(value: string): CouncilRequestId {
  return value as CouncilRequestId
}

export function councilFamilyExecutionId(value: string): CouncilFamilyExecutionId {
  return value as CouncilFamilyExecutionId
}

export function councilRequestEventId(value: string): CouncilRequestEventId {
  return value as CouncilRequestEventId
}

export function mapProviderRuntimeOutcomeToRequestOutcome(
  status: ProviderFamilyOutcomeStatus,
): CouncilFamilyOutcome | null {
  switch (status) {
    case 'RESPONDED':
    case 'READY':
      return 'complete'
    case 'DEGRADED':
      return 'incomplete'
    case 'TIMED_OUT':
      return 'timed_out'
    case 'FAILED':
      return 'failed'
    case 'SKIPPED':
      return 'skipped_by_policy'
    case 'IN_FLIGHT':
      // IN_FLIGHT is explicitly non-terminal (see providerIsolation.ts) and
      // must never be represented as a terminal CouncilFamilyOutcome.
      // Returning null forces callers to handle "not yet terminal"
      // explicitly instead of accidentally assigning a terminal-shaped
      // value to a still-running family's `outcome` field.
      return null
    default:
      // An unrecognized future status is exactly as unknowable as
      // IN_FLIGHT -- guessing a terminal outcome for it would be the same
      // footgun. Fail to null, never guess.
      return null
  }
}

export function mapLegacyConnectionStatusToReadiness(
  status: LegacyProviderConnectionStatus,
): CouncilProviderReadiness {
  switch (status) {
    case 'online':
      return 'connected'
    case 'standby':
      return 'configured'
    case 'not_connected':
      return 'unavailable'
    case 'error':
      return 'unavailable'
    default:
      return 'unknown'
  }
}

export function defaultVisibilityState(overrides: Partial<CouncilVisibilityState> = {}): CouncilVisibilityState {
  return {
    rendered: false,
    omitted: false,
    substituted: false,
    persisted: false,
    suppressed: false,
    diagnosticOnly: false,
    ...overrides,
  }
}
