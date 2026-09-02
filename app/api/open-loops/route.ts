import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  httpStatusForSupabaseFailure,
  warRoomSupabaseFailurePayload,
} from '@/lib/war-room/warRoomSupabaseError'

export const dynamic = 'force-dynamic'

const TABLE_OPEN_LOOPS = 'war_room_open_loops'
const COLUMNS =
  'id,project_id,conversation_id,title,description,status,priority,source,owner_type,blocked_by,next_action,metadata,created_at,updated_at,resolved_at'

export async function GET(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return jsonWithPersistence({ openLoops: [] }, false)

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const conversationId = url.searchParams.get('conversationId')
  const status = url.searchParams.get('status')

  let query = sup.client.from(TABLE_OPEN_LOOPS).select(COLUMNS).order('priority', { ascending: false }).order('updated_at', { ascending: true })
  if (projectId) query = query.eq('project_id', projectId)
  if (conversationId) query = query.eq('conversation_id', conversationId)
  if (status) query = query.eq('status', status)

  const { data, error } = await query.limit(200)
  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_OPEN_LOOPS, error, { operation: 'select' })
    return jsonWithPersistence({ error: supabase.message, openLoops: [], supabase }, true, { status: httpStatusForSupabaseFailure(supabase, 500) })
  }
  return jsonWithPersistence({ openLoops: data ?? [] }, true)
}

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return jsonWithPersistence({ error: 'Supabase is not configured.' }, false, { status: 503 })

  let body: {
    title?: string
    description?: string
    projectId?: string
    conversationId?: string
    priority?: number
    source?: string
    ownerType?: string
    nextAction?: string
  }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return jsonWithPersistence({ error: 'title is required' }, true, { status: 400 })

  const { data, error } = await sup.client
    .from(TABLE_OPEN_LOOPS)
    .insert({
      title,
      description: typeof body.description === 'string' ? body.description : null,
      project_id: typeof body.projectId === 'string' ? body.projectId : null,
      conversation_id: typeof body.conversationId === 'string' ? body.conversationId : null,
      priority: typeof body.priority === 'number' ? body.priority : 0,
      source: typeof body.source === 'string' ? body.source : 'commander_stated',
      owner_type: typeof body.ownerType === 'string' ? body.ownerType : 'commander',
      next_action: typeof body.nextAction === 'string' ? body.nextAction : null,
    })
    .select(COLUMNS)
    .single()

  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_OPEN_LOOPS, error, { operation: 'insert' })
    return jsonWithPersistence({ error: supabase.message, supabase }, true, { status: httpStatusForSupabaseFailure(supabase, 500) })
  }
  return jsonWithPersistence({ openLoop: data }, true, { status: 201 })
}
