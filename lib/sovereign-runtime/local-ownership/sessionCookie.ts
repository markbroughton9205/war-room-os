import { NextResponse } from 'next/server'
import { LOCAL_SESSION_COOKIE, LOCAL_SESSION_TTL_MS } from './types'

/** Host-only wr_local_session. Canonical UI host is 127.0.0.1 so localhost vs 127.0.0.1 cannot split the jar. */
export function applyLocalSessionCookie(response: NextResponse, token: string | null): void {
  if (token) {
    response.cookies.set({
      name: LOCAL_SESSION_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(LOCAL_SESSION_TTL_MS / 1000),
      secure: false,
    })
    return
  }
  response.cookies.set({
    name: LOCAL_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    secure: false,
  })
}

export function localSessionCookieAudit(): {
  name: typeof LOCAL_SESSION_COOKIE
  path: '/'
  httpOnly: true
  sameSite: 'lax'
  secure: false
  canonicalHost: '127.0.0.1'
} {
  return {
    name: LOCAL_SESSION_COOKIE,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    canonicalHost: '127.0.0.1',
  }
}
