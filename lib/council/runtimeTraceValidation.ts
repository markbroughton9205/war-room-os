import {
  attachCouncilTrace,
  COUNCIL_RUNTIME_TRACE_ACTIVATION_CONTRACT,
  createCouncilRuntimeTrace,
  isCouncilRuntimeTraceRequested,
  sanitizeTraceValue,
  validateCouncilRuntimeTraceSnapshot,
  type CouncilRuntimeTraceSnapshot,
  type CouncilTraceStageName,
} from '@/lib/council/runtimeTrace'

type ValidationCase = {
  caseId: string
  ok: boolean
  detail: string
}

const REQUIRED_ORDER: CouncilTraceStageName[] = [
  'request_received',
  'command_parsed',
  'current_intent_resolved',
  'active_scope_built',
  'topic_scope_built',
  'mode_governor_resolved',
  'research_planned',
  'providers_selected',
  'provider_calls_started',
  'provider_responses_received',
  'integrity_checked',
  'red_team_checked',
  'scope_guardian_checked',
  'final_moderated',
  'council_report_built',
  'memory_recommendation_recorded',
]

export function runCouncilRuntimeTraceValidation(): ValidationCase[] {
  return [
    validateDebugGate(),
    validateTraceOrderingAndProviderLinkage(),
    validateTraceAttachmentIsDebugOnly(),
    validateSecretRedaction(),
    validateTraceSanitizerExceptionFailsOpen(),
    validateEarlyTraceFailureDoesNotCrashBehavior(),
    validateProviderResponseTraceFailureDoesNotAlterResult(),
    validateTraceAttachmentFailureDoesNotAlterResult(),
    validateProviderResponseLinkageSurvivesSnapshot(),
    validateProviderResponseLinkageMatchesTopLevelIds(),
    validateIntegrityLayerAccountingIsDistinctFromExternalProviders(),
    validateTraceClarityFields(),
    validateSanitizerBoundsUnchanged(),
    validateGeminiApiKeyRedactedByValueShape(),
    validateNestedGeminiKeyRedacted(),
    validateHarmlessGeminiGoogleProseRetained(),
    validateActivationAliasesMatchDocumentation(),
    validatePostRecordInputMutationIsolated(),
    validateSnapshotOutputMutationDoesNotLeakIntoLaterSnapshot(),
    validateUuidEmbeddedFcSequenceNotFalselyRedacted(),
    validateGenuineFirecrawlKeyStillRedacted(),
  ]
}

function validateDebugGate(): ValidationCase {
  const noDebug = isCouncilRuntimeTraceRequested(
    new Request('http://localhost/api/chat', { method: 'POST' }),
    {},
  )
  const bodyDebug = isCouncilRuntimeTraceRequested(
    new Request('http://localhost/api/chat', { method: 'POST' }),
    { councilTraceDebug: true },
  )
  const headerDebug = isCouncilRuntimeTraceRequested(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'x-war-room-council-trace': 'debug' },
    }),
    {},
  )
  return {
    caseId: 'trace_debug_gate',
    ok: noDebug === false && bodyDebug === true && headerDebug === true,
    detail: `noDebug=${noDebug}; bodyDebug=${bodyDebug}; headerDebug=${headerDebug}`,
  }
}

function validateTraceOrderingAndProviderLinkage(): ValidationCase {
  const trace = createCouncilRuntimeTrace({ enabled: true, sessionId: 'session-test' })
  for (const stage of REQUIRED_ORDER) {
    trace.record(stage, {
      module: `validation:${stage}`,
      inputSummary: { stage },
      outputSummary: { ok: true },
      stateChange: `recorded ${stage}`,
    })
  }
  const responseId = trace.registerProviderResponse('ChatGPT')
  const snapshot = trace.snapshot()
  const validation = snapshot
    ? validateCouncilRuntimeTraceSnapshot(snapshot, REQUIRED_ORDER)
    : { ok: false, errors: ['missing snapshot'] }
  const linked = snapshot?.providerResponseIds.ChatGPT?.includes(responseId) === true
  return {
    caseId: 'trace_ordering_and_provider_linkage',
    ok: validation.ok && linked,
    detail: `validation=${validation.ok}; errors=${validation.errors.join('|') || 'none'}; linked=${linked}`,
  }
}

