/**
 * Adaptive ATLAS replanning. No silent plan rewrite.
 * Old plan, why changed, new plan, affected tasks, receipt.
 */

import { createReceipt } from './receipts'
import { markTask, supersedeTasks, taskGraphFromAtlas } from './taskGraph'
import { planWithAtlas } from './atlas'
import type { AtlasPlanGraph, ExecutionReceipt, MissionContractV1 } from './types'
import type { CognitiveStrategy, CognitiveTaskGraph, PlanRevision } from './orchestrationTypes'

export type ReplanTrigger =
  | 'EVIDENCE_CONTRADICTS_ASSUMPTION'
  | 'TOOL_UNAVAILABLE'
  | 'DEPENDENCY_FAILS'
  | 'RISK_APPEARS'
  | 'SCOPE_CHANGES'
  | 'COMMANDER_AMENDS'
  | 'BETTER_PATH'
  | 'TASK_UNNECESSARY'

export function maybeReplan(input: {
  contract: MissionContractV1
  strategy: CognitiveStrategy
  graph: CognitiveTaskGraph
  plan: AtlasPlanGraph | null
  trigger: ReplanTrigger | null
  unavailableTool?: string | null
  now?: string
}): { graph: CognitiveTaskGraph; plan: AtlasPlanGraph | null; revision: PlanRevision | null; receipt: ExecutionReceipt | null } {
  if (!input.trigger || input.strategy.replanning_threshold === 'NEVER') {
    return { graph: input.graph, plan: input.plan, revision: null, receipt: null }
  }
  if (input.strategy.replanning_threshold === 'ON_FAILURE' && input.trigger !== 'TOOL_UNAVAILABLE' && input.trigger !== 'DEPENDENCY_FAILS') {
    return { graph: input.graph, plan: input.plan, revision: null, receipt: null }
  }
  const now = input.now ?? new Date().toISOString()
  const oldIds = input.graph.tasks.map(t => t.task_id)
  let graph = input.graph
  const affected = input.graph.tasks
    .filter(t => input.unavailableTool && t.tools_required.includes(input.unavailableTool) && t.status !== 'COMPLETE')
    .map(t => t.task_id)
  if (affected.length) graph = supersedeTasks(graph, affected, now)
  for (const task of graph.tasks) {
    if (task.status === 'SUPERSEDED') continue
    if (input.trigger === 'TOOL_UNAVAILABLE' && input.unavailableTool && task.tools_required.includes(input.unavailableTool)) {
      graph = markTask(graph, task.task_id, 'REPLAN_REQUIRED', now)
    }
  }
  const newPlan = planWithAtlas({ contract: input.contract, now })
  const added = newPlan.steps.filter(step => !oldIds.includes(step.step_id)).map(s => s.step_id)
  const merged = taskGraphFromAtlas({ contract: input.contract, plan: newPlan, strategy: input.strategy, now })
  const combined: CognitiveTaskGraph = {
    ...merged,
    tasks: [
      ...graph.tasks.filter(t => t.status === 'SUPERSEDED' || t.status === 'COMPLETE'),
      ...merged.tasks.map(t => (affected.includes(t.task_id) ? { ...t, revision: t.revision + 1, status: 'READY' as const } : t)),
    ],
  }
  if (input.trigger === 'DEPENDENCY_FAILS') {
    combined.tasks = combined.tasks.map(t => t.depends_on.length && t.status !== 'COMPLETE' && t.status !== 'SUPERSEDED'
      ? { ...t, status: 'BLOCKED' as const }
      : t)
  }
  const receipt = createReceipt({
    missionId: input.contract.mission_id,
    capability: 'atlas.replan',
    requestedAction: `replan:${input.trigger}`,
    authorityResult: 'ALLOW_WITH_RECEIPT',
    startedAt: now,
    completedAt: now,
    success: true,
    resultSummary: `ATLAS revision because ${input.trigger}. affected=${affected.join(',') || 'none'}`,
    evidenceIds: [],
    runtimeIdentity: null,
  })
  const revision: PlanRevision = {
    revision: (input.plan ? 2 : 1),
    reason: input.trigger,
    old_task_ids: oldIds,
    new_task_ids: added.length ? added : combined.tasks.filter(t => t.status !== 'SUPERSEDED').map(t => t.task_id),
    affected_tasks: affected,
    receipt_id: receipt.receipt_id,
    created_at: now,
  }
  return { graph: Object.freeze(combined), plan: newPlan, revision, receipt }
}
