import { getResourceSnapshot } from '@/lib/system/resourceMonitor'
import { getWorkerLimitCounters } from '@/lib/workers/limits'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const sup = tryWarRoomSupabase()
  const snapshot = getResourceSnapshot()
  const counters = getWorkerLimitCounters()
  return jsonWithPersistence({ snapshot, counters }, sup.ok)
}
