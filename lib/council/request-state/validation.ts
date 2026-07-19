import { validateCouncilRequestState, assertSerializableCouncilRequestState } from './invariants'
import { canEnterTerminalWithOutcome, canTransitionCouncilFamilyLifecycle } from './transitions'
import {
  councilFamilyExecutionId,
  defaultVisibilityState,
  mapLegacyConnectionStatusToReadiness,
  mapProviderRuntimeOutcomeToRequestOutcome,
  type CouncilRequestStateValidationCase,
} from './types'
import { makeExecution, makeRequest, terminalExecution } from './fixtures'

function caseResult(
  caseId: string,
  description: string,
  expected: 'valid' | 'invalid',
  ok: boolean,
  details: string[] = [],
): CouncilRequestStateValidationCase {
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

function validateCase(
  caseId: string,
  description: string,
  expected: 'valid' | 'invalid',
  request = makeRequest(),
): CouncilRequestStateValidationCase {
  const result = validateCouncilRequestState(request)
  return caseResult(caseId, description, expected, result.ok, result.issues.map(issue => `${issue.code}:${issue.path}`))
}

function validRequestCases(): CouncilRequestStateValidationCase[] {
  const connectedNoDispatch = makeRequest({
    expectedFamilies: ['chatgpt'],
    selectedFamilies: ['chatgpt'],
    familyExecutions: [
      makeExecution({
        family: 'chatgpt',
        lifecycle: 'terminal',
        outcome: 'not_reached',
        dispatchedAt: null,
        readinessSnapshot: { readiness: 'connected', source: 'canonical_runtime', checkedAt: null },
        visibility: defaultVisibilityState({ omitted: true, diagnosticOnly: true }),
      }),
    ],
  })

  const unavailableSelectedNotDispatched = makeRequest({
    familyExecutions: [
      makeExecution({
        family: 'claude',
        lifecycle: 'terminal',
        outcome: 'skipped_by_policy',
        dispatchedAt: null,
        selectionAuthority: 'skipped_by_policy',
        readinessSnapshot: { readiness: 'unavailable', source: 'engine_control', checkedAt: null },
        visibility: defaultVisibilityState({ omitted: true, diagnosticOnly: true }),
      }),
    ],
  })

  const configuredTimedOut = makeRequest({
    familyExecutions: [
      {
        ...terminalExecution('grok', 'timed_out', 'configured'),
        timeout: { timeoutMs: 10000, timedOutAt: '2026-07-18T00:00:10.000Z', source: 'provider_budget' },
      },
    ],
  })

  const connectedFailed = makeRequest({
    familyExecutions: [terminalExecution('gemini', 'failed', 'connected')],
  })

  const mixedTerminalAndInFlight = makeRequest({
    expectedFamilies: ['chatgpt', 'claude'],
    selectedFamilies: ['chatgpt', 'claude'],
    familyExecutions: [
      terminalExecution('chatgpt', 'complete'),
      makeExecution({ family: 'claude', lifecycle: 'responding', outcome: null, dispatchedAt: '2026-07-18T00:00:01.000Z' }),
    ],
  })

  const frontendParallel = makeRequest({
    flowMode: 'full_council',
    executionStrategy: 'frontend_parallel_single_family',
    familyExecutions: [
      terminalExecution('chatgpt', 'complete'),
      terminalExecution('claude', 'complete'),
      terminalExecution('grok', 'complete'),
      terminalExecution('gemini', 'complete'),
    ],
  })

  const chatgpt = terminalExecution('chatgpt', 'complete', 'connected', 'stable_group_member')
  const claude = makeExecution({
    family: 'claude',
    selectionAuthority: 'stable_group_member',
    lifecycle: 'terminal',
    outcome: 'complete',
    priorResponseLineage: [{
      priorFamily: 'chatgpt',
      priorExecutionId: chatgpt.executionId,
      delivered: true,
      deliveryOrder: 1,
      contentFingerprint: 'sha256:chatgpt',
      deliveryPurpose: 'sequential_context',
    }],
    respondingToFamilyExecutionIds: [chatgpt.executionId],
    visibility: defaultVisibilityState({ rendered: true, persisted: true }),
  })
  const stableGroup = makeRequest({
    flowMode: 'stable_group',
    executionStrategy: 'frontend_sequential_single_family',
    familyExecutions: [chatgpt, claude],
  })

  const cancellation = makeRequest({
    cancellation: { cancelled: true, reason: 'commander_stop', cancelledAt: '2026-07-18T00:00:04.000Z' },
    familyExecutions: [
      terminalExecution('chatgpt', 'complete'),
      terminalExecution('claude', 'not_reached'),
    ],
  })

  const primaryIncompleteFallbackComplete = makeRequest({
    familyExecutions: [
      makeExecution({
        family: 'gemini',
        lifecycle: 'terminal',
        outcome: 'fallback_used',
        fallbackLineage: {
          primaryFamily: 'gemini',
          primaryProvider: 'google',
          primaryOutcome: 'incomplete',
          primaryFailureCategory: 'incomplete',
          fallbackProviderOrMechanism: 'openai-summary',
          fallbackOutcome: 'complete',
          fallbackOutputRendered: true,
          fallbackReplacedVisiblePrimary: true,
          commanderInformed: true,
          safeDiagnosticReason: 'primary response incomplete; fallback summary used',
        },
        visibility: defaultVisibilityState({ rendered: true, substituted: true, persisted: true }),
      }),
    ],
  })

  const primaryFailedFallbackFailed = makeRequest({
    familyExecutions: [
      makeExecution({
        family: 'grok',
        lifecycle: 'terminal',
        outcome: 'failed',
        fallbackLineage: {
          primaryFamily: 'grok',
          primaryProvider: 'xai',
          primaryOutcome: 'failed',
          primaryFailureCategory: 'provider_error',
          fallbackProviderOrMechanism: 'claude-summary',
          fallbackOutcome: 'failed',
          fallbackOutputRendered: false,
          fallbackReplacedVisiblePrimary: false,
          commanderInformed: true,
          safeDiagnosticReason: 'primary and fallback failed',
        },
        visibility: defaultVisibilityState({ omitted: true, diagnosticOnly: true }),
      }),
    ],
  })

  const fallbackRecordedNotRendered = makeRequest({
    familyExecutions: [
      makeExecution({
        family: 'gemini',
        lifecycle: 'terminal',
        outcome: 'incomplete',
        fallbackLineage: {
          primaryFamily: 'gemini',
          primaryProvider: 'google',
          primaryOutcome: 'incomplete',
          primaryFailureCategory: 'incomplete',
          fallbackProviderOrMechanism: 'none',
          fallbackOutcome: 'not_reached',
          fallbackOutputRendered: false,
          fallbackReplacedVisiblePrimary: false,
          commanderInformed: true,
          safeDiagnosticReason: 'fallback recorded but not rendered',
        },
        visibility: defaultVisibilityState({ omitted: true, diagnosticOnly: true }),
      }),
    ],
  })

  const redComplete = makeRequest({
    expectedFamilies: ['chatgpt', 'claude'],
    selectedFamilies: ['chatgpt', 'claude'],
    familyExecutions: [terminalExecution('chatgpt', 'complete'), terminalExecution('claude', 'complete')],
    redTeamAudit: {
      scope: 'complete_record',
      reviewType: 'external_family',
      expectedFamilies: ['chatgpt', 'claude'],
      receivedFamilies: ['chatgpt', 'claude'],
      missingFamilies: [],
      currentTurnPriorResponsesReceived: true,
    },
  })

  const redPartial = makeRequest({
    expectedFamilies: ['chatgpt', 'claude', 'grok'],
    selectedFamilies: ['chatgpt', 'claude', 'grok'],
    familyExecutions: [terminalExecution('chatgpt', 'complete'), terminalExecution('claude', 'complete'), terminalExecution('grok', 'timed_out')],
    redTeamAudit: {
      scope: 'partial_record',
      reviewType: 'synthetic_integrity',
      expectedFamilies: ['chatgpt', 'claude', 'grok'],
      receivedFamilies: ['chatgpt', 'claude'],
      missingFamilies: ['grok'],
      currentTurnPriorResponsesReceived: false,
    },
  })

  const redUnknown = makeRequest({
    redTeamAudit: {
      scope: 'unknown_scope',
      reviewType: 'synthetic_integrity',
      expectedFamilies: ['chatgpt'],
      receivedFamilies: [],
      missingFamilies: ['chatgpt'],
      currentTurnPriorResponsesReceived: false,
      notes: 'scope unavailable',
    },
  })

  return [
    validateCase('readiness_01_connected_no_dispatch', 'Connected readiness does not imply dispatch or completion.', 'valid', connectedNoDispatch),
    validateCase('readiness_02_unavailable_selected_not_dispatched', 'Unavailable selected provider can be structured as skipped by policy.', 'valid', unavailableSelectedNotDispatched),
    validateCase('readiness_03_configured_timed_out', 'Configured readiness can still time out for this request.', 'valid', configuredTimedOut),
    validateCase('readiness_04_connected_failed', 'Connected readiness can still fail for this request.', 'valid', connectedFailed),
    validateCase('valid_01_complete_direct_invocation', 'Complete direct invocation record is valid.', 'valid', makeRequest()),
    validateCase('valid_02_frontend_parallel', 'Frontend parallel family record is valid.', 'valid', frontendParallel),
    validateCase('valid_03_stable_group_lineage', 'Stable Group sequential record with delivered lineage is valid.', 'valid', stableGroup),
    validateCase('valid_04_cancel_not_reached', 'Commander cancellation can produce not_reached terminal family.', 'valid', cancellation),
    validateCase('valid_05_policy_skipped', 'Policy skipped family remains visible in structured state.', 'valid', unavailableSelectedNotDispatched),
    validateCase('valid_06_timeout', 'Timeout terminal outcome is valid with timeout metadata.', 'valid', configuredTimedOut),
    validateCase('valid_07_incomplete', 'Incomplete terminal outcome is valid.', 'valid', makeRequest({ familyExecutions: [terminalExecution('gemini', 'incomplete')] })),
    validateCase('valid_08_failed', 'Failed provider call outcome is valid.', 'valid', connectedFailed),
    validateCase('fallback_01_primary_incomplete_fallback_complete', 'Fallback complete preserves primary incomplete.', 'valid', primaryIncompleteFallbackComplete),
    validateCase('fallback_02_primary_failed_fallback_failed', 'Fallback failure preserves primary failure.', 'valid', primaryFailedFallbackFailed),
    validateCase('fallback_03_substituted_rendered', 'Rendered fallback output is marked substituted.', 'valid', primaryIncompleteFallbackComplete),
    validateCase('fallback_04_recorded_not_rendered', 'Fallback lineage may be recorded without rendering fallback output.', 'valid', fallbackRecordedNotRendered),
    validateCase('red_01_complete_record_external', 'Complete Red Team external-family audit is representable.', 'valid', redComplete),
    validateCase('red_02_partial_record_synthetic', 'Partial synthetic-integrity audit is representable.', 'valid', redPartial),
    validateCase('red_03_unknown_scope', 'Unknown-scope audit is representable without full-record claim.', 'valid', redUnknown),
    validateCase('valid_09_mixed_terminal_and_in_flight', 'One family terminal and another still legitimately in flight (sequential exchange) is valid -- the request is not closed until every selected family reaches terminal.', 'valid', mixedTerminalAndInFlight),
    caseResult('adapter_01_online_maps_connected', 'Legacy online maps to readiness connected.', 'valid', mapLegacyConnectionStatusToReadiness('online') === 'connected'),
    caseResult('adapter_02_provider_timeout_maps_timed_out', 'Legacy provider timeout maps to request outcome timed_out.', 'valid', mapProviderRuntimeOutcomeToRequestOutcome('TIMED_OUT') === 'timed_out'),
    caseResult('adapter_03_in_flight_maps_to_null_not_terminal_outcome', 'Legacy IN_FLIGHT status must never map to a terminal outcome value.', 'valid', mapProviderRuntimeOutcomeToRequestOutcome('IN_FLIGHT') === null),
  ]
}

function invalidRequestCases(): CouncilRequestStateValidationCase[] {
  // Note: a mixed terminal + still-responding record across two DIFFERENT
  // selected families is a legitimate sequential-exchange snapshot (see
  // valid_09_mixed_terminal_and_in_flight above) and is not used here.
  // This case instead represents a genuine violation: the request is
  // closing via Commander cancellation, yet a family was left dispatched
  // and never resolved to a terminal state -- exactly the "silently
  // hanging family" this invariant exists to catch.
  const dispatchedOpen = makeRequest({
    cancellation: { cancelled: true, reason: 'commander_stop', cancelledAt: '2026-07-18T00:00:02.000Z' },
    familyExecutions: [
      makeExecution({ family: 'chatgpt', lifecycle: 'responding', outcome: null, dispatchedAt: '2026-07-18T00:00:01.000Z' }),
      terminalExecution('claude', 'complete'),
    ],
  })

  const terminalNoOutcome = makeRequest({
    familyExecutions: [makeExecution({ family: 'chatgpt', lifecycle: 'terminal', outcome: null })],
  })

  const nonterminalOutcome = makeRequest({
    familyExecutions: [makeExecution({ family: 'chatgpt', lifecycle: 'responding', outcome: 'complete' })],
  })

  const notReachedDispatched = makeRequest({
    familyExecutions: [makeExecution({ family: 'grok', lifecycle: 'terminal', outcome: 'not_reached', dispatchedAt: '2026-07-18T00:00:01.000Z' })],
  })

  const stoppedAsTimeout = makeRequest({
    familyExecutions: [makeExecution({ family: 'grok', lifecycle: 'stopped_by_commander', outcome: 'timed_out' })],
  })

  const fallbackMissingPrimary = makeRequest({
    familyExecutions: [makeExecution({ family: 'gemini', lifecycle: 'terminal', outcome: 'fallback_used', fallbackLineage: null })],
  })

  const fallbackErasesPrimary = makeRequest({
    familyExecutions: [
      makeExecution({
        family: 'gemini',
        lifecycle: 'terminal',
        outcome: 'fallback_used',
        fallbackLineage: {
          primaryFamily: 'gemini',
          primaryProvider: 'google',
          primaryOutcome: 'complete',
          primaryFailureCategory: 'unknown',
          fallbackProviderOrMechanism: 'openai-summary',
          fallbackOutcome: 'complete',
          fallbackOutputRendered: true,
          fallbackReplacedVisiblePrimary: true,
          commanderInformed: true,
          safeDiagnosticReason: 'primary complete incorrectly hidden',
        },
        visibility: defaultVisibilityState({ rendered: true, substituted: true }),
      }),
    ],
  })

  const substitutedUnmarked = makeRequest({
    familyExecutions: [
      makeExecution({
        family: 'gemini',
        lifecycle: 'terminal',
        outcome: 'fallback_used',
        fallbackLineage: {
          primaryFamily: 'gemini',
          primaryProvider: 'google',
          primaryOutcome: 'incomplete',
          primaryFailureCategory: 'incomplete',
          fallbackProviderOrMechanism: 'openai-summary',
          fallbackOutcome: 'complete',
          fallbackOutputRendered: true,
          fallbackReplacedVisiblePrimary: true,
          commanderInformed: true,
          safeDiagnosticReason: 'primary incomplete',
        },
        visibility: defaultVisibilityState({ rendered: true, substituted: false }),
      }),
    ],
  })

  const priorClaimNoLineage = makeRequest({
    familyExecutions: [
      makeExecution({
        family: 'claude',
        lifecycle: 'terminal',
        outcome: 'complete',
        respondingToFamilyExecutionIds: [councilFamilyExecutionId('exec-chatgpt')],
      }),
    ],
  })

  const reviewingNoLineage = makeRequest({
    familyExecutions: [makeExecution({ family: 'claude', lifecycle: 'reviewing_previous_family', outcome: null })],
  })

  const completeAuditMissing = makeRequest({
    expectedFamilies: ['chatgpt', 'claude'],
    selectedFamilies: ['chatgpt', 'claude'],
    familyExecutions: [terminalExecution('chatgpt', 'complete'), terminalExecution('claude', 'not_reached')],
    redTeamAudit: {
      scope: 'complete_record',
      reviewType: 'external_family',
      expectedFamilies: ['chatgpt', 'claude'],
      receivedFamilies: ['chatgpt'],
      missingFamilies: ['claude'],
      currentTurnPriorResponsesReceived: true,
    },
  })

  const partialAuditNoMissing = makeRequest({
    redTeamAudit: {
      scope: 'partial_record',
      reviewType: 'synthetic_integrity',
      expectedFamilies: ['chatgpt'],
      receivedFamilies: [],
      missingFamilies: [],
      currentTurnPriorResponsesReceived: false,
    },
  })

  const unknownClaimsFull = makeRequest({
    redTeamAudit: {
      scope: 'unknown_scope',
      reviewType: 'synthetic_integrity',
      expectedFamilies: ['chatgpt'],
      receivedFamilies: [],
      missingFamilies: ['chatgpt'],
      currentTurnPriorResponsesReceived: false,
      notes: 'full-record verification complete',
    },
  })

  const readinessSummary = makeRequest()
  readinessSummary.completionSummary = {
    ...readinessSummary.completionSummary,
    derivedFrom: 'family_outcomes',
    missingTerminalFamilies: ['connected' as never],
  }

  const selectedDisappear = makeRequest({
    selectedFamilies: ['chatgpt', 'claude'],
    expectedFamilies: ['chatgpt', 'claude'],
    familyExecutions: [terminalExecution('chatgpt', 'complete')],
  })

  const unsafeDiagnostic = makeRequest({
    familyExecutions: [
      makeExecution({
        family: 'chatgpt',
        lifecycle: 'terminal',
        outcome: 'failed',
        safeDiagnosticMessage: 'authorization bearer token leaked',
      }),
    ],
  })

  return [
    validateCase('invalid_01_dispatched_without_terminal_outcome', 'Dispatched family cannot remain nonterminal once the request has closed via Commander cancellation.', 'invalid', dispatchedOpen),
    validateCase('invalid_02_terminal_without_outcome', 'Terminal lifecycle without outcome is invalid.', 'invalid', terminalNoOutcome),
    validateCase('invalid_03_nonterminal_with_outcome', 'Nonterminal lifecycle with terminal outcome is invalid.', 'invalid', nonterminalOutcome),
    validateCase('invalid_04_not_reached_dispatched', 'not_reached cannot also be dispatched.', 'invalid', notReachedDispatched),
    validateCase('invalid_05_stopped_as_timeout', 'Commander stop cannot be recorded as timeout.', 'invalid', stoppedAsTimeout),
    validateCase('invalid_06_fallback_missing_primary', 'Fallback output without preserved primary result is invalid.', 'invalid', fallbackMissingPrimary),
    validateCase('invalid_07_fallback_erases_primary_failure', 'Fallback cannot erase primary failure.', 'invalid', fallbackErasesPrimary),
    validateCase('invalid_08_substituted_unmarked', 'Rendered substituted output must be marked substituted.', 'invalid', substitutedUnmarked),
    validateCase('invalid_09_prior_claim_without_lineage', 'Prior-family claim without delivered lineage is invalid.', 'invalid', priorClaimNoLineage),
    validateCase('invalid_10_reviewing_without_lineage', 'reviewing_previous_family without delivered lineage is invalid.', 'invalid', reviewingNoLineage),
    validateCase('invalid_11_complete_record_missing_family', 'complete_record audit cannot miss expected family.', 'invalid', completeAuditMissing),
    validateCase('invalid_12_partial_record_no_missing_metadata', 'partial_record requires missing metadata.', 'invalid', partialAuditNoMissing),
    validateCase('invalid_13_unknown_scope_full_claim', 'unknown_scope cannot claim full-record verification.', 'invalid', unknownClaimsFull),
    validateCase('invalid_14_readiness_counted_as_completion', 'Readiness values cannot appear inside completion counts.', 'invalid', readinessSummary),
    validateCase('invalid_15_selected_family_disappeared', 'Selected family cannot silently disappear.', 'invalid', selectedDisappear),
    validateCase('invalid_16_secret_bearing_diagnostic', 'Safe diagnostic messages reject secret-bearing fields.', 'invalid', unsafeDiagnostic),
  ]
}

function transitionCases(): CouncilRequestStateValidationCase[] {
  const checks = [
    ['transition_01_waiting_to_queued', canTransitionCouncilFamilyLifecycle('waiting', 'queued').ok],
    ['transition_02_queued_to_dispatched', canTransitionCouncilFamilyLifecycle('queued', 'dispatched').ok],
    ['transition_03_dispatched_to_retrieving', canTransitionCouncilFamilyLifecycle('dispatched', 'retrieving').ok],
    ['transition_04_dispatched_to_reviewing', canTransitionCouncilFamilyLifecycle('dispatched', 'reviewing_previous_family').ok],
    ['transition_05_reviewing_to_responding', canTransitionCouncilFamilyLifecycle('reviewing_previous_family', 'responding').ok],
    ['transition_06_responding_to_terminal_complete', canEnterTerminalWithOutcome('responding', 'complete').ok],
    ['transition_07_retrieving_to_terminal_timeout', canEnterTerminalWithOutcome('retrieving', 'timed_out').ok],
    ['transition_08_waiting_to_terminal_rejected', !canEnterTerminalWithOutcome('waiting', 'complete').ok],
  ] as const
  return checks.map(([caseId, ok]) => caseResult(caseId, 'Lifecycle transition rule.', 'valid', ok))
}

function serializationCases(): CouncilRequestStateValidationCase[] {
  const request = makeRequest({
    flowMode: 'full_council',
    executionStrategy: 'frontend_parallel_single_family',
    familyExecutions: [terminalExecution('chatgpt', 'complete'), terminalExecution('claude', 'complete')],
  })
  const serialized = JSON.stringify(request)
  const noFunctions = !serialized.includes('function') && !serialized.includes('undefined')
  const result = assertSerializableCouncilRequestState(request)
  return [
    caseResult('serialization_01_round_trip', 'Canonical request record round trips through JSON.', 'valid', result.ok, result.issues.map(issue => issue.code)),
    caseResult('serialization_02_schema_version_retained', 'Schema version retained.', 'valid', JSON.parse(serialized).schemaVersion === request.schemaVersion),
    caseResult('serialization_03_no_nonserializable_values', 'No functions or undefined values serialized.', 'valid', noFunctions),
    caseResult('serialization_04_safe_transport_object', 'Safe transport object validates after serialization.', 'valid', result.ok),
  ]
}

export function runCouncilRequestStateValidation(): CouncilRequestStateValidationCase[] {
  return [
    ...validRequestCases(),
    ...invalidRequestCases(),
    ...transitionCases(),
    ...serializationCases(),
  ]
}

if (process.argv[1]?.endsWith('validation.ts')) {
  const results = runCouncilRequestStateValidation()
  for (const result of results) {
    console.log(`${result.result} ${result.caseId}: ${result.description} (${result.observed})`)
    if (result.result === 'FAIL') {
      for (const detail of result.details) console.log(`  ${detail}`)
    }
  }
  const passed = results.filter(result => result.result === 'PASS').length
  console.log(`Council request-state validation: ${passed}/${results.length} PASS`)
  if (passed !== results.length) process.exitCode = 1
}
