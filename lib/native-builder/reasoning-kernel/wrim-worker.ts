/**
 * WRIM Foundry worker adapter.
 * Pins to STEP_400 through the existing Foundry worker contract.
 * Does not train, mutate weights/tokenizer/corpus, grant tool mutations,
 * or join automatic capability-aware routing.
 */
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import type {
  FoundryMissionModel,
  FoundryModelRequest,
  FoundryModelResponse,
  FoundryWorkerDiagnostics,
} from '../foundryModelTypes'
import type { FoundryRoutingCandidate } from '../foundryWorkerRouting'
import type { FoundryReasoningSession } from './types'

export type WrimCapabilityHandshake = {
  workerIdentity: string
  checkpoint: string | null
  contextTokens: number | null
  structuredOutput: boolean
  toolSupport: boolean
  available: boolean
  taskClasses: string[]
}

export type WrimInferencePort = {
  handshake: WrimCapabilityHandshake
  propose?: (problem: string) => Promise<string>
}

export type FoundryReasoningWorkerPort = {
  kind: 'wrim' | 'external' | 'none'
  handshake: WrimCapabilityHandshake
}

export const WRIM_PROVIDER = 'wrim' as const
export const WRIM_MODEL = 'STEP_400' as const
export const WRIM_CHECKPOINT_ID = 'WRIM1-CPT-000001/step-400' as const
export const WRIM_ARCHITECTURE = 'WRIM-G-20M-v1-option-A' as const
export const WRIM_TOKENIZER_ID = 'WR-TOKENIZER-0' as const
export const WRIM_EXPECTED_CHECKPOINT_HASH = 'f82f4364b16842ca3d43427251299f1ad38d5104f24013251f2ebc6af6607af8'
export const WRIM_EXPECTED_TOKENIZER_HASH = '47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7'
export const WRIM_PYTHON = '/home/chosenone/.local/share/war-room-os/venvs/wrim-pytorch-linux/bin/python'
export const WRIM_CHECKPOINT_PATH = '/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only/WRIM1-CPT-000001/step-400/model.safetensors'
export const WRIM_TOKENIZER_PATH = '/run/media/chosenone/Seagate/WAR_ROOM_LINUX_MIGRATION/tree/Users/markb/Documents/Codex/2026-09-04/referenced-chatgpt-conversation-this-is-an-3/outputs/mac-model-recovery-20260904-220419/model-lab/manifests/wrim0_tokenizer_v16384/tokenizer.json'
export const WRIM_CORPUS_ROOT = '/home/chosenone/.local/share/war-room-os/data/wrim-environment/WR-CORPUS-CPT-1-v1.0.0'
export const WRIM_AUTOMATIC_ROUTING_ENABLED = false as const
export const SECOND_WRIM_ROUTER_COUNT = 0 as const
export const WRIM_TOOL_ACTION_COUNT = 0 as const
export const WRIM_INFERENCE_NETWORK_REQUIRED = false as const
export const WRIM_MOCK_RESPONSE_COUNT = 0 as const
export const HEALTH_TIMEOUT_MS = 45_000
export const INFERENCE_TIMEOUT_MS = 120_000
export const MAX_STDOUT_BYTES = 256_000
export const MAX_STDERR_BYTES = 64_000
export const MAX_NEW_TOKENS = 24
export const HARD_MAX_NEW_TOKENS = 64

const DISABLED_HANDSHAKE: WrimCapabilityHandshake = {
  workerIdentity: 'wrim-unconfigured',
  checkpoint: null,
  contextTokens: null,
  structuredOutput: false,
  toolSupport: false,
  available: false,
  taskClasses: [],
}

const LIVE_HANDSHAKE: WrimCapabilityHandshake = {
  workerIdentity: 'wrim/STEP_400',
  checkpoint: WRIM_CHECKPOINT_ID,
  contextTokens: 512,
  structuredOutput: false,
  toolSupport: false,
  available: true,
  taskClasses: ['pin-only'],
}

export type WrimErrorCode =
  | 'BLOCKED_PROVIDER'
  | 'RUNTIME_FAILURE'
  | 'TOKENIZER_FAILURE'
  | 'MODEL_LOAD_FAILURE'
  | 'INVALID_OUTPUT'
  | 'INSUFFICIENT_CAPABILITY'

