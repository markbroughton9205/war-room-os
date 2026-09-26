/**
 * The engineering plan: an explicit, versioned, inspectable model that Foundry builds from project truth and revises when
 * evidence changes. It lives inside the existing campaign record (`campaign.plan`); it is not a second store and it does not
 * replace the campaign task graph. The task graph is what executes; the plan is what Foundry believes and why:
 *
 *   goal → acceptance criteria → tasks (dependency-ordered, each with acceptance and a justified working set)
 *        → revisions (what changed, why, on which evidence, what was deliberately kept)
 *
 * UNDERSTAND → INSPECT → PLAN → ACT → OBSERVE → UPDATE BELIEFS → REPLAN WHEN JUSTIFIED → TEST → REVIEW → VERIFY → COMPLETE
 *
 * Invariants (enforced by foundryEngineeringPlan.validation.ts):
 *  - every task has acceptance, a working set with a stated reason, and dependencies that exist and are acyclic;
 *  - completed work is not reopened unless a revision states the evidence for it;
 *  - a repair is linked to the hypothesis and repair target that justify it, and it touches only the layer that target names;
 *  - the plan is bounded (revisions and tasks are capped) and serializable, so it survives a restart unchanged;
 *  - the Commander-facing summary is one or two plain sentences with no ids, counters or enum names.
 *
 * Pure: no filesystem, network, clock (timestamps are passed in), or React.
 */

import type { DeferredFailure } from './foundryGoalAnchor'

export type PlanTaskStatus = 'PLANNED' | 'ACTIVE' | 'DONE' | 'REOPENED' | 'SKIPPED'

export type PlanTask = {
  id: string
  title: string
  role: string
  dependsOn: string[]
  acceptance: string
  workingSet: string[]
  /** Why exactly these files (evidence from the project, never a guess). */
  workingSetWhy: string
  status: PlanTaskStatus
  /** The plan revision in which this task last completed; used to prove completed work was not repeated. */
  completedAtRevision?: number
  reopenedBecause?: string
  /** For repair tasks: the hypothesis and target that justify them. */
  hypothesis?: string
  repairTarget?: string
}

export type PlanTrigger =
  | 'INITIAL'
  | 'RECOVERED'
  | 'TEST_FAILURE'
  | 'FAILURE_CHANGED'
  | 'REVIEW_FINDING'
  | 'VERIFY_FINDING'
  | 'CONTRADICTION'
  | 'REPAIR_RETARGET'
  | 'INVALID_OUTPUT'
  | 'COMMANDER_CONTINUATION'
  | 'DRIFT_GUARD'
  | 'HYPOTHESIS_DISPROVEN'
  | 'HYPOTHESIS_CONTRADICTED'
  | 'EDIT_INEFFECTIVE'
  | 'NO_EFFECTIVE_CHANGE'
  | 'CONTEXT_EXPANDED'
  | 'CHANGE_REVERTED'

export type PlanChange = {
  op: 'ADD' | 'REOPEN' | 'RETARGET' | 'KEEP' | 'DEFER'
  taskId: string
  why: string
}

export type PlanRevision = {
  version: number
  at: string
  trigger: PlanTrigger
  /** One plain sentence for the Commander. */
  summary: string
  /** Short evidence strings (failure cause, finding, hypothesis). Technical detail only. */
  evidence: string[]
  changes: PlanChange[]
}

export type EngineeringPlan = {
  version: 1
  revision: number
  goal: string
  acceptance: string[]
  tasks: PlanTask[]
  revisions: PlanRevision[]
  /** Failures that have nothing to do with the request. Recorded and reported, never repaired. */
  deferred?: DeferredFailure[]
}

export const PLAN_LIMITS = { maxRevisions: 12, maxTasks: 32, maxEvidence: 4, maxEvidenceChars: 160, maxDeferred: 8 } as const

export type CampaignTaskLike = {
  id: string
  role: string
  status: string
  dependsOn: string[]
  purpose: string
  acceptance: string
  workingSet: string[]
  hypothesis?: string
}

export type ComponentFilesLike = { contract: string[]; backend: string[]; frontend: string[]; tests: string[]; database: string[] }

const TITLES: Record<string, string> = {
  discover: 'Read the project structure',
  architect: 'Identify the backend, frontend and shared contract',
  contract: 'Read the shared contract',
  backend: 'Update the API',
  frontend: 'Update the UI',
  database: 'Record the data contract',
  integrate: 'Run the tests',
  review: 'Review the change',
  verify: 'Verify the result from disk',
}

