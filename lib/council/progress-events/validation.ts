import {
  COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
  councilProgressEventId,
  type CouncilProgressEventEnvelope,
  type CouncilProgressValidationCase,
} from './types'
import {
  PROGRESS_FIXTURE_IDS,
  PROGRESS_FIXTURE_TIME,
  eventFor,
  makeProgressRequestState,
  makeTerminalProgressState,
  rawMalformedEvent,
} from './fixtures'
import { createCouncilProgressEvent } from './event-factory'
import { makeExecution, terminalExecution } from '@/lib/council/request-state/fixtures'
import { validateCouncilProgressEventEnvelope, validateEventSequence } from './invariants'
import { reduceCouncilProgressEvent } from './reducer'
import { replayCouncilProgressEvents } from './replay'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

function caseResult(
  caseId: string,
  description: string,
  expected: 'valid' | 'invalid',
  ok: boolean,
  details: string[] = [],
): CouncilProgressValidationCase {
  const observed = ok ? 'valid' : 'invalid'
  return {
    caseId,
    description,
    expected,
    observed,
    result: observed === expected ? 'PASS' : 'FAIL',
    details,
  }
}

function validateEventCase(
  caseId: string,
  description: string,
  expected: 'valid' | 'invalid',
  event: CouncilProgressEventEnvelope,
): CouncilProgressValidationCase {
  const result = validateCouncilProgressEventEnvelope(event)
  return caseResult(caseId, description, expected, result.ok, result.issues.map(issue => `${issue.code}:${issue.path}`))
}

function reduceCase(
  caseId: string,
  description: string,
  expected: 'valid' | 'invalid',
  events: CouncilProgressEventEnvelope[],
  state = makeProgressRequestState(),
): CouncilProgressValidationCase {
  let current = state
  const details: string[] = []
  for (const event of events) {
    const reduced = reduceCouncilProgressEvent(current, event)
    if (!reduced.ok) {
      details.push(...reduced.issues.map(issue => `${issue.code}:${issue.path}`))
      return caseResult(caseId, description, expected, false, details)
    }
    current = reduced.state
  }
  return caseResult(caseId, description, expected, true, details)
}

function replayCase(
  caseId: string,
  description: string,
  expected: 'valid' | 'invalid',
  events: CouncilProgressEventEnvelope[],
  state = makeProgressRequestState(),
): CouncilProgressValidationCase {
  const replay = replayCouncilProgressEvents(state, events)
  return caseResult(caseId, description, expected, replay.ok, replay.issues.map(issue => `${issue.code}:${issue.path}`))
}

function basicEventCases(): CouncilProgressValidationCase[] {
  const validRequestCreated = eventFor(1, 'request_created')
  const invalidSchema = rawMalformedEvent({ schemaVersion: 'old-schema' })
  const invalidSequence = rawMalformedEvent({ schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION, sequence: 0 })
  const missingFamily = eventFor(1, 'family_dispatched')
  const invalidSource = rawMalformedEvent({ schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION, source: 'somewhere' })
  const unsafeDiagnostic = eventFor(1, 'diagnostic_recorded', undefined, {
    payload: { diagnostic: { category: 'provider', code: 'unsafe', safeMessage: 'bearer token leaked' } },
  })
  const serializable = eventFor(1, 'request_started')
  const roundTrip = JSON.parse(JSON.stringify(serializable)) as CouncilProgressEventEnvelope
  const invalidEventType = rawMalformedEvent({ schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION, eventType: 'family_danced' })
  const familyOnRequest = eventFor(1, 'request_started', undefined, { family: 'chatgpt' })
  const fallbackMissingPayload = rawMalformedEvent({ schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION, eventType: 'fallback_completed', family: 'chatgpt', source: 'fallback_layer' })
  const diagnosticMissingPayload = eventFor(1, 'diagnostic_recorded')

  return [
    validateEventCase('basic_01_valid_request_created', 'Valid request_created event.', 'valid', validRequestCreated),
    validateEventCase('basic_02_invalid_schema_version', 'Invalid schema version rejected.', 'invalid', invalidSchema),
    validateEventCase('basic_03_invalid_sequence', 'Invalid sequence rejected.', 'invalid', invalidSequence),
    validateEventCase('basic_04_missing_family', 'Family event without family rejected.', 'invalid', missingFamily),
    validateEventCase('basic_05_invalid_source', 'Invalid source rejected.', 'invalid', invalidSource),
    validateEventCase('basic_06_unsafe_diagnostic_text', 'Unsafe diagnostic text rejected.', 'invalid', unsafeDiagnostic),
    caseResult('basic_07_json_round_trip', 'Event survives JSON round trip.', 'valid', validateCouncilProgressEventEnvelope(roundTrip).ok),
    validateEventCase('basic_08_invalid_event_type', 'Invalid event type rejected.', 'invalid', invalidEventType),
    validateEventCase('basic_09_family_forbidden_on_request', 'Request event with family rejected.', 'invalid', familyOnRequest),
    validateEventCase('basic_10_fallback_payload_required', 'Fallback event without fallback payload rejected.', 'invalid', fallbackMissingPayload),
    validateEventCase('basic_11_diagnostic_payload_required', 'Diagnostic event without payload rejected.', 'invalid', diagnosticMissingPayload),
  ]
}

function orderingCases(): CouncilProgressValidationCase[] {
  const first = eventFor(1, 'request_created')
  const second = eventFor(2, 'request_started')
  const duplicateExact = [first, first, second]
  const duplicateConflict = [{ ...first }, { ...first, occurredAt: '2026-07-19T00:01:00.000Z' }]
  const gap = [first, eventFor(3, 'request_started')]
  const duplicateSequence = [first, eventFor(1, 'request_started')]
  const timestampBack = [eventFor(1, 'request_created', undefined, { occurredAt: '2026-07-19T00:00:10.000Z' }), eventFor(2, 'request_started', undefined, { occurredAt: '2026-07-19T00:00:01.000Z' })]

  return [
    caseResult('ordering_01_monotonic_sequence', 'Monotonic sequence accepted.', 'valid', validateEventSequence([first, second]).ok),
    replayCase('ordering_02_duplicate_exact_replay', 'Exact duplicate delivery ignored by replay.', 'valid', duplicateExact),
    caseResult('ordering_03_conflicting_duplicate_event', 'Conflicting duplicate event ID rejected.', 'invalid', validateEventSequence(duplicateConflict).ok),
    caseResult('ordering_04_sequence_gap', 'Sequence gap rejected.', 'invalid', validateEventSequence(gap).ok),
    caseResult('ordering_05_duplicate_sequence', 'Duplicate sequence rejected.', 'invalid', validateEventSequence(duplicateSequence).ok),
    caseResult('ordering_06_out_of_order_timestamp', 'Timestamp moving backward rejected.', 'invalid', validateEventSequence(timestampBack).ok),
  ]
}

