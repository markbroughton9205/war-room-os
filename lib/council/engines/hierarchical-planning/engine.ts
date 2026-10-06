import { concurrencyPolicy } from '@/lib/council/intelligence/adaptiveIntelligence'
import { createEngineReceipt } from '../receipts'
import type { HierarchicalPlan, HierarchicalPlanInput, HierarchicalPlanResult, ParallelMeasurement, PlanNode } from './types'

function hashPlan(nodes: readonly PlanNode[]): string {
  const key = nodes.map(node => `${node.id}|${node.parent_id}|${node.dependencies.join(',')}|${node.candidate_tools.join(',')}|${node.status}`).join(';')
  let h = 2166136261
  for (const ch of key) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return `plan-${(h >>> 0).toString(16)}`
}

function phaseFor(title: string, index: number): { id: string; objective: string } {
  if (/discover|identif/i.test(title)) return { id: 'phase-discover', objective: 'DISCOVER' }
  if (/gather|collect|retriev|pulsar|orion/i.test(title)) return { id: 'phase-collect', objective: 'COLLECT' }
  if (/lumen|verif|phoenix|challenge/i.test(title)) return { id: 'phase-verify', objective: 'VERIFY' }
  if (/aurora|synth/i.test(title)) return { id: 'phase-synthesize', objective: 'SYNTHESIZE' }
  return { id: `phase-${index + 1}`, objective: `PHASE ${index + 1}` }
}

function inferRole(title: string, caps: readonly string[]): string {
  if (/PHOENIX|challenge/i.test(title) || caps.includes('adversarial_review')) return 'PHOENIX'
  if (/LUMEN|verif/i.test(title) || caps.includes('verification')) return 'LUMEN'
  if (/PULSAR|research|browser/i.test(title) || caps.includes('research.web') || caps.includes('browser.fetch')) return 'PULSAR'
  if (/ORION|inspect|probe|diagnos/i.test(title)) return 'ORION'
  if (/AURORA|synth/i.test(title)) return 'AURORA'
  return 'ATLAS'
}

export function measureParallelOverlap(tasks: HierarchicalPlanInput['tasks']): ParallelMeasurement {
  const timed = (tasks ?? []).filter(row => row.started_at && row.completed_at)
  let overlap = 0
  for (let i = 0; i < timed.length; i += 1) {
    for (let j = i + 1; j < timed.length; j += 1) {
      const a0 = Date.parse(timed[i].started_at as string)
      const a1 = Date.parse(timed[i].completed_at as string)
      const b0 = Date.parse(timed[j].started_at as string)
      const b1 = Date.parse(timed[j].completed_at as string)
      const start = Math.max(a0, b0)
      const end = Math.min(a1, b1)
      if (end > start) overlap += end - start
    }
  }
  const claimed = overlap > 0
  return {
    claimed_parallel: claimed,
    overlap_ms: overlap,
    max_local_model: 1,
    serial_mislabel: !claimed && timed.length >= 2,
  }
}

