import { appendEvent, type AppendEventInput, type AppendEventResult } from '@/lib/events/store'
import type { WarRoomEvent } from '@/lib/events/types'
import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

const RING_MAX = 100
const ring: WarRoomEvent[] = []

function pushRing(ev: WarRoomEvent) {
  ring.unshift(ev)
  while (ring.length > RING_MAX) ring.pop()
}

export function getInMemoryRecentEvents(limit: number): WarRoomEvent[] {
  const n = Math.min(Math.max(0, limit), RING_MAX)
  return ring.slice(0, n)
}

export type EmitEventInput = AppendEventInput & {
  supabase: WarRoomSupabase | null
}

export type EmitEventResult = AppendEventResult & {
  event?: WarRoomEvent
  auditWritten: boolean
}

/**
 * Validates type, persists when Supabase is available, mirrors a row into audit (`event`),
 * and pushes to a bounded in-process ring buffer.
 */
export async function emitEvent(input: EmitEventInput): Promise<EmitEventResult> {
  const append = await appendEvent(input.supabase, {
    type: input.type,
    payload: input.payload,
    correlationId: input.correlationId,
    source: input.source,
  })

  const event: WarRoomEvent =
    append.persisted
      ? {
          id: append.id,
          type: input.type,
          createdAt: append.createdAt,
          payload: input.payload,
          correlationId: input.correlationId,
          source: input.source,
        }
      : {
          id: crypto.randomUUID(),
          type: input.type,
          createdAt: new Date().toISOString(),
          payload: input.payload,
          correlationId: input.correlationId,
          source: input.source,
        }

  pushRing(event)

  let auditWritten = false
  if (input.supabase) {
    try {
      await insertWarRoomAuditLog(input.supabase, {
        actor: input.source === 'user' ? 'user' : 'system',
        category: 'event',
        message: `Event ${input.type}`,
        metadata: {
          eventId: event.id,
          type: input.type,
          correlationId: input.correlationId ?? null,
          persisted: append.persisted,
        },
      })
      auditWritten = true
    } catch {
      auditWritten = false
    }
  }

  return { ...append, event, auditWritten }
}

