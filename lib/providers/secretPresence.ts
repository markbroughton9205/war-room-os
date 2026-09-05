/**
 * Credential presence without treating placeholders as configured keys.
 * Never logs or returns secret values.
 */

const SENTINEL_EXACT = new Set([
  '[SENSITIVE]',
  '[REDACTED]',
  '[redacted]',
  '<REDACTED>',
  'changeme',
  'placeholder',
  'your-api-key',
  'not-set',
  'todo',
  'xxx',
  'paste-key-here',
])

export function hasUsableProviderSecret(value: string | undefined | null): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (SENTINEL_EXACT.has(trimmed) || SENTINEL_EXACT.has(trimmed.toLowerCase())) return false
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('<your_') || lower.startsWith('<your-') || lower.startsWith('<your ')) return false
  if (lower.includes('your_openai') || lower.includes('your_anthropic')) return false
  return true
}

export function envHasUsableProviderSecret(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return hasUsableProviderSecret(env[name])
}
