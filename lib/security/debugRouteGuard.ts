import { timingSafeEqual } from 'node:crypto'

import { NextResponse } from 'next/server'

function timingSafeEqualUtf8(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'utf8')
    const bb = Buffer.from(b, 'utf8')
    if (ba.length !== bb.length) return false
    return timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

function bearerCredential(authorization: string | null): string | null {
  if (!authorization) return null
  const m = /^Bearer\s+(\S+)/i.exec(authorization.trim())
  return m?.[1]?.trim() ?? null
}

function firstProvidedSecret(req: Request): string | null {
  const fromNamedHeader =
    req.headers.get('x-war-room-debug-secret')?.trim()
    ?? req.headers.get('WAR_ROOM_DEBUG_SECRET')?.trim()
    ?? null
  if (fromNamedHeader) return fromNamedHeader
  return bearerCredential(req.headers.get('authorization'))
}

/**
 * Blocks `/api/debug/*` on production hosts unless explicitly unlocked.
 * Never logs or echoes secrets.
 *
 * Dev (`NODE_ENV !== 'production'`): always allows.
 *
 * Production:
 * - Requires non-empty `WAR_ROOM_DEBUG_SECRET`.
 * - Requires timing-safe match against header `x-war-room-debug-secret`,
 *   header `WAR_ROOM_DEBUG_SECRET`, or `Authorization: Bearer <secret>`.
 * - Setting `DEBUG_ROUTES_ENABLED=true` is recommended when enabling these routes in
 *   production (same secret header rules apply; the flag documents intent only).
 */
export function assertDebugRouteAuthorized(req: Request): NextResponse | null {
  if (process.env.NODE_ENV !== 'production') return null

  const obscured = NextResponse.json({ error: 'Not found' }, { status: 404 })

  const expected = process.env.WAR_ROOM_DEBUG_SECRET?.trim()
  if (!expected) {
    return obscured
  }

  const provided = firstProvidedSecret(req)
  if (!provided || !timingSafeEqualUtf8(expected, provided)) {
    return obscured
  }

  return null
}
