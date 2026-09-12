/**
 * #22 Phase 14 — Commander or local-Commander session for integration workflows.
 */
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import {
  LOCAL_SESSION_COOKIE,
  assertLocalOnlyRequest,
  extractBearerOrCookieToken,
  getLocalOwnershipStore,
} from '@/lib/sovereign-runtime/local-ownership'

export type IntegrationCaller =
  | { ok: true; userId: string; surface: 'REMOTE_COMMANDER' | 'LOCAL_COMMANDER' }
  | { ok: false; response: NextResponse }

export async function requireIntegrationCaller(): Promise<IntegrationCaller> {
  const h = await headers()
  const host = h.get('host')
  const localGate = assertLocalOnlyRequest({ host, origin: h.get('origin') })
  if (localGate.ok) {
    const token = extractBearerOrCookieToken({
      authorization: h.get('authorization'),
      cookieHeader: h.get('cookie'),
      cookieName: LOCAL_SESSION_COOKIE,
    })
    const store = getLocalOwnershipStore(process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null)
    const auth = store.verifySessionToken(token)
    if (auth) {
      return { ok: true, userId: auth.identity.id, surface: 'LOCAL_COMMANDER' }
    }
  }

  const remote = await requireCommanderSession('ASCENSION_CROSS_AGENT_INTEGRATION')
  if (!remote.ok) return remote
  return { ok: true, userId: remote.userId, surface: 'REMOTE_COMMANDER' }
}
