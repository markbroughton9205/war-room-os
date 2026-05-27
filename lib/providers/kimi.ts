import 'server-only'

import type { AIMessage, ProviderResponse } from '@/lib/ai/types'

export const MOONSHOT_API_BASE = 'https://api.moonshot.ai/v1'
export const KIMI_DEFAULT_MODEL = 'kimi-k2-0711-preview'
export const KIMI_FALLBACK_MODEL = 'moonshot-v1-8k'

const KIMI_NOT_CONFIGURED = 'Kimi not configured'
const KIMI_ENDPOINT = `${MOONSHOT_API_BASE}/chat/completions`

type KimiEnvKeyName = 'KIMI_API_KEY' | 'MOONSHOT_API_KEY' | null
export type KimiErrorKind =
  | 'key_missing'
  | 'key_rejected'
  | 'model_unavailable'
  | 'upstream_failed'
  | 'request_failed'
  | 'timed_out'
  | 'empty_response'
  | 'unknown'

export type KimiDiagnostics = {
  hasKimiApiKey: boolean
  hasMoonshotApiKey: boolean
  selectedEnvKeyName: KimiEnvKeyName
  baseUrl: string
  model: string
  upstreamStatus: number | null
  sanitizedUpstreamErrorMessage: string | null
}

/** Server-only: prefers KIMI_API_KEY, falls back to MOONSHOT_API_KEY. */
export function readKimiApiKey(): string | null {
  return readKimiApiKeySelection().apiKey
}

export function isKimiConfigured(): boolean {
  return readKimiApiKey() !== null
}

export type KimiChatCompletionResult =
  | { ok: true; data: ProviderResponse; diagnostics: KimiDiagnostics }
  | { ok: false; error: string; detail?: string; status?: number; kind: KimiErrorKind; diagnostics: KimiDiagnostics }

type OpenAIChatChoice = {
  message?: { role?: string; content?: string | null }
}

type OpenAIChatCompletionResponse = {
  choices?: OpenAIChatChoice[]
  error?: { message?: string }
}

function buildMessages(system: string | null | undefined, messages: AIMessage[]): AIMessage[] {
  const out: AIMessage[] = []
  if (system?.trim()) out.push({ role: 'system', content: system.trim() })
  out.push(...messages)
  return out
}

