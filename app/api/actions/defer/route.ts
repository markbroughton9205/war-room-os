import { appendWarRoomActionLog } from '@/lib/war-room/actionLogs'
import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

const DEFERRABLE = new Set([
  'requested',
  'planned',
  'routed',
  'waiting_approval',
  'approved',
])

function mergePayload(
  existing: unknown,
  reason: string | undefined,
): Record<string, unknown> {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? { ...(existing as Record<string, unknown>) }
    : {}
  return {
    ...base,
    deferred: true,
    defer_reason: reason?.trim() || null,
    deferred_at: new Date().toISOString(),
  }
}

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ error: 'Supabase is not configured.' }, false, { status: 503 })
  }

  let body: { actionId?: string; reason?: string }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }

  const actionId = typeof body.actionId === 'string' ? body.actionId.trim() : ''
  if (!actionId) {
    return jsonWithPersistence({ error: 'actionId is required.' }, true, { status: 400 })
  }

  const reason = typeof body.reason === 'string' ? body.reason : undefined

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

  if (!DEFERRABLE.has(current.status)) {
    return jsonWithPersistence(
      { error: `Action cannot be deferred from status "${current.status}".` },
      true,
      { status: 409 },
    )
  }

  const nextPayload = mergePayload(current.payload, reason)

  const { data, error } = await sup.client
    .from('war_room_actions')
    .update({
      status: 'deferred',
      payload: nextPayload,
    })
    .eq('id', actionId)
    .select('id,conversation_id,status,type,payload,approval_granted,created_at,updated_at')
    .single()

  if (error) {
    return jsonWithPersistence({ error: error.message }, true, { status: 500 })
  }

  await appendWarRoomActionLog(sup.client, actionId, 'Deferred by operator.', 'warn', {
    reason: reason?.trim() || null,
  })

  await insertWarRoomAuditLog(sup.client, {
    actor: 'user',
    category: 'action',
    action_id: actionId,
    message: 'Action deferred (status deferred)',
    metadata: {
      type: current.type,
      previous_status: current.status,
      reason: reason?.trim() || null,
    },
  })

  return jsonWithPersistence({ action: data }, true)
}
