import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilRosterMembershipState } from '@/lib/council/live-orchestration/rosterHealth'
import {
  COUNCIL_REQUEST_STATE_SCHEMA_VERSION,
  type CouncilAuditReviewType,
  type CouncilAuditScope,
  type CouncilFamilyExecutionId,
  type CouncilFamilyOutcome,
  type CouncilProviderReadiness,
  type CouncilRequestId,
  type CouncilRequestStateRecord,
  type CouncilVisibilityState,
} from '@/lib/council/request-state/types'

export const COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION = '47c2.council-progress-event.v1' as const

export type CouncilProgressEventId = string & { readonly __brand: 'CouncilProgressEventId' }

export type CouncilProgressEventSource =
  | 'client_orchestrator'
  | 'server_orchestrator'
  | 'provider_adapter'
  | 'retrieval_layer'
  | 'fallback_layer'
  | 'integrity_layer'
  | 'commander'
  | 'diagnostic_layer'
  | 'replay'

export type CouncilProgressEventType =
  | 'request_created'
  | 'request_selection_resolved'
  | 'request_started'
  | 'request_cancel_requested'
  | 'request_cancelled'
  | 'request_completed'
  | 'request_failed'
  | 'request_timed_out'
  | 'family_waiting'
  | 'family_queued'
  | 'family_dispatched'
  | 'family_retrieval_started'
  | 'family_retrieval_completed'
  | 'family_prior_response_delivered'
  | 'family_reviewing_previous'
  | 'family_response_started'
  | 'family_response_completed'
  | 'family_failed'
  | 'family_timed_out'
  | 'family_skipped_by_policy'
  | 'family_stopped_by_commander'
  | 'family_not_reached'
  | 'fallback_started'
  | 'fallback_completed'
  | 'fallback_failed'
  | 'audit_started'
  | 'audit_scope_declared'
  | 'audit_completed'
  | 'audit_failed'
  | 'diagnostic_recorded'

export type CouncilProgressEventVisibility = CouncilVisibilityState

export type CouncilDiagnosticMetadata = {
  category: 'provider' | 'timeout' | 'integrity' | 'replay' | 'validation' | 'unknown'
  code: string
  safeMessage: string
  providerFamily?: CouncilOrchestrationFamily
  elapsedMs?: number
  retryCount?: number
  timeoutClassification?: 'soft' | 'hard' | 'none'
  sanitizedMetadata?: Record<string, string | number | boolean | null>
}

export type CouncilPriorResponseDeliveryPayload = {
  sourceFamily: CouncilOrchestrationFamily
  targetFamily: CouncilOrchestrationFamily
  sourceExecutionId: CouncilFamilyExecutionId
  targetExecutionId: CouncilFamilyExecutionId
  deliveryOrder: number
  delivered: boolean
  contentFingerprint: string | null
  omissionReason?: 'not_available' | 'not_reached' | 'suppressed' | 'policy' | 'not_needed'
}

export type CouncilFallbackPayload = {
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

export type CouncilAuditPayload = {
  scope: CouncilAuditScope
  reviewType: CouncilAuditReviewType
  expectedFamilies: CouncilOrchestrationFamily[]
  receivedFamilies: CouncilOrchestrationFamily[]
  missingFamilies: CouncilOrchestrationFamily[]
  currentTurnPriorResponsesReceived: boolean
  notes?: string
}

export type CouncilProgressEventPayload = {
  selectedFamilies?: CouncilOrchestrationFamily[]
  expectedFamilies?: CouncilOrchestrationFamily[]
  readiness?: CouncilProviderReadiness
  providerLabel?: string
  outcome?: CouncilFamilyOutcome
  timeoutMs?: number
  reason?: string
  rosterMembership?: CouncilRosterMembershipState
  priorResponse?: CouncilPriorResponseDeliveryPayload
  fallback?: CouncilFallbackPayload
  audit?: CouncilAuditPayload
  diagnostic?: CouncilDiagnosticMetadata
}

export type CouncilProgressEventEnvelope = {
  schemaVersion: typeof COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION
  eventId: CouncilProgressEventId
  requestId: CouncilRequestId
  executionId?: CouncilFamilyExecutionId | null
  sequence: number
  eventType: CouncilProgressEventType
  occurredAt: string
  emittedAt?: string | null
  family?: CouncilOrchestrationFamily | null
  source: CouncilProgressEventSource
  payload: CouncilProgressEventPayload
  visibility: CouncilProgressEventVisibility
  diagnostic?: CouncilDiagnosticMetadata | null
}

export type CouncilProgressEventIssue = {
  code: string
  path: string
  message: string
}

export type CouncilProgressEventValidationResult = {
  ok: boolean
  issues: CouncilProgressEventIssue[]
}

export type CouncilProgressReducerResult = {
  ok: boolean
  state: CouncilRequestStateRecord
  issues: CouncilProgressEventIssue[]
  appliedEventId?: CouncilProgressEventId
}

export type CouncilProgressReplayResult = {
  ok: boolean
  finalState: CouncilRequestStateRecord
  appliedEventIds: CouncilProgressEventId[]
  ignoredDuplicateEventIds: CouncilProgressEventId[]
  issues: CouncilProgressEventIssue[]
  failurePosition: number | null
}

export type CouncilProgressValidationCase = {
  caseId: string
  description: string
  expected: 'valid' | 'invalid'
  observed: 'valid' | 'invalid'
  result: 'PASS' | 'FAIL'
  details: string[]
}

export type CouncilProgressFixtureIds = {
  requestId: CouncilRequestId
  chatgptExecutionId: CouncilFamilyExecutionId
  claudeExecutionId: CouncilFamilyExecutionId
  grokExecutionId: CouncilFamilyExecutionId
}

export function councilProgressEventId(value: string): CouncilProgressEventId {
  return value as CouncilProgressEventId
}

export { COUNCIL_REQUEST_STATE_SCHEMA_VERSION }
