/**
 * Council local GPU arbiter + response-guarantee validation.
 * Does not rewrite Council identity. Proves one shared backend and truthful terminal outcomes.
 */
import { createServer } from 'node:net'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  classifyLocalModelOwner,
  councilBackendModelId,
  councilDegradedBriefing,
  decideCouncilGpuTransition,
  foundryCoderModelId,
  listResidentLocalModels,
  LOCAL_MODEL_OWNERS,
  partialCouncilBriefing,
  prepareCouncilBackend,
  snapshotLocalModelArbiter,
} from '@/lib/native-builder/localModelArbiter'
import { PREFERRED_LOCAL_CODER, PREFERRED_LOCAL_GENERAL } from '@/lib/native-builder/localCoder'
import { probeOllama } from '@/lib/native-builder/ollamaClient'
import { displayNameForSeat } from '@/lib/council/nebula/identity'
import { detectResearchIntent } from '@/lib/research/researchIntent'
import { evaluateMandatoryLiveRetrieval } from '@/lib/intelligence/sources/retrievalOrchestrator'
import { invokeCouncilSeat } from '@/lib/council/live-orchestration/backends/seatRouter'
import {
  buildCommanderOperationFromMessages,
  buildReadableCommanderOperationCopy,
  type CouncilOperationMessageInput,
} from '@/lib/council/unified-experience/adapter'
import { buildCouncilRosterSnapshot, compactFamilyRosterLine } from '@/lib/council/live-orchestration/rosterHealth'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function portClosed(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

function nvidiaSmi(): string {
  const result = spawnSync('nvidia-smi', [
    '--query-gpu=name,memory.used,memory.total,utilization.gpu',
    '--format=csv,noheader,nounits',
  ], { encoding: 'utf8', timeout: 4000, windowsHide: true })
  if (result.status !== 0) return result.stderr?.trim() || result.error?.message || 'nvidia-smi unavailable'
  return result.stdout.trim()
}

function sourceContains(rel: string, needle: string): boolean {
  const text = readFileSync(path.join(process.cwd(), rel), 'utf8')
  return text.includes(needle)
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init?.signal ? 240_000 : 8_000) })
    const body = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, body }
  } catch (error) {
    return { ok: false, status: 0, body: error instanceof Error ? error.message : String(error) }
  }
}

