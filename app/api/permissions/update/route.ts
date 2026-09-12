import { isStandingPermissionMode, type StandingPermissionMode } from '@/lib/permissions/standingPermissions'
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import { assertLiveActionsAllowed } from '@/lib/security/actionRoutePolicy'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { buildGovernedAuditMetadata, insertGovernedAuditLog } from '@/lib/war-room/governedAudit'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { upsertWarRoomPermissionsState } from '@/lib/war-room/permissionsState'

export const dynamic = 'force-dynamic'

/**
 * #22 Phase 1 — policy_change is COMMANDER_ONLY.
 * Session cookie alone is insufficient; Commander identity + live-actions gate required.
 */
export async function POST(req: Request) {
  const liveGate = assertLiveActionsAllowed()
  if (liveGate) return liveGate

  const session = await requireCommanderSession('Standing permissions update')
  if (!session.ok) return session.response

  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    const headers = new Headers()
    headers.set('x-war-room-persistence', 'unavailable')
    return Response.json(
      {
        ok: false,
        error: 'Supabase is not configured; standing permissions cannot be persisted.',
      },
      { status: 503, headers },
    )
  }

  let body: { mode?: string; safetyLock?: boolean; approval_granted?: boolean }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ ok: false, error: 'Invalid JSON body.' }, true, { status: 400 })
  }

  const decision = evaluateGovernedAction({
    mode: 'commander',
    safetyLock: true,
    actionKind: 'policy_change',
    body: body as Record<string, unknown>,
    commanderSessionOk: true,
    requestingActorId: session.userId,
    approvingActorId: 'commander',
    technicalReach: 'WRITE_BOUNDED',
  })

  if (decision.outcome !== 'ALLOW') {
    await insertGovernedAuditLog(sup.client, {
      actor: 'user',
      category: 'permissions',
      message: 'Standing permissions update denied by governance.',
      metadata: buildGovernedAuditMetadata({
        decision,
        requestedBy: session.userId,
        actorAgent: 'commander',
        tool: 'api/permissions/update',
        target: 'war_room_permissions_state',
        ownerUserId: session.userId,
        approvedBy: 'commander',
      }),
    })
    return jsonWithPersistence(
      { ok: false, error: decision.reason, reasonCode: decision.reasonCode, policyDecision: decision.outcome },
      true,
      { status: decision.httpStatus },
    )
  }

  const patch: { mode?: StandingPermissionMode; safetyLock?: boolean } = {}
  if (body.mode !== undefined) {
    if (typeof body.mode !== 'string' || !isStandingPermissionMode(body.mode)) {
      return jsonWithPersistence({ ok: false, error: 'mode must be manual, operator, or commander.' }, true, { status: 400 })
    }
    patch.mode = body.mode
  }
  if (body.safetyLock !== undefined) {
    if (typeof body.safetyLock !== 'boolean') {
      return jsonWithPersistence({ ok: false, error: 'safetyLock must be a boolean.' }, true, { status: 400 })
    }
    patch.safetyLock = body.safetyLock
  }

  if (patch.mode === undefined && patch.safetyLock === undefined) {
    return jsonWithPersistence({ ok: false, error: 'Provide mode and/or safetyLock.' }, true, { status: 400 })
  }

  const next = await upsertWarRoomPermissionsState(sup.client, patch)

  await insertGovernedAuditLog(sup.client, {
    actor: 'user',
    category: 'permissions',
    message: 'Standing permissions updated under Commander governance.',
    metadata: buildGovernedAuditMetadata({
      decision,
      requestedBy: session.userId,
      actorAgent: 'commander',
      tool: 'api/permissions/update',
      target: 'war_room_permissions_state',
      ownerUserId: session.userId,
      approvedBy: 'commander',
      approvedAt: new Date().toISOString(),
      executionResult: 'executed',
    }),
    extra: {
      mode: next.mode,
      safetyLock: next.safetyLock,
      patch,
    },
  })

  return jsonWithPersistence({ ok: true, mode: next.mode, safetyLock: next.safetyLock }, true)
}
