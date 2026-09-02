import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  httpStatusForSupabaseFailure,
  warRoomSupabaseFailurePayload,
} from '@/lib/war-room/warRoomSupabaseError'

export const dynamic = 'force-dynamic'

const TABLE_PROJECTS = 'war_room_projects'
const COLUMNS = 'id,name,description,status,priority,current_objective,current_phase,metadata,created_at,updated_at'
const STATUSES = ['active', 'paused', 'completed', 'archived'] as const

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return jsonWithPersistence({ project: null }, false)

  const { id } = await context.params
  const { data, error } = await sup.client.from(TABLE_PROJECTS).select(COLUMNS).eq('id', id).maybeSingle()
  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_PROJECTS, error, { operation: 'select' })
    return jsonWithPersistence({ error: supabase.message, supabase }, true, { status: httpStatusForSupabaseFailure(supabase, 500) })
  }
  if (!data) return jsonWithPersistence({ error: 'Not found' }, true, { status: 404 })
  return jsonWithPersistence({ project: data }, true)
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return jsonWithPersistence({ error: 'Supabase is not configured.' }, false, { status: 503 })

  const { id } = await context.params
  let body: { status?: string; priority?: number; name?: string; description?: string; currentObjective?: string; currentPhase?: string }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim()
  if (typeof body.description === 'string') updates.description = body.description
  if (typeof body.priority === 'number') updates.priority = body.priority
  if (typeof body.currentObjective === 'string') updates.current_objective = body.currentObjective
  if (typeof body.currentPhase === 'string') updates.current_phase = body.currentPhase
  if (typeof body.status === 'string' && (STATUSES as readonly string[]).includes(body.status)) updates.status = body.status

  if (!Object.keys(updates).length) return jsonWithPersistence({ error: 'No valid fields to update.' }, true, { status: 400 })

  const { data, error } = await sup.client.from(TABLE_PROJECTS).update(updates).eq('id', id).select(COLUMNS).maybeSingle()
  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_PROJECTS, error, { operation: 'update' })
    return jsonWithPersistence({ error: supabase.message, supabase }, true, { status: httpStatusForSupabaseFailure(supabase, 500) })
  }
  if (!data) return jsonWithPersistence({ error: 'Not found' }, true, { status: 404 })
  return jsonWithPersistence({ project: data }, true)
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return jsonWithPersistence({ error: 'Supabase is not configured.' }, false, { status: 503 })

  const { id } = await context.params
  const { data, error } = await sup.client.from(TABLE_PROJECTS).update({ status: 'archived' }).eq('id', id).select('id,status').maybeSingle()
  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_PROJECTS, error, { operation: 'update' })
    return jsonWithPersistence({ error: supabase.message, supabase }, true, { status: httpStatusForSupabaseFailure(supabase, 500) })
  }
  if (!data) return jsonWithPersistence({ error: 'Not found' }, true, { status: 404 })
  return jsonWithPersistence({ ok: true, id: data.id, status: data.status }, true)
}
