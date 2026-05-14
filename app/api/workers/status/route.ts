import { WORKER_IDS } from '@/lib/workers/types'
import { fetchLatestWorkerRuns, type WorkerRunRow } from '@/lib/workers/workerRuns'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

function latestByWorker(runs: WorkerRunRow[]): Record<string, WorkerRunRow | null> {
  const out = Object.fromEntries(WORKER_IDS.map(id => [id, null])) as Record<string, WorkerRunRow | null>
  for (const row of runs) {
    const wid = row.worker_id
    if (!(WORKER_IDS as readonly string[]).includes(wid)) continue
    if (out[wid] !== null) continue
    out[wid] = row
  }
  return out
}

export async function GET() {
  const sup = tryWarRoomSupabase()
  const { runs, error } = await fetchLatestWorkerRuns(sup.ok ? sup.client : null)
  const latest = latestByWorker(runs)

  return jsonWithPersistence(
    {
      workers: WORKER_IDS.map(id => ({
        workerId: id,
        lastRun: latest[id],
      })),
      runLogError: error,
    },
    sup.ok,
  )
}
