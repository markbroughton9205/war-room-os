import { countEvents } from '@/lib/events/store'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

export async function GET() {
  const sup = tryWarRoomSupabase()
  const total = sup.ok ? await countEvents(sup.client) : null
  const recentDefault = '/api/events/recent?limit=20'

  return jsonWithPersistence(
    {
      ok: true,
      persistence: sup.ok ? 'available' : 'unavailable',
      eventCount: total,
      recent: recentDefault,
      endpoints: {
        recent: '/api/events/recent',
        emit: 'POST /api/events/emit',
      },
    },
    sup.ok,
  )
}
