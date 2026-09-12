/**
 * #22 Phase 11B — Endpoint allowlist / SSRF guard for local model runtimes.
 * Default: loopback only. No metadata endpoints. No arbitrary URL probing.
 */
const BLOCKED_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata',
])

export function classifyLocalModelEndpoint(raw: string | null | undefined): {
  ok: boolean
  class: 'LOOPBACK' | 'DENIED' | 'UNTRUSTED'
  normalized: string | null
  reason: string
} {
  if (!raw || !String(raw).trim()) {
    return { ok: false, class: 'DENIED', normalized: null, reason: 'Endpoint not configured.' }
  }
  let url: URL
  try {
    url = new URL(String(raw).trim())
  } catch {
    return { ok: false, class: 'DENIED', normalized: null, reason: 'Malformed endpoint URL.' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, class: 'DENIED', normalized: null, reason: `Protocol ${url.protocol} denied.` }
  }
  const host = url.hostname.toLowerCase()
  if (BLOCKED_HOSTS.has(host) || host.startsWith('169.254.')) {
    return { ok: false, class: 'DENIED', normalized: null, reason: `Blocked host ${host} (SSRF-sensitive).` }
  }
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
    const port = url.port ? `:${url.port}` : ''
    const hostOut = host === '::1' ? '[::1]' : host
    return {
      ok: true,
      class: 'LOOPBACK',
      normalized: `${url.protocol}//${hostOut}${port}`,
      reason: 'Loopback local model endpoint.',
    }
  }
  return {
    ok: false,
    class: 'DENIED',
    normalized: null,
    reason: 'Non-loopback model endpoints are not enabled by default (Nebula-local first).',
  }
}

export function assertEndpointAllowedForLocalModel(raw: string): {
  allowed: true
  normalized: string
} | { allowed: false; reason: string } {
  const c = classifyLocalModelEndpoint(raw)
  if (!c.ok || !c.normalized) return { allowed: false, reason: c.reason }
  return { allowed: true, normalized: c.normalized }
}
