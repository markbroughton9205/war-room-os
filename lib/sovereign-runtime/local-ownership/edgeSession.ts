/**
 * Edge-safe local Commander session gate for middleware.
 * Does NOT open SQLite — full token verification remains in Node (store.verifySessionToken).
 * Middleware only allows loopback + well-formed session cookie/bearer presentation.
 */
import { isLoopbackRequestHost } from '@/lib/sovereign-runtime/loopback'

export const LOCAL_SESSION_COOKIE = 'wr_local_session' as const

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

/** Middleware gate: loopback + token shape. APIs still verify against SQLite. */
export function hasPresentedLocalCommanderSession(input: {
  host: string | null | undefined
  authorization?: string | null
  cookieHeader?: string | null
}): boolean {
  if (!isLoopbackRequestHost(input.host)) return false
  const token = extractBearerOrCookieToken({
    authorization: input.authorization,
    cookieHeader: input.cookieHeader,
    cookieName: LOCAL_SESSION_COOKIE,
  })
  return Boolean(token && token.length >= 20)
}
