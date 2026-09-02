import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  httpStatusForSupabaseFailure,
  warRoomSupabaseFailurePayload,
} from '@/lib/war-room/warRoomSupabaseError'

export const dynamic = 'force-dynamic'

const TABLE_PROJECTS = 'war_room_projects'
const COLUMNS = 'id,name,description,status,priority,current_objective,current_phase,metadata,created_at,updated_at'

export async function GET(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return jsonWithPersistence({ projects: [] }, false)

  const status = new URL(req.url).searchParams.get('status')
  let query = sup.client.from(TABLE_PROJECTS).select(COLUMNS).order('priority', { ascending: false }).order('updated_at', { ascending: false })
  if (status) query = query.eq('status', status)

  const { data, error } = await query.limit(100)
  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_PROJECTS, error, { operation: 'select' })
    return jsonWithPersistence({ error: supabase.message, projects: [], supabase }, true, { status: httpStatusForSupabaseFailure(supabase, 500) })
  }
  return jsonWithPersistence({ projects: data ?? [] }, true)
}

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return jsonWithPersistence({ error: 'Supabase is not configured.' }, false, { status: 503 })

  let body: { name?: string; description?: string; priority?: number; currentObjective?: string; currentPhase?: string }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return jsonWithPersistence({ error: 'name is required' }, true, { status: 400 })

  const { data, error } = await sup.client
    .from(TABLE_PROJECTS)
    .insert({
      name,
      description: typeof body.description === 'string' ? body.description : null,
      priority: typeof body.priority === 'number' ? body.priority : 0,
      current_objective: typeof body.currentObjective === 'string' ? body.currentObjective : null,
      current_phase: typeof body.currentPhase === 'string' ? body.currentPhase : null,
    })
    .select(COLUMNS)
    .single()

  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_PROJECTS, error, { operation: 'insert' })
    return jsonWithPersistence({ error: supabase.message, supabase }, true, { status: httpStatusForSupabaseFailure(supabase, 500) })
  }
  return jsonWithPersistence({ project: data }, true, { status: 201 })
}