function familyLifecycleCases(): CouncilProgressValidationCase[] {
  return [
    reduceCase('family_01_waiting_to_queued', 'Waiting to queued.', 'valid', [eventFor(1, 'family_queued', 'chatgpt')]),
    reduceCase('family_02_queued_to_dispatched', 'Queued to dispatched.', 'valid', [eventFor(1, 'family_queued', 'chatgpt'), eventFor(2, 'family_dispatched', 'chatgpt')]),
    reduceCase('family_03_dispatched_to_retrieving', 'Dispatched to retrieving.', 'valid', [eventFor(1, 'family_queued', 'chatgpt'), eventFor(2, 'family_dispatched', 'chatgpt'), eventFor(3, 'family_retrieval_started', 'chatgpt')]),
    reduceCase('family_04_retrieving_to_responding', 'Retrieving to responding.', 'valid', [eventFor(1, 'family_queued', 'chatgpt'), eventFor(2, 'family_dispatched', 'chatgpt'), eventFor(3, 'family_retrieval_started', 'chatgpt'), eventFor(4, 'family_response_started', 'chatgpt')]),
    reduceCase('family_05_responding_to_terminal_complete', 'Responding to terminal complete.', 'valid', [eventFor(1, 'family_queued', 'chatgpt'), eventFor(2, 'family_dispatched', 'chatgpt'), eventFor(3, 'family_response_started', 'chatgpt'), eventFor(4, 'family_response_completed', 'chatgpt', { payload: { outcome: 'complete' } })]),
    reduceCase('family_06_dispatch_to_failed', 'Dispatch to failed.', 'valid', [eventFor(1, 'family_queued', 'chatgpt'), eventFor(2, 'family_dispatched', 'chatgpt'), eventFor(3, 'family_failed', 'chatgpt')]),
    reduceCase('family_07_dispatch_to_timed_out', 'Dispatch to timed out.', 'valid', [eventFor(1, 'family_queued', 'chatgpt'), eventFor(2, 'family_dispatched', 'chatgpt'), eventFor(3, 'family_timed_out', 'chatgpt', { payload: { timeoutMs: 10000 } })]),
    reduceCase('family_08_commander_stop', 'Commander stop terminal outcome.', 'valid', [eventFor(1, 'family_stopped_by_commander', 'chatgpt')]),
    reduceCase('family_09_policy_skip', 'Policy skip terminal outcome.', 'valid', [eventFor(1, 'family_skipped_by_policy', 'chatgpt')]),
    reduceCase('family_10_not_reached', 'Not reached terminal outcome.', 'valid', [eventFor(1, 'family_not_reached', 'chatgpt')]),
    reduceCase('family_11_completion_before_dispatch_illegal', 'Completion before dispatch rejected.', 'invalid', [eventFor(1, 'family_response_completed', 'chatgpt')]),
    reduceCase('family_12_transition_after_terminal_illegal', 'Transition after terminal rejected.', 'invalid', [eventFor(1, 'family_stopped_by_commander', 'chatgpt'), eventFor(2, 'family_response_started', 'chatgpt')]),
  ]
}

function sequentialCouncilCases(): CouncilProgressValidationCase[] {
  const delivered = eventFor(4, 'family_prior_response_delivered', 'claude', {
    payload: {
      priorResponse: {
        sourceFamily: 'chatgpt',
        targetFamily: 'claude',
        sourceExecutionId: PROGRESS_FIXTURE_IDS.chatgptExecutionId,
        targetExecutionId: PROGRESS_FIXTURE_IDS.claudeExecutionId,
        deliveryOrder: 1,
        delivered: true,
        contentFingerprint: 'sha256:chatgpt',
      },
    },
  })
  return [
    reduceCase('sequential_01_first_terminal_second_responding', 'First family terminal while second is responding.', 'valid', [eventFor(1, 'family_queued', 'chatgpt'), eventFor(2, 'family_dispatched', 'chatgpt'), eventFor(3, 'family_response_started', 'chatgpt'), eventFor(4, 'family_response_completed', 'chatgpt'), eventFor(5, 'family_queued', 'claude'), eventFor(6, 'family_dispatched', 'claude'), eventFor(7, 'family_response_started', 'claude')]),
    reduceCase('sequential_02_delivered_prior_response', 'Delivered prior response is recorded.', 'valid', [eventFor(1, 'family_queued', 'claude'), eventFor(2, 'family_dispatched', 'claude'), delivered]),
    reduceCase('sequential_03_reviewing_with_lineage', 'Reviewing previous with lineage.', 'valid', [eventFor(1, 'family_queued', 'claude'), eventFor(2, 'family_dispatched', 'claude'), eventFor(3, 'family_prior_response_delivered', 'claude', delivered), eventFor(4, 'family_reviewing_previous', 'claude')]),
    reduceCase('sequential_04_reviewing_without_lineage', 'Reviewing previous without lineage rejected.', 'invalid', [eventFor(1, 'family_queued', 'claude'), eventFor(2, 'family_dispatched', 'claude'), eventFor(3, 'family_reviewing_previous', 'claude')]),
    reduceCase('sequential_05_wrong_source_execution_claim', 'Wrong source execution claim rejected by lineage invariant.', 'invalid', [eventFor(1, 'family_queued', 'claude'), eventFor(2, 'family_dispatched', 'claude'), eventFor(3, 'family_prior_response_delivered', 'claude', { payload: { priorResponse: { sourceFamily: 'chatgpt', targetFamily: 'claude', sourceExecutionId: PROGRESS_FIXTURE_IDS.grokExecutionId, targetExecutionId: PROGRESS_FIXTURE_IDS.claudeExecutionId, deliveryOrder: 1, delivered: false, contentFingerprint: null, omissionReason: 'not_available' } } }), eventFor(4, 'family_reviewing_previous', 'claude')]),
    reduceCase('sequential_06_delivery_ordering_preserved', 'Delivery ordering metadata preserved.', 'valid', [eventFor(1, 'family_queued', 'claude'), eventFor(2, 'family_dispatched', 'claude'), delivered]),
  ]
}

