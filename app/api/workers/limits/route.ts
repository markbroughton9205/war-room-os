import { getResourceSnapshot } from '@/lib/system/resourceMonitor'
import {
  getLimitConstants,
  getWorkerLimitCounters,
  shouldPauseWorkersDueToResources,
} from '@/lib/workers/limits'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const sup = tryWarRoomSupabase()
  const snapshot = getResourceSnapshot()
  const counters = getWorkerLimitCounters()
  const limits = getLimitConstants()
  const paused = shouldPauseWorkersDueToResources(snapshot)
  const now = Date.now()
  const internetAtCap = counters.internetPollsInWindow >= limits.MAX_INTERNET_POLLS_PER_MINUTE
  const sentinelCooldownMs = Math.max(0, limits.RED_SENTINEL_MIN_INTERVAL_MS - (now - counters.lastRedSentinelRunAt))
  const throttled =
    paused
    || counters.activeWorkers >= limits.MAX_CONCURRENT_BACKGROUND_WORKERS
    || counters.activeScans >= limits.MAX_CONCURRENT_SCANS
    || counters.workerQueueDepth >= limits.WORKER_QUEUE_MAX_DEPTH
    || internetAtCap
    || (sentinelCooldownMs > 0 && counters.lastRedSentinelRunAt > 0)

  return jsonWithPersistence(
    {
      limits,
      counters,
      snapshot: {
        memoryUsageRatio: snapshot.memoryUsageRatio,
        warnings: snapshot.warnings,
        loadavg: snapshot.loadavg,
        platform: snapshot.platform,
      },
      paused,
      throttled,
      hints: {
        internetPollsRemaining: Math.max(0, limits.MAX_INTERNET_POLLS_PER_MINUTE - counters.internetPollsInWindow),
        redSentinelRetryAfterMs: sentinelCooldownMs,
      },
    },
    sup.ok,
  )
}
