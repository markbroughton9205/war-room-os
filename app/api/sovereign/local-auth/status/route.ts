import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import {
  LOCAL_SESSION_COOKIE,
  assertLocalOnlyRequest,
  getLocalOwnershipRuntimeTruth,
  getLocalOwnershipStore,
  localSessionCookieAudit,
  resolveLocalAppDataPaths,
} from '@/lib/sovereign-runtime/local-ownership'
import { existsSync } from 'node:fs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Local-only identity status. Rejects public hosts. */
export async function GET() {
  const h = await headers()
  const host = h.get('host')
  const gate = assertLocalOnlyRequest({ host, origin: h.get('origin') })
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.reason, code: gate.code }, { status: 403 })
  }

  const dataDirOverride = process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null
  const store = getLocalOwnershipStore(dataDirOverride)
  const paths = resolveLocalAppDataPaths(dataDirOverride)
  const token = (() => {
    const cookie = h.get('cookie') || ''
    for (const part of cookie.split(';')) {
      const [k, ...rest] = part.trim().split('=')
      if (k === LOCAL_SESSION_COOKIE) return decodeURIComponent(rest.join('=') || '')
    }
    const auth = h.get('authorization')
    if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
    return null
  })()
  const auth = store.verifySessionToken(token)
  const bootstrapped = store.hasLocalCommander()

  return NextResponse.json({
    ok: true,
    bootstrapped,
    authenticated: Boolean(auth),
    bootstrap_required: !bootstrapped,
    canonical_host: '127.0.0.1',
    cookie_policy: localSessionCookieAudit(),
    store: {
      source: dataDirOverride ? 'WAR_ROOM_LOCAL_DATA_DIR' : 'PLATFORM_DEFAULT',
      db_present: existsSync(paths.dbPath),
    },
    identity: auth?.identity ?? store.getCommanderPublic(),
    session: auth
      ? {
          session_id: auth.session.session_id,
          expires_at: auth.session.expires_at,
          owner_local_identity_id: auth.session.owner_local_identity_id,
        }
      : null,
    ownership_truth: getLocalOwnershipRuntimeTruth(),
    data_mode: store.getDataMode(false),
    recovery: 'NOT_IMPLEMENTED',
    remote: 'REMOTE_UNAVAILABLE',
    auth_mode: auth ? 'LOCAL_COMMANDER_SESSION' : 'NONE',
  })
}
