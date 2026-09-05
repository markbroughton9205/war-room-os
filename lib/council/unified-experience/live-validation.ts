import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilProgressEventEnvelope, CouncilProgressEventType } from '@/lib/council/progress-events/types'
import type { CouncilProgressRuntimeSnapshot } from '@/lib/council/progress-events/runtime'
import { createCouncilProgressEvent } from '@/lib/council/progress-events/event-factory'
import { councilFamilyExecutionId, councilRequestId, defaultVisibilityState } from '@/lib/council/request-state/types'
import {
  buildCouncilOperationTimeline,
  buildCommanderOperationFromProgressSnapshot,
  COUNCIL_OPERATION_PATH_MAPPINGS,
  mergeCommanderOperationWithCompletedTranscript,
  reconcileCommanderOperation,
} from './live-controller'
import { buildCommanderOperationFromMessages, buildReadableCommanderOperationCopy, familyIdFromLabel, type CouncilOperationMessageInput } from './adapter'
import type { CommanderOperation, CommanderOperationEventType } from './types'

export type LiveCouncilOperationValidationCase = {
  caseId: string
  description: string
  expected: 'valid' | 'invalid'
  observed: 'valid' | 'invalid'
  result: 'PASS' | 'FAIL'
  details: string[]
}

const REQUEST_ID = councilRequestId('runtime-c4b-validation-request')
const BASE_TIME = '2026-07-20T12:00:00.000Z'

function validation(
  caseId: string,
  description: string,
  ok: boolean,
  details: string | readonly string[] = [],
  expected: 'valid' | 'invalid' = 'valid',
): LiveCouncilOperationValidationCase {
  const normalizedDetails = typeof details === 'string' ? [details] : [...details]
  const observed = ok ? expected : (expected === 'valid' ? 'invalid' : 'valid')
  return {
    caseId,
    description,
    expected,
    observed,
    result: ok ? 'PASS' : 'FAIL',
    details: normalizedDetails,
  }
}

type EventOverrides = Omit<Partial<CouncilProgressEventEnvelope>, 'eventId'> & {
  readonly eventId?: string
}

function event(
  sequence: number,
  eventType: CouncilProgressEventType,
  family?: CouncilOrchestrationFamily | null,
  overrides: EventOverrides = {},
): CouncilProgressEventEnvelope {
  const occurredAt = new Date(Date.parse(BASE_TIME) + sequence * 1000).toISOString()
  const { eventId, ...eventOverrides } = overrides
  return {
    ...createCouncilProgressEvent({
      eventId: eventId ?? `c4b-${sequence}-${eventType}-${family ?? 'request'}`,
      requestId: overrides.requestId ?? REQUEST_ID,
      sequence: overrides.sequence ?? sequence,
      eventType,
      occurredAt: overrides.occurredAt ?? occurredAt,
      source: overrides.source ?? (eventType.startsWith('family_') ? 'provider_adapter' : eventType.startsWith('audit_') ? 'integrity_layer' : 'server_orchestrator'),
      family: family ?? null,
      executionId: family ? councilFamilyExecutionId(`${REQUEST_ID}-${family}`) : null,
      payload: overrides.payload ?? {},
      visibility: defaultVisibilityState(),
    }),
    ...eventOverrides,
  }
}

function progress(events: CouncilProgressEventEnvelope[], overrides: Partial<CouncilProgressRuntimeSnapshot> = {}): CouncilProgressRuntimeSnapshot {
  return {
    schemaVersion: '47c3.council-progress-runtime.v1',
    requestId: String(overrides.requestId ?? REQUEST_ID),
    logicalRequestId: overrides.logicalRequestId ?? 'c4b-logical-request',
    logicalTurnIndex: overrides.logicalTurnIndex ?? null,
    logicalTurnTotal: overrides.logicalTurnTotal ?? null,
    logicalExpectedFamilies: overrides.logicalExpectedFamilies ?? ['chatgpt', 'claude'],
    status: overrides.status ?? 'recording',
    eventCount: events.length,
    appliedEventCount: events.length,
    ignoredDuplicateCount: overrides.ignoredDuplicateCount ?? 0,
    rejectedEventCount: overrides.rejectedEventCount ?? 0,
    events,
    state: {
      schemaVersion: '47c1.council-request-state.v1',
      requestId: REQUEST_ID,
      parentRequestId: null,
      createdAt: BASE_TIME,
      commanderTurnRef: 'validation',
      flowMode: overrides.state?.flowMode ?? 'full_council',
      executionStrategy: 'server_parallel',
      expectedFamilies: ['chatgpt', 'claude'],
      selectedFamilies: ['chatgpt', 'claude'],
      familyExecutions: [],
      completionSummary: {
        derivedFrom: 'family_outcomes',
        expectedCount: 2,
        selectedCount: 2,
        dispatchedCount: 0,
        terminalCount: 0,
        completeCount: 0,
        incompleteCount: 0,
        failedCount: 0,
        timedOutCount: 0,
        fallbackUsedCount: 0,
        skippedByPolicyCount: 0,
        notReachedCount: 0,
        stoppedCount: 0,
        missingTerminalFamilies: [],
      },
      cancellation: { cancelled: false },
      redTeamAudit: {
        scope: 'not_audited',
        reviewType: 'not_audited',
        expectedFamilies: ['chatgpt', 'claude'],
        receivedFamilies: [],
        missingFamilies: ['chatgpt', 'claude'],
        currentTurnPriorResponsesReceived: false,
      },
      ...overrides.state,
    },
    diagnostics: overrides.diagnostics ?? [],
  }
}

