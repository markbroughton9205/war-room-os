import { assertAutoOrApproval } from '@/lib/permissions/policy'
import { emitEvent } from '@/lib/events/bus'
import { isWarRoomEventType, type WarRoomEventSource } from '@/lib/events/types'
import { fetchWarRoomPermissionsState } from '@/lib/war-room/permissionsState'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

const ACTION_KIND = 'audit_logging'

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    body = {}
  }

  const state = await fetchWarRoomPermissionsState(sup.ok ? sup.client : null)
  const gate = assertAutoOrApproval({
    mode: state.mode,
    safetyLock: state.safetyLock,
    actionKind: ACTION_KIND,
    body,
  })

  if (!gate.ok) {
    return jsonWithPersistence({ ok: false, skippedReason: 'forbidden', error: gate.error }, sup.ok, { status: gate.status })
  }

  const type = typeof body.type === 'string' ? body.type.trim() : ''
  if (!type || !isWarRoomEventType(type)) {
    return jsonWithPersistence({ ok: false, skippedReason: 'invalid_type', error: 'Unknown or missing event type.' }, sup.ok, { status: 400 })
  }

  const payload = body.payload && typeof body.payload === 'object' ? (body.payload as Record<string, unknown>) : {}
  const srcRaw = body.source
  const source: WarRoomEventSource =
    srcRaw === 'user' || srcRaw === 'worker' || srcRaw === 'system' ? srcRaw : 'user'
  const correlationId = typeof body.correlationId === 'string' ? body.correlationId : undefined

  const result = await emitEvent({
    supabase: sup.ok ? sup.client : null,
    type,
    payload,
    source,
    correlationId,
  })

  return jsonWithPersistence(
    {
      ok: true,
      persisted: result.persisted,
      auditWritten: result.auditWritten,
      event: result.event,
      skippedReason: result.persisted ? undefined : result.reason,
    },
    sup.ok,
    { status: 201 },
  )
}
