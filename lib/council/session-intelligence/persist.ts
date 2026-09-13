import 'server-only'

import type { DeliberationSession } from '@/lib/council/family-deliberation/types'
import { displayNameForSeat } from '@/lib/council/nebula/identity'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { appendRoundToIntelligence, buildDurableRoundSnapshot, clampText } from './snapshot'
import { embedSessionIntelligenceInMetadata, readSessionIntelligenceFromMetadata } from './parse'
import {
  COUNCIL_DELIBERATION_ROUND_METADATA_KEY,
  type CouncilSessionIntelligenceV1,
  type DurableDeliberationRound,
} from './types'

const TABLE_CONVERSATIONS = 'war_room_conversations'
const TABLE_MESSAGES = 'war_room_messages'

function durableRoundMessageContent(round: DurableDeliberationRound): string {
  const synthesis = round.synthesisTurnRef
    ? round.turnRefs.find(t => t.turnId === round.synthesisTurnRef)?.summary
    : null
  const body = clampText(synthesis, 600)
    ?? `Council deliberation round ${round.roundId} completed with outcome ${round.outcome}.`
  return body
}

/**
 * Authoritative durable round record lives on war_room_messages.metadata.councilDeliberationRound.
 * Conversation metadata.sessionIntelligence is a rebuildable cache / read model only.
 */
export async function persistAuthoritativeRoundMessage(input: {
  conversationId: string
  round: DurableDeliberationRound
}): Promise<{ ok: boolean; messageId: string | null; error?: string }> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return { ok: false, messageId: null, error: (sup as { configError?: string }).configError ?? 'supabase unavailable' }
  }

  // Idempotent: if a message already carries this roundId, update its metadata in place.
  const { data: existingRows, error: findErr } = await sup.client
    .from(TABLE_MESSAGES)
    .select('id,metadata')
    .eq('conversation_id', input.conversationId)
    .order('created_at', { ascending: false })
    .limit(300)

  if (findErr) {
    return { ok: false, messageId: null, error: findErr.message }
  }

  const existing = (existingRows ?? []).find(row => {
    const meta = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null
    const round = meta?.[COUNCIL_DELIBERATION_ROUND_METADATA_KEY] as { roundId?: string } | undefined
    return round?.roundId === input.round.roundId
  })

  const metadata = {
    roundId: input.round.roundId,
    roundRequestId: input.round.roundId,
    pipelineOutcome: input.round.outcome,
    [COUNCIL_DELIBERATION_ROUND_METADATA_KEY]: input.round,
    sessionIntelligenceAuthoritative: true,
  }

  if (existing?.id) {
    const prevMeta = existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
      ? (existing.metadata as Record<string, unknown>)
      : {}
    const { error: updErr } = await sup.client
      .from(TABLE_MESSAGES)
      .update({ metadata: { ...prevMeta, ...metadata } })
      .eq('id', existing.id)
    if (updErr) return { ok: false, messageId: existing.id, error: updErr.message }
    return { ok: true, messageId: existing.id }
  }

  const synthesisSeat = input.round.synthesisTurnRef
    ? input.round.turnRefs.find(t => t.turnId === input.round.synthesisTurnRef)?.seatId
    : null
  const family = synthesisSeat ? displayNameForSeat(synthesisSeat) : 'AURORA'

  const { data: inserted, error: insErr } = await sup.client
    .from(TABLE_MESSAGES)
    .insert({
      conversation_id: input.conversationId,
      role: 'assistant',
      content: durableRoundMessageContent(input.round),
      family,
      metadata,
    })
    .select('id')
    .maybeSingle()

  if (insErr) {
    return { ok: false, messageId: null, error: insErr.message }
  }
  return { ok: true, messageId: typeof inserted?.id === 'string' ? inserted.id : null }
}

/**
 * Append-or-idempotent-replace a durable round into conversation metadata cache
 * AND write the authoritative message-level councilDeliberationRound record.
 */
