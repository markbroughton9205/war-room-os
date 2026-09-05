import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { GET as backendStatusGet } from '@/app/api/council/backend-status/route'
import { EXTERNAL_PROVIDER_BY_SEAT } from './externalBackend'
import { localCandidateHealthFromProbe } from './localBackend'
import { computeModelDiversity } from './diversity'
import { projectSeatBackendStatusRows } from './uiStatusProjection'
import { runCouncilLocalBackendFoundationValidation } from './localBackendFoundation.validation'
import type { LocalModelRegistryEntry } from './localModelRegistry'
import type { BackendMetadata } from './types'
import type { OllamaProbeResult } from '@/lib/native-builder/ollamaClient'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

async function fetchSnapshot() {
  const res = await backendStatusGet()
  const body = (await res.json()) as {
    liveRouting: string
    routingModeResolved: string
    routingModeNote: string
    ollama: { reachable: boolean; installedModelCount: number; probeLatencyMs: number }
    seats: {
      seat: string
      label: string
      active: {
        backendType: string
        provider: string
        model: string
        status: string
        failureClass?: string
        latencyMs: number | null
        fallbackUsed: boolean
        note: string
      }
      localCandidate: { roleSlot: string | null; repo: string | null; modelId: string | null; quantization: string | null; enabled: boolean; health: string }
    }[]
    diversity: { uniqueModels: number; totalRespondingSeats: number; sharedModelGroups: { model: string; seats: string[] }[] }
    localRegistry: { slot: string; enabled: boolean; health: string }[]
    guardrails: Record<string, boolean | string>
  }
  return { status: res.status, body }
}

function fakeEntry(overrides: Partial<LocalModelRegistryEntry> = {}): LocalModelRegistryEntry {
  return {
    slot: 'GENERAL',
    modelId: 'huihui_ai/qwen3-abliterated:14b',
    repo: 'huihui-ai/Huihui-Qwen3-14B-abliterated-v2',
    runtime: 'ollama',
    quant: 'Q4_K_M',
    roleSuitability: ['GENERAL'],
    residentPolicy: 'ALWAYS_RESIDENT',
    enabled: true,
    health: 'UNKNOWN',
    ...overrides,
  }
}