export type WrimTransportEnvelope = {
  requestId: string
  ok: boolean
  provider: typeof WRIM_PROVIDER
  model: typeof WRIM_MODEL
  checkpointId: string
  checkpointHash: string
  tokenizerId: string
  tokenizerHash: string
  device: string
  rawText: string
  generatedTokenIds: number[]
  generatedTokenCount: number
  finishReason: string
  collapsed: boolean
  latencyMs: number
  transportSuccess: boolean
  reasoningUsable: boolean
  capabilityStatus: WrimErrorCode | 'OK'
  pythonBridge: string
  runtime: string
  networkRequired: false
  mock: false
  error?: { code: WrimErrorCode; message: string }
}

type CachedHealth = { at: number; envelope: WrimTransportEnvelope }
let cachedHealth: CachedHealth | null = null

const SECRET_ENV = /key|token|secret|password|credential|authorization/i

function inferScriptPath(): string {
  const packaged = path.join(resolveRepoRoot(), 'lib/native-builder/reasoning-kernel/wrim_foundry_infer.py')
  if (existsSync(packaged)) return packaged
  return path.join(path.dirname(new URL(import.meta.url).pathname), 'wrim_foundry_infer.py')
}

function sanitizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TMPDIR: process.env.TMPDIR,
    TMP: process.env.TMP,
    TEMP: process.env.TEMP,
    CUDA_VISIBLE_DEVICES: process.env.CUDA_VISIBLE_DEVICES,
    LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
    NVIDIA_VISIBLE_DEVICES: process.env.NVIDIA_VISIBLE_DEVICES,
    PYTHONNOUSERSITE: '1',
    PYTHONWARNINGS: 'ignore',
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || SECRET_ENV.test(key)) continue
    if (key.startsWith('CUDA') || key.startsWith('NVIDIA') || key === 'LD_LIBRARY_PATH') env[key] = value
  }
  return env
}

function parseEnvelope(stdout: string, requestId: string): WrimTransportEnvelope | { error: WrimErrorCode; message: string } {
  const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const jsonLine = [...lines].reverse().find(line => line.startsWith('{') && line.endsWith('}'))
  if (!jsonLine) return { error: 'RUNTIME_FAILURE', message: 'Python bridge returned no JSON envelope.' }
  try {
    const raw = JSON.parse(jsonLine) as Record<string, unknown>
    const err = raw.error && typeof raw.error === 'object' ? raw.error as Record<string, unknown> : null
    const code = (err && typeof err.code === 'string' ? err.code : typeof raw.capabilityStatus === 'string' ? raw.capabilityStatus : 'RUNTIME_FAILURE') as WrimErrorCode | 'OK'
    const ids = Array.isArray(raw.generatedTokenIds) ? raw.generatedTokenIds.filter((item): item is number => Number.isInteger(item)) : []
    return {
      requestId: typeof raw.requestId === 'string' ? raw.requestId : requestId,
      ok: raw.ok === true,
      provider: WRIM_PROVIDER,
      model: WRIM_MODEL,
      checkpointId: typeof raw.checkpointId === 'string' ? raw.checkpointId : WRIM_CHECKPOINT_ID,
      checkpointHash: typeof raw.checkpointHash === 'string' ? raw.checkpointHash : '',
      tokenizerId: typeof raw.tokenizerId === 'string' ? raw.tokenizerId : WRIM_TOKENIZER_ID,
      tokenizerHash: typeof raw.tokenizerHash === 'string' ? raw.tokenizerHash : '',
      device: typeof raw.device === 'string' ? raw.device : 'unknown',
      rawText: typeof raw.rawText === 'string' ? raw.rawText : '',
      generatedTokenIds: ids,
      generatedTokenCount: typeof raw.generatedTokenCount === 'number' ? raw.generatedTokenCount : ids.length,
      finishReason: typeof raw.finishReason === 'string' ? raw.finishReason : raw.ok === true ? 'unknown' : 'error',
      collapsed: raw.collapsed === true,
      latencyMs: typeof raw.latencyMs === 'number' ? raw.latencyMs : 0,
      transportSuccess: raw.ok === true && ids.length > 0,
      reasoningUsable: raw.reasoningUsable === true,
      capabilityStatus: code === 'OK' ? 'OK' : code,
      pythonBridge: 'wrim_foundry_infer.py',
      runtime: 'wrim-pytorch-linux',
      networkRequired: false,
      mock: false,
      error: err && typeof err.message === 'string' ? { code: (typeof err.code === 'string' ? err.code : 'RUNTIME_FAILURE') as WrimErrorCode, message: err.message.slice(0, 800) } : undefined,
    }
  } catch {
    return { error: 'RUNTIME_FAILURE', message: 'Python bridge JSON envelope was unparseable.' }
  }
}

