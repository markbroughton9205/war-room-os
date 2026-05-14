import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

const ROLES = ['system', 'user', 'assistant', 'tool', 'note'] as const

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
    .from('war_room_conversations')
    .select('id')
    .eq('id', conversationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (cErr) {
    return jsonWithPersistence({ error: cErr.message }, true, { status: 500 })
  }
  if (!conv) {
    return jsonWithPersistence({ error: 'Conversation not found' }, true, { status: 404 })
  }

  const family = typeof body.family === 'string' ? body.family.trim() || null : null
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {}

  const { data, error } = await sup.client
    .from('war_room_messages')
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
    return jsonWithPersistence({ error: error.message }, true, { status: 500 })
  }

  return jsonWithPersistence({ message: data }, true, { status: 201 })
}
