import {
  defaultVisibilityState,
  type CouncilFamilyExecutionRecord,
  type CouncilFamilyOutcome,
  type CouncilPriorResponseLineage,
  type CouncilRequestStateRecord,
} from '@/lib/council/request-state/types'
import { deriveCouncilRequestCompletionSummary } from '@/lib/council/request-state/invariants'
import {
  type CouncilProgressEventEnvelope,
  type CouncilProgressReducerResult,
} from './types'
import {
  findFamilyExecution,
  progressIssue,
  validateCouncilProgressEventEnvelope,
  validateStateTransitionForEvent,
} from './invariants'

function cloneState(state: CouncilRequestStateRecord): CouncilRequestStateRecord {
  return JSON.parse(JSON.stringify(state)) as CouncilRequestStateRecord
}

function refreshSummary(state: CouncilRequestStateRecord): void {
  state.completionSummary = deriveCouncilRequestCompletionSummary(
    state.expectedFamilies,
    state.selectedFamilies,
    state.familyExecutions,
  )
}

function getFamilyRecord(state: CouncilRequestStateRecord, event: CouncilProgressEventEnvelope): CouncilFamilyExecutionRecord | undefined {
  if (!event.family) return undefined
  return findFamilyExecution(state, event.family)
}

function terminalOutcomeForEvent(event: CouncilProgressEventEnvelope): CouncilFamilyOutcome | null {
  switch (event.eventType) {
    case 'family_response_completed':
      return event.payload.outcome ?? 'complete'
    case 'family_failed':
      return 'failed'
    case 'family_timed_out':
      return 'timed_out'
    case 'family_skipped_by_policy':
      return 'skipped_by_policy'
    case 'family_stopped_by_commander':
      return 'stopped'
    case 'family_not_reached':
      return 'not_reached'
    case 'fallback_completed':
      return 'fallback_used'
    case 'fallback_failed':
      return 'failed'
    default:
      return null
  }
}

