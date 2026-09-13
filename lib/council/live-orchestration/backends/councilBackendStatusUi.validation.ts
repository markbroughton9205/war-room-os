import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { GET as backendStatusGet } from '@/app/api/council/backend-status/route'
import { buildCouncilBackendStatusSnapshot } from './backendStatusSnapshot'
import { localCandidateHealthFromProbe } from './localBackend'
import { computeModelDiversity } from './diversity'
import { LOCAL_MODEL_REGISTRY } from './localModelRegistry'
import { runCouncilLocalBackendFoundationValidation } from './localBackendFoundation.validation'
import {
  formatBackendLatency,
  formatFallbackVisibility,
  formatLiveRoutingWired,
  projectSeatBackendStatusRows,
  statusPayloadContainsForbiddenSecrets,
  stripSecretBearingValue,
  unknownCouncilBackendStatusSnapshot,
  LIVE_COUNCIL_ROUTING_WIRED,
} from './uiStatusProjection'
import type { LocalModelRegistryEntry } from './localModelRegistry'
import type { BackendMetadata } from './types'
import type { OllamaProbeResult } from '@/lib/native-builder/ollamaClient'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function repoFile(relativeFromThisModule: string): string {
  return fileURLToPath(new URL(relativeFromThisModule, import.meta.url))
}

