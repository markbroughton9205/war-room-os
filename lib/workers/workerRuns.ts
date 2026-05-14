import type { WorkerRunResult } from '@/lib/workers/types'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

export type WorkerRunRow = {
  id: string
  worker_id: string
  ok: boolean
  detail: Record<string, unknown>
  error: string | null
  created_at: string
}

export async function insertWorkerRun(
  client: WarRoomSupabase | null,
  result: WorkerRunResult,
): Promise<{ persisted: boolean; error?: string }> {
  if (!client) return { persisted: false }

  const { error } = await client.from('war_room_worker_runs').insert({
    worker_id: result.workerId,
    ok: result.ok,
    detail: {
      ...(result.detail ?? {}),
      skippedReason: result.skippedReason,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
    },
    error: result.error ?? null,
  })

  if (error) return { persisted: false, error: error.message }
  return { persisted: true }
}

export async function fetchLatestWorkerRuns(
  client: WarRoomSupabase | null,
): Promise<{ runs: WorkerRunRow[]; error?: string }> {
  if (!client) return { runs: [] }

  const { data, error } = await client
    .from('war_room_worker_runs')
    .select('id,worker_id,ok,detail,error,created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return { runs: [], error: error.message }
  return { runs: (data ?? []) as WorkerRunRow[] }
}
