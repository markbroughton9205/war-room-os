import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { readCommanderIdentityConfig } from '@/lib/security/commanderIdentity'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  LOCAL_SESSION_COOKIE,
  assertLocalOnlyRequest,
  getLocalOwnershipStore,
} from '@/lib/sovereign-runtime/local-ownership'

export type CommanderSession =
  | {
      ok: true
      userId: string
    }
  | {
      ok: false
      response: NextResponse
    }

function isPackagedDesktopRuntime() {
  return process.env.WAR_ROOM_PACKAGED === '1' || process.env.WAR_ROOM_RUNTIME_SURFACE === 'DESKTOP_LOCAL'
}

function localSessionTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === LOCAL_SESSION_COOKIE) return decodeURIComponent(rest.join('=') || '')
  }
  return null
}

async function readPackagedDesktopCommander(): Promise<{ userId: string } | null> {
  if (!isPackagedDesktopRuntime()) return null
  const requestHeaders = await headers()
  const gate = assertLocalOnlyRequest({
    host: requestHeaders.get('host'),
    origin: requestHeaders.get('origin'),
  })
  if (!gate.ok) return null

  try {
    const sessionClient = await createSupabaseServerClient()
    const { data, error } = await sessionClient.auth.getUser()
    if (!error && data.user?.id) return { userId: data.user.id }
  } catch {
    /* packaged desktop may be offline-local */
  }

  try {
    const store = getLocalOwnershipStore(process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null)
    const auth = store.verifySessionToken(localSessionTokenFromCookieHeader(requestHeaders.get('cookie')))
    if (auth?.identity?.id) return { userId: auth.identity.id }
  } catch {
    /* local ownership store is optional for this fallback */
  }
  return null
}

export async function requireCommanderSession(actionLabel = 'War Room memory'): Promise<CommanderSession> {
  const commanderConfig = readCommanderIdentityConfig()
  if (!commanderConfig.ok) {
    const packaged = await readPackagedDesktopCommander()
    if (packaged) return { ok: true, userId: packaged.userId }
    if (isPackagedDesktopRuntime()) {
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

  if (!userId) {
    const packaged = await readPackagedDesktopCommander()
    if (packaged) return { ok: true, userId: packaged.userId }
    return {
      ok: false,
      response: NextResponse.json({ error: 'Authenticated Commander session required.' }, { status: 401 }),
    }
  }

  if (userId !== commanderConfig.commanderUserId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Commander session required.' }, { status: 403 }),
    }
  }

  return { ok: true, userId }
}
