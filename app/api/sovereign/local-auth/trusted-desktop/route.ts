import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { isSafeRedirectPath } from '@/lib/auth/redirect'
import {
  AUTH_MODE,
  applyLocalSessionCookie,
  assertLocalMutationOrigin,
  assertLocalOnlyRequest,
  getLocalOwnershipStore,
} from '@/lib/sovereign-runtime/local-ownership'
import { DESKTOP_TRUST_HEADER } from '@/lib/sovereign-runtime/local-ownership/desktopTrustShared'
import { verifyDesktopTrustProof } from '@/lib/sovereign-runtime/local-ownership/desktopTrust'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function safeNext(raw: string | null): string {
  if (raw && isSafeRedirectPath(raw)) return raw
  return '/'
}

async function mintTrustedDesktopSession(input: {
  method: string
  host: string | null
  origin: string | null
  referer: string | null
  trustHeader: string | null
}) {
  const only = assertLocalOnlyRequest({ host: input.host, origin: input.origin })
  if (!only.ok) return { ok: false as const, error: only.reason, code: only.code, status: 403 }
  if (input.method !== 'GET' && input.method !== 'HEAD') {
    const origin = assertLocalMutationOrigin({
      method: input.method,
      origin: input.origin,
      referer: input.referer,
      host: input.host,
    })
    if (!origin.ok) return { ok: false as const, error: origin.reason, code: origin.code, status: 403 }
  }
  const proof = verifyDesktopTrustProof({
    presentedHeader: input.trustHeader,
    dataDirOverride: process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null,
  })
  if (!proof.ok) return { ok: false as const, error: proof.reason, code: proof.code, status: 403 }

  const store = getLocalOwnershipStore(process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null)
  const minted = store.ensureTrustedDesktopCommander()
  if (!minted.ok) return { ok: false as const, error: minted.reason, code: minted.code, status: 500 }
  return {
    ok: true as const,
    auth: minted.auth,
    first_run: minted.first_run,
  }
}

/** Browser navigation from trusted desktop — Set-Cookie then redirect into War Room. */
export async function GET(req: Request) {
  const h = await headers()
  const url = new URL(req.url)
  const next = safeNext(url.searchParams.get('next'))
  const minted = await mintTrustedDesktopSession({
    method: 'GET',
    host: h.get('host'),
    origin: h.get('origin'),
    referer: h.get('referer'),
    trustHeader: h.get(DESKTOP_TRUST_HEADER),
  })
  if (!minted.ok) {
    const login = new URL('/login', req.url)
    if (next !== '/' && !next.startsWith('/login')) login.searchParams.set('next', next)
    return NextResponse.redirect(login)
  }
  const res = NextResponse.redirect(new URL(next, req.url))
  applyLocalSessionCookie(res, minted.auth.token)
  return res
}

/** Electron main mints a session token and applies wr_local_session itself. */
export async function POST() {
  const h = await headers()
  const minted = await mintTrustedDesktopSession({
    method: 'POST',
    host: h.get('host'),
    origin: h.get('origin'),
    referer: h.get('referer'),
    trustHeader: h.get(DESKTOP_TRUST_HEADER),
  })
  if (!minted.ok) {
    return NextResponse.json({ ok: false, error: minted.error, code: minted.code }, { status: minted.status })
  }
  const res = NextResponse.json({
    ok: true,
    identity: minted.auth.identity,
    session_id: minted.auth.session.session_id,
    session_token: minted.auth.token,
    first_run: minted.first_run,
    auth_mode: AUTH_MODE.LOCAL_COMMANDER_TRUSTED,
  })
  applyLocalSessionCookie(res, minted.auth.token)
  return res
}
