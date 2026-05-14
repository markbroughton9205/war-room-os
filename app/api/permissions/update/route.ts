import { isStandingPermissionMode, type StandingPermissionMode } from '@/lib/permissions/standingPermissions'
import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { upsertWarRoomPermissionsState } from '@/lib/war-room/permissionsState'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
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

  let body: { mode?: string; safetyLock?: boolean }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ ok: false, error: 'Invalid JSON body.' }, true, { status: 400 })
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

  await insertWarRoomAuditLog(sup.client, {
    actor: 'user',
    category: 'permissions',
    message: 'Standing permissions updated.',
    metadata: {
      mode: next.mode,
      safetyLock: next.safetyLock,
      patch,
    },
  })

  return jsonWithPersistence({ ok: true, mode: next.mode, safetyLock: next.safetyLock }, true)
}
