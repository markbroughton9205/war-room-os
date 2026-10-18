/**
 * Canonical local coding-provider adapter. The model proposes structured actions;
 * Engineering Core executes. Never grants shell access.
 */
import { isLoopbackModelEndpoint } from './foundryLaunchPolicy'
import { resolveOllamaBaseUrl } from './ollamaClient'
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
  signal?: AbortSignal
  requireLoopback?: boolean
  role: FoundryRole
  /** Explicit fallback must already be installed locally. */
  preferredModel?: string
  system: string
  prompt: string
  timeoutMs?: number
  format?: OllamaFormat
  options?: OllamaGenerateOptions
  keepAlive?: number | string
}): Promise<{ ok: true; text: string; model: string; metrics?: { totalMs: number | null; promptEvalMs: number | null; evalCount: number | null } } | { ok: false; detail: string; status: LocalCoderStatus }> {
  if (input.signal?.aborted) return { ok: false, detail: 'Local coder request aborted.', status: 'LOCAL_CODER_UNAVAILABLE' }
  if (input.requireLoopback && !isLoopbackModelEndpoint(resolveOllamaBaseUrl())) return { ok: false, detail: 'Local Only requires a loopback Ollama endpoint.', status: 'LOCAL_CODER_UNAVAILABLE' }
  const resolved = await resolveLocalCoder()
  if (!resolved.available || !resolved.codingModel) {
    return { ok: false, detail: resolved.detail, status: 'LOCAL_CODER_UNAVAILABLE' }
  }
  if (input.preferredModel && !resolved.models.includes(input.preferredModel)) return { ok: false, detail: 'Requested local fallback is not installed.', status: resolved.status }
  const model = input.preferredModel ?? pickLocalCoderModel(resolved.models, input.role) ?? resolved.codingModel
  await prepareFoundryCoder()
  const result = await requestOllamaCompletion({
    signal: input.signal,
    model,
    requireLoopback: input.requireLoopback,
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
  const recoveredAppend = recoverWhitespaceTruncatedAppendJson(candidate)
  if (recoveredAppend) return recoveredAppend
  return null
}

/**
 * Some constrained local decoders finish the one requested APPEND_FILE test block and then repeat
 * whitespace or unrelated source until the token budget ends, leaving the JSON envelope open.
 * Recover only the first complete, column-zero registered test block from that unfinished content.
 * This enforces the one-block contract; the normal action parser and full-file syntax/semantic
 * preflight still decide whether the model-authored block may run.
 */
export function recoverWhitespaceTruncatedAppendJson(raw: string): Record<string, unknown> | null {
  if (!/"type"\s*:\s*"APPEND_FILE"/.test(raw)) return null
  const contentFields = [...raw.matchAll(/"content"\s*:\s*"/g)]
  const contentField = contentFields.at(-1)
  if (!contentField || contentField.index === undefined) return null
  const valueAt = contentField.index + contentField[0].length
  const encoded = raw.slice(valueAt)
  try {
    // Decode only through the first column-zero test terminator. Later generated material may end
    // on a partial JSON escape when the model exhausts its token budget.
    const firstTerminator = encoded.indexOf('\\n});')
    if (firstTerminator < 0) return null
    const firstEncodedBlock = encoded.slice(0, firstTerminator + '\\n});'.length)
    const decoded = JSON.parse(`"${firstEncodedBlock}"`) as unknown
    if (typeof decoded !== 'string') return null
    const block = decoded.match(/^\s*(test\s*\([\s\S]*?^\}\);)/m)?.[1]
    if (!block) return null
    const pathToken = raw.match(/"path"\s*:\s*("(?:\\.|[^"\\])*")/)?.[1]
    const summaryToken = raw.match(/"summary"\s*:\s*("(?:\\.|[^"\\])*")/)?.[1]
    if (!pathToken) return null
    const path = JSON.parse(pathToken) as unknown
    const summary = summaryToken ? JSON.parse(summaryToken) as unknown : 'Recovered bounded append'
    if (typeof path !== 'string' || typeof summary !== 'string') return null
    return {
      summary,
      actions: [{
        type: 'APPEND_FILE',
        path,
        content: block,
        reason: 'Recovered the first complete bounded test block from a truncated structured response.',
      }],
    }
  } catch {
    return null
  }
}
