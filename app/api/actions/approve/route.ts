import { appendWarRoomActionLog } from '@/lib/war-room/actionLogs'
import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { emitEvent } from '@/lib/events/bus'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ error: 'Supabase is not configured.' }, false, { status: 503 })
  }

  let body: { actionId?: string; approval_granted?: boolean }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }

  const actionId = typeof body.actionId === 'string' ? body.actionId.trim() : ''
  if (!actionId) {
    return jsonWithPersistence({ error: 'actionId is required.' }, true, { status: 400 })
  }

  if (body.approval_granted !== true) {
    return jsonWithPersistence(
      { error: 'Explicit approval requires approval_granted: true.' },
      true,
      { status: 400 },
    )
  }

  const { data: current, error: fetchErr } = await sup.client
    .from('war_room_actions')
    .select('id,status,type,payload,approval_granted,conversation_id')
    .eq('id', actionId)
    .maybeSingle()

  if (fetchErr) {
    return jsonWithPersistence({ error: fetchErr.message }, true, { status: 500 })
  }
  if (!current) {
    return jsonWithPersistence({ error: 'Action not found.' }, true, { status: 404 })
  }

  if (current.status !== 'waiting_approval') {
    return jsonWithPersistence(
      {
        error: `Action is not awaiting approval (current status: ${current.status}).`,
      },
      true,
      { status: 409 },
    )
  }

  const { data, error } = await sup.client
    .from('war_room_actions')
    .update({
      status: 'approved',
      approval_granted: true,
    })
    .eq('id', actionId)
    .select('id,conversation_id,status,type,payload,approval_granted,created_at,updated_at')
    .single()

  if (error) {
    return jsonWithPersistence({ error: error.message }, true, { status: 500 })
  }

  await appendWarRoomActionLog(sup.client, actionId, 'Approved by operator.', 'info', {
    previous_status: current.status,
  })

  await insertWarRoomAuditLog(sup.client, {
    actor: 'user',
    category: 'action',
    action_id: actionId,
    message: 'Action approved',
    metadata: { type: current.type, previous_status: current.status },
  })

  await emitEvent({
    supabase: sup.client,
    type: 'action.approved',
    source: 'user',
    correlationId: actionId,
    payload: {
      actionId,
      type: current.type,
      previous_status: current.status,
    },
  })

  return jsonWithPersistence({ action: data }, true)
}
