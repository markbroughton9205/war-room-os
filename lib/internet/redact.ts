/** Best-effort redaction for persisted internet query text (never store API keys). */
export function redactInternetQuery(input: string, maxLen = 2000): string {
  let s = input.slice(0, maxLen)
  s = s.replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
  s = s.replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, '$1=[redacted]')
  s = s.replace(/\bx-goog-api-key\s*:\s*\S+/gi, 'x-goog-api-key: [redacted]')
  return s
}
