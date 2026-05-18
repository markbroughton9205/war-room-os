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
      const step = {
        taskId: task.id,
        kind: task.kind,
        ok: true,
        detail: {
          message: 'Bounded orchestration health step completed. No shell, file mutation, deployment, spend, outreach, worker execution, or hidden action was performed.',
          bounded: true,
          canExecuteExternalActions: false,
        },
      } satisfies OrchestrationStepResult
      await emitEvent({
        supabase: opts.supabase,
        type: 'action.completed',
        payload: {
          taskId: task.id,
          kind: task.kind,
          result: step.detail,
          hiddenActionPerformed: false,
          shellExecuted: false,
          fileMutationPerformed: false,
          deploymentPerformed: false,
        },
        source: 'system',
        correlationId: opts.correlationId,
      })
      steps.push(step)
      continue
    }

    if (task.kind === 'emit') {
      const t = task.payload.type
      const p = task.payload.payload
      if (typeof t !== 'string' || !isWarRoomEventType(t)) {
        const step = { taskId: task.id, kind: task.kind, ok: false, error: 'invalid_emit_payload' } satisfies OrchestrationStepResult
        await emitEvent({
          supabase: opts.supabase,
          type: 'action.failed',
          payload: { taskId: task.id, kind: task.kind, error: step.error },
          source: 'system',
          correlationId: opts.correlationId,
        })
        steps.push(step)
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
      const step = {
        taskId: task.id,
        kind: task.kind,
        ok: r.persisted || Boolean(r.event),
        detail: { persisted: r.persisted, auditWritten: r.auditWritten },
      } satisfies OrchestrationStepResult
      await emitEvent({
        supabase: opts.supabase,
        type: step.ok ? 'action.completed' : 'action.failed',
        payload: { taskId: task.id, kind: task.kind, result: step.detail },
        source: 'system',
        correlationId: opts.correlationId,
      })
      steps.push(step)
      continue
    }

    if (task.kind === 'run_worker') {
      const wid = task.payload.workerId
      if (typeof wid !== 'string' || !isWorkerId(wid)) {
        const step = { taskId: task.id, kind: task.kind, ok: false, error: 'invalid_worker_id' } satisfies OrchestrationStepResult
        await emitEvent({
          supabase: opts.supabase,
          type: 'action.failed',
          payload: { taskId: task.id, kind: task.kind, error: step.error },
          source: 'system',
          correlationId: opts.correlationId,
        })
        steps.push(step)
        continue
      }
      const wr = await runWorker(wid, {
        supabase: opts.supabase,
        cwd: opts.cwd,
        correlationId: opts.correlationId,
        eventSource: 'worker',
      })
      const step = {
        taskId: task.id,
        kind: task.kind,
        ok: wr.ok,
        detail: wr.detail,
        error: wr.error ?? wr.skippedReason,
      } satisfies OrchestrationStepResult
      await emitEvent({
        supabase: opts.supabase,
        type: step.ok ? 'action.completed' : 'action.failed',
        payload: { taskId: task.id, kind: task.kind, result: step.detail ?? {}, error: step.error ?? null },
        source: 'system',
        correlationId: opts.correlationId,
      })
      steps.push(step)
    }
  }

  return { steps }
}