function validateTraceAttachmentIsDebugOnly(): ValidationCase {
  const disabled = createCouncilRuntimeTrace({ enabled: false })
  const enabled = createCouncilRuntimeTrace({ enabled: true })
  enabled.record('request_received', {
    module: 'validation',
    inputSummary: {},
    outputSummary: {},
    stateChange: 'debug trace attached',
  })
  const disabledPayload = attachCouncilTrace({ ok: true }, disabled)
  const enabledPayload = attachCouncilTrace({ ok: true }, enabled)
  return {
    caseId: 'trace_attachment_debug_only',
    ok: !('councilTrace' in disabledPayload) && 'councilTrace' in enabledPayload,
    detail: `disabledHasTrace=${'councilTrace' in disabledPayload}; enabledHasTrace=${'councilTrace' in enabledPayload}`,
  }
}

function validateSecretRedaction(): ValidationCase {
  const sanitized = sanitizeTraceValue({
    authorization: 'Bearer eyJsuper.secret.token',
    nested: {
      serviceRole: 'sb_secret_should_not_escape',
      ordinary: 'hello council',
    },
    freeText: 'call with sk-test-secret-value',
  })
  const raw = JSON.stringify(sanitized)
  const leaked =
    raw.includes('eyJsuper.secret.token')
    || raw.includes('sb_secret_should_not_escape')
    || raw.includes('sk-test-secret-value')
  return {
    caseId: 'trace_secret_redaction',
    ok: !leaked && raw.includes('[REDACTED]') && raw.includes('hello council'),
    detail: leaked ? raw : 'secret-like values redacted and ordinary text retained',
  }
}

