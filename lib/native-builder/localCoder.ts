/**
 * Canonical local coding-provider adapter. The model proposes structured actions;
 * Engineering Core executes. Never grants shell access.
 */
import { requestOllamaCompletion, type OllamaFormat, type OllamaGenerateOptions } from './ollamaClient'
import { prepareFoundryCoder } from './localModelArbiter'
import { resolveLocalModelHealth } from './localModelHealth'
import type { FoundryRole } from './foundryRoles'

export const PREFERRED_LOCAL_CODER = 'qwen2.5-coder:14b'
export const PREFERRED_LOCAL_GENERAL = 'huihui_ai/qwen3-abliterated:14b'
export const LOCAL_CODER_TIMEOUT_MS = 240_000

export type LocalCoderStatus = 'LOCAL_CODER_READY' | 'LOCAL_CODER_UNAVAILABLE'
export type HostedCoderStatus = 'HOSTED_CODER_READY' | 'HOSTED_CODER_UNAVAILABLE'

export type LocalCoderResolution = {
  status: LocalCoderStatus
  hostedStatus: HostedCoderStatus
  available: boolean
  baseUrl: string
  models: string[]
  codingModel: string | null
  generalModel: string | null
  detail: string
}

function hostedKeysPresent(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      process.env.XAI_API_KEY?.trim() ||
      process.env.GEMINI_API_KEY?.trim(),
  )
}

function matchModel(models: string[], preferred: string, prefix: string): string | null {
  return models.find(m => m === preferred) ?? models.find(m => m.startsWith(prefix)) ?? null
}

export function pickLocalCoderModel(models: string[], role: FoundryRole = 'BUILDER'): string | null {
  const coder = matchModel(models, PREFERRED_LOCAL_CODER, 'qwen2.5-coder:')
  const general = matchModel(models, PREFERRED_LOCAL_GENERAL, 'huihui_ai/qwen3-abliterated:')
  const codingHeavy = new Set<FoundryRole>([
    'BUILDER',
    'DEBUGGER',
    'TEST_ENGINEER',
    'UI_ENGINEER',
    'BACKEND_ENGINEER',
    'SECURITY_ENGINEER',
  ])
  if (codingHeavy.has(role) && coder) return coder
  if (general) return general
  if (coder) return coder
  return models.find(m => /coder/i.test(m)) ?? models[0] ?? null
}

function resolutionFromHealth(health: Awaited<ReturnType<typeof resolveLocalModelHealth>>): LocalCoderResolution {
  const codingModel = health.model
  const generalModel = pickLocalCoderModel(health.models, 'FOUNDRY_MASTER')
  const ready = health.state === 'READY' && Boolean(codingModel)
  return {
    status: ready ? 'LOCAL_CODER_READY' : 'LOCAL_CODER_UNAVAILABLE',
    hostedStatus: hostedKeysPresent() ? 'HOSTED_CODER_READY' : 'HOSTED_CODER_UNAVAILABLE',
    available: ready,
    baseUrl: health.endpoint,
    models: health.models,
    codingModel,
    generalModel,
    detail: health.detail,
  }
}

export async function resolveLocalCoder(opts?: { routingRetry?: boolean }): Promise<LocalCoderResolution> {
  const attempts = opts?.routingRetry ? 4 : 1
  const probeTimeoutMs = opts?.routingRetry ? 8_000 : undefined
  let last = resolutionFromHealth(await resolveLocalModelHealth({ tryStart: true, probeTimeoutMs }))
  for (let attempt = 1; attempt < attempts && !last.available; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 400 * attempt))
    last = resolutionFromHealth(await resolveLocalModelHealth({ tryStart: true, probeTimeoutMs }))
  }
  return last
}

export async function requestLocalCoderJson(input: {
  role: FoundryRole
  system: string
  prompt: string
  timeoutMs?: number
  format?: OllamaFormat
  options?: OllamaGenerateOptions
  keepAlive?: number | string
}): Promise<{ ok: true; text: string; model: string; metrics?: { totalMs: number | null; promptEvalMs: number | null; evalCount: number | null } } | { ok: false; detail: string; status: LocalCoderStatus }> {
  const resolved = await resolveLocalCoder()
  if (!resolved.available || !resolved.codingModel) {
    return { ok: false, detail: resolved.detail, status: 'LOCAL_CODER_UNAVAILABLE' }
  }
  const model = pickLocalCoderModel(resolved.models, input.role) ?? resolved.codingModel
  await prepareFoundryCoder()
  const result = await requestOllamaCompletion({
    model,
    system: input.system,
    prompt: input.prompt,
    timeoutMs: input.timeoutMs ?? LOCAL_CODER_TIMEOUT_MS,
    format: input.format ?? 'json',
    keepAlive: input.keepAlive ?? '5m',
    options: input.options,
  })
  if (!result.ok) return { ok: false, detail: result.detail, status: resolved.status }
  return {
    ok: true,
    text: result.text,
    model,
    metrics: {
      totalMs: result.metrics.totalMs,
      promptEvalMs: result.metrics.promptEvalMs,
      evalCount: result.metrics.evalCount,
    },
  }
}

export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] ?? trimmed).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  const slice = candidate.slice(start, end + 1)
  for (const text of [slice, slice.replace(/,\s*([}\]])/g, '$1')]) {
    try {
      const parsed = JSON.parse(text) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      /* try next */
    }
  }
  return null
}
