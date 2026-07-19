import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilProgressValidationCase } from './types'
import {
  buildSyntheticIntegrityAuditPayload,
  createCouncilProgressRuntimeTracker,
  providerStatusToProgressOutcome,
  providerStatusToReadiness,
} from './runtime'
import { createCouncilProgressEvent } from './event-factory'
import { replayCouncilProgressEvents } from './replay'
import { validateEventSequence } from './invariants'
import { makeProgressRequestState, PROGRESS_FIXTURE_IDS } from './fixtures'
import { councilFamilyExecutionId, defaultVisibilityState } from '@/lib/council/request-state/types'

type ProviderResultStatus = 'OK' | 'FAILED' | 'TIMED_OUT' | 'UNAVAILABLE'

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

function makeTracker(families: CouncilOrchestrationFamily[] = ['chatgpt', 'claude']) {
  const tracker = createCouncilProgressRuntimeTracker({
    requestIdSeed: 'validation-47c3',
    commanderTurnRef: 'validation-turn',
    flowMode: families.length === 1 ? 'direct' : 'full_council',
    executionStrategy: families.length === 1 ? 'single_family_direct' : 'server_parallel',
    expectedFamilies: families,
    selectedFamilies: families,
    selectionAuthority: families.length === 1 ? 'direct_invocation' : 'system_selected',
    createdAt: '2026-07-19T00:00:00.000Z',
  })
  tracker.record({ eventType: 'request_created', source: 'server_orchestrator', occurredAt: '2026-07-19T00:00:01.000Z' })
  tracker.record({
    eventType: 'request_selection_resolved',
    source: 'server_orchestrator',
    occurredAt: '2026-07-19T00:00:02.000Z',
    payload: { selectedFamilies: families, expectedFamilies: families },
  })
  tracker.record({ eventType: 'request_started', source: 'server_orchestrator', occurredAt: '2026-07-19T00:00:03.000Z' })
  return tracker
}

function dispatchFamily(tracker: ReturnType<typeof makeTracker>, family: CouncilOrchestrationFamily): void {
  tracker.record({ eventType: 'family_queued', source: 'server_orchestrator', family })
  tracker.record({ eventType: 'family_dispatched', source: 'provider_adapter', family, payload: { readiness: 'configured', providerLabel: family } })
  tracker.record({ eventType: 'family_response_started', source: 'provider_adapter', family })
}

function terminalFamily(
  tracker: ReturnType<typeof makeTracker>,
  family: CouncilOrchestrationFamily,
  status: ProviderResultStatus,
): void {
  if (status === 'OK') {
    tracker.record({ eventType: 'family_response_completed', source: 'provider_adapter', family, payload: { outcome: 'complete', readiness: 'connected' } })
  } else if (status === 'TIMED_OUT') {
    tracker.record({ eventType: 'family_timed_out', source: 'provider_adapter', family, payload: { outcome: 'timed_out', timeoutMs: 10000, readiness: 'configured' } })
  } else if (status === 'UNAVAILABLE') {
    tracker.record({ eventType: 'family_not_reached', source: 'provider_adapter', family, payload: { outcome: 'not_reached', readiness: 'unavailable' } })
  } else {
    tracker.record({ eventType: 'family_failed', source: 'provider_adapter', family, payload: { outcome: 'failed', readiness: 'configured' } })
  }
}

function makeSequentialTracker(family: CouncilOrchestrationFamily = 'claude') {
  const tracker = createCouncilProgressRuntimeTracker({
    requestIdSeed: `validation-47c3-sequential-${family}`,
    commanderTurnRef: 'validation-sequential-turn',
    flowMode: 'full_council',
    executionStrategy: 'frontend_sequential_single_family',
    expectedFamilies: [family],
    selectedFamilies: [family],
    selectionAuthority: 'continuation_selected',
    createdAt: '2026-07-19T01:00:00.000Z',
    logicalRequestId: 'logical-validation-turn',
    logicalTurnIndex: 1,
    logicalTurnTotal: 3,
    logicalExpectedFamilies: ['chatgpt', 'claude', 'grok'],
  })
  tracker.record({ eventType: 'request_created', source: 'server_orchestrator', occurredAt: '2026-07-19T01:00:01.000Z' })
  tracker.record({
    eventType: 'request_selection_resolved',
    source: 'server_orchestrator',
    occurredAt: '2026-07-19T01:00:02.000Z',
    payload: { selectedFamilies: [family], expectedFamilies: [family] },
  })
  tracker.record({ eventType: 'request_started', source: 'server_orchestrator', occurredAt: '2026-07-19T01:00:03.000Z' })
  return tracker
}