export function buildHierarchicalPlan(input: HierarchicalPlanInput): HierarchicalPlanResult {
  const started = Date.now()
  const nodes: PlanNode[] = [{
    id: `mission-${input.mission_id}`,
    parent_id: null,
    kind: 'MISSION',
    objective: input.objective,
    dependencies: [],
    evidence_requirement: [],
    assigned_role: 'ATLAS',
    candidate_tools: [],
    budget: {},
    completion_condition: 'EBC satisfies required evidence without busywork',
    failure_policy: 'localized replan of affected subtree',
    authority_requirement: 'NONE',
    parallelizable: false,
    status: input.ebc_satisfied ? 'STOPPED' : 'PLANNED',
  }]

  if (input.ebc_satisfied) {
    const plan = {
      mission_id: input.mission_id,
      nodes,
      edges: [] as HierarchicalPlan['edges'],
      parallel_groups: [],
      atlas_role: 'ATLAS' as const,
      grants_authority: false as const,
      equivalent_to_previous: false,
      stopped_for_completion: true,
      change_reason: 'EBC already satisfies the mission; no additional tasks',
    }
    return {
      plan,
      plan_hash: hashPlan(nodes),
      parallelism: { claimed_parallel: false, overlap_ms: 0, max_local_model: 1, serial_mislabel: false },
      receipt: createEngineReceipt({
        engine: 'hierarchical-planning',
        mission_id: input.mission_id,
        input_refs: [input.objective],
        output_refs: ['STOPPED'],
        started_at: started,
        decision_count: 1,
        decision: 'STOP',
      }),
    }
  }

  let steps = input.atlas_plan?.steps ?? []
  if (!steps.length) {
    steps = [
      { step_id: 's1', title: 'identify candidate sources', purpose: 'DISCOVER', depends_on: [], required_capabilities: ['research.web'], required_evidence: [], expected_output: 'candidates', approval_required: false, status: 'PLANNED', parallel_group: null },
      { step_id: 's2a', title: 'retrieve primary source', purpose: 'COLLECT primary', depends_on: ['s1'], required_capabilities: ['browser.fetch'], required_evidence: ['primary_external'], expected_output: 'primary evidence', approval_required: false, status: 'PLANNED', parallel_group: 'collect' },
      { step_id: 's2b', title: 'retrieve independent corroboration', purpose: 'COLLECT corroboration', depends_on: ['s1'], required_capabilities: ['browser.fetch'], required_evidence: ['primary_external'], expected_output: 'independent evidence', approval_required: false, status: 'PLANNED', parallel_group: 'collect' },
      { step_id: 's3', title: 'bind evidence / resolve contradiction', purpose: 'VERIFY', depends_on: ['s2a', 's2b'], required_capabilities: ['verification'], required_evidence: ['primary_external'], expected_output: 'bindings', approval_required: false, status: 'PLANNED', parallel_group: null },
      { step_id: 's4', title: 'AURORA response', purpose: 'SYNTHESIZE', depends_on: ['s3'], required_capabilities: ['synthesis'], required_evidence: [], expected_output: 'commander brief', approval_required: false, status: 'PLANNED', parallel_group: null },
    ]
  }

  const phases = new Map<string, PlanNode>()
  const edges: HierarchicalPlan['edges'] = []
  steps.forEach((step, index) => {
    const phase = phaseFor(step.title, index)
    if (!phases.has(phase.id)) {
      const node: PlanNode = {
        id: phase.id,
        parent_id: `mission-${input.mission_id}`,
        kind: 'PHASE',
        objective: phase.objective,
        dependencies: [],
        evidence_requirement: [],
        assigned_role: 'ATLAS',
        candidate_tools: [],
        budget: {},
        completion_condition: `${phase.objective} outputs present`,
        failure_policy: 'replan this phase only',
        authority_requirement: 'NONE',
        parallelizable: Boolean(step.parallel_group),
        status: 'PLANNED',
      }
      phases.set(phase.id, node)
      nodes.push(node)
    }
    const failed = input.failed_task_id === step.step_id
    const task: PlanNode = {
      id: step.step_id,
      parent_id: phase.id,
      kind: 'TASK',
      objective: step.purpose,
      dependencies: [...step.depends_on],
      evidence_requirement: [...step.required_evidence],
      assigned_role: inferRole(step.title, step.required_capabilities),
      candidate_tools: [...step.required_capabilities],
      budget: {},
      completion_condition: step.expected_output,
      failure_policy: failed ? 'localized replan of this subtree' : 'mark failed and replan dependents',
      authority_requirement: step.approval_required || step.status === 'BLOCKED_BY_AUTHORITY' ? 'COMMANDER' : 'NONE',
      parallelizable: Boolean(step.parallel_group) || siblingsIndependent(step, steps),
      status: step.status === 'BLOCKED_BY_AUTHORITY' ? 'WAITING_AUTHORITY' : failed ? 'FAILED' : 'PLANNED',
    }
    nodes.push(task)
    for (const dep of step.depends_on) {
      edges.push({ from: dep, to: step.step_id, kind: 'requires' })
      edges.push({ from: step.step_id, to: dep, kind: 'consumes' })
      edges.push({ from: dep, to: step.step_id, kind: 'blocks' })
    }
    if (task.parallelizable) {
      for (const other of steps) {
        if (other.step_id === step.step_id) continue
        if (other.parallel_group && other.parallel_group === step.parallel_group) {
          edges.push({ from: step.step_id, to: other.step_id, kind: 'can_parallelize_with' })
        } else if (siblingsIndependent(step, [other])) {
          edges.push({ from: step.step_id, to: other.step_id, kind: 'can_parallelize_with' })
        }
      }
    }
    for (const tool of step.required_capabilities) {
      nodes.push({
        id: `${step.step_id}:${tool}`,
        parent_id: step.step_id,
        kind: 'TOOL_ACTION',
        objective: tool,
        dependencies: [],
        evidence_requirement: [...step.required_evidence],
        assigned_role: task.assigned_role,
        candidate_tools: [tool],
        budget: {},
        completion_condition: 'tool receipt success',
        failure_policy: 'bounded retry then alternate',
        authority_requirement: task.authority_requirement,
        parallelizable: false,
        status: task.authority_requirement === 'COMMANDER' ? 'WAITING_AUTHORITY' : 'PLANNED',
      })
      edges.push({ from: `${step.step_id}:${tool}`, to: step.step_id, kind: 'produces' })
    }
  })

  const planHash = hashPlan(nodes)
  const equivalent = Boolean(input.previous_plan_hash && input.previous_plan_hash === planHash)
  const dependents = new Set<string>()
  if (input.failed_task_id) {
    dependents.add(input.failed_task_id)
    for (const edge of edges) {
      if (edge.kind === 'requires' && dependents.has(edge.from)) dependents.add(edge.to)
    }
  }
  const localized = nodes.map(node => (
    input.failed_task_id && dependents.has(node.id) && node.kind === 'TASK' && node.id !== input.failed_task_id
      ? { ...node, status: 'PLANNED' as const, failure_policy: 'localized replan after parent failure' }
      : node
  ))

  const policy = concurrencyPolicy({ localGeneralReady: true, browserReady: true })
  void policy.max_local_model
  const plan: HierarchicalPlan = {
    mission_id: input.mission_id,
    nodes: localized,
    edges,
    parallel_groups: input.atlas_plan?.parallelizable_groups ?? collectParallelGroups(steps),
    atlas_role: 'ATLAS',
    grants_authority: false,
    equivalent_to_previous: equivalent,
    stopped_for_completion: false,
    change_reason: equivalent ? 'equivalent plan detected; no thrash' : (input.failed_task_id ? `localized replan of ${input.failed_task_id}` : null),
  }
  return {
    plan,
    plan_hash: planHash,
    parallelism: measureParallelOverlap(input.tasks),
    receipt: createEngineReceipt({
      engine: 'hierarchical-planning',
      mission_id: input.mission_id,
      task_id: input.failed_task_id ?? undefined,
      input_refs: steps.map(step => step.step_id),
      output_refs: localized.map(node => node.id),
      started_at: started,
      decision_count: localized.length,
      decision: equivalent ? 'STABLE' : input.failed_task_id ? 'LOCAL_REPLAN' : 'PLAN',
    }),
  }
}