function runBridge(input: {
  request: Record<string, unknown>
  timeoutMs: number
  abortSignal?: AbortSignal
}): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  const python = WRIM_PYTHON
  const script = inferScriptPath()
  const payload = JSON.stringify(input.request)
  return new Promise(resolve => {
    if (!existsSync(python)) {
      resolve({ stdout: '', stderr: 'WRIM python runtime missing', code: 127, timedOut: false })
      return
    }
    if (!existsSync(script)) {
      resolve({ stdout: '', stderr: 'WRIM python bridge missing', code: 127, timedOut: false })
      return
    }
    const child = spawn(python, [script], {
      cwd: resolveRepoRoot(),
      env: sanitizedEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (code: number | null, timedOut: boolean) => {
      if (settled) return
      settled = true
      resolve({ stdout, stderr: stderr.slice(0, 800), code, timedOut })
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      if (stdout.length < MAX_STDOUT_BYTES) stdout += chunk
      if (stdout.length >= MAX_STDOUT_BYTES) child.kill('SIGTERM')
    })
    child.stderr.on('data', chunk => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += chunk
    })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(null, true)
    }, input.timeoutMs)
    const onAbort = () => {
      child.kill('SIGTERM')
      finish(null, false)
    }
    input.abortSignal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', error => {
      clearTimeout(timer)
      stderr += error.message
      finish(null, false)
    })
    child.on('close', code => {
      clearTimeout(timer)
      input.abortSignal?.removeEventListener('abort', onAbort)
      finish(code, false)
    })
    child.stdin.write(payload)
    child.stdin.end()
  })
}

export function sha256File(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  const hash = createHash('sha256')
  hash.update(readFileSync(filePath))
  return hash.digest('hex')
}

export function wrimCorpusHashes(): Record<string, string | null> {
  const files = {
    sha_manifest: path.join(WRIM_CORPUS_ROOT, 'WR-CORPUS-CPT-1-v1.0.0-SHA256.json'),
    manifest: path.join(WRIM_CORPUS_ROOT, 'WR-CORPUS-CPT-1-v1.0.0-MANIFEST.json'),
    c1: path.join(WRIM_CORPUS_ROOT, 'WR-CORPUS-CPT-1-v1.0.0-C1-TRAIN.jsonl'),
    role_train: path.join(WRIM_CORPUS_ROOT, 'WR-CORPUS-CPT-1-v1.0.0-ROLE-TRAIN.jsonl'),
    role_val: path.join(WRIM_CORPUS_ROOT, 'WR-CORPUS-CPT-1-v1.0.0-ROLE-VAL.jsonl'),
  }
  return Object.fromEntries(Object.entries(files).map(([key, file]) => [key, sha256File(file)]))
}

export function getCachedWrimHealth(): WrimTransportEnvelope | null {
  if (!cachedHealth) return null
  if (Date.now() - cachedHealth.at > 60_000) return null
  return cachedHealth.envelope
}

