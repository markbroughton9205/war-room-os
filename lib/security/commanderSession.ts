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

/**
 * Credential-free facts about the SAME verified local session the Commander gate just accepted (blueprint approval binding).
 * Never contains the cookie/bearer token, the identity object, the installation id or any secret.
 */
export type CommanderSessionFacts = {
  /** `lses_<32 hex>` session row id (NOT the cookie token). */
  sessionId: string
  /** Epoch ms the session was issued. */
  authenticatedAt: number
  /** Epoch ms the session expires. */
  expiresAt: number
  source: 'war-room.local-session'
}

export type CommanderSessionWithFacts =
  | { ok: true; userId: string; facts: CommanderSessionFacts | null }
  | { ok: false; response: NextResponse }

async function readLoopbackLocalCommander(): Promise<{ userId: string; facts: CommanderSessionFacts | null } | null> {
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
    if (!userId) return null
    const created = Date.parse(auth.session.created_at)
    const expires = Date.parse(auth.session.expires_at)
    // Facts come from the very session row verifySessionToken just validated: no gate/facts mismatch is possible.
    const facts: CommanderSessionFacts | null = Number.isFinite(created) && Number.isFinite(expires)
      ? { sessionId: auth.session.session_id, authenticatedAt: created, expiresAt: expires, source: 'war-room.local-session' }
      : null
    return { userId, facts }
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

/**
 * Commander gate + credential-free session facts, derived from ONE verified session. A remote (Supabase) Commander has no
 * session-row facts here, so `facts` is null and blueprint authority fails closed (AUTH_SOURCE_UNAVAILABLE) for that path.
 */
export async function requireCommanderSessionFacts(actionLabel = 'Blueprint'): Promise<CommanderSessionWithFacts> {
  const local = await readLoopbackLocalCommander()
  if (local) return { ok: true, userId: local.userId, facts: local.facts }
  const gate = await requireCommanderSession(actionLabel)
  if (!gate.ok) return gate
  return { ok: true, userId: gate.userId, facts: null }
}

/** Pure revocation/expiry probe for a local session id (no cookie, no last_seen write). False when unknown or the store is unavailable. */
export function isLocalCommanderSessionLive(sessionId: string): boolean {
  try {
    return getLocalOwnershipStore(process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null).sessionIsLive(sessionId)
  } catch {
    return false
  }
}
