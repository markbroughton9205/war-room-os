import 'server-only'

import type { AIMessage, ProviderResponse } from '@/lib/ai/types'

export const MOONSHOT_API_BASE = 'https://api.moonshot.ai/v1'
export const KIMI_DEFAULT_MODEL = 'kimi-k2-0711-preview'
export const KIMI_FALLBACK_MODEL = 'moonshot-v1-8k'

const KIMI_NOT_CONFIGURED = 'Kimi not configured'

/** Server-only: prefers KIMI_API_KEY, falls back to MOONSHOT_API_KEY. */
export function readKimiApiKey(): string | null {
  for (const name of ['KIMI_API_KEY', 'MOONSHOT_API_KEY'] as const) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return null
}

export function isKimiConfigured(): boolean {
  return readKimiApiKey() !== null
}

export type KimiChatCompletionResult =
  | { ok: true; data: ProviderResponse }
  | { ok: false; error: string; detail?: string; status?: number }

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
  signal?: AbortSignal
}): Promise<{ res: Response; rawJson: unknown; rawText: string }> {
  const res = await fetch(`${MOONSHOT_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${args.apiKey}`,
    },
    signal: args.signal,
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
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

/**
 * OpenAI-compatible Moonshot / Kimi chat completion. Never reads `NEXT_PUBLIC_*` keys.
 */
export async function completeKimiChat(input: {
  system?: string | null
  messages: AIMessage[]
  maxTokens?: number
  timeoutMs?: number
}): Promise<KimiChatCompletionResult> {
  const apiKey = readKimiApiKey()
  if (!apiKey) {
    return { ok: false, error: KIMI_NOT_CONFIGURED }
  }

  const payloadMessages = buildMessages(input.system, input.messages)
  const timeoutMs = input.timeoutMs ?? 60_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const models = [KIMI_DEFAULT_MODEL, KIMI_FALLBACK_MODEL]
  let lastError: KimiChatCompletionResult = { ok: false, error: KIMI_NOT_CONFIGURED }

  try {
    for (const model of models) {
      let res: Response
      let rawJson: unknown
      let rawText: string
      try {
        ;({ res, rawJson, rawText } = await requestKimiCompletion({
          apiKey,
          model,
          messages: payloadMessages,
          maxTokens: input.maxTokens,
          signal: controller.signal,
        }))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const aborted = err instanceof Error && err.name === 'AbortError'
        return {
          ok: false,
          error: aborted ? 'Kimi request timed out.' : 'Failed to reach Kimi API.',
          detail: msg,
          status: 502,
        }
      }

      if (!res.ok) {
        const detail =
          typeof rawJson === 'object' && rawJson !== null && 'error' in rawJson
            ? JSON.stringify((rawJson as OpenAIChatCompletionResponse).error ?? rawJson)
            : rawText.slice(0, 2000)
        lastError = {
          ok: false,
          error: 'Kimi API request failed.',
          detail,
          status: res.status >= 400 && res.status < 600 ? res.status : 502,
        }
        continue
      }

      const data = rawJson as OpenAIChatCompletionResponse
      const content = data.choices?.[0]?.message?.content
      const text = typeof content === 'string' ? content.trim() : ''
      if (!text) {
        lastError = { ok: false, error: 'Kimi returned empty content.', status: 502 }
        continue
      }

      return {
        ok: true,
        data: {
          text,
          family: 'Kimi',
          provider: 'Moonshot',
          model,
        },
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
