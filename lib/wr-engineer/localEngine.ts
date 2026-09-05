/**
 * WR-Engineer Phase 5 local-engine probe helpers.
 *
 * Reuses lib/native-builder/ollamaClient.ts — the repo's existing localhost Ollama client — rather
 * than standing up a second HTTP runtime. Never pulls, trains, or writes a model.
 */
import { execFile } from 'node:child_process'
import os from 'node:os'
import { promisify } from 'node:util'
import { probeOllama, type OllamaProbeResult } from '@/lib/native-builder/ollamaClient'
import {
  DEFAULT_LOCAL_ENDPOINT,
  DEFAULT_LOCAL_MODEL,
  DEFAULT_LOCAL_RUNTIME,
  type LocalEngineStatus,
  type LocalEngineTelemetry,
} from './engineTypes'

const execFileAsync = promisify(execFile)

let telemetry: LocalEngineTelemetry = emptyTelemetry()

function emptyTelemetry(): LocalEngineTelemetry {
  return {
    lastLatencyMs: null,
    lastError: null,
    lastStatus: 'UNAVAILABLE',
    lastCheckedAt: null,
    lastPromptBytes: null,
    lastResponseBytes: null,
    lastModel: null,
  }
}

export function getLocalEngineTelemetry(): LocalEngineTelemetry {
  return { ...telemetry }
}

export function resetLocalEngineTelemetry(): void {
  telemetry = emptyTelemetry()
}

export function recordLocalEngineTelemetry(update: Partial<LocalEngineTelemetry>, now: Date = new Date()): LocalEngineTelemetry {
  telemetry = {
    ...telemetry,
    ...update,
    lastCheckedAt: now.toISOString(),
  }
  return getLocalEngineTelemetry()
}

/** Strip credentials, paths, and query strings from a local inference URL before UI/API display. */
export function redactEngineEndpoint(url: string): string {
  try {
    const parsed = new URL(url)
    const port = parsed.port ? `:${parsed.port}` : ''
    return `${parsed.protocol}//${parsed.hostname}${port}`
  } catch {
    return 'local'
  }
}

export function ollamaBaseUrl(): string {
  return (process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_LOCAL_ENDPOINT).replace(/\/+$/, '')
}

export async function probeLocalRuntime(probe: () => Promise<OllamaProbeResult> = probeOllama): Promise<OllamaProbeResult> {
  return probe()
}

export function localEngineStatusFromProbe(probe: OllamaProbeResult, selectedModel: string): LocalEngineStatus {
  if (!probe.available) return 'UNAVAILABLE'
  if (probe.models.length === 0) return 'STARTING'
  const selected = selectedModel.trim().toLowerCase()
  const hasModel = probe.models.some(name => {
    const n = name.toLowerCase()
    return n === selected || n.startsWith(`${selected}:`) || n.split(':')[0] === selected.split(':')[0]
  })
  return hasModel ? 'READY' : 'UNAVAILABLE'
}

export async function detectGpuName(): Promise<{ detected: boolean; name: string }> {
  try {
    const { stdout } = await execFileAsync(
      'nvidia-smi',
      ['--query-gpu=name', '--format=csv,noheader'],
      { windowsHide: true, timeout: 2500, maxBuffer: 64 * 1024 },
    )
    const name = stdout.split('\n')[0]?.trim()
    if (!name) return { detected: false, name: 'GPU not reported' }
    return { detected: true, name }
  } catch {
    return { detected: false, name: 'GPU not reported' }
  }
}

export function genesisNodeName(): string {
  return os.hostname()
}

export const LOCAL_RUNTIME_IDENTITY = {
  runtime: DEFAULT_LOCAL_RUNTIME,
  defaultModel: DEFAULT_LOCAL_MODEL,
} as const
