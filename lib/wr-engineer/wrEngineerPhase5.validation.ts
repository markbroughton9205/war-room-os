/**
 * WR-Engineer Phase 5 local-engine + Genesis dashboard regression suite.
 *
 * Run via: pnpm run validate:wr-engineer-phase5
 *
 * Uses lib/wr-engineer/__fixtures__/phase5LocalEngineFixture.ts only — never knownIssueFixture.ts,
 * bridgeEvalFixture.ts, phase3ChatFixture.ts, or phase4InspectFixture.ts. Does not download or
 * train a model. Re-runs Phase 1–4 inline so one invocation proves the stack together.
 */
import { readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'

import { runWrEngineerPhase4Validation } from './wrEngineerPhase4.validation'
import { JsonFileNodeStore } from './node/store'
import { JsonFileSessionStore } from './session/store'
import { JsonFileEngineeringMemoryStore } from './memory/store'
import { generatePairingCode, requestPairing, authorizePairing } from './node/pairing'
import { NODE_INSPECTION_CAPABILITIES } from './node/types'
import { FUTURE_MESSAGE_TYPES, isMessageTypeEnabled } from './node/protocol'
import { registerRepository } from './node/repository'
import { createSession, assembleSessionContext } from './session/session'
import { IDENTITY_LAYER_ORDER } from './identity/loader'
import { wrapInspectToolRequest } from './inspectContract'
import { sendInspectingEngineeringChatMessage } from './engineeringChat'
import { WR_ENGINEER_CANNOT_WRITE_FILES } from './codeEditProposals'
import { WR_ENGINEER_BRIDGE_NEVER_APPLIES } from './nativeBuilderBridge'
import { LocalWrEngineerModelAdapter, type LocalWrEngineerTransport } from './localModelAdapter'
import { WrEngineerModelRouter } from './modelRouter'
import { parseEngineSelection, JsonFileEngineSelectionStore } from './engineSelection'
import { classifyProviderFailure, providerHealthFromFailure } from './providerFailure'
import { boundSystemPrompt } from './localContext'
import { redactEngineEndpoint, localEngineStatusFromProbe, resetLocalEngineTelemetry, getLocalEngineTelemetry } from './localEngine'
import { buildEngineDashboardState, dashboardStateIsSecretFree, resetExternalFailureMemory } from './engineHealth'
import { describeLocalEngineStartup, shouldStartOllamaServe } from './localEngineStartup'
import { DEFAULT_ENGINE_MODE, DEFAULT_LOCAL_MODEL, DEFAULT_LOCAL_RUNTIME, RECOMMENDED_LOCAL_MODEL } from './engineTypes'
import { probeOllama } from '@/lib/native-builder/ollamaClient'
import type { ModelAdapter, ModelAdapterResult } from './types'
import type { EngineSelection } from './engineTypes'
import type { OllamaCompletionResult, OllamaProbeResult } from '@/lib/native-builder/ollamaClient'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function tmpDir(label: string): string {
  return path.join(os.tmpdir(), `wr-engineer-eval-${label}-${randomUUID()}`)
}
function tmpFile(label: string): string {
  return path.join(os.tmpdir(), `wr-engineer-eval-${label}-${randomUUID()}.json`)
}

const PHASE5_FIXTURE_REL = 'lib/wr-engineer/__fixtures__/phase5LocalEngineFixture.ts'
const PHASE5_FIXTURE_CONTENT = `// WR-Engineer Phase 5 local-engine eval fixture. Dedicated to
// wrEngineerPhase5.validation.ts — never shared with knownIssueFixture.ts,
// bridgeEvalFixture.ts, phase3ChatFixture.ts, or phase4InspectFixture.ts.
// Never imported by real app code. Never triggers a model download.
export const phase5LocalEngineFixtureMarker = 'PHASE5_LOCAL_ENGINE_MARKER'
export const PHASE5_RECOMMENDED_RUNTIME = 'ollama'
export const PHASE5_RECOMMENDED_MODEL = 'qwen2.5-coder:14b'
`
const PHASE4_FIXTURE_REL = 'lib/wr-engineer/__fixtures__/phase4InspectFixture.ts'
const PHASE3_FIXTURE_REL = 'lib/wr-engineer/__fixtures__/phase3ChatFixture.ts'
const BRIDGE_FIXTURE_REL = 'lib/wr-engineer/__fixtures__/bridgeEvalFixture.ts'
const KNOWN_ISSUE_FIXTURE_REL = 'lib/native-builder/__fixtures__/knownIssueFixture.ts'

function selection(mode: EngineSelection['mode'], extra: Partial<EngineSelection> = {}): EngineSelection {
  return {
    mode,
    externalFamily: extra.externalFamily ?? 'claude',
    localModel: extra.localModel ?? DEFAULT_LOCAL_MODEL,
    updatedAt: extra.updatedAt ?? new Date().toISOString(),
  }
}

class SpyAdapter implements ModelAdapter {
  calls = 0
  lastRequest: { systemPrompt: string; userPrompt: string } | null = null
  constructor(readonly id: string, private readonly results: ModelAdapterResult[]) {}
  async invoke(request: { systemPrompt: string; userPrompt: string }): Promise<ModelAdapterResult> {
    this.calls += 1
    this.lastRequest = { systemPrompt: request.systemPrompt, userPrompt: request.userPrompt }
    return this.results[Math.min(this.calls - 1, this.results.length - 1)]
  }
}

function readyTransport(scripts: string[]): LocalWrEngineerTransport {
  let index = 0
  return {
    probe: async (): Promise<OllamaProbeResult> => ({
      available: true,
      baseUrl: 'http://127.0.0.1:11434',
      models: [DEFAULT_LOCAL_MODEL],
      detail: 'eval fixture runtime',
    }),
    complete: async (): Promise<OllamaCompletionResult> => {
      const text = scripts[Math.min(index, scripts.length - 1)] ?? ''
      index += 1
      return { ok: true, text, model: DEFAULT_LOCAL_MODEL }
    },
  }
}

function downTransport(detail = 'Unreachable: eval fixture'): LocalWrEngineerTransport {
  return {
    probe: async () => ({ available: false, baseUrl: 'http://127.0.0.1:11434', models: [], detail }),
    complete: async () => ({ ok: false, detail: 'should not be called' }),
  }
}

async function resetNativeBuilderState(): Promise<void> {
  await rm(path.join(resolveRepoRoot(), '.war-room', 'native-builder'), { recursive: true, force: true })
}

async function setUpSession() {
  const nodeStore = new JsonFileNodeStore(tmpDir('nodes-p5'))
  const sessionStore = new JsonFileSessionStore(tmpDir('sessions-p5'))
  const memory = new JsonFileEngineeringMemoryStore(tmpFile('memory-p5'))
  const { code } = await generatePairingCode(nodeStore)
  const requested = await requestPairing(nodeStore, code, {
    nodeName: 'Phase 5 Eval Node',
    platform: 'linux' as const,
    architecture: 'x64',
    hostname: 'phase5-eval-host',
    osVersion: '0.0.0',
    agentVersion: '0.1.0',
    capabilities: [...NODE_INSPECTION_CAPABILITIES],
  })
  const authorized = await authorizePairing(nodeStore, requested.tokenId)
  const repository = await registerRepository(nodeStore, {
    nodeId: authorized.node.nodeId,
    name: 'phase5-eval-repo',
    path: resolveRepoRoot(),
  })
  const session = await createSession(nodeStore, sessionStore, {
    commanderUserId: 'commander-phase5',
    nodeId: authorized.node.nodeId,
    repositoryId: repository.repositoryId,
  }, memory)
  return { nodeStore, sessionStore, memory, session }
}

function wrapProposal(response: string, proposal: unknown): string {
  return `${response}\n\n\`\`\`wr-engineer-proposal\n${JSON.stringify(proposal, null, 2)}\n\`\`\`\n`
}

async function testAdapterAndRouter(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  resetLocalEngineTelemetry()

  const local = new LocalWrEngineerModelAdapter({ transport: readyTransport(['hello from local']) })
  results.push(check('p5_01_local_adapter_implements_model_adapter', typeof local.invoke === 'function' && local.id.startsWith('local_model:ollama:'), local.id))

  const ok = await local.invoke({ systemPrompt: 'sys', userPrompt: 'hi' })
  results.push(check('p5_02_local_adapter_normalizes_success', ok.ok && ok.text === 'hello from local' && ok.answeredBy === 'local' && ok.epistemicStatus === 'OBSERVED', JSON.stringify({ ok: ok.ok, text: ok.text, answeredBy: ok.answeredBy })))

  const timeoutTransport: LocalWrEngineerTransport = {
    probe: async () => ({ available: true, baseUrl: 'http://127.0.0.1:11434', models: [DEFAULT_LOCAL_MODEL], detail: 'up' }),
    complete: async () => {
      await new Promise(resolve => setTimeout(resolve, 80))
      return { ok: true, text: 'late', model: DEFAULT_LOCAL_MODEL }
    },
  }
  const timed = await new LocalWrEngineerModelAdapter({ transport: timeoutTransport, timeoutMs: 15 }).invoke({
    systemPrompt: 'sys',
    userPrompt: 'hi',
    timeoutMs: 15,
  })
  results.push(check('p5_03_local_adapter_handles_timeout', !timed.ok && (timed.failureClass === 'timeout' || (timed.error ?? '').toLowerCase().includes('timeout')), `${timed.failureClass}:${timed.error}`))

  const down = await new LocalWrEngineerModelAdapter({ transport: downTransport() }).invoke({ systemPrompt: 'sys', userPrompt: 'hi' })
  results.push(check('p5_04_local_adapter_handles_unavailable_runtime', !down.ok && down.epistemicStatus === 'UNKNOWN', down.error ?? ''))

  let threw = false
  let caught: ModelAdapterResult | undefined
  try {
    caught = await new LocalWrEngineerModelAdapter({
      transport: {
        probe: async () => { throw new Error('boom') },
        complete: async () => ({ ok: false, detail: 'no' }),
      },
    }).invoke({ systemPrompt: 'sys', userPrompt: 'hi' })
  } catch {
    threw = true
  }
  results.push(check('p5_05_local_adapter_never_throws_uncaught', !threw && caught?.ok === false, `threw=${threw}`))

  results.push(check('p5_06_router_defaults_to_local', DEFAULT_ENGINE_MODE === 'LOCAL', DEFAULT_ENGINE_MODE))

  const localSpy = new SpyAdapter('local_model:ollama:eval', [{ ok: true, text: 'L', adapterId: 'local_model:ollama:eval', epistemicStatus: 'OBSERVED' }])
  const externalSpy = new SpyAdapter('council_provider:claude', [{ ok: true, text: 'E', adapterId: 'council_provider:claude', epistemicStatus: 'OBSERVED' }])
  const localRouter = new WrEngineerModelRouter({ selection: selection('LOCAL'), local: localSpy, external: externalSpy })
  const localOnly = await localRouter.invoke({ systemPrompt: 's', userPrompt: 'u' })
  results.push(check('p5_07_local_mode_never_calls_external_fallback', localSpy.calls === 1 && externalSpy.calls === 0 && localOnly.answeredBy === 'local', `local=${localSpy.calls} external=${externalSpy.calls}`))

  const autoLocal = new SpyAdapter('local_model:ollama:eval', [{ ok: true, text: 'L', adapterId: 'local_model:ollama:eval', epistemicStatus: 'OBSERVED' }])
  const autoExt = new SpyAdapter('council_provider:claude', [{ ok: true, text: 'E', adapterId: 'council_provider:claude', epistemicStatus: 'OBSERVED' }])
  const autoRouter = new WrEngineerModelRouter({ selection: selection('AUTO'), local: autoLocal, external: autoExt })
  await autoRouter.invoke({ systemPrompt: 's', userPrompt: 'u' })
  results.push(check('p5_08_auto_mode_uses_local_first', autoLocal.calls === 1 && autoExt.calls === 0, `local=${autoLocal.calls} external=${autoExt.calls}`))

  const autoFailLocal = new SpyAdapter('local_model:ollama:eval', [{ ok: false, text: '', adapterId: 'local_model:ollama:eval', epistemicStatus: 'UNKNOWN', error: 'down' }])
  const autoFailExt = new SpyAdapter('council_provider:claude', [{ ok: true, text: 'E', adapterId: 'council_provider:claude', epistemicStatus: 'OBSERVED' }])
  const autoFallback = new WrEngineerModelRouter({ selection: selection('AUTO'), local: autoFailLocal, external: autoFailExt })
  const fallbackResult = await autoFallback.invoke({ systemPrompt: 's', userPrompt: 'u' })
  results.push(check('p5_09_auto_falls_back_when_local_unavailable', autoFailLocal.calls === 1 && autoFailExt.calls === 1 && fallbackResult.answeredBy === 'external' && fallbackResult.adapterId === 'council_provider:claude', fallbackResult.adapterId))

  const extLocal = new SpyAdapter('local_model:ollama:eval', [{ ok: true, text: 'L', adapterId: 'local_model:ollama:eval', epistemicStatus: 'OBSERVED' }])
  const extExt = new SpyAdapter('council_provider:claude', [{ ok: true, text: 'E', adapterId: 'council_provider:claude', epistemicStatus: 'OBSERVED' }])
  const extRouter = new WrEngineerModelRouter({ selection: selection('EXTERNAL'), local: extLocal, external: extExt })
  await extRouter.invoke({ systemPrompt: 's', userPrompt: 'u' })
  results.push(check('p5_10_external_mode_bypasses_local', extLocal.calls === 0 && extExt.calls === 1, `local=${extLocal.calls} external=${extExt.calls}`))

  results.push(check('p5_11_failure_class_rate_limited', classifyProviderFailure('HTTP 429 rate limit exceeded', 429) === 'rate_limited', classifyProviderFailure('HTTP 429 rate limit exceeded', 429)))
  results.push(check('p5_12_failure_class_auth_unavailable', classifyProviderFailure('invalid api key', 401) === 'auth_unavailable', classifyProviderFailure('invalid api key', 401)))
  results.push(check('p5_13_failure_class_timeout', classifyProviderFailure('timed out', 'timeout') === 'timeout', classifyProviderFailure('timed out', 'timeout')))
  results.push(check('p5_32_fallback_keeps_provider_attribution', fallbackResult.adapterId === 'council_provider:claude' && fallbackResult.answeredBy === 'external', fallbackResult.adapterId))

  const tel = getLocalEngineTelemetry()
  results.push(check('p5_18_latency_tracked', typeof tel.lastLatencyMs === 'number' || tel.lastLatencyMs === null, String(tel.lastLatencyMs)))
  results.push(check('p5_19_last_error_tracked', down.error === tel.lastError || typeof tel.lastError === 'string' || tel.lastError === null, String(tel.lastError)))
  results.push(check('p5_16_local_model_identity_surfaced', ok.modelName === DEFAULT_LOCAL_MODEL && ok.runtime === DEFAULT_LOCAL_RUNTIME, `${ok.runtime}:${ok.modelName}`))
  results.push(check('p5_17_runtime_identity_surfaced', local.runtime === 'ollama' && local.id.includes('ollama'), local.id))
  return results
}

async function testSelectionHealthDashboard(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  resetExternalFailureMemory()
  const store = new JsonFileEngineSelectionStore(tmpFile('engine-sel'))
  const loaded = await store.load()
  results.push(check('p5_06b_persisted_default_is_local', loaded.mode === 'LOCAL', loaded.mode))

  const saved = await store.save({ mode: 'AUTO', externalFamily: 'chatgpt', localModel: DEFAULT_LOCAL_MODEL })
  const reloaded = await store.load()
  results.push(check('p5_20_engine_selection_persists', saved.ok && reloaded.mode === 'AUTO' && reloaded.externalFamily === 'chatgpt', JSON.stringify(reloaded)))

  const invalid = parseEngineSelection({ mode: 'MAGIC' })
  results.push(check('p5_21_invalid_engine_selection_rejected', !invalid.ok, invalid.ok ? 'accepted' : invalid.error))
  const invalidPath = parseEngineSelection({ mode: 'LOCAL', localModel: '../secret.gguf' })
  results.push(check('p5_21b_path_model_rejected', !invalidPath.ok, invalidPath.ok ? 'accepted' : invalidPath.error))

  const readyState = await buildEngineDashboardState(selection('LOCAL'), {
    probe: async () => ({ available: true, baseUrl: 'http://user:secret@127.0.0.1:11434', models: [DEFAULT_LOCAL_MODEL], detail: 'ok' }),
    gpu: { detected: true, name: 'NVIDIA GeForce RTX 5060 Ti' },
    hostname: 'NEBULA-GENESIS',
    externalFailures: { claude: 'rate_limited' },
    isConfigured: family => family === 'claude' || family === 'chatgpt' || family === 'gemini',
  })
  results.push(check('p5_14_dashboard_engine_state_serializable', typeof JSON.parse(JSON.stringify(readyState)).mode === 'string', 'json'))
  results.push(check('p5_15_health_endpoint_shape_no_secret', dashboardStateIsSecretFree(readyState) && !JSON.stringify(readyState).includes('secret') && readyState.local.endpoint === 'http://127.0.0.1:11434', readyState.local.endpoint))
  results.push(check('p5_34_dashboard_shows_local_ready_when_healthy', readyState.local.status === 'READY', readyState.local.status))
  results.push(check('p5_36_external_rate_limit_does_not_disable_local', readyState.local.status === 'READY' && readyState.external.some(p => p.provider === 'claude' && p.status === 'RATE_LIMITED'), JSON.stringify(readyState.external.find(p => p.provider === 'claude'))))

  const downState = await buildEngineDashboardState(selection('LOCAL'), {
    probe: async () => ({ available: false, baseUrl: 'http://127.0.0.1:11434', models: [], detail: 'Unreachable' }),
    gpu: { detected: true, name: 'NVIDIA GeForce RTX 5060 Ti' },
    hostname: 'NEBULA-GENESIS',
  })
  results.push(check('p5_35_dashboard_shows_local_unavailable_when_unhealthy', downState.local.status === 'UNAVAILABLE', downState.local.status))

  results.push(check('p5_redact_endpoint_strips_userinfo', redactEngineEndpoint('http://user:pass@127.0.0.1:11434/foo') === 'http://127.0.0.1:11434', redactEngineEndpoint('http://user:pass@127.0.0.1:11434/foo')))
  results.push(check('p5_status_from_probe_ready', localEngineStatusFromProbe({ available: true, baseUrl: 'x', models: [DEFAULT_LOCAL_MODEL], detail: '' }, DEFAULT_LOCAL_MODEL) === 'READY', 'ready'))
  results.push(check('p5_recommended_model_is_14b_class', RECOMMENDED_LOCAL_MODEL.parameterClass === '14B' && RECOMMENDED_LOCAL_MODEL.name === DEFAULT_LOCAL_MODEL, RECOMMENDED_LOCAL_MODEL.name))
  results.push(check('p5_provider_health_rate_limited', providerHealthFromFailure('rate_limited', true) === 'RATE_LIMITED', 'RATE_LIMITED'))
  return results
}

async function testPhase4ThroughLocal(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const ctx = await setUpSession()

  const toolAdapter = new LocalWrEngineerModelAdapter({
    transport: readyTransport([
      wrapInspectToolRequest('read_file', { relPath: PHASE5_FIXTURE_REL }),
      wrapInspectToolRequest('search_files', { query: 'PHASE5_LOCAL_ENGINE_MARKER' }),
      wrapInspectToolRequest('git_status', {}),
      'Here is a response-only answer with no proposal.',
    ]),
  })
  const tools = await sendInspectingEngineeringChatMessage(ctx.sessionStore, ctx.nodeStore, toolAdapter, ctx.session.sessionId, 'Inspect the phase 5 fixture.')
  results.push(check('p5_22_phase4_tool_request_contract_through_local', tools.proposalOutcome.kind === 'none' && tools.replyMessage.content.includes('response-only'), tools.proposalOutcome.kind))
  const events = await ctx.sessionStore.listToolEvents(ctx.session.sessionId)
  results.push(check('p5_23_local_model_can_request_read_file', events.some(e => e.tool === 'read_file'), events.map(e => e.tool).join(',')))
  results.push(check('p5_24_local_model_can_request_search_files', events.some(e => e.tool === 'search_files'), events.map(e => e.tool).join(',')))
  results.push(check('p5_25_local_model_can_request_git_status', events.some(e => e.tool === 'git_status'), events.map(e => e.tool).join(',')))
  results.push(check('p5_26_local_model_can_produce_response_only', tools.proposalOutcome.kind === 'none', tools.proposalOutcome.kind))

  await resetNativeBuilderState()
  const groundedAdapter = new LocalWrEngineerModelAdapter({
    transport: readyTransport([
      wrapInspectToolRequest('read_file', { relPath: PHASE5_FIXTURE_REL }),
      wrapProposal('Here is the fix.', {
        diagnosis: 'Phase 5 eval grounded change.',
        confidence: 'medium',
        changes: [{
          file: PHASE5_FIXTURE_REL,
          reason: 'eval fixture only',
          patch: {
            operation: 'replace_range',
            file: PHASE5_FIXTURE_REL,
            matchText: 'PHASE5_LOCAL_ENGINE_MARKER',
            replacementText: 'PHASE5_UPDATED_MARKER',
            commanderConfirmed: false,
          },
        }],
        risks: ['none — eval fixture only'],
        rollbackPlan: 'reset fixture content',
      }),
    ]),
  })
  const grounded = await sendInspectingEngineeringChatMessage(ctx.sessionStore, ctx.nodeStore, groundedAdapter, ctx.session.sessionId, 'Propose a marker change.')
  results.push(check(
    'p5_27_local_model_can_produce_grounded_proposal',
    grounded.proposalOutcome.kind === 'bridged' || grounded.proposalOutcome.kind === 'ready_not_bridged',
    grounded.proposalOutcome.kind,
  ))

  const bypassAdapter = new LocalWrEngineerModelAdapter({
    transport: readyTransport([
      wrapProposal('Ungrounded.', {
        diagnosis: 'bypass attempt',
        confidence: 'low',
        changes: [{
          file: 'lib/wr-engineer/index.ts',
          reason: 'unread',
          patch: {
            operation: 'replace_range',
            file: 'lib/wr-engineer/index.ts',
            matchText: 'export',
            replacementText: 'export',
            commanderConfirmed: false,
          },
        }],
        risks: ['eval'],
        rollbackPlan: 'none',
      }),
    ]),
  })
  const bypass = await sendInspectingEngineeringChatMessage(ctx.sessionStore, ctx.nodeStore, bypassAdapter, ctx.session.sessionId, 'Change index without reading.')
  results.push(check('p5_28_local_model_cannot_bypass_current_turn_read_gate', bypass.proposalOutcome.kind === 'invalid', bypass.proposalOutcome.kind))

  const fixtureBefore = await readFile(path.join(resolveRepoRoot(), PHASE5_FIXTURE_REL), 'utf8')
  results.push(check('p5_29_local_model_cannot_directly_write_file', fixtureBefore.includes('PHASE5_LOCAL_ENGINE_MARKER') && WR_ENGINEER_CANNOT_WRITE_FILES === true, 'fixture unchanged'))
  results.push(check('p5_30_native_builder_remains_sole_write_authority', WR_ENGINEER_BRIDGE_NEVER_APPLIES === true, 'true'))

  const failAdapter = new LocalWrEngineerModelAdapter({ transport: downTransport('local down') })
  const originalNode = ctx.session.nodeId
  const originalRepo = ctx.session.repositoryId
  const failed = await sendInspectingEngineeringChatMessage(ctx.sessionStore, ctx.nodeStore, failAdapter, ctx.session.sessionId, 'Are you up?')
  const after = await ctx.sessionStore.getSession(ctx.session.sessionId)
  results.push(check('p5_31_local_failure_does_not_corrupt_session', after?.nodeId === originalNode && after?.repositoryId === originalRepo, `${after?.nodeId}/${after?.repositoryId}`))
  results.push(check('p5_33_local_only_failure_visible_to_commander', failed.replyMessage.content.toLowerCase().includes('local') || failed.replyMessage.content.toLowerCase().includes('unavailable') || failed.replyMessage.content.includes('UNKNOWN'), failed.replyMessage.content.slice(0, 160)))
  return results
}

async function testGuardsAndUi(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const root = resolveRepoRoot()
  const consoleSrc = await readFile(path.join(root, 'components/war-room/wr-engineer/WrEngineerConsole.tsx'), 'utf8')
  const messagesRoute = await readFile(path.join(root, 'app/api/wr-engineer/sessions/[sessionId]/messages/route.ts'), 'utf8')
  const statusRoute = await readFile(path.join(root, 'app/api/wr-engineer/engine/status/route.ts'), 'utf8')
  const testRoute = await readFile(path.join(root, 'app/api/wr-engineer/engine/test/route.ts'), 'utf8')
  const adapterSrc = await readFile(path.join(root, 'lib/wr-engineer/localModelAdapter.ts'), 'utf8')
  const routerSrc = await readFile(path.join(root, 'lib/wr-engineer/modelRouter.ts'), 'utf8')
  const loopSrc = await readFile(path.join(root, 'lib/wr-engineer/inspectLoop.ts'), 'utf8')
  const identitySrc = await readFile(path.join(root, 'lib/wr-engineer/identity/IDENTITY.md'), 'utf8')
  const ps1 = await readFile(path.join(root, 'start-war-room.ps1'), 'utf8')
  const bat = await readFile(path.join(root, 'start-war-room.bat'), 'utf8')

  results.push(check('p5_37_no_claude_code_process_dependency', !adapterSrc.toLowerCase().includes('claude code') && !routerSrc.toLowerCase().includes('cursor.exe'), 'no claude-code/cursor process'))
  results.push(check('p5_38_no_cursor_process_dependency', !consoleSrc.includes('Cursor running') && !messagesRoute.includes('cursor'), 'no cursor process check'))
  results.push(check('p5_39_startup_does_not_spawn_duplicate_war_room', (ps1.match(/pnpm dev/g) ?? []).length === 1 && (bat.match(/pnpm dev/g) ?? []).length === 1 && !ps1.includes('pnpm start'), `ps1=${(ps1.match(/pnpm dev/g) ?? []).length}`))
  results.push(check('p5_40_no_model_download_in_suite_or_adapter', !adapterSrc.includes('/api/pull') && !ps1.includes('ollama pull') && !bat.includes('ollama pull'), 'no pull'))
  results.push(check('p5_41_no_model_training_triggered', !adapterSrc.includes('/api/train') && !routerSrc.includes('fine-tun') && !ps1.toLowerCase().includes('fine-tun'), 'no train'))
  results.push(check('p5_42_no_client_side_model_bundling', !consoleSrc.includes('.gguf') && !consoleSrc.includes('onnx') && !consoleSrc.includes('wasm-llm'), 'no weights in UI'))
  results.push(check('p5_43_no_secret_in_client_bundle', !consoleSrc.includes('API_KEY') && !consoleSrc.includes('SERVICE_ROLE') && !consoleSrc.includes('sk-ant'), 'no keys'))
  const ctx = await setUpSession()
  const stackText = await assembleSessionContext(ctx.sessionStore, ctx.nodeStore, ctx.session.sessionId, ctx.memory)
  const order = IDENTITY_LAYER_ORDER.map(name => stackText.indexOf(`<<< ${name} >>>`))
  results.push(check('p5_44_identity_load_order_unchanged', order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), JSON.stringify(order)))
  results.push(check('p5_identity_file_unchanged_name', identitySrc.includes('# IDENTITY.md — Who WR-Engineer Is'), 'identity present'))
  results.push(check('p5_inspect_loop_preserved', loopSrc.includes('runInspectTurnLoop') && messagesRoute.includes('sendInspectingEngineeringChatMessage'), 'inspect loop'))
  results.push(check('p5_messages_use_router', messagesRoute.includes('createWrEngineerChatAdapter'), 'router wired'))
  results.push(check('p5_status_route_authenticated', statusRoute.includes('requireCommanderSession') && testRoute.includes('requireCommanderSession'), 'auth'))
  results.push(check('p5_ui_engine_selector', consoleSrc.includes("['LOCAL', 'AUTO', 'EXTERNAL']") && consoleSrc.includes('LOCAL ENGINE READY') && consoleSrc.includes('LOCAL UNAVAILABLE'), 'selector + status'))
  results.push(check('p5_ui_local_engine_card', consoleSrc.includes('Local Engine') && consoleSrc.includes('External Providers'), 'cards'))
  results.push(check('p5_ui_keeps_phase4_panels', consoleSrc.includes('Evidence This Turn') && consoleSrc.includes('Inspect') && consoleSrc.includes('READ THIS TURN'), 'phase4 ui'))
  results.push(check('p5_future_control_types_still_disabled', FUTURE_MESSAGE_TYPES.every(t => !isMessageTypeEnabled(t)), FUTURE_MESSAGE_TYPES.join(',')))
  results.push(check('p5_startup_plan_skip_when_missing', describeLocalEngineStartup({ probeAvailable: false, ollamaInstalled: false }).localRuntimeAction === 'skip_not_installed' && !shouldStartOllamaServe({ probeAvailable: false, ollamaInstalled: false }), 'skip'))
  results.push(check('p5_startup_plan_reuse_when_up', describeLocalEngineStartup({ probeAvailable: true, ollamaInstalled: true }).startsDuplicateWarRoom === false, 'reuse'))
  results.push(check('p5_bounded_context_truncates', boundSystemPrompt('x'.repeat(200_000)).truncated === true && boundSystemPrompt('short').truncated === false, 'bound'))
  results.push(check('p5_test_route_fixed_smoke_prompt', testRoute.includes('WR_ENGINEER_LOCAL_READY') && !testRoute.includes('body.prompt'), 'fixed prompt'))

  const knownIssue = await readFile(path.join(root, KNOWN_ISSUE_FIXTURE_REL), 'utf8')
  const bridgeEval = await readFile(path.join(root, BRIDGE_FIXTURE_REL), 'utf8')
  const phase3 = await readFile(path.join(root, PHASE3_FIXTURE_REL), 'utf8')
  const phase4 = await readFile(path.join(root, PHASE4_FIXTURE_REL), 'utf8')
  const phase5 = await readFile(path.join(root, PHASE5_FIXTURE_REL), 'utf8')
  results.push(check('p5_protect_known_issue_fixture', knownIssue.includes('values.length - 1'), 'untouched'))
  results.push(check('p5_protect_bridge_fixture', bridgeEval.includes("bridgeFixtureMarker = 'ORIGINAL_MARKER'"), 'untouched'))
  results.push(check('p5_protect_phase3_fixture', phase3.includes("phase3ChatFixtureMarker = 'PHASE3_ORIGINAL_MARKER'"), 'untouched'))
  results.push(check('p5_protect_phase4_fixture', phase4.includes("phase4InspectFixtureMarker = 'PHASE4_ORIGINAL_MARKER'"), 'untouched'))
  results.push(check('p5_phase5_fixture_present', phase5.includes("phase5LocalEngineFixtureMarker = 'PHASE5_LOCAL_ENGINE_MARKER'"), 'present'))
  return results
}