function makeRawEvent(
  tracker: ReturnType<typeof makeTracker>,
  overrides: Partial<ReturnType<typeof createCouncilProgressEvent>> = {},
): ReturnType<typeof createCouncilProgressEvent> {
  const snapshot = tracker.snapshot()
  return createCouncilProgressEvent({
    eventId: String(overrides.eventId ?? `raw-${snapshot.eventCount + 1}`),
    requestId: overrides.requestId ?? tracker.requestId,
    sequence: overrides.sequence ?? snapshot.eventCount + 1,
    eventType: overrides.eventType ?? 'diagnostic_recorded',
    occurredAt: overrides.occurredAt ?? '2026-07-19T02:00:00.000Z',
    source: overrides.source ?? 'diagnostic_layer',
    family: overrides.family ?? null,
    executionId: overrides.executionId ?? null,
    payload: overrides.payload ?? {
      diagnostic: {
        category: 'validation',
        code: 'raw_test',
        safeMessage: 'Raw runtime boundary validation.',
      },
    },
    visibility: overrides.visibility ?? defaultVisibilityState({ diagnosticOnly: true }),
  })
}

function runtimeCases(): CouncilProgressValidationCase[] {
  const complete = makeTracker(['chatgpt', 'claude'])
  dispatchFamily(complete, 'chatgpt')
  dispatchFamily(complete, 'claude')
  terminalFamily(complete, 'chatgpt', 'OK')
  terminalFamily(complete, 'claude', 'OK')
  const completedClose = complete.closeIfTerminal()
  const completeSnapshot = complete.snapshot()

  const partial = makeTracker(['chatgpt', 'claude'])
  dispatchFamily(partial, 'chatgpt')
  dispatchFamily(partial, 'claude')
  terminalFamily(partial, 'chatgpt', 'OK')
  const prematureClose = partial.record({ eventType: 'request_completed', source: 'server_orchestrator' })

  const failed = makeTracker(['grok'])
  dispatchFamily(failed, 'grok')
  terminalFamily(failed, 'grok', 'FAILED')
  const failedClose = failed.closeIfTerminal()
  const failedSnapshot = failed.snapshot()

  const timedOut = makeTracker(['grok'])
  dispatchFamily(timedOut, 'grok')
  terminalFamily(timedOut, 'grok', 'TIMED_OUT')
  const timeoutClose = timedOut.closeIfTerminal()
  const timeoutSnapshot = timedOut.snapshot()

  const unavailable = makeTracker(['gemini'])
  terminalFamily(unavailable, 'gemini', 'UNAVAILABLE')
  const unavailableClose = unavailable.closeIfTerminal()
  const unavailableSnapshot = unavailable.snapshot()

  const partialUsable = makeTracker(['chatgpt', 'claude'])
  dispatchFamily(partialUsable, 'chatgpt')
  dispatchFamily(partialUsable, 'claude')
  terminalFamily(partialUsable, 'chatgpt', 'OK')
  terminalFamily(partialUsable, 'claude', 'FAILED')
  const partialUsableClose = partialUsable.closeIfTerminal()
  const partialUsableSnapshot = partialUsable.snapshot()

  const totalFailure = makeTracker(['chatgpt', 'claude'])
  dispatchFamily(totalFailure, 'chatgpt')
  dispatchFamily(totalFailure, 'claude')
  terminalFamily(totalFailure, 'chatgpt', 'FAILED')
  terminalFamily(totalFailure, 'claude', 'FAILED')
  const totalFailureClose = totalFailure.closeIfTerminal()

  const totalTimeout = makeTracker(['grok'])
  dispatchFamily(totalTimeout, 'grok')
  terminalFamily(totalTimeout, 'grok', 'TIMED_OUT')
  const totalTimeoutClose = totalTimeout.closeIfTerminal()

  return [
    caseResult('runtime_01_request_acceptance_records_created_started', 'Runtime tracker records request acceptance and start.', 'valid', completeSnapshot.events.some(event => event.eventType === 'request_created') && completeSnapshot.events.some(event => event.eventType === 'request_started')),
    caseResult('runtime_02_selection_records_selected_families', 'Runtime tracker records selected families.', 'valid', completeSnapshot.state.selectedFamilies.join(',') === 'chatgpt,claude'),
    caseResult('runtime_03_family_queued_dispatched_started', 'Family queued/dispatched/started events are recorded.', 'valid', ['family_queued', 'family_dispatched', 'family_response_started'].every(type => completeSnapshot.events.some(event => event.eventType === type && event.family === 'chatgpt'))),
    caseResult('runtime_04_family_completed_terminal', 'Completed provider reaches terminal complete.', 'valid', completeSnapshot.state.familyExecutions.every(record => record.lifecycle === 'terminal' && record.outcome === 'complete')),
    caseResult('runtime_05_close_after_all_terminal', 'Request closes after all selected families are terminal.', 'valid', Boolean(completedClose?.ok && completeSnapshot.status === 'closed')),
    caseResult('runtime_06_premature_completion_rejected', 'Request completion is rejected while a selected family is unresolved.', 'invalid', prematureClose.ok, prematureClose.ok ? [] : prematureClose.diagnostic.issueCodes),
    caseResult('runtime_07_failed_provider_terminal', 'Failed provider produces failed terminal outcome.', 'valid', Boolean(failedClose?.ok && failedSnapshot.state.completionSummary.failedCount === 1)),
    caseResult('runtime_08_timeout_provider_terminal', 'Timed-out provider produces timed_out terminal outcome.', 'valid', Boolean(timeoutClose?.ok && timeoutSnapshot.state.completionSummary.timedOutCount === 1)),
    caseResult('runtime_09_unavailable_provider_not_reached', 'Unavailable provider produces not_reached terminal outcome.', 'valid', Boolean(unavailableClose?.ok && unavailableSnapshot.state.completionSummary.notReachedCount === 1)),
    caseResult('runtime_10_provider_status_ok_maps_complete', 'Provider status OK maps to complete.', 'valid', providerStatusToProgressOutcome('OK') === 'complete'),
    caseResult('runtime_11_provider_status_timed_out_maps_timeout', 'Provider status TIMED_OUT maps to timed_out.', 'valid', providerStatusToProgressOutcome('TIMED_OUT') === 'timed_out'),
    caseResult('runtime_12_provider_status_unavailable_maps_not_reached', 'Provider status UNAVAILABLE maps to not_reached.', 'valid', providerStatusToProgressOutcome('UNAVAILABLE') === 'not_reached'),
    caseResult('runtime_13_provider_readiness_ok_connected', 'Provider status OK maps to readiness connected.', 'valid', providerStatusToReadiness('OK') === 'connected'),
    caseResult('runtime_14_provider_readiness_unavailable', 'Provider status UNAVAILABLE maps to readiness unavailable.', 'valid', providerStatusToReadiness('UNAVAILABLE') === 'unavailable'),
    caseResult('runtime_15_partial_usable_closes_completed', 'Partial provider failures close as completed when at least one usable family response exists.', 'valid', Boolean(partialUsableClose?.ok && partialUsableSnapshot.events.at(-1)?.eventType === 'request_completed')),
    caseResult('runtime_16_overall_failure_closes_failed', 'Overall failure closes as request_failed only when no usable family response exists.', 'valid', Boolean(totalFailureClose?.ok && totalFailure.snapshot().events.at(-1)?.eventType === 'request_failed')),
    caseResult('runtime_17_overall_timeout_closes_timed_out', 'Overall timeout closes as request_timed_out when no usable response exists.', 'valid', Boolean(totalTimeoutClose?.ok && totalTimeout.snapshot().events.at(-1)?.eventType === 'request_timed_out')),
  ]
}

