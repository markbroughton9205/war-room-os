import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  httpStatusForSupabaseFailure,
  warRoomSupabaseFailurePayload,
} from '@/lib/war-room/warRoomSupabaseError'

export const dynamic = 'force-dynamic'

const TABLE_CONVERSATIONS = 'war_room_conversations'

export async function GET() {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ conversations: [] }, false)
  }

  const { data, error } = await sup.client
    .from(TABLE_CONVERSATIONS)
    .select('id,title,metadata,state,created_at,updated_at,last_message_at,deleted_at')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(200)

  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_CONVERSATIONS, error, { operation: 'select' })
    return jsonWithPersistence(
      { error: supabase.message, conversations: [], supabase },
      true,
      { status: httpStatusForSupabaseFailure(supabase, 500) },
    )
  }

  return jsonWithPersistence({ conversations: data ?? [] }, true)
}

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ error: 'Supabase is not configured.', hint: 'Set NEXT_PUBLIC_SUPABASE_URL and the server-only Supabase role secret.' }, false, { status: 503 })
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
    .from(TABLE_CONVERSATIONS)
    .insert({ title, metadata })
    .select('id,title,metadata,state,created_at,updated_at,last_message_at,deleted_at')
    .single()

  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_CONVERSATIONS, error, { operation: 'insert' })
    return jsonWithPersistence(
      { error: supabase.message, supabase },
      true,
      { status: httpStatusForSupabaseFailure(supabase, 500) },
    )
  }

  return jsonWithPersistence({ conversation: data }, true, { status: 201 })
}