const cap = <T,>(list: T[], max: number): T[] => (list.length > max ? list.slice(list.length - max) : list)
const short = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, PLAN_LIMITS.maxEvidenceChars)

function whyWorkingSet(task: CampaignTaskLike, files: readonly string[], components: ComponentFilesLike): string {
  if (!files.length) return 'No file is needed for this step.'
  if (task.id === 'backend') return `${files.join(', ')} is the backend layer the architect identified from the project's own paths.`
  if (task.id === 'frontend') return `${files.join(', ')} is the UI layer the architect identified from the project's own paths.`
  if (task.id === 'contract') return `${files.join(', ')} defines the interface the backend and UI share.`
  if (task.id === 'integrate' || task.id === 'verify') return `${files.join(', ')} holds the tests that check the change.`
  if (task.id === 'architect' || task.id === 'discover') return 'The layer files found in the project are read to name the components; nothing is guessed.'
  void components
  return `${files.join(', ')} is the smallest set this step needs.`
}

export function planTaskFrom(task: CampaignTaskLike, components: ComponentFilesLike): PlanTask {
  const isDebug = task.id.startsWith('debug-')
  return {
    id: task.id,
    title: isDebug ? 'Find the cause of the failing test' : (TITLES[task.id] ?? short(task.purpose).slice(0, 80)),
    role: task.role,
    dependsOn: [...task.dependsOn],
    acceptance: task.acceptance || task.purpose,
    workingSet: [...task.workingSet],
    workingSetWhy: whyWorkingSet(task, task.workingSet, components),
    status: 'PLANNED',
  }
}

export function buildInitialPlan(input: { request: string; acceptance: readonly string[]; tasks: readonly CampaignTaskLike[]; components: ComponentFilesLike; at: string }): EngineeringPlan {
  const tasks = input.tasks.slice(0, PLAN_LIMITS.maxTasks).map(task => planTaskFrom(task, input.components))
  const plan: EngineeringPlan = {
    version: 1,
    revision: 1,
    goal: short(input.request),
    acceptance: input.acceptance.map(short).slice(0, 6),
    tasks,
    revisions: [],
  }
  plan.revisions.push({
    version: 1,
    at: input.at,
    trigger: 'INITIAL',
    summary: initialSummary(plan),
    evidence: [],
    changes: tasks.map(task => ({ op: 'ADD' as const, taskId: task.id, why: task.workingSetWhy })),
  })
  return plan
}

function initialSummary(plan: EngineeringPlan): string {
  const edits = plan.tasks.filter(task => task.id === 'backend' || task.id === 'frontend' || task.id === 'database').flatMap(task => task.workingSet)
  const where = edits.length ? `update ${[...new Set(edits)].slice(0, 3).join(' and ')}` : 'make the change'
  return `I'll read the project, ${where}, then run the tests, review the change and verify it from disk.`
}

/** Sync task statuses from the executing campaign tasks. A task that finished once and is now pending again is REOPENED, never silently reset. */
export function syncPlanStatus(plan: EngineeringPlan, tasks: readonly CampaignTaskLike[]): EngineeringPlan {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const next: EngineeringPlan = { ...plan, tasks: plan.tasks.map(task => ({ ...task })) }
  for (const task of next.tasks) {
    const live = byId.get(task.id)
    if (!live) continue
    const running = live.status === 'RUNNING'
    const complete = live.status === 'COMPLETE'
    if (complete) {
      if (task.status !== 'DONE') task.completedAtRevision = plan.revision
      task.status = 'DONE'
    } else if (running) task.status = 'ACTIVE'
    else if (task.status === 'DONE' || task.status === 'REOPENED') task.status = 'REOPENED'
    else task.status = live.status === 'FAILED' ? 'ACTIVE' : 'PLANNED'
  }
  return next
}

export type RepairLayer = 'backend' | 'frontend' | 'contract' | 'tests'