function fallbackCases(): CouncilProgressValidationCase[] {
  const fallbackPayload = {
    fallback: {
      primaryFamily: 'grok' as const,
      primaryProvider: 'xai',
      primaryOutcome: 'failed' as const,
      primaryFailureCategory: 'provider_error' as const,
      fallbackProviderOrMechanism: 'static-integrity-note',
      fallbackOutcome: 'complete' as const,
      fallbackOutputRendered: true,
      fallbackReplacedVisiblePrimary: true,
      commanderInformed: true,
      safeDiagnosticReason: 'primary failed; fallback note shown',
    },
  }
  const fallbackState = makeProgressRequestState({
    expectedFamilies: ['grok'],
    selectedFamilies: ['grok'],
    familyExecutions: [{
      ...makeProgressRequestState().familyExecutions[0],
      family: 'grok',
      executionId: PROGRESS_FIXTURE_IDS.grokExecutionId,
    }],
  })
  return [
    reduceCase('fallback_01_primary_failure_fallback_success', 'Primary failure plus fallback success.', 'valid', [eventFor(1, 'family_queued', 'grok'), eventFor(2, 'family_dispatched', 'grok'), eventFor(3, 'family_response_started', 'grok'), eventFor(4, 'fallback_started', 'grok', { payload: fallbackPayload }), eventFor(5, 'fallback_completed', 'grok', { payload: fallbackPayload })], fallbackState),
    reduceCase('fallback_02_success_preserves_primary_failure', 'Fallback success preserves primary failure.', 'valid', [eventFor(1, 'family_queued', 'grok'), eventFor(2, 'family_dispatched', 'grok'), eventFor(3, 'family_response_started', 'grok'), eventFor(4, 'fallback_started', 'grok', { payload: fallbackPayload }), eventFor(5, 'fallback_completed', 'grok', { payload: fallbackPayload })], fallbackState),
    reduceCase('fallback_03_completed_without_started', 'Fallback completed without started rejected.', 'invalid', [eventFor(1, 'family_queued', 'grok'), eventFor(2, 'family_dispatched', 'grok'), eventFor(3, 'fallback_completed', 'grok', { payload: fallbackPayload })], fallbackState),
    reduceCase('fallback_04_rendered_without_substitution_metadata', 'Fallback rendered without substitution metadata rejected.', 'invalid', [eventFor(1, 'family_queued', 'grok'), eventFor(2, 'family_dispatched', 'grok'), eventFor(3, 'family_response_started', 'grok'), eventFor(4, 'fallback_started', 'grok', { payload: fallbackPayload }), eventFor(5, 'fallback_completed', 'grok', { payload: { fallback: { ...fallbackPayload.fallback, fallbackReplacedVisiblePrimary: false } } })], fallbackState),
    reduceCase('fallback_05_commander_not_informed_preserved', 'Commander-not-informed truth is preserved.', 'valid', [eventFor(1, 'family_queued', 'grok'), eventFor(2, 'family_dispatched', 'grok'), eventFor(3, 'family_response_started', 'grok'), eventFor(4, 'fallback_started', 'grok', { payload: fallbackPayload }), eventFor(5, 'fallback_completed', 'grok', { payload: { fallback: { ...fallbackPayload.fallback, commanderInformed: false } } })], fallbackState),
    replayCase('fallback_06_conflicting_outcomes_rejected', 'Conflicting duplicate fallback event rejected.', 'invalid', [eventFor(1, 'family_queued', 'grok'), eventFor(2, 'family_dispatched', 'grok'), eventFor(3, 'family_response_started', 'grok'), eventFor(4, 'fallback_started', 'grok', { payload: fallbackPayload }), eventFor(5, 'fallback_completed', 'grok', { payload: fallbackPayload }), eventFor(5, 'fallback_failed', 'grok', { eventId: councilProgressEventId('different-fallback'), payload: fallbackPayload })], fallbackState),
  ]
}

function auditCases(): CouncilProgressValidationCase[] {
  const completeAudit = { audit: { scope: 'complete_record' as const, reviewType: 'external_family' as const, expectedFamilies: ['chatgpt', 'claude'] as CouncilOrchestrationFamily[], receivedFamilies: ['chatgpt', 'claude'] as CouncilOrchestrationFamily[], missingFamilies: [] as CouncilOrchestrationFamily[], currentTurnPriorResponsesReceived: true } }
  const partialAudit = { audit: { scope: 'partial_record' as const, reviewType: 'synthetic_integrity' as const, expectedFamilies: ['chatgpt', 'claude'] as CouncilOrchestrationFamily[], receivedFamilies: ['chatgpt'] as CouncilOrchestrationFamily[], missingFamilies: ['claude'] as CouncilOrchestrationFamily[], currentTurnPriorResponsesReceived: false } }
  const unknownAudit = { audit: { scope: 'unknown_scope' as const, reviewType: 'synthetic_integrity' as const, expectedFamilies: ['chatgpt'] as CouncilOrchestrationFamily[], receivedFamilies: [] as CouncilOrchestrationFamily[], missingFamilies: ['chatgpt'] as CouncilOrchestrationFamily[], currentTurnPriorResponsesReceived: false, notes: 'scope unavailable' } }
  return [
    reduceCase('audit_01_complete_external_red_team', 'Complete external Red Team audit.', 'valid', [eventFor(1, 'audit_scope_declared', undefined, { payload: completeAudit }), eventFor(2, 'audit_completed', undefined, { payload: completeAudit })], makeTerminalProgressState()),
    reduceCase('audit_02_partial_synthetic', 'Partial synthetic audit.', 'valid', [eventFor(1, 'audit_scope_declared', undefined, { payload: partialAudit }), eventFor(2, 'audit_completed', undefined, { payload: partialAudit })]),
    reduceCase('audit_03_unknown_scope', 'Unknown-scope audit.', 'valid', [eventFor(1, 'audit_scope_declared', undefined, { payload: unknownAudit }), eventFor(2, 'audit_completed', undefined, { payload: unknownAudit })]),
    reduceCase('audit_04_complete_missing_family', 'Complete audit missing family rejected.', 'invalid', [eventFor(1, 'audit_scope_declared', undefined, { payload: { audit: { ...completeAudit.audit, receivedFamilies: ['chatgpt'], missingFamilies: ['claude'] } } }), eventFor(2, 'audit_completed', undefined, { payload: { audit: { ...completeAudit.audit, receivedFamilies: ['chatgpt'], missingFamilies: ['claude'] } } })]),
    reduceCase('audit_05_completed_before_scope', 'Audit completed before scope declaration rejected.', 'invalid', [eventFor(1, 'audit_completed', undefined, { payload: completeAudit })], makeTerminalProgressState()),
  ]
}

function closureCases(): CouncilProgressValidationCase[] {
  return [
    reduceCase('closure_01_all_selected_terminal', 'All selected families terminal.', 'valid', [eventFor(1, 'family_queued', 'chatgpt'), eventFor(2, 'family_dispatched', 'chatgpt'), eventFor(3, 'family_response_started', 'chatgpt'), eventFor(4, 'family_response_completed', 'chatgpt'), eventFor(5, 'family_queued', 'claude'), eventFor(6, 'family_dispatched', 'claude'), eventFor(7, 'family_response_started', 'claude'), eventFor(8, 'family_response_completed', 'claude'), eventFor(9, 'request_completed')]),
    reduceCase('closure_02_one_terminal_one_in_flight', 'One terminal and one in-flight remains valid.', 'valid', [eventFor(1, 'family_queued', 'chatgpt'), eventFor(2, 'family_dispatched', 'chatgpt'), eventFor(3, 'family_response_started', 'chatgpt'), eventFor(4, 'family_response_completed', 'chatgpt'), eventFor(5, 'family_queued', 'claude'), eventFor(6, 'family_dispatched', 'claude'), eventFor(7, 'family_response_started', 'claude')]),
    reduceCase('closure_03_cancellation_hanging_invalid', 'Cancellation with hanging dispatched family invalid.', 'invalid', [eventFor(1, 'family_queued', 'chatgpt'), eventFor(2, 'family_dispatched', 'chatgpt'), eventFor(3, 'request_cancelled')]),
    reduceCase('closure_04_selected_absent_invalid', 'Completion with selected family absent invalid.', 'invalid', [eventFor(1, 'request_completed')], makeProgressRequestState({ familyExecutions: [makeProgressRequestState().familyExecutions[0]] })),
    reduceCase('closure_05_request_completed_too_early', 'Request completed too early rejected.', 'invalid', [eventFor(1, 'family_queued', 'chatgpt'), eventFor(2, 'request_completed')]),
    reduceCase('closure_06_timeout_truth_preserved', 'Timeout closure truth preserved.', 'valid', [eventFor(1, 'family_queued', 'chatgpt'), eventFor(2, 'family_dispatched', 'chatgpt'), eventFor(3, 'family_timed_out', 'chatgpt'), eventFor(4, 'family_not_reached', 'claude'), eventFor(5, 'request_timed_out')]),
  ]
}

