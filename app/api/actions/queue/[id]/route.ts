import { appendWarRoomActionLog } from '@/lib/war-room/actionLogs'
import { APPROVAL_REQUIRED_STATUSES, isWarRoomActionStatus } from '@/lib/war-room/actionStatuses'
import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { jsonWithPersistence, tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'
import {
  httpStatusForSupabaseFailure,
  warRoomSupabaseFailurePayload,
} from '@/lib/war-room/warRoomSupabaseError'

export const dynamic = 'force-dynamic'

const TABLE_ACTIONS = 'war_room_actions'

function auditQueuePatchFailureFireAndForget(
  client: WarRoomSupabase | null,
  message: string,
  metadata: Record<string, unknown>,
) {
  void insertWarRoomAuditLog(client, {
    actor: 'system',
    category: 'action',
    message,
    metadata,
  }).catch(() => {
    /* never block response */
  })
}

function auditQueueSentinelMisleadingSuccessFireAndForget(
  client: WarRoomSupabase | null,
  op: string,
  metadata: Record<string, unknown>,
) {
  void insertWarRoomAuditLog(client, {
    actor: 'system',
    category: 'sentinel',
    message: `Action queue ${op} did not persist — require persisted:true before claiming queue state updated.`,
    metadata: { ...metadata, guard: 'queue_misleading_success_prevention' },
  }).catch(() => {
    /* never block response */
  })
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence(
      { error: sup.configError, persisted: false, queued: false },
      false,
      { status: 503 },
    )
  }

  const { id } = await context.params
  if (!id) {
    return jsonWithPersistence(
      { error: 'id required', persisted: false, queued: false },
      true,
      { status: 400 },
    )
  }

  let body: { status?: string; approval_granted?: boolean; payload?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence(
      { error: 'Invalid JSON body.', persisted: false, queued: false },
      true,
      { status: 400 },
    )
  }

  const nextStatus = typeof body.status === 'string' ? body.status : ''
  if (!nextStatus || !isWarRoomActionStatus(nextStatus)) {
    return jsonWithPersistence(
      { error: 'Valid status is required.', persisted: false, queued: false },
      true,
      { status: 400 },
    )
  }

  if (APPROVAL_REQUIRED_STATUSES.includes(nextStatus) && body.approval_granted !== true) {
    return jsonWithPersistence(
      {
        error: `Transition to "${nextStatus}" requires approval_granted: true in this PATCH (executor is approval-gated; no autonomous execution).`,
        persisted: false,
        queued: false,
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
    .from(TABLE_ACTIONS)
    .update(updates)
    .eq('id', id)
    .select('id,conversation_id,status,type,payload,approval_granted,created_at,updated_at')
    .maybeSingle()

  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_ACTIONS, error)
    auditQueuePatchFailureFireAndForget(sup.client, 'war_room_actions queue PATCH update failed', { supabase })
    auditQueueSentinelMisleadingSuccessFireAndForget(sup.client, 'PATCH (update)', { supabase })
    return jsonWithPersistence(
      { error: supabase.message, supabase, persisted: false, queued: false },
      true,
      { status: httpStatusForSupabaseFailure(supabase, 500) },
    )
  }
  if (!data) {
    return jsonWithPersistence(
      { error: 'Not found', persisted: false, queued: false },
      true,
      { status: 404 },
    )
  }

  try {
    await appendWarRoomActionLog(sup.client, id, `Status -> ${nextStatus}`, 'info', {
      approval_granted: data.approval_granted,
    })
  } catch (logErr) {
    console.error('[war-room] appendWarRoomActionLog after PATCH failed:', logErr)
  }

  return jsonWithPersistence({ persisted: true, action: data }, true)
}