function auditAndFailureCases(): CouncilProgressValidationCase[] {
  const tracker = makeTracker(['chatgpt'])
  dispatchFamily(tracker, 'chatgpt')
  terminalFamily(tracker, 'chatgpt', 'OK')
  const audit = buildSyntheticIntegrityAuditPayload({
    expectedFamilies: ['chatgpt'],
    providerResults: [{ family: 'ChatGPT', status: 'OK' }],
  })
  const declared = tracker.record({ eventType: 'audit_scope_declared', source: 'integrity_layer', payload: { audit } })
  const completed = tracker.record({ eventType: 'audit_completed', source: 'integrity_layer', payload: { audit } })
  const redeclared = tracker.record({ eventType: 'audit_scope_declared', source: 'integrity_layer', payload: { audit } })
  const after = tracker.snapshot()

  const diagnosticTracker = makeTracker(['chatgpt'])
  const unsafeDiagnostic = diagnosticTracker.record({
    eventType: 'diagnostic_recorded',
    source: 'diagnostic_layer',
    payload: {
      diagnostic: {
        category: 'provider',
        code: 'unsafe',
        safeMessage: 'bearer token exposed',
      },
    },
  })
  const diagnosticAfter = diagnosticTracker.snapshot()

  const auditPayload = buildSyntheticIntegrityAuditPayload({
    expectedFamilies: ['chatgpt', 'claude'],
    providerResults: [
      { family: 'ChatGPT', status: 'OK' },
      { family: 'Claude', status: 'FAILED' },
    ],
  })

  return [
    caseResult('runtime_18_audit_scope_declared_valid', 'Synthetic audit scope declaration is accepted.', 'valid', declared.ok),
    caseResult('runtime_19_audit_completed_valid', 'Synthetic audit completion is accepted.', 'valid', completed.ok),
    caseResult('runtime_20_audit_redeclare_rejected_live', 'Live ingestion rejects audit re-declaration after completion.', 'invalid', redeclared.ok, redeclared.ok ? [] : redeclared.diagnostic.issueCodes),
    caseResult('runtime_21_audit_redeclare_no_partial_mutation', 'Rejected audit redeclare does not mutate accepted event log.', 'valid', after.eventCount === 9 && after.rejectedEventCount === 1),
    caseResult('runtime_22_unsafe_diagnostic_fail_open', 'Unsafe diagnostic event is rejected without throwing or mutating state.', 'invalid', unsafeDiagnostic.ok, unsafeDiagnostic.ok ? [] : unsafeDiagnostic.diagnostic.issueCodes),
    caseResult('runtime_23_fail_open_retains_prior_events', 'Fail-open rejection preserves prior valid request events.', 'valid', diagnosticAfter.eventCount === 3 && diagnosticAfter.rejectedEventCount === 1),
    caseResult('runtime_24_synthetic_audit_partial_when_provider_failed', 'Synthetic integrity audit distinguishes partial provider record.', 'valid', auditPayload.scope === 'partial_record' && auditPayload.missingFamilies.includes('claude')),
  ]
}