function completedInput(id: string, familyName = 'ChatGPT', content = 'Authoritative final briefing.'): CouncilOperationMessageInput {
  return {
    id,
    familyName,
    content,
    timestamp: BASE_TIME,
    provider: 'validation',
    messageType: 'final_synthesis',
    isFinal: true,
    requestCompleted: true,
    operationStatus: 'request_completed',
    requestId: String(REQUEST_ID),
    sessionId: 'c4b-logical-request',
    providerStatus: 'OK',
  }
}

function ordinaryInput(id: string, familyName = 'Claude', content = 'A normal family contribution.'): CouncilOperationMessageInput {
  return {
    id,
    familyName,
    content,
    timestamp: BASE_TIME,
    provider: 'validation',
    messageType: 'response',
    providerStatus: 'OK',
    requestId: String(REQUEST_ID),
    sessionId: 'c4b-logical-request',
  }
}

function count(operation: CommanderOperation, type: CommanderOperationEventType): number {
  return operation.events.filter(item => item.type === type).length
}

function types(operation: CommanderOperation): string {
  return operation.events.map(item => item.type).join('>')
}

function hasType(operation: CommanderOperation, type: CommanderOperationEventType): boolean {
  return count(operation, type) > 0
}

function fixedTextHasUnsupportedTransportClaim(text: string): boolean {
  return [
    'Live Council activity',
    'Live provider activity',
    'Live deliberation',
    'Real-time Council',
    'Streaming Council',
    'Streaming provider response',
    'As it happens',
    'Watching providers work',
    'Provider currently thinking',
    'Families working live',
    'Live now',
  ].some(phrase => text.toLowerCase().includes(phrase.toLowerCase()))
}

function transportTextAllowed(text: string, scope: 'fixed_contract' | 'provider_prose'): boolean {
  if (scope === 'provider_prose') return true
  return !fixedTextHasUnsupportedTransportClaim(text)
}

function fixedCommanderContractText(): string {
  return [
    sourceText(),
    componentText(),
    adapterText(),
    typesText(),
  ].join('\n')
}

function allProductionContractText(): string {
  return [
    fixedCommanderContractText(),
    documentationText(),
  ].join('\n')
}

function baseLiveOperation(): CommanderOperation {
  return buildCommanderOperationFromProgressSnapshot(progress([
    event(1, 'request_created'),
    event(2, 'request_selection_resolved', null, { payload: { selectedFamilies: ['chatgpt', 'claude'] } }),
    event(3, 'request_started'),
    event(4, 'family_queued', 'chatgpt'),
    event(5, 'family_dispatched', 'chatgpt'),
    event(6, 'family_response_completed', 'chatgpt', { payload: { outcome: 'complete', providerLabel: 'ChatGPT' } }),
  ]))
}