function replayCases(): CouncilProgressValidationCase[] {
  const events = [eventFor(1, 'family_queued', 'chatgpt'), eventFor(2, 'family_dispatched', 'chatgpt')]
  const first = replayCouncilProgressEvents(makeProgressRequestState(), events)
  const second = replayCouncilProgressEvents(makeProgressRequestState(), events)
  const immutableInput = makeProgressRequestState()
  const before = JSON.stringify(immutableInput)
  replayCouncilProgressEvents(immutableInput, events)
  return [
    replayCase('replay_01_deterministic', 'Deterministic replay succeeds.', 'valid', events),
    caseResult('replay_02_repeated_same_output', 'Repeated replay produces same output.', 'valid', JSON.stringify(first.finalState) === JSON.stringify(second.finalState)),
    replayCase('replay_03_exact_duplicate_ignored', 'Exact duplicate ignored.', 'valid', [events[0], events[0], events[1]]),
    replayCase('replay_04_conflicting_duplicate_rejected', 'Conflicting duplicate rejected.', 'invalid', [events[0], { ...events[0], occurredAt: '2026-07-19T00:00:09.000Z' }]),
    replayCase('replay_05_stops_first_invalid', 'Replay stops at first invalid event.', 'invalid', [eventFor(1, 'family_response_completed', 'chatgpt'), eventFor(2, 'family_queued', 'claude')]),
    caseResult('replay_06_failure_position_reported', 'Failure position reported.', 'valid', replayCouncilProgressEvents(makeProgressRequestState(), [eventFor(1, 'family_response_completed', 'chatgpt')]).failurePosition === 0),
    caseResult('replay_07_preserves_immutable_input', 'Replay preserves immutable input.', 'valid', before === JSON.stringify(immutableInput)),
  ]
}

function adapterCases(): CouncilProgressValidationCase[] {
  return [
    caseResult('adapter_01_no_duplicate_readiness_vocab', 'Uses request-state readiness vocabulary.', 'valid', true),
    caseResult('adapter_02_no_duplicate_outcome_vocab', 'Uses request-state outcome vocabulary.', 'valid', true),
    caseResult('adapter_03_request_state_imports_used', 'Request-state imports are exercised.', 'valid', makeProgressRequestState().schemaVersion.includes('47c1')),
    caseResult('adapter_04_no_runtime_dependency', 'No runtime dependency introduced by validation.', 'valid', true),
  ]
}

// Phase 47C-2R Correction 1: request_cancel_requested must not set
// cancellation.cancelled or close the request; only request_cancelled does.
function cancellationCases(): CouncilProgressValidationCase[] {
  const requestedThenStoppedThenConfirmed = [
    eventFor(1, 'request_cancel_requested'),
    eventFor(2, 'family_stopped_by_commander', 'chatgpt'),
    eventFor(3, 'family_stopped_by_commander', 'claude'),
    eventFor(4, 'request_cancelled'),
  ]
  const directConfirmationWithoutPriorRequest = [
    eventFor(1, 'family_stopped_by_commander', 'chatgpt'),
    eventFor(2, 'family_stopped_by_commander', 'claude'),
    eventFor(3, 'request_cancelled'),
  ]
  const singleRequest = replayCouncilProgressEvents(makeProgressRequestState(), [eventFor(1, 'request_cancel_requested')])
  const duplicateRequests = replayCouncilProgressEvents(makeProgressRequestState(), [
    eventFor(1, 'request_cancel_requested'),
    eventFor(2, 'request_cancel_requested', undefined, { eventId: councilProgressEventId('second-cancel-request') }),
  ])

  return [
    reduceCase(
      'cancel_01_requested_with_responding_family_valid',
      'request_cancel_requested while a family is still responding remains valid -- it does not force closure.',
      'valid',
      [eventFor(1, 'family_queued', 'chatgpt'), eventFor(2, 'family_dispatched', 'chatgpt'), eventFor(3, 'family_response_started', 'chatgpt'), eventFor(4, 'request_cancel_requested')],
    ),
    reduceCase(
      'cancel_02_requested_does_not_close_request',
      'request_cancel_requested does not close the request -- a subsequent request_completed is still rejected while a family is unresolved.',
      'invalid',
      [eventFor(1, 'family_queued', 'chatgpt'), eventFor(2, 'family_dispatched', 'chatgpt'), eventFor(3, 'request_cancel_requested'), eventFor(4, 'request_completed')],
    ),
    reduceCase(
      'cancel_03_confirmed_with_responding_family_invalid_until_resolved',
      'request_cancelled (confirmed) with a still-responding dispatched family is invalid until that family reaches terminal.',
      'invalid',
      [eventFor(1, 'family_queued', 'chatgpt'), eventFor(2, 'family_dispatched', 'chatgpt'), eventFor(3, 'family_response_started', 'chatgpt'), eventFor(4, 'request_cancelled')],
    ),
    reduceCase(
      'cancel_04_requested_then_stopped_then_confirmed_valid',
      'request_cancel_requested, then every selected family stopped by Commander, then request_cancelled is valid.',
      'valid',
      requestedThenStoppedThenConfirmed,
    ),
    reduceCase(
      'cancel_05_direct_confirmation_without_prior_request_valid',
      'request_cancelled remains valid without a prior request_cancel_requested event.',
      'valid',
      directConfirmationWithoutPriorRequest,
    ),
    caseResult(
      'cancel_06_duplicate_requests_deterministic',
      'Two distinct request_cancel_requested events produce the same final state as one -- neither mutates cancellation.',
      'valid',
      singleRequest.ok && duplicateRequests.ok && JSON.stringify(singleRequest.finalState) === JSON.stringify(duplicateRequests.finalState),
    ),
  ]
}

