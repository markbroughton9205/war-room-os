import 'server-only'

const SECRET_QUERY_PARAM_NAMES = new Set([
  'api_key', 'apikey', 'key', 'token', 'access_token', 'subscription-key',
  'subscription_key', 'x-api-key', 'auth', 'authorization', 'secret', 'webkey',
])

/** Strips known secret-bearing query parameters from a URL before it is ever logged or included in an error. */
export function redactUrlForLogging(url: string): string {
  try {
    const parsed = new URL(url)
    for (const name of Array.from(parsed.searchParams.keys())) {
      if (SECRET_QUERY_PARAM_NAMES.has(name.toLowerCase())) {
        parsed.searchParams.set(name, 'REDACTED')
      }
    }
    return parsed.toString()
  } catch {
    return '[unparseable-url]'
  }
}

/**
 * Best-effort scrub of stray secret-looking substrings from free-text error
 * messages, plus internal stack-frame/file-path fragments a raw Error.message
 * or Error.stack could otherwise leak into a user-visible ResearchProviderError
 * (see diagnostics/validation.ts's safe-error-path check).
 */
export function redactSecretsFromText(text: string): string {
  return text
    .replace(/([?&](?:api_key|apikey|key|token|access_token|secret|webkey)=)[^&\s]+/gi, '$1REDACTED')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1REDACTED')
    .replace(/(Authorization["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{8,}/gi, '$1REDACTED')
    .replace(/(?:[A-Za-z]:\\|\.{0,2}\/)[^\s()<>"']*\.(?:ts|tsx|js|jsx|mjs|cjs)(?::\d+(?::\d+)?)?/g, '[internal-path-redacted]')
    .replace(/\bat\s+[\w.$<>[\]]+\s*\([^)]*\)/g, '[stack-frame-redacted]')
}
