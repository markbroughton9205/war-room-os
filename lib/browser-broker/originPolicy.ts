/**
 * Trusted-profile origin allow/deny. Unrelated domains are denied by default.
 */

export function hostnameOf(raw: string): string | null {
  try {
    const url = new URL(raw)
    return url.hostname.toLowerCase()
  } catch {
    const host = raw.replace(/^https?:\/\//i, '').split('/')[0]?.split(':')[0]
    return host ? host.toLowerCase() : null
  }
}

export function originPatternMatches(pattern: string, hostname: string): boolean {
  const raw = pattern.trim().toLowerCase()
  if (!raw) return false
  let host = raw
  try {
    if (/^https?:\/\//.test(raw)) host = new URL(raw).hostname.toLowerCase()
    else host = raw.replace(/^\*\./, '*.')
  } catch {
    host = raw
  }
  host = host.replace(/:\d+$/, '')
  const target = hostname.toLowerCase()
  if (host.startsWith('*.')) {
    const suffix = host.slice(2)
    return target === suffix || target.endsWith(`.${suffix}`)
  }
  return target === host
}

export function evaluateOriginAccess(input: {
  url: string
  allowed_origins: string[]
  denied_origins: string[]
}): { ok: true } | { ok: false; code: 'PROFILE_ORIGIN_NOT_ALLOWED' } {
  const hostname = hostnameOf(input.url)
  if (!hostname) return { ok: false, code: 'PROFILE_ORIGIN_NOT_ALLOWED' }
  if (input.denied_origins.some(pattern => originPatternMatches(pattern, hostname))) {
    return { ok: false, code: 'PROFILE_ORIGIN_NOT_ALLOWED' }
  }
  if (!input.allowed_origins.length) return { ok: false, code: 'PROFILE_ORIGIN_NOT_ALLOWED' }
  if (input.allowed_origins.some(pattern => originPatternMatches(pattern, hostname))) return { ok: true }
  return { ok: false, code: 'PROFILE_ORIGIN_NOT_ALLOWED' }
}
