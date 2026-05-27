import { completeGeminiCouncilMessage } from '@/lib/ai/providers/geminiCouncil'
import { callXAIChat } from '@/lib/ai/providers/xai'
import { completeKimiChat, isKimiConfigured } from '@/lib/providers/kimi'
import { compactDisplayWhitespace, toDisplayText } from '@/lib/council/toDisplayText'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const CLAUDE_MODEL = 'claude-sonnet-4-20250514'
const DEFAULT_MAX_TOKENS = 120
const DEFAULT_TIMEOUT_MS = 12_000

const MINIMAL_SYSTEM =
  "You are a War Room council provider in stability test mode. Reply briefly and directly to the user prompt. Do not invent tools, searches, or Ra'el dialogue."

export type DirectProviderFamily =
  | 'chatgpt'
  | 'claude'
  | 'grok'
  | 'gemini'
  | 'kimi'
  | 'red_team'
  | 'baby'

export type DirectProviderCallResult = {
  ok: boolean
  text: string
  transportStatus: number | 'timeout' | 'unavailable'
  error?: string
}

function sanitizeProviderError(message: string): string {
  return toDisplayText(message)
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 280)
}

async function callOpenAi(prompt: string, system: string, signal?: AbortSignal): Promise<DirectProviderCallResult> {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, text: '', transportStatus: 'unavailable', error: 'OPENAI_API_KEY not configured' }
  }
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    signal,
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: DEFAULT_MAX_TOKENS,
    }),
  })
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
  if (!res.ok) {
    return {
      ok: false,
      text: '',
      transportStatus: res.status,
      error: sanitizeProviderError(data?.error?.message || `OpenAI failed (${res.status})`),
    }
  }
  const text = data.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, text: '', transportStatus: res.status, error: 'empty response body' }
  }
  return { ok: true, text: compactDisplayWhitespace(text), transportStatus: res.status }
}

async function callAnthropic(prompt: string, system: string, signal?: AbortSignal): Promise<DirectProviderCallResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, text: '', transportStatus: 'unavailable', error: 'ANTHROPIC_API_KEY not configured' }
  }
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    signal,
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: DEFAULT_MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = (await res.json()) as { content?: { text?: string }[]; error?: { message?: string } }
  if (!res.ok) {
    return {
      ok: false,
      text: '',
      transportStatus: res.status,
      error: sanitizeProviderError(data?.error?.message || `Anthropic failed (${res.status})`),
    }
  }
  const text = data.content?.[0]?.text
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, text: '', transportStatus: res.status, error: 'empty response body' }
  }
  return { ok: true, text: compactDisplayWhitespace(text), transportStatus: res.status }
}

async function callGrokDirect(prompt: string, system: string, timeoutMs: number): Promise<DirectProviderCallResult> {
  if (!process.env.XAI_API_KEY) {
    return { ok: false, text: '', transportStatus: 'unavailable', error: 'XAI_API_KEY not configured' }
  }
  const result = await callXAIChat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    maxTokens: DEFAULT_MAX_TOKENS,
    timeoutMs,
  })
  if (result.status !== 'online') {
    const err = typeof result.text === 'string' && result.text.trim() ? result.text : result.error || 'Grok unavailable'
    const timedOut = /\b(timeout|timed out|abort)\b/i.test(err)
    return {
      ok: false,
      text: '',
      transportStatus: timedOut ? 'timeout' : 'unavailable',
      error: sanitizeProviderError(err),
    }
  }
  if (!result.text?.trim()) {
    return { ok: false, text: '', transportStatus: 'unavailable', error: 'empty response body' }
  }
  return { ok: true, text: compactDisplayWhitespace(result.text), transportStatus: 200 }
}

async function callKimiDirect(prompt: string, system: string, timeoutMs: number): Promise<DirectProviderCallResult> {
  if (!isKimiConfigured()) {
    return { ok: false, text: '', transportStatus: 'unavailable', error: 'Kimi not configured' }
  }
  const result = await completeKimiChat({
    system,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: DEFAULT_MAX_TOKENS,
    timeoutMs,
  })
  if (!result.ok) {
    const err = result.error || 'Kimi unavailable'
    const timedOut = /\b(timeout|timed out|abort)\b/i.test(err)
    return {
      ok: false,
      text: '',
      transportStatus: timedOut ? 'timeout' : 'unavailable',
      error: sanitizeProviderError(err),
    }
  }
  if (!result.data.text?.trim()) {
    return { ok: false, text: '', transportStatus: 'unavailable', error: 'empty response body' }
  }
  return { ok: true, text: compactDisplayWhitespace(result.data.text), transportStatus: 200 }
}

async function callGeminiDirect(prompt: string, system: string): Promise<DirectProviderCallResult> {
  if (!process.env.GEMINI_API_KEY) {
    return { ok: false, text: '', transportStatus: 'unavailable', error: 'GEMINI_API_KEY not configured' }
  }
  const result = await completeGeminiCouncilMessage({
    userPrompt: prompt,
    systemPrompt: system,
    maxOutputTokens: DEFAULT_MAX_TOKENS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  })
  if (!result.ok) {
    const err = result.degraded ? result.note : result.error
    return {
      ok: false,
      text: result.degraded ? compactDisplayWhitespace(result.note) : '',
      transportStatus: 'unavailable',
      error: sanitizeProviderError(err),
    }
  }
  return {
    ok: true,
    text: compactDisplayWhitespace(result.text),
    transportStatus: 200,
  }
}

export async function invokeDirectCouncilProvider(
  family: DirectProviderFamily,
  prompt: string,
  opts?: { timeoutMs?: number },
): Promise<DirectProviderCallResult> {
  const userPrompt = toDisplayText(prompt) || 'Reply with OK only.'
  const system = MINIMAL_SYSTEM
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)

  try {
    if (family === 'chatgpt' || family === 'baby') {
      return await callOpenAi(userPrompt, system, ac.signal)
    }
    if (family === 'claude') {
      return await callAnthropic(userPrompt, system, ac.signal)
    }
    if (family === 'red_team') {
      return await callAnthropic(
        userPrompt,
        `${system} Flag unsupported certainty only when visible in the prompt.`,
        ac.signal,
      )
    }
    if (family === 'grok') {
      return await callGrokDirect(userPrompt, system, timeoutMs)
    }
    if (family === 'gemini') {
      return await callGeminiDirect(userPrompt, system)
    }
    if (family === 'kimi') {
      return await callKimiDirect(userPrompt, system, timeoutMs)
    }
    return { ok: false, text: '', transportStatus: 'unavailable', error: 'unknown provider' }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const timedOut =
      (error instanceof DOMException && error.name === 'AbortError')
      || /\b(abort|timeout|timed out)\b/i.test(msg)
    return {
      ok: false,
      text: '',
      transportStatus: timedOut ? 'timeout' : 'unavailable',
      error: sanitizeProviderError(msg),
    }
  } finally {
    clearTimeout(timer)
  }
}
