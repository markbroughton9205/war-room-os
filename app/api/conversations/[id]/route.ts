import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

const MESSAGE_LIMIT = 300

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence(
      { conversation: null, messages: [], persistence: 'Supabase not configured; conversation data unavailable.' },
      false,
    )
  }

  const { id } = await context.params
  if (!id) {
    return jsonWithPersistence({ error: 'id required' }, true, { status: 400 })
  }

  const { data: conv, error: cErr } = await sup.client
    .from('war_room_conversations')
    .select('id,title,metadata,state,created_at,updated_at,last_message_at,deleted_at')
    .eq('id', id)
    .maybeSingle()

  if (cErr) {
    return jsonWithPersistence({ error: cErr.message }, true, { status: 500 })
  }
  if (!conv || conv.deleted_at) {
    return jsonWithPersistence({ error: 'Not found' }, true, { status: 404 })
  }

  const { data: messages, error: mErr } = await sup.client
    .from('war_room_messages')
    .select('id,conversation_id,role,content,family,metadata,created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .limit(MESSAGE_LIMIT)

  if (mErr) {
    return jsonWithPersistence({ error: mErr.message, conversation: conv, messages: [] }, true, { status: 500 })
  }

  return jsonWithPersistence(
    {
      conversation: conv,
      messages: messages ?? [],
      messagesNote: `Up to ${MESSAGE_LIMIT} messages ascending by created_at (see GET /api/conversations/[id]).`,
    },
    true,
  )
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ error: 'Supabase is not configured.' }, false, { status: 503 })
  }

  const { id } = await context.params
  if (!id) {
    return jsonWithPersistence({ error: 'id required' }, true, { status: 400 })
  }

  let body: { title?: string; state?: string; metadata?: Record<string, unknown>; mergeMetadata?: boolean }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.title === 'string') updates.title = body.title.trim() || 'Untitled thread'
  if (typeof body.state === 'string' && ['active', 'paused', 'archived'].includes(body.state)) {
    updates.state = body.state
  }
  if (body.metadata && typeof body.metadata === 'object') {
    if (body.mergeMetadata) {
      const { data: existing, error: exErr } = await sup.client
        .from('war_room_conversations')
        .select('metadata')
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle()
      if (exErr) {
        return jsonWithPersistence({ error: exErr.message }, true, { status: 500 })
      }
      const prev = existing?.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
        ? (existing.metadata as Record<string, unknown>)
        : {}
      const incoming = body.metadata as Record<string, unknown>
      const prevCouncil = prev.council && typeof prev.council === 'object' && !Array.isArray(prev.council)
        ? (prev.council as Record<string, unknown>)
        : {}
      const incomingCouncil = incoming.council
      const { council: _dropCouncil, ...incomingRest } = incoming
      void _dropCouncil
      const mergedTop: Record<string, unknown> = { ...prev, ...incomingRest }
      if (incomingCouncil !== undefined && typeof incomingCouncil === 'object' && !Array.isArray(incomingCouncil)) {
        mergedTop.council = { ...prevCouncil, ...(incomingCouncil as Record<string, unknown>) }
      }
      updates.metadata = mergedTop
    } else {
      updates.metadata = body.metadata
    }
  }

  if (!Object.keys(updates).length) {
    return jsonWithPersistence({ error: 'No valid fields to update.' }, true, { status: 400 })
  }

  const { data, error } = await sup.client
    .from('war_room_conversations')
    .update(updates)
    .eq('id', id)
    .is('deleted_at', null)
    .select('id,title,metadata,state,created_at,updated_at,last_message_at,deleted_at')
    .maybeSingle()

  if (error) {
    return jsonWithPersistence({ error: error.message }, true, { status: 500 })
  }
  if (!data) {
    return jsonWithPersistence({ error: 'Not found' }, true, { status: 404 })
  }

  return jsonWithPersistence({ conversation: data }, true)
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ error: 'Supabase is not configured.' }, false, { status: 503 })
  }

  const { id } = await context.params
  if (!id) {
    return jsonWithPersistence({ error: 'id required' }, true, { status: 400 })
  }

  const { data, error } = await sup.client
    .from('war_room_conversations')
    .update({ deleted_at: new Date().toISOString(), state: 'archived' })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id,deleted_at')
    .maybeSingle()

  if (error) {
    return jsonWithPersistence({ error: error.message }, true, { status: 500 })
  }
  if (!data) {
    return jsonWithPersistence({ error: 'Not found' }, true, { status: 404 })
  }

  return jsonWithPersistence({ ok: true, id: data.id, deleted_at: data.deleted_at }, true)
}
