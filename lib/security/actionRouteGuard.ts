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
    req.headers.get('x-war-room-action-secret')?.trim()
    ?? req.headers.get('WAR_ROOM_ACTION_SECRET')?.trim()
    ?? null
  if (fromNamedHeader) return fromNamedHeader
  return bearerCredential(req.headers.get('authorization'))
}

/**
 * Blocks action-triggering routes (permissions changes, SMS, and other
 * real-world-effect endpoints) unless the caller presents WAR_ROOM_ACTION_SECRET.
 * Never logs or echoes secrets. Enforced in every environment, including local
 * dev — unlike assertDebugRouteAuthorized, there is no NODE_ENV bypass, because
 * these routes have real side effects, not just introspection.
 *
 * Requires timing-safe match against header `x-war-room-action-secret`,
 * header `WAR_ROOM_ACTION_SECRET`, or `Authorization: Bearer <secret>`.
 */
export function assertActionRouteAuthorized(req: Request): NextResponse | null {
  const expected = process.env.WAR_ROOM_ACTION_SECRET?.trim()
  if (!expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provided = firstProvidedSecret(req)
  if (!provided || !timingSafeEqualUtf8(expected, provided)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