function validateTraceSanitizerExceptionFailsOpen(): ValidationCase {
  const circular: Record<string, unknown> = { label: 'circle' }
  circular.self = circular
  const throwingGetter = Object.defineProperty({}, 'boom', {
    enumerable: true,
    get() {
      throw new Error('getter exploded')
    },
  })
  const throwingProxy = new Proxy({ ok: true }, {
    ownKeys() {
      throw new Error('proxy trap exploded')
    },
  })
  const deeplyNested = { a: { b: { c: { d: { e: 'deep' } } } } }
  const values = [
    throwingGetter,
    throwingProxy,
    circular,
    BigInt(12),
    Symbol('trace-symbol'),
    () => 'function-value',
    deeplyNested,
  ]

  try {
    const sanitized = values.map(value => sanitizeTraceValue(value))
    const raw = JSON.stringify(sanitized)
    return {
      caseId: 'trace_sanitizer_exception_fails_open',
      ok: raw.includes('trace_unavailable') && raw.includes('12') && raw.includes('[symbol]') && raw.includes('[function]'),
      detail: raw,
    }
  } catch (error) {
    return {
      caseId: 'trace_sanitizer_exception_fails_open',
      ok: false,
      detail: `uncaught=${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function validateEarlyTraceFailureDoesNotCrashBehavior(): ValidationCase {
  const trace = createCouncilRuntimeTrace({ enabled: true })
  const throwingGetter = Object.defineProperty({}, 'beforeTry', {
    enumerable: true,
    get() {
      throw new Error('early getter exploded')
    },
  })
  try {
    trace.record('request_received', {
      module: 'validation:early',
      inputSummary: throwingGetter,
      outputSummary: { normalResult: 'continues' },
      stateChange: 'early trace attempt',
    })
    return {
      caseId: 'early_trace_failure_does_not_crash_route_behavior',
      ok: true,
      detail: 'record returned without throwing before route main try/catch',
    }
  } catch (error) {
    return {
      caseId: 'early_trace_failure_does_not_crash_route_behavior',
      ok: false,
      detail: `uncaught=${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function validateProviderResponseTraceFailureDoesNotAlterResult(): ValidationCase {
  const trace = createCouncilRuntimeTrace({ enabled: true })
  const providerResult = { family: 'Gemini', content: 'normal response', status: 'OK' }
  const throwingProxy = new Proxy(providerResult, {
    get(target, property, receiver) {
      if (property === 'content') throw new Error('provider trace content exploded')
      return Reflect.get(target, property, receiver)
    },
  })
  try {
    const responseId = trace.registerProviderResponse('Gemini')
    trace.record('provider_responses_received', {
      module: 'validation:provider',
      inputSummary: { family: 'Gemini' },
      outputSummary: { responseId, providerResult: throwingProxy },
      stateChange: 'provider response trace attempt',
    })
    return {
      caseId: 'provider_response_trace_failure_does_not_alter_result',
      ok: providerResult.content === 'normal response' && providerResult.status === 'OK',
      detail: `responseId=${responseId}; result=${providerResult.content}`,
    }
  } catch (error) {
    return {
      caseId: 'provider_response_trace_failure_does_not_alter_result',
      ok: false,
      detail: `uncaught=${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function validateTraceAttachmentFailureDoesNotAlterResult(): ValidationCase {
  const trace = createCouncilRuntimeTrace({ enabled: true })
  const original = { ok: true, result: 'council response' }
  ;(trace as unknown as { snapshot: () => never }).snapshot = () => {
    throw new Error('snapshot exploded')
  }
  try {
    const attached = attachCouncilTrace(original, trace)
    return {
      caseId: 'trace_attachment_failure_does_not_alter_result',
      ok: attached === original && !('councilTrace' in attached),
      detail: `sameObject=${attached === original}; hasTrace=${'councilTrace' in attached}`,
    }
  } catch (error) {
    return {
      caseId: 'trace_attachment_failure_does_not_alter_result',
      ok: false,
      detail: `uncaught=${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function validateProviderResponseLinkageSurvivesSnapshot(): ValidationCase {
  const { snapshot, providerResponses } = buildParallelProviderTrace()
  const stageResponses = readProviderResponses(snapshot)
  const raw = JSON.stringify(stageResponses)
  const ok =
    stageResponses.length === providerResponses.length
    && stageResponses.every((response, index) =>
      response.responseId === providerResponses[index]?.responseId
      && response.providerFamily === providerResponses[index]?.providerFamily
      && response.status === providerResponses[index]?.status
      && typeof response.responseLength === 'number'
      && response.errorClass === null)
    && !raw.includes('[object]')
  return {
    caseId: 'provider_response_linkage_survives_snapshot',
    ok,
    detail: raw,
  }
}

function validateProviderResponseLinkageMatchesTopLevelIds(): ValidationCase {
  const { snapshot } = buildParallelProviderTrace()
  const stageResponses = readProviderResponses(snapshot)
  const ok = stageResponses.every(response =>
    snapshot.providerResponseIds[response.providerFamily]?.includes(response.responseId) === true)
  return {
    caseId: 'provider_response_linkage_matches_top_level_ids',
    ok,
    detail: JSON.stringify({
      stageResponses,
      providerResponseIds: snapshot.providerResponseIds,
    }),
  }
}

function validateIntegrityLayerAccountingIsDistinctFromExternalProviders(): ValidationCase {
  const { snapshot } = buildParallelProviderTrace()
  const integrity = findStageOutput(snapshot, 'integrity_checked')
  const redTeam = findStageOutput(snapshot, 'red_team_checked')
  const ok =
    integrity.externalProviderResultCount === 4
    && integrity.integrityFlagCount === 1
    && integrity.totalResultRecords === 5
    && redTeam.sourceType === 'integrity_layer'
    && redTeam.externalProviderCallCompleted === false
    && Array.isArray(redTeam.syntheticIntegrityFamilies)
    && redTeam.syntheticIntegrityFamilies.includes('RED TEAM')
  return {
    caseId: 'integrity_layer_accounting_distinct_from_external_providers',
    ok,
    detail: JSON.stringify({ integrity, redTeam }),
  }
}

function validateTraceClarityFields(): ValidationCase {
  const { snapshot } = buildParallelProviderTrace()
  const report = findStageOutput(snapshot, 'council_report_built')
  const scope = findStageOutput(snapshot, 'scope_guardian_checked')
  const memory = findStageOutput(snapshot, 'memory_recommendation_recorded')
  const scopeStage = snapshot.stages.find(stage => stage.stage === 'scope_guardian_checked')
  const ok =
    report.reportType === 'minimal_trace_envelope'
    && report.canonicalCouncilReportGenerated === false
    && scope.status === 'not_integrated'
    && scope.enforcementApplied === false
    && scopeStage?.observation === 'inferred'
    && memory.recommendationStatus === 'not_evaluated'
    && memory.memoryEvaluationExecuted === false
    && memory.memoryWritten === false
  return {
    caseId: 'trace_clarity_fields_for_report_scope_and_memory',
    ok,
    detail: JSON.stringify({ report, scope, scopeObservation: scopeStage?.observation, memory }),
  }
}

function validateSanitizerBoundsUnchanged(): ValidationCase {
  const deeplyNested = { a: { b: { c: { d: { value: 'still bounded' } } } } }
  const raw = JSON.stringify(sanitizeTraceValue(deeplyNested))
  return {
    caseId: 'sanitizer_bounds_unchanged',
    ok: raw.includes('[object]'),
    detail: raw,
  }
}

function validateGeminiApiKeyRedactedByValueShape(): ValidationCase {
  const realisticKey = 'AIzaSyA1b2C3d4E5f6G7h8I9j0K_lMnOpQrStUvWxYz'
  const diagnostic = `Gemini diagnostic carried ${realisticKey} in an unsafe value.`
  const sanitized = sanitizeTraceValue({ harmlessField: realisticKey, diagnostic })
  const raw = JSON.stringify(sanitized)
  return {
    caseId: 'gemini_api_key_redacted_by_value_shape',
    ok: !raw.includes(realisticKey) && countRedacted(raw) >= 2,
    detail: raw,
  }
}

function validateNestedGeminiKeyRedacted(): ValidationCase {
  const realisticKey = 'AIzaSyNestedKey1234567890abcdefGHIJKLMN'
  const sanitized = sanitizeTraceValue({
    outer: {
      list: ['safe', realisticKey],
      provider: { label: 'Gemini provider', value: realisticKey },
    },
  })
  const raw = JSON.stringify(sanitized)
  return {
    caseId: 'nested_gemini_key_redacted',
    ok: !raw.includes(realisticKey) && countRedacted(raw) >= 2,
    detail: raw,
  }
}

function validateHarmlessGeminiGoogleProseRetained(): ValidationCase {
  const safeValues = [
    'Gemini provider',
    'Google search',
    'AIza is a prefix',
    'AIza-short',
    'ordinary short string',
    '550e8400-e29b-41d4-a716-446655440000',
    'https://www.google.com/search?q=public+source',
  ]
  const sanitized = sanitizeTraceValue({ safeValues })
  const raw = JSON.stringify(sanitized)
  return {
    caseId: 'harmless_gemini_google_prose_retained',
    ok: safeValues.every(value => raw.includes(value)) && !raw.includes('[REDACTED]'),
    detail: raw,
  }
}

function validateUuidEmbeddedFcSequenceNotFalselyRedacted(): ValidationCase {
  // 'f' and 'c' are both valid hex digits, so a hex UUID can naturally spell
  // "fc-" at a group boundary (roughly 1 in 20 random UUIDs). This is a
  // regression test for a real, intermittently-reproducing false-positive
  // redaction found by running the suite repeatedly: a legitimate
  // responseId embedding a UUID like this one was being replaced with
  // [REDACTED] purely by chance.
  const responseIdWithFcBoundary = 'resp_grok_12345bfc-4edd-b63d-97885612850d'
  const sanitized = sanitizeTraceValue({ responseId: responseIdWithFcBoundary })
  const raw = JSON.stringify(sanitized)
  return {
    caseId: 'uuid_embedded_fc_sequence_not_falsely_redacted',
    ok: raw.includes(responseIdWithFcBoundary) && !raw.includes('[REDACTED]'),
    detail: raw,
  }
}

function validateGenuineFirecrawlKeyStillRedacted(): ValidationCase {
  // Field name is deliberately neutral (does not match SECRET_KEY_PATTERN's
  // api[_-]?key/secret/token/etc. alternatives) so this proves the
  // Firecrawl value-shape pattern itself redacts the key, not that the
  // property name alone triggered key-name redaction.
  const realisticKey = 'fc-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
  const sanitized = sanitizeTraceValue({ providerCredential: realisticKey })
  const raw = JSON.stringify(sanitized)
  return {
    caseId: 'genuine_firecrawl_key_still_redacted',
    ok: !raw.includes(realisticKey) && raw.includes('[REDACTED]'),
    detail: raw,
  }
}

function validateActivationAliasesMatchDocumentation(): ValidationCase {
  const accepted = COUNCIL_RUNTIME_TRACE_ACTIVATION_CONTRACT.acceptedHeaderValues
  const headerResults = accepted.map(value =>
    isCouncilRuntimeTraceRequested(
      new Request('http://localhost/api/chat', {
        headers: { [COUNCIL_RUNTIME_TRACE_ACTIVATION_CONTRACT.header]: value },
      }),
      {},
    ),
  )
  const bodyResults = COUNCIL_RUNTIME_TRACE_ACTIVATION_CONTRACT.bodyAliases.map(alias =>
    isCouncilRuntimeTraceRequested(
      new Request('http://localhost/api/chat'),
      { [alias]: true },
    ),
  )
  const rejectedHeader = isCouncilRuntimeTraceRequested(
    new Request('http://localhost/api/chat', {
      headers: { [COUNCIL_RUNTIME_TRACE_ACTIVATION_CONTRACT.header]: 'enabled' },
    }),
    {},
  )
  return {
    caseId: 'activation_aliases_match_documentation',
    ok: headerResults.every(Boolean) && bodyResults.every(Boolean) && rejectedHeader === false,
    detail: `bodyAliases=${COUNCIL_RUNTIME_TRACE_ACTIVATION_CONTRACT.bodyAliases.join(',')}; header=${COUNCIL_RUNTIME_TRACE_ACTIVATION_CONTRACT.header}; accepted=${accepted.join(',')}; rejectedHeader=${rejectedHeader}`,
  }
}

function validatePostRecordInputMutationIsolated(): ValidationCase {
  const trace = createCouncilRuntimeTrace({ enabled: true })
  const original: Record<string, unknown> = { plainField: 'original-value', nested: { value: 'original-nested' } }
  trace.record('request_received', {
    module: 'validation:post_record_mutation',
    inputSummary: original,
    outputSummary: {},
    stateChange: 'record then mutate caller-owned input',
  })
  original.plainField = 'MUTATED_AFTER_RECORD'
  ;(original.nested as Record<string, unknown>).value = 'MUTATED_NESTED_AFTER_RECORD'
  const snapshot = trace.snapshot()
  const stored = snapshot?.stages.find(stage => stage.stage === 'request_received')?.inputSummary as
    | Record<string, unknown>
    | undefined
  const nested = stored?.nested as Record<string, unknown> | undefined
  const ok = stored?.plainField === 'original-value' && nested?.value === 'original-nested'
  return {
    caseId: 'post_record_input_mutation_isolated',
    ok,
    detail: `stored=${JSON.stringify(stored)}`,
  }
}

function validateSnapshotOutputMutationDoesNotLeakIntoLaterSnapshot(): ValidationCase {
  // Regression test for a real defect: snapshot() used to shallow-clone each
  // stage (`{ ...stage }`), which copies the inputSummary/outputSummary
  // object REFERENCE rather than a fresh copy. A caller mutating a returned
  // snapshot's inputSummary/outputSummary would mutate the internally stored
  // object too, corrupting every later snapshot() call. Fixed by re-running
  // the (pure, idempotent) sanitizer on those two fields inside snapshot().
  const trace = createCouncilRuntimeTrace({ enabled: true })
  trace.record('provider_responses_received', {
    module: 'validation:snapshot_mutation',
    inputSummary: { a: { b: 'original-b' } },
    outputSummary: { list: [1, 2, 3] },
    stateChange: 'record then mutate the returned snapshot',
  })
  const first = trace.snapshot()
  const firstStage = first?.stages.find(stage => stage.stage === 'provider_responses_received')
  const firstInput = firstStage?.inputSummary as { a?: Record<string, unknown> } | undefined
  const firstOutput = firstStage?.outputSummary as { list?: unknown[] } | undefined
  if (firstInput?.a) {
    firstInput.a.b = 'MUTATED_VIA_SNAPSHOT'
    firstInput.a.injected = 'INJECTED_KEY'
  }
  firstOutput?.list?.push(999)
  if (firstOutput?.list) firstOutput.list[0] = 'CORRUPTED'

  const second = trace.snapshot()
  const secondStage = second?.stages.find(stage => stage.stage === 'provider_responses_received')
  const secondInput = secondStage?.inputSummary as { a?: Record<string, unknown> } | undefined
  const secondOutput = secondStage?.outputSummary as { list?: unknown[] } | undefined

  const ok =
    secondInput?.a?.b === 'original-b'
    && secondInput?.a?.injected === undefined
    && JSON.stringify(secondOutput?.list) === JSON.stringify([1, 2, 3])
  return {
    caseId: 'snapshot_output_mutation_does_not_leak_into_later_snapshot',
    ok,
    detail: `secondSnapshotStage=${JSON.stringify(secondStage)}`,
  }
}

function countRedacted(raw: string): number {
  return (raw.match(/\[REDACTED\]/g) ?? []).length
}

type ProviderResponseLink = {
  responseId: string
  providerFamily: string
  status: string
  responseLength: number | null
  errorClass: string | null
}

function buildParallelProviderTrace(): {
  snapshot: CouncilRuntimeTraceSnapshot
  providerResponses: ProviderResponseLink[]
} {
  const trace = createCouncilRuntimeTrace({ enabled: true, sessionId: 'session-linkage-test' })
  const providerFamilies = ['ChatGPT', 'Claude', 'Grok', 'Gemini']
  const providerResponses = providerFamilies.map((providerFamily, index) => ({
    responseId: trace.registerProviderResponse(providerFamily),
    providerFamily,
    status: 'OK',
    responseLength: 120 + index,
    errorClass: null,
  }))

  trace.record('provider_responses_received', {
    module: 'validation:parallel_provider_linkage',
    inputSummary: { selectedFamilies: providerFamilies.map(providerFamily => providerFamily.toLowerCase()) },
    outputSummary: { providerResponses },
    stateChange: 'Parallel provider responses collected.',
  })
  trace.record('integrity_checked', {
    module: 'validation:integrity_layer',
    inputSummary: { resultCount: 4, integrityCheck: true },
    outputSummary: {
      externalProviderResultCount: 4,
      integrityFlagCount: 1,
      totalResultRecords: 5,
    },
    stateChange: 'Parallel provider results passed through response integrity validation.',
  })
  trace.record('red_team_checked', {
    module: 'validation:integrity_layer',
    inputSummary: { resultFamilies: [...providerFamilies, 'RED TEAM'] },
    outputSummary: {
      sourceType: 'integrity_layer',
      externalProviderCallCompleted: false,
      integrityFlagCount: 1,
      syntheticIntegrityFamilies: ['RED TEAM'],
    },
    stateChange: 'Integrity-layer Red Team flag presence observed; no external Red Team provider call completed.',
  })
  trace.record('scope_guardian_checked', {
    module: 'validation:scope_guardian_placeholder',
    inputSummary: { missionVersion: 1 },
    outputSummary: {
      status: 'not_integrated',
      enforcementApplied: false,
      advisoryStatus: 'not_integrated_47a_1_trace_only',
    },
    stateChange: 'Scope Guardian is not integrated in 47A-1; no runtime enforcement was applied.',
    observation: 'inferred',
  })
  trace.record('council_report_built', {
    module: 'validation:trace_envelope',
    inputSummary: {
      responseIds: providerResponses.map(response => response.responseId),
      providerFamilies,
    },
    outputSummary: {
      finalReportId: trace.finalReportId,
      reportType: 'minimal_trace_envelope',
      canonicalCouncilReportGenerated: false,
    },
    stateChange: 'Minimal trace envelope built for parallel provider response; canonical Council Report was not generated.',
  })
  trace.record('memory_recommendation_recorded', {
    module: 'validation:memory_path',
    inputSummary: { stabilityMemoryInjection: true },
    outputSummary: {
      recommendationStatus: 'not_evaluated',
      memoryRecommendation: 'not_evaluated_parallel_provider_path',
      memoryEvaluationExecuted: false,
      memoryWritten: false,
    },
    stateChange: 'No memory proposal ingestion or memory write ran in parallel provider path.',
  })

  const snapshot = trace.snapshot()
  if (!snapshot) throw new Error('trace snapshot missing')
  return { snapshot, providerResponses }
}

function readProviderResponses(snapshot: CouncilRuntimeTraceSnapshot): ProviderResponseLink[] {
  const output = findStageOutput(snapshot, 'provider_responses_received')
  return Array.isArray(output.providerResponses)
    ? output.providerResponses.filter(isProviderResponseLink)
    : []
}

function findStageOutput(
  snapshot: CouncilRuntimeTraceSnapshot,
  stageName: CouncilTraceStageName,
): Record<string, unknown> {
  const output = snapshot.stages.find(stage => stage.stage === stageName)?.outputSummary
  return output && typeof output === 'object' && !Array.isArray(output)
    ? output as Record<string, unknown>
    : {}
}

function isProviderResponseLink(value: unknown): value is ProviderResponseLink {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.responseId === 'string'
    && typeof candidate.providerFamily === 'string'
    && typeof candidate.status === 'string'
    && (typeof candidate.responseLength === 'number' || candidate.responseLength === null)
    && (typeof candidate.errorClass === 'string' || candidate.errorClass === null)
  )
}