export async function probeWrimAdapterHealth(): Promise<WrimTransportEnvelope> {
  const cached = getCachedWrimHealth()
  if (cached?.ok) return cached
  const requestId = `wrim-health-${randomUUID()}`
  const ran = await runBridge({
    request: {
      requestId,
      mode: 'health',
      checkpointPath: WRIM_CHECKPOINT_PATH,
      tokenizerPath: WRIM_TOKENIZER_PATH,
    },
    timeoutMs: HEALTH_TIMEOUT_MS,
  })
  if (ran.timedOut) {
    return {
      requestId,
      ok: false,
      provider: WRIM_PROVIDER,
      model: WRIM_MODEL,
      checkpointId: WRIM_CHECKPOINT_ID,
      checkpointHash: sha256File(WRIM_CHECKPOINT_PATH) ?? '',
      tokenizerId: WRIM_TOKENIZER_ID,
      tokenizerHash: sha256File(WRIM_TOKENIZER_PATH) ?? '',
      device: 'unknown',
      rawText: '',
      generatedTokenIds: [],
      generatedTokenCount: 0,
      finishReason: 'timeout',
      collapsed: false,
      latencyMs: HEALTH_TIMEOUT_MS,
      transportSuccess: false,
      reasoningUsable: false,
      capabilityStatus: 'RUNTIME_FAILURE',
      pythonBridge: 'wrim_foundry_infer.py',
      runtime: 'wrim-pytorch-linux',
      networkRequired: false,
      mock: false,
      error: { code: 'RUNTIME_FAILURE', message: 'WRIM health probe timed out.' },
    }
  }
  const parsed = parseEnvelope(ran.stdout, requestId)
  if ('error' in parsed && !('provider' in parsed)) {
    const failed: WrimTransportEnvelope = {
      requestId,
      ok: false,
      provider: WRIM_PROVIDER,
      model: WRIM_MODEL,
      checkpointId: WRIM_CHECKPOINT_ID,
      checkpointHash: sha256File(WRIM_CHECKPOINT_PATH) ?? '',
      tokenizerId: WRIM_TOKENIZER_ID,
      tokenizerHash: sha256File(WRIM_TOKENIZER_PATH) ?? '',
      device: 'unknown',
      rawText: '',
      generatedTokenIds: [],
      generatedTokenCount: 0,
      finishReason: 'error',
      collapsed: false,
      latencyMs: 0,
      transportSuccess: false,
      reasoningUsable: false,
      capabilityStatus: parsed.error,
      pythonBridge: 'wrim_foundry_infer.py',
      runtime: 'wrim-pytorch-linux',
      networkRequired: false,
      mock: false,
      error: { code: parsed.error, message: parsed.message },
    }
    cachedHealth = { at: Date.now(), envelope: failed }
    return failed
  }
  const envelope = parsed as WrimTransportEnvelope
  cachedHealth = { at: Date.now(), envelope }
  return envelope
}

export async function runWrimFoundryInference(input: {
  prompt: string
  maxNewTokens?: number
  requestId?: string
  abortSignal?: AbortSignal
}): Promise<WrimTransportEnvelope> {
  const requestId = input.requestId ?? `wrim-infer-${randomUUID()}`
  const ran = await runBridge({
    request: {
      requestId,
      mode: 'generate',
      prompt: input.prompt,
      maxNewTokens: Math.max(1, Math.min(input.maxNewTokens ?? MAX_NEW_TOKENS, HARD_MAX_NEW_TOKENS)),
      checkpointPath: WRIM_CHECKPOINT_PATH,
      tokenizerPath: WRIM_TOKENIZER_PATH,
      device: 'auto',
      generationMode: 'greedy',
    },
    timeoutMs: INFERENCE_TIMEOUT_MS,
    abortSignal: input.abortSignal,
  })
  if (ran.timedOut) {
    return {
      requestId,
      ok: false,
      provider: WRIM_PROVIDER,
      model: WRIM_MODEL,
      checkpointId: WRIM_CHECKPOINT_ID,
      checkpointHash: sha256File(WRIM_CHECKPOINT_PATH) ?? '',
      tokenizerId: WRIM_TOKENIZER_ID,
      tokenizerHash: sha256File(WRIM_TOKENIZER_PATH) ?? '',
      device: 'unknown',
      rawText: '',
      generatedTokenIds: [],
      generatedTokenCount: 0,
      finishReason: 'timeout',
      collapsed: false,
      latencyMs: INFERENCE_TIMEOUT_MS,
      transportSuccess: false,
      reasoningUsable: false,
      capabilityStatus: 'RUNTIME_FAILURE',
      pythonBridge: 'wrim_foundry_infer.py',
      runtime: 'wrim-pytorch-linux',
      networkRequired: false,
      mock: false,
      error: { code: 'RUNTIME_FAILURE', message: 'WRIM inference timed out.' },
    }
  }
  const parsed = parseEnvelope(ran.stdout, requestId)
  if ('error' in parsed && !('provider' in parsed)) {
    return {
      requestId,
      ok: false,
      provider: WRIM_PROVIDER,
      model: WRIM_MODEL,
      checkpointId: WRIM_CHECKPOINT_ID,
      checkpointHash: sha256File(WRIM_CHECKPOINT_PATH) ?? '',
      tokenizerId: WRIM_TOKENIZER_ID,
      tokenizerHash: sha256File(WRIM_TOKENIZER_PATH) ?? '',
      device: 'unknown',
      rawText: '',
      generatedTokenIds: [],
      generatedTokenCount: 0,
      finishReason: 'error',
      collapsed: false,
      latencyMs: 0,
      transportSuccess: false,
      reasoningUsable: false,
      capabilityStatus: parsed.error,
      pythonBridge: 'wrim_foundry_infer.py',
      runtime: 'wrim-pytorch-linux',
      networkRequired: false,
      mock: false,
      error: { code: parsed.error, message: `${parsed.message} ${ran.stderr}`.trim().slice(0, 800) },
    }
  }
  return parsed as WrimTransportEnvelope
}