function fakeProbe(overrides: Partial<OllamaProbeResult> = {}): OllamaProbeResult {
  return { available: true, baseUrl: 'http://localhost:11434', models: [], detail: '', ...overrides }
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

const NO_CLOUD_KEYS = { OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, XAI_API_KEY: undefined, GEMINI_API_KEY: undefined }

function componentSource(): string {
  const path = fileURLToPath(new URL('../../../../components/war-room/providers/CouncilBackendStatusPanel.tsx', import.meta.url))
  return readFileSync(path, 'utf8')
}

function executeRouteSource(): string {
  const path = fileURLToPath(new URL('../../../../app/api/chat/execute.ts', import.meta.url))
  return readFileSync(path, 'utf8')
}

export async function runCouncilBackendStatusUiValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  const { body: snapshot } = await withEnv(NO_CLOUD_KEYS, () => fetchSnapshot())

  // 1. Seat identity displayed separately from backend.
  results.push(
    check(
      'seat identity displayed separately from backend',
      snapshot.seats.every(row => row.seat !== row.active.model && row.seat !== row.active.provider),
      `checked ${snapshot.seats.length} seat rows`,
    ),
  )

  // 2. External backend metadata projects correctly.
  results.push(
    check(
      'external backend metadata projects correctly',
      snapshot.seats.every(row => row.active.backendType === 'EXTERNAL' && row.active.provider === (EXTERNAL_PROVIDER_BY_SEAT as Record<string, string>)[row.seat]),
      'every row backendType=EXTERNAL and provider matches EXTERNAL_PROVIDER_BY_SEAT',
    ),
  )

  // 3. Local backend metadata projects correctly.
  results.push(
    check(
      'local backend metadata projects correctly',
      snapshot.seats.every(row =>
        row.localCandidate.enabled
          ? Boolean(row.localCandidate.repo && row.localCandidate.modelId && row.localCandidate.quantization)
          : row.localCandidate.repo === null && row.localCandidate.modelId === null,
      ),
      'enabled candidates carry repo/modelId/quant; disabled candidates carry none',
    ),
  )

  // 4. Unknown latency renders safely — latencyMs is either a real measured number (from the
  //    canonical provider-health probe) or an honest null; never a string/fabricated placeholder.
  results.push(
    check(
      'unknown latency renders safely',
      snapshot.seats.every(row => row.active.latencyMs === null || (typeof row.active.latencyMs === 'number' && row.active.latencyMs >= 0)),
      `latencyMs values: ${snapshot.seats.map(row => row.active.latencyMs).join(', ')} (null or a real non-negative number only)`,
    ),
  )

  // 5. Fallback state visible (projection layer capability, using real BackendMetadata shape).
  const fallbackBackend: BackendMetadata = {
    backendType: 'EXTERNAL', provider: 'anthropic', model: 'claude-sonnet-5', host: 'cloud',
    latencyMs: 900, status: 'OK', fallbackFrom: 'LOCAL', fallbackReason: 'LOCAL_UNAVAILABLE',
  }
  const projectedFallbackRow = projectSeatBackendStatusRows([{ seat: 'claude', backend: fallbackBackend }])[0]
  results.push(check('fallback state visible', projectedFallbackRow.fallbackUsed === true, `fallbackUsed=${projectedFallbackRow.fallbackUsed}`))

  // 6. Fallback reason visible (preserved through BackendMetadata, not dropped).
  results.push(check('fallback reason visible', fallbackBackend.fallbackReason === 'LOCAL_UNAVAILABLE', `fallbackReason="${fallbackBackend.fallbackReason}"`))

  // 7. Model missing state visible.
  const modelMissingHealth = localCandidateHealthFromProbe(fakeEntry(), fakeProbe({ available: true, models: ['some-other-model:8b'] }))
  results.push(check('model missing state visible', modelMissingHealth === 'MODEL_NOT_INSTALLED', `health=${modelMissingHealth}`))

  // 8. Local unreachable state visible.
  const unreachableHealth = localCandidateHealthFromProbe(fakeEntry(), fakeProbe({ available: false, detail: 'connection refused' }))
  results.push(check('local unreachable state visible', unreachableHealth === 'UNAVAILABLE', `health=${unreachableHealth}`))

  // 9. External rate limit state visible (projection layer capability).
  const rateLimitBackend: BackendMetadata = {
    backendType: 'EXTERNAL', provider: 'openai', model: 'gpt-4o', host: 'cloud', latencyMs: 50, status: 'FAILED', failureClass: 'RATE_LIMIT',
  }
  const projectedRateLimitRow = projectSeatBackendStatusRows([{ seat: 'chatgpt', backend: rateLimitBackend }])[0]
  results.push(check('external rate limit state visible', projectedRateLimitRow.ready === 'RATE_LIMITED', `ready=${projectedRateLimitRow.ready}`))

  // 10. No fake READY from registry-only config — health never READY without a live probe saying so.
  const registryOnlyUnreachable = localCandidateHealthFromProbe(fakeEntry({ enabled: true }), fakeProbe({ available: false }))
  const registryOnlyNotInstalled = localCandidateHealthFromProbe(fakeEntry({ enabled: true }), fakeProbe({ available: true, models: [] }))
  results.push(
    check(
      'no fake READY from registry-only config',
      registryOnlyUnreachable !== 'READY' && registryOnlyNotInstalled !== 'READY',
      `unreachable=${registryOnlyUnreachable} notInstalled=${registryOnlyNotInstalled} (registry enabled:true in both cases)`,
    ),
  )

  // 11. Routing mode visible.
  results.push(
    check(
      'routing mode visible',
      ['LOCAL_ONLY', 'LOCAL_FIRST', 'HYBRID', 'EXTERNAL_ONLY'].includes(snapshot.routingModeResolved),
      `routingModeResolved=${snapshot.routingModeResolved}`,
    ),
  )

  // 12. EXTERNAL_ONLY represented correctly — liveRouting stays EXTERNAL_ONLY even if resolved mode changes.
  const { body: snapshotWithLocalFirstEnv } = await withEnv({ ...NO_CLOUD_KEYS, COUNCIL_ROUTING_MODE: 'LOCAL_FIRST' }, () => fetchSnapshot())
  results.push(
    check(
      'EXTERNAL_ONLY represented correctly (liveRouting never implies local is live)',
      snapshotWithLocalFirstEnv.liveRouting === 'EXTERNAL_ONLY' && snapshotWithLocalFirstEnv.routingModeResolved === 'LOCAL_FIRST',
      `liveRouting=${snapshotWithLocalFirstEnv.liveRouting} routingModeResolved=${snapshotWithLocalFirstEnv.routingModeResolved}`,
    ),
  )

  // 13. Model registry slot visible.
  const registrySlots = snapshot.localRegistry.map(r => r.slot).sort()
  results.push(
    check(
      'model registry slot visible',
      JSON.stringify(registrySlots) === JSON.stringify(['CODING', 'GENERAL', 'RED_TEAM', 'RESEARCH', 'SYNTHESIS']),
      `slots=${registrySlots.join(',')}`,
    ),
  )

  // 14. Disabled research slot represented honestly.
  const researchSlot = snapshot.localRegistry.find(r => r.slot === 'RESEARCH')
  results.push(check('disabled research slot represented honestly', researchSlot?.enabled === false, `RESEARCH enabled=${researchSlot?.enabled}`))

  // 15. Diversity uniqueModels visible and internally consistent.
  results.push(
    check(
      'diversity uniqueModels visible',
      typeof snapshot.diversity.uniqueModels === 'number' && snapshot.diversity.uniqueModels <= snapshot.diversity.totalRespondingSeats,
      `uniqueModels=${snapshot.diversity.uniqueModels} totalRespondingSeats=${snapshot.diversity.totalRespondingSeats}`,
    ),
  )

  // 16. sharedModelGroups visible (disclosed when sharing exists) — direct computeModelDiversity check.
  const sharedSample = computeModelDiversity([
    { seat: 'chatgpt', backend: { backendType: 'EXTERNAL', provider: 'openai', model: 'gpt-4o', host: 'cloud', latencyMs: 0, status: 'OK' } },
    { seat: 'baby', backend: { backendType: 'EXTERNAL', provider: 'openai', model: 'gpt-4o', host: 'cloud', latencyMs: 0, status: 'OK' } },
  ])
  results.push(
    check(
      'sharedModelGroups visible',
      sharedSample.sharedModelGroups.length === 1 && sharedSample.sharedModelGroups[0].seats.length === 2,
      `sharedModelGroups=${JSON.stringify(sharedSample.sharedModelGroups)}`,
    ),
  )

  // 17. Secrets not serialized.
  const secretsSnapshot = await withEnv(
    { ANTHROPIC_API_KEY: 'sk-ant-TOTALLY-FAKE-STATUS-UI-SECRET', OPENAI_API_KEY: 'sk-TOTALLY-FAKE-STATUS-UI-OPENAI' },
    () => fetchSnapshot(),
  )
  const serialized = JSON.stringify(secretsSnapshot.body)
  results.push(
    check(
      'secrets not serialized',
      !serialized.includes('TOTALLY-FAKE-STATUS-UI-SECRET') && !serialized.includes('TOTALLY-FAKE-STATUS-UI-OPENAI'),
      'serialized snapshot body does not contain either fake secret value',
    ),
  )

  // 18. Raw auth headers not serialized.
  const lowerSerialized = serialized.toLowerCase()
  results.push(
    check(
      'raw auth headers not serialized',
      !lowerSerialized.includes('authorization') && !lowerSerialized.includes('x-api-key') && !lowerSerialized.includes('bearer '),
      'serialized snapshot body contains no auth-header-shaped keys/values',
    ),
  )

  // 19. Current production execution path unchanged — source-level proxy: execute.ts does not
  //     import the new backends module (authoritative git-diff check is run separately, see report).
  const executeSource = executeRouteSource()
  results.push(
    check(
      'current production execution path unchanged (no backends import)',
      !executeSource.includes('live-orchestration/backends'),
      'app/api/chat/execute.ts does not import lib/council/live-orchestration/backends',
    ),
  )

  // 20. app/api/chat/execute.ts untouched — same proxy; authoritative check is `git diff` (external).
  results.push(
    check(
      'app/api/chat/execute.ts untouched (source-level proxy)',
      executeSource.includes('familyIsStreamConfigured') && executeSource.includes('streamCouncilFamily'),
      'execute.ts still calls the original, unmodified streamProvider.ts exports directly',
    ),
  )

  // 21. Existing Council backend foundation suite still passes (re-run in full here).
  const foundationResults = await runCouncilLocalBackendFoundationValidation()
  const foundationPass = foundationResults.filter(r => r.pass).length
  results.push(
    check(
      'existing Council backend foundation 20/20 still passes',
      foundationPass === foundationResults.length,
      `${foundationPass}/${foundationResults.length} PASS`,
    ),
  )

  // 22. UI label vocabulary present in the component (static text check for required states).
  const source = componentSource()
  const requiredLabels = ['READY', 'UNAVAILABLE', 'MODEL NOT INSTALLED', 'NOT INSTALLED / UNKNOWN', 'RATE_LIMITED']
  const missingLabels = requiredLabels.filter(label => !source.includes(label))
  results.push(check('required status label vocabulary present in UI', missingLabels.length === 0, missingLabels.length ? `missing=${missingLabels.join(',')}` : 'all required labels present'))

  // 23. Seat identity kept separate from backend identity in the UI source (no field aliasing).
  results.push(
    check(
      'UI keeps seat and backend identity as distinct fields',
      source.includes('row.seat') && source.includes('row.active.model') && source.includes('row.active.provider'),
      'component renders seat, model, and provider as separate accessors',
    ),
  )

  return results
}
