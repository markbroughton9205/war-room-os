import type { WarRoomEvent, WarRoomEventSource, WarRoomEventType } from '@/lib/events/types'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

export type AppendEventInput = {
  type: WarRoomEventType
  payload: Record<string, unknown>
  correlationId?: string
  source: WarRoomEventSource
}

export type AppendEventResult =
  | { persisted: true; id: string; createdAt: string }
  | { persisted: false; reason: 'no_supabase' | 'insert_failed'; detail?: string }

function clampLimit(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 20
  return Math.min(n, 200)
}

function clampOffset(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(n, 10_000)
}

export async function appendEvent(
  client: WarRoomSupabase | null,
  input: AppendEventInput,
): Promise<AppendEventResult> {
  if (!client) {
    return { persisted: false, reason: 'no_supabase' }
  }

  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  const { error } = await client.from('war_room_events').insert({
    id,
    type: input.type,
    payload: input.payload,
    correlation_id: input.correlationId ?? null,
    source: input.source,
    created_at: createdAt,
  })

  if (error) {
    return { persisted: false, reason: 'insert_failed', detail: error.message }
  }

  return { persisted: true, id, createdAt }
}

export type StoredEventRow = {
  id: string
  type: string
  payload: Record<string, unknown>
  correlation_id: string | null
  source: string
  created_at: string
}

export function rowToWarRoomEvent(row: StoredEventRow): WarRoomEvent {
  return {
    id: row.id,
    type: row.type as WarRoomEvent['type'],
    createdAt: row.created_at,
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    correlationId: row.correlation_id ?? undefined,
    source: row.source === 'user' || row.source === 'worker' ? row.source : 'system',
  }
}

export async function listRecentEvents(
  client: WarRoomSupabase | null,
  limit: number,
  offset: number,
): Promise<{ events: WarRoomEvent[]; error?: string }> {
  if (!client) {
    return { events: [] }
  }

  const lim = clampLimit(limit)
  const off = clampOffset(offset)

  const { data, error } = await client
    .from('war_room_events')
    .select('id,type,payload,correlation_id,source,created_at')
    .order('created_at', { ascending: false })
    .range(off, off + lim - 1)

  if (error) {
    return { events: [], error: error.message }
  }

  const rows = (data ?? []) as StoredEventRow[]
  return { events: rows.map(rowToWarRoomEvent) }
}

export async function countEvents(client: WarRoomSupabase | null): Promise<number | null> {
  if (!client) return null
  const { count, error } = await client.from('war_room_events').select('*', { count: 'exact', head: true })
  if (error) return null
  return typeof count === 'number' ? count : null
}