export function mayExecutePlanNode(node: PlanNode, commanderAuthorized = false): boolean {
  if (node.authority_requirement === 'COMMANDER' && !commanderAuthorized) return false
  if (node.status === 'WAITING_AUTHORITY' && !commanderAuthorized) return false
  return true
}

function siblingsIndependent(
  step: NonNullable<HierarchicalPlanInput['atlas_plan']>['steps'][number],
  others: NonNullable<HierarchicalPlanInput['atlas_plan']>['steps'],
): boolean {
  return others.some(other =>
    other.step_id !== step.step_id
    && !step.depends_on.includes(other.step_id)
    && !other.depends_on.includes(step.step_id)
    && JSON.stringify(step.depends_on) === JSON.stringify(other.depends_on)
    && (Boolean(step.parallel_group) && step.parallel_group === other.parallel_group || !step.depends_on.length && !other.depends_on.length),
  )
}

function collectParallelGroups(steps: NonNullable<HierarchicalPlanInput['atlas_plan']>['steps']): string[][] {
  const groups = new Map<string, string[]>()
  for (const step of steps) {
    if (!step.parallel_group) continue
    const list = groups.get(step.parallel_group) ?? []
    list.push(step.step_id)
    groups.set(step.parallel_group, list)
  }
  const named = [...groups.values()].filter(group => group.length > 1)
  const independent = steps.filter(step => !step.depends_on.length).map(step => step.step_id)
  if (independent.length > 1) named.push(independent)
  return named
}

export function dependentWouldRace(plan: HierarchicalPlan, taskId: string): boolean {
  const ready = plan.nodes.filter(node => node.kind === 'TASK' && node.status === 'RUNNING').map(node => node.id)
  return plan.edges.some(edge => edge.kind === 'requires' && edge.to === taskId && !plan.nodes.some(node => node.id === edge.from && (node.status === 'COMPLETE' || node.status === 'SUPERSEDED')))
    || ready.some(id => plan.edges.some(edge => edge.kind === 'requires' && edge.from === id && edge.to === taskId))
}
