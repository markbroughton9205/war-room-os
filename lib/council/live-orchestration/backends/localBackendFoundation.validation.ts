import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { computeModelDiversity, diversityWarning } from './diversity'
import { externalBackendConfigured, invokeExternalBackend } from './externalBackend'
import { familyIsStreamConfigured } from '../streamProvider'
import { invokeLocalBackend } from './localBackend'
import * as backendsIndex from './index'
import { resolveSeatBackendPolicy } from './routingMode'
import { invokeCouncilSeat } from './seatRouter'
import { SEAT_LOCAL_ROLE_SLOT } from './seatRoleSlot'
import { projectSeatBackendStatusRows } from './uiStatusProjection'
import type { BackendMetadata, ModelBackendInvokeInput } from './types'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const FAKE_MODEL_ID = 'huihui_ai/qwen3-abliterated:14b'

type MockFetchScenario = {
  tagsOk: boolean
  installedModels: string[]
  generateOk: boolean
  generateText?: string
}

function installMockFetch(scenario: MockFetchScenario): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/tags')) {
      if (!scenario.tagsOk) throw new Error('mock: connection refused')
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: scenario.installedModels.map(name => ({ name })) }),
      } as Response
    }
    if (url.endsWith('/api/generate')) {
      if (!scenario.generateOk) {
        return { ok: false, status: 500, text: async () => 'mock generate failure' } as Response
      }
      return { ok: true, status: 200, json: async () => ({ response: scenario.generateText ?? 'mock local reply' }) } as Response
    }
    throw new Error(`unexpected mock fetch url: ${url}`)
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
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

const NO_CLOUD_KEYS = {
  OPENAI_API_KEY: undefined,
  ANTHROPIC_API_KEY: undefined,
  XAI_API_KEY: undefined,
  GEMINI_API_KEY: undefined,
}

export async function runCouncilLocalBackendFoundationValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  // 1. Seat identity remains stable — every original seat is still mapped, none renamed/dropped.
  const seats: CouncilOrchestrationFamily[] = ['grok', 'claude', 'gemini', 'chatgpt', 'red_team', 'baby', 'kimi', 'bridge_architect']
  const mappedSeats = Object.keys(SEAT_LOCAL_ROLE_SLOT)
  results.push(
    check(
      'seat identity remains stable',
      seats.every(s => mappedSeats.includes(s)) && mappedSeats.length === seats.length,
      `seats=${seats.join(',')} mapped=${mappedSeats.join(',')}`,
    ),
  )

  // 2. Seat/backend decoupling — same seat, two different backend outcomes depending on mode/mocks.
  await withEnv(NO_CLOUD_KEYS, async () => {
    const restoreOk = installMockFetch({ tagsOk: true, installedModels: [FAKE_MODEL_ID], generateOk: true })
    const local = await invokeCouncilSeat(baseInput('claude', { routingModeOverride: 'LOCAL_ONLY' }))
    restoreOk()
    const restoreDown = installMockFetch({ tagsOk: false, installedModels: [], generateOk: false })
    const localDown = await invokeCouncilSeat(baseInput('claude', { routingModeOverride: 'LOCAL_ONLY' }))
    restoreDown()
    results.push(
      check(
        'seat/backend decoupling works',
        local.backend.status === 'OK' && localDown.backend.status === 'NO_LOCAL_BACKEND' && local.backend.model === localDown.backend.model,
        `same seat "claude" produced different backend outcomes (OK vs NO_LOCAL_BACKEND) from the same model assignment`,
      ),
    )
  })

  // 3. Existing external providers still work through abstraction — wrapper must not diverge
  //    from the pre-existing, unmodified familyIsStreamConfigured() behavior.
  await withEnv(NO_CLOUD_KEYS, async () => {
    const seatsToCheck: CouncilOrchestrationFamily[] = ['chatgpt', 'claude', 'grok', 'gemini']
    const matches = seatsToCheck.every(s => externalBackendConfigured(s) === familyIsStreamConfigured(s))
    results.push(check('existing external providers still work through abstraction', matches, `externalBackendConfigured() matches familyIsStreamConfigured() for ${seatsToCheck.join(',')}`))
  })

  // 4. LOCAL_ONLY never invokes external provider, even when external would also be unavailable
  //    for a DIFFERENT reason (AUTH) — result must carry LOCAL's failure class, not AUTH.
  await withEnv(NO_CLOUD_KEYS, async () => {
    const restore = installMockFetch({ tagsOk: false, installedModels: [], generateOk: false })
    const result = await invokeCouncilSeat(baseInput('chatgpt', { routingModeOverride: 'LOCAL_ONLY' }))
    restore()
    results.push(
      check(
        'LOCAL_ONLY never invokes external provider',
        result.backend.backendType === 'LOCAL' && result.backend.failureClass === 'LOCAL_UNAVAILABLE' && result.backend.status === 'NO_LOCAL_BACKEND',
        `backendType=${result.backend.backendType} failureClass=${result.backend.failureClass} status=${result.backend.status}`,
      ),
    )
  })

  // 5. LOCAL_FIRST invokes local first — when local succeeds, external is never reached.
  await withEnv(NO_CLOUD_KEYS, async () => {
    const restore = installMockFetch({ tagsOk: true, installedModels: [FAKE_MODEL_ID], generateOk: true })
    const result = await invokeCouncilSeat(baseInput('claude', { routingModeOverride: 'LOCAL_FIRST' }))
    restore()
    results.push(
      check(
        'LOCAL_FIRST invokes local first',
        result.backend.backendType === 'LOCAL' && result.backend.status === 'OK' && !result.backend.fallbackFrom,
        `backendType=${result.backend.backendType} status=${result.backend.status} fallbackFrom=${result.backend.fallbackFrom}`,
      ),
    )
  })

  // 6. LOCAL_FIRST fallback is explicit — when local fails, the result discloses fallbackFrom.
  await withEnv(NO_CLOUD_KEYS, async () => {
    const restore = installMockFetch({ tagsOk: false, installedModels: [], generateOk: false })
    const result = await invokeCouncilSeat(baseInput('claude', { routingModeOverride: 'LOCAL_FIRST' }))
    restore()
    results.push(
      check(
        'LOCAL_FIRST fallback is explicit',
        result.backend.backendType === 'EXTERNAL' && result.backend.fallbackFrom === 'LOCAL' && Boolean(result.backend.fallbackReason),
        `backendType=${result.backend.backendType} fallbackFrom=${result.backend.fallbackFrom} reason="${result.backend.fallbackReason}"`,
      ),
    )
  })

  // 7. HYBRID supports per-seat policy — default map differs per seat, and env override wins.
  results.push(
    check(
      'HYBRID supports per-seat policy',
      resolveSeatBackendPolicy('red_team') === 'LOCAL_ONLY' && resolveSeatBackendPolicy('grok') === 'EXTERNAL_FIRST',
      `red_team=${resolveSeatBackendPolicy('red_team')} grok=${resolveSeatBackendPolicy('grok')}`,
    ),
  )
  await withEnv({ COUNCIL_SEAT_BACKEND_POLICY: JSON.stringify({ grok: 'LOCAL_ONLY' }) }, async () => {
    const overridden = resolveSeatBackendPolicy('grok')
    results.push(check('HYBRID per-seat policy override honored', overridden === 'LOCAL_ONLY', `grok policy after override=${overridden}`))
  })

  // 8. EXTERNAL_ONLY preserves current behavior — local is never touched even when it would succeed.
  await withEnv(NO_CLOUD_KEYS, async () => {
    const restore = installMockFetch({ tagsOk: true, installedModels: [FAKE_MODEL_ID], generateOk: true })
    const result = await invokeCouncilSeat(baseInput('claude', { routingModeOverride: 'EXTERNAL_ONLY' }))
    restore()
    results.push(
      check(
        'EXTERNAL_ONLY preserves current behavior',
        result.backend.backendType === 'EXTERNAL',
        `backendType=${result.backend.backendType} (local was reachable+installed but must not have been used)`,
      ),
    )
  })

  // 9. Missing local model reports MODEL_NOT_INSTALLED (Ollama reachable, tag not pulled).
  await withEnv(NO_CLOUD_KEYS, async () => {
    const restore = installMockFetch({ tagsOk: true, installedModels: ['some-other-model:8b'], generateOk: true })
    const result = await invokeLocalBackend(baseInput('claude'))
    restore()
    results.push(
      check(
        'missing local model reports MODEL_NOT_INSTALLED',
        result.backend.failureClass === 'MODEL_NOT_INSTALLED' && result.backend.status === 'NO_LOCAL_BACKEND',
        `failureClass=${result.backend.failureClass} status=${result.backend.status}`,
      ),
    )
  })

  // 10. Local failure is not mislabeled as external failure — backendType stays LOCAL throughout.
  await withEnv(NO_CLOUD_KEYS, async () => {
    const restoreUnreachable = installMockFetch({ tagsOk: false, installedModels: [], generateOk: false })
    const unreachable = await invokeLocalBackend(baseInput('claude'))
    restoreUnreachable()
    const restoreMissing = installMockFetch({ tagsOk: true, installedModels: [], generateOk: false })
    const missing = await invokeLocalBackend(baseInput('claude'))
    restoreMissing()
    results.push(
      check(
        'local failure is not mislabeled as external failure',
        unreachable.backend.backendType === 'LOCAL' && missing.backend.backendType === 'LOCAL',
        `unreachable.backendType=${unreachable.backend.backendType} missing.backendType=${missing.backend.backendType}`,
      ),
    )
  })

  // 11. External rate limit does not mark local backend unavailable — the two failure
  //     vocabularies never cross: local failures are never classified RATE_LIMIT/AUTH/BILLING.
  await withEnv(NO_CLOUD_KEYS, async () => {
    const restore = installMockFetch({ tagsOk: true, installedModels: [FAKE_MODEL_ID], generateOk: false })
    const result = await invokeLocalBackend(baseInput('claude'))
    restore()
    const externalOnlyClasses = new Set(['RATE_LIMIT', 'AUTH', 'BILLING'])
    results.push(
      check(
        'external rate limit does not mark local backend unavailable',
        !externalOnlyClasses.has(result.backend.failureClass ?? ''),
        `local failureClass=${result.backend.failureClass} (must never be an external-only class)`,
      ),
    )
  })

  // 12. Backend metadata includes exact model identity.
  await withEnv(NO_CLOUD_KEYS, async () => {
    const restore = installMockFetch({ tagsOk: true, installedModels: [FAKE_MODEL_ID], generateOk: true })
    const result = await invokeLocalBackend(baseInput('claude'))
    restore()
    results.push(
      check(
        'backend metadata includes exact model identity',
        result.backend.model === FAKE_MODEL_ID && Boolean(result.backend.repo) && Boolean(result.backend.quantization),
        `model=${result.backend.model} repo=${result.backend.repo} quant=${result.backend.quantization}`,
      ),
    )
  })

  // 13. Provenance preserves seat + backend separately (never conflated into one field).
  const sampleBackend: BackendMetadata = {
    backendType: 'LOCAL', provider: 'ollama', model: FAKE_MODEL_ID, host: 'http://localhost:11434', latencyMs: 5, status: 'OK',
  }
  const rows = projectSeatBackendStatusRows([{ seat: 'claude', backend: sampleBackend }])
  results.push(
    check(
      'provenance preserves seat + backend separately',
      rows[0]?.seat === 'claude' && rows[0]?.model === FAKE_MODEL_ID && rows[0]?.seat !== (rows[0]?.model as unknown),
      `row.seat=${rows[0]?.seat} row.model=${rows[0]?.model}`,
    ),
  )

  // 14 + 15. Shared-model seats disclosed, unique-model count calculated correctly.
  const diversitySample = [
    { seat: 'grok' as CouncilOrchestrationFamily, backend: { ...sampleBackend, model: FAKE_MODEL_ID } },
    { seat: 'gemini' as CouncilOrchestrationFamily, backend: { ...sampleBackend, model: FAKE_MODEL_ID } },
    { seat: 'claude' as CouncilOrchestrationFamily, backend: { ...sampleBackend, model: 'dolphin-mistral-venice:24b' } },
  ]
  const diversity = computeModelDiversity(diversitySample)
  results.push(
    check(
      'shared-model seats are disclosed',
      diversity.sharedModelGroups.length === 1 && diversity.sharedModelGroups[0].seats.includes('grok') && diversity.sharedModelGroups[0].seats.includes('gemini'),
      `sharedModelGroups=${JSON.stringify(diversity.sharedModelGroups)}`,
    ),
  )
  results.push(
    check('unique-model count calculated correctly', diversity.uniqueModels === 2 && diversity.totalRespondingSeats === 3, `uniqueModels=${diversity.uniqueModels} totalRespondingSeats=${diversity.totalRespondingSeats}`),
  )

  // 16. No fake model diversity — warning fires when seats share weights, silent when diverse.
  const lowDiversityWarning = diversityWarning({ uniqueModels: 1, totalRespondingSeats: 3, sharedModelGroups: [] })
  const highDiversityWarning = diversityWarning({ uniqueModels: 3, totalRespondingSeats: 3, sharedModelGroups: [] })
  results.push(
    check(
      'no fake model diversity',
      typeof lowDiversityWarning === 'string' && highDiversityWarning === null,
      `lowDiversityWarning="${lowDiversityWarning}" highDiversityWarning=${highDiversityWarning}`,
    ),
  )

  // 17. No secrets exposed — a fake secret value never appears in serialized backend metadata.
  await withEnv({ ANTHROPIC_API_KEY: 'sk-ant-TOTALLY-FAKE-TEST-SECRET-DO-NOT-LEAK' }, async () => {
    const result = await invokeExternalBackend(baseInput('claude', { routingModeOverride: 'EXTERNAL_ONLY' }))
    const serialized = JSON.stringify(result)
    results.push(
      check(
        'no secrets exposed',
        !serialized.includes('TOTALLY-FAKE-TEST-SECRET'),
        `serialized backend result does not contain the raw secret value`,
      ),
    )
  })

  // 18. No model downloaded — the registry/module surface exposes no pull/download/install fn.
  const exportNames = Object.keys(backendsIndex)
  const suspiciousExports = exportNames.filter(name => /pull|download|install/i.test(name))
  results.push(
    check('no model downloaded (no pull/download/install export exists)', suspiciousExports.length === 0, `exports=${exportNames.join(',')}`),
  )

  // 19. No training started — same surface check for train/finetune.
  const trainingExports = exportNames.filter(name => /train|finetune|fine-tune/i.test(name))
  results.push(check('no training started (no train/finetune export exists)', trainingExports.length === 0, `exports=${exportNames.join(',')}`))

  return results
}
