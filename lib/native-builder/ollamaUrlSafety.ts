/**
 * Safe Ollama base URL for logs/UI — strips credentials; never throws.
 * Kept free of `server-only` so desktop Core packaging can bundle it.
 */
export function safeOllamaBaseUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`
  } catch {
    return 'ollama'
  }
}
