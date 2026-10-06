import { concurrencyPolicy, mapPool, resourceClassForTask } from '@/lib/council/intelligence/adaptiveIntelligence'
import { measureParallelOverlap } from '../hierarchical-planning/engine'
import { createEngineReceipt } from '../receipts'
import type { DispatchResult } from '../dispatch/types'
import type { PlanNode } from '../hierarchical-planning/types'

export type WaveTask = {
  node: PlanNode
  run: () => Promise<DispatchResult>
  resource_class?: ReturnType<typeof resourceClassForTask>
}

export type WaveResult = {
  wave_id: string
  mission_id: string
  task_ids: string[]
  started_at: string
  completed_at: string
  overlap_ms: number
  parallelism: 'PARALLEL' | 'SERIAL'
  max_local_model: 1
  results: DispatchResult[]
  dependency_wait_ms: number
  receipt: ReturnType<typeof createEngineReceipt>
}

export async function executeParallelWave(input: {
  wave_id: string
  mission_id: string
  tasks: WaveTask[]
  dependency_wait_ms?: number
}): Promise<WaveResult> {
  const startedMs = Date.now()
  const started_at = new Date(startedMs).toISOString()
  const policy = concurrencyPolicy({ localGeneralReady: true, browserReady: true })
  let localInFlight = 0
  const waiters: Array<() => void> = []
  const acquireLocal = async () => {
    while (localInFlight >= policy.max_local_model) {
      await new Promise<void>(resolve => waiters.push(resolve))
    }
    localInFlight += 1
  }
  const releaseLocal = () => {
    localInFlight = Math.max(0, localInFlight - 1)
    const next = waiters.shift()
    if (next) next()
  }

  const results = await mapPool(input.tasks, Math.max(1, input.tasks.length), async task => {
    const cls = task.resource_class ?? resourceClassForTask({
      role: task.node.assigned_role,
      tools: task.node.candidate_tools,
      tools_required: task.node.candidate_tools,
    })
    if (cls === 'LOCAL_MODEL') await acquireLocal()
    try {
      return await task.run()
    } finally {
      if (cls === 'LOCAL_MODEL') releaseLocal()
    }
  })

  const overlap = measureParallelOverlap(results.map(row => ({
    task_id: row.task_id,
    started_at: row.started_at,
    completed_at: row.completed_at,
    depends_on: [],
  })))
  const completed_at = new Date().toISOString()
  const parallelism = overlap.overlap_ms > 0 ? 'PARALLEL' as const : 'SERIAL' as const
  return {
    wave_id: input.wave_id,
    mission_id: input.mission_id,
    task_ids: input.tasks.map(task => task.node.id),
    started_at,
    completed_at,
    overlap_ms: overlap.overlap_ms,
    parallelism,
    max_local_model: 1,
    results,
    dependency_wait_ms: input.dependency_wait_ms ?? 0,
    receipt: createEngineReceipt({
      engine: 'parallel-wave',
      mission_id: input.mission_id,
      input_refs: input.tasks.map(task => task.node.id),
      output_refs: [parallelism, `overlap:${overlap.overlap_ms}`],
      started_at: startedMs,
      decision_count: results.length,
      decision: parallelism,
    }),
  }
}
