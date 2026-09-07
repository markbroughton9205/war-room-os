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

  // A client-supplied idempotency key (reused across a client-side retry of the same logical
  // write) lets a retry recover from "request never reached the server" or "server errored"
  // safely — but without this check, it could also duplicate a write that actually succeeded and
  // only lost its response in transit. If a message with this key already exists, return it
  // instead of inserting again.
  const idempotencyKey = typeof metadata.idempotencyKey === 'string' ? metadata.idempotencyKey : null
  if (idempotencyKey) {
    const { data: existing, error: existingErr } = await sup.client
      .from(TABLE_MESSAGES)
      .select('id,conversation_id,role,content,family,metadata,created_at')
      .eq('conversation_id', conversationId)
      .contains('metadata', { idempotencyKey })
      .maybeSingle()
    if (!existingErr && existing) {
      return jsonWithPersistence({ message: existing }, true, { status: 200 })
    }
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

  if (!error && data) {
    const preview = content.trim().slice(0, 160)
    void sup.client
      .from(TABLE_CONVERSATIONS)
      .update({
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)
    const { data: existingMeta } = await sup.client
      .from(TABLE_CONVERSATIONS)
      .select('metadata')
      .eq('id', conversationId)
      .maybeSingle()
    const prev = existingMeta?.metadata && typeof existingMeta.metadata === 'object' && !Array.isArray(existingMeta.metadata)
      ? (existingMeta.metadata as Record<string, unknown>)
      : {}
    const prevCouncil = prev.council && typeof prev.council === 'object' && !Array.isArray(prev.council)
      ? (prev.council as Record<string, unknown>)
      : {}
    void sup.client
      .from(TABLE_CONVERSATIONS)
      .update({ metadata: { ...prev, council: { ...prevCouncil, lastPreview: preview } } })
      .eq('id', conversationId)
  }

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

export async function DELETE(
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

  let body: { ids?: unknown; scope?: unknown } = {}
  try {
    const text = await req.text()
    body = text.trim() ? (JSON.parse(text) as { ids?: unknown; scope?: unknown }) : {}
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string =>
        typeof id === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
      )
    : []
  const deleteAll = body.scope === 'all'
  if (!deleteAll && !ids.length) {
    return jsonWithPersistence({ deleted: 0 }, true)
  }

  let query = sup.client
    .from(TABLE_MESSAGES)
    .delete()
    .eq('conversation_id', conversationId)
    .select('id')

  if (!deleteAll) {
    query = query.in('id', ids)
  }

  const { data, error } = await query

  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_MESSAGES, error, { operation: 'delete' })
    return jsonWithPersistence(
      { error: supabase.message, supabase },
      true,
      { status: httpStatusForSupabaseFailure(supabase, 500) },
    )
  }

  return jsonWithPersistence({ deleted: data?.length ?? 0 }, true)
}
