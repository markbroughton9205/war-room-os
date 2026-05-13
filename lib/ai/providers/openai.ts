import type { AIMessage, ProviderResponse } from '../types'

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_MODEL = 'gpt-4o'

export type OpenAIChatCompletionResult =
  | { ok: true; data: ProviderResponse }
  | { ok: false; error: string; detail?: string; status?: number }

type OpenAIChatChoice = {
  message?: { role?: string; content?: string | null }
}

type OpenAIChatCompletionResponse = {
  choices?: OpenAIChatChoice[]
}

function buildOpenAIMessages(system: string | null | undefined, messages: AIMessage[]): AIMessage[] {
  const out: AIMessage[] = []
  if (system && system.trim().length) {
    out.push({ role: 'system', content: system.trim() })
  }
  out.push(...messages)
  return out
}

/**
 * Server-only OpenAI Chat Completions (`gpt-4o`). Reads `process.env.OPENAI_API_KEY` — never `NEXT_PUBLIC_*`.
 */
export async function completeOpenAIChat(input: {
  system?: string | null
  messages: AIMessage[]
}): Promise<OpenAIChatCompletionResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, error: 'Server is missing OPENAI_API_KEY.' }
  }

  const payloadMessages = buildOpenAIMessages(input.system, input.messages)

  let res: Response
  try {
    res = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: payloadMessages,
      }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error calling OpenAI.'
    return { ok: false, error: 'Failed to reach OpenAI API.', detail: msg, status: 502 }
  }

  const rawText = await res.text()
  let rawJson: unknown
  try {
    rawJson = JSON.parse(rawText) as unknown
  } catch {
    if (!res.ok) {
      return {
        ok: false,
        error: 'OpenAI API request failed.',
        detail: rawText.slice(0, 2000),
        status: res.status >= 400 && res.status < 600 ? res.status : 502,
      }
    }
    return { ok: false, error: 'OpenAI returned non-JSON.', detail: rawText.slice(0, 2000), status: 502 }
  }

  if (!res.ok) {
    const status = res.status >= 400 && res.status < 600 ? res.status : 502
    const detail =
      typeof rawJson === 'object' && rawJson !== null && 'error' in rawJson
        ? JSON.stringify((rawJson as { error?: unknown }).error ?? rawJson)
        : JSON.stringify(rawJson)
    return { ok: false, error: 'OpenAI API request failed.', detail, status }
  }

  const data = rawJson as OpenAIChatCompletionResponse
  const content = data.choices?.[0]?.message?.content
  const text = typeof content === 'string' ? content : ''

  const providerResponse: ProviderResponse = {
    text,
    family: 'ChatGPT',
    provider: 'OpenAI',
    model: OPENAI_MODEL,
    raw: rawJson,
  }

  return { ok: true, data: providerResponse }
}
