import { listRecentEvents } from '@/lib/events/store'
import { getInMemoryRecentEvents } from '@/lib/events/bus'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

function parseLimit(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : 20
  if (!Number.isFinite(n) || n < 1) return 20
  return Math.min(n, 200)
}

function parseOffset(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : 0
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(n, 10_000)
}

export async function GET(req: Request) {
  const sup = tryWarRoomSupabase()
  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const offset = parseOffset(url.searchParams.get('offset'))

  if (sup.ok) {
    const fromDb = await listRecentEvents(sup.client, limit, offset)
    if (fromDb.error) {
      const ring = getInMemoryRecentEvents(RING_WINDOW).slice(offset, offset + limit)
      return jsonWithPersistence(
        {
          events: ring,
          limit,
          offset,
          storeError: fromDb.error,
          note: 'Supabase event table unavailable - returning in-process ring buffer.',
        },
        true,
      )
    }
    return jsonWithPersistence(
      {
        events: fromDb.events,
        limit,
        offset,
        storeError: fromDb.error,
      },
      true,
    )
  }

  const ring = getInMemoryRecentEvents(RING_WINDOW).slice(offset, offset + limit)
  return jsonWithPersistence(
    {
      events: ring,
      limit,
      offset,
      storeError: undefined as string | undefined,
      note: 'Supabase unavailable — returning in-process ring buffer only.',
    },
    false,
  )
}

const RING_WINDOW = 100