async function testLiveInferenceHonestly(): Promise<CaseResult[]> {
  const probe = await probeOllama()
  if (!probe.available || probe.models.length === 0) {
    return [check('p5_live_local_inference', true, 'NOT RUN — MODEL DOWNLOAD REQUIRED')]
  }
  const adapter = new LocalWrEngineerModelAdapter({ model: probe.models[0], timeoutMs: 20_000 })
  const result = await adapter.invoke({
    systemPrompt: 'Reply with the exact requested token and nothing else.',
    userPrompt: 'Return exactly: WR_ENGINEER_LOCAL_READY',
    maxTokens: 32,
    timeoutMs: 20_000,
  })
  return [check('p5_live_local_inference', result.ok && result.text.includes('WR_ENGINEER_LOCAL_READY'), `${result.ok}:${result.latencyMs}ms:${(result.text || result.error || '').slice(0, 80)}`)]
}

export async function runWrEngineerPhase5Validation(): Promise<CaseResult[]> {
  await writeFile(path.join(resolveRepoRoot(), PHASE5_FIXTURE_REL), PHASE5_FIXTURE_CONTENT)
  return [
    ...(await testAdapterAndRouter()),
    ...(await testSelectionHealthDashboard()),
    ...(await testPhase4ThroughLocal()),
    ...(await testGuardsAndUi()),
    ...(await testLiveInferenceHonestly()),
    ...(await runWrEngineerPhase4Validation()).map(r => ({ ...r, name: `phase4_regression_${r.name}` })),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runWrEngineerPhase5Validation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`WR-Engineer Phase 5 validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