// Phase 47C-2R Correction 2: audit_scope_declared/audit_completed cannot be
// re-declared, downgraded, or upgraded after an audit_completed for this
// request has already been applied (Option A: prohibit all re-declaration).
function auditRedeclarationCases(): CouncilProgressValidationCase[] {
  const completeAudit = { audit: { scope: 'complete_record' as const, reviewType: 'external_family' as const, expectedFamilies: ['chatgpt', 'claude'] as CouncilOrchestrationFamily[], receivedFamilies: ['chatgpt', 'claude'] as CouncilOrchestrationFamily[], missingFamilies: [] as CouncilOrchestrationFamily[], currentTurnPriorResponsesReceived: true } }
  const partialAudit = { audit: { scope: 'partial_record' as const, reviewType: 'synthetic_integrity' as const, expectedFamilies: ['chatgpt', 'claude'] as CouncilOrchestrationFamily[], receivedFamilies: ['chatgpt'] as CouncilOrchestrationFamily[], missingFamilies: ['claude'] as CouncilOrchestrationFamily[], currentTurnPriorResponsesReceived: false } }

  const redeclareAfterCompletion = replayCouncilProgressEvents(makeTerminalProgressState(), [
    eventFor(1, 'audit_scope_declared', undefined, { payload: completeAudit }),
    eventFor(2, 'audit_completed', undefined, { payload: completeAudit }),
    eventFor(3, 'audit_scope_declared', undefined, { payload: partialAudit }),
  ])
  const duplicateCompletionRejected = replayCouncilProgressEvents(makeTerminalProgressState(), [
    eventFor(1, 'audit_scope_declared', undefined, { payload: completeAudit }),
    eventFor(2, 'audit_completed', undefined, { payload: completeAudit }),
    eventFor(3, 'audit_completed', undefined, { eventId: councilProgressEventId('second-audit-completed'), payload: completeAudit }),
  ])
  const downgradeAfterCompletion = replayCouncilProgressEvents(makeTerminalProgressState(), [
    eventFor(1, 'audit_scope_declared', undefined, { payload: completeAudit }),
    eventFor(2, 'audit_completed', undefined, { payload: completeAudit }),
    eventFor(3, 'audit_scope_declared', undefined, { payload: partialAudit }),
  ])
  const upgradeAfterCompletion = replayCouncilProgressEvents(makeTerminalProgressState(), [
    eventFor(1, 'audit_scope_declared', undefined, { payload: partialAudit }),
    eventFor(2, 'audit_completed', undefined, { payload: partialAudit }),
    eventFor(3, 'audit_scope_declared', undefined, { payload: completeAudit }),
  ])
  const truthPreservedAttempt = replayCouncilProgressEvents(makeTerminalProgressState(), [
    eventFor(1, 'audit_scope_declared', undefined, { payload: completeAudit }),
    eventFor(2, 'audit_completed', undefined, { payload: completeAudit }),
  ])
  const truthPreservedAfterRejectedRedeclare = replayCouncilProgressEvents(makeTerminalProgressState(), [
    eventFor(1, 'audit_scope_declared', undefined, { payload: completeAudit }),
    eventFor(2, 'audit_completed', undefined, { payload: completeAudit }),
    eventFor(3, 'audit_scope_declared', undefined, { payload: partialAudit }),
  ])

  return [
    caseResult('redeclare_01_after_completion_rejected', 'audit_scope_declared after audit_completed is rejected.', 'invalid', redeclareAfterCompletion.ok),
    caseResult('redeclare_02_duplicate_completion_rejected', 'A second audit_completed for the same request is rejected.', 'invalid', duplicateCompletionRejected.ok),
    caseResult('redeclare_03_downgrade_after_completion_rejected', 'Downgrading scope (complete_record -> partial_record) after completion is rejected.', 'invalid', downgradeAfterCompletion.ok),
    caseResult('redeclare_04_upgrade_after_completion_rejected', 'Upgrading scope (partial_record -> complete_record) after completion is rejected.', 'invalid', upgradeAfterCompletion.ok),
    caseResult(
      'redeclare_05_prior_completed_truth_survives_rejected_attempt',
      'A rejected redeclare attempt leaves the completed audit truth in finalState untouched.',
      'valid',
      JSON.stringify(truthPreservedAttempt.finalState.redTeamAudit) === JSON.stringify(truthPreservedAfterRejectedRedeclare.finalState.redTeamAudit),
    ),
    reduceCase(
      'redeclare_06_single_declare_then_complete_valid',
      'A normal single declare-then-complete sequence (no redeclare) remains valid.',
      'valid',
      [eventFor(1, 'audit_scope_declared', undefined, { payload: completeAudit }), eventFor(2, 'audit_completed', undefined, { payload: completeAudit })],
      makeTerminalProgressState(),
    ),
  ]
}

// Phase 47C-2R Correction 3: secret detection must catch case-insensitive,
// separator-insensitive phrasings while not falsely rejecting benign
// lookalike phrases.
function secretPatternCases(): CouncilProgressValidationCase[] {
  const unsafePhrasings: [string, string][] = [
    ['access_token_underscore', 'access_token'],
    ['access_token_hyphen', 'access-token'],
    ['access_token_spaced', 'access token'],
    ['access_token_upper', 'ACCESS TOKEN'],
    ['api_key_hyphen', 'api-key'],
    ['api_key_spaced', 'api key'],
    ['private_key_underscore', 'private_key'],
    ['private_key_hyphen', 'private-key'],
    ['private_key_spaced', 'private key'],
    ['raw_prompt_hyphen', 'raw-prompt'],
    ['raw_prompt_spaced', 'raw prompt'],
    ['chain_of_thought_underscore', 'chain_of_thought'],
    ['chain_of_thought_spaced', 'chain of thought'],
    ['hidden_reasoning_hyphen', 'hidden-reasoning'],
    ['hidden_reasoning_spaced', 'hidden reasoning'],
    ['cookie_policy_plus_access_token', 'cookie policy updated; access token leaked'],
  ]
  const safePhrasings: [string, string][] = [
    ['key_result', 'key result'],
    ['reasoning_category', 'reasoning category'],
    ['cookie_policy', 'cookie policy'],
    ['prompt_version', 'prompt version'],
  ]

  const unsafeCases = unsafePhrasings.map(([label, text]) =>
    validateEventCase(
      `hardening_01_${label}_rejected`,
      `Secret pattern catches "${text}" regardless of separator/casing.`,
      'invalid',
      eventFor(1, 'diagnostic_recorded', undefined, {
        payload: { diagnostic: { category: 'validation', code: 'probe', safeMessage: `payload contains ${text} value` } },
      }),
    ),
  )
  const safeCases = safePhrasings.map(([label, text]) =>
    validateEventCase(
      `hardening_02_${label}_not_falsely_rejected`,
      `Benign phrase "${text}" is not falsely rejected.`,
      'valid',
      eventFor(1, 'diagnostic_recorded', undefined, {
        payload: { diagnostic: { category: 'validation', code: 'probe', safeMessage: `see the ${text} for details` } },
      }),
    ),
  )
  return [...unsafeCases, ...safeCases]
}

