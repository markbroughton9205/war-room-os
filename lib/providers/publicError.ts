import { toDisplayText } from '@/lib/council/toDisplayText'

export type CouncilProviderPublicFamily =
  | 'chatgpt'
  | 'claude'
  | 'grok'
  | 'gemini'
  | 'kimi'
  | 'red_team'
  | 'baby'
  | 'bridge_architect'

function classifyAuth(message: string): 'openai' | 'anthropic' | 'generic' | null {
  const lower = message.toLowerCase()
  if (!/incorrect api key|invalid api key|invalid_api_key|authentication|unauthorized|401|forbidden|403/.test(lower)) {
    return null
  }
  if (/openai|chatgpt|sk-proj/.test(lower) || /incorrect api key provided/.test(lower)) return 'openai'
  if (/anthropic|claude/.test(lower)) return 'anthropic'
  return 'generic'
}

/**
 * Operator/UI-safe provider failure text. Preserves error class; never echoes credential material.
 */
export function sanitizeProviderPublicError(message: string, family?: CouncilProviderPublicFamily): string {
  const trimmed = toDisplayText(message).trim()
  const auth = classifyAuth(trimmed)
  if (family === 'chatgpt' || family === 'baby' || auth === 'openai') {
    if (auth || /incorrect api key|invalid api key|invalid_api_key/.test(trimmed.toLowerCase())) {
      return 'OpenAI authentication failed.'
    }
  }
  if (family === 'claude' || family === 'red_team' || auth === 'anthropic') {
    if (auth || /invalid x-api-key|invalid.*api.?key/.test(trimmed.toLowerCase())) {
      return 'Anthropic authentication failed.'
    }
  }
  if (auth === 'generic') return 'Provider authentication failed.'
  return trimmed.slice(0, 280)
}

export function sanitizeCaughtProviderError(family: CouncilProviderPublicFamily, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return sanitizeProviderPublicError(raw, family)
}
