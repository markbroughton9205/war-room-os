import {
  councilMessageFromWarRoomRow,
  shouldPersistCouncilMessage,
} from '@/lib/council/messagePersistenceFilter'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  httpStatusForSupabaseFailure,
  warRoomSupabaseFailurePayload,
} from '@/lib/war-room/warRoomSupabaseError'

export const dynamic = 'force-dynamic'

const ROLES = ['system', 'user', 'assistant', 'tool', 'note'] as const
const TABLE_CONVERSATIONS = 'war_room_conversations'
const TABLE_MESSAGES = 'war_room_messages'

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ error: 'Supabase is not configured.' }, false, { status: 503 })
  }

  const { id: conversationId } = await context.params
  if (!conversationId) {
    return jsonWithPersistence({ error: 'id required' }, true, { status: 400 })
  }

  let body: { role?: string; content?: string; family?: string | null; metadata?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }

  const role = typeof body.role === 'string' ? body.role : 'user'
  if (!ROLES.includes(role as (typeof ROLES)[number])) {
    return jsonWithPersistence({ error: `role must be one of: ${ROLES.join(', ')}` }, true, { status: 400 })
  }

  const content = typeof body.content === 'string' ? body.content : ''
  if (!content.trim()) {
    return jsonWithPersistence({ error: 'content is required' }, true, { status: 400 })
  }

  const { data: conv, error: cErr } = await sup.client
    .from(TABLE_CONVERSATIONS)
    .select('id')
    .eq('id', conversationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (cErr) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_CONVERSATIONS, cErr, { operation: 'select' })
    return jsonWithPersistence(
      { error: supabase.message, supabase },
      true,
      { status: httpStatusForSupabaseFailure(supabase, 500) },
    )
  }
  if (!conv) {
    return jsonWithPersistence({ error: 'Conversation not found' }, true, { status: 404 })
  }

  const family = typeof body.family === 'string' ? body.family.trim() || null : null
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {}

  if (
    !shouldPersistCouncilMessage(
      councilMessageFromWarRoomRow({ role, content, family, metadata }),
    )
  ) {
    return jsonWithPersistence({ skipped: true, reason: 'message_not_persistable' }, true, { status: 202 })
  }

  const { data, error } = await sup.client
    .from(TABLE_MESSAGES)
    .insert({
      conversation_id: conversationId,
      role,
      content,
      family,
      metadata,
    })
    .select('id,conversation_id,role,content,family,metadata,created_at')
    .single()

  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_MESSAGES, error, { operation: 'insert' })
    return jsonWithPersistence(
      { error: supabase.message, supabase },
      true,
      { status: httpStatusForSupabaseFailure(supabase, 500) },
    )
  }

  return jsonWithPersistence({ message: data }, true, { status: 201 })
}