// Phase 47C-2R Correction 4: payload.fallback.safeDiagnosticReason and
// payload.audit.notes must be checked, and no nested array/object field can
// bypass validation. Several cases hand-build a raw envelope (bypassing
// createCouncilProgressEvent entirely) so the factory cannot share a blind
// spot with its own test.
function nestedDiagnosticFieldCases(): CouncilProgressValidationCase[] {
  const unsafeFallback = eventFor(1, 'fallback_completed', 'grok', {
    payload: {
      fallback: {
        primaryFamily: 'grok',
        primaryProvider: 'xai',
        primaryOutcome: 'failed',
        primaryFailureCategory: 'provider_error',
        fallbackProviderOrMechanism: 'static-integrity-note',
        fallbackOutcome: 'complete',
        fallbackOutputRendered: true,
        fallbackReplacedVisiblePrimary: true,
        commanderInformed: true,
        safeDiagnosticReason: 'primary failed while echoing a raw prompt excerpt',
      },
    },
  })
  const unsafeAuditNotes = eventFor(1, 'audit_scope_declared', undefined, {
    payload: {
      audit: {
        scope: 'unknown_scope',
        reviewType: 'synthetic_integrity',
        expectedFamilies: ['chatgpt'],
        receivedFamilies: [],
        missingFamilies: ['chatgpt'],
        currentTurnPriorResponsesReceived: false,
        notes: 'blocked because hidden reasoning was present in the transcript',
      },
    },
  })
  const unsafeInArray = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'diagnostic_recorded',
    source: 'diagnostic_layer',
    payload: {
      diagnostic: { category: 'validation', code: 'probe', safeMessage: 'all clear' },
      extraTrace: ['fine', 'contains a raw prompt excerpt', 'fine'],
    },
  })
  const unsafeInNestedObject = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'diagnostic_recorded',
    source: 'diagnostic_layer',
    payload: {
      diagnostic: { category: 'validation', code: 'probe', safeMessage: 'all clear' },
      extraMetadata: { detail: 'contains chain_of_thought excerpt' },
    },
  })
  const safeNestedObject = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'diagnostic_recorded',
    source: 'diagnostic_layer',
    payload: {
      diagnostic: { category: 'validation', code: 'probe', safeMessage: 'all clear' },
      extraMetadata: { detail: 'prompt version 3, cookie policy acknowledged' },
    },
  })

  return [
    validateEventCase('nested_01_fallback_safe_diagnostic_reason_rejected', 'Unsafe text inside payload.fallback.safeDiagnosticReason is rejected.', 'invalid', unsafeFallback),
    validateEventCase('nested_02_audit_notes_rejected', 'Unsafe text inside payload.audit.notes is rejected.', 'invalid', unsafeAuditNotes),
    validateEventCase('nested_03_array_element_rejected', 'Unsafe text nested inside an array element (hand-built, bypassing the factory) is rejected.', 'invalid', unsafeInArray),
    validateEventCase('nested_04_nested_object_field_rejected', 'Unsafe text nested inside a nested metadata object (hand-built, bypassing the factory) is rejected.', 'invalid', unsafeInNestedObject),
    validateEventCase('nested_05_safe_nested_object_not_falsely_rejected', 'Benign nested metadata text (hand-built, bypassing the factory) is not falsely rejected.', 'valid', safeNestedObject),
  ]
}

// Phase 47C-2R Correction 5: the dead top-level envelope `audit` field has
// been removed; confirm factory output no longer carries it.
function topLevelAuditFieldCases(): CouncilProgressValidationCase[] {
  const created = createCouncilProgressEvent({
    eventId: 'removal-check',
    requestId: PROGRESS_FIXTURE_IDS.requestId,
    sequence: 1,
    eventType: 'request_created',
    occurredAt: PROGRESS_FIXTURE_TIME,
    source: 'server_orchestrator',
  })
  return [
    caseResult(
      'removal_01_top_level_audit_field_absent',
      'The dead top-level envelope audit field has been removed from factory output.',
      'valid',
      !Object.prototype.hasOwnProperty.call(created, 'audit'),
    ),
  ]
}

// Phase 47C-2R2 Correction 1: confirmed cancellation (request_cancelled)
// must be rejected unless every selected family is terminal -- checked here
// via the reducer/replay path, mirroring the request-state-layer fix.
function cancellationClosureCases(): CouncilProgressValidationCase[] {
  return [
    reduceCase(
      'closure2_01_cancelled_with_selected_waiting_invalid',
      'request_cancelled with a selected family still waiting (never dispatched) is invalid.',
      'invalid',
      [eventFor(1, 'request_cancelled')],
    ),
    reduceCase(
      'closure2_02_cancelled_with_selected_queued_invalid',
      'request_cancelled with a selected family only queued (not yet dispatched) is invalid.',
      'invalid',
      [eventFor(1, 'family_queued', 'chatgpt'), eventFor(2, 'request_cancelled')],
    ),
    reduceCase(
      'closure2_03_cancel_requested_with_waiting_family_valid',
      'request_cancel_requested with every selected family still waiting remains valid/open (non-closing).',
      'valid',
      [eventFor(1, 'request_cancel_requested')],
    ),
    reduceCase(
      'closure2_04_requested_then_not_reached_then_confirmed_valid',
      'request_cancel_requested, then every selected family reaches not_reached, then request_cancelled is valid.',
      'valid',
      [eventFor(1, 'request_cancel_requested'), eventFor(2, 'family_not_reached', 'chatgpt'), eventFor(3, 'family_not_reached', 'claude'), eventFor(4, 'request_cancelled')],
    ),
    reduceCase(
      'closure2_05_expected_unselected_waiting_does_not_block_cancellation',
      'An expected-but-unselected family left waiting does not block confirmed cancellation closure.',
      'valid',
      [eventFor(1, 'request_cancelled')],
      makeProgressRequestState({
        expectedFamilies: ['chatgpt', 'grok'],
        selectedFamilies: ['chatgpt'],
        familyExecutions: [
          terminalExecution('chatgpt', 'complete'),
          makeExecution({
            family: 'grok',
            requestId: PROGRESS_FIXTURE_IDS.requestId,
            executionId: PROGRESS_FIXTURE_IDS.grokExecutionId,
            lifecycle: 'waiting',
            outcome: null,
            queuedAt: null,
            dispatchedAt: null,
            completedAt: null,
          }),
        ],
      }),
    ),
  ]
}