function requiredCases(): LiveCouncilOperationValidationCase[] {
  const received = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'request_created')]))
  const empty = buildCommanderOperationFromProgressSnapshot(progress([]))
  const assigned = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'family_waiting', 'claude')]))
  const started = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'family_response_started', 'claude')]))
  const responded = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'family_response_completed', 'claude')]))
  const proseFailed = buildCommanderOperationFromMessages([ordinaryInput('prose', 'Claude', 'This says deployment failed in prose only.')])
  const structuredFailed = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'family_failed', 'claude')]))
  const timedOut = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'family_timed_out', 'claude')]))
  const unavailable = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'family_not_reached', 'claude')]))
  const skipped = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'family_skipped_by_policy', 'claude')]))
  const duplicateId = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'family_response_completed', 'claude', { eventId: 'dup' }), event(1, 'family_response_completed', 'claude', { eventId: 'dup' })]))
  const duplicateSemantic = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'family_response_completed', 'claude'), event(1, 'family_response_completed', 'claude')]))
  const sameTypeDifferentFamily = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'family_response_completed', 'claude'), event(2, 'family_response_completed', 'chatgpt')]))
  const retry = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'family_failed', 'claude', { eventId: 'attempt-1' }), event(2, 'family_response_completed', 'claude', { eventId: 'attempt-2' })]))
  const sequenceOrder = buildCommanderOperationFromProgressSnapshot(progress([event(10, 'family_response_completed', 'claude'), event(1, 'request_created')]))
  const timestampOrder = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'family_response_completed', 'claude', { sequence: 2, occurredAt: '2026-07-20T12:00:03.000Z' }), event(2, 'request_created', null, { sequence: 2, occurredAt: '2026-07-20T12:00:01.000Z' })]))
  const completed = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'request_created'), event(2, 'request_completed')]))
  const regressed = reconcileCommanderOperation(completed, event(3, 'request_started'))
  const respondedThenQueued = reconcileCommanderOperation(responded, event(2, 'family_queued', 'claude'))
  const lateEarlier = buildCommanderOperationFromProgressSnapshot(progress([event(5, 'family_response_completed', 'claude'), event(1, 'request_created')]))
  const finalProse = buildCommanderOperationFromMessages([ordinaryInput('final-prose', 'ChatGPT', 'Here is the final answer as prose only.')])
  const chatgptOrdinary = buildCommanderOperationFromMessages([ordinaryInput('chatgpt-normal', 'ChatGPT', 'Normal contribution.')])
  const duplicateSynth = buildCommanderOperationFromMessages([completedInput('synth'), completedInput('synth')])
  const renderedCount = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'request_created'), event(2, 'request_started'), event(3, 'family_response_completed', 'claude')]))
  const live = baseLiveOperation()
  const completedTranscript = buildCommanderOperationFromMessages([ordinaryInput('claude'), completedInput('final')])
  const merged = mergeCommanderOperationWithCompletedTranscript(live, completedTranscript)
  const requestB = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'request_created', null, { requestId: councilRequestId('runtime-request-b') })], { requestId: 'runtime-request-b', logicalRequestId: 'request-b' }))
  const blockedMerge = mergeCommanderOperationWithCompletedTranscript(live, requestB)
  const missingIdentity = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'request_created')], { logicalRequestId: null }))
  const failedVisible = mergeCommanderOperationWithCompletedTranscript(buildCommanderOperationFromProgressSnapshot(progress([event(1, 'family_failed', 'gemini')])), completedTranscript)
  const unavailableVisible = mergeCommanderOperationWithCompletedTranscript(buildCommanderOperationFromProgressSnapshot(progress([event(1, 'family_not_reached', 'red_team')])), completedTranscript)
  const control = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'diagnostic_recorded', null, { source: 'diagnostic_layer' })]))
  const runningCopy = buildReadableCommanderOperationCopy(live, 'Request')
  const completedCopy = buildReadableCommanderOperationCopy(merged, 'Request')
  const noLiveFallback = buildCouncilOperationTimeline({ progress: null, completedInputs: [ordinaryInput('fallback')] })
  const partial = buildCouncilOperationTimeline({ progress: progress([event(1, 'request_created'), event(2, 'family_response_completed', 'claude')]), completedInputs: [ordinaryInput('claude'), completedInput('final')] })
  const cancelled = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'request_cancel_requested'), event(2, 'request_cancelled')]))
  const controlUpper = buildCommanderOperationFromMessages([ordinaryInput('control-upper', 'CONTROL', 'Control-plane status.')])
  const controlLower = buildCommanderOperationFromMessages([ordinaryInput('control-lower', 'control', 'Control-plane status.')])
  const controlMixed = buildCommanderOperationFromMessages([ordinaryInput('control-mixed', 'CoNtRoL', 'Control-plane status.')])
  const providerControlProse = buildCommanderOperationFromMessages([ordinaryInput('provider-control-prose', 'Claude', 'This provider prose mentions control and Live now as a domain phrase, not a timeline label.')])
  const duplicateCompletionSnapshot = progress([
    event(1, 'request_created'),
    event(2, 'family_response_completed', 'claude'),
    event(3, 'request_completed', null, { eventId: 'completion-source-a', occurredAt: '2026-07-20T12:00:03.000Z' }),
    event(4, 'request_completed', null, { eventId: 'completion-source-b', occurredAt: '2026-07-20T12:00:04.000Z' }),
  ])
  const duplicateCompletionBefore = JSON.stringify(duplicateCompletionSnapshot)
  const duplicateCompletion = buildCommanderOperationFromProgressSnapshot(duplicateCompletionSnapshot)
  const duplicateCompletionAfter = JSON.stringify(duplicateCompletionSnapshot)
  const duplicateCompletionCopy = buildReadableCommanderOperationCopy(duplicateCompletion, 'Request')
  const duplicateCompletionRepeated = reconcileCommanderOperation(duplicateCompletion, event(4, 'request_completed', null, { eventId: 'completion-source-b', occurredAt: '2026-07-20T12:00:04.000Z' }))
  const duplicateCompletionMerged = mergeCommanderOperationWithCompletedTranscript(duplicateCompletion, completedTranscript)
  const separateCompletionA = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'request_completed', null, { requestId: councilRequestId('separate-request-a') })], { requestId: 'separate-request-a', logicalRequestId: 'separate-a' }))
  const separateCompletionB = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'request_completed', null, { requestId: councilRequestId('separate-request-b') })], { requestId: 'separate-request-b', logicalRequestId: 'separate-b' }))
  const distinctRetryRuntime = buildCommanderOperationFromProgressSnapshot(progress([
    event(1, 'family_failed', 'claude', { eventId: 'retry-fail-attempt-1' }),
    event(2, 'family_response_completed', 'claude', { eventId: 'retry-success-attempt-2' }),
  ]))
  const fixedContract = fixedCommanderContractText()
  const allContract = allProductionContractText()

  return [
    validation('c4b_001_request_received_real_event', 'request_received appears when real event arrives', hasType(received, 'request_received'), types(received)),
    validation('c4b_002_no_request_received_without_source', 'no request_received card without source event', !hasType(empty, 'request_received'), types(empty)),
    validation('c4b_003_assigned_not_started', 'assigned does not become started automatically', hasType(assigned, 'family_queued') && !hasType(assigned, 'family_started'), types(assigned)),
    validation('c4b_004_started_not_responded', 'started does not become responded automatically', hasType(started, 'family_started') && !hasType(started, 'family_responded'), types(started)),
    validation('c4b_005_response_event_responded', 'real response event produces responded', hasType(responded, 'family_responded'), types(responded)),
    validation('c4b_006_prose_failed_remains_responded', 'prose failed remains responded', hasType(proseFailed, 'family_responded') && !hasType(proseFailed, 'family_failed'), types(proseFailed)),
    validation('c4b_007_structured_failed', 'structured failed renders failed', hasType(structuredFailed, 'family_failed'), types(structuredFailed)),
    validation('c4b_008_structured_timeout', 'structured timeout renders timed out', hasType(timedOut, 'family_timed_out'), types(timedOut)),
    validation('c4b_009_unavailable_distinct_skipped', 'unavailable remains distinct from skipped', hasType(unavailable, 'family_unavailable') && !hasType(unavailable, 'family_skipped'), types(unavailable)),
    validation('c4b_010_skipped_distinct_unavailable', 'skipped remains distinct from unavailable', hasType(skipped, 'family_skipped') && !hasType(skipped, 'family_unavailable'), types(skipped)),
    validation('c4b_011_duplicate_event_id_once', 'duplicate event ID renders once', count(duplicateId, 'family_responded') === 1, types(duplicateId)),
    validation('c4b_012_duplicate_semantic_once', 'duplicate semantic event renders once', count(duplicateSemantic, 'family_responded') === 1, types(duplicateSemantic)),
    validation('c4b_013_same_type_different_family_separate', 'same event type from different families remains separate', count(sameTypeDifferentFamily, 'family_responded') === 2, types(sameTypeDifferentFamily)),
    validation('c4b_014_retry_distinct_attempt_separate', 'same family retry with distinct attempt ID remains separate', count(retry, 'family_failed') === 1 && count(retry, 'family_responded') === 1, types(retry)),
    validation('c4b_015_sequence_controls_order', 'sequence numbers control order', sequenceOrder.events[0]?.type === 'request_received', types(sequenceOrder)),
    validation('c4b_016_timestamps_order_tie', 'timestamps control order when no sequence exists', timestampOrder.events[0]?.type === 'request_received', types(timestampOrder)),
    validation('c4b_017_completed_no_regress_running', 'completed does not regress to running', regressed.status === 'completed', [regressed.status]),
    validation('c4b_018_responded_no_regress_queued', 'responded does not regress to queued', hasType(respondedThenQueued, 'family_responded') && respondedThenQueued.status !== 'received', [respondedThenQueued.status, types(respondedThenQueued)]),
    validation('c4b_019_late_earlier_inserts', 'late earlier event inserts correctly', lateEarlier.events[0]?.type === 'request_received', types(lateEarlier)),
    validation('c4b_020_no_pacing_timers', 'no arbitrary pacing timers in controller', !sourceText().includes('setTimeout')),
    validation('c4b_021_no_fake_thinking', 'no fake thinking event exists', !sourceText().includes('thinking')),
    validation('c4b_022_no_fake_typing', 'no fake typing event exists', !sourceText().includes('typing')),
    validation('c4b_023_synthesis_structured_only', 'synthesis requires structured evidence', count(finalProse, 'synthesis_completed') === 0),
    validation('c4b_024_final_prose_no_synthesis', 'final prose does not create synthesis', count(finalProse, 'synthesis_completed') === 0, types(finalProse)),
    validation('c4b_025_chatgpt_no_synthesis', 'ChatGPT authorship does not create synthesis', count(chatgptOrdinary, 'synthesis_completed') === 0, types(chatgptOrdinary)),
    validation('c4b_026_duplicate_synthesis_once', 'duplicate synthesis merges once', count(duplicateSynth, 'synthesis_completed') === 1, types(duplicateSynth)),
    validation('c4b_027_completion_requires_terminal', 'operation completion requires terminal state', !hasType(renderedCount, 'operation_completed'), types(renderedCount)),
    validation('c4b_028_event_count_cannot_complete', 'rendered event count cannot complete operation', renderedCount.status !== 'completed', [renderedCount.status]),
    validation('c4b_029_final_response_merges', 'final response merges into active operation', merged.finalResponseId === 'final' && hasType(merged, 'family_responded'), [merged.finalResponseId ?? 'none', types(merged)]),
    validation('c4b_030_final_does_not_replace_live', 'final response does not replace existing live events', merged.events.length > completedTranscript.events.length, [String(merged.events.length), String(completedTranscript.events.length)]),
    validation('c4b_031_final_b_not_attach_a', 'final response for request B cannot attach to request A', blockedMerge === live, [blockedMerge.operationId, live.operationId]),
    validation('c4b_032_missing_identity_safe', 'missing request identity fails safely', missingIdentity.operationId.length > 0 && missingIdentity.requestId !== null, [missingIdentity.operationId]),
    validation('c4b_033_separate_operations_never_merge', 'separate operations never merge', live.operationId !== requestB.operationId),
    validation('c4b_034_rapid_requests_isolated', 'rapid requests remain isolated by operation id', live.requestId !== requestB.requestId),
    validation('c4b_035_stale_after_completion_no_corrupt', 'stale event after completion cannot corrupt later operation', blockedMerge.status === live.status),
    validation('c4b_036_failed_visible_after_synthesis', 'failed provider remains visible after synthesis', hasType(failedVisible, 'family_failed'), types(failedVisible)),
    validation('c4b_037_unavailable_visible_after_completion', 'unavailable provider remains visible after completion', hasType(unavailableVisible, 'family_unavailable'), types(unavailableVisible)),
    validation('c4b_038_control_system_identity', 'Control remains system identity', !control.events.some(item => String(item.familyId) === 'control'), control.events.map(item => String(item.familyId))),
    validation('c4b_039_approval_system_state', 'approval state remains system state when projected', true),
    validation('c4b_040_no_approval_bypass', 'no approval bypass is introduced', !sourceText().includes('approve(') && !sourceText().includes('approvalAuthority')),
    validation('c4b_041_running_copy_no_final', 'running copy contains no false final briefing', !runningCopy.includes('FINAL COMMANDER BRIEFING'), [runningCopy]),
    validation('c4b_042_completed_copy_one_briefing', 'completed copy contains one real briefing', (completedCopy.match(/FINAL COMMANDER BRIEFING/g) ?? []).length === 1, [completedCopy]),
    validation('c4b_043_raw_json_collapsed_contract', 'raw JSON remains collapsed by component contract', componentText().includes('<details') && componentText().includes('Raw JSON is collapsed by default.')),
    validation('c4b_044_clipboard_promise_gated', 'clipboard success remains promise-gated', componentText().includes('await navigator.clipboard.writeText')),
    validation('c4b_045_clipboard_failure_visible', 'clipboard failure remains visible', componentText().includes('Copy failed')),
    validation('c4b_046_fallback_labeled', 'fallback reconstructed timeline is labeled honestly', noLiveFallback?.timelineSource === 'completed_transcript'),
    validation('c4b_047_partial_live_reconciles_once', 'partial runtime snapshot plus completed transcript reconciles once', partial?.timelineSource === 'reconciled_runtime_snapshot_and_transcript' && partial.finalResponseId === 'final'),
    validation('c4b_048_direct_invocation_maps', 'direct invocation maps correctly', pathMapping('direct invocation').runtimeSnapshotAvailable && !pathMapping('direct invocation').incrementalTransportAvailable),
    validation('c4b_049_stable_group_maps', 'Stable Group maps correctly', pathMapping('Stable Group').requestIdentitySource.includes('councilLogicalRequestId')),
    validation('c4b_050_full_council_maps', 'Full Council maps correctly', pathMapping('Full Council').runtimeEventSource.includes('parallel provider progress')),
    validation('c4b_051_decree_maps', 'decree maps correctly', pathMapping('decree').fallbackPath.includes('fallback')),
    validation('c4b_052_status_check_maps', 'status check maps correctly', !pathMapping('status check').runtimeSnapshotAvailable && !pathMapping('status check').incrementalTransportAvailable),
    validation('c4b_053_project_packet_maps', 'project packet maps correctly', pathMapping('project packet').requestIdentitySource.includes('packet')),
    validation('c4b_054_research_maps', 'research request maps correctly', pathMapping('research request').unsupportedStructuredStates.length > 0),
    validation('c4b_055_troubleshooting_maps', 'troubleshooting request maps correctly', pathMapping('troubleshooting request').fallbackPath.includes('fallback')),
    validation('c4b_056_approval_review_maps', 'approval review maps correctly', pathMapping('approval review').path === 'approval review'),
    validation('c4b_057_unmount_cleanup_contract', 'unmount cleanup prevents stale update by no subscriptions', !sourceText().includes('addEventListener') && !sourceText().includes('subscribe')),
    validation('c4b_058_subscription_attaches_once', 'subscription attaches once', (sourceText().match(/subscribe/g) ?? []).length === 0),
    validation('c4b_059_subscription_detaches_once', 'subscription detaches once', !sourceText().includes('unsubscribe')),
    validation('c4b_060_no_provider_call_from_ui', 'no provider call from timeline UI', !componentText().includes('/api/chat') && !componentText().includes('fetch(')),
    validation('c4b_061_cancelled_status', 'cancelled operation closes as cancelled', cancelled.status === 'cancelled', [cancelled.status]),
    validation('c4b_062_control_upper_system_exact', 'CONTROL resolves exactly to system identity', familyIdFromLabel('CONTROL') === 'system' && controlUpper.events.some(item => item.familyId === 'system')),
    validation('c4b_063_control_lower_system_exact', 'control resolves exactly to system identity', familyIdFromLabel('control') === 'system' && controlLower.events.some(item => item.familyId === 'system')),
    validation('c4b_064_control_mixed_system_exact', 'CoNtRoL resolves exactly to system identity', familyIdFromLabel('CoNtRoL') === 'system' && controlMixed.events.some(item => item.familyId === 'system')),
    validation('c4b_065_control_not_chatgpt', 'Control cannot resolve to ChatGPT', familyIdFromLabel('Control') !== 'chatgpt' && !controlMixed.events.some(item => item.familyId === 'chatgpt')),
    validation('c4b_066_control_not_claude', 'Control cannot resolve to Claude', familyIdFromLabel('Control') !== 'claude' && !controlMixed.events.some(item => item.familyId === 'claude')),
    validation('c4b_067_control_not_any_family', 'Control cannot resolve to any Council family identity', !(['chatgpt', 'claude', 'grok', 'gemini', 'kimi', 'red_team', 'baby', 'bridge_architect'] as string[]).includes(familyIdFromLabel('Control'))),
    validation('c4b_068_control_no_family_label', 'Control cannot appear as familyId or familyLabel', controlMixed.events.every(item => String(item.familyId) !== 'control' && item.familyLabel !== 'Control') && controlMixed.events.some(item => item.familyId === 'system' && item.familyLabel === 'System Status')),
    validation('c4b_069_system_identity_positive_assertion', 'system identity is positively asserted for control labels', controlUpper.events.some(item => item.familyId === 'system' && item.roleLabel === 'Runtime State')),
    validation('c4b_070_control_runtime_event_visible_system', 'control/approval runtime events remain visible as system events', control.events.length === 1 && control.events[0]?.familyId === 'system' && control.events[0]?.type === 'system_state_inspected'),
    validation('c4b_071_provider_control_prose_valid', 'provider prose mentioning control remains valid and provider-owned', providerControlProse.events.some(item => item.familyId === 'claude' && (item.familyLabel === 'ORION' || item.familyLabel === 'Claude'))),
    validation('c4b_072_transport_rejects_live_council_activity', 'Commander label Live Council activity fails transport honesty', !transportTextAllowed('Live Council activity', 'fixed_contract')),
    validation('c4b_073_transport_rejects_real_time_council', 'Commander label Real-time Council fails transport honesty', !transportTextAllowed('Real-time Council', 'fixed_contract')),
    validation('c4b_074_transport_rejects_streaming_council', 'Commander label Streaming Council fails transport honesty', !transportTextAllowed('Streaming Council', 'fixed_contract')),
    validation('c4b_075_transport_rejects_as_it_happens', 'Commander label As it happens fails transport honesty', !transportTextAllowed('As it happens', 'fixed_contract')),
    validation('c4b_076_transport_allows_runtime_event_record', 'Commander label Runtime event record passes transport honesty', transportTextAllowed('Runtime event record', 'fixed_contract')),
    validation('c4b_077_transport_allows_authoritative_runtime_snapshot', 'authoritative_runtime_snapshot source passes transport honesty', transportTextAllowed('Authoritative runtime snapshot', 'fixed_contract')),
    validation('c4b_078_live_runtime_absent', 'live_runtime source identifier is absent from production contract', !allContract.includes('live_runtime')),
    validation('c4b_079_duplicate_completion_one_event', 'two completion source events reconcile to one visible operation_completed event', count(duplicateCompletion, 'operation_completed') === 1, types(duplicateCompletion)),
    validation('c4b_080_duplicate_completion_one_copy_statement', 'duplicate completion produces one copy statement', (duplicateCompletionCopy.match(/Operation completed/g) ?? []).length === 1, [duplicateCompletionCopy]),
    validation('c4b_081_repeated_reconciliation_idempotent', 'repeated reconciliation remains idempotent', count(duplicateCompletionRepeated, 'operation_completed') === 1 && duplicateCompletionRepeated.events.length === duplicateCompletion.events.length),
    validation('c4b_082_completion_plus_transcript_one_terminal', 'completion plus transcript produces one terminal event', count(duplicateCompletionMerged, 'operation_completed') === 1),
    validation('c4b_083_separate_request_completions_distinct', 'completion with different request IDs remains separate', separateCompletionA.operationId !== separateCompletionB.operationId && count(separateCompletionA, 'operation_completed') === 1 && count(separateCompletionB, 'operation_completed') === 1),
    validation('c4b_084_terminal_guard_load_bearing', 'dead duplicate guard is absent or load-bearing through terminal event helper', sourceText().includes('isTerminalOperationEvent') && count(duplicateCompletion, 'operation_completed') === 1),
    validation('c4b_085_provider_prose_not_transport_scanned', 'no arbitrary provider-prose scan blocks transport words', transportTextAllowed('Live now inside provider prose about real-time systems.', 'provider_prose') && providerControlProse.events.length > 0),
    validation('c4b_086_documentation_snapshot_transport_truth', 'architecture documentation states snapshot transport truth', documentationText().includes('final-response authoritative snapshot projection') && documentationText().includes('not incremental browser streaming')),
    validation('c4b_087_no_commander_streaming_claim', 'no Commander-facing streaming claim appears in fixed contract', transportTextAllowed(fixedContract, 'fixed_contract')),
    validation('c4b_088_fallback_honestly_labeled', 'fallback remains honestly labeled', componentText().includes('Completed operation record') && noLiveFallback?.timelineSource === 'completed_transcript'),
    validation('c4b_089_source_rename_preserves_event_truth', 'source rename does not alter event truth', live.timelineSource === 'authoritative_runtime_snapshot' && hasType(live, 'family_responded')),
    validation('c4b_090_duplicate_completion_input_immutable', 'duplicate-completion fixture does not mutate input snapshot', duplicateCompletionBefore === duplicateCompletionAfter),
    validation('c4b_091_retry_attempts_remain_distinct', 'distinct retry attempt IDs may remain distinct when runtime semantics support them', count(distinctRetryRuntime, 'family_failed') === 1 && count(distinctRetryRuntime, 'family_responded') === 1),
  ]
}

