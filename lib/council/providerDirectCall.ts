import { completeGeminiCouncilMessage } from '@/lib/ai/providers/geminiCouncil'
import { callXAIChat } from '@/lib/ai/providers/xai'
import {
  completeKimiChat,
  isKimiConfigured,
  type KimiDiagnostics,
  type KimiErrorKind,
} from '@/lib/providers/kimi'
import { compactDisplayWhitespace, toDisplayText } from '@/lib/council/toDisplayText'
import { sanitizeProviderPublicError } from '@/lib/providers/publicError'
import { envHasUsableProviderSecret } from '@/lib/providers/secretPresence'

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
  kimiErrorKind?: KimiErrorKind
  kimiDiagnostics?: KimiDiagnostics
}

function sanitizeProviderError(message: string, family?: DirectProviderFamily): string {
  return sanitizeProviderPublicError(message, family)
}

async function callOpenAi(prompt: string, system: string, maxTokens: number, signal?: AbortSignal): Promise<DirectProviderCallResult> {
  const openaiKey = process.env.OPENAI_API_KEY
  if (!envHasUsableProviderSecret('OPENAI_API_KEY') || !openaiKey) {
    return { ok: false, text: '', transportStatus: 'unavailable', error: 'OPENAI_API_KEY not configured' }
  }
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${openaiKey}`,
    },
    signal,
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
    }),
  })
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
  if (!res.ok) {
    return {
      ok: false,
      text: '',
      transportStatus: res.status,
      error: sanitizeProviderError(data?.error?.message || `OpenAI failed (${res.status})`, 'chatgpt'),
    }
  }
  const text = data.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, text: '', transportStatus: res.status, error: 'empty response body' }
  }
  return { ok: true, text: compactDisplayWhitespace(text), transportStatus: res.status }
}

async function callAnthropic(prompt: string, system: string, maxTokens: number, signal?: AbortSignal): Promise<DirectProviderCallResult> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!envHasUsableProviderSecret('ANTHROPIC_API_KEY') || !anthropicKey) {
    return { ok: false, text: '', transportStatus: 'unavailable', error: 'ANTHROPIC_API_KEY not configured' }
  }
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    signal,
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
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
      error: sanitizeProviderError(data?.error?.message || `Anthropic failed (${res.status})`, 'claude'),
    }
  }
  const text = data.content?.[0]?.text
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, text: '', transportStatus: res.status, error: 'empty response body' }
  }
  return { ok: true, text: compactDisplayWhitespace(text), transportStatus: res.status }
}

async function callGrokDirect(prompt: string, system: string, timeoutMs: number, maxTokens: number): Promise<DirectProviderCallResult> {
  if (!process.env.XAI_API_KEY) {
    return { ok: false, text: '', transportStatus: 'unavailable', error: 'XAI_API_KEY not configured' }
  }
  const result = await callXAIChat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    maxTokens,
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

async function callKimiDirect(prompt: string, system: string, timeoutMs: number, maxTokens: number): Promise<DirectProviderCallResult> {
  if (!isKimiConfigured()) {
    return { ok: false, text: '', transportStatus: 'unavailable', error: 'Kimi key missing', kimiErrorKind: 'key_missing' }
  }
  const result = await completeKimiChat({
    system,
    messages: [{ role: 'user', content: prompt }],
    maxTokens,
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
      kimiErrorKind: result.kind,
      kimiDiagnostics: result.diagnostics,
    }
  }
  if (!result.data.text?.trim()) {
    return { ok: false, text: '', transportStatus: 'unavailable', error: 'empty response body' }
  }
  return {
    ok: true,
    text: compactDisplayWhitespace(result.data.text),
    transportStatus: 200,
    kimiDiagnostics: result.diagnostics,
  }
}

async function callGeminiDirect(prompt: string, system: string, maxTokens: number, timeoutMs: number): Promise<DirectProviderCallResult> {
  if (!process.env.GEMINI_API_KEY) {
    return { ok: false, text: '', transportStatus: 'unavailable', error: 'GEMINI_API_KEY not configured' }
  }
  const result = await completeGeminiCouncilMessage({
    userPrompt: prompt,
    systemPrompt: system,
    maxOutputTokens: maxTokens,
    timeoutMs,
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
  opts?: {
    timeoutMs?: number
    /** Narrowly additive (Engineering Coder Proposal Generation phase): overrides the fixed
     * 120-token Council stability-test cap for callers that genuinely need more (e.g. a hosted
     * coder proposal, which must return a structured-patch JSON body). Every existing Council
     * caller omits this and gets DEFAULT_MAX_TOKENS exactly as before — this option changes
     * nothing about current Council behavior. */
    maxTokens?: number
    /** Narrowly additive: overrides MINIMAL_SYSTEM for callers that need a different system
     * framing (e.g. the hosted coder's structured-proposal instructions). Every existing Council
     * caller omits this and gets MINIMAL_SYSTEM exactly as before. */
    system?: string
  },
): Promise<DirectProviderCallResult> {
  const userPrompt = toDisplayText(prompt) || 'Reply with OK only.'
  const system = opts?.system ?? MINIMAL_SYSTEM
  const maxTokens = opts?.maxTokens ?? DEFAULT_MAX_TOKENS
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)

  try {
    if (family === 'chatgpt' || family === 'baby') {
      return await callOpenAi(userPrompt, system, maxTokens, ac.signal)
    }
    if (family === 'claude') {
      return await callAnthropic(userPrompt, system, maxTokens, ac.signal)
    }
    if (family === 'red_team') {
      return await callAnthropic(
        userPrompt,
        `${system} Flag unsupported certainty only when visible in the prompt.`,
        maxTokens,
        ac.signal,
      )
    }
    if (family === 'grok') {
      return await callGrokDirect(userPrompt, system, timeoutMs, maxTokens)
    }
    if (family === 'gemini') {
      return await callGeminiDirect(userPrompt, system, maxTokens, timeoutMs)
    }
    if (family === 'kimi') {
      return await callKimiDirect(userPrompt, system, timeoutMs, maxTokens)
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

// ---------------------------------------------------------------------------
// Phase I (Provider Experience). Additive only — nothing above this line changes. Gives callers
// (native-builder's Coder Agent, the Engineering Mission UI) an honest, pre-call way to know which
// provider families are actually configured, and a policy-based fallback that never fabricates a
// hosted call: it only ever picks a family from the caller-supplied list that is genuinely
// configured, decided BEFORE any network call, so a resulting proposal's proposerId (`hosted:
// ${family}`) always honestly reflects the family that was actually invoked. If nothing offered is
// configured, callers are expected to omit hostedCoder entirely rather than attempt a call that
// invokeDirectCouncilProvider would just report as unavailable anyway — see
// engineeringStrategy.ts's create()/autoIterate() for the concrete usage.
// ---------------------------------------------------------------------------

export const ALL_PROVIDER_FAMILIES: DirectProviderFamily[] = ['claude', 'chatgpt', 'grok', 'gemini', 'kimi', 'red_team', 'baby']

/** The Coder Agent's own default priority order when a caller asks for fallback without
 * specifying one. Deliberately excludes 'baby' and 'red_team' — those are Council-domain framing
 * variants of chatgpt/claude, not independent hosted-coder-capable families. */
export const DEFAULT_CODER_FALLBACK_ORDER: DirectProviderFamily[] = ['claude', 'chatgpt', 'grok', 'gemini', 'kimi']

/** Honest, synchronous, no-network-call configuration check — mirrors exactly the same
 * per-family key/config checks callOpenAi/callAnthropic/callGrokDirect/callGeminiDirect/
 * callKimiDirect already perform at call time, exposed here so callers can decide BEFORE
 * spending a network round trip (or fabricating an attempt) whether a family is usable. */
export function isProviderFamilyConfigured(family: DirectProviderFamily): boolean {
  switch (family) {
    case 'claude':
    case 'red_team':
      return envHasUsableProviderSecret('ANTHROPIC_API_KEY')
    case 'chatgpt':
    case 'baby':
      return envHasUsableProviderSecret('OPENAI_API_KEY')
    case 'grok':
      return envHasUsableProviderSecret('XAI_API_KEY')
    case 'gemini':
      return envHasUsableProviderSecret('GEMINI_API_KEY')
    case 'kimi':
      return isKimiConfigured()
    default:
      return false
  }
}

export type ProviderFamilyStatus = { family: DirectProviderFamily; configured: boolean }

/** Every sanctioned family's honest configured/not-configured status, for the Engineering Mission
 * UI's provider picker and for /api/mission-runtime/engineering/providers. Never claims a family
 * is reachable — 'configured' means "has the credential a call would need," not "verified live"
 * (that determination belongs to Phase J, live provider verification, which is inherently
 * per-environment and never asserted here). */
export function listProviderFamilyStatus(): ProviderFamilyStatus[] {
  return ALL_PROVIDER_FAMILIES.map(family => ({ family, configured: isProviderFamilyConfigured(family) }))
}

/**
 * Policy-based fallback resolution. Returns the first CONFIGURED family starting with `preferred`
 * and then walking `fallbackOrder` (skipping `preferred` itself on the second pass) — or `null` if
 * none of the offered families are configured. This function makes no network call and never
 * substitutes a family the caller didn't offer via `preferred`/`fallbackOrder`; it is pure policy
 * over the same honest isProviderFamilyConfigured() check above.
 */
export function resolveConfiguredProviderFamily(
  preferred: DirectProviderFamily,
  fallbackOrder: DirectProviderFamily[] = DEFAULT_CODER_FALLBACK_ORDER,
): DirectProviderFamily | null {
  if (isProviderFamilyConfigured(preferred)) return preferred
  for (const family of fallbackOrder) {
    if (family !== preferred && isProviderFamilyConfigured(family)) return family
  }
  return null
}