function mutationAndBoundaryCases(): CouncilProgressValidationCase[] {
  const tracker = makeTracker(['chatgpt'])
  dispatchFamily(tracker, 'chatgpt')
  terminalFamily(tracker, 'chatgpt', 'OK')
  tracker.closeIfTerminal()
  const snapshot = tracker.snapshot()
  snapshot.events.length = 0
  snapshot.state.familyExecutions.length = 0
  const nextSnapshot = tracker.snapshot()

  const duplicateEvent = createCouncilProgressEvent({
    eventId: 'duplicate-unsafe-proof',
    requestId: PROGRESS_FIXTURE_IDS.requestId,
    sequence: 1,
    eventType: 'request_created',
    occurredAt: '2026-07-19T00:00:01.000Z',
    source: 'server_orchestrator',
  })
  const unsafeReplay = replayCouncilProgressEvents(makeProgressRequestState(), [
    duplicateEvent,
    { ...duplicateEvent, eventType: 'request_started' },
  ])
  const sequenceValidation = validateEventSequence([duplicateEvent, { ...duplicateEvent, eventType: 'request_started' }])

  const cancellationTracker = makeTracker(['chatgpt'])
  dispatchFamily(cancellationTracker, 'chatgpt')
  const cancelRequested = cancellationTracker.record({ eventType: 'request_cancel_requested', source: 'commander' })
  const afterCancelRequest = cancellationTracker.snapshot()
  const cancelConfirmedTooEarly = cancellationTracker.record({ eventType: 'request_cancelled', source: 'server_orchestrator' })

  return [
    caseResult('runtime_25_snapshot_mutation_isolated', 'Mutating a snapshot does not corrupt internal runtime state.', 'valid', nextSnapshot.events.length > 0 && nextSnapshot.state.familyExecutions.length === 1),
    caseResult('runtime_26_red_team_not_selected_as_provider', 'Synthetic integrity audit does not add Red Team to selected families.', 'valid', !nextSnapshot.state.selectedFamilies.includes('red_team')),
    caseResult('runtime_27_negative_proof_duplicate_guard_rejects_conflict', 'Negative proof: conflicting duplicate events are rejected by replay.', 'invalid', unsafeReplay.ok, unsafeReplay.issues.map(issue => issue.code)),
    caseResult('runtime_28_sequence_validator_conflict_matches_replay', 'Sequence validation also rejects conflicting duplicate event IDs.', 'invalid', sequenceValidation.ok, sequenceValidation.issues.map(issue => issue.code)),
    caseResult('runtime_29_cancel_requested_does_not_close', 'Runtime ingestion accepts request_cancel_requested without closing unresolved families.', 'valid', cancelRequested.ok && !afterCancelRequest.state.cancellation.cancelled && afterCancelRequest.state.completionSummary.missingTerminalFamilies.includes('chatgpt')),
    caseResult('runtime_30_cancel_confirmed_rejected_until_terminal', 'Runtime ingestion rejects request_cancelled while selected family is unresolved.', 'invalid', cancelConfirmedTooEarly.ok, cancelConfirmedTooEarly.ok ? [] : cancelConfirmedTooEarly.diagnostic.issueCodes),
  ]
}

