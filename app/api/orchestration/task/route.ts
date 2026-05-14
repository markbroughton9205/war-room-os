import { assertAutoOrApproval } from '@/lib/permissions/policy'
import { emitEvent } from '@/lib/events/bus'
import { enqueueOrchestrationTask, getOrchestrationQueueDepth, runNextOrchestrationTask } from '@/lib/orchestration/taskOrchestrator'
import { isOrchestrationTaskKind } from '@/lib/orchestration/types'
import { fetchWarRoomPermissionsState } from '@/lib/war-room/permissionsState'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACTION_KIND = 'route_planning'

function parseMaxSteps(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : 1
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, 10)
}

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

  const kind = typeof body.kind === 'string' ? body.kind.trim() : ''
  if (!kind || !isOrchestrationTaskKind(kind)) {
    return jsonWithPersistence({ ok: false, skippedReason: 'invalid_kind', error: 'kind must be noop | emit | run_worker.' }, sup.ok, { status: 400 })
  }

  const payload = body.payload && typeof body.payload === 'object' ? (body.payload as Record<string, unknown>) : {}
  const maxSteps = parseMaxSteps(body.maxSteps)
  const correlationId = typeof body.correlationId === 'string' ? body.correlationId : undefined

  const enq = enqueueOrchestrationTask({ kind, payload })
  if (!enq.ok) {
    return jsonWithPersistence(
      { ok: false, skippedReason: enq.skippedReason, queueDepth: getOrchestrationQueueDepth() },
      sup.ok,
      { status: 429 },
    )
  }

  await emitEvent({
    supabase: sup.ok ? sup.client : null,
    type: 'command.received',
    payload: { taskId: enq.task.id, kind: enq.task.kind },
    source: 'user',
    correlationId,
  })

  const ran = await runNextOrchestrationTask({
    supabase: sup.ok ? sup.client : null,
    cwd: process.cwd(),
    maxSteps,
    correlationId,
  })

  return jsonWithPersistence(
    {
      ok: true,
      task: enq.task,
      steps: ran.steps,
      queueDepth: getOrchestrationQueueDepth(),
    },
    sup.ok,
    { status: 201 },
  )
}
