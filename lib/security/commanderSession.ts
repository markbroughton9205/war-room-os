import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { readCommanderIdentityConfig } from '@/lib/security/commanderIdentity'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  LOCAL_SESSION_COOKIE,
  assertLocalOnlyRequest,
  extractBearerOrCookieToken,
  getLocalOwnershipStore,
} from '@/lib/sovereign-runtime/local-ownership'
import { isLocalDesktopCommanderRuntime, resolveLocalCommanderUserId } from '@/lib/security/commanderSessionPolicy'

export type CommanderSession =
  | {
      ok: true
      userId: string
    }
  | {
      ok: false
      response: NextResponse
    }

export { isLocalDesktopCommanderRuntime, resolveLocalCommanderUserId } from '@/lib/security/commanderSessionPolicy'

async function readLoopbackLocalCommander(): Promise<{ userId: string } | null> {
  const requestHeaders = await headers()
  const gate = assertLocalOnlyRequest({
    host: requestHeaders.get('host'),
    origin: requestHeaders.get('origin'),
  })
  if (!gate.ok) return null

  const token = extractBearerOrCookieToken({
    authorization: requestHeaders.get('authorization'),
    cookieHeader: requestHeaders.get('cookie'),
    cookieName: LOCAL_SESSION_COOKIE,
  })
  if (!token) return null

  try {
    const store = getLocalOwnershipStore(process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null)
    const auth = store.verifySessionToken(token)
    if (!auth?.identity?.id) return null
    const commanderConfig = readCommanderIdentityConfig()
    const userId = resolveLocalCommanderUserId({
      loopbackOk: true,
      localIdentityId: auth.identity.id,
      linkedRemoteUserId: auth.identity.linked_remote_user_id,
      configuredCommanderUserId: commanderConfig.ok ? commanderConfig.commanderUserId : null,
    })
    return userId ? { userId } : null
  } catch {
    return null
  }
}

export async function requireCommanderSession(actionLabel = 'War Room memory'): Promise<CommanderSession> {
  // Loopback wr_local_session is the Commander for this installation. Evaluate it before
  // Supabase so a leftover remote cookie cannot 403 Terra after a valid local login.
  const local = await readLoopbackLocalCommander()
  if (local) return { ok: true, userId: local.userId }

  const commanderConfig = readCommanderIdentityConfig()
  if (!commanderConfig.ok) {
    if (isLocalDesktopCommanderRuntime()) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Authenticated Commander session required.' }, { status: 401 }),
      }
    }
    return {
      ok: false,
      response: NextResponse.json({
        error: `${actionLabel} is unavailable because Commander identity is not configured.`,
      }, { status: 503 }),
    }
  }

  let userId: string | null = null
  try {
    const sessionClient = await createSupabaseServerClient()
    const { data, error } = await sessionClient.auth.getUser()
    if (!error && data.user?.id) userId = data.user.id
  } catch {
    userId = null
  }

  if (userId === commanderConfig.commanderUserId) {
    return { ok: true, userId }
  }

  if (userId && userId !== commanderConfig.commanderUserId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Commander session required.' }, { status: 403 }),
    }
  }

  return {
    ok: false,
    response: NextResponse.json({ error: 'Authenticated Commander session required.' }, { status: 401 }),
  }
}