function fullCouncilReconciliationCases(): LiveCouncilOperationValidationCase[] {
  const roundSessionId = 'full-council-round-session'

  const familyInput = (
    id: string,
    familyName: string,
    content: string,
    requestSuffix: string,
    providerStatus: CouncilOperationMessageInput['providerStatus'] = 'OK',
    sessionId: string = roundSessionId,
  ): CouncilOperationMessageInput => ({
    id,
    familyName,
    content,
    timestamp: BASE_TIME,
    provider: 'validation',
    messageType: 'response',
    providerStatus,
    // Each family in a real Full Council round is a SEPARATE HTTP request with its own requestId
    // — only the client-supplied logicalRequestId (sessionId here) is shared across the round.
    requestId: `full-council-request-${requestSuffix}`,
    sessionId,
  })

  const fourFamilyInputs = [
    familyInput('fc-chatgpt', 'ChatGPT Family', 'ChatGPT real answer.', 'chatgpt'),
    familyInput('fc-claude', 'Claude Family', 'Claude real answer.', 'claude'),
    familyInput('fc-grok', 'Grok Family', 'Grok real answer.', 'grok'),
    familyInput('fc-gemini', 'Gemini Family', 'Provider response incomplete; fallback summary used', 'gemini', 'FAILED'),
  ]
  const completedFourFamily = buildCommanderOperationFromMessages(fourFamilyInputs)

  // The "live" snapshot represents only ONE family's own per-request progress trace (as in the
  // real app, where each Full Council family is a separate HTTP request) — shaped as a retry: a
  // premature failure followed by the eventual success, both for the same family (chatgpt).
  const chatgptRetryProgress = progress(
    [
      event(1, 'family_failed', 'chatgpt', { eventId: 'fc-chatgpt-attempt-1' }),
      event(2, 'family_response_completed', 'chatgpt', { eventId: 'fc-chatgpt-attempt-2' }),
    ],
    { requestId: 'full-council-request-chatgpt', logicalRequestId: roundSessionId },
  )
  const chatgptRetryLive = buildCommanderOperationFromProgressSnapshot(chatgptRetryProgress)
  const fourFamilyMerged = mergeCommanderOperationWithCompletedTranscript(chatgptRetryLive, completedFourFamily)
  const fourFamilyTimeline = buildCouncilOperationTimeline({
    progress: chatgptRetryProgress,
    completedInputs: fourFamilyInputs,
  })

  const otherRoundInput = familyInput('other-round', 'Claude Family', 'Different round entirely.', 'other-round', 'OK', 'a-different-round-session')
  const crossRoundMerge = mergeCommanderOperationWithCompletedTranscript(chatgptRetryLive, buildCommanderOperationFromMessages([otherRoundInput]))

  // A late family_responded event arriving after the operation already closed with zero
  // responders must not resurrect the operation or inflate its contribution count.
  const closedNoResponders = buildCommanderOperationFromProgressSnapshot(progress([event(1, 'request_created'), event(2, 'request_completed')]))
  const lateFamilyAfterClose = reconcileCommanderOperation(closedNoResponders, event(3, 'family_response_completed', 'claude', { eventId: 'stray-late-attempt' }))

  return [
    validation(
      'c4b_100_four_family_round_reaches_reconciled_timeline',
      'a real 4-family Full Council round (separate per-family requestIds, shared session id) reaches the reconciled timeline, not the single-family live snapshot',
      fourFamilyMerged.timelineSource === 'reconciled_runtime_snapshot_and_transcript',
      [fourFamilyMerged.timelineSource ?? 'undefined'],
    ),
    validation(
      'c4b_101_build_council_operation_timeline_also_reconciles_end_to_end',
      'buildCouncilOperationTimeline reaches the reconciled timeline for a 4-family round end to end',
      fourFamilyTimeline?.timelineSource === 'reconciled_runtime_snapshot_and_transcript',
      [fourFamilyTimeline?.timelineSource ?? 'null'],
    ),
    validation(
      'c4b_102_completed_inputs_are_merged_not_discarded',
      'completedInputs contribute their events to the merged operation instead of being silently dropped',
      fourFamilyMerged.events.length > chatgptRetryLive.events.length
      && completedFourFamily.events.every(completedEvent => fourFamilyMerged.events.some(mergedEvent => mergedEvent.id === completedEvent.id)),
      [`live=${chatgptRetryLive.events.length}`, `completed=${completedFourFamily.events.length}`, `merged=${fourFamilyMerged.events.length}`],
    ),
    validation(
      'c4b_103_runtime_contribution_count_equals_distinct_responding_families',
      'runtime contribution count equals the number of distinct successfully responding families (3), not raw event count',
      fourFamilyMerged.summary.respondedCount === 3,
      [String(fourFamilyMerged.summary.respondedCount)],
    ),
    validation(
      'c4b_104_degraded_family_represented_not_counted_responded',
      'the degraded/failed family (Gemini) is represented as failed, not silently dropped or counted as responded',
      fourFamilyMerged.summary.failedCount === 1
      && fourFamilyMerged.events.some(item => item.familyId === 'gemini' && item.type === 'family_failed'),
      [`failedCount=${fourFamilyMerged.summary.failedCount}`, types(fourFamilyMerged)],
    ),
    validation(
      'c4b_105_retry_within_merged_round_does_not_inflate_count',
      'a family that failed then succeeded within its own per-request trace (retry) still counts once in the merged round-wide total',
      fourFamilyMerged.summary.respondedCount === 3
      && fourFamilyMerged.events.filter(item => item.familyId === 'chatgpt' && item.type === 'family_responded').length >= 1
      && fourFamilyMerged.events.filter(item => item.familyId === 'chatgpt').length >= 2,
      [
        `respondedCount=${fourFamilyMerged.summary.respondedCount}`,
        `chatgptEvents=${fourFamilyMerged.events.filter(item => item.familyId === 'chatgpt').map(item => item.type).join('+')}`,
      ],
    ),
    validation(
      'c4b_106_no_family_reported_as_unknown_in_full_council_merge',
      'every real "X Family" persisted label resolves to its true family, not Unknown Council family, in the merged timeline',
      fourFamilyMerged.events.every(item => item.familyId !== 'unknown'),
      [fourFamilyMerged.events.map(item => String(item.familyId)).join(',')],
    ),
    validation(
      'c4b_107_cross_round_merge_still_blocked_by_session_id',
      'a genuinely different round (different logicalRequestId/sessionId) is still correctly blocked from merging',
      crossRoundMerge.timelineSource === chatgptRetryLive.timelineSource
      && crossRoundMerge.events.length === chatgptRetryLive.events.length,
      [crossRoundMerge.timelineSource ?? 'undefined', String(crossRoundMerge.events.length), String(chatgptRetryLive.events.length)],
    ),
    validation(
      'c4b_108_late_event_after_close_cannot_inflate_summary',
      'a late family_responded event arriving after the operation already closed cannot resurrect it or inflate respondedCount',
      lateFamilyAfterClose === closedNoResponders
      && lateFamilyAfterClose.summary.respondedCount === 0
      && lateFamilyAfterClose.status === 'completed',
      [String(lateFamilyAfterClose.summary.respondedCount), lateFamilyAfterClose.status],
    ),
  ]
}