export function reduceCouncilProgressEvent(
  initialState: CouncilRequestStateRecord,
  event: CouncilProgressEventEnvelope,
): CouncilProgressReducerResult {
  const envelopeValidation = validateCouncilProgressEventEnvelope(event)
  if (!envelopeValidation.ok) {
    return { ok: false, state: initialState, issues: envelopeValidation.issues }
  }
  if (event.requestId !== initialState.requestId) {
    return {
      ok: false,
      state: initialState,
      issues: [progressIssue('request_id_mismatch', 'requestId', 'Event request ID does not match reducer state.')],
    }
  }

  const state = cloneState(initialState)
  const record = getFamilyRecord(state, event)
  const issues = []

  switch (event.eventType) {
    case 'request_selection_resolved':
      state.selectedFamilies = event.payload.selectedFamilies ?? state.selectedFamilies
      state.expectedFamilies = event.payload.expectedFamilies ?? state.expectedFamilies
      break
    case 'request_cancel_requested':
      // Commander intent to cancel is durably recorded by this event's own
      // presence in the applied event log (see replay.ts appliedEventIds).
      // It must NOT set cancellation.cancelled or close the request --
      // selected families may still be legitimately winding down. Only
      // request_cancelled represents actual request closure.
      break
    case 'request_cancelled':
      state.cancellation = {
        cancelled: true,
        reason: 'commander_stop',
        cancelledAt: event.occurredAt,
      }
      break
    case 'request_completed':
    case 'request_failed':
    case 'request_timed_out':
      break
    case 'family_waiting':
      if (record) record.lifecycle = 'waiting'
      break
    case 'family_queued':
      if (record) {
        record.lifecycle = 'queued'
        record.queuedAt = event.occurredAt
      }
      break
    case 'family_dispatched':
      if (record) {
        record.lifecycle = 'dispatched'
        record.dispatchedAt = event.occurredAt
        record.readinessSnapshot = {
          readiness: event.payload.readiness ?? record.readinessSnapshot.readiness,
          source: record.readinessSnapshot.source,
          checkedAt: event.occurredAt,
          providerLabel: event.payload.providerLabel ?? record.readinessSnapshot.providerLabel,
        }
      }
      break
    case 'family_retrieval_started':
      if (record) record.lifecycle = 'retrieving'
      break
    case 'family_retrieval_completed':
      if (!record || record.lifecycle !== 'retrieving') {
        issues.push(progressIssue('retrieval_completed_without_start', 'eventType', 'family_retrieval_completed requires retrieval to be active.'))
      }
      break
    case 'family_prior_response_delivered':
      if (record && event.payload.priorResponse) {
        const payload = event.payload.priorResponse
        const lineage: CouncilPriorResponseLineage = {
          priorFamily: payload.sourceFamily,
          priorExecutionId: payload.sourceExecutionId,
          delivered: payload.delivered,
          deliveryOrder: payload.deliveryOrder,
          contentFingerprint: payload.contentFingerprint,
          deliveryPurpose: 'sequential_context',
          omissionReason: payload.omissionReason,
        }
        record.priorResponseLineage.push(lineage)
        if (!record.respondingToFamilyExecutionIds.includes(payload.sourceExecutionId)) {
          record.respondingToFamilyExecutionIds.push(payload.sourceExecutionId)
        }
      }
      break
    case 'family_reviewing_previous':
      if (record) record.lifecycle = 'reviewing_previous_family'
      break
    case 'family_response_started':
      if (record) record.lifecycle = 'responding'
      break
    case 'fallback_started':
      if (record) record.safeDiagnosticCode = 'fallback_started'
      break
    case 'fallback_completed':
    case 'fallback_failed':
      if (record && event.payload.fallback) {
        if (record.safeDiagnosticCode !== 'fallback_started') {
          issues.push(progressIssue('fallback_completed_without_start', 'eventType', 'fallback completion requires fallback_started first.'))
        }
        if (event.payload.fallback.fallbackOutputRendered && !event.payload.fallback.fallbackReplacedVisiblePrimary) {
          issues.push(progressIssue('fallback_rendered_without_substitution_metadata', 'payload.fallback.fallbackReplacedVisiblePrimary', 'Rendered fallback output must state whether it replaced visible primary output.'))
        }
        record.fallbackLineage = event.payload.fallback
        record.visibility = defaultVisibilityState({
          ...record.visibility,
          rendered: event.payload.fallback.fallbackOutputRendered,
          substituted: event.payload.fallback.fallbackReplacedVisiblePrimary,
          omitted: !event.payload.fallback.fallbackOutputRendered,
          diagnosticOnly: !event.payload.fallback.fallbackOutputRendered,
        })
      }
      break
    case 'audit_scope_declared':
      if (event.payload.audit) {
        state.redTeamAudit = event.payload.audit
      }
      break
    case 'audit_completed':
      if (state.redTeamAudit.scope === 'not_audited') {
        issues.push(progressIssue('audit_completed_without_scope', 'eventType', 'audit_completed requires audit_scope_declared first.'))
      }
      if (event.payload.audit) {
        state.redTeamAudit = event.payload.audit
      }
      break
    case 'audit_started':
    case 'audit_failed':
    case 'diagnostic_recorded':
    case 'request_created':
    case 'request_started':
      break
    default:
      break
  }

  const terminalOutcome = terminalOutcomeForEvent(event)
  if (record && terminalOutcome) {
    record.lifecycle = 'terminal'
    record.outcome = terminalOutcome
    record.completedAt = event.occurredAt
    if (terminalOutcome === 'timed_out') {
      record.timeout = {
        timeoutMs: event.payload.timeoutMs ?? 0,
        timedOutAt: event.occurredAt,
        source: 'provider_budget',
      }
    }
  }

  if (!record && event.family) {
    issues.push(progressIssue('family_execution_not_found', 'family', 'Event references a family without a canonical execution record.'))
  }

  refreshSummary(state)
  issues.push(...validateStateTransitionForEvent(initialState, state, event))

  if (event.eventType === 'request_completed' && state.completionSummary.missingTerminalFamilies.length > 0) {
    issues.push(progressIssue('request_completed_too_early', 'eventType', 'request_completed cannot close unresolved selected families.'))
  }
  // Confirmed cancellation uses the same allSelectedFamiliesTerminal truth
  // rule as request_completed (missingTerminalFamilies is derived from it) --
  // not a second, inconsistent closure rule. request_cancel_requested is
  // exempt: it never reaches this branch because it never sets eventType to
  // 'request_cancelled'.
  if (event.eventType === 'request_cancelled' && state.completionSummary.missingTerminalFamilies.length > 0) {
    issues.push(progressIssue('request_cancelled_too_early', 'eventType', 'request_cancelled cannot close unresolved selected families.'))
  }

  return {
    ok: issues.length === 0,
    state: issues.length === 0 ? state : initialState,
    issues,
    appliedEventId: issues.length === 0 ? event.eventId : undefined,
  }
}
