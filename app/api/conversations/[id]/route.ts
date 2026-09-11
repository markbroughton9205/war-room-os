import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  httpStatusForSupabaseFailure,
  warRoomSupabaseFailurePayload,
} from '@/lib/war-room/warRoomSupabaseError'

export const dynamic = 'force-dynamic'

const MESSAGE_LIMIT = 300
const TABLE_CONVERSATIONS = 'war_room_conversations'
const TABLE_MESSAGES = 'war_room_messages'

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
    .from(TABLE_CONVERSATIONS)
    .select('id,title,metadata,state,created_at,updated_at,last_message_at,deleted_at')
    .eq('id', id)
    .maybeSingle()

  if (cErr) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_CONVERSATIONS, cErr, { operation: 'select' })
    return jsonWithPersistence(
      { error: supabase.message, supabase },
      true,
      { status: httpStatusForSupabaseFailure(supabase, 500) },
    )
  }
  if (!conv || conv.deleted_at) {
    return jsonWithPersistence({ error: 'Not found' }, true, { status: 404 })
  }

  // Fetch the most recent MESSAGE_LIMIT rows (descending), then reverse to ascending for the
  // response — an ascending-order query with a limit would instead freeze on the oldest rows
  // forever once a conversation passes MESSAGE_LIMIT messages, permanently hiding new activity.
  const { data: messages, error: mErr } = await sup.client
    .from(TABLE_MESSAGES)
    .select('id,conversation_id,role,content,family,metadata,created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: false })
    .limit(MESSAGE_LIMIT)

  if (mErr) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_MESSAGES, mErr, { operation: 'select' })
    return jsonWithPersistence(
      { error: supabase.message, conversation: conv, messages: [], supabase },
      true,
      { status: httpStatusForSupabaseFailure(supabase, 500) },
    )
  }

  return jsonWithPersistence(
    {
      conversation: conv,
      messages: (messages ?? []).slice().reverse(),
      messagesNote: `Most recent ${MESSAGE_LIMIT} messages, ascending by created_at (see GET /api/conversations/[id]).`,
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
        .from(TABLE_CONVERSATIONS)
        .select('metadata')
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle()
      if (exErr) {
        const supabase = warRoomSupabaseFailurePayload(TABLE_CONVERSATIONS, exErr, { operation: 'select' })
        return jsonWithPersistence(
          { error: supabase.message, supabase },
          true,
          { status: httpStatusForSupabaseFailure(supabase, 500) },
        )
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
        const nextCouncil = { ...prevCouncil, ...(incomingCouncil as Record<string, unknown>) }
        // #17: append-merge sessionIntelligence.rounds by roundId (never overwrite Round 1 with Round 2).
        const incomingSi = (incomingCouncil as Record<string, unknown>).sessionIntelligence
        const prevSi = prevCouncil.sessionIntelligence
        if (
          incomingSi
          && typeof incomingSi === 'object'
          && !Array.isArray(incomingSi)
          && prevSi
          && typeof prevSi === 'object'
          && !Array.isArray(prevSi)
        ) {
          const prevRounds = Array.isArray((prevSi as { rounds?: unknown }).rounds)
            ? ([...(prevSi as { rounds: Record<string, unknown>[] }).rounds])
            : []
          const incomingRounds = Array.isArray((incomingSi as { rounds?: unknown }).rounds)
            ? ((incomingSi as { rounds: Record<string, unknown>[] }).rounds)
            : []
          const byId = new Map<string, Record<string, unknown>>()
          for (const round of prevRounds) {
            const id = typeof round.roundId === 'string' ? round.roundId : ''
            if (id) byId.set(id, round)
          }
          for (const round of incomingRounds) {
            const id = typeof round.roundId === 'string' ? round.roundId : ''
            if (!id) continue
            // Same roundId: prefer incoming (idempotent rewrite of that round only).
            byId.set(id, round)
          }
          const mergedRounds = Array.from(byId.values())
          nextCouncil.sessionIntelligence = {
            ...(prevSi as Record<string, unknown>),
            ...(incomingSi as Record<string, unknown>),
            rounds: mergedRounds,
            roundCount: mergedRounds.length,
            latestRoundId:
              typeof (incomingSi as { latestRoundId?: unknown }).latestRoundId === 'string'
                ? (incomingSi as { latestRoundId: string }).latestRoundId
                : mergedRounds.length
                  ? (mergedRounds[mergedRounds.length - 1] as { roundId?: string }).roundId ?? null
                  : null,
            revision:
              Math.max(
                typeof (prevSi as { revision?: unknown }).revision === 'number'
                  ? (prevSi as { revision: number }).revision
                  : 0,
                typeof (incomingSi as { revision?: unknown }).revision === 'number'
                  ? (incomingSi as { revision: number }).revision
                  : 0,
              ) + 1,
            updatedAt: new Date().toISOString(),
          }
        }
        mergedTop.council = nextCouncil
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
    .from(TABLE_CONVERSATIONS)
    .update(updates)
    .eq('id', id)
    .is('deleted_at', null)
    .select('id,title,metadata,state,created_at,updated_at,last_message_at,deleted_at')
    .maybeSingle()

  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_CONVERSATIONS, error, { operation: 'update' })
    return jsonWithPersistence(
      { error: supabase.message, supabase },
      true,
      { status: httpStatusForSupabaseFailure(supabase, 500) },
    )
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
    .from(TABLE_CONVERSATIONS)
    .update({ deleted_at: new Date().toISOString(), state: 'archived' })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id,deleted_at')
    .maybeSingle()

  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_CONVERSATIONS, error, { operation: 'update' })
    return jsonWithPersistence(
      { error: supabase.message, supabase },
      true,
      { status: httpStatusForSupabaseFailure(supabase, 500) },
    )
  }
  if (!data) {
    return jsonWithPersistence({ error: 'Not found' }, true, { status: 404 })
  }

  return jsonWithPersistence({ ok: true, id: data.id, deleted_at: data.deleted_at }, true)
}
