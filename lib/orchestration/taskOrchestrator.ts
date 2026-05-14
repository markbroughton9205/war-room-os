import { emitEvent } from '@/lib/events/bus'
import { isWarRoomEventType } from '@/lib/events/types'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import { WORKER_QUEUE_MAX_DEPTH } from '@/lib/workers/limits'
import { runWorker } from '@/lib/workers/runner'
import { isWorkerId } from '@/lib/workers/types'
import type { OrchestrationTask, OrchestrationTaskKind } from '@/lib/orchestration/types'

const queue: OrchestrationTask[] = []

export function getOrchestrationQueueDepth(): number {
  return queue.length
}

export function enqueueOrchestrationTask(input: {
  kind: OrchestrationTaskKind
  payload?: Record<string, unknown>
}): { ok: true; task: OrchestrationTask } | { ok: false; skippedReason: string } {
  if (queue.length >= WORKER_QUEUE_MAX_DEPTH) {
    return { ok: false, skippedReason: 'queue_full' }
  }
  const task: OrchestrationTask = {
    id: crypto.randomUUID(),
    kind: input.kind,
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
  }
  queue.push(task)
  return { ok: true, task }
}

export type OrchestrationStepResult = {
  taskId: string
  kind: OrchestrationTaskKind
  ok: boolean
  detail?: Record<string, unknown>
  error?: string
}

export type RunOrchestrationOpts = {
  supabase: WarRoomSupabase | null
  cwd: string
  maxSteps?: number
  correlationId?: string
}

export async function runNextOrchestrationTask(opts: RunOrchestrationOpts): Promise<{ steps: OrchestrationStepResult[] }> {
  const cap = Math.min(Math.max(1, opts.maxSteps ?? 1), 10)
  const steps: OrchestrationStepResult[] = []

  for (let i = 0; i < cap && queue.length > 0; i += 1) {
    const task = queue.shift()!
    await emitEvent({
      supabase: opts.supabase,
      type: 'command.routed',
      payload: { taskId: task.id, kind: task.kind },
      source: 'worker',
      correlationId: opts.correlationId,
    })

    if (task.kind === 'noop') {
      steps.push({ taskId: task.id, kind: task.kind, ok: true, detail: { message: 'noop' } })
      continue
    }

    if (task.kind === 'emit') {
      const t = task.payload.type
      const p = task.payload.payload
      if (typeof t !== 'string' || !isWarRoomEventType(t)) {
        steps.push({ taskId: task.id, kind: task.kind, ok: false, error: 'invalid_emit_payload' })
        continue
      }
      const payload = p && typeof p === 'object' ? (p as Record<string, unknown>) : {}
      const r = await emitEvent({
        supabase: opts.supabase,
        type: t,
        payload,
        source: 'worker',
        correlationId: opts.correlationId,
      })
      steps.push({
        taskId: task.id,
        kind: task.kind,
        ok: r.persisted || Boolean(r.event),
        detail: { persisted: r.persisted, auditWritten: r.auditWritten },
      })
      continue
    }

    if (task.kind === 'run_worker') {
      const wid = task.payload.workerId
      if (typeof wid !== 'string' || !isWorkerId(wid)) {
        steps.push({ taskId: task.id, kind: task.kind, ok: false, error: 'invalid_worker_id' })
        continue
      }
      const wr = await runWorker(wid, {
        supabase: opts.supabase,
        cwd: opts.cwd,
        correlationId: opts.correlationId,
        eventSource: 'worker',
      })
      steps.push({
        taskId: task.id,
        kind: task.kind,
        ok: wr.ok,
        detail: wr.detail,
        error: wr.error ?? wr.skippedReason,
      })
    }
  }

  return { steps }
}
