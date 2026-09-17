import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import {
  applyLocalSessionCookie,
  assertLocalMutationOrigin,
  assertLocalOnlyRequest,
  getLocalOwnershipStore,
} from '@/lib/sovereign-runtime/local-ownership'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Explicit first-run local Commander bootstrap — loopback only. */
export async function POST(req: Request) {
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
  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 })
  }

  const boot = store.bootstrapCommander({
    password: typeof body.password === 'string' ? body.password : '',
    displayName: typeof body.display_name === 'string' ? body.display_name : undefined,
  })
  if (!boot.ok) return NextResponse.json(boot, { status: 400 })

  const login = store.login(typeof body.password === 'string' ? body.password : '')
  if (!login.ok) return NextResponse.json({ ok: false, error: login.reason }, { status: 500 })

  const res = NextResponse.json({
    ok: true,
    identity: login.auth.identity,
    session_id: login.auth.session.session_id,
  })
  applyLocalSessionCookie(res, login.auth.token)
  return res
}
