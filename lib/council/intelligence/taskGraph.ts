/**
 * Live mission task graph. ATLAS still owns planning; this tracks execution state.
 * Executive may schedule READY tasks in parallel. Does not execute tools.
 */

import type { AtlasPlanGraph, MissionContractV1 } from './types'
import type { CognitiveStrategy, CognitiveTask, CognitiveTaskGraph, CognitiveTaskStatus } from './orchestrationTypes'
import { TASK_GRAPH_SCHEMA } from './orchestrationTypes'

export function taskGraphFromAtlas(input: {
  contract: MissionContractV1
  plan: AtlasPlanGraph | null
  strategy: CognitiveStrategy
  now?: string
}): CognitiveTaskGraph {
  const now = input.now ?? new Date().toISOString()
  const tasks: CognitiveTask[] = (input.plan?.steps ?? []).map(step => {
    const status: CognitiveTaskStatus = step.status === 'BLOCKED_BY_AUTHORITY'
      ? 'WAITING_AUTHORITY'
      : step.status === 'BLOCKED_BY_RISK'
        ? 'BLOCKED'
        : step.status === 'BLOCKED_BY_EVIDENCE'
          ? 'WAITING_EVIDENCE'
          : step.depends_on.length === 0
            ? 'READY'
            : 'PLANNED'
    return {
      task_id: step.step_id,
      mission_id: input.contract.mission_id,
      objective: step.purpose,
      assigned_role: inferRole(step.required_capabilities, step.title),
      required_inputs: step.depends_on,
      depends_on: step.depends_on,
      evidence_required: step.required_evidence,
      tools_required: step.required_capabilities,
      authority_required: step.approval_required || step.status === 'BLOCKED_BY_AUTHORITY',
      expected_output: step.expected_output,
      completion_condition: `evidence classes: ${step.required_evidence.join(',') || 'none'}`,
      failure_condition: 'required evidence missing or authority denied',
      status,
      attempt: 0,
      revision: 1,
      created_at: now,
      started_at: null,
      completed_at: null,
    }
  })

  if (!tasks.length && input.strategy.planning_depth !== 'NONE') {
    tasks.push({
      task_id: 't-understand',
      mission_id: input.contract.mission_id,
      objective: input.contract.objective,
      assigned_role: 'ORION',
      required_inputs: [],
      depends_on: [],
      evidence_required: input.contract.required_evidence,
      tools_required: input.contract.required_tools,
      authority_required: false,
      expected_output: 'structured understanding',
      completion_condition: 'objective addressed within authority',
      failure_condition: 'authority bypass or invented facts',
      status: 'READY',
      attempt: 0,
      revision: 1,
      created_at: now,
      started_at: null,
      completed_at: null,
    })
  }

  return Object.freeze({
    schema: TASK_GRAPH_SCHEMA,
    mission_id: input.contract.mission_id,
    tasks,
    parallel_groups: (input.plan?.parallelizable_groups && input.plan.parallelizable_groups.length > 0)
      ? input.plan.parallelizable_groups
      : [tasks.filter(t => t.depends_on.length === 0).map(t => t.task_id)].filter(g => g.length > 0),
    ready: readyTasks(tasks).map(t => t.task_id),
  })
}

export function readyTasks(tasks: readonly CognitiveTask[]): CognitiveTask[] {
  const done = new Set(tasks.filter(t => t.status === 'COMPLETE' || t.status === 'SUPERSEDED').map(t => t.task_id))
  return tasks.filter(t => {
    if (t.status !== 'READY' && t.status !== 'PLANNED') return false
    return t.depends_on.every(id => done.has(id) || !tasks.some(other => other.task_id === id))
      || t.depends_on.length === 0
  }).filter(t => t.status === 'READY' || (t.status === 'PLANNED' && t.depends_on.every(id => done.has(id))))
}

export function markTask(graph: CognitiveTaskGraph, taskId: string, status: CognitiveTaskStatus, at: string): CognitiveTaskGraph {
  const tasks = graph.tasks.map(task => {
    if (task.task_id !== taskId) return task
    return {
      ...task,
      status,
      started_at: status === 'RUNNING' ? (task.started_at ?? at) : task.started_at,
      completed_at: status === 'COMPLETE' || status === 'FAILED' || status === 'SUPERSEDED' ? at : task.completed_at,
      attempt: status === 'RUNNING' ? task.attempt + 1 : task.attempt,
    }
  })
  const next: CognitiveTaskGraph = {
    ...graph,
    tasks,
    ready: readyTasks(tasks).map(t => t.task_id),
  }
  return Object.freeze(next)
}

export function supersedeTasks(graph: CognitiveTaskGraph, ids: readonly string[], at: string): CognitiveTaskGraph {
  let next = graph
  for (const id of ids) next = markTask(next, id, 'SUPERSEDED', at)
  return next
}

function inferRole(caps: readonly string[], title: string): CognitiveTask['assigned_role'] {
  if (/PHOENIX|challenge/i.test(title) || caps.includes('adversarial_review')) return 'PHOENIX'
  if (/LUMEN|verif/i.test(title) || caps.includes('verification')) return 'LUMEN'
  if (/PULSAR|research|browser/i.test(title) || caps.includes('research.web') || caps.includes('browser.fetch')) return 'PULSAR'
  if (/AURORA|synthes/i.test(title) || caps.includes('synthesis')) return 'AURORA'
  if (/NOVA|schema|tabulat/i.test(title)) return 'NOVA'
  if (/JANUS|scenario/i.test(title)) return 'JANUS'
  if (/SENTINEL|risk/i.test(title)) return 'SENTINEL'
  if (/ATLAS|plan/i.test(title)) return 'ATLAS'
  return 'ORION'
}
