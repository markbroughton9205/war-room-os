import { assertAutoOrApproval } from '@/lib/permissions/policy'
import { insertWorkerRun } from '@/lib/workers/workerRuns'
import { runWorker } from '@/lib/workers/runner'
import { isWorkerId } from '@/lib/workers/types'
import { fetchWarRoomPermissionsState } from '@/lib/war-room/permissionsState'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACTION_KIND = 'engine_probe'

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    body = {}
  }

  const state = await fetchWarRoomPermissionsState(sup.ok ? sup.client : null)
  const gate = assertAutoOrApproval({
    mode: state.mode,
    safetyLock: state.safetyLock,
    actionKind: ACTION_KIND,
    body,
  })

  if (!gate.ok) {
    return jsonWithPersistence({ ok: false, skippedReason: 'forbidden', error: gate.error }, sup.ok, { status: gate.status })
  }

  const workerId = typeof body.workerId === 'string' ? body.workerId.trim() : ''
  if (!workerId || !isWorkerId(workerId)) {
    return jsonWithPersistence({ ok: false, skippedReason: 'invalid_worker', error: 'workerId must be a registered worker.' }, sup.ok, { status: 400 })
  }

  const correlationId = typeof body.correlationId === 'string' ? body.correlationId : undefined

  const result = await runWorker(workerId, {
    supabase: sup.ok ? sup.client : null,
    cwd: process.cwd(),
    correlationId,
    eventSource: 'worker',
  })

  const log = await insertWorkerRun(sup.ok ? sup.client : null, result)

  if (!result.ok && result.skippedReason === 'limits') {
    const retry = typeof result.detail?.retryAfterMs === 'number' ? result.detail.retryAfterMs : 2000
    const s = Math.max(1, Math.ceil(retry / 1000))
    return jsonWithPersistence(
      { ok: false, result, runLog: log, skippedReason: result.skippedReason },
      sup.ok,
      { status: 429, headers: { 'Retry-After': String(s) } },
    )
  }

  if (!result.ok && result.skippedReason === 'red_sentinel_interval') {
    const retry = typeof result.detail?.retryAfterMs === 'number' ? result.detail.retryAfterMs : 15_000
    const s = Math.max(1, Math.ceil(retry / 1000))
    return jsonWithPersistence(
      { ok: false, result, runLog: log, skippedReason: result.skippedReason },
      sup.ok,
      { status: 429, headers: { 'Retry-After': String(s) } },
    )
  }

  if (!result.ok && result.skippedReason === 'internet_poll_rate_limited') {
    return jsonWithPersistence(
      { ok: false, result, runLog: log, skippedReason: result.skippedReason },
      sup.ok,
      { status: 429, headers: { 'Retry-After': '60' } },
    )
  }

  return jsonWithPersistence({ ok: result.ok, result, runLog: log }, sup.ok, { status: result.ok ? 200 : 422 })
}
