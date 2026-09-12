/**
 * #22 Phase 11C — Loopback / origin / CSRF gates for local-only auth routes.
 */
import { LOCAL_CORE_ORIGIN, LOCAL_UI_ORIGIN, PUBLIC_DOMAIN } from '@/lib/sovereign-runtime/constants'
import { isLoopbackRequestHost } from '@/lib/sovereign-runtime/session'

export function isSovereignLocalHost(host: string | null | undefined): boolean {
  return isLoopbackRequestHost(host)
}

export function isPublicWarRoomHost(host: string | null | undefined): boolean {
  if (!host) return false
  const h = host.split(':')[0]!.toLowerCase()
  return h === PUBLIC_DOMAIN || h === `www.${PUBLIC_DOMAIN}`
}

export function assertLocalOnlyRequest(input: {
  host: string | null | undefined
  origin?: string | null
}): { ok: true } | { ok: false; reason: string; code: string } {
  if (isPublicWarRoomHost(input.host)) {
    return { ok: false, reason: 'Local auth routes reject public host invocation.', code: 'PUBLIC_HOST_DENIED' }
  }
  if (!isSovereignLocalHost(input.host)) {
    return { ok: false, reason: 'Local auth requires loopback host.', code: 'NON_LOOPBACK_DENIED' }
  }
  return { ok: true }
}

const ALLOWED_ORIGINS = new Set([LOCAL_UI_ORIGIN, LOCAL_CORE_ORIGIN, 'http://localhost:3848', 'http://localhost:3847'])

/**
 * State-changing local routes require Origin (or same-host Referer) matching local origins.
 * Loopback alone is not sufficient against browser CSRF.
 */
export function assertLocalMutationOrigin(input: {
  method: string
  origin?: string | null
  referer?: string | null
  host?: string | null
}): { ok: true } | { ok: false; reason: string; code: string } {
  const method = input.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return { ok: true }

  const origin = input.origin?.trim() || null
  if (origin && ALLOWED_ORIGINS.has(origin)) return { ok: true }

  if (input.referer) {
    try {
      const u = new URL(input.referer)
      const refOrigin = `${u.protocol}//${u.host}`
      if (ALLOWED_ORIGINS.has(refOrigin)) return { ok: true }
      if (isLoopbackRequestHost(u.host) && (u.port === '3848' || u.port === '3847' || u.port === '')) {
        return { ok: true }
      }
    } catch {
      /* fall through */
    }
  }

  // Same-host requests without Origin (e.g. some native clients) allowed only on loopback host
  if (!origin && isSovereignLocalHost(input.host)) {
    return { ok: true }
  }

  return { ok: false, reason: 'CSRF/origin check failed for local mutation.', code: 'ORIGIN_DENIED' }
}

export function extractBearerOrCookieToken(input: {
  authorization?: string | null
  cookieHeader?: string | null
  cookieName: string
}): string | null {
  const auth = input.authorization?.trim()
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const t = auth.slice(7).trim()
    if (t) return t
  }
  const raw = input.cookieHeader || ''
  const parts = raw.split(';')
  for (const p of parts) {
    const [k, ...rest] = p.trim().split('=')
    if (k === input.cookieName) return decodeURIComponent(rest.join('=') || '')
  }
  return null
}