export function envelopeToDiagnostics(envelope: WrimTransportEnvelope): FoundryWorkerDiagnostics {
  return {
    provider: envelope.provider,
    model: envelope.model,
    checkpointId: envelope.checkpointId,
    checkpointHash: envelope.checkpointHash,
    tokenizerId: envelope.tokenizerId,
    tokenizerHash: envelope.tokenizerHash,
    device: envelope.device,
    generatedTokenIds: envelope.generatedTokenIds,
    generatedTokenCount: envelope.generatedTokenCount,
    finishReason: envelope.finishReason,
    collapsed: envelope.collapsed,
    transportSuccess: envelope.transportSuccess,
    reasoningUsable: envelope.reasoningUsable,
    capabilityStatus: envelope.capabilityStatus,
    pythonBridge: envelope.pythonBridge,
    runtime: envelope.runtime,
    networkRequired: false,
    mock: false,
  }
}

function failureClassFor(code: WrimErrorCode): Extract<FoundryModelResponse, { ok: false }>['failureClass'] {
  if (code === 'BLOCKED_PROVIDER') return 'UNAVAILABLE'
  if (code === 'RUNTIME_FAILURE') return 'PROVIDER'
  if (code === 'TOKENIZER_FAILURE' || code === 'MODEL_LOAD_FAILURE') return 'PROVIDER'
  return 'MALFORMED'
}

function blockedDecision(envelope: WrimTransportEnvelope) {
  const status = envelope.capabilityStatus === 'OK' ? 'INSUFFICIENT_CAPABILITY' : envelope.capabilityStatus
  return {
    decision: 'BLOCKED' as const,
    reasoningSummary: [
      `WRIM_TRANSPORT_SUCCESS=${envelope.transportSuccess ? 'PASS' : 'FAIL'}`,
      `WRIM_REASONING_USABLE=${envelope.reasoningUsable ? 'YES' : 'NO'}`,
      `capabilityStatus=${status}`,
      `checkpoint=${envelope.checkpointId}`,
      `checkpointHash=${envelope.checkpointHash}`,
      `tokenizer=${envelope.tokenizerId}`,
      `device=${envelope.device}`,
      `collapsed=${envelope.collapsed}`,
      `generatedTokenCount=${envelope.generatedTokenCount}`,
    ].join(' '),
  }
}

export class WrimStep400Model implements FoundryMissionModel {
  readonly provider = WRIM_PROVIDER
  readonly model = WRIM_MODEL

  private async run(request: FoundryModelRequest): Promise<FoundryModelResponse> {
    const started = Date.now()
    const prompt = request.context.userRequest?.trim() || request.context.goal?.trim() || ''
    const envelope = await runWrimFoundryInference({
      prompt,
      maxNewTokens: MAX_NEW_TOKENS,
      abortSignal: request.abortSignal,
    })
    const diagnostics = envelopeToDiagnostics(envelope)
    if (!envelope.ok || !envelope.transportSuccess) {
      const code = envelope.error?.code ?? envelope.capabilityStatus
      return {
        ok: false,
        provider: this.provider,
        model: this.model,
        error: `${code}: ${envelope.error?.message ?? 'WRIM transport failed'}`.slice(0, 800),
        failureClass: failureClassFor(code === 'OK' ? 'RUNTIME_FAILURE' : code),
        latencyMs: envelope.latencyMs || Date.now() - started,
        workerDiagnostics: diagnostics,
      }
    }
    return {
      ok: true,
      provider: this.provider,
      model: this.model,
      decision: blockedDecision(envelope),
      rawText: envelope.rawText,
      latencyMs: envelope.latencyMs || Date.now() - started,
      workerDiagnostics: diagnostics,
    }
  }