function readRepo(relativeFromThisModule: string): string {
  return readFileSync(repoFile(relativeFromThisModule), 'utf8')
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

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const original: Record<string, string | undefined> = {}
  for (const key of Object.keys(vars)) original[key] = process.env[key]
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return fn()
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

const NO_CLOUD_KEYS = {
  OPENAI_API_KEY: undefined,
  ANTHROPIC_API_KEY: undefined,
  XAI_API_KEY: undefined,
  GEMINI_API_KEY: undefined,
  MOONSHOT_API_KEY: undefined,
}

function gitDiffNames(files: string[]): string {
  try {
    return execSync(`git diff --name-only -- ${files.join(' ')}`, {
      cwd: fileURLToPath(new URL('../../../../../', import.meta.url)),
      encoding: 'utf8',
    }).trim()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function runCommand(command: string): { ok: boolean; output: string } {
  try {
    const output = execSync(command, {
      cwd: fileURLToPath(new URL('../../../../../', import.meta.url)),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, output }
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}`.trim() }
  }
}

export async function runCouncilBackendStatusUiValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  const unreachableProbe = fakeProbe({ available: false, models: [], detail: 'connection refused' })
  const snapshot = withEnv(NO_CLOUD_KEYS, () => buildCouncilBackendStatusSnapshot({
    ollamaProbe: unreachableProbe,
    routingMode: 'EXTERNAL_ONLY',
    liveRoutingWired: false,
  }))

  const claudeRow = snapshot.seats.find(row => row.seat === 'claude')
  const panelSource = readRepo('../../../../components/war-room/providers/CouncilBackendStatusPanel.tsx')
  const routeSource = readRepo('../../../../app/api/council/backend-status/route.ts')
  const executeSource = readRepo('../../../../app/api/chat/execute.ts')
  const streamProviderSource = readRepo('../../streamProvider.ts')
  const anthropicSource = readRepo('../../adapters/anthropic.ts')
  const openaiSource = readRepo('../../adapters/openai.ts')
  const geminiSource = readRepo('../../adapters/gemini.ts')
  const grokSource = readRepo('../../adapters/grok.ts')

  results.push(
    check(
      'seat identity separate from backend identity',
      Boolean(claudeRow && claudeRow.seat === 'claude' && claudeRow.seat !== claudeRow.provider && claudeRow.seat !== claudeRow.model && claudeRow.backendType === 'EXTERNAL'),
      `seat=${claudeRow?.seat} backend=${claudeRow?.backendType} provider=${claudeRow?.provider} model=${claudeRow?.model}`,
    ),
  )

  results.push(
    check(
      'external status row projects correctly',
      Boolean(
        claudeRow
        && claudeRow.backendType === 'EXTERNAL'
        && claudeRow.provider === 'Anthropic'
        && claudeRow.runtime === null
        && claudeRow.status !== 'READY'
        && claudeRow.latencyMs === null,
      ),
      `claude=${JSON.stringify(claudeRow)}`,
    ),
  )

  const localBackend: BackendMetadata = {
    backendType: 'LOCAL',
    provider: 'ollama',
    model: 'Huihui-Qwen3-14B-abliterated-v2',
    quantization: 'Q4_K_M',
    host: 'http://localhost:11434',
    latencyMs: 1700,
    status: 'OK',
  }
  const localRow = projectSeatBackendStatusRows([{ seat: 'claude', backend: localBackend, localRoleSlot: 'GENERAL' }])[0]
  results.push(
    check(
      'local status row projects correctly',
      Boolean(
        localRow
        && localRow.seat === 'claude'
        && localRow.backendType === 'LOCAL'
        && localRow.runtime === 'Ollama'
        && localRow.model === 'Huihui-Qwen3-14B-abliterated-v2'
        && localRow.status === 'READY'
        && localRow.quantization === 'Q4_K_M',
      ),
      `localRow=${JSON.stringify(localRow)}`,
    ),
  )

  results.push(
    check(
      'unknown latency safe',
      formatBackendLatency(null) === '—'
      && formatBackendLatency(undefined) === '—'
      && snapshot.seats.every(row => row.latencyMs === null && formatBackendLatency(row.latencyMs) === '—'),
      `format(null)=${formatBackendLatency(null)} live latencies=${snapshot.seats.map(row => row.latencyMs).join(',')}`,
    ),
  )

  const fallbackBackend: BackendMetadata = {
    backendType: 'EXTERNAL',
    provider: 'Anthropic',
    model: 'claude-sonnet-5',
    host: 'cloud',
    latencyMs: 842,
    status: 'OK',
    fallbackFrom: 'LOCAL',
    fallbackReason: 'MODEL_NOT_INSTALLED',
  }
  const fallbackRow = projectSeatBackendStatusRows([{ seat: 'claude', backend: fallbackBackend }])[0]
  results.push(
    check(
      'fallbackUsed visible',
      fallbackRow.fallbackUsed === true && formatFallbackVisibility(fallbackRow) === 'LOCAL → EXTERNAL',
      `fallbackUsed=${fallbackRow.fallbackUsed} label=${formatFallbackVisibility(fallbackRow)}`,
    ),
  )
  results.push(
    check(
      'fallbackReason visible',
      fallbackRow.fallbackReason === 'MODEL_NOT_INSTALLED' && panelSource.includes('REASON:') && panelSource.includes('FALLBACK USED'),
      `fallbackReason=${fallbackRow.fallbackReason}`,
    ),
  )

  const missingHealth = localCandidateHealthFromProbe(fakeEntry(), fakeProbe({ available: true, models: ['other:8b'] }))
  results.push(check('MODEL_NOT_INSTALLED visible', missingHealth === 'MODEL_NOT_INSTALLED' && panelSource.includes('MODEL NOT INSTALLED'), `health=${missingHealth}`))

  const unreachableHealth = localCandidateHealthFromProbe(fakeEntry(), fakeProbe({ available: false, detail: 'connection refused' }))
  results.push(check('LOCAL_UNAVAILABLE visible', unreachableHealth === 'UNAVAILABLE', `health=${unreachableHealth}`))

  const rateLimitBackend: BackendMetadata = {
    backendType: 'EXTERNAL',
    provider: 'OpenAI',
    model: 'gpt-4o',
    host: 'cloud',
    latencyMs: 50,
    status: 'FAILED',
    failureClass: 'RATE_LIMIT',
  }
  const rateLimitRow = projectSeatBackendStatusRows([{ seat: 'chatgpt', backend: rateLimitBackend }])[0]
  results.push(
    check(
      'RATE_LIMITED visible',
      rateLimitRow.status === 'RATE_LIMITED' && rateLimitRow.ready === 'RATE_LIMITED' && panelSource.includes('RATE_LIMITED'),
      `status=${rateLimitRow.status} ready=${rateLimitRow.ready}`,
    ),
  )

  const registryOnlyUnreachable = localCandidateHealthFromProbe(fakeEntry({ enabled: true }), fakeProbe({ available: false }))
  const registryOnlyMissing = localCandidateHealthFromProbe(fakeEntry({ enabled: true }), fakeProbe({ available: true, models: [] }))
  const poolReadyLeak = snapshot.localModelPool.some(entry => entry.health === 'READY')
  const seatLocalReadyLeak = snapshot.seats.some(row => row.backendType === 'LOCAL' && row.status === 'READY')
  results.push(
    check(
      'registry-only local candidate never becomes fake READY',
      registryOnlyUnreachable !== 'READY' && registryOnlyMissing !== 'READY' && !poolReadyLeak && !seatLocalReadyLeak,
      `unreachable=${registryOnlyUnreachable} missing=${registryOnlyMissing} poolReadyLeak=${poolReadyLeak} seatLocalReadyLeak=${seatLocalReadyLeak}`,
    ),
  )

  results.push(
    check(
      'routing mode visible',
      snapshot.routingMode === 'EXTERNAL_ONLY' && panelSource.includes('Routing mode foundation'),
      `routingMode=${snapshot.routingMode}`,
    ),
  )

  results.push(
    check(
      'liveRoutingWired false represented honestly',
      snapshot.liveRoutingWired === false
      && LIVE_COUNCIL_ROUTING_WIRED === false
      && formatLiveRoutingWired(false) === 'NO'
      && panelSource.includes('Live local routing wired'),
      `liveRoutingWired=${snapshot.liveRoutingWired} label=${formatLiveRoutingWired(snapshot.liveRoutingWired)}`,
    ),
  )

  const localFirstSnapshot = withEnv({ ...NO_CLOUD_KEYS, COUNCIL_ROUTING_MODE: 'LOCAL_FIRST' }, () => (
    buildCouncilBackendStatusSnapshot({
      ollamaProbe: unreachableProbe,
      liveRoutingWired: false,
    })
  ))
  results.push(
    check(
      'EXTERNAL_ONLY represented correctly',
      localFirstSnapshot.routingMode === 'LOCAL_FIRST'
      && localFirstSnapshot.liveRoutingWired === false
      && localFirstSnapshot.seats.every(row => row.backendType === 'EXTERNAL')
      && panelSource.includes('EXTERNAL ONLY'),
      `routingMode=${localFirstSnapshot.routingMode} liveWired=${localFirstSnapshot.liveRoutingWired} backends=${localFirstSnapshot.seats.map(row => row.backendType).join(',')}`,
    ),
  )

  const poolSlots = snapshot.localModelPool.map(entry => entry.slot)
  const general = snapshot.localModelPool.find(entry => entry.slot === 'GENERAL')
  const coding = snapshot.localModelPool.find(entry => entry.slot === 'CODING')
  const redTeam = snapshot.localModelPool.find(entry => entry.slot === 'RED_TEAM')
  const synthesis = snapshot.localModelPool.find(entry => entry.slot === 'SYNTHESIS')
  const research = snapshot.localModelPool.find(entry => entry.slot === 'RESEARCH')

  results.push(check('GENERAL local slot visible', general?.enabled === true && Boolean(general.candidateModel.includes('Huihui-Qwen3-14B-abliterated-v2')), `GENERAL=${JSON.stringify(general)}`))
  results.push(check('CODING local slot visible', coding?.enabled === true && Boolean(coding.candidateModel.includes('Huihui-Qwen3-Coder-30B')), `CODING=${JSON.stringify(coding)}`))
  results.push(check('RED_TEAM local slot visible', redTeam?.enabled === true && Boolean(redTeam.candidateModel.includes('Dolphin-Mistral-24B-Venice-Edition')), `RED_TEAM=${JSON.stringify(redTeam)}`))
  results.push(check('SYNTHESIS local slot visible', synthesis?.enabled === true && Boolean(synthesis.candidateModel.includes('Huihui-Qwen3.5-35B-A3B-abliterated')), `SYNTHESIS=${JSON.stringify(synthesis)}`))
  results.push(
    check(
      'RESEARCH disabled/reused state honest',
      research?.enabled === false && research.health !== 'READY' && Boolean(research.reuseNote?.toLowerCase().includes('reuses general')),
      `RESEARCH=${JSON.stringify(research)}`,
    ),
  )

  const sharedSample = computeModelDiversity([
    { seat: 'chatgpt', backend: { backendType: 'EXTERNAL', provider: 'OpenAI', model: 'gpt-4o', host: 'cloud', latencyMs: 0, status: 'OK' } },
    { seat: 'baby', backend: { backendType: 'EXTERNAL', provider: 'OpenAI', model: 'gpt-4o', host: 'cloud', latencyMs: 0, status: 'OK' } },
  ])
  results.push(
    check(
      'diversity uniqueModels represented',
      typeof snapshot.diversity.uniqueModels === 'number' && sharedSample.uniqueModels === 1,
      `snapshot.uniqueModels=${snapshot.diversity.uniqueModels} sharedSample.uniqueModels=${sharedSample.uniqueModels}`,
    ),
  )
  results.push(
    check(
      'sharedModelGroups represented',
      sharedSample.sharedModelGroups.length === 1 && sharedSample.sharedModelGroups[0].seats.includes('chatgpt') && sharedSample.sharedModelGroups[0].seats.includes('baby'),
      `sharedModelGroups=${JSON.stringify(sharedSample.sharedModelGroups)}`,
    ),
  )
  results.push(
    check(
      'configured diversity not mislabeled live',
      snapshot.diversity.classification === 'CONFIGURED' && panelSource.includes('CONFIGURED / PLANNED') && !panelSource.includes('currently-live backend'),
      `classification=${snapshot.diversity.classification}`,
    ),
  )

  const secretSnapshot = withEnv(
    { ANTHROPIC_API_KEY: 'sk-ant-TOTALLY-FAKE-STATUS-UI-SECRET', OPENAI_API_KEY: 'sk-TOTALLY-FAKE-STATUS-UI-OPENAI' },
    () => buildCouncilBackendStatusSnapshot({
      ollamaProbe: fakeProbe({
        available: false,
        baseUrl: 'http://user:sk-ant-TOTALLY-FAKE-STATUS-UI-SECRET@localhost:11434',
        detail: 'Authorization: Bearer sk-ant-TOTALLY-FAKE-STATUS-UI-SECRET',
      }),
      liveRoutingWired: false,
    }),
  )
  const secretSerialized = JSON.stringify(secretSnapshot)
  results.push(
    check(
      'secret value not serialized',
      !secretSerialized.includes('TOTALLY-FAKE-STATUS-UI-SECRET') && !secretSerialized.includes('TOTALLY-FAKE-STATUS-UI-OPENAI'),
      'snapshot JSON does not contain injected secret values',
    ),
  )

  const headerPayload = stripSecretBearingValue({
    authorization: 'Bearer sk-ant-hidden',
    'x-api-key': 'sk-hidden',
    note: 'Authorization: Bearer sk-ant-hidden',
  })
  const headerSerialized = JSON.stringify(headerPayload).toLowerCase()
  results.push(
    check(
      'auth headers not serialized',
      !('authorization' in (headerPayload as object)) && !('x-api-key' in (headerPayload as object)) && !headerSerialized.includes('bearer sk-'),
      `sanitized=${JSON.stringify(headerPayload)}`,
    ),
  )

  results.push(
    check(
      'raw environment secrets not serialized',
      !statusPayloadContainsForbiddenSecrets(secretSerialized, ['sk-ant-TOTALLY-FAKE-STATUS-UI-SECRET', 'sk-TOTALLY-FAKE-STATUS-UI-OPENAI']),
      'forbidden secret patterns absent from snapshot',
    ),
  )

  const protectedDiff = gitDiffNames([
    'app/api/chat/execute.ts',
    'lib/council/live-orchestration/streamProvider.ts',
    'lib/council/live-orchestration/adapters/anthropic.ts',
    'lib/council/live-orchestration/adapters/openai.ts',
    'lib/council/live-orchestration/adapters/gemini.ts',
    'lib/council/live-orchestration/adapters/grok.ts',
  ])
  results.push(
    check(
      'app/api/chat/execute.ts unchanged',
      protectedDiff.length === 0 && !executeSource.includes('invokeCouncilSeat') && !executeSource.includes('live-orchestration/backends'),
      `gitDiff=${protectedDiff || '(empty)'} invokeCouncilSeat=${executeSource.includes('invokeCouncilSeat')}`,
    ),
  )
  results.push(
    check(
      'streamProvider.ts unchanged',
      !protectedDiff.includes('streamProvider.ts') && streamProviderSource.includes('familyIsStreamConfigured'),
      `gitDiff mentions streamProvider=${protectedDiff.includes('streamProvider.ts')}`,
    ),
  )
  results.push(
    check(
      'provider adapters unchanged',
      !protectedDiff.includes('adapters/anthropic.ts')
      && !protectedDiff.includes('adapters/openai.ts')
      && !protectedDiff.includes('adapters/gemini.ts')
      && !protectedDiff.includes('adapters/grok.ts')
      && anthropicSource.length > 0
      && openaiSource.length > 0
      && geminiSource.length > 0
      && grokSource.length > 0,
      `gitDiff=${protectedDiff || '(empty)'}`,
    ),
  )

  const foundationResults = await runCouncilLocalBackendFoundationValidation()
  const foundationPass = foundationResults.filter(result => result.pass).length
  results.push(
    check(
      'existing Council local backend 20/20 regression passes',
      foundationPass === foundationResults.length && foundationResults.length === 20,
      `${foundationPass}/${foundationResults.length} PASS`,
    ),
  )

  results.push(
    check(
      'status endpoint is read-only',
      /\bexport async function GET\b/.test(routeSource)
      && !/\bexport async function POST\b/.test(routeSource)
      && !/\bexport async function PUT\b/.test(routeSource)
      && !/\bexport async function PATCH\b/.test(routeSource)
      && !/\bexport async function DELETE\b/.test(routeSource),
      'route exports GET only',
    ),
  )

  const empty = unknownCouncilBackendStatusSnapshot()
  results.push(
    check(
      'status UI renders safe empty/unknown state',
      empty.seats.length === 0
      && empty.diversity.classification === 'CONFIGURED'
      && formatBackendLatency(null) === '—'
      && empty.liveRoutingWired === false
      && panelSource.includes('council-backend-status-empty')
      && panelSource.includes('No fake READY'),
      `emptySeats=${empty.seats.length} wired=${empty.liveRoutingWired}`,
    ),
  )

  results.push(
    check(
      'latency compact format',
      formatBackendLatency(842) === '842 ms' && formatBackendLatency(1700) === '1.7 s',
      `842=${formatBackendLatency(842)} 1700=${formatBackendLatency(1700)}`,
    ),
  )

  results.push(
    check(
      'registry slots include all five role slots',
      poolSlots.includes('GENERAL') && poolSlots.includes('CODING') && poolSlots.includes('RED_TEAM') && poolSlots.includes('SYNTHESIS') && poolSlots.includes('RESEARCH') && LOCAL_MODEL_REGISTRY.length === 5,
      `slots=${poolSlots.join(',')}`,
    ),
  )

  const typecheck = runCommand('pnpm exec tsc --noEmit')
  results.push(check('typecheck clean', typecheck.ok, typecheck.ok ? 'tsc --noEmit exited 0' : typecheck.output.slice(0, 800)))

  const lint = runCommand([
    'pnpm exec eslint',
    'components/war-room/providers/CouncilBackendStatusPanel.tsx',
    'components/war-room/providers/useCouncilBackendStatus.ts',
    'components/war-room/live-room/CouncilMembersPanel.tsx',
    'components/war-room/live-room/DockPanelContent.tsx',
    'app/api/council/backend-status/route.ts',
    'lib/council/live-orchestration/backends/uiStatusProjection.ts',
    'lib/council/live-orchestration/backends/backendStatusSnapshot.ts',
    'lib/council/live-orchestration/backends/councilBackendStatusUi.validation.ts',
    'lib/council/live-orchestration/backends/localBackend.ts',
    'lib/council/live-orchestration/backends/externalBackend.ts',
  ].join(' '))
  results.push(check('targeted lint clean', lint.ok, lint.ok ? 'eslint exited 0' : lint.output.slice(0, 800)))

  const getResponse = await withEnv(NO_CLOUD_KEYS, async () => backendStatusGet())
  const getBody = await getResponse.json() as { liveRoutingWired?: boolean; routingMode?: string }
  results.push(
    check(
      'status endpoint GET returns honest unwired snapshot',
      getResponse.status === 200 && getBody.liveRoutingWired === false && getBody.routingMode === 'EXTERNAL_ONLY',
      `http=${getResponse.status} liveRoutingWired=${getBody.liveRoutingWired} routingMode=${getBody.routingMode}`,
    ),
  )

  return results
}