export async function persistDeliberationRoundToConversation(input: {
  conversationId: string
  session: DeliberationSession
  messageIdByTurnId?: Record<string, string>
  interrupted?: boolean
  /** Required for #19 defense-in-depth when caller already proved ownership. */
  ownerUserId?: string
}): Promise<{
  ok: boolean
  intelligence: CouncilSessionIntelligenceV1 | null
  durableRound: DurableDeliberationRound | null
  authoritativeMessageId: string | null
  error?: string
}> {
  const conversationId = input.conversationId?.trim()
  if (!conversationId) {
    return { ok: false, intelligence: null, durableRound: null, authoritativeMessageId: null, error: 'conversationId required' }
  }
  if (!input.ownerUserId?.trim()) {
    return {
      ok: false,
      intelligence: null,
      durableRound: null,
      authoritativeMessageId: null,
      error: 'ownerUserId required for session-intelligence persist',
    }
  }
  const ownerUserId = input.ownerUserId.trim()

  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return {
      ok: false,
      intelligence: null,
      durableRound: null,
      authoritativeMessageId: null,
      error: (sup as { configError?: string }).configError ?? 'supabase unavailable',
    }
  }

  const { data: existing, error: readErr } = await sup.client
    .from(TABLE_CONVERSATIONS)
    .select('metadata')
    .eq('id', conversationId)
    .eq('owner_user_id', ownerUserId)
    .is('deleted_at', null)
    .maybeSingle()

  if (readErr) {
    return { ok: false, intelligence: null, durableRound: null, authoritativeMessageId: null, error: readErr.message }
  }
  if (!existing) {
    return { ok: false, intelligence: null, durableRound: null, authoritativeMessageId: null, error: 'conversation not found' }
  }

  const prevMeta = existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
    ? (existing.metadata as Record<string, unknown>)
    : {}
  const prior = readSessionIntelligenceFromMetadata(prevMeta)
  const round = buildDurableRoundSnapshot({
    conversationId,
    session: input.session,
    messageIdByTurnId: input.messageIdByTurnId,
    priorIntelligence: prior,
    interrupted: input.interrupted,
  })
  const next = appendRoundToIntelligence(prior, round)
  const mergedMetadata = embedSessionIntelligenceInMetadata(prevMeta, next)

  const { data: updated, error: writeErr } = await sup.client
    .from(TABLE_CONVERSATIONS)
    .update({ metadata: mergedMetadata, updated_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('owner_user_id', ownerUserId)
    .is('deleted_at', null)
    .select('metadata')
    .maybeSingle()

  if (writeErr) {
    return { ok: false, intelligence: next, durableRound: round, authoritativeMessageId: null, error: writeErr.message }
  }

  let intelligence = readSessionIntelligenceFromMetadata(updated?.metadata) ?? next
  if (intelligence && !intelligence.rounds.some(r => r.roundId === round.roundId)) {
    const repaired = appendRoundToIntelligence(intelligence, round)
    const repairedMeta = embedSessionIntelligenceInMetadata(
      updated?.metadata && typeof updated.metadata === 'object'
        ? (updated.metadata as Record<string, unknown>)
        : prevMeta,
      repaired,
    )
    const { error: retryErr } = await sup.client
      .from(TABLE_CONVERSATIONS)
      .update({ metadata: repairedMeta, updated_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('owner_user_id', ownerUserId)
      .is('deleted_at', null)
    if (retryErr) {
      return { ok: false, intelligence: repaired, durableRound: round, authoritativeMessageId: null, error: retryErr.message }
    }
    intelligence = repaired
  }

  const messageWrite = await persistAuthoritativeRoundMessage({ conversationId, round })
  if (!messageWrite.ok) {
    return {
      ok: false,
      intelligence,
      durableRound: round,
      authoritativeMessageId: messageWrite.messageId,
      error: messageWrite.error ?? 'authoritative_message_write_failed',
    }
  }

  return {
    ok: true,
    intelligence,
    durableRound: round,
    authoritativeMessageId: messageWrite.messageId,
  }
}

/**
 * Materialize authoritative message round records from an existing conversation cache.
 * Used to repair live conversations that only received the sessionIntelligence cache write.
 */
export async function materializeAuthoritativeRoundsFromCache(conversationId: string): Promise<{
  ok: boolean
  written: number
  roundIds: string[]
  error?: string
}> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return { ok: false, written: 0, roundIds: [], error: (sup as { configError?: string }).configError ?? 'supabase unavailable' }
  }
  const { data: conv, error } = await sup.client
    .from(TABLE_CONVERSATIONS)
    .select('metadata')
    .eq('id', conversationId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) return { ok: false, written: 0, roundIds: [], error: error.message }
  const intelligence = readSessionIntelligenceFromMetadata(conv?.metadata)
  if (!intelligence?.rounds.length) {
    return { ok: false, written: 0, roundIds: [], error: 'no_session_intelligence_cache' }
  }
  const roundIds: string[] = []
  for (const round of intelligence.rounds) {
    const result = await persistAuthoritativeRoundMessage({ conversationId, round })
    if (!result.ok) {
      return { ok: false, written: roundIds.length, roundIds, error: result.error }
    }
    roundIds.push(round.roundId)
  }
  return { ok: true, written: roundIds.length, roundIds }
}
