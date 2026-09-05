import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { probeOllama } from '@/lib/native-builder/ollamaClient'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { localCandidateHealthFromProbe } from './localBackend'
import { LOCAL_MODEL_REGISTRY } from './localModelRegistry'
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

const GENERAL_MODEL_ID = 'huihui_ai/qwen3-abliterated:14b'
const GENERAL_SEAT: CouncilOrchestrationFamily = 'claude' // SEAT_LOCAL_ROLE_SLOT.claude === 'GENERAL'

function baseInput(seat: CouncilOrchestrationFamily, overrides: Partial<ModelBackendInvokeInput> = {}): ModelBackendInvokeInput {
  return {
    seat,
    systemPrompt: 'You are a terse test assistant. Keep answers under 20 words.',
    userPrompt: 'Reply with exactly the word: PONG',
    maxTokens: 30,
    signal: new AbortController().signal,
    onDelta: () => {},
    timeoutKind: 'council',
    ...overrides,
  }
}

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

export async function runCouncilGeneralLocalActivationValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  const generalEntry = LOCAL_MODEL_REGISTRY.find(e => e.slot === 'GENERAL')
  const registrySource = readRepoFile('lib/council/live-orchestration/backends/localModelRegistry.ts')

  // 1. GENERAL registry entry exists.
  results.push(check('GENERAL registry entry exists', Boolean(generalEntry), `generalEntry=${JSON.stringify(generalEntry)}`))

  // 2. GENERAL model identity matches actual configured artifact.
  results.push(
    check(
      'GENERAL model identity matches actual configured artifact',
      generalEntry?.modelId === GENERAL_MODEL_ID,
      `modelId=${generalEntry?.modelId}`,
    ),
  )

  // 3. Registry does not falsely claim v2 without proof — repo points at the verified Ollama
  // source (not a guessed/unconfirmed HF repo path), and the file documents the actual proof.
  // Comment text is normalized (line breaks + comment markers collapsed to single spaces) before
  // matching, so a source line-wrap can't produce a false FAIL on an otherwise-present claim.
  const normalizedRegistrySource = registrySource.replace(/\r?\n\s*\/\/\s*/g, ' ')
  results.push(
    check(
      'registry does not falsely claim v2 without proof',
      generalEntry?.repo === 'ollama.com/huihui_ai/qwen3-abliterated'
      && normalizedRegistrySource.includes('IDENTICAL model-layer digest')
      && normalizedRegistrySource.includes('NOT independently confirmed'),
      `repo=${generalEntry?.repo}; digestProofPresent=${normalizedRegistrySource.includes('IDENTICAL model-layer digest')}; unconfirmedDisclosurePresent=${normalizedRegistrySource.includes('NOT independently confirmed')}`,
    ),
  )

  // 4. Ollama reachable (real probe, no mocks).
  const realProbe = await probeOllama()
  results.push(check('Ollama reachable', realProbe.available, `available=${realProbe.available} models=${realProbe.models.join(',')}`))

  // 5. GENERAL model installed (real probe).
  const generalInstalled = realProbe.models.some(name => name === GENERAL_MODEL_ID || name.startsWith('huihui_ai/qwen3-abliterated:'))
  results.push(check('GENERAL model installed', generalInstalled, `installedModels=${realProbe.models.join(',')}`))

  // 6. GENERAL health READY only with runtime+model (real probe -> real classification).
  const realHealth = localCandidateHealthFromProbe(generalEntry ?? null, realProbe)
  results.push(check('GENERAL health READY only with runtime+model', realHealth === 'READY', `health=${realHealth}`))

  // 7. Unavailable runtime != READY (mocked).
  const unavailableHealth = localCandidateHealthFromProbe(generalEntry ?? null, { available: false, baseUrl: 'http://localhost:11434', models: [], detail: 'mock unreachable' })
  results.push(check('unavailable runtime != READY', unavailableHealth !== 'READY', `health=${unavailableHealth}`))

  // 8. Missing model != READY (mocked — reachable but model absent).
  const missingHealth = localCandidateHealthFromProbe(generalEntry ?? null, { available: true, baseUrl: 'http://localhost:11434', models: ['some-other-model:8b'], detail: 'ok' })
  results.push(check('missing model != READY', missingHealth !== 'READY', `health=${missingHealth}`))

  // 9-16. Real LOCAL_FIRST call against the REAL installed model — no mocks. This is the actual
  // proof: Council -> invokeCouncilSeat() -> LOCAL_FIRST -> Ollama -> the real GENERAL model.
  const localFirstResult = await withEnv(ALL_CLOUD_KEYS, async () =>
    invokeCouncilSeat(baseInput(GENERAL_SEAT, { routingModeOverride: 'LOCAL_FIRST' })),
  )
  results.push(check('LOCAL_FIRST chooses local GENERAL', localFirstResult.backend.backendType === 'LOCAL', `backendType=${localFirstResult.backend.backendType}`))
  results.push(check('local response succeeds', localFirstResult.ok && localFirstResult.text.trim().length > 0, `ok=${localFirstResult.ok} textLen=${localFirstResult.text.length}`))
  results.push(
    check(
      'local backend metadata correct',
      localFirstResult.backend.model === GENERAL_MODEL_ID
      && localFirstResult.backend.repo === generalEntry?.repo
      && localFirstResult.backend.quantization === generalEntry?.quant,
      `model=${localFirstResult.backend.model} repo=${localFirstResult.backend.repo} quant=${localFirstResult.backend.quantization}`,
    ),
  )
  results.push(
    check(
      'seat identity preserved',
      GENERAL_SEAT !== localFirstResult.backend.model && GENERAL_SEAT !== localFirstResult.backend.provider,
      `seat=${GENERAL_SEAT} backend.model=${localFirstResult.backend.model} backend.provider=${localFirstResult.backend.provider}`,
    ),
  )
  results.push(check('runtime provenance says Ollama', localFirstResult.backend.provider === 'ollama', `provider=${localFirstResult.backend.provider}`))
  results.push(
    check(
      'model provenance truthful',
      localFirstResult.backend.repo === 'ollama.com/huihui_ai/qwen3-abliterated',
      `repo=${localFirstResult.backend.repo}`,
    ),
  )
  results.push(
    check(
      'no external provider used on successful local call',
      localFirstResult.backend.backendType === 'LOCAL' && !localFirstResult.backend.fallbackFrom,
      `backendType=${localFirstResult.backend.backendType} fallbackFrom=${localFirstResult.backend.fallbackFrom}`,
    ),
  )
  results.push(check('no fallback metadata invented', localFirstResult.backend.fallbackFrom === undefined, `fallbackFrom=${localFirstResult.backend.fallbackFrom}`))

  // 17. LOCAL_FIRST fallback still works on controlled local failure (mocked Ollama unavailable;
  // the model itself is never touched/uninstalled).
  await withEnv(ALL_CLOUD_KEYS, async () => {
    const mock = installMockFetch(url => (url.endsWith('/api/tags') ? 'reject' : { ok: false, status: 500, body: {} }))
    const result = await invokeCouncilSeat(baseInput(GENERAL_SEAT, { routingModeOverride: 'LOCAL_FIRST' }))
    mock.restore()
    results.push(
      check(
        'LOCAL_FIRST fallback still works on controlled local failure',
        result.backend.backendType === 'EXTERNAL' && result.backend.fallbackFrom === 'LOCAL' && typeof result.backend.fallbackReason === 'string',
        `backendType=${result.backend.backendType} fallbackFrom=${result.backend.fallbackFrom} fallbackReason="${result.backend.fallbackReason}"`,
      ),
    )
  })

  // 18. LOCAL_ONLY successful local call never uses external (real call, real model).
  const localOnlyResult = await withEnv(ALL_CLOUD_KEYS, async () =>
    invokeCouncilSeat(baseInput(GENERAL_SEAT, { routingModeOverride: 'LOCAL_ONLY' })),
  )
  results.push(
    check(
      'LOCAL_ONLY successful local call never uses external',
      localOnlyResult.ok && localOnlyResult.backend.backendType === 'LOCAL',
      `ok=${localOnlyResult.ok} backendType=${localOnlyResult.backend.backendType}`,
    ),
  )

  // 19. RESEARCH remains disabled/reuses GENERAL honestly.
  const researchEntry = LOCAL_MODEL_REGISTRY.find(e => e.slot === 'RESEARCH')
  results.push(
    check(
      'RESEARCH remains disabled/reuses GENERAL honestly',
      researchEntry?.enabled === false && researchEntry?.modelId === generalEntry?.modelId && researchEntry?.repo === generalEntry?.repo,
      `RESEARCH.enabled=${researchEntry?.enabled} RESEARCH.modelId=${researchEntry?.modelId}`,
    ),
  )

  // 20-22. CODING/RED_TEAM/SYNTHESIS unchanged.
  const codingEntry = LOCAL_MODEL_REGISTRY.find(e => e.slot === 'CODING')
  results.push(
    check(
      'CODING unchanged',
      codingEntry?.modelId === 'huihui_ai/qwen3-coder-abliterated:30b-a3b' && codingEntry?.repo === 'huihui-ai/Huihui-Qwen3-Coder-30B-A3B-Instruct-abliterated',
      `CODING=${JSON.stringify(codingEntry)}`,
    ),
  )
  const redTeamEntry = LOCAL_MODEL_REGISTRY.find(e => e.slot === 'RED_TEAM')
  results.push(
    check(
      'RED_TEAM unchanged',
      redTeamEntry?.modelId === 'dolphin-mistral-venice:24b' && redTeamEntry?.repo === 'cognitivecomputations/Dolphin-Mistral-24B-Venice-Edition',
      `RED_TEAM=${JSON.stringify(redTeamEntry)}`,
    ),
  )
  const synthesisEntry = LOCAL_MODEL_REGISTRY.find(e => e.slot === 'SYNTHESIS')
  results.push(
    check(
      'SYNTHESIS unchanged',
      synthesisEntry?.modelId === 'huihui_ai/qwen3.5-abliterated:35b-a3b' && synthesisEntry?.repo === 'huihui-ai/Huihui-Qwen3.5-35B-A3B-abliterated',
      `SYNTHESIS=${JSON.stringify(synthesisEntry)}`,
    ),
  )

  // 23. No production env change.
  const envDiff = (() => {
    try {
      return execFileSync('git', ['diff', 'HEAD', '--name-only', '--', '.env', '.env.local', '.env.example', '.env.development', '.env.production'], {
        cwd: repoRoot(),
        encoding: 'utf8',
      }).trim()
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  })()
  results.push(check('no production env change', envDiff.length === 0, envDiff.length === 0 ? 'no diff' : `changed=${envDiff}`))

  // 24. No training started.
  const backendsIndexSource = readRepoFile('lib/council/live-orchestration/backends/index.ts')
  results.push(check('no training started', !/train|finetune|fine-tune/i.test(backendsIndexSource), 'no train/finetune-named export'))

  // 25. No unrelated model pull — only qwen2.5-coder:14b (pre-existing) and the GENERAL model are
  // installed; none of CODING/RED_TEAM/SYNTHESIS's modelIds appear in the real installed list.
  const unexpectedInstalled = [codingEntry?.modelId, redTeamEntry?.modelId, synthesisEntry?.modelId].filter(
    id => id && realProbe.models.some(name => name === id || name.startsWith(`${id.split(':')[0]}:`)),
  )
  results.push(
    check(
      'no unrelated model pull',
      unexpectedInstalled.length === 0,
      `installedModels=${realProbe.models.join(',')}; unexpectedlyPresent=${unexpectedInstalled.join(',') || 'none'}`,
    ),
  )

  // 26. No secrets serialized.
  await withEnv({ ...ALL_CLOUD_KEYS, ANTHROPIC_API_KEY: 'sk-ant-TOTALLY-FAKE-GENERAL-ACTIVATION-SECRET' }, async () => {
    const result = await invokeCouncilSeat(baseInput(GENERAL_SEAT, { routingModeOverride: 'LOCAL_ONLY' }))
    const serialized = JSON.stringify(result)
    results.push(
      check(
        'no secrets serialized',
        !serialized.includes('TOTALLY-FAKE-GENERAL-ACTIVATION-SECRET'),
        'serialized result does not contain the injected fake secret',
      ),
    )
  })

  return results
}