function sequentialRuntimeCases(): CouncilProgressValidationCase[] {
  const success = makeSequentialTracker('claude')
  dispatchFamily(success, 'claude')
  terminalFamily(success, 'claude', 'OK')
  const audit = buildSyntheticIntegrityAuditPayload({
    expectedFamilies: ['claude'],
    providerResults: [{ family: 'Claude', status: 'OK' }],
  })
  success.record({ eventType: 'audit_scope_declared', source: 'integrity_layer', payload: { audit } })
  success.record({ eventType: 'audit_completed', source: 'integrity_layer', payload: { audit } })
  const successSnapshot = success.snapshot()

  const failure = makeSequentialTracker('grok')
  dispatchFamily(failure, 'grok')
  terminalFamily(failure, 'grok', 'FAILED')
  const failureAudit = buildSyntheticIntegrityAuditPayload({
    expectedFamilies: ['grok'],
    providerResults: [{ family: 'Grok', status: 'FAILED' }],
  })
  failure.record({ eventType: 'audit_scope_declared', source: 'integrity_layer', payload: { audit: failureAudit } })
  failure.record({ eventType: 'audit_completed', source: 'integrity_layer', payload: { audit: failureAudit } })
  const failureSnapshot = failure.snapshot()

  const timeout = makeSequentialTracker('grok')
  dispatchFamily(timeout, 'grok')
  terminalFamily(timeout, 'grok', 'TIMED_OUT')
  const timeoutSnapshot = timeout.snapshot()

  const noDispatch = makeSequentialTracker('kimi')
  terminalFamily(noDispatch, 'kimi', 'UNAVAILABLE')
  const noDispatchSnapshot = noDispatch.snapshot()

  const policySkip = makeSequentialTracker('gemini')
  policySkip.record({ eventType: 'family_skipped_by_policy', source: 'server_orchestrator', family: 'gemini', payload: { outcome: 'skipped_by_policy', reason: 'Family is outside stable group turn roster.' } })
  const policySkipSnapshot = policySkip.snapshot()

  return [
    caseResult('runtime_31_sequential_logical_request_recorded', 'Sequential single-family tracker preserves logical request correlation.', 'valid', successSnapshot.logicalRequestId === 'logical-validation-turn' && successSnapshot.logicalTurnIndex === 1 && successSnapshot.logicalTurnTotal === 3),
    caseResult('runtime_32_sequential_logical_expected_families_recorded', 'Sequential single-family tracker records the frontend logical family set.', 'valid', successSnapshot.logicalExpectedFamilies.join(',') === 'chatgpt,claude,grok'),
    caseResult('runtime_33_sequential_success_no_request_close', 'A single successful sequential shard does not prematurely close the logical decree.', 'valid', !successSnapshot.events.some(event => event.eventType === 'request_completed' || event.eventType === 'request_failed' || event.eventType === 'request_timed_out') && successSnapshot.status === 'recording'),
    caseResult('runtime_34_sequential_success_provider_linkage', 'Sequential shard records one readable provider completion event.', 'valid', successSnapshot.events.filter(event => event.eventType === 'family_response_completed' && event.family === 'claude').length === 1),
    caseResult('runtime_35_sequential_synthetic_red_team_not_provider', 'Sequential synthetic Red Team audit does not add Red Team as a selected provider.', 'valid', !successSnapshot.state.selectedFamilies.includes('red_team') && successSnapshot.state.redTeamAudit.reviewType === 'synthetic_integrity'),
    caseResult('runtime_36_sequential_prior_context_not_counted', 'Sequential synthetic audit does not claim current-turn prior responses were delivered.', 'valid', successSnapshot.state.redTeamAudit.currentTurnPriorResponsesReceived === false),
    caseResult('runtime_37_sequential_failure_records_terminal_without_throw', 'Sequential provider failure records a terminal failed family and keeps response path open.', 'valid', failureSnapshot.state.completionSummary.failedCount === 1 && failureSnapshot.status === 'recording'),
    caseResult('runtime_38_sequential_timeout_records_terminal_without_throw', 'Sequential provider timeout records a terminal timed_out family and keeps response path open.', 'valid', timeoutSnapshot.state.completionSummary.timedOutCount === 1 && timeoutSnapshot.status === 'recording'),
    caseResult('runtime_39_sequential_unavailable_before_dispatch_not_reached', 'Sequential provider unavailable before dispatch records not_reached, not dispatched failure.', 'valid', noDispatchSnapshot.state.completionSummary.notReachedCount === 1 && noDispatchSnapshot.state.completionSummary.dispatchedCount === 0),
    caseResult('runtime_40_sequential_policy_skip_terminal', 'Sequential policy skip can be represented without provider dispatch.', 'valid', policySkipSnapshot.state.completionSummary.skippedByPolicyCount === 1 && policySkipSnapshot.state.completionSummary.dispatchedCount === 0),
  ]
}

