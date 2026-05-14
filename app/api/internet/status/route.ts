import { buildWarRoomInternetLayerStatus } from '@/lib/internet/warRoomInternetStatus'
import { getResourceSnapshot } from '@/lib/system/resourceMonitor'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  canRunInternetPoll,
  recordInternetPoll,
  shouldPauseWorkersDueToResources,
} from '@/lib/workers/limits'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const sup = tryWarRoomSupabase()
  const snapshot = getResourceSnapshot()
  if (shouldPauseWorkersDueToResources(snapshot)) {
    return jsonWithPersistence(
      { error: 'Server memory pressure high; try again shortly.', retryAfterMs: 5000 },
      sup.ok,
      { status: 429, headers: { 'Retry-After': '5' } },
    )
  }
  if (!canRunInternetPoll()) {
    return jsonWithPersistence(
      { error: 'Internet poll rate limit exceeded.', retryAfterMs: 60_000 },
      sup.ok,
      { status: 429, headers: { 'Retry-After': '60' } },
    )
  }
  recordInternetPoll()
  const status = await buildWarRoomInternetLayerStatus()
  return jsonWithPersistence(status, sup.ok)
}