  reasonMission(request: FoundryModelRequest) { return this.run(request) }
  chooseNextAction(request: FoundryModelRequest) { return this.run(request) }
  diagnoseFailure(request: FoundryModelRequest) { return this.run(request) }
  replan(request: FoundryModelRequest) { return this.run(request) }
  summarizeProgress(request: FoundryModelRequest) { return this.run(request) }
}

export async function createWrimStep400ModelIfHealthy(): Promise<WrimStep400Model | null> {
  const health = await probeWrimAdapterHealth()
  return health.ok ? new WrimStep400Model() : null
}

export function pinOnlyWorkerCandidate(pin: { provider: string; model: string } | null | undefined): FoundryRoutingCandidate | null {
  if (!pin || pin.provider !== WRIM_PROVIDER || pin.model !== WRIM_MODEL) return null
  const health = getCachedWrimHealth()
  return {
    provider: WRIM_PROVIDER,
    model: WRIM_MODEL,
    local: true,
    callable: health?.ok === true,
    listedOnly: health?.ok !== true,
  }
}

export function createWrimReasoningWorker(port: WrimInferencePort | null): FoundryReasoningWorkerPort {
  if (!port) return { kind: 'none', handshake: DISABLED_HANDSHAKE }
  return { kind: 'wrim', handshake: port.handshake }
}

export function liveWrimHandshake(): WrimCapabilityHandshake {
  return getCachedWrimHealth()?.ok ? LIVE_HANDSHAKE : DISABLED_HANDSHAKE
}

export function wrimFailureLeavesSession(session: FoundryReasoningSession, before: string): { intact: boolean; status: 'BLOCKED_PROVIDER' } {
  session.workerStatus = 'BLOCKED_PROVIDER'
  session.status = 'BLOCKED_PROVIDER'
  return { intact: JSON.stringify(session.reasoningGraph) === before, status: 'BLOCKED_PROVIDER' }
}

export function applyWrimTransportToSession(session: FoundryReasoningSession, envelope: WrimTransportEnvelope): {
  classification: WrimErrorCode
  transportSuccess: boolean
  reasoningUsable: boolean
} {
  const classification: WrimErrorCode = envelope.transportSuccess
    ? (envelope.reasoningUsable ? 'INSUFFICIENT_CAPABILITY' : envelope.collapsed || !envelope.rawText.trim() ? 'INVALID_OUTPUT' : 'INSUFFICIENT_CAPABILITY')
    : (envelope.error?.code ?? envelope.capabilityStatus === 'OK' ? 'RUNTIME_FAILURE' : envelope.capabilityStatus)
  if (classification === 'BLOCKED_PROVIDER') {
    session.workerStatus = 'BLOCKED_PROVIDER'
    session.status = 'BLOCKED_PROVIDER'
  } else {
    session.workerStatus = envelope.reasoningUsable ? 'VALIDATED' : 'REJECTED'
    session.status = 'BLOCKED_CAPABILITY'
  }
  session.healthFindings.push({
    findingId: `wrim-${envelope.requestId}`,
    category: 'WORKER_OUTPUT_INVALID',
    summary: `${classification}: provider=${envelope.provider} model=${envelope.model} collapsed=${envelope.collapsed} tokens=${envelope.generatedTokenCount}`,
    repaired: false,
  })
  session.capabilityGaps.push({
    gapId: `wrim-gap-${envelope.requestId}`,
    capability: 'PLAN_TO_CODE_FIDELITY',
    observedFailure: classification,
    evidence: [
      `provider=${envelope.provider}`,
      `model=${envelope.model}`,
      `checkpoint=${envelope.checkpointId}`,
      `checkpointHash=${envelope.checkpointHash}`,
      `rawText=${envelope.rawText.slice(0, 200)}`,
    ],
    failureClass: 'MODEL_CAPABILITY',
    failureLayer: 'MODEL',
    practiceNeeded: false,
    recommendedDifficulty: 'localized',
    providerSpecific: true,
    processSpecific: false,
    modelSpecific: true,
    status: 'OPEN',
    practiceIds: [],
    distinctPasses: [],
  })
  session.sovereignPolicy = 'DISABLED'
  return { classification, transportSuccess: envelope.transportSuccess, reasoningUsable: envelope.reasoningUsable }
}

export function sovereignOnlyEnabled(session: FoundryReasoningSession): false {
  session.sovereignPolicy = 'DISABLED'
  return false
}

export function sameFixtureBar(name: string): { fixture: string; easier: false } {
  return { fixture: name, easier: false }
}
