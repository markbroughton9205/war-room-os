/**
 * Canonical local-model GPU arbiter. One owner of scarce VRAM at a time.
 * Does not create a second inference runtime — Ollama remains the only local generator.
 */
import { listAllOwnedProcesses } from './processRegistry'
import { listRepairs } from './storage'
import { PREFERRED_LOCAL_CODER, PREFERRED_LOCAL_GENERAL } from './localCoder'
import { probeOllama } from './ollamaClient'

export const LOCAL_MODEL_OWNERS = [
  'FOUNDRY_CODER',
  'COUNCIL_BACKEND',
  'WRIM_FUTURE',
  'OTHER_LOCAL_MODELS',
] as const

export type LocalModelOwner = (typeof LOCAL_MODEL_OWNERS)[number]

export type CouncilBackendExecutionState =
  | 'COUNCIL_READY'
  | 'COUNCIL_BACKEND_LOADING'
  | 'COUNCIL_WAITING_FOR_GPU'
  | 'COUNCIL_DEGRADED'
  | 'COUNCIL_BACKEND_UNAVAILABLE'
  | 'COUNCIL_EXECUTING'
  | 'COUNCIL_SYNTHESIZING'

export type ResidentLocalModel = {
  name: string
  owner: LocalModelOwner
  sizeVramBytes: number | null
  expiresAt: string | null
}

export type LocalModelArbiterSnapshot = {
  owners: typeof LOCAL_MODEL_OWNERS
  councilModel: string
  foundryCoderModel: string
  resident: ResidentLocalModel[]
  gpuOwner: LocalModelOwner | 'NONE'
  foundryActive: boolean
  councilBackendExecutionState: CouncilBackendExecutionState
  detail: string
}

export type PrepareCouncilBackendResult = {
  ok: boolean
  state: CouncilBackendExecutionState
  gpuOwner: LocalModelOwner | 'NONE'
  unloaded: string[]
  detail: string
  waitedMs: number
}

const FOUNDRY_ACTIVE_STEPS = new Set([
  'ANALYZING',
  'PLANNING',
  'EDITING',
  'BUILDING',
  'RUNNING',
  'TESTING',
  'REPAIRING',
])

let phase: CouncilBackendExecutionState = 'COUNCIL_READY'

function ollamaHost(): string {
  return (process.env.OLLAMA_BASE_URL?.trim() || 'http://localhost:11434').replace(/\/+$/, '')
}

export function classifyLocalModelOwner(model: string): LocalModelOwner {
  const name = model.toLowerCase()
  if (name.includes('qwen2.5-coder') || name.includes('qwen3-coder')) return 'FOUNDRY_CODER'
  if (name.includes('qwen3-abliterated') || name === PREFERRED_LOCAL_GENERAL.toLowerCase()) return 'COUNCIL_BACKEND'
  if (name.includes('wrim')) return 'WRIM_FUTURE'
  return 'OTHER_LOCAL_MODELS'
}

export function councilBackendModelId(): string {
  return PREFERRED_LOCAL_GENERAL
}

export function foundryCoderModelId(): string {
  return PREFERRED_LOCAL_CODER
}

export function backendExecutionLabel(state: CouncilBackendExecutionState): string {
  if (state === 'COUNCIL_READY') return 'READY'
  if (state === 'COUNCIL_BACKEND_LOADING') return 'LOADING'
  if (state === 'COUNCIL_WAITING_FOR_GPU') return 'WAITING FOR LOCAL GPU'
  if (state === 'COUNCIL_DEGRADED') return 'DEGRADED'
  if (state === 'COUNCIL_BACKEND_UNAVAILABLE') return 'UNAVAILABLE'
  if (state === 'COUNCIL_EXECUTING') return 'EXECUTING'
  return 'SYNTHESIZING'
}

export function setCouncilExecutionPhase(next: CouncilBackendExecutionState): void {
  phase = next
}

export function currentCouncilExecutionPhase(): CouncilBackendExecutionState {
  return phase
}