async function requestKimiCompletion(args: {
  apiKey: string
  model: string
  messages: AIMessage[]
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}): Promise<{ res: Response; rawJson: unknown; rawText: string }> {
  const res = await fetch(KIMI_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${args.apiKey}`,
    },
    signal: args.signal,
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      temperature: args.temperature ?? 0.2,
      ...(typeof args.maxTokens === 'number' ? { max_tokens: args.maxTokens } : {}),
    }),
  })
  const rawText = await res.text()
  let rawJson: unknown
  try {
    rawJson = JSON.parse(rawText) as unknown
  } catch {
    rawJson = null
  }
  return { res, rawJson, rawText }
}

function sanitizeUpstreamError(input: string): string {
  return input
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280)
}

function classifyKimiError(status: number | undefined, error: string): KimiErrorKind {
  if (error === KIMI_NOT_CONFIGURED) return 'key_missing'
  if (/\btimeout|timed out|abort\b/i.test(error)) return 'timed_out'
  if (status === 401 || status === 403) return 'key_rejected'
  if (status === 404 || status === 422) return 'model_unavailable'
  if (status !== undefined && status >= 500 && status < 600) return 'upstream_failed'
  if (/empty content/i.test(error)) return 'empty_response'
  if (/Failed to reach Kimi API/i.test(error)) return 'request_failed'
  if (/Kimi API request failed/i.test(error)) return 'request_failed'
  return 'unknown'
}

function buildDiagnostics(args: {
  selectedEnvKeyName: KimiEnvKeyName
  model: string
  upstreamStatus?: number
  upstreamError?: string
}): KimiDiagnostics {
  return {
    hasKimiApiKey: Boolean(process.env.KIMI_API_KEY?.trim()),
    hasMoonshotApiKey: Boolean(process.env.MOONSHOT_API_KEY?.trim()),
    selectedEnvKeyName: args.selectedEnvKeyName,
    baseUrl: MOONSHOT_API_BASE,
    model: args.model,
    upstreamStatus: typeof args.upstreamStatus === 'number' ? args.upstreamStatus : null,
    sanitizedUpstreamErrorMessage: args.upstreamError ? sanitizeUpstreamError(args.upstreamError) : null,
  }
}

function mapErrorMessage(kind: KimiErrorKind): string {
  switch (kind) {
    case 'key_missing':
      return 'Kimi key missing'
    case 'key_rejected':
      return 'Kimi rejected the key'
    case 'model_unavailable':
      return 'Kimi model unavailable'
    case 'upstream_failed':
      return 'Kimi upstream temporarily failed'
    case 'timed_out':
      return 'Kimi request timed out.'
    case 'request_failed':
      return 'Kimi API request failed.'
    case 'empty_response':
      return 'Kimi returned empty content.'
    default:
      return 'Kimi API request failed.'
  }
}

function readKimiApiKeySelection(): { apiKey: string | null; selectedEnvKeyName: KimiEnvKeyName } {
  for (const name of ['KIMI_API_KEY', 'MOONSHOT_API_KEY'] as const) {
    const value = process.env[name]?.trim()
    if (value) return { apiKey: value, selectedEnvKeyName: name }
  }
  return { apiKey: null, selectedEnvKeyName: null }
}

/**
 * OpenAI-compatible Moonshot / Kimi chat completion. Never reads `NEXT_PUBLIC_*` keys.
 */
export async function completeKimiChat(input: {
  system?: string | null
  messages: AIMessage[]
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}): Promise<KimiChatCompletionResult> {
  const { apiKey, selectedEnvKeyName } = readKimiApiKeySelection()
  if (!apiKey) {
    return {
      ok: false,
      error: mapErrorMessage('key_missing'),
      kind: 'key_missing',
      diagnostics: buildDiagnostics({ selectedEnvKeyName: null, model: KIMI_DEFAULT_MODEL }),
    }
  }

  const payloadMessages = buildMessages(input.system, input.messages)
  const timeoutMs = input.timeoutMs ?? 60_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let lastError: KimiChatCompletionResult = {
    ok: false,
    error: mapErrorMessage('request_failed'),
    kind: 'request_failed',
    diagnostics: buildDiagnostics({ selectedEnvKeyName, model: KIMI_DEFAULT_MODEL }),
  }

  try {
    for (const [index, model] of [KIMI_DEFAULT_MODEL, KIMI_FALLBACK_MODEL].entries()) {
      let res: Response
      let rawJson: unknown
      let rawText: string
      try {
        ;({ res, rawJson, rawText } = await requestKimiCompletion({
          apiKey,
          model,
          messages: payloadMessages,
          maxTokens: input.maxTokens,
          temperature: input.temperature,
          signal: controller.signal,
        }))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const aborted = err instanceof Error && err.name === 'AbortError'
        const kind: KimiErrorKind = aborted ? 'timed_out' : 'request_failed'
        return {
          ok: false,
          error: mapErrorMessage(kind),
          detail: sanitizeUpstreamError(msg),
          status: 502,
          kind,
          diagnostics: buildDiagnostics({
            selectedEnvKeyName,
            model,
            upstreamStatus: 502,
            upstreamError: msg,
          }),
        }
      }

      if (!res.ok) {
        const rawDetail =
          typeof rawJson === 'object' && rawJson !== null && 'error' in rawJson
            ? JSON.stringify((rawJson as OpenAIChatCompletionResponse).error ?? rawJson)
            : rawText.slice(0, 2000)
        const kind = classifyKimiError(res.status, 'Kimi API request failed.')
        const sanitizedDetail = sanitizeUpstreamError(rawDetail)
        lastError = {
          ok: false,
          error: mapErrorMessage(kind),
          detail: sanitizedDetail,
          status: res.status >= 400 && res.status < 600 ? res.status : 502,
          kind,
          diagnostics: buildDiagnostics({
            selectedEnvKeyName,
            model,
            upstreamStatus: res.status,
            upstreamError: rawDetail,
          }),
        }
        const shouldFallback =
          index === 0
          && kind !== 'key_rejected'
          && kind !== 'key_missing'
        if (shouldFallback) continue
        return lastError
      }

      const data = rawJson as OpenAIChatCompletionResponse
      const content = data.choices?.[0]?.message?.content
      const text = typeof content === 'string' ? content.trim() : ''
      if (!text) {
        lastError = {
          ok: false,
          error: mapErrorMessage('empty_response'),
          status: 502,
          kind: 'empty_response',
          diagnostics: buildDiagnostics({
            selectedEnvKeyName,
            model,
            upstreamStatus: res.status,
            upstreamError: 'Kimi returned empty content.',
          }),
        }
        if (index === 0) continue
        return lastError
      }

      return {
        ok: true,
        data: {
          text,
          family: 'Kimi',
          provider: 'Moonshot',
          model,
        },
        diagnostics: buildDiagnostics({
          selectedEnvKeyName,
          model,
          upstreamStatus: res.status,
        }),
      }
    }
    return lastError
  } finally {
    clearTimeout(timer)
  }
}

/** Minimal models list probe for provider health checks. */
export async function probeKimiApi(apiKey: string): Promise<{ activeModels: string[]; note: string }> {
  type ModelsResponse = { data?: Array<{ id?: string }> }
  const res = await fetch(`${MOONSHOT_API_BASE}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) {
    throw new Error(`Moonshot models endpoint HTTP ${res.status}`)
  }
  const data = (await res.json()) as ModelsResponse
  const activeModels = [...new Set((data.data ?? []).map(m => m.id?.trim() ?? '').filter(Boolean))].slice(0, 8)
  return {
    activeModels,
    note: 'Moonshot models endpoint responded.',
  }
}