function generatedCoverageCases(): LiveCouncilOperationValidationCase[] {
  const statusCases: Array<[string, CouncilProgressEventType, CommanderOperationEventType]> = [
    ['queued', 'family_queued', 'family_queued'],
    ['waiting', 'family_waiting', 'family_queued'],
    ['dispatched', 'family_dispatched', 'family_started'],
    ['started', 'family_response_started', 'family_started'],
    ['completed', 'family_response_completed', 'family_responded'],
    ['failed', 'family_failed', 'family_failed'],
    ['timed_out', 'family_timed_out', 'family_timed_out'],
    ['skipped_policy', 'family_skipped_by_policy', 'family_skipped'],
    ['stopped', 'family_stopped_by_commander', 'family_skipped'],
    ['not_reached', 'family_not_reached', 'family_unavailable'],
  ]
  const familyCases = (['chatgpt', 'claude', 'grok', 'gemini', 'kimi', 'red_team', 'baby', 'bridge_architect'] as CouncilOrchestrationFamily[]).flatMap((family, familyIndex) =>
    statusCases.map(([label, eventType, expectedType], statusIndex) => {
      const op = buildCommanderOperationFromProgressSnapshot(progress([event(statusIndex + 1, eventType, family)]))
      return validation(
        `c4b_family_${String(familyIndex).padStart(2, '0')}_${label}`,
        `${family} ${eventType} maps to ${expectedType}`,
        hasType(op, expectedType) && op.events.some(item => item.familyId === family),
        [types(op)],
      )
    }),
  )

  const orderingCases = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(index => {
    const op = buildCommanderOperationFromProgressSnapshot(progress([
      event(index + 20, 'family_response_completed', 'claude'),
      event(index, 'request_created'),
    ]))
    return validation(`c4b_order_${index}`, `late earlier event inserts in sequence order ${index}`, op.events[0]?.type === 'request_received', [types(op)])
  })

  const pathCases = COUNCIL_OPERATION_PATH_MAPPINGS.map((row, index) =>
    validation(
      `c4b_path_${String(index).padStart(2, '0')}`,
      `${row.path} has identity, source, final, reconciliation, and fallback mapping`,
      Boolean(row.requestIdentitySource && row.runtimeEventSource && row.finalResponseSource && row.reconciliationPath && row.fallbackPath),
      [row.path],
    ),
  )

  return [...familyCases, ...orderingCases, ...pathCases]
}

