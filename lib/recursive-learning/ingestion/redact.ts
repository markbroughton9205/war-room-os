/** Secret hygiene for ingestion. Adapters copy identifiers and enumerations only; this is the last line of defence. */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bxai-[A-Za-z0-9]{16,}/,
  /\bAIza[0-9A-Za-z_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:api[_-]?key|secret|token|password|service[_-]?role[_-]?key)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}/i,
]

export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text))
}

export function redactText(text: string): string {
  return SECRET_PATTERNS.reduce((acc, re) => acc.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), '[REDACTED]'), text)
}

/** True if any string anywhere inside the value looks like a credential. */
export function valueContainsSecret(value: unknown): boolean {
  if (typeof value === 'string') return containsSecret(value)
  if (Array.isArray(value)) return value.some(valueContainsSecret)
  if (value && typeof value === 'object') return Object.values(value).some(valueContainsSecret)
  return false
}