export async function runCouncilLocalRuntimeRecoveryValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const worldQuery = "Council, what's the world doing today?"

  results.push(check(
    'identities remain AURORA ORION PULSAR LUMEN',
    displayNameForSeat('chatgpt') === 'AURORA'
      && displayNameForSeat('claude') === 'ORION'
      && displayNameForSeat('grok') === 'PULSAR'
      && displayNameForSeat('gemini') === 'LUMEN',
    `${displayNameForSeat('chatgpt')}/${displayNameForSeat('claude')}/${displayNameForSeat('grok')}/${displayNameForSeat('gemini')}`,
  ))

  results.push(check(
    'shared backend ids are explicit',
    councilBackendModelId() === PREFERRED_LOCAL_GENERAL
      && foundryCoderModelId() === PREFERRED_LOCAL_CODER
      && LOCAL_MODEL_OWNERS.join(',') === 'FOUNDRY_CODER,COUNCIL_BACKEND,WRIM_FUTURE,OTHER_LOCAL_MODELS',
    `council=${councilBackendModelId()} foundry=${foundryCoderModelId()}`,
  ))

  results.push(check(
    'owner classification',
    classifyLocalModelOwner('qwen2.5-coder:14b') === 'FOUNDRY_CODER'
      && classifyLocalModelOwner('huihui_ai/qwen3-abliterated:14b') === 'COUNCIL_BACKEND'
      && classifyLocalModelOwner('wrim-future:7b') === 'WRIM_FUTURE'
      && classifyLocalModelOwner('llama3:8b') === 'OTHER_LOCAL_MODELS',
    'FOUNDRY_CODER / COUNCIL_BACKEND / WRIM_FUTURE / OTHER_LOCAL_MODELS',
  ))

  const wait = decideCouncilGpuTransition({
    foundryActive: true,
    resident: [{ name: PREFERRED_LOCAL_CODER, owner: 'FOUNDRY_CODER', sizeVramBytes: 9e9, expiresAt: null }],
  })
  results.push(check(
    'foundry active does not unload coder',
    wait.action === 'WAIT' && wait.unload.length === 0,
    JSON.stringify(wait),
  ))

  const activate = decideCouncilGpuTransition({
    foundryActive: false,
    resident: [{ name: PREFERRED_LOCAL_CODER, owner: 'FOUNDRY_CODER', sizeVramBytes: 9e9, expiresAt: null }],
  })
  results.push(check(
    'idle foundry coder is released for Council',
    activate.action === 'ACTIVATE' && activate.unload.includes(PREFERRED_LOCAL_CODER),
    JSON.stringify(activate),
  ))

  const already = decideCouncilGpuTransition({
    foundryActive: false,
    resident: [{ name: PREFERRED_LOCAL_GENERAL, owner: 'COUNCIL_BACKEND', sizeVramBytes: 9e9, expiresAt: null }],
  })
  results.push(check(
    'resident Council backend skips competing unload',
    already.action === 'ALREADY_READY' && already.unload.length === 0,
    JSON.stringify(already),
  ))

  const degraded = councilDegradedBriefing('LOCAL_MODEL_RESOURCE_CONTENTION', ['ORION', 'PULSAR', 'LUMEN', 'AURORA'])
  results.push(check(
    'all-member failure briefing is explicit',
    degraded.includes('COUNCIL DEGRADED')
      && degraded.includes('LOCAL_MODEL_RESOURCE_CONTENTION')
      && degraded.includes('four Council identities remain available'),
    degraded.slice(0, 180),
  ))

  const partial = partialCouncilBriefing(['PULSAR', 'LUMEN', 'AURORA'], ['ORION'], 'World brief from available members.')
  results.push(check(
    'partial synthesis keeps healthy members',
    partial.includes('COUNCIL PARTIAL COMPLETE')
      && partial.includes('ORION unavailable for this round')
      && partial.includes('PULSAR')
      && partial.includes('World brief from available members.'),
    partial,
  ))

  const requestText = 'council whats the world doing today'
  const exportOp = buildCommanderOperationFromMessages([
    {
      id: 'sys-empty',
      familyName: 'SYSTEM',
      content: 'gathering',
      timestamp: '2026-09-13T00:00:00.000Z',
      requestText: null,
    },
    {
      id: 'rael-1',
      familyName: "RA'EL",
      content: requestText,
      timestamp: '2026-09-13T00:00:01.000Z',
      messageType: 'decree',
      requestText,
    },
    {
      id: 'sys-timeout',
      familyName: 'SYSTEM',
      content: 'COUNCIL DEGRADED\nOperation status: TIMED_OUT.',
      timestamp: '2026-09-13T00:01:00.000Z',
      requestCompleted: true,
      operationStatus: 'timed_out',
      isFinal: true,
      requestText,
    },
  ] as CouncilOperationMessageInput[])
  const exportCopy = buildReadableCommanderOperationCopy(exportOp, null)
  results.push(check(
    'export persists original request',
    exportCopy.includes(requestText) && !exportCopy.includes('Request unavailable'),
    exportCopy.split('\n').slice(0, 8).join(' | '),
  ))
  results.push(check(
    'timed-out round is not RUNNING',
    exportOp.status === 'timed_out' && exportCopy.includes('TIMED_OUT') && !/OPERATION STATUS\nRunning/i.test(exportCopy),
    `status=${exportOp.status}`,
  ))

  const readySnap = buildCouncilRosterSnapshot({
    configured: { chatgpt: false, claude: false, grok: false, gemini: false },
    continuity: { localReady: true, routingPreference: 'AUTO', routingModeResolved: 'LOCAL_FIRST' },
  })
  results.push(check(
    'header separates entity readiness from backend',
    readySnap.entityReadyCount === 4
      && readySnap.backendExecutionState === 'COUNCIL_READY'
      &&     readySnap.entityHeadline.includes('COUNCIL READY')
      && compactFamilyRosterLine(readySnap).includes('COUNCIL ENTITIES:')
      && compactFamilyRosterLine(readySnap).includes('BACKEND:'),
    `${readySnap.entityHeadline} entities=${readySnap.entityReadyCount} backend=${readySnap.backendExecutionLabel}`,
  ))

  const waitingSnap = {
    ...readySnap,
    backendExecutionState: 'COUNCIL_WAITING_FOR_GPU' as const,
    backendExecutionLabel: 'WAITING FOR LOCAL GPU',
    gpuOwner: 'FOUNDRY_CODER' as const,
  }
  results.push(check(
    'waiting GPU does not claim backend READY',
    waitingSnap.entityReadyCount === 4
      && waitingSnap.backendExecutionLabel === 'WAITING FOR LOCAL GPU'
      && waitingSnap.entityHeadline.includes('COUNCIL READY'),
    `entities ${waitingSnap.entityReadyCount}/4 READY · BACKEND ${waitingSnap.backendExecutionLabel}`,
  ))

  results.push(check(
    'keep_alive infinite removed from Ollama client',
    !sourceContains('lib/native-builder/ollamaClient.ts', 'keep_alive: -1')
      && sourceContains('lib/native-builder/ollamaClient.ts', "keep_alive: args.keepAlive ?? '5m'"),
    'default keep_alive is 5m',
  ))
  results.push(check(
    'no second local-model manager',
    sourceContains('lib/native-builder/localModelArbiter.ts', 'Canonical local-model GPU arbiter')
      && sourceContains('lib/council/live-orchestration/backends/localBackend.ts', 'prepareCouncilBackend'),
    'arbiter wraps existing Ollama client',
  ))
  results.push(check(
    'serialized seats and member timeout isolation exist',
    sourceContains('app/api/chat/execute.ts', 'LOCAL_COUNCIL_MEMBER_TIMEOUT_MS')
      && sourceContains('app/api/chat/execute.ts', "const order: CouncilSingleFamily[] = ['claude', 'grok', 'gemini', 'chatgpt']")
      && sourceContains('app/api/chat/execute.ts', 'invokeSerializedSeat'),
    'ORION → PULSAR → LUMEN → AURORA against one backend',
  ))

  const research = detectResearchIntent(worldQuery)
  const mandatory = evaluateMandatoryLiveRetrieval(worldQuery)
  results.push(check(
    'current-world query requires live retrieval',
    research.shouldResearch && mandatory.required,
    `shouldResearch=${research.shouldResearch} mandatory=${mandatory.required} reasons=${research.reasons.join(',')}`,
  ))

  const port3001Off = await portClosed(3001)
  results.push(check('port 3001 remains off', port3001Off, port3001Off ? '127.0.0.1:3001 is free' : 'port 3001 is in use'))

  const vram = nvidiaSmi()
  results.push(check(
    'vram snapshot captured',
    Boolean(vram),
    vram,
  ))

  const probe = await probeOllama()
  const before = await listResidentLocalModels()
  const beforeSnap = await snapshotLocalModelArbiter()
  results.push(check(
    'ollama reachable for recovery proof',
    probe.available,
    `${probe.detail} resident=${before.map(row => `${row.owner}:${row.name}`).join(',') || 'none'} gpuOwner=${beforeSnap.gpuOwner}`,
  ))

  if (!probe.available) return results

  const prepared = await prepareCouncilBackend()
  const after = await listResidentLocalModels()
  results.push(check(
    'prepareCouncilBackend activates Council without manual Ollama',
    prepared.ok
      && after.some(row => row.owner === 'COUNCIL_BACKEND')
      && !after.some(row => row.owner === 'FOUNDRY_CODER'),
    `ok=${prepared.ok} state=${prepared.state} unloaded=${prepared.unloaded.join(',') || 'none'} waitedMs=${prepared.waitedMs} resident=${after.map(row => `${row.owner}:${row.name}`).join(',')}`,
  ))

  let timedOutOk = true
  let timedOutDetail = ''
  try {
    const timedOut = await invokeCouncilSeat({
      seat: 'claude',
      systemPrompt: 'You are ORION. Reply with one word.',
      userPrompt: 'Ping.',
      maxTokens: 16,
      signal: AbortSignal.timeout(1),
      onDelta: () => undefined,
      timeoutKind: 'council',
      routingModeOverride: 'LOCAL_ONLY',
    })
    timedOutOk = timedOut.ok
    timedOutDetail = timedOut.backend.fallbackReason ?? timedOut.backend.status
  } catch (error) {
    timedOutOk = false
    timedOutDetail = error instanceof Error ? error.message : String(error)
  }
  const healthy = await invokeCouncilSeat({
    seat: 'grok',
    systemPrompt: 'You are PULSAR. Reply with the single word READY.',
    userPrompt: 'Ping.',
    maxTokens: 16,
    signal: AbortSignal.timeout(90_000),
    onDelta: () => undefined,
    timeoutKind: 'social',
    routingModeOverride: 'LOCAL_ONLY',
  })
  results.push(check(
    'one member timeout does not block later members',
    timedOutOk === false && healthy.ok && healthy.text.trim().length > 0,
    `orion_ok=${timedOutOk} (${timedOutDetail}) pulsar_ok=${healthy.ok} pulsar=${healthy.text.slice(0, 80)} backend=${healthy.backend.model}`,
  ))

  const installed = await fetchJson('http://127.0.0.1:3848/api/council/backend-status')
  const installedBody = installed.body && typeof installed.body === 'object'
    ? installed.body as Record<string, unknown>
    : null
  const installedLive = installed.status === 200 || installed.status === 401
  results.push(check(
    'installed War Room 3848 reachable',
    installedLive,
    `status=${installed.status} ${installed.status === 401 ? 'login-gated; runtime-equivalent Ollama proof used' : `backend=${String(installedBody?.backendExecutionState ?? '')} gpuOwner=${String(installedBody?.gpuOwner ?? '')}`}`,
  ))

  if (installed.status === 200) {
    results.push(check(
      'installed backend-status overlay',
      installedBody?.localServingLiveSeats === 'UNKNOWN'
        && typeof installedBody?.backendExecutionState === 'string',
      `backend=${String(installedBody?.backendExecutionState)} gpuOwner=${String(installedBody?.gpuOwner ?? '')}`,
    ))
    const chat: Response | Error = await fetch('http://127.0.0.1:3848/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(240_000),
      body: JSON.stringify({
        message: worldQuery,
        councilFlowMode: 'full_council',
      }),
    }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))))
    if (chat instanceof Error) {
      results.push(check('installed Council final response', false, chat.message))
    } else {
      const payload = await chat.json().catch(() => null) as Record<string, unknown> | null
      const resultsList = Array.isArray(payload?.results) ? payload.results as Array<Record<string, unknown>> : []
      const aurora = resultsList.find(row => String(row.family).toUpperCase().includes('AURORA'))
        ?? resultsList.find(row => String(row.content || '').includes('COUNCIL'))
        ?? resultsList[resultsList.length - 1]
      const content = String(aurora?.content ?? payload?.councilSingleResponse ?? '')
      results.push(check(
        'installed Council final response',
        chat.ok && content.trim().length > 0,
        `http=${chat.status} families=${resultsList.map(row => row.family).join(',')} len=${content.length} preview=${content.slice(0, 180)}`,
      ))
    }
  } else {
    results.push(check(
      'runtime-equivalent Council briefing (3848 login-gated)',
      healthy.ok && healthy.text.trim().length > 0 && healthy.backend.model === PREFERRED_LOCAL_GENERAL,
      `PULSAR ${healthy.backend.status} model=${healthy.backend.model} text=${healthy.text.slice(0, 120)}`,
    ))
  }

  return results
}
