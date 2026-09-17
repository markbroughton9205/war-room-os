import 'server-only'

const SECRET_QUERY_PARAM_NAMES = new Set([
  'api_key', 'apikey', 'key', 'token', 'access_token', 'subscription-key',
  'subscription_key', 'x-api-key', 'auth', 'authorization', 'secret', 'webkey',
  'client_secret', 'client_id',
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

const SECRET_ENV_NAMES = [
  'AISSTREAM_API_KEY',
  'BARENTSWATCH_CLIENT_SECRET',
  'BARENTSWATCH_CLIENT_ID',
  'OHGO_API_KEY',
  '511NY_API_KEY',
  'YOUTUBE_API_KEY',
] as const

function redactConfiguredEnvValues(text: string): string {
  let out = text
  for (const name of SECRET_ENV_NAMES) {
    const value = process.env[name]?.trim() ?? ''
    if (value.length < 8) continue
    out = out.split(value).join('[redacted-env]')
    out = out.split(encodeURIComponent(value)).join('[redacted-env]')
  }
  return out
}

/**
 * Best-effort scrub of stray secret-looking substrings from free-text error
 * messages, plus internal stack-frame/file-path fragments a raw Error.message
 * or Error.stack could otherwise leak into a user-visible ResearchProviderError
 * (see diagnostics/validation.ts's safe-error-path check).
 */
export function redactSecretsFromText(text: string): string {
  return redactConfiguredEnvValues(text)
    .replace(/([?&](?:api_key|apikey|key|token|access_token|secret|webkey|client_secret)=)[^&\s]+/gi, '$1REDACTED')
    .replace(/((?:client_secret|APIKey|apiKey|api_key)\s*[:=]\s*["']?)[^"'&\s,]+/gi, '$1REDACTED')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1REDACTED')
    .replace(/(Authorization["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{8,}/gi, '$1REDACTED')
    .replace(/(?:[A-Za-z]:\\|\.{0,2}\/)[^\s()<>"']*\.(?:ts|tsx|js|jsx|mjs|cjs)(?::\d+(?::\d+)?)?/g, '[internal-path-redacted]')
    .replace(/\bat\s+[\w.$<>[\]]+\s*\([^)]*\)/g, '[stack-frame-redacted]')
}