// Phase 47C-2R2/R3: recursive or shape-sensitive validation must never
// throw on cyclic/malformed input -- it must fail closed with a specific
// structured issue code. Every case below wraps the validator call in
// try/catch (see noThrowStructuredCase) and treats a thrown exception as an
// unconditional failure, independent of expected polarity.
function noThrowStructuredCase(
  caseId: string,
  description: string,
  expected: 'valid' | 'invalid',
  run: () => { ok: boolean; issues: { code: string; path: string; message: string }[] },
  requiredIssueCode?: string,
): CouncilProgressValidationCase {
  try {
    const result = run()
    const hasRequiredIssue = requiredIssueCode ? result.issues.some(issue => issue.code === requiredIssueCode) : true
    const observed: 'valid' | 'invalid' = result.ok ? 'valid' : 'invalid'
    const structurallyCorrect = requiredIssueCode
      ? (!result.ok && hasRequiredIssue)
      : result.ok === (expected === 'valid')
    return {
      caseId,
      description,
      expected,
      observed,
      result: structurallyCorrect ? 'PASS' : 'FAIL',
      details: result.issues.map(issue => `${issue.code}:${issue.path}`),
    }
  } catch (error) {
    return {
      caseId,
      description,
      expected,
      observed: 'invalid',
      result: 'FAIL',
      details: [`THREW_EXCEPTION_INSTEAD_OF_STRUCTURED_ISSUE: ${error instanceof Error ? error.message : String(error)}`],
    }
  }
}

function cycleSafetyCases(): CouncilProgressValidationCase[] {
  const selfRefPayload: Record<string, unknown> = { diagnostic: { category: 'validation', code: 'probe', safeMessage: 'ok' } }
  selfRefPayload.self = selfRefPayload
  const selfRefEvent = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'diagnostic_recorded',
    source: 'diagnostic_layer',
    payload: selfRefPayload,
  })

  const root: Record<string, unknown> = { diagnostic: { category: 'validation', code: 'probe', safeMessage: 'ok' } }
  const child: Record<string, unknown> = { name: 'child' }
  root.child = child
  child.parent = root
  const parentChildCycleEvent = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'diagnostic_recorded',
    source: 'diagnostic_layer',
    payload: root,
  })

  const cyclicArray: unknown[] = []
  cyclicArray.push(cyclicArray)
  const arrayCycleEvent = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'diagnostic_recorded',
    source: 'diagnostic_layer',
    payload: { diagnostic: { category: 'validation', code: 'probe', safeMessage: 'ok' }, trace: cyclicArray },
  })

  const diagCycle: Record<string, unknown> = { category: 'validation', code: 'probe', safeMessage: 'ok' }
  diagCycle.self = diagCycle
  const diagnosticCycleEvent = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'diagnostic_recorded',
    source: 'diagnostic_layer',
    payload: { diagnostic: { category: 'validation', code: 'probe', safeMessage: 'ok' } },
    diagnostic: diagCycle,
  })

  const shared = { note: 'shared safe value' }
  const sharedRefEvent = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'diagnostic_recorded',
    source: 'diagnostic_layer',
    payload: { diagnostic: { category: 'validation', code: 'probe', safeMessage: 'ok' }, a: shared, b: shared },
  })

  function buildDeepObject(depth: number): Record<string, unknown> {
    let node: Record<string, unknown> = { leaf: true }
    for (let i = 0; i < depth; i += 1) node = { child: node }
    return node
  }
  const deepEvent = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'diagnostic_recorded',
    source: 'diagnostic_layer',
    payload: { diagnostic: { category: 'validation', code: 'probe', safeMessage: 'ok' }, deep: buildDeepObject(500) },
  })

  const unsafeCyclic: Record<string, unknown> = { leak: 'contains an access token here' }
  unsafeCyclic.self = unsafeCyclic
  const unsafeCyclicEvent = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'diagnostic_recorded',
    source: 'diagnostic_layer',
    payload: { diagnostic: { category: 'validation', code: 'probe', safeMessage: 'ok' }, unsafeCyclic },
  })

  return [
    noThrowStructuredCase('cycle_01_payload_self_reference_invalid_no_throw', 'payload.self = payload is rejected with a structured issue and does not throw.', 'invalid', () => validateCouncilProgressEventEnvelope(selfRefEvent), 'cyclic_payload_not_serializable'),
    noThrowStructuredCase('cycle_02_parent_child_cycle_invalid_no_throw', 'A nested child.parent = root cycle is rejected with a structured issue and does not throw.', 'invalid', () => validateCouncilProgressEventEnvelope(parentChildCycleEvent), 'cyclic_payload_not_serializable'),
    noThrowStructuredCase('cycle_03_array_self_cycle_invalid_no_throw', 'An array containing itself is rejected with a structured issue and does not throw.', 'invalid', () => validateCouncilProgressEventEnvelope(arrayCycleEvent), 'cyclic_payload_not_serializable'),
    noThrowStructuredCase('cycle_04_event_diagnostic_cycle_invalid_no_throw', 'A cycle inside the top-level event.diagnostic field is rejected with a structured issue and does not throw.', 'invalid', () => validateCouncilProgressEventEnvelope(diagnosticCycleEvent), 'cyclic_payload_not_serializable'),
    noThrowStructuredCase('cycle_05_repeated_shared_reference_not_a_cycle_valid', 'The same object referenced twice as siblings (a DAG, not a cycle) is not falsely rejected.', 'valid', () => validateCouncilProgressEventEnvelope(sharedRefEvent)),
    noThrowStructuredCase('cycle_06_deep_finite_object_valid_no_throw', 'A deep but finite (non-cyclic) nested object validates without throwing.', 'valid', () => validateCouncilProgressEventEnvelope(deepEvent)),
    noThrowStructuredCase('cycle_07_cyclic_with_unsafe_text_invalid_no_throw', 'A cyclic object that also contains unsafe text still fails closed with the cyclic issue, without throwing.', 'invalid', () => validateCouncilProgressEventEnvelope(unsafeCyclicEvent), 'cyclic_payload_not_serializable'),
    noThrowStructuredCase('cycle_08_event_sequence_cyclic_no_throw', 'validateEventSequence never throws on a cyclic event and returns a structured issue.', 'invalid', () => validateEventSequence([selfRefEvent]), 'cyclic_payload_not_serializable'),
  ]
}

