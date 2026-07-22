import { appendWarRoomActionLog } from '@/lib/war-room/actionLogs'
import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

/**
 * Archive is for terminal/decision-complete actions only. 'approved' is included because
 * this schema has no separate "execution started" flag — 'executing' is the only status that
 * means execution is underway, so an 'approved' row is by definition pre-execution and safe to
 * shelve. Pre-decision states ('requested', 'planned', 'routed', 'waiting_approval') and
 * in-progress states ('executing', 'qa_check') are excluded: those must resolve via Approve,
 * Reject, or Defer before they can be archived.
 */
const ARCHIVABLE = new Set([
  'approved',
  'deferred',
  'completed',
  'failed',
  'rollback_available',
  'rolled_back',
])

function mergePayload(existing: unknown): Record<string, unknown> {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? { ...(existing as Record<string, unknown>) }
    : {}
  return {
    ...base,
    archived: true,
    archived_at: new Date().toISOString(),
  }
}

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ error: 'Supabase is not configured.' }, false, { status: 503 })
  }

  let body: { actionId?: string }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }

  const actionId = typeof body.actionId === 'string' ? body.actionId.trim() : ''
  if (!actionId) {
    return jsonWithPersistence({ error: 'actionId is required.' }, true, { status: 400 })
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

  if (current.status === 'archived') {
    return jsonWithPersistence(
      { error: 'Action is already archived.' },
      true,
      { status: 409 },
    )
  }

  if (!ARCHIVABLE.has(current.status)) {
    return jsonWithPersistence(
      { error: `Action cannot be archived from status "${current.status}".` },
      true,
      { status: 409 },
    )
  }

  const nextPayload = mergePayload(current.payload)

  const { data, error } = await sup.client
    .from('war_room_actions')
    .update({
      status: 'archived',
      payload: nextPayload,
    })
    .eq('id', actionId)
    .select('id,conversation_id,status,type,payload,approval_granted,created_at,updated_at')
    .single()

  if (error) {
    return jsonWithPersistence({ error: error.message }, true, { status: 500 })
  }

  await appendWarRoomActionLog(sup.client, actionId, 'Archived by operator.', 'info', {
    previous_status: current.status,
  })

  await insertWarRoomAuditLog(sup.client, {
    actor: 'user',
    category: 'action',
    action_id: actionId,
    message: 'Action archived (row preserved)',
    metadata: {
      type: current.type,
      previous_status: current.status,
    },
  })

  return jsonWithPersistence({ action: data }, true)
}