/** Which layer a debugger's repair target belongs to, judged against the project's own component files. */
export function layerForRepairTarget(target: string | null | undefined, components: ComponentFilesLike): RepairLayer | null {
  const value = (target ?? '').replace(/[`'"]/g, ' ').trim()
  if (!value) return null
  const files = (list: string[]) => list.some(file => value.includes(file) || value.includes(file.split('/').pop() ?? file))
  if (files(components.backend)) return 'backend'
  if (files(components.frontend)) return 'frontend'
  if (files(components.contract)) return 'contract'
  if (files(components.tests)) return 'tests'
  return null
}

export type RepairTargetDecision = {
  layer: 'backend' | 'frontend'
  /** The component file the diagnosis names, when it names one. */
  named: string | null
  /** New working set for the layer's task (named file first), or null when it already leads with it. */
  workingSet: string[] | null
  /** True when the layer's task was already finished: the diagnosis contradicts where the plan expected the defect. */
  contradiction: boolean
}

/**
 * Decides what a debugger's repair target means for the plan. Pure: the runtime applies the decision to its task graph.
 * Returns null when the target names no editable layer (the contract is read-only here) or changes nothing.
 */
export function decideRepairTarget(input: { target: string | null | undefined; components: ComponentFilesLike; tasks: readonly { id: string; status: string; workingSet: string[] }[] }): RepairTargetDecision | null {
  const layer = layerForRepairTarget(input.target, input.components)
  if (layer !== 'backend' && layer !== 'frontend') return null
  const task = input.tasks.find(item => item.id === layer)
  if (!task) return null
  const target = input.target ?? ''
  const named = input.components[layer].find(file => target.includes(file) || target.includes(file.split('/').pop() ?? file)) ?? null
  const workingSet = named && task.workingSet[0] !== named ? [named, ...task.workingSet.filter(file => file !== named)] : null
  const contradiction = task.status === 'COMPLETE'
  if (!contradiction && !workingSet) return null
  return { layer, named, workingSet, contradiction }
}

export type RevisionInput = {
  at: string
  trigger: PlanTrigger
  summary: string
  evidence: readonly string[]
  /** Task ids the revision reopens. Completed tasks may only be reopened here, with a reason. */
  reopen?: readonly { taskId: string; why: string }[]
  add?: readonly { task: CampaignTaskLike; why: string; hypothesis?: string; repairTarget?: string }[]
  retarget?: readonly { taskId: string; workingSet: string[]; why: string }[]
  /** Completed tasks deliberately left alone, so the revision states what was NOT repeated. */
  keep?: readonly { taskId: string; why: string }[]
  /** Failures deliberately left alone because they are unrelated to the request (the goal anchor). */
  defer?: readonly DeferredFailure[]
  components: ComponentFilesLike
}

export function revisePlan(plan: EngineeringPlan, input: RevisionInput): EngineeringPlan {
  const revision = plan.revision + 1
  const tasks = plan.tasks.map(task => ({ ...task }))
  const changes: PlanChange[] = []
  for (const add of input.add ?? []) {
    if (tasks.length >= PLAN_LIMITS.maxTasks || tasks.some(task => task.id === add.task.id)) continue
    const planned = planTaskFrom(add.task, input.components)
    if (add.hypothesis) planned.hypothesis = short(add.hypothesis)
    if (add.repairTarget) planned.repairTarget = short(add.repairTarget)
    tasks.push(planned)
    changes.push({ op: 'ADD', taskId: add.task.id, why: short(add.why) })
  }
  for (const item of input.reopen ?? []) {
    const task = tasks.find(entry => entry.id === item.taskId)
    if (!task) continue
    task.status = 'REOPENED'
    task.reopenedBecause = short(item.why)
    changes.push({ op: 'REOPEN', taskId: task.id, why: short(item.why) })
  }
  for (const item of input.retarget ?? []) {
    const task = tasks.find(entry => entry.id === item.taskId)
    if (!task) continue
    task.workingSet = [...item.workingSet]
    task.workingSetWhy = short(item.why)
    changes.push({ op: 'RETARGET', taskId: task.id, why: short(item.why) })
  }
  for (const item of input.keep ?? []) changes.push({ op: 'KEEP', taskId: item.taskId, why: short(item.why) })
  let deferred = plan.deferred
  for (const item of input.defer ?? []) {
    if ((deferred ?? []).some(known => known.test === item.test)) continue
    deferred = cap([...(deferred ?? []), { test: short(item.test), file: item.file, why: short(item.why) }], PLAN_LIMITS.maxDeferred)
    changes.push({ op: 'DEFER', taskId: 'goal', why: short(`${item.test}: ${item.why}`) })
  }
  const entry: PlanRevision = {
    version: revision,
    at: input.at,
    trigger: input.trigger,
    summary: short(input.summary),
    evidence: input.evidence.map(short).slice(0, PLAN_LIMITS.maxEvidence),
    changes,
  }
  return { ...plan, revision, tasks, revisions: cap([...plan.revisions, entry], PLAN_LIMITS.maxRevisions), ...(deferred ? { deferred } : {}) }
}

/**
 * A new diagnosis that names a different layer than an earlier one, after that earlier attempt failed, means the earlier belief
 * was disproven. Returns the evidence for the revision, or null when there is no earlier belief or it agrees.
 */
export function disprovenHypothesis(plan: EngineeringPlan, debugId: string, hypothesis: string, target: string | null, components: ComponentFilesLike): string[] | null {
  const layer = layerForRepairTarget(target, components)
  if (!layer) return null
  // Only the belief held immediately before this diagnosis can be disproven by it; comparing with every older belief would
  // report the same swing over and over.
  const prior = plan.tasks.filter(task => task.id.startsWith('debug-') && task.id !== debugId && task.hypothesis && task.repairTarget).at(-1)
  const priorLayer = prior ? layerForRepairTarget(prior.repairTarget, components) : null
  if (prior && priorLayer && priorLayer !== layer) return [`Earlier idea: ${prior.hypothesis}`, `Now: ${short(hypothesis)}`]
  return null
}

/** Links the debugger's hypothesis and repair target to the task that will act on it, so every repair is traceable to its cause. */
export function linkHypothesis(plan: EngineeringPlan, taskId: string, hypothesis: string, repairTarget: string | null): EngineeringPlan {
  return {
    ...plan,
    tasks: plan.tasks.map(task => (task.id === taskId ? { ...task, hypothesis: short(hypothesis), repairTarget: repairTarget ? short(repairTarget) : task.repairTarget } : task)),
  }
}

/** Human sentence for each replanning trigger. Never contains ids, counters or enum names. */
export const PLAN_TRIGGER_SUMMARY: Record<PlanTrigger, string> = {
  INITIAL: 'I made a plan from what the project contains.',
  RECOVERED: 'This mission started before plans were recorded; the plan was rebuilt from its saved tasks.',
  TEST_FAILURE: "The tests failed, so I'm finding the cause before I change the code again.",
  FAILURE_CHANGED: "The failure changed, so the earlier plan no longer fits. I'm updating the plan around what the tests show now.",
  REVIEW_FINDING: "The review found a gap, so I'm adding a fix and checking again.",
  VERIFY_FINDING: "Verification found something the tests missed, so I'm adding a fix and checking again.",
  CONTRADICTION: "The cause is somewhere other than where I first planned to change, so I'm updating the plan.",
  INVALID_OUTPUT: "A worker's answer wasn't usable, so I'm asking again with a narrower task.",
  REPAIR_RETARGET: "The cause points at a different file than planned, so I'm changing which file I work on.",
  COMMANDER_CONTINUATION: "You asked me to keep trying, so I'm continuing this plan with a different approach.",
  DRIFT_GUARD: "The tests also show a problem that has nothing to do with your request, so I'm leaving it alone and staying on what you asked.",
  HYPOTHESIS_CONTRADICTED: "I checked that idea against the files and it doesn't hold, so I'm changing course.",
  EDIT_INEFFECTIVE: "My change didn't fix it, so I'm ruling that file out and looking at the rest of the project.",
  CHANGE_REVERTED: "That change made tests that had passed fail again, so I put the files back and kept what was working.",
  CONTEXT_EXPANDED: "The failing run points at another part of the project, so I'm adding it to what I'm looking at.",
  NO_EFFECTIVE_CHANGE: "The change I was about to make would not have changed anything, so I'm not repeating it and I'm looking at the problem another way.",
  HYPOTHESIS_DISPROVEN: "The first fix didn't settle it, and the evidence now points at a different part of the project, so I'm changing course.",
}

/** Old records (before the plan existed) resume with a plan reconstructed from their tasks; nothing is invented. */
export function ensurePlan(campaign: { plan?: EngineeringPlan | null; request: string; acceptance: readonly string[]; tasks: readonly CampaignTaskLike[]; componentFiles: ComponentFilesLike }, at: string): EngineeringPlan {
  if (campaign.plan && campaign.plan.version === 1) return campaign.plan
  const plan = buildInitialPlan({ request: campaign.request, acceptance: campaign.acceptance, tasks: campaign.tasks, components: campaign.componentFiles, at })
  plan.revisions[0] = { ...plan.revisions[0], trigger: 'RECOVERED', summary: 'This mission started before plans were recorded; the plan was rebuilt from its saved tasks.' }
  return syncPlanStatus(plan, campaign.tasks)
}

/** Structural checks used by the validator and by resume: dependencies exist, no cycles, acceptance and working set present. */
export function planProblems(plan: EngineeringPlan): string[] {
  const problems: string[] = []
  const ids = new Set(plan.tasks.map(task => task.id))
  for (const task of plan.tasks) {
    if (!task.acceptance) problems.push(`${task.id}: no acceptance criterion`)
    if (!task.workingSetWhy) problems.push(`${task.id}: working set has no stated reason`)
    for (const dep of task.dependsOn) if (!ids.has(dep)) problems.push(`${task.id}: depends on unknown task ${dep}`)
  }
  const visiting = new Set<string>()
  const done = new Set<string>()
  const byId = new Map(plan.tasks.map(task => [task.id, task]))
  const visit = (id: string): boolean => {
    if (done.has(id)) return false
    if (visiting.has(id)) return true
    visiting.add(id)
    for (const dep of byId.get(id)?.dependsOn ?? []) if (byId.has(dep) && visit(dep)) return true
    visiting.delete(id)
    done.add(id)
    return false
  }
  for (const task of plan.tasks) if (visit(task.id)) { problems.push(`${task.id}: dependency cycle`); break }
  if (plan.tasks.length > PLAN_LIMITS.maxTasks) problems.push('too many tasks')
  if (plan.revisions.length > PLAN_LIMITS.maxRevisions) problems.push('too many revisions')
  return problems
}

/** Tasks that were completed and then reopened WITHOUT a revision naming the reason. Must always be empty. */
export function unjustifiedReopens(plan: EngineeringPlan): string[] {
  return plan.tasks.filter(task => task.status === 'REOPENED' && !task.reopenedBecause).map(task => task.id)
}

export type PlanSummary = {
  headline: string
  lastRevision: string | null
  /** How many times the plan changed after it was first made. */
  changes: number
  /** Past-tense line for a finished mission. Claims no specific edits: only the plan's own stages and how often it changed course. */
  retrospective: string
  steps: string[]
}

/** The Commander-facing plan: plain language only. Ids, counters and enum names never appear here. */
export function planSummary(plan: EngineeringPlan | null | undefined): PlanSummary | null {
  if (!plan) return null
  const initial = plan.revisions[0]?.summary ?? initialSummary(plan)
  const latest = plan.revisions.length > 1 ? plan.revisions[plan.revisions.length - 1] : null
  // Leaving an unrelated failure alone is not a change of course.
  const courseChanges = plan.revisions.filter((revision, index) => index > 0 && revision.trigger !== 'DRIFT_GUARD').length
  return {
    headline: initial,
    lastRevision: latest ? latest.summary : null,
    changes: courseChanges,
    retrospective: retrospectiveLine(courseChanges, plan.deferred?.length ?? 0),
    steps: plan.tasks.filter(task => !task.id.startsWith('debug-')).map(task => task.title),
  }
}

function retrospectiveLine(changes: number, deferred = 0): string {
  const base = 'I read the project, made the change, ran the tests, reviewed it and verified it from disk.'
  const left = deferred > 0 ? ` ${deferred === 1 ? 'One failing test that has nothing to do with your request was' : `${deferred} failing tests that have nothing to do with your request were`} left as found.` : ''
  if (changes <= 0) return `${base}${left}`
  return `${base} I changed course ${changes === 1 ? 'once' : `${changes} times`} when the evidence changed.${left}`
}

export function planEventPayload(plan: EngineeringPlan): string {
  const last = plan.revisions[plan.revisions.length - 1]
  return JSON.stringify({
    v: 1,
    revision: plan.revision,
    trigger: last?.trigger ?? null,
    summary: last?.summary ?? null,
    changes: last?.changes ?? [],
    evidence: last?.evidence ?? [],
    tasks: plan.tasks.map(task => ({ id: task.id, status: task.status })),
  })
}
