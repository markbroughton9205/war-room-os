/**
 * HVS-owned live creative completer.
 * Reuses existing War Room provider env keys. Does not scatter SDK clients.
 * Does not store prompts, raw model text, or hidden reasoning.
 */
import { envHasUsableProviderSecret } from '@/lib/providers/secretPresence'
import { GEMINI_REST_BASE } from '@/lib/ai/providers/geminiGenerative'
import { configuredXAIModel } from '@/lib/ai/providers/xai'
import {
  HVS_CREATIVE_MAX_RETRIES,
  HVS_CREATIVE_TIMEOUT_MS,
  type HvsCreativeCompleter,
  type HvsCreativeCompletionRequest,
  type HvsCreativeCompletionResult,
  type HvsCreativeRequestType,
} from './types'

export type HvsCreativeVendor = 'anthropic' | 'openai' | 'xai' | 'gemini'

export type HvsCreativeProviderSelection = {
  vendor: HvsCreativeVendor
  model: string
  envKey: string
}

const DEFAULT_MODELS: Record<HvsCreativeVendor, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  xai: 'grok-4.3',
  gemini: 'gemini-2.5-flash',
}

const VENDOR_KEYS: Record<HvsCreativeVendor, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  xai: 'XAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
}

const PREFERRED_ORDER: HvsCreativeVendor[] = ['anthropic', 'openai', 'xai', 'gemini']

export function parseHvsCreativeVendor(value: string | undefined | null): HvsCreativeVendor | null {
  const raw = value?.trim().toLowerCase()
  if (raw === 'anthropic' || raw === 'claude') return 'anthropic'
  if (raw === 'openai' || raw === 'chatgpt') return 'openai'
  if (raw === 'xai' || raw === 'grok') return 'xai'
  if (raw === 'gemini' || raw === 'google') return 'gemini'
  return null
}

export function isHvsCreativeLiveConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.HVS_CREATIVE_LIVE === '0') return false
  const preferred = parseHvsCreativeVendor(env.HVS_CREATIVE_PROVIDER)
  if (preferred) return envHasUsableProviderSecret(VENDOR_KEYS[preferred], env)
  return PREFERRED_ORDER.some(vendor => envHasUsableProviderSecret(VENDOR_KEYS[vendor], env))
}

export function resolveHvsCreativeProviderSelection(env: NodeJS.ProcessEnv = process.env): HvsCreativeProviderSelection | null {
  if (env.HVS_CREATIVE_LIVE === '0') return null
  const preferred = parseHvsCreativeVendor(env.HVS_CREATIVE_PROVIDER)
  const overrideModel = env.HVS_CREATIVE_MODEL?.trim() || null
  const pick = (vendor: HvsCreativeVendor): HvsCreativeProviderSelection | null => {
    if (!envHasUsableProviderSecret(VENDOR_KEYS[vendor], env)) return null
    return {
      vendor,
      model: overrideModel || (vendor === 'xai' ? configuredXAIModel() : DEFAULT_MODELS[vendor]),
      envKey: VENDOR_KEYS[vendor],
    }
  }
  if (preferred) return pick(preferred)
  for (const vendor of PREFERRED_ORDER) {
    const selected = pick(vendor)
    if (selected) return selected
  }
  return null
}

function parseJsonObject(text: string): unknown | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : trimmed
  try {
    return JSON.parse(candidate) as unknown
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as unknown
      } catch {
        return null
      }
    }
    return null
  }
}

type HttpJsonResult = {
  ok: boolean
  text: string
  status: number | 'timeout' | 'unavailable'
  requestId?: string | null
  usage?: { inputTokens?: number; outputTokens?: number } | null
  error?: string
}

function retryable(status: number | 'timeout' | 'unavailable'): boolean {
  return status === 'timeout' || status === 429 || status === 500 || status === 502 || status === 503 || status === 529
}

async function postJson(input: {
  url: string
  headers: Record<string, string>
  body: unknown
  timeoutMs: number
  signal?: AbortSignal
}): Promise<HttpJsonResult> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), input.timeoutMs)
  const onAbort = () => ac.abort()
  input.signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(input.url, {
      method: 'POST',
      headers: input.headers,
      body: JSON.stringify(input.body),
      signal: ac.signal,
      cache: 'no-store',
    })
    const raw = await res.text()
    let parsed: Record<string, unknown> = {}
    try {
      parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    } catch {
      parsed = {}
    }
    if (!res.ok) {
      const err = typeof parsed.error === 'object' && parsed.error
        ? String((parsed.error as { message?: string }).message ?? `HTTP ${res.status}`)
        : String(parsed.message ?? parsed.error ?? `HTTP ${res.status}`)
      return { ok: false, text: '', status: res.status, error: err.slice(0, 240) }
    }
    return { ok: true, text: raw, status: res.status, requestId: res.headers.get('request-id') }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const timedOut = /abort|timeout|timed out/i.test(msg) || (error instanceof DOMException && error.name === 'AbortError')
    return { ok: false, text: '', status: timedOut ? 'timeout' : 'unavailable', error: timedOut ? 'timeout' : msg.slice(0, 240) }
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onAbort)
  }
}

function usageFrom(obj: Record<string, unknown> | undefined): { inputTokens?: number; outputTokens?: number } | null {
  if (!obj) return null
  const usage = (obj.usage ?? obj.usageMetadata) as Record<string, unknown> | undefined
  if (!usage) return null
  const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount ?? 0)
  const output = Number(usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount ?? 0)
  if (!input && !output) return null
  return { inputTokens: input || undefined, outputTokens: output || undefined }
}

