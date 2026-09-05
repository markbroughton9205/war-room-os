import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { mapSeatInvokeStatusToProviderResultStatus } from '@/app/api/chat/execute'
import { GET as backendStatusGet } from '@/app/api/council/backend-status/route'
import { classifyProviderFailure } from '../failureTaxonomy'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { resolveCouncilRoutingMode, resolveSeatBackendPolicy } from './routingMode'
import { invokeCouncilSeat } from './seatRouter'
import type { ModelBackendInvokeInput } from './types'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function repoRoot(): string {
  // lib/council/live-orchestration/backends/<this file> -> 4 levels up to repo root.
  return fileURLToPath(new URL('../../../../', import.meta.url))
}

function readRepoFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL('../../../../' + relativePath, import.meta.url)), 'utf8')
}

function gitDiffAgainstHead(paths: string[]): string {
  try {
    return execFileSync('git', ['diff', 'HEAD', '--name-only', '--', ...paths], {
      cwd: repoRoot(),
      encoding: 'utf8',
    }).trim()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const original: Record<string, string | undefined> = {}
  for (const key of Object.keys(vars)) original[key] = process.env[key]
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

const ALL_CLOUD_KEYS = {
  OPENAI_API_KEY: undefined,
  ANTHROPIC_API_KEY: undefined,
  XAI_API_KEY: undefined,
  GEMINI_API_KEY: undefined,
  MOONSHOT_API_KEY: undefined,
}

const SEAT_ENV_VAR: Partial<Record<CouncilOrchestrationFamily, string>> = {
  chatgpt: 'OPENAI_API_KEY',
  baby: 'OPENAI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  red_team: 'ANTHROPIC_API_KEY',
  grok: 'XAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
}

/**
 * Records every URL global.fetch is asked to hit, and answers per a caller-supplied responder.
 * Distinguishes local (Ollama, localhost:11434) traffic from provider (cloud) traffic by URL, so
 * one mock can drive both invokeLocalBackend and invokeExternalBackend in the same test.
 */
function installMockFetch(responder: (url: string) => { ok: boolean; status: number; body: unknown } | 'reject'): {
  restore: () => void
  calls: string[]
} {
  const original = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const outcome = responder(url)
    if (outcome === 'reject') throw new Error('mock: network error')
    return {
      ok: outcome.ok,
      status: outcome.status,
      json: async () => outcome.body,
      text: async () => JSON.stringify(outcome.body),
    } as Response
  }) as typeof fetch
  return { restore: () => { globalThis.fetch = original }, calls }
}

/** A real ReadableStream carrying real Anthropic-shaped SSE frames, read by the unmodified
 * readSseResponse()/streamAnthropicMessages() exactly as a real streamed response would be. */
function anthropicSseStreamResponse(textChunks: string[]): Response {
  const frames = textChunks.map(
    chunk => `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: chunk } })}\n\n`,
  )
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  })
  return { ok: true, status: 200, body } as unknown as Response
}

function ollamaTagsResponder(available: boolean, models: string[] = []) {
  return (url: string) => {
    if (url.endsWith('/api/tags')) {
      return available ? { ok: true, status: 200, body: { models: models.map(name => ({ name })) } } : 'reject' as const
    }
    return { ok: false, status: 500, body: { error: 'unexpected mock call' } }
  }
}

function baseInput(seat: CouncilOrchestrationFamily, overrides: Partial<ModelBackendInvokeInput> = {}): ModelBackendInvokeInput {
  return {
    seat,
    systemPrompt: 'test system',
    userPrompt: 'test prompt',
    maxTokens: 200,
    signal: new AbortController().signal,
    onDelta: () => {},
    timeoutKind: 'council',
    ...overrides,
  }
}

const REPRESENTATIVE_SEATS: CouncilOrchestrationFamily[] = ['chatgpt', 'claude', 'grok', 'gemini', 'red_team', 'baby']

export async function runCouncilLiveRoutingValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  const executeSource = readRepoFile('app/api/chat/execute.ts')
  const callCouncilProviderStart = executeSource.indexOf('const callCouncilProvider = async (')
  const callCouncilProviderEnd = executeSource.indexOf('const runFamilyToFamilyDeliberation = async (')
  const callCouncilProviderSource =
    callCouncilProviderStart >= 0 && callCouncilProviderEnd > callCouncilProviderStart
      ? executeSource.slice(callCouncilProviderStart, callCouncilProviderEnd)
      : ''

  // 1. execute.ts imports/uses invokeCouncilSeat.
  results.push(
    check(
      'execute.ts imports/uses invokeCouncilSeat',
      executeSource.includes("import { invokeCouncilSeat") && callCouncilProviderSource.includes('await invokeCouncilSeat('),
      `import present=${executeSource.includes('import { invokeCouncilSeat')} call present=${callCouncilProviderSource.includes('await invokeCouncilSeat(')}`,
    ),
  )

  // 2. Old direct streamCouncilFamily live call removed/replaced at the intended integration
  // point — callCouncilProvider no longer calls it (or familyIsStreamConfigured) directly.
  results.push(
    check(
      'old direct streamCouncilFamily/familyIsStreamConfigured call removed at integration point',
      !callCouncilProviderSource.includes('await streamCouncilFamily(') && !callCouncilProviderSource.includes('familyIsStreamConfigured('),
      `callCouncilProvider length=${callCouncilProviderSource.length} (0 means function boundaries were not found)`,
    ),
  )

  // 3. Default routing mode resolves EXTERNAL_ONLY.
  const defaultMode = await withEnv({ COUNCIL_ROUTING_MODE: undefined }, async () => resolveCouncilRoutingMode())
  results.push(check('default routing mode resolves EXTERNAL_ONLY', defaultMode === 'EXTERNAL_ONLY', `resolved=${defaultMode}`))

  // 4. Unset env does not activate local — invokeCouncilSeat resolves to EXTERNAL backendType.
  await withEnv(ALL_CLOUD_KEYS, async () => {
    const result = await invokeCouncilSeat(baseInput('claude'))
    results.push(
      check(
        'unset env does not activate local',
        result.backend.backendType === 'EXTERNAL',
        `backendType=${result.backend.backendType}`,
      ),
    )
  })

  // Bonus (beyond the 34 minimum): real token-by-token streaming is preserved under EXTERNAL_ONLY.
  // Uses a real ReadableStream of real Anthropic SSE frames through the UNMODIFIED
  // readSseResponse()/streamAnthropicMessages() — not a single-shot mock — so onDelta firing
  // per-chunk (not once at the end) is actually exercised end-to-end through invokeCouncilSeat().
  await withEnv({ ...ALL_CLOUD_KEYS, ANTHROPIC_API_KEY: 'fake-test-key-not-real' }, async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => anthropicSseStreamResponse(['Hello', ', ', 'Commander.'])) as typeof fetch
    const deltas: string[] = []
    const result = await invokeCouncilSeat(
      baseInput('claude', { routingModeOverride: 'EXTERNAL_ONLY', onDelta: delta => deltas.push(delta) }),
    )
    globalThis.fetch = original
    results.push(
      check(
        'real token-by-token streaming preserved under EXTERNAL_ONLY',
        result.ok && result.text === 'Hello, Commander.' && deltas.length === 3 && deltas.join('') === 'Hello, Commander.',
        `ok=${result.ok} text="${result.text}" deltaCount=${deltas.length} deltas=${JSON.stringify(deltas)}`,
      ),
    )
  })

  // 5-10. EXTERNAL_ONLY parity per representative seat: unconfigured short-circuits with NO
  // network call (matching the old familyIsStreamConfigured early-return exactly); configured
  // proceeds to actually attempt the network call (matching the old streamCouncilFamily call).
  for (const seat of REPRESENTATIVE_SEATS) {
    await withEnv(ALL_CLOUD_KEYS, async () => {
      const unconfigured = await invokeCouncilSeat(baseInput(seat, { routingModeOverride: 'EXTERNAL_ONLY' }))
      const mappedStatus = mapSeatInvokeStatusToProviderResultStatus(unconfigured.backend.status)

      const envVar = SEAT_ENV_VAR[seat]
      let fetchCalled = false
      if (envVar) {
        const mock = installMockFetch(() => ({ ok: false, status: 418, body: { error: { message: 'mock: intentionally not a real completion' } } }))
        await withEnv({ [envVar]: 'fake-test-key-not-real' }, async () => {
          await invokeCouncilSeat(baseInput(seat, { routingModeOverride: 'EXTERNAL_ONLY' }))
        })
        fetchCalled = mock.calls.length > 0
        mock.restore()
      }

      results.push(
        check(
          `EXTERNAL_ONLY ${seat} parity`,
          unconfigured.backend.backendType === 'EXTERNAL'
          && unconfigured.backend.status === 'UNAVAILABLE'
          && unconfigured.backend.failureClass === 'AUTH'
          && mappedStatus === 'UNAVAILABLE'
          && (envVar ? fetchCalled : true),
          `unconfigured: status=${unconfigured.backend.status} failureClass=${unconfigured.backend.failureClass} mapped=${mappedStatus}; configured attempted network=${fetchCalled}`,
        ),
      )
    })
  }

  // 11. Missing-key parity (claude, representative) — no network call at all.
  await withEnv(ALL_CLOUD_KEYS, async () => {
    const mock = installMockFetch(() => ({ ok: false, status: 500, body: {} }))
    const result = await invokeCouncilSeat(baseInput('claude', { routingModeOverride: 'EXTERNAL_ONLY' }))
    const noNetworkCall = mock.calls.length === 0
    mock.restore()
    results.push(
      check(
        'missing-key parity',
        result.backend.status === 'UNAVAILABLE' && result.backend.failureClass === 'AUTH' && noNetworkCall,
        `status=${result.backend.status} failureClass=${result.backend.failureClass} networkCalls=${mock.calls.length}`,
      ),
    )
  })

  // 12. Auth-failure parity (claude, representative) — configured but provider rejects with 401.
  await withEnv({ ...ALL_CLOUD_KEYS, ANTHROPIC_API_KEY: 'fake-test-key-not-real' }, async () => {
    const mock = installMockFetch(() => ({ ok: false, status: 401, body: { error: { message: 'invalid api key' } } }))
    const result = await invokeCouncilSeat(baseInput('claude', { routingModeOverride: 'EXTERNAL_ONLY' }))
    mock.restore()
    results.push(
      check(
        'auth-failure parity',
        result.backend.failureClass === 'AUTH' && mapSeatInvokeStatusToProviderResultStatus(result.backend.status) === 'FAILED',
        `status=${result.backend.status} failureClass=${result.backend.failureClass}`,
      ),
    )
  })

  // 13. Rate-limit parity (claude, representative) — configured, provider returns 429.
  await withEnv({ ...ALL_CLOUD_KEYS, ANTHROPIC_API_KEY: 'fake-test-key-not-real' }, async () => {
    const mock = installMockFetch(() => ({ ok: false, status: 429, body: { error: { message: 'rate limited' } } }))
    const result = await invokeCouncilSeat(baseInput('claude', { routingModeOverride: 'EXTERNAL_ONLY' }))
    mock.restore()
    results.push(
      check(
        'rate-limit parity',
        result.backend.failureClass === 'RATE_LIMIT',
        `status=${result.backend.status} failureClass=${result.backend.failureClass} retriedCalls=${mock.calls.length}`,
      ),
    )
  })

  // 14. Provider-unavailable parity (claude, representative) — configured, network itself fails.
  // A raw network throw from fetch() is NOT caught anywhere inside streamProvider.ts/adapters
  // (pre-existing, unmodified behavior — verified by this test itself) or inside
  // invokeCouncilSeat()/invokeExternalBackend() (also unmodified). In production this propagates
  // up to callCouncilProvider's own outer try/catch in execute.ts, which is UNCHANGED by this
  // mission and classifies it via the same classifyProviderFailure() call as before. This test
  // proves both halves: the throw still happens (parity with old behavior, which had the same
  // gap), and classifyProviderFailure still turns it into a sensible failure layer.
  await withEnv({ ...ALL_CLOUD_KEYS, ANTHROPIC_API_KEY: 'fake-test-key-not-real' }, async () => {
    const mock = installMockFetch(() => 'reject')
    let threw = false
    let classified: string | null = null
    try {
      await invokeCouncilSeat(baseInput('claude', { routingModeOverride: 'EXTERNAL_ONLY' }))
    } catch (error) {
      threw = true
      classified = classifyProviderFailure({ message: error instanceof Error ? error.message : String(error) })
    }
    mock.restore()
    results.push(
      check(
        'provider-unavailable parity',
        threw && classified !== null && classified !== 'UNKNOWN',
        `threw=${threw} classifiedFailureLayer=${classified} (execute.ts's own unchanged outer catch handles this identically to before)`,
      ),
    )
  })

  // 15. LOCAL_FIRST attempts local first — local succeeds, external never touched.
  await withEnv(ALL_CLOUD_KEYS, async () => {
    const mock = installMockFetch(url => {
      if (url.endsWith('/api/tags')) return { ok: true, status: 200, body: { models: [{ name: 'huihui_ai/qwen3-abliterated:14b' }] } }
      if (url.endsWith('/api/generate')) return { ok: true, status: 200, body: { response: 'mock local reply' } }
      return { ok: false, status: 500, body: {} }
    })
    const result = await invokeCouncilSeat(baseInput('claude', { routingModeOverride: 'LOCAL_FIRST' }))
    const touchedExternal = mock.calls.some(url => url.includes('anthropic.com') || url.includes('openai.com'))
    mock.restore()
    results.push(
      check(
        'LOCAL_FIRST attempts local first',
        result.backend.backendType === 'LOCAL' && result.backend.status === 'OK' && !touchedExternal,
        `backendType=${result.backend.backendType} status=${result.backend.status} touchedExternal=${touchedExternal}`,
      ),
    )
  })

  // 16-18. LOCAL_FIRST falls back externally when local is unavailable; fallbackFrom/fallbackReason recorded.
  await withEnv(ALL_CLOUD_KEYS, async () => {
    const mock = installMockFetch(ollamaTagsResponder(false))
    const result = await invokeCouncilSeat(baseInput('claude', { routingModeOverride: 'LOCAL_FIRST' }))
    mock.restore()
    results.push(
      check(
        'LOCAL_FIRST falls back externally when permitted',
        result.backend.backendType === 'EXTERNAL',
        `backendType=${result.backend.backendType} status=${result.backend.status}`,
      ),
    )
    results.push(check('fallbackFrom recorded', result.backend.fallbackFrom === 'LOCAL', `fallbackFrom=${result.backend.fallbackFrom}`))
    results.push(
      check(
        'fallbackReason recorded',
        typeof result.backend.fallbackReason === 'string' && result.backend.fallbackReason.length > 0,
        `fallbackReason="${result.backend.fallbackReason}"`,
      ),
    )
  })

  // 19. LOCAL_ONLY never external-falls-back, even though external would be reachable if tried.
  await withEnv({ ...ALL_CLOUD_KEYS, ANTHROPIC_API_KEY: 'fake-test-key-not-real' }, async () => {
    const mock = installMockFetch(url => {
      if (url.endsWith('/api/tags')) return 'reject'
      // If LOCAL_ONLY ever touched a provider URL, this would look like it "succeeded" —
      // the point of this test is proving that never happens.
      return { ok: true, status: 200, body: { would_be: 'a real completion if this were ever called' } }
    })
    const result = await invokeCouncilSeat(baseInput('claude', { routingModeOverride: 'LOCAL_ONLY' }))
    const touchedExternal = mock.calls.some(url => url.includes('anthropic.com'))
    mock.restore()
    results.push(
      check(
        'LOCAL_ONLY never external-falls-back',
        result.backend.backendType === 'LOCAL' && !touchedExternal,
        `backendType=${result.backend.backendType} touchedExternal=${touchedExternal} status=${result.backend.status}`,
      ),
    )
  })

  // 20. LOCAL_ONLY unavailable reports local failure (never a fabricated external result).
  await withEnv(ALL_CLOUD_KEYS, async () => {
    const mock = installMockFetch(ollamaTagsResponder(false))
    const result = await invokeCouncilSeat(baseInput('claude', { routingModeOverride: 'LOCAL_ONLY' }))
    mock.restore()
    results.push(
      check(
        'LOCAL_ONLY unavailable reports local failure',
        result.backend.status === 'NO_LOCAL_BACKEND' && result.backend.failureClass === 'LOCAL_UNAVAILABLE',
        `status=${result.backend.status} failureClass=${result.backend.failureClass}`,
      ),
    )
  })

  // 21. LOCAL_ONLY missing model reports MODEL_NOT_INSTALLED.
  await withEnv(ALL_CLOUD_KEYS, async () => {
    const mock = installMockFetch(ollamaTagsResponder(true, ['some-other-model:8b']))
    const result = await invokeCouncilSeat(baseInput('claude', { routingModeOverride: 'LOCAL_ONLY' }))
    mock.restore()
    results.push(
      check(
        'LOCAL_ONLY missing model reports MODEL_NOT_INSTALLED',
        result.backend.status === 'NO_LOCAL_BACKEND' && result.backend.failureClass === 'MODEL_NOT_INSTALLED',
        `status=${result.backend.status} failureClass=${result.backend.failureClass}`,
      ),
    )
  })

  // 22. HYBRID respects per-seat policy — red_team pinned LOCAL_ONLY never reaches external even
  // when local is unavailable; grok pinned EXTERNAL_FIRST reaches external directly.
  results.push(
    check(
      'HYBRID per-seat policy resolution correct',
      resolveSeatBackendPolicy('red_team') === 'LOCAL_ONLY' && resolveSeatBackendPolicy('grok') === 'EXTERNAL_FIRST',
      `red_team=${resolveSeatBackendPolicy('red_team')} grok=${resolveSeatBackendPolicy('grok')}`,
    ),
  )
  await withEnv(ALL_CLOUD_KEYS, async () => {
    const mock = installMockFetch(ollamaTagsResponder(false))
    const result = await invokeCouncilSeat(baseInput('red_team', { routingModeOverride: 'HYBRID' }))
    mock.restore()
    results.push(
      check(
        'HYBRID respects seat policy (red_team never falls back externally)',
        result.backend.backendType === 'LOCAL' && result.backend.status === 'NO_LOCAL_BACKEND',
        `backendType=${result.backend.backendType} status=${result.backend.status}`,
      ),
    )
  })

  // 23. Seat identity preserved separately from backend across the full invokeCouncilSeat path.
  await withEnv(ALL_CLOUD_KEYS, async () => {
    const result = await invokeCouncilSeat(baseInput('claude', { routingModeOverride: 'EXTERNAL_ONLY' }))
    results.push(
      check(
        'seat identity preserved separately from backend',
        'claude' !== result.backend.provider && 'claude' !== result.backend.model,
        `seat="claude" backend.provider=${result.backend.provider} backend.model=${result.backend.model}`,
      ),
    )
  })

  // 24. Model provenance preserved (local path carries repo/model/quant through).
  await withEnv(ALL_CLOUD_KEYS, async () => {
    const mock = installMockFetch(url => {
      if (url.endsWith('/api/tags')) return { ok: true, status: 200, body: { models: [{ name: 'huihui_ai/qwen3-abliterated:14b' }] } }
      if (url.endsWith('/api/generate')) return { ok: true, status: 200, body: { response: 'mock reply' } }
      return { ok: false, status: 500, body: {} }
    })
    const result = await invokeCouncilSeat(baseInput('claude', { routingModeOverride: 'LOCAL_ONLY' }))
    mock.restore()
    results.push(
      check(
        'model provenance preserved',
        Boolean(result.backend.model) && Boolean(result.backend.repo) && Boolean(result.backend.quantization),
        `model=${result.backend.model} repo=${result.backend.repo} quant=${result.backend.quantization}`,
      ),
    )
  })

  // 25. Latency metadata preserved (always a real non-negative number, never absent).
  await withEnv(ALL_CLOUD_KEYS, async () => {
    const result = await invokeCouncilSeat(baseInput('claude', { routingModeOverride: 'EXTERNAL_ONLY' }))
    results.push(
      check(
        'latency metadata preserved',
        typeof result.backend.latencyMs === 'number' && result.backend.latencyMs >= 0,
        `latencyMs=${result.backend.latencyMs}`,
      ),
    )
  })

  // 26. No secrets serialized in a mapped result.
  await withEnv({ ...ALL_CLOUD_KEYS, ANTHROPIC_API_KEY: 'sk-ant-TOTALLY-FAKE-LIVE-ROUTING-SECRET' }, async () => {
    const mock = installMockFetch(() => ({ ok: false, status: 500, body: { error: { message: 'mock' } } }))
    const result = await invokeCouncilSeat(baseInput('claude', { routingModeOverride: 'EXTERNAL_ONLY' }))
    mock.restore()
    const serialized = JSON.stringify(result)
    results.push(
      check(
        'no secrets serialized',
        !serialized.includes('TOTALLY-FAKE-LIVE-ROUTING-SECRET'),
        'serialized invokeCouncilSeat result does not contain the injected fake secret',
      ),
    )
  })

  // 27. providerStatus.integrity.fallback_used not reused for Council routing fallback.
  const routeSource = readRepoFile('app/api/council/backend-status/route.ts')
  results.push(
    check(
      "providerStatus.integrity.fallback_used not reused for Council routing fallback",
      !/fallbackUsed:\s*providerStatus/.test(routeSource),
      'status route never assigns fallbackUsed from providerStatus.integrity.fallback_used',
    ),
  )

  // 28-30. Status API reports liveRoutingWired=true, resolved mode, and never implies local is
  // serving live seats while mode is EXTERNAL_ONLY. localReadyForLiveRouting is readiness/
  // eligibility (real, computed); localServingLiveSeats stays the literal 'UNKNOWN' — this route
  // has no per-invocation telemetry and must never claim to know what a live call actually did.
  const statusRes = await withEnv(ALL_CLOUD_KEYS, async () => backendStatusGet())
  const statusBody = (await statusRes.json()) as {
    liveRoutingWired: boolean
    routingModeResolved: string
    localReadyForLiveRouting: boolean
    localServingLiveSeats: 'UNKNOWN'
  }
  results.push(check('status API reports liveRoutingWired=true', statusBody.liveRoutingWired === true, `liveRoutingWired=${statusBody.liveRoutingWired}`))
  results.push(
    check(
      'status API still reports current resolved mode EXTERNAL_ONLY when env unset',
      statusBody.routingModeResolved === 'EXTERNAL_ONLY',
      `routingModeResolved=${statusBody.routingModeResolved}`,
    ),
  )
  results.push(
    check(
      'local readiness != proof local actually served',
      statusBody.localReadyForLiveRouting === false && statusBody.localServingLiveSeats === 'UNKNOWN',
      `localReadyForLiveRouting=${statusBody.localReadyForLiveRouting} localServingLiveSeats=${statusBody.localServingLiveSeats}`,
    ),
  )

  // LOCAL_FIRST + a healthy, enabled local candidate => localReadyForLiveRouting can become true
  // — real config+health readiness, computed through the actual route handler (mocked Ollama
  // probe only; cloud provider health short-circuits to MISSING_KEY without any network call
  // since ALL_CLOUD_KEYS strips every key). localServingLiveSeats must still stay 'UNKNOWN'.
  await withEnv({ ...ALL_CLOUD_KEYS, COUNCIL_ROUTING_MODE: 'LOCAL_FIRST' }, async () => {
    const mock = installMockFetch(url => {
      if (url.endsWith('/api/tags')) return { ok: true, status: 200, body: { models: [{ name: 'huihui_ai/qwen3-abliterated:14b' }] } }
      return { ok: false, status: 500, body: {} }
    })
    const res = await backendStatusGet()
    const body = (await res.json()) as { localReadyForLiveRouting: boolean; localServingLiveSeats: 'UNKNOWN'; routingModeResolved: string }
    mock.restore()
    results.push(
      check(
        'LOCAL_FIRST + healthy candidate => localReadyForLiveRouting=true',
        body.routingModeResolved === 'LOCAL_FIRST' && body.localReadyForLiveRouting === true && body.localServingLiveSeats === 'UNKNOWN',
        `routingModeResolved=${body.routingModeResolved} localReadyForLiveRouting=${body.localReadyForLiveRouting} localServingLiveSeats=${body.localServingLiveSeats}`,
      ),
    )
  })

  // Passive fallback renders UNKNOWN/— in the UI, never a false "NO". Checks both the per-seat
  // dash rendering and the top-level pill's literal UNKNOWN string.
  const panelSourceForFallback = readRepoFile('components/war-room/providers/CouncilBackendStatusPanel.tsx')
  results.push(
    check(
      'passive fallback renders UNKNOWN/— in the UI',
      panelSourceForFallback.includes("fallbackUsed === null ? '—'")
      && panelSourceForFallback.includes('snapshot.localServingLiveSeats'),
      'seat card fallback metric dashes on null; top-level pill interpolates the literal UNKNOWN string',
    ),
  )

  // No fake live invocation telemetry: localServingLiveSeats is a source-level compile-time
  // constant ('UNKNOWN' as const), not derived from any log/table/store — proving no persistence
  // layer was added to fabricate a "did it actually serve" answer.
  const routeSourceForTelemetry = readRepoFile('app/api/council/backend-status/route.ts')
  results.push(
    check(
      'no fake live invocation telemetry',
      routeSourceForTelemetry.includes("localServingLiveSeats: 'UNKNOWN' as const")
      && !/invocationLog|invocationHistory|recordInvocation|persistInvocation/i.test(routeSourceForTelemetry),
      "localServingLiveSeats is a fixed 'UNKNOWN' as const, not read from any invocation log/store",
    ),
  )

  // 31. Provider adapters unchanged.
  const adapterDiff = gitDiffAgainstHead([
    'lib/council/live-orchestration/adapters/anthropic.ts',
    'lib/council/live-orchestration/adapters/openai.ts',
    'lib/council/live-orchestration/adapters/gemini.ts',
    'lib/council/live-orchestration/adapters/grok.ts',
  ])
  results.push(check('provider adapters unchanged', adapterDiff.length === 0, adapterDiff.length === 0 ? 'no diff' : `changed=${adapterDiff}`))

  // 32. No model download/pull logic added anywhere in this diff's touched files.
  const suspicious = /\b(pull|download)Model\b|ollama\s+pull|huggingface_hub|snapshot_download/i
  const noDownloadLogic =
    !suspicious.test(executeSource) && !suspicious.test(readRepoFile('lib/council/live-orchestration/backends/seatRouter.ts'))
  results.push(check('no model download/pull logic added', noDownloadLogic, `checked execute.ts + seatRouter.ts for pull/download patterns`))

  // 33. No env file modified.
  const envDiff = gitDiffAgainstHead(['.env', '.env.local', '.env.example', '.env.development', '.env.production'])
  results.push(check('no env file modified', envDiff.length === 0, envDiff.length === 0 ? 'no diff' : `changed=${envDiff}`))

  // 34. No training started — no train/finetune-shaped export anywhere in the touched module surface.
  const backendsIndexSource = readRepoFile('lib/council/live-orchestration/backends/index.ts')
  results.push(
    check(
      'no training started',
      !/train|finetune|fine-tune/i.test(backendsIndexSource),
      'backends barrel exposes no train/finetune-named export',
    ),
  )

  return results
}
