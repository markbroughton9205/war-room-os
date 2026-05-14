import { appendWarRoomActionLog } from '@/lib/war-room/actionLogs'
import { APPROVAL_REQUIRED_STATUSES, isWarRoomActionStatus } from '@/lib/war-room/actionStatuses'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ error: 'Supabase is not configured.' }, false, { status: 503 })
  }

  const { id } = await context.params
  if (!id) {
    return jsonWithPersistence({ error: 'id required' }, true, { status: 400 })
  }

  let body: { status?: string; approval_granted?: boolean; payload?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }

  const nextStatus = typeof body.status === 'string' ? body.status : ''
  if (!nextStatus || !isWarRoomActionStatus(nextStatus)) {
    return jsonWithPersistence({ error: 'Valid status is required.' }, true, { status: 400 })
  }

  if (APPROVAL_REQUIRED_STATUSES.includes(nextStatus) && body.approval_granted !== true) {
    return jsonWithPersistence(
      {
        error: `Transition to "${nextStatus}" requires approval_granted: true in this PATCH (executor is approval-gated; no autonomous execution).`,
      },
      true,
      { status: 403 },
    )
  }

  const updates: Record<string, unknown> = { status: nextStatus }
  if (body.approval_granted === true) {
    updates.approval_granted = true
  }
  if (body.payload && typeof body.payload === 'object') {
    updates.payload = body.payload
  }

  const { data, error } = await sup.client
    .from('war_room_actions')
    .update(updates)
    .eq('id', id)
    .select('id,conversation_id,status,type,payload,approval_granted,created_at,updated_at')
    .maybeSingle()

  if (error) {
    return jsonWithPersistence({ error: error.message }, true, { status: 500 })
  }
  if (!data) {
    return jsonWithPersistence({ error: 'Not found' }, true, { status: 404 })
  }

  await appendWarRoomActionLog(sup.client, id, `Status -> ${nextStatus}`, 'info', {
    approval_granted: data.approval_granted,
  })

  return jsonWithPersistence({ action: data }, true)
}
