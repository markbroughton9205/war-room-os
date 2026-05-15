import { appendWarRoomActionLog } from '@/lib/war-room/actionLogs'
import { isWarRoomActionStatus } from '@/lib/war-room/actionStatuses'
import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { jsonWithPersistence, tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'
import {
  httpStatusForSupabaseFailure,
  warRoomSupabaseFailurePayload,
} from '@/lib/war-room/warRoomSupabaseError'

import {
  isWarRoomActionQueueSessionOnlyFallbackEnabled,
  WAR_ROOM_ACTION_QUEUE_SESSION_ONLY_FALLBACK_ENV,
} from './sessionOnlyFallback'

export const dynamic = 'force-dynamic'

const TABLE_ACTIONS = 'war_room_actions'
const TABLE_CONVERSATIONS = 'war_room_conversations'

function auditQueueFailureFireAndForget(
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

/** Sentinel: queue write failed — surfaces must not claim queued without `persisted: true`. */
function auditQueueSentinelMisleadingSuccessFireAndForget(
  client: WarRoomSupabase | null,
  op: string,
  metadata: Record<string, unknown>,
) {
  void insertWarRoomAuditLog(client, {
    actor: 'system',
    category: 'sentinel',
    message: `Action queue ${op} did not persist — require HTTP 201 and persisted:true before claiming an approval task was queued.`,
    metadata: { ...metadata, guard: 'queue_misleading_success_prevention' },
  }).catch(() => {
    /* never block response */
  })
}

export async function GET(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ actions: [], persisted: false }, false)
  }

  const url = new URL(req.url)
  const conversationId = url.searchParams.get('conversationId')

  let q = sup.client
    .from(TABLE_ACTIONS)
    .select('id,conversation_id,status,type,payload,approval_granted,created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (conversationId) {
    q = q.eq('conversation_id', conversationId)
  }

  const { data, error } = await q

  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_ACTIONS, error, { operation: 'select' })
    auditQueueFailureFireAndForget(sup.client, 'war_room_actions queue GET failed', { supabase })
    return jsonWithPersistence(
      { error: supabase.message, actions: [], supabase, persisted: false },
      true,
      { status: httpStatusForSupabaseFailure(supabase, 500) },
    )
  }

  return jsonWithPersistence({ actions: data ?? [], persisted: true }, true)
}

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()
  const sessionFallback = isWarRoomActionQueueSessionOnlyFallbackEnabled()

  if (!sup.ok) {
    const errMsg = sup.configError
    if (sessionFallback) {
      return jsonWithPersistence(
        {
          error: errMsg,
          persisted: false,
          queued: false,
          sessionOnlyFallbackEnv: WAR_ROOM_ACTION_QUEUE_SESSION_ONLY_FALLBACK_ENV,
        },
        false,
        { status: 503 },
      )
    }
    return jsonWithPersistence(
      { error: errMsg, persisted: false, queued: false },
      false,
      { status: 503 },
    )
  }

  let body: { type?: string; payload?: Record<string, unknown>; conversationId?: string | null; status?: string }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence(
      { error: 'Invalid JSON body.', persisted: false, queued: false },
      true,
      { status: 400 },
    )
  }

  const type = typeof body.type === 'string' ? body.type.trim() : ''
  if (!type) {
    return jsonWithPersistence(
      { error: 'type is required', persisted: false, queued: false },
      true,
      { status: 400 },
    )
  }

  const status = body.status && isWarRoomActionStatus(body.status) ? body.status : 'requested'
  if (status !== 'requested') {
    return jsonWithPersistence(
      { error: 'New actions must start in requested status.', persisted: false, queued: false },
      true,
      { status: 400 },
    )
  }

  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null

  if (conversationId) {
    const { data: c, error: cErr } = await sup.client
      .from(TABLE_CONVERSATIONS)
      .select('id')
      .eq('id', conversationId)
      .is('deleted_at', null)
      .maybeSingle()
    if (cErr) {
      const supabase = warRoomSupabaseFailurePayload(TABLE_CONVERSATIONS, cErr, { operation: 'select' })
      auditQueueFailureFireAndForget(sup.client, 'war_room_actions queue POST conversation lookup failed', {
        supabase,
      })
      auditQueueSentinelMisleadingSuccessFireAndForget(sup.client, 'POST (conversation lookup)', { supabase })
      const statusCode = httpStatusForSupabaseFailure(supabase, 500)
      if (sessionFallback && statusCode >= 500) {
        return jsonWithPersistence(
          {
            error: supabase.message,
            persisted: false,
            queued: false,
            supabase,
            sessionOnlyFallbackEnv: WAR_ROOM_ACTION_QUEUE_SESSION_ONLY_FALLBACK_ENV,
          },
          true,
          { status: 503 },
        )
      }
      return jsonWithPersistence(
        { error: supabase.message, supabase, persisted: false, queued: false },
        true,
        { status: statusCode },
      )
    }
    if (!c) {
      return jsonWithPersistence(
        { error: 'conversationId not found', persisted: false, queued: false },
        true,
        { status: 400 },
      )
    }
  }

  const { data, error } = await sup.client
    .from(TABLE_ACTIONS)
    .insert({
      type,
      payload,
      conversation_id: conversationId,
      status: 'requested',
      approval_granted: false,
    })
    .select('id,conversation_id,status,type,payload,approval_granted,created_at,updated_at')
    .single()

  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_ACTIONS, error, { operation: 'insert' })
    auditQueueFailureFireAndForget(sup.client, 'war_room_actions queue POST insert failed', { supabase })
    auditQueueSentinelMisleadingSuccessFireAndForget(sup.client, 'POST (insert)', { supabase })
    const statusCode = httpStatusForSupabaseFailure(supabase, 500)
    if (sessionFallback && statusCode >= 500) {
      return jsonWithPersistence(
        {
          error: supabase.message,
          persisted: false,
          queued: false,
          supabase,
          sessionOnlyFallbackEnv: WAR_ROOM_ACTION_QUEUE_SESSION_ONLY_FALLBACK_ENV,
        },
        true,
        { status: 503 },
      )
    }
    return jsonWithPersistence(
      { error: supabase.message, supabase, persisted: false, queued: false },
      true,
      { status: statusCode },
    )
  }

  try {
    await appendWarRoomActionLog(sup.client, data.id, `Action enqueued (${type}).`, 'info', { status: data.status })
  } catch (logErr) {
    console.error('[war-room] appendWarRoomActionLog after enqueue failed:', logErr)
  }

  return jsonWithPersistence(
    { persisted: true, queued: true, action: data },
    true,
    { status: 201 },
  )
}