export async function listResidentLocalModels(): Promise<ResidentLocalModel[]> {
  try {
    const res = await fetch(`${ollamaHost()}/api/ps`, { signal: AbortSignal.timeout(2500) })
    if (!res.ok) return []
    const data = (await res.json()) as {
      models?: { name?: string; model?: string; size_vram?: number; expires_at?: string }[]
    }
    return (data.models ?? []).map(row => {
      const name = String(row.name || row.model || '')
      return {
        name,
        owner: classifyLocalModelOwner(name),
        sizeVramBytes: typeof row.size_vram === 'number' ? row.size_vram : null,
        expiresAt: typeof row.expires_at === 'string' ? row.expires_at : null,
      }
    }).filter(row => row.name)
  } catch {
    return []
  }
}

export async function foundryMissionActive(): Promise<boolean> {
  if (listAllOwnedProcesses().length > 0) return true
  try {
    const repairs = await listRepairs()
    return repairs.some(repair => {
      const step = repair.codingMission?.currentStep
      return Boolean(step && FOUNDRY_ACTIVE_STEPS.has(step))
    })
  } catch {
    return false
  }
}

export async function snapshotLocalModelArbiter(): Promise<LocalModelArbiterSnapshot> {
  const resident = await listResidentLocalModels()
  const foundryActive = await foundryMissionActive()
  const gpuOwner = resident.find(row => row.owner === 'FOUNDRY_CODER')?.owner
    ?? resident.find(row => row.owner === 'COUNCIL_BACKEND')?.owner
    ?? resident[0]?.owner
    ?? 'NONE'
  let councilBackendExecutionState = phase
  if (phase === 'COUNCIL_READY' || phase === 'COUNCIL_BACKEND_UNAVAILABLE' || phase === 'COUNCIL_DEGRADED') {
    if (foundryActive && gpuOwner === 'FOUNDRY_CODER') councilBackendExecutionState = 'COUNCIL_WAITING_FOR_GPU'
    else if (gpuOwner === 'FOUNDRY_CODER') councilBackendExecutionState = 'COUNCIL_BACKEND_LOADING'
    else if (gpuOwner === 'COUNCIL_BACKEND') councilBackendExecutionState = 'COUNCIL_READY'
  }
  return {
    owners: LOCAL_MODEL_OWNERS,
    councilModel: councilBackendModelId(),
    foundryCoderModel: foundryCoderModelId(),
    resident,
    gpuOwner,
    foundryActive,
    councilBackendExecutionState,
    detail: foundryActive
      ? 'Foundry mission is active; Council must wait or serialize.'
      : gpuOwner === 'FOUNDRY_CODER'
        ? 'Foundry coder currently occupies GPU VRAM.'
        : gpuOwner === 'COUNCIL_BACKEND'
          ? 'Council backend currently occupies GPU VRAM.'
          : 'No local model currently resident.',
  }
}

export async function unloadLocalModel(model: string): Promise<boolean> {
  try {
    const res = await fetch(`${ollamaHost()}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ model, prompt: '', keep_alive: 0, stream: false }),
    })
    return res.ok
  } catch {
    return false
  }
}

async function warmupCouncilBackend(model: string): Promise<boolean> {
  try {
    const res = await fetch(`${ollamaHost()}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({ model, prompt: 'ok', keep_alive: '5m', stream: false, think: false }),
    })
    return res.ok
  } catch {
    return false
  }
}

export function decideCouncilGpuTransition(input: {
  foundryActive: boolean
  resident: ResidentLocalModel[]
}): { action: 'WAIT' | 'ACTIVATE' | 'ALREADY_READY'; unload: string[] } {
  if (input.foundryActive) return { action: 'WAIT', unload: [] }
  const competing = input.resident.filter(row => row.owner === 'FOUNDRY_CODER' || row.owner === 'OTHER_LOCAL_MODELS')
  const councilResident = input.resident.some(row => row.owner === 'COUNCIL_BACKEND')
  if (councilResident && competing.length === 0) return { action: 'ALREADY_READY', unload: [] }
  return { action: 'ACTIVATE', unload: competing.map(row => row.name) }
}

