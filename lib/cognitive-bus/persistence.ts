import {
  getCouncilThreadState,
  hydrateCognitiveBusThread,
  listCognitiveBusEvents,
  publishCognitiveBusEvent,
} from '@/lib/cognitive-bus/bus'
import type { CognitiveBusEvent, CognitiveBusEventType, CouncilThreadState } from '@/lib/cognitive-bus/types'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

const MIGRATION_HINT = 'supabase/war_room_phase30_cognitive_bus.sql'

function isMissingTableError(message: string): boolean {
  return /war_room_council_thread/i.test(message) && /(does not exist|schema cache|PGRST)/i.test(message)
}

export function mapRowToEvent(row: {
  id: string
  thread_id: string
  event_type: string
  payload: unknown
  created_at: string
  correlation_id?: string | null
}): CognitiveBusEvent | null {
  const type = row.event_type as CognitiveBusEventType
  return {
    id: row.id,
    threadId: row.thread_id,
    type,
    at: row.created_at,
    correlationId: row.correlation_id ?? undefined,
    payload: row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {},
  }
}

export async function loadCouncilThreadFromStore(
  client: WarRoomSupabase | null,
  threadId: string,
): Promise<{ ok: true; migrationRequired: boolean } | { ok: false; error: string }> {
  if (!client) return { ok: true, migrationRequired: false }
  const tid = threadId.trim()
  if (!tid) return { ok: true, migrationRequired: false }

  const { data: eventRows, error: eventError } = await client
    .from('war_room_council_thread_events')
    .select('id, thread_id, event_type, payload, created_at, correlation_id')
    .eq('thread_id', tid)
    .order('created_at', { ascending: true })
    .limit(400)

  if (eventError) {
    if (isMissingTableError(eventError.message)) {
      return { ok: true, migrationRequired: true }
    }
    return { ok: false, error: 'Council thread events unavailable.' }
  }

  const events = (eventRows ?? [])
    .map(row => mapRowToEvent(row as Parameters<typeof mapRowToEvent>[0]))
    .filter((e): e is CognitiveBusEvent => Boolean(e))

  let statePatch: Partial<CouncilThreadState> | undefined
  const { data: stateRow, error: stateError } = await client
    .from('war_room_council_thread_state')
    .select('thread_id, phase, correlation_id, operator_packet, inherited_context, updated_at')
    .eq('thread_id', tid)
    .maybeSingle()

  if (!stateError && stateRow) {
    statePatch = {
      phase: (stateRow.phase as CouncilThreadState['phase']) ?? 'intake',
      correlationId: (stateRow.correlation_id as string | null) ?? null,
      operatorPacket: (stateRow.operator_packet as CouncilThreadState['operatorPacket']) ?? null,
      inheritedContext:
        stateRow.inherited_context && typeof stateRow.inherited_context === 'object'
          ? (stateRow.inherited_context as Record<string, unknown>)
          : {},
      lastEventAt: stateRow.updated_at ?? null,
    }
  } else if (stateError && !isMissingTableError(stateError.message)) {
    return { ok: false, error: 'Council thread state unavailable.' }
  }

  hydrateCognitiveBusThread(tid, events, statePatch)
  return { ok: true, migrationRequired: false }
}

export async function persistCognitiveBusEvent(
  client: WarRoomSupabase | null,
  event: CognitiveBusEvent,
): Promise<{ ok: boolean; migrationRequired?: boolean }> {
  if (!client) return { ok: true }
  const { error } = await client.from('war_room_council_thread_events').insert({
    id: event.id,
    thread_id: event.threadId,
    event_type: event.type,
    payload: event.payload,
    correlation_id: event.correlationId ?? null,
    created_at: event.at,
  })
  if (error) {
    if (isMissingTableError(error.message)) return { ok: false, migrationRequired: true }
    return { ok: false }
  }
  return { ok: true }
}

export async function persistCouncilThreadState(
  client: WarRoomSupabase | null,
  state: CouncilThreadState,
): Promise<{ ok: boolean; migrationRequired?: boolean }> {
  if (!client) return { ok: true }
  const { error } = await client.from('war_room_council_thread_state').upsert(
    {
      thread_id: state.threadId,
      phase: state.phase,
      correlation_id: state.correlationId,
      operator_packet: state.operatorPacket,
      inherited_context: state.inheritedContext,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'thread_id' },
  )
  if (error) {
    if (isMissingTableError(error.message)) return { ok: false, migrationRequired: true }
    return { ok: false }
  }
  return { ok: true }
}

export async function publishAndPersistBusEvent(
  client: WarRoomSupabase | null,
  input: Parameters<typeof publishCognitiveBusEvent>[0],
): Promise<CognitiveBusEvent> {
  const event = publishCognitiveBusEvent(input)
  const persisted = await persistCognitiveBusEvent(client, event)
  if (persisted.migrationRequired) {
    event.payload = { ...event.payload, migrationHint: MIGRATION_HINT }
  }
  return event
}

export function snapshotThreadForClient(threadId: string, limit = 80) {
  return {
    threadId,
    state: getCouncilThreadState(threadId),
    events: listCognitiveBusEvents(threadId, limit),
  }
}
