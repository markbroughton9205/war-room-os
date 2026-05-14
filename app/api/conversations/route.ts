import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

export async function GET() {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ conversations: [] }, false)
  }

  const { data, error } = await sup.client
    .from('war_room_conversations')
    .select('id,title,metadata,state,created_at,updated_at,last_message_at,deleted_at')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(200)

  if (error) {
    return jsonWithPersistence({ error: error.message, conversations: [] }, true, { status: 500 })
  }

  return jsonWithPersistence({ conversations: data ?? [] }, true)
}

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ error: 'Supabase is not configured.', hint: 'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' }, false, { status: 503 })
  }

  let body: { title?: string; metadata?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }

  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Untitled thread'
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {}

  const { data, error } = await sup.client
    .from('war_room_conversations')
    .insert({ title, metadata })
    .select('id,title,metadata,state,created_at,updated_at,last_message_at,deleted_at')
    .single()

  if (error) {
    return jsonWithPersistence({ error: error.message }, true, { status: 500 })
  }

  return jsonWithPersistence({ conversation: data }, true, { status: 201 })
}
