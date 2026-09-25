/**
 * Honest local-model (Ollama) health. Never fabricates READY.
 * Status comes from a live HTTP probe of the configured endpoint.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { probeOllama } from './ollamaClient'
import { applyFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL } from './foundryOperationsTypes'

const execFileAsync = promisify(execFile)

export const LOCAL_MODEL_STATES = ['READY', 'STARTING', 'UNAVAILABLE', 'ERROR'] as const
export type LocalModelHealthState = (typeof LOCAL_MODEL_STATES)[number]

export type LocalModelHealth = {
  state: LocalModelHealthState
  label: 'LOCAL MODEL READY' | 'LOCAL MODEL STARTING' | 'LOCAL MODEL UNAVAILABLE' | 'LOCAL MODEL ERROR'
  available: boolean
  endpoint: string
  runtime: 'ollama'
  runtimeVersion: string | null
  model: string | null
  models: string[]
  detail: string
  probeMs: number
  serviceActive: boolean | null
}

export type FoundryProviderPolicy = 'AUTO' | 'REMOTE' | 'LOCAL'

const UNIT_NAME = 'ollama.service'
const BINARY_CANDIDATES = [
  path.join(os.homedir(), '.local', 'bin', 'ollama'),
  '/usr/local/bin/ollama',
  '/usr/bin/ollama',
]

let startAttemptedAt = 0

export function localOllamaBinary(): string | null {
  return BINARY_CANDIDATES.find(candidate => existsSync(candidate)) ?? null
}

export function localModelUserUnitPath(): string {
  return path.join(os.homedir(), '.config', 'systemd', 'user', UNIT_NAME)
}

export function renderOllamaUserUnit(binary: string): string {
  return `[Unit]
Description=Ollama local model service for Foundry
After=network-online.target
Wants=network-online.target

[Service]
Type=exec
ExecStart=${binary} serve
Environment=OLLAMA_HOST=127.0.0.1:11434
Environment=HOME=${os.homedir()}
Restart=on-failure
RestartSec=3
TimeoutStartSec=90

[Install]
WantedBy=default.target
`
}

export function writeOllamaUserUnit(binary: string): string {
  const dest = localModelUserUnitPath()
  mkdirSync(path.dirname(dest), { recursive: true })
  writeFileSync(dest, renderOllamaUserUnit(binary), 'utf8')
  return dest
}

async function systemctlUser(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync('systemctl', ['--user', ...args], {
      timeout: 8_000,
      windowsHide: true,
    })
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() }
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, stdout: (err.stdout ?? '').trim(), stderr: (err.stderr ?? err.message ?? '').trim() }
  }
}

export async function localModelServiceState(): Promise<string> {
  const result = await systemctlUser(['is-active', UNIT_NAME])
  return result.stdout || 'unknown'
}

export async function localModelServiceActive(): Promise<boolean | null> {
  const state = await localModelServiceState()
  if (state === 'active' || state === 'activating') return true
  if (state === 'inactive' || state === 'failed') return false
  return null
}

export async function ensureLocalModelService(): Promise<{ started: boolean; detail: string }> {
  const binary = localOllamaBinary()
  if (!binary) return { started: false, detail: 'Ollama binary is not installed.' }
  const state = await localModelServiceState()
  if (state === 'active') return { started: true, detail: 'Ollama user service already active.' }
  if (state === 'activating') return { started: true, detail: 'Ollama user service is already starting.' }
  writeOllamaUserUnit(binary)
  await systemctlUser(['daemon-reload'])
  await systemctlUser(['enable', UNIT_NAME])
  const start = await systemctlUser(['start', UNIT_NAME])
  if (!start.ok) return { started: false, detail: start.stderr || 'systemctl --user start ollama failed.' }
  return { started: true, detail: 'Started Ollama user service.' }
}

function labelFor(state: LocalModelHealthState): LocalModelHealth['label'] {
  if (state === 'READY') return 'LOCAL MODEL READY'
  if (state === 'STARTING') return 'LOCAL MODEL STARTING'
  if (state === 'ERROR') return 'LOCAL MODEL ERROR'
  return 'LOCAL MODEL UNAVAILABLE'
}

async function runtimeVersion(binary: string | null): Promise<string | null> {
  if (!binary) return null
  try {
    const result = await execFileAsync(binary, ['--version'], { timeout: 4_000, windowsHide: true })
    return (result.stdout || result.stderr).trim().split('\n')[0] || null
  } catch {
    return null
  }
}

export async function resolveLocalModelHealth(opts?: { tryStart?: boolean; probeTimeoutMs?: number }): Promise<LocalModelHealth> {
  const started = Date.now()
  const config = applyFoundryRuntimeConfig()
  const binary = localOllamaBinary()
  const serviceActive = await localModelServiceActive()
  if (opts?.tryStart && Date.now() - startAttemptedAt > 30_000 && serviceActive !== true) {
    startAttemptedAt = Date.now()
    await ensureLocalModelService()
  }
  const probe = await probeOllama(process.env, opts?.probeTimeoutMs ? { timeoutMs: opts.probeTimeoutMs } : undefined)
  const probeMs = Date.now() - started
  const version = await runtimeVersion(binary)
  const preferred = config.localModelId
    || FOUNDRY_DEFAULT_FALLBACK_MODEL.replace(/^ollama:/, '')
    || 'qwen2.5-coder:14b'
  const codingModel = probe.models.find(name => name === preferred)
    ?? probe.models.find(name => name.startsWith('qwen2.5-coder:') || name.startsWith('qwen3-coder:'))
    ?? probe.models.find(name => /coder/i.test(name))
    ?? null
  const endpoint = probe.baseUrl

  if (!probe.available) {
    const starting = serviceActive === true || /abort|timeout/i.test(probe.detail)
    const state: LocalModelHealthState = binary && starting ? 'STARTING' : 'UNAVAILABLE'
    return {
      state,
      label: labelFor(state),
      available: false,
      endpoint,
      runtime: 'ollama',
      runtimeVersion: version,
      model: null,
      models: [],
      detail: probe.detail,
      probeMs,
      serviceActive,
    }
  }

  if (!codingModel) {
    return {
      state: 'ERROR',
      label: labelFor('ERROR'),
      available: false,
      endpoint,
      runtime: 'ollama',
      runtimeVersion: version,
      model: null,
      models: probe.models,
      detail: probe.models.length
        ? `Ollama reachable but no usable coding model. Saw: ${probe.models.join(', ')}.`
        : 'Ollama reachable, but no models are pulled.',
      probeMs,
      serviceActive,
    }
  }

  return {
    state: 'READY',
    label: labelFor('READY'),
    available: true,
    endpoint,
    runtime: 'ollama',
    runtimeVersion: version,
    model: codingModel,
    models: probe.models,
    detail: `Local model ${codingModel} on ${endpoint}.`,
    probeMs,
    serviceActive,
  }
}