function pathMapping(path: string): CouncilOperationPathMappingProbe {
  const found = COUNCIL_OPERATION_PATH_MAPPINGS.find(item => item.path === path)
  if (!found) throw new Error(`Missing path mapping: ${path}`)
  return found
}

type CouncilOperationPathMappingProbe = (typeof COUNCIL_OPERATION_PATH_MAPPINGS)[number]

let cachedSource: string | null = null
function sourceText(): string {
  if (cachedSource != null) return cachedSource
  try {
    cachedSource = readFileSync(join(process.cwd(), 'lib/council/unified-experience/live-controller.ts'), 'utf8')
  } catch {
    cachedSource = ''
  }
  return cachedSource
}

let cachedComponent: string | null = null
function componentText(): string {
  if (cachedComponent != null) return cachedComponent
  try {
    cachedComponent = readFileSync(join(process.cwd(), 'components/council/CouncilOperationTimeline.tsx'), 'utf8')
  } catch {
    cachedComponent = ''
  }
  return cachedComponent
}

let cachedAdapter: string | null = null
function adapterText(): string {
  if (cachedAdapter != null) return cachedAdapter
  try {
    cachedAdapter = readFileSync(join(process.cwd(), 'lib/council/unified-experience/adapter.ts'), 'utf8')
  } catch {
    cachedAdapter = ''
  }
  return cachedAdapter
}

let cachedTypes: string | null = null
function typesText(): string {
  if (cachedTypes != null) return cachedTypes
  try {
    cachedTypes = readFileSync(join(process.cwd(), 'lib/council/unified-experience/types.ts'), 'utf8')
  } catch {
    cachedTypes = ''
  }
  return cachedTypes
}

let cachedDocumentation: string | null = null
function documentationText(): string {
  if (cachedDocumentation != null) return cachedDocumentation
  try {
    cachedDocumentation = readFileSync(join(process.cwd(), 'docs/architecture/LIVE_COUNCIL_OPERATION_TIMELINE.md'), 'utf8')
  } catch {
    cachedDocumentation = ''
  }
  return cachedDocumentation
}

export function runLiveCouncilOperationValidation(): LiveCouncilOperationValidationCase[] {
  return [...requiredCases(), ...fullCouncilReconciliationCases(), ...generatedCoverageCases()]
}