export async function prepareCouncilBackend(opts?: {
  allowWaitMs?: number
  skipWarmupIfResident?: boolean
}): Promise<PrepareCouncilBackendResult> {
  const started = Date.now()
  const unloaded: string[] = []
  const probe = await probeOllama()
  if (!probe.available) {
    phase = 'COUNCIL_BACKEND_UNAVAILABLE'
    return {
      ok: false,
      state: 'COUNCIL_BACKEND_UNAVAILABLE',
      gpuOwner: 'NONE',
      unloaded,
      detail: probe.detail,
      waitedMs: Date.now() - started,
    }
  }

  const foundryActive = await foundryMissionActive()
  if (foundryActive) {
    phase = 'COUNCIL_WAITING_FOR_GPU'
    const waitMs = Math.max(0, opts?.allowWaitMs ?? 0)
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs))
    const stillActive = await foundryMissionActive()
    if (stillActive) {
      return {
        ok: false,
        state: 'COUNCIL_WAITING_FOR_GPU',
        gpuOwner: 'FOUNDRY_CODER',
        unloaded,
        detail: 'COUNCIL WAITING. Local GPU currently serving Foundry. Preparing Council runtime is deferred until Foundry is idle.',
        waitedMs: Date.now() - started,
      }
    }
  }

  const resident = await listResidentLocalModels()
  const decision = decideCouncilGpuTransition({ foundryActive: false, resident })
  if (decision.action === 'ALREADY_READY' && opts?.skipWarmupIfResident !== false) {
    phase = 'COUNCIL_READY'
    return {
      ok: true,
      state: 'COUNCIL_READY',
      gpuOwner: 'COUNCIL_BACKEND',
      unloaded,
      detail: `Council backend ${councilBackendModelId()} is already resident.`,
      waitedMs: Date.now() - started,
    }
  }

  phase = 'COUNCIL_BACKEND_LOADING'
  for (const name of decision.unload) {
    if (await unloadLocalModel(name)) unloaded.push(name)
  }

  const warmed = await warmupCouncilBackend(councilBackendModelId())
  const after = await listResidentLocalModels()
  const councilResident = after.some(row => row.owner === 'COUNCIL_BACKEND')
  phase = warmed || councilResident ? 'COUNCIL_READY' : 'COUNCIL_DEGRADED'
  return {
    ok: warmed || councilResident,
    state: phase,
    gpuOwner: councilResident ? 'COUNCIL_BACKEND' : after[0]?.owner ?? 'NONE',
    unloaded,
    detail: warmed || councilResident
      ? `Council backend ${councilBackendModelId()} is active.`
      : 'Council backend failed to become resident after releasing competing models.',
    waitedMs: Date.now() - started,
  }
}

export async function prepareFoundryCoder(): Promise<PrepareCouncilBackendResult> {
  const started = Date.now()
  const unloaded: string[] = []
  const resident = await listResidentLocalModels()
  for (const row of resident) {
    if (row.owner === 'COUNCIL_BACKEND') {
      if (await unloadLocalModel(row.name)) unloaded.push(row.name)
    }
  }
  return {
    ok: true,
    state: currentCouncilExecutionPhase(),
    gpuOwner: 'FOUNDRY_CODER',
    unloaded,
    detail: `Foundry coder ${foundryCoderModelId()} may load. Released ${unloaded.join(', ') || 'nothing'}.`,
    waitedMs: Date.now() - started,
  }
}

export function councilDegradedBriefing(reason: string, missingMembers: string[]): string {
  const missing = missingMembers.length ? missingMembers.join(', ') : 'all four members'
  return [
    'COUNCIL DEGRADED',
    'The four Council identities remain available, but the shared local reasoning backend could not complete this round.',
    `Reason: ${reason}`,
    `Unavailable this round: ${missing}.`,
    'Suggested automatic recovery: Releasing competing local model and retrying Council.',
  ].join('\n')
}

export function partialCouncilBriefing(available: string[], missing: string[], synthesis: string): string {
  const lines = [
    'COUNCIL PARTIAL COMPLETE',
    available.length ? `Contributing members: ${available.join(', ')}.` : 'No member produced output.',
    missing.length ? `${missing.join(', ')} unavailable for this round.` : '',
    synthesis.trim(),
  ]
  return lines.filter(Boolean).join('\n')
}
