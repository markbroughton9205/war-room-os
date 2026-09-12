import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  httpStatusForSupabaseFailure,
  warRoomSupabaseFailurePayload,
} from '@/lib/war-room/warRoomSupabaseError'
import { requireConversationCaller } from '@/lib/war-room/conversationAuth'
import { stripClientOwnerFields } from '@/lib/war-room/conversationOwnership'

export const dynamic = 'force-dynamic'

const TABLE_CONVERSATIONS = 'war_room_conversations'

export async function GET(req: Request) {
  const caller = await requireConversationCaller()
  if (!caller.ok) return caller.response

  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ conversations: [] }, false)
  }

  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const includeArchived = url.searchParams.get('includeArchived') === '1'
    || url.searchParams.get('archived') === '1'

  let query = sup.client
    .from(TABLE_CONVERSATIONS)
    .select('id,title,metadata,state,created_at,updated_at,last_message_at,deleted_at')
    .eq('owner_user_id', caller.userId)
    .order('updated_at', { ascending: false })
    .limit(200)

  if (!includeArchived) {
    query = query.is('deleted_at', null)
  }

  if (q) {
    query = query.ilike('title', `%${q.replace(/%/g, '')}%`)
  }

  const { data, error } = await query

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
  const caller = await requireConversationCaller()
  if (!caller.ok) return caller.response

  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ error: 'Supabase is not configured.', hint: 'Set NEXT_PUBLIC_SUPABASE_URL and the server-only Supabase role secret.' }, false, { status: 503 })
  }

  let body: { title?: string; metadata?: Record<string, unknown>; owner_user_id?: unknown; ownerUserId?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }

  // Never trust client-supplied ownership — strip and ignore spoof attempts.
  const safeBody = stripClientOwnerFields(body as Record<string, unknown>) as typeof body
  const title = typeof safeBody.title === 'string' && safeBody.title.trim() ? safeBody.title.trim() : 'Untitled thread'
  const metadata = safeBody.metadata && typeof safeBody.metadata === 'object' ? safeBody.metadata : {}

  const { data, error } = await sup.client
    .from(TABLE_CONVERSATIONS)
    .insert({ title, metadata, owner_user_id: caller.userId })
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