async function callVendor(selection: HvsCreativeProviderSelection, request: HvsCreativeCompletionRequest, key: string): Promise<HttpJsonResult> {
  const maxTokens = request.requestType === 'ALTERNATIVE_GENERATION' ? 3500 : request.requestType === 'CREATIVE_REVIEW' ? 2800 : 1800
  if (selection.vendor === 'anthropic') {
    const result = await postJson({
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      timeoutMs: request.timeoutMs,
      body: {
        model: selection.model,
        max_tokens: maxTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
      },
    })
    if (!result.ok) return result
    const data = parseJsonObject(result.text) as Record<string, unknown> | null
    const content = Array.isArray(data?.content) ? data.content as Array<{ text?: string }> : []
    const text = content.map(row => row.text ?? '').join('\n')
    return { ...result, text, usage: usageFrom(data ?? undefined), requestId: typeof data?.id === 'string' ? data.id : result.requestId }
  }
  if (selection.vendor === 'openai' || selection.vendor === 'xai') {
    const url = selection.vendor === 'openai'
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://api.x.ai/v1/chat/completions'
    const result = await postJson({
      url,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      timeoutMs: request.timeoutMs,
      body: {
        model: selection.model,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      },
    })
    if (!result.ok) return result
    const data = parseJsonObject(result.text) as Record<string, unknown> | null
    const choices = Array.isArray(data?.choices) ? data.choices as Array<{ message?: { content?: string } }> : []
    const text = choices[0]?.message?.content ?? ''
    return { ...result, text, usage: usageFrom(data ?? undefined), requestId: typeof data?.id === 'string' ? data.id : result.requestId }
  }
  const result = await postJson({
    url: `${GEMINI_REST_BASE}/models/${encodeURIComponent(selection.model)}:generateContent`,
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': key,
    },
    timeoutMs: request.timeoutMs,
    body: {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: 'user', parts: [{ text: request.user }] }],
      generationConfig: { maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
    },
  })
  if (!result.ok) return result
  const data = parseJsonObject(result.text) as Record<string, unknown> | null
  const candidates = Array.isArray(data?.candidates) ? data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> : []
  const text = candidates[0]?.content?.parts?.map(part => part.text ?? '').join('\n') ?? ''
  return { ...result, text, usage: usageFrom(data ?? undefined) }
}

export function timeoutMsFor(requestType: HvsCreativeRequestType): number {
  if (requestType === 'INTENT_ANALYSIS') return HVS_CREATIVE_TIMEOUT_MS.intent
  if (requestType === 'ALTERNATIVE_GENERATION') return HVS_CREATIVE_TIMEOUT_MS.alternatives
  if (requestType === 'VISUAL_REVIEW') return HVS_CREATIVE_TIMEOUT_MS.vision
  return HVS_CREATIVE_TIMEOUT_MS.review
}

export function createHvsLiveCompleter(options?: {
  selection?: HvsCreativeProviderSelection | null
  env?: NodeJS.ProcessEnv
  fetchOnce?: (request: HvsCreativeCompletionRequest, selection: HvsCreativeProviderSelection, key: string) => Promise<HttpJsonResult>
  maxRetries?: number
}): HvsCreativeCompleter | null {
  const env = options?.env ?? process.env
  const selection = options?.selection === undefined ? resolveHvsCreativeProviderSelection(env) : options.selection
  if (!selection) return null
  const key = env[selection.envKey]
  if (!key || !envHasUsableProviderSecret(selection.envKey, env)) return null
  const maxRetries = options?.maxRetries ?? HVS_CREATIVE_MAX_RETRIES
  const fetchOnce = options?.fetchOnce ?? ((request, sel) => callVendor(sel, request, key))

  return {
    async complete<T>(request: HvsCreativeCompletionRequest<T>): Promise<HvsCreativeCompletionResult<T>> {
      const startedAt = new Date().toISOString()
      let last: HttpJsonResult = { ok: false, text: '', status: 'unavailable', error: 'not attempted' }
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        last = await fetchOnce(request, selection, key)
        if (last.ok) break
        if (attempt >= maxRetries || !retryable(last.status)) break
      }
      const completedAt = new Date().toISOString()
      const base = {
        provider: selection.vendor,
        model: selection.model,
        requestId: last.requestId ?? null,
        startedAt,
        completedAt,
        usage: last.usage ?? null,
        rawStored: false as const,
        hiddenReasoningStored: false as const,
      }
      if (last.status === 'timeout') {
        return { ok: false, value: null, status: 'timeout', schemaValid: false, error: 'timeout', ...base }
      }
      if (!last.ok) {
        return { ok: false, value: null, status: 'unavailable', schemaValid: false, error: last.error ?? 'unavailable', ...base }
      }
      const parsed = parseJsonObject(last.text)
      if (parsed == null) {
        return { ok: false, value: null, status: 'invalid', schemaValid: false, error: 'empty or non-JSON response', ...base }
      }
      return { ok: true, value: parsed as T, status: 'ok', schemaValid: true, ...base }
    },
  }
}

export function createTimeoutCreativeCompleter(timeoutMs = 5): HvsCreativeCompleter {
  return {
    async complete<T>(request: HvsCreativeCompletionRequest<T>): Promise<HvsCreativeCompletionResult<T>> {
      const startedAt = new Date().toISOString()
      await new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), Math.min(timeoutMs, request.timeoutMs))
        void timer
      }).catch(() => undefined)
      return {
        ok: false,
        value: null,
        status: 'timeout',
        schemaValid: false,
        provider: 'timeout-fixture',
        model: 'none',
        startedAt,
        completedAt: new Date().toISOString(),
        rawStored: false,
        hiddenReasoningStored: false,
        error: 'timeout',
      }
    },
  }
}
