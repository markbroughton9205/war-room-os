import { redactText } from '@/lib/recursive-learning/ingestion/redact'

/**
 * Persisted engineering state must never contain credential-like strings, but a model-written file or a command output that merely LOOKS like a
 * credential (a test fixture such as token = "abcd1234efgh") must not abort real work. Everything that is appended to the durable log passes through
 * here: credential-like substrings are replaced with [REDACTED] (the log itself still refuses anything that slips through).
 */
export function deepRedact<T>(value: T): T {
  if (typeof value === 'string') return redactText(value) as unknown as T
  if (Array.isArray(value)) return value.map((v) => deepRedact(v)) as unknown as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, deepRedact(v)])) as T
  return value
}