function rawBoundaryCases(): CouncilProgressValidationCase[] {
  const invalidPayloadValues: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['string', 'hello'],
    ['number', 47],
    ['boolean', true],
    ['array', []],
  ]
  const invalidPayloadResults = invalidPayloadValues.map(([label, payload]) => {
    const tracker = makeTracker(['chatgpt'])
    const before = tracker.snapshot()
    const event = makeRawEvent(tracker)
    ;(event as unknown as { payload: unknown }).payload = payload
    const result = tracker.recordRaw(event)
    const after = tracker.snapshot()
    return { label, result, before, after }
  })

  const requestMismatchTracker = makeTracker(['chatgpt'])
  const requestMismatchEvent = makeRawEvent(requestMismatchTracker, { requestId: PROGRESS_FIXTURE_IDS.requestId })
  const requestMismatch = requestMismatchTracker.recordRaw(requestMismatchEvent)
  const requestMismatchSnapshot = requestMismatchTracker.snapshot()

  const invalidFamilyTracker = makeTracker(['chatgpt'])
  const invalidFamilyEvent = makeRawEvent(invalidFamilyTracker, {
    eventType: 'family_dispatched',
    source: 'provider_adapter',
    family: 'not_a_family' as CouncilOrchestrationFamily,
    executionId: councilFamilyExecutionId(`${invalidFamilyTracker.requestId}-not_a_family`),
    payload: { readiness: 'configured', providerLabel: 'not_a_family' },
  })
  const invalidFamily = invalidFamilyTracker.recordRaw(invalidFamilyEvent)
  const invalidFamilySnapshot = invalidFamilyTracker.snapshot()

  const unsafeTracker = makeTracker(['chatgpt'])
  const unsafeEvent = makeRawEvent(unsafeTracker, {
    payload: {
      diagnostic: {
        category: 'validation',
        code: 'unsafe',
        safeMessage: 'authorization bearer abc123 leaked',
      },
    },
  })
  const unsafeResult = unsafeTracker.recordRaw(unsafeEvent)
  const unsafeSnapshot = unsafeTracker.snapshot()

  const cyclicTracker = makeTracker(['chatgpt'])
  const cyclicPayload: Record<string, unknown> = {}
  cyclicPayload.self = cyclicPayload
  const cyclicEvent = makeRawEvent(cyclicTracker)
  ;(cyclicEvent as unknown as { payload: unknown }).payload = cyclicPayload
  ;(cyclicEvent as unknown as { diagnostic: unknown }).diagnostic = null
  const cyclicResult = cyclicTracker.recordRaw(cyclicEvent)
  const cyclicSnapshot = cyclicTracker.snapshot()

  return [
    caseResult('runtime_41_raw_malformed_payloads_rejected', 'Raw boundary rejects null/undefined/string/number/boolean/array payloads.', 'valid', invalidPayloadResults.every(item => !item.result.ok && item.result.diagnostic.issueCodes.includes('invalid_payload_shape'))),
    caseResult('runtime_42_raw_malformed_payloads_do_not_throw_or_mutate', 'Raw malformed payloads are fail-open diagnostics with no partial append.', 'valid', invalidPayloadResults.every(item => item.after.eventCount === item.before.eventCount && item.after.rejectedEventCount === item.before.rejectedEventCount + 1)),
    caseResult('runtime_43_raw_request_id_mismatch_rejected', 'Raw event with mismatched request ID is rejected before mutation.', 'invalid', requestMismatch.ok, requestMismatch.ok ? [] : requestMismatch.diagnostic.issueCodes),
    caseResult('runtime_44_raw_request_id_mismatch_no_partial_append', 'Raw request ID mismatch does not append an event.', 'valid', requestMismatchSnapshot.eventCount === 3 && requestMismatchSnapshot.rejectedEventCount === 1),
    caseResult('runtime_45_raw_invalid_family_rejected', 'Raw event with invalid family is rejected safely.', 'invalid', invalidFamily.ok, invalidFamily.ok ? [] : invalidFamily.diagnostic.issueCodes),
    caseResult('runtime_46_raw_invalid_family_no_partial_append', 'Raw invalid family does not append a partial event.', 'valid', invalidFamilySnapshot.eventCount === 3 && invalidFamilySnapshot.rejectedEventCount === 1),
    caseResult('runtime_47_raw_unsafe_secret_sanitized', 'Raw unsafe diagnostic is rejected without echoing the unsafe token in diagnostics.', 'valid', !unsafeResult.ok && unsafeSnapshot.rejectedEventCount === 1 && !JSON.stringify(unsafeSnapshot.diagnostics).toLowerCase().includes('abc123')),
    caseResult('runtime_48_raw_cycle_detection_precedence', 'Raw cyclic payload is rejected as cyclic before other shape/secret checks dominate.', 'invalid', cyclicResult.ok, cyclicResult.ok ? [] : cyclicResult.diagnostic.issueCodes),
    caseResult('runtime_49_raw_cyclic_payload_no_partial_append', 'Raw cyclic payload does not append or mutate accepted event state.', 'valid', cyclicSnapshot.eventCount === 3 && cyclicSnapshot.rejectedEventCount === 1),
  ]
}

export function runCouncilProgressRuntimeValidation(): CouncilProgressValidationCase[] {
  return [
    ...runtimeCases(),
    ...auditAndFailureCases(),
    ...mutationAndBoundaryCases(),
    ...sequentialRuntimeCases(),
    ...rawBoundaryCases(),
  ]
}

if (process.argv[1]?.endsWith('runtimeValidation.ts')) {
  const results = runCouncilProgressRuntimeValidation()
  for (const result of results) {
    console.log(`${result.result} ${result.caseId}: ${result.description} (${result.observed})`)
    if (result.result === 'FAIL') {
      for (const detail of result.details) console.log(`  ${detail}`)
    }
  }
  const passed = results.filter(result => result.result === 'PASS').length
  console.log(`Council progress-runtime validation: ${passed}/${results.length} PASS`)
  if (passed !== results.length) process.exitCode = 1
}
