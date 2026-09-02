const DISPLAY_TEXT_MAX_LEN = 1200

const OBJECT_FIELD_KEYS = ['summary', 'title', 'body', 'text', 'content', 'message'] as const

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[a-zA-Z0-9_-]{8,}\b/gi,
  /Bearer\s+\S+/gi,
  /Incorrect API key provided:\s*\S+/gi,
  /invalid x-api-key[^.\n]*/gi,
  /api[_-]?key[=:]\s*\S+/gi,
  /appid=[^&\s]+/gi,
  /\bkey=[^&\s]+/gi,
  /"authorization"\s*:\s*"[^"]+"/gi,
]

export const RESPONSE_FORMATTING_FALLBACK = 'Response formatting error — raw payload hidden.'

function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((out, pattern) => out.replace(pattern, '[redacted]'), text)
}

/**
 * Coerce council, news, and provider payloads to safe display text before `.replace()` or trim.
 */
export function toDisplayText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return redactSecrets(value.trim())
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const parts = value.map(item => toDisplayText(item)).filter(Boolean)
    if (!parts.length) return ''
    return parts.slice(0, 6).join(' · ')
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of OBJECT_FIELD_KEYS) {
      const field = record[key]
      if (typeof field === 'string' && field.trim()) return redactSecrets(field.trim())
    }
    try {
      const json = JSON.stringify(value)
      const capped =
        json.length > DISPLAY_TEXT_MAX_LEN
          ? `${json.slice(0, DISPLAY_TEXT_MAX_LEN - 1)}…`
          : json
      return redactSecrets(capped)
    } catch {
      return ''
    }
  }
  return ''
}

/** Run a string formatter safely; never throws and never leaks raw provider payloads. */
export function formatDisplayText(value: unknown, format: (text: string) => string): string {
  try {
    const text = toDisplayText(value)
    const out = format(text)
    return typeof out === 'string' ? out : RESPONSE_FORMATTING_FALLBACK
  } catch {
    return RESPONSE_FORMATTING_FALLBACK
  }
}

export function compactDisplayWhitespace(value: unknown, limit?: number): string {
  return formatDisplayText(value, text => {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (limit === undefined || clean.length <= limit) return clean
    return `${clean.slice(0, limit - 1)}…`
  })
}
