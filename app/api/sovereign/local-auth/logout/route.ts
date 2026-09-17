import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import {
  applyLocalSessionCookie,
  assertLocalMutationOrigin,
  assertLocalOnlyRequest,
  extractBearerOrCookieToken,
  getLocalOwnershipStore,
  LOCAL_SESSION_COOKIE,
} from '@/lib/sovereign-runtime/local-ownership'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Local logout — does not sign out remote Supabase session. */
export async function POST() {
  const h = await headers()
  const host = h.get('host')
  const only = assertLocalOnlyRequest({ host, origin: h.get('origin') })
  if (!only.ok) return NextResponse.json({ ok: false, error: only.reason, code: only.code }, { status: 403 })
  const origin = assertLocalMutationOrigin({
    method: 'POST',
    origin: h.get('origin'),
    referer: h.get('referer'),
    host,
  })
  if (!origin.ok) return NextResponse.json({ ok: false, error: origin.reason, code: origin.code }, { status: 403 })

  const store = getLocalOwnershipStore(process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null)
  const token = extractBearerOrCookieToken({
    authorization: h.get('authorization'),
    cookieHeader: h.get('cookie'),
    cookieName: LOCAL_SESSION_COOKIE,
  })
  store.logout(token)
  const res = NextResponse.json({ ok: true })
  applyLocalSessionCookie(res, null)
  return res
}