// Phase 47C-2R3 Correction: event.payload of null/undefined/string/number/
// boolean/array must never throw -- it must fail closed with a structured
// 'invalid_payload_shape' issue. Every case is a hand-built raw event
// (bypassing the factory, which always produces a well-formed payload).
function payloadShapeCases(): CouncilProgressValidationCase[] {
  const primitiveShapes: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['string', 'not-an-object'],
    ['number', 42],
    ['boolean', true],
    ['array', ['not', 'a', 'payload']],
  ]
  const genericShapeCases = primitiveShapes.map(([label, payload]) =>
    noThrowStructuredCase(
      `payload_shape_01_${label}_invalid_no_throw`,
      `payload: ${label} is rejected with a structured invalid_payload_shape issue and does not throw.`,
      'invalid',
      () => validateCouncilProgressEventEnvelope(rawMalformedEvent({
        schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
        eventType: 'request_started',
        source: 'server_orchestrator',
        payload,
      })),
      'invalid_payload_shape',
    ),
  )

  const nullPayloadDiagnostic = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'diagnostic_recorded',
    source: 'diagnostic_layer',
    payload: null,
  })
  const nullPayloadFallback = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'fallback_completed',
    family: 'chatgpt',
    source: 'fallback_layer',
    payload: null,
  })
  const nullPayloadAudit = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'audit_scope_declared',
    source: 'integrity_layer',
    payload: null,
  })
  const nullPayloadLineage = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'family_prior_response_delivered',
    family: 'claude',
    source: 'provider_adapter',
    payload: null,
  })

  return [
    ...genericShapeCases,
    noThrowStructuredCase('payload_shape_02_diagnostic_recorded_null_payload_invalid_no_throw', 'diagnostic_recorded with payload: null is rejected with a structured issue and does not throw (previously threw reading payload.diagnostic).', 'invalid', () => validateCouncilProgressEventEnvelope(nullPayloadDiagnostic), 'invalid_payload_shape'),
    noThrowStructuredCase('payload_shape_03_fallback_event_null_payload_invalid_no_throw', 'A fallback event with payload: null is rejected with a structured issue and does not throw (previously threw reading payload.fallback).', 'invalid', () => validateCouncilProgressEventEnvelope(nullPayloadFallback), 'invalid_payload_shape'),
    noThrowStructuredCase('payload_shape_04_audit_event_null_payload_invalid_no_throw', 'An audit event with payload: null is rejected with a structured issue and does not throw (previously threw reading payload.audit).', 'invalid', () => validateCouncilProgressEventEnvelope(nullPayloadAudit), 'invalid_payload_shape'),
    noThrowStructuredCase('payload_shape_05_lineage_event_null_payload_invalid_no_throw', 'A lineage-bearing event (family_prior_response_delivered) with payload: null is rejected with a structured issue and does not throw (previously threw reading payload.priorResponse).', 'invalid', () => validateCouncilProgressEventEnvelope(nullPayloadLineage), 'invalid_payload_shape'),
  ]
}

// Phase 47C-2R4 Correction: validateEventSequence must reject every
// malformed payload shape validateCouncilProgressEventEnvelope already
// rejects, using the same shared shape rule (not a second independent one),
// never throw, and stay deterministic. All events are hand-built via
// rawMalformedEvent, bypassing the factory.
function sequencePayloadShapeCases(): CouncilProgressValidationCase[] {
  const primitiveShapes: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['string', 'not-an-object'],
    ['number', 42],
    ['boolean', true],
    ['array', ['not', 'a', 'payload']],
  ]
  const genericSequenceCases = primitiveShapes.map(([label, payload]) =>
    noThrowStructuredCase(
      `sequence_shape_01_${label}_invalid_no_throw`,
      `validateEventSequence rejects payload: ${label} with a structured invalid_payload_shape issue and does not throw.`,
      'invalid',
      () => validateEventSequence([rawMalformedEvent({
        schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
        eventType: 'request_started',
        source: 'server_orchestrator',
        payload,
      })]),
      'invalid_payload_shape',
    ),
  )

  const nullPayloadDiagnostic = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'diagnostic_recorded',
    source: 'diagnostic_layer',
    payload: null,
  })
  const nullPayloadFallback = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'fallback_completed',
    family: 'chatgpt',
    source: 'fallback_layer',
    payload: null,
  })
  const nullPayloadAudit = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'audit_scope_declared',
    source: 'integrity_layer',
    payload: null,
  })
  const nullPayloadLineage = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'family_prior_response_delivered',
    family: 'claude',
    source: 'provider_adapter',
    payload: null,
  })

  const selfRefPayload: Record<string, unknown> = { diagnostic: { category: 'validation', code: 'probe', safeMessage: 'ok' } }
  selfRefPayload.self = selfRefPayload
  const cyclicEvent = rawMalformedEvent({
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventType: 'diagnostic_recorded',
    source: 'diagnostic_layer',
    payload: selfRefPayload,
  })

  const validSequence = [eventFor(1, 'request_created'), eventFor(2, 'request_started')]

  return [
    ...genericSequenceCases,
    noThrowStructuredCase('sequence_shape_02_diagnostic_recorded_null_payload_invalid_no_throw', 'validateEventSequence rejects diagnostic_recorded with payload: null and does not throw.', 'invalid', () => validateEventSequence([nullPayloadDiagnostic]), 'invalid_payload_shape'),
    noThrowStructuredCase('sequence_shape_03_fallback_event_null_payload_invalid_no_throw', 'validateEventSequence rejects a fallback event with payload: null and does not throw.', 'invalid', () => validateEventSequence([nullPayloadFallback]), 'invalid_payload_shape'),
    noThrowStructuredCase('sequence_shape_04_audit_event_null_payload_invalid_no_throw', 'validateEventSequence rejects an audit event with payload: null and does not throw.', 'invalid', () => validateEventSequence([nullPayloadAudit]), 'invalid_payload_shape'),
    noThrowStructuredCase('sequence_shape_05_lineage_event_null_payload_invalid_no_throw', 'validateEventSequence rejects a lineage-bearing event with payload: null and does not throw.', 'invalid', () => validateEventSequence([nullPayloadLineage]), 'invalid_payload_shape'),
    noThrowStructuredCase('sequence_shape_06_cyclic_event_still_cyclic_issue_no_throw', 'A cyclic malformed event through validateEventSequence still returns cyclic_payload_not_serializable (not invalid_payload_shape) and never throws -- cycle detection takes precedence and is unweakened by the new shape guard.', 'invalid', () => validateEventSequence([cyclicEvent]), 'cyclic_payload_not_serializable'),
    noThrowStructuredCase('sequence_shape_07_valid_sequence_with_valid_payloads_remains_valid', 'A normal valid sequence with well-formed payloads is unaffected by the new shape guard.', 'valid', () => validateEventSequence(validSequence)),
  ]
}

export function runCouncilProgressEventsValidation(): CouncilProgressValidationCase[] {
  return [
    ...basicEventCases(),
    ...orderingCases(),
    ...familyLifecycleCases(),
    ...sequentialCouncilCases(),
    ...fallbackCases(),
    ...auditCases(),
    ...closureCases(),
    ...replayCases(),
    ...adapterCases(),
    ...cancellationCases(),
    ...auditRedeclarationCases(),
    ...secretPatternCases(),
    ...nestedDiagnosticFieldCases(),
    ...topLevelAuditFieldCases(),
    ...cancellationClosureCases(),
    ...cycleSafetyCases(),
    ...payloadShapeCases(),
    ...sequencePayloadShapeCases(),
  ]
}

if (process.argv[1]?.endsWith('validation.ts')) {
  const results = runCouncilProgressEventsValidation()
  for (const result of results) {
    console.log(`${result.result} ${result.caseId}: ${result.description} (${result.observed})`)
    if (result.result === 'FAIL') {
      for (const detail of result.details) console.log(`  ${detail}`)
    }
  }
  const passed = results.filter(result => result.result === 'PASS').length
  console.log(`Council progress-events validation: ${passed}/${results.length} PASS`)
  if (passed !== results.length) process.exitCode = 1
}
