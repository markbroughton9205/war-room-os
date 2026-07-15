import {
  attachCouncilTrace,
  COUNCIL_RUNTIME_TRACE_ACTIVATION_CONTRACT,
  createCouncilRuntimeTrace,
  isCouncilRuntimeTraceRequested,
  sanitizeTraceValue,
  validateCouncilRuntimeTraceSnapshot,
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
    validateGeminiApiKeyRedactedByValueShape(),
    validateNestedGeminiKeyRedacted(),
    validateHarmlessGeminiGoogleProseRetained(),
    validateActivationAliasesMatchDocumentation(),
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

function countRedacted(raw: string): number {
  return (raw.match(/\[REDACTED\]/g) ?? []).length
}
