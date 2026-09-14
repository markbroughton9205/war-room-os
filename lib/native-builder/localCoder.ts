/**
 * Canonical local coding-provider adapter. The model proposes structured actions;
 * Engineering Core executes. Never grants shell access.
 */
import { probeOllama, requestOllamaCompletion } from './ollamaClient'
import { prepareFoundryCoder } from './localModelArbiter'
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

export async function resolveLocalCoder(): Promise<LocalCoderResolution> {
  const probe = await probeOllama()
  const codingModel = pickLocalCoderModel(probe.models, 'BUILDER')
  const generalModel = pickLocalCoderModel(probe.models, 'FOUNDRY_MASTER')
  const ready = probe.available && Boolean(codingModel)
  return {
    status: ready ? 'LOCAL_CODER_READY' : 'LOCAL_CODER_UNAVAILABLE',
    hostedStatus: hostedKeysPresent() ? 'HOSTED_CODER_READY' : 'HOSTED_CODER_UNAVAILABLE',
    available: ready,
    baseUrl: probe.baseUrl,
    models: probe.models,
    codingModel,
    generalModel,
    detail: ready
      ? `Local coder ${codingModel} on ${probe.baseUrl}.`
      : probe.available
        ? `Ollama reachable but no usable coding model. Saw: ${probe.models.join(', ') || '(none)'}.`
        : probe.detail,
  }
}

export async function requestLocalCoderJson(input: {
  role: FoundryRole
  system: string
  prompt: string
  timeoutMs?: number
}): Promise<{ ok: true; text: string; model: string } | { ok: false; detail: string; status: LocalCoderStatus }> {
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
    format: 'json',
    keepAlive: '5m',
  })
  if (!result.ok) return { ok: false, detail: result.detail, status: resolved.status }
  return { ok: true, text: result.text, model }
}

export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] ?? raw).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}
