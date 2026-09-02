import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  httpStatusForSupabaseFailure,
  warRoomSupabaseFailurePayload,
} from '@/lib/war-room/warRoomSupabaseError'

export const dynamic = 'force-dynamic'

const TABLE_OPEN_LOOPS = 'war_room_open_loops'
const COLUMNS =
  'id,project_id,conversation_id,title,description,status,priority,source,owner_type,blocked_by,next_action,metadata,created_at,updated_at,resolved_at'
const STATUSES = ['open', 'blocked', 'in_progress', 'done', 'dropped'] as const

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return jsonWithPersistence({ error: 'Supabase is not configured.' }, false, { status: 503 })

  const { id } = await context.params
  let body: { status?: string; priority?: number; nextAction?: string; blockedBy?: string; title?: string; description?: string }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.status === 'string' && (STATUSES as readonly string[]).includes(body.status)) updates.status = body.status
  if (typeof body.priority === 'number') updates.priority = body.priority
  if (typeof body.nextAction === 'string') updates.next_action = body.nextAction
  if (typeof body.blockedBy === 'string') updates.blocked_by = body.blockedBy
  if (typeof body.title === 'string' && body.title.trim()) updates.title = body.title.trim()
  if (typeof body.description === 'string') updates.description = body.description

  if (!Object.keys(updates).length) return jsonWithPersistence({ error: 'No valid fields to update.' }, true, { status: 400 })

  const { data, error } = await sup.client.from(TABLE_OPEN_LOOPS).update(updates).eq('id', id).select(COLUMNS).maybeSingle()
  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_OPEN_LOOPS, error, { operation: 'update' })
    return jsonWithPersistence({ error: supabase.message, supabase }, true, { status: httpStatusForSupabaseFailure(supabase, 500) })
  }
  if (!data) return jsonWithPersistence({ error: 'Not found' }, true, { status: 404 })
  return jsonWithPersistence({ openLoop: data }, true)
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return jsonWithPersistence({ error: 'Supabase is not configured.' }, false, { status: 503 })

  const { id } = await context.params
  const { data, error } = await sup.client.from(TABLE_OPEN_LOOPS).update({ status: 'dropped' }).eq('id', id).select('id,status').maybeSingle()
  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_OPEN_LOOPS, error, { operation: 'update' })
    return jsonWithPersistence({ error: supabase.message, supabase }, true, { status: httpStatusForSupabaseFailure(supabase, 500) })
  }
  if (!data) return jsonWithPersistence({ error: 'Not found' }, true, { status: 404 })
  return jsonWithPersistence({ ok: true, id: data.id, status: data.status }, true)
}
