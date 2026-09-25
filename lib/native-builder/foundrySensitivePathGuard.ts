/**
 * Advisory sensitive-path classification.
 * Pattern list adapted from kkkhs/ClawdCode SensitiveFileDetector
 * (MIT, commit 217a01369f9cb7d1ccc89c1fd9f50d6db2965b81, Copyright (c) 2026).
 * See docs/third-party/clawdcode.md.
 *
 * This is not a permission authority. Commander/Tool Broker remain controlling.
 */
export type FoundrySensitivityLevel = 'low' | 'medium' | 'high'

export type FoundrySensitivityResult = {
  sensitive: boolean
  level: FoundrySensitivityLevel | null
  reason: string | null
  refuseRead: boolean
}

const RULES: Array<{ pattern: RegExp; level: FoundrySensitivityLevel; reason: string; refuseRead: boolean }> = [
  { pattern: /(^|\/)\.env$/i, level: 'high', reason: 'Environment file may contain secrets.', refuseRead: true },
  { pattern: /(^|\/)\.env\.(local|development|production|test)$/i, level: 'high', reason: 'Environment file may contain secrets.', refuseRead: true },
  { pattern: /(^|\/)credentials?\.json$/i, level: 'high', reason: 'Credential file.', refuseRead: true },
  { pattern: /(^|\/)secrets?\.json$/i, level: 'high', reason: 'Secret store file.', refuseRead: true },
  { pattern: /\.(pem|key|p12|pfx)$/i, level: 'high', reason: 'Key or certificate file.', refuseRead: true },
  { pattern: /(^|\/)id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/i, level: 'high', reason: 'SSH key material.', refuseRead: true },
  { pattern: /(^|\/)\.npmrc$/i, level: 'high', reason: 'npmrc may contain tokens.', refuseRead: true },
  { pattern: /(^|\/)\.netrc$/i, level: 'high', reason: 'netrc may contain credentials.', refuseRead: true },
  { pattern: /(^|\/)(aws|gcloud|azure)[._-]?credentials/i, level: 'high', reason: 'Cloud credential file.', refuseRead: true },
  { pattern: /\.(log|sql)$/i, level: 'medium', reason: 'Log or database dump may contain sensitive data.', refuseRead: false },
  { pattern: /(^|\/)(config|settings)\.(ya?ml|json|toml)$/i, level: 'low', reason: 'Configuration file.', refuseRead: false },
]

const ALLOWLIST = [
  /(^|\/)\.env\.example$/i,
  /(^|\/)\.env\.sample$/i,
  /(^|\/)\.env\.template$/i,
]

export function classifyFoundrySensitivePath(relOrAbs: string): FoundrySensitivityResult {
  const path = relOrAbs.replace(/\\/g, '/')
  if (ALLOWLIST.some(pattern => pattern.test(path))) {
    return { sensitive: false, level: null, reason: null, refuseRead: false }
  }
  for (const rule of RULES) {
    if (rule.pattern.test(path)) {
      return {
        sensitive: true,
        level: rule.level,
        reason: rule.reason,
        refuseRead: rule.refuseRead,
      }
    }
  }
  return { sensitive: false, level: null, reason: null, refuseRead: false }
}

export function redactSecretLikeText(text: string): string {
  return text
    .replace(/(api[_-]?key|secret|password|token|bearer)\s*[:=]\s*['"]?[^\s'"]{8,}/gi, '$1=***REDACTED***')
    .replace(/\b(sk_live_|sk_test_|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9._-]{8,}/g, '[REDACTED_TOKEN]')
}
