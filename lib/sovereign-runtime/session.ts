/**
 * #22 Phase 10 — Local desktop session + ownership boundary.
 * Does NOT bypass #19. Does NOT fake offline Supabase Commander auth.
 */
import { createHash, randomBytes } from 'node:crypto'
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'

export { isLoopbackRequestHost } from '@/lib/sovereign-runtime/loopback'

export type LocalDesktopSession = {
  session_id: string
  created_at: string
  scope: 'LOOPBACK_DESKTOP'
  owner_user_id: string | null
  commander_verified: false | true
  supabase_session: 'REQUIRED_FOR_PRIVILEGED_APIS' | 'ABSENT'
  notes: string[]
}

export function mintLocalDesktopSession(input?: {
  ownerUserId?: string | null
  commanderVerified?: boolean
  hasSupabaseSession?: boolean
}): LocalDesktopSession {
  const hasSupabase = input?.hasSupabaseSession === true
  const commanderVerified = input?.commanderVerified === true && hasSupabase
  return {
    session_id: `lds_${randomBytes(16).toString('hex')}`,
    created_at: new Date().toISOString(),
    scope: 'LOOPBACK_DESKTOP',
    owner_user_id: input?.ownerUserId ?? null,
    commander_verified: commanderVerified,
    supabase_session: hasSupabase ? 'REQUIRED_FOR_PRIVILEGED_APIS' : 'ABSENT',
    notes: [
      'Local desktop session is loopback-scoped foundation identity.',
      'Privileged conversation/ownership APIs still require real Commander Supabase session (#19).',
      'Service role does not become Commander.',
      'Offline ownership is not fabricated.',
    ],
  }
}

export function assertLocalSessionOwnerMatch(
  sessionOwner: string | null | undefined,
  resourceOwner: string | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!sessionOwner || !resourceOwner) {
    return { ok: false, reason: 'Owner missing — fail closed.' }
  }
  if (sessionOwner !== resourceOwner) {
    return { ok: false, reason: 'Cross-user access denied.' }
  }
  return { ok: true }
}

export function assertServiceRoleIsNotCommander(): {
  ok: false
  reason: string
} {
  const probe = evaluateGovernedAction({
    mode: 'commander',
    safetyLock: true,
    actionKind: 'MISSION_EXECUTION',
    body: {},
    commanderSessionOk: false,
    requestingActorId: 'service_role',
    approvingActorId: 'service_role',
  })
  return {
    ok: false,
    reason: `Technical role actor is not Commander (policy=${probe.reasonCode}).`,
  }
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

