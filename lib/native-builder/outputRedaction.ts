/**
 * Output redaction for the Native Code Operator's evidence plane. Command output, validation
 * stdout/stderr, and diff evidence can all contain secrets a tool printed to its own log (an API
 * key in a curl error, a token in a stack trace, a private key block in a config dump). Anything
 * this subsystem stores (NativeValidationResult, NativeDiffEvidence) or streams (command_output
 * envelopes) must pass through redactSecretsFromOutput() first — storage redaction is preferred
 * over display-time redaction so a secret never lands in .war-room/ persistence at all.
 *
 * Pattern set mirrors lib/research-engine/security/redact.ts's redactSecretsFromText() and
 * lib/war-room/repoAudit.ts's redact() (query-param secrets, Bearer tokens, key=value credentials)
 * and extends it with the classes those modules don't cover but build/test tooling routinely
 * prints: AWS access key ids, PEM private-key blocks, GitHub/npm/OpenAI-style token prefixes, and
 * password= assignments. The research-engine module itself is NOT imported here: it is marked
 * `import 'server-only'`, and additionally it strips stack frames and internal paths, which would
 * destroy the diagnostic value of validation output — this scanner redacts secrets only, never
 * file paths or stack frames.
 */

const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g
const AWS_ACCESS_KEY = /\b(AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g
const GITHUB_TOKEN = /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g
const OPENAI_STYLE_KEY = /\bsk-[A-Za-z0-9_-]{20,}\b/g
const SLACK_TOKEN = /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g
const BEARER = /Bearer\s+[A-Za-z0-9._~+\/-]{8,}/gi
// Value must be at least 8 non-delimiter chars: short type annotations in real source diffs
// (`password: string`) must survive redaction, or every diff touching a credential *field* (not a
// credential *value*) would be mangled. Real secrets are essentially never under 8 chars.
const SECRET_ASSIGNMENT = /((?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|secret|password|passwd|pwd|private[_-]?key|client[_-]?secret)\s*[=:]\s*["']?)([^\s,"';}{]{8,})/gi
const AUTHORIZATION_HEADER = /(Authorization["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{8,}/gi
const URL_QUERY_SECRET = /([?&](?:api_key|apikey|key|token|access_token|secret|webkey|password)=)[^&\s]+/gi
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g

export const REDACTED = '[REDACTED]'

/** Redacts secret-looking material from arbitrary command/validation/diff text. Pure, idempotent
 * (re-redacting already-redacted text is a no-op), and bounded only by the input's own size. */
export function redactSecretsFromOutput(text: string): string {
  if (!text) return text
  return text
    .replace(PRIVATE_KEY_BLOCK, '[REDACTED-PRIVATE-KEY-BLOCK]')
    .replace(AWS_ACCESS_KEY, REDACTED)
    .replace(GITHUB_TOKEN, REDACTED)
    .replace(OPENAI_STYLE_KEY, REDACTED)
    .replace(SLACK_TOKEN, REDACTED)
    .replace(JWT, REDACTED)
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(AUTHORIZATION_HEADER, `$1${REDACTED}`)
    .replace(URL_QUERY_SECRET, `$1${REDACTED}`)
    .replace(SECRET_ASSIGNMENT, `$1${REDACTED}`)
}

/** Deep-ish redactor for the structured values that accompany output (validation result records,
 * diff evidence) — strings are scanned, objects/arrays recursed one level at a time. */
export function redactOutputValue<T>(value: T): T {
  if (typeof value === 'string') return redactSecretsFromOutput(value) as T
  if (Array.isArray(value)) return value.map(redactOutputValue) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactOutputValue(v)])) as T
  }
  return value
}
