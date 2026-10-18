/**
 * Edge-safe local Commander session gate for middleware.
 * Does NOT open SQLite — full token verification remains in Node (store.verifySessionToken).
 * Middleware only allows loopback + well-formed session cookie/bearer presentation.
 * Trusted-desktop header presentation is a separate proof: Node still verifies the secret.
 */
import { isLoopbackRequestHost } from '@/lib/sovereign-runtime/loopback'
import {
  DESKTOP_TRUST_HEADER,
  DESKTOP_TRUST_MIN_LENGTH,
} from './desktopTrustShared'

export const LOCAL_SESSION_COOKIE = 'wr_local_session' as const
export { DESKTOP_TRUST_HEADER, TRUSTED_DESKTOP_MINT_PATH } from './desktopTrustShared'

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

/**
 * Edge presentation check only — does not compare the secret (Edge has no guaranteed
 * runtime env/file access). Node mint route performs the real match.
 * Host header alone is never enough; a well-formed desktop trust header is required.
 */
export function hasPresentedTrustedDesktopProof(input: {
  host: string | null | undefined
  trustHeader?: string | null
}): boolean {
  if (!isLoopbackRequestHost(input.host)) return false
  const presented = typeof input.trustHeader === 'string' ? input.trustHeader.trim() : ''
  return presented.length >= DESKTOP_TRUST_MIN_LENGTH
}

export function readDesktopTrustHeader(requestHeaders: {
  get(name: string): string | null
}): string | null {
  return requestHeaders.get(DESKTOP_TRUST_HEADER)
}
