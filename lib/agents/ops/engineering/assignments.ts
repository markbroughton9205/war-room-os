import { createHash, randomUUID } from 'node:crypto'
import type { AgentOpsLog } from '../log'
import { isCommander, isSystem } from '../lifecycle'
import { deriveAgents } from '../registry'
import type { Actor, Assignment, AssignmentEventKind, AssignmentOutcome, AssignmentState, CancelDisposition } from '../types'
import { ENGINEERING_TOOLS } from '../types'

/** Ceilings that no assignment (or caller) can raise. */
export const ASSIGNMENT_CEILINGS = { maxSteps: 40, maxRuntimeMs: 30 * 60_000, maxModelCalls: 60, maxRetries: 5 } as const
export const MAX_RUNNING_ASSIGNMENTS = 3
export const MAX_RUNNING_PER_AGENT = 1

export class AssignmentError extends Error {
  constructor(public readonly code: 'NOT_AUTHORIZED' | 'INVALID' | 'AGENT_NOT_ACTIVE' | 'DUPLICATE_BLOCKED' | 'LIMIT' | 'ILLEGAL_TRANSITION' | 'DEPENDENCY' | 'WORKSPACE' | 'UNKNOWN', msg: string) { super(msg) }
}

export const ASSIGNMENT_TERMINAL: AssignmentState[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'HANDED_OFF', 'INTERRUPTED']

type Ev = Extract<ReturnType<AgentOpsLog['view']>['records'][number], { t: 'assignmentEvent' }>
export type AssignmentView = {
  assignment: Assignment
  state: AssignmentState
  events: Ev[]
  outcome?: AssignmentOutcome
  disposition?: CancelDisposition
  stopReason?: string
  blocker?: string
  handoffTo?: string
  /** Fine-grained cancellation phase for the operator: requested / acknowledged / stopping / stopped / unable / none. */
  cancellation: 'NONE' | 'REQUESTED' | 'ACKNOWLEDGED' | 'STOPPING' | 'STOPPED' | 'UNABLE_TO_SAFELY_INTERRUPT'
  lastActivityAt: string
}

/** Event → next state, with the states it may fire from. Anything else fails closed. */
const FLOW: Record<AssignmentEventKind, { from: AssignmentState[]; to: AssignmentState }> = {
  STARTED: { from: ['QUEUED'], to: 'RUNNING' },
  PAUSED: { from: ['RUNNING'], to: 'PAUSED' },
  RESUMED: { from: ['PAUSED'], to: 'RUNNING' },
  BLOCKED: { from: ['RUNNING', 'PAUSED'], to: 'BLOCKED' },
  UNBLOCKED: { from: ['BLOCKED'], to: 'RUNNING' },
  CANCEL_REQUESTED: { from: ['QUEUED', 'RUNNING', 'PAUSED', 'BLOCKED'], to: 'CANCEL_REQUESTED' },
  CANCEL_ACKNOWLEDGED: { from: ['CANCEL_REQUESTED'], to: 'STOPPING' },
  CANCELLED: { from: ['CANCEL_REQUESTED', 'STOPPING', 'QUEUED'], to: 'CANCELLED' },
  CANCEL_UNSAFE: { from: ['CANCEL_REQUESTED', 'STOPPING'], to: 'CANCELLED' },
  COMPLETED: { from: ['RUNNING'], to: 'COMPLETED' },
  FAILED: { from: ['RUNNING', 'PAUSED', 'BLOCKED', 'STOPPING', 'CANCEL_REQUESTED'], to: 'FAILED' },
  HANDED_OFF: { from: ['RUNNING', 'PAUSED', 'BLOCKED', 'FAILED'], to: 'HANDED_OFF' },
  INTERRUPTED: { from: ['RUNNING', 'STOPPING', 'CANCEL_REQUESTED'], to: 'INTERRUPTED' },
}

export function deriveAssignments(log: AgentOpsLog): { assignments: Map<string, AssignmentView>; rejectedEvents: number } {
  const v = log.view()
  const agents = deriveAgents(log).agents
  const out = new Map<string, AssignmentView>()
  const byKey = new Map<string, string>()
  let rejectedEvents = 0
  for (const r of v.records) {
    if (r.t === 'assignment') {
      const a = r.assignment
      const ag = agents.get(a.agentId)
      const writeOk = !a.tools.includes('write_workspace') || (isCommander(a.createdBy) && !!a.workspace)
      const toolsOk = !!ag && a.tools.every((t) => ENGINEERING_TOOLS.includes(t) && (ag.spec.toolScope ?? []).includes(t))
      if (out.has(a.id) || byKey.has(a.idempotencyKey) || !ag || !writeOk || !toolsOk || !(isCommander(a.createdBy) || isSystem(a.createdBy)) || !clampLimits(a.limits)) { rejectedEvents += 1; continue }
      byKey.set(a.idempotencyKey, a.id)
      out.set(a.id, { assignment: a, state: 'QUEUED', events: [], cancellation: 'NONE', lastActivityAt: a.createdAt })
    } else if (r.t === 'assignmentEvent') {
      const view = out.get(r.assignmentId)
      const flow = FLOW[r.kind]
      if (!view || !flow || !flow.from.includes(view.state) || !(isCommander(r.by) || isSystem(r.by))) { rejectedEvents += 1; continue }
      // only a Commander may cancel/resume/unblock; the system/runner may report progress and results
      if ((r.kind === 'CANCEL_REQUESTED' || r.kind === 'RESUMED') && !isCommander(r.by)) { rejectedEvents += 1; continue }
      view.state = flow.to
      view.events.push(r)
      view.lastActivityAt = r.at
      if (r.outcome) view.outcome = r.outcome
      if (r.stopReason) view.stopReason = r.stopReason
      if (r.blocker !== undefined) view.blocker = r.kind === 'UNBLOCKED' ? undefined : r.blocker
      if (r.handoffTo) view.handoffTo = r.handoffTo
      if (r.kind === 'CANCEL_REQUESTED') view.cancellation = 'REQUESTED'
      else if (r.kind === 'CANCEL_ACKNOWLEDGED') view.cancellation = 'STOPPING'
      else if (r.kind === 'CANCELLED') { view.cancellation = 'STOPPED'; view.disposition = 'STOPPED' }
      else if (r.kind === 'CANCEL_UNSAFE') { view.cancellation = 'UNABLE_TO_SAFELY_INTERRUPT'; view.disposition = 'UNABLE_TO_SAFELY_INTERRUPT' }
    }
  }
  return { assignments: out, rejectedEvents }
}

export type AssignDraft = Omit<Assignment, 'id' | 'createdAt' | 'createdBy'>

const clampLimits = (l: Assignment['limits']) => (['maxSteps', 'maxRuntimeMs', 'maxModelCalls', 'maxRetries'] as const).every((k) => Number.isInteger(l[k]) && l[k] >= 0 && l[k] <= ASSIGNMENT_CEILINGS[k])

export function keyFor(parentMissionId: string, taskClass: string, objective: string): string {
  return createHash('sha256').update(`${parentMissionId}|${taskClass}|${objective.trim().toLowerCase()}`).digest('hex').slice(0, 24)
}

/**
 * Create an assignment. Idempotent per logical work (same key returns the existing assignment). Fails closed:
 * the agent must be ACTIVE, tools must be inside the agent's tool scope, write access needs a Commander and a bound
 * workspace, limits can never exceed the ceilings, dependencies must exist.
 */
export function assign(log: AgentOpsLog, draft: AssignDraft, by: Actor, now: Date = new Date()): { assignment: Assignment; created: boolean } {
  return log.withLock(() => {
    if (!isCommander(by) && !isSystem(by)) throw new AssignmentError('NOT_AUTHORIZED', 'assignments are created by a Commander or a system mission process')
    const { assignments } = deriveAssignments(log)
    const existing = [...assignments.values()].find((a) => a.assignment.idempotencyKey === draft.idempotencyKey)
    if (existing) return { assignment: existing.assignment, created: false }
    const agent = deriveAgents(log).agents.get(draft.agentId)
    if (!agent) throw new AssignmentError('UNKNOWN', `unknown agent: ${draft.agentId}`)
    if (agent.state !== 'ACTIVE') throw new AssignmentError('AGENT_NOT_ACTIVE', `agent is ${agent.state}: no new assignments`)
    if (!draft.objective.trim() || !draft.parentMission.id || draft.expectedOutputs.length === 0 || draft.completionConditions.length === 0) throw new AssignmentError('INVALID', 'objective, parent mission, expected outputs and completion conditions are required')
    if (draft.objective.length > 2000 || draft.expectedOutputs.length > 20 || draft.completionConditions.length > 20) throw new AssignmentError('INVALID', 'assignment fields too large')
    if (draft.tools.some((t) => !ENGINEERING_TOOLS.includes(t))) throw new AssignmentError('INVALID', 'unknown tool')
    const scope = agent.spec.toolScope ?? []
    const outside = draft.tools.filter((t) => !scope.includes(t))
    if (outside.length) throw new AssignmentError('NOT_AUTHORIZED', `tools outside the agent's authorized scope: ${outside.join(', ')}`)
    if (draft.tools.includes('write_workspace')) {
      if (!isCommander(by)) throw new AssignmentError('NOT_AUTHORIZED', 'write access to a workspace is granted only by a Commander')
      if (!draft.workspace) throw new AssignmentError('WORKSPACE', 'write access requires an explicit workspace binding')
    }
    if (draft.workspace && !/^\//.test(draft.workspace.root)) throw new AssignmentError('WORKSPACE', 'workspace root must be an absolute path')
    if (!clampLimits(draft.limits)) throw new AssignmentError('LIMIT', `limits must be integers within the ceilings ${JSON.stringify(ASSIGNMENT_CEILINGS)}`)
    for (const d of draft.dependencies) if (!assignments.has(d)) throw new AssignmentError('DEPENDENCY', `unknown dependency: ${d}`)
    const assignment: Assignment = { ...draft, id: `asg-${draft.idempotencyKey}-${randomUUID().slice(0, 6)}`, createdBy: by, createdAt: now.toISOString() }
    log.append({ t: 'assignment', assignment })
    return { assignment, created: true }
  })
}

function appendEvent(log: AgentOpsLog, assignmentId: string, kind: AssignmentEventKind, by: Actor, reason: string, extra: Partial<Ev> = {}, now: Date = new Date()) {
  return log.withLock(() => {
    const view = deriveAssignments(log).assignments.get(assignmentId)
    if (!view) throw new AssignmentError('UNKNOWN', `unknown assignment: ${assignmentId}`)
    const flow = FLOW[kind]
    if (!flow.from.includes(view.state)) throw new AssignmentError('ILLEGAL_TRANSITION', `${kind} is not allowed from ${view.state}`)
    if ((kind === 'CANCEL_REQUESTED' || kind === 'RESUMED') && !isCommander(by)) throw new AssignmentError('NOT_AUTHORIZED', `${kind} requires a Commander`)
    if (!isCommander(by) && !isSystem(by)) throw new AssignmentError('NOT_AUTHORIZED', 'unauthorized actor')
    if (!reason.trim()) throw new AssignmentError('INVALID', 'reason required')
    log.append({ t: 'assignmentEvent', assignmentId, kind, by, at: now.toISOString(), reason: reason.slice(0, 300), ...extra } as never)
    return deriveAssignments(log).assignments.get(assignmentId)!
  })
}

/** Start work. Enforces: agent still ACTIVE, dependencies COMPLETED, global and per-agent concurrency limits. */
export function startAssignment(log: AgentOpsLog, assignmentId: string, by: Actor, now: Date = new Date()) {
  return log.withLock(() => {
    const { assignments } = deriveAssignments(log)
    const view = assignments.get(assignmentId)
    if (!view) throw new AssignmentError('UNKNOWN', `unknown assignment: ${assignmentId}`)
    const agent = deriveAgents(log).agents.get(view.assignment.agentId)
    if (agent?.state !== 'ACTIVE') throw new AssignmentError('AGENT_NOT_ACTIVE', `agent is ${agent?.state ?? 'unknown'}: assignment cannot start`)
    for (const d of view.assignment.dependencies) if (assignments.get(d)?.state !== 'COMPLETED') throw new AssignmentError('DEPENDENCY', `dependency ${d} is ${assignments.get(d)?.state ?? 'unknown'}, not COMPLETED`)
    const live = [...assignments.values()].filter((a) => ['RUNNING', 'PAUSED', 'BLOCKED', 'CANCEL_REQUESTED', 'STOPPING'].includes(a.state))
    if (live.length >= MAX_RUNNING_ASSIGNMENTS) throw new AssignmentError('LIMIT', `at most ${MAX_RUNNING_ASSIGNMENTS} concurrent assignments`)
    if (live.some((a) => a.assignment.agentId === view.assignment.agentId)) throw new AssignmentError('LIMIT', 'agent already has a live assignment')
    return appendEvent(log, assignmentId, 'STARTED', by, 'assignment started', {}, now)
  })
}
export const pauseAssignment = (log: AgentOpsLog, id: string, by: Actor, reason: string, now?: Date) => appendEvent(log, id, 'PAUSED', by, reason, {}, now)
export const resumeAssignment = (log: AgentOpsLog, id: string, by: Actor, reason: string, now?: Date) => appendEvent(log, id, 'RESUMED', by, reason, {}, now)
export const blockAssignment = (log: AgentOpsLog, id: string, by: Actor, blocker: string, now?: Date) => appendEvent(log, id, 'BLOCKED', by, blocker, { blocker: blocker.slice(0, 300) }, now)
export const unblockAssignment = (log: AgentOpsLog, id: string, by: Actor, reason: string, now?: Date) => appendEvent(log, id, 'UNBLOCKED', by, reason, { blocker: '' }, now)
export const requestCancel = (log: AgentOpsLog, id: string, by: Actor, reason: string, now?: Date) => appendEvent(log, id, 'CANCEL_REQUESTED', by, reason, { stopReason: reason.slice(0, 300) }, now)
export const acknowledgeCancel = (log: AgentOpsLog, id: string, by: Actor, now?: Date) => appendEvent(log, id, 'CANCEL_ACKNOWLEDGED', by, 'runner acknowledged cancellation; stopping at the next safe boundary', {}, now)
export const finalizeCancel = (log: AgentOpsLog, id: string, by: Actor, disposition: CancelDisposition, reason: string, now?: Date) =>
  appendEvent(log, id, disposition === 'STOPPED' ? 'CANCELLED' : 'CANCEL_UNSAFE', by, reason, { disposition }, now)
export const completeAssignment = (log: AgentOpsLog, id: string, by: Actor, outcome: AssignmentOutcome, now?: Date) => appendEvent(log, id, 'COMPLETED', by, outcome.summary || 'completed', { outcome }, now)
export const failAssignment = (log: AgentOpsLog, id: string, by: Actor, reason: string, outcome?: AssignmentOutcome, now?: Date) => appendEvent(log, id, 'FAILED', by, reason, { stopReason: reason.slice(0, 300), ...(outcome ? { outcome } : {}) }, now)
export const handOffAssignment = (log: AgentOpsLog, id: string, by: Actor, toAgentId: string, reason: string, now?: Date) => appendEvent(log, id, 'HANDED_OFF', by, reason, { handoffTo: toAgentId, stopReason: reason.slice(0, 300) }, now)
export const interruptAssignment = (log: AgentOpsLog, id: string, by: Actor, reason: string, now?: Date) => appendEvent(log, id, 'INTERRUPTED', by, reason, { stopReason: reason.slice(0, 300) }, now)

/** Runner-side check at every safe boundary: should execution continue right now? */
export function executionGate(log: AgentOpsLog, assignmentId: string): { proceed: boolean; reason: 'OK' | 'PAUSED' | 'CANCEL_REQUESTED' | 'STOPPING' | 'NOT_RUNNING' | 'AGENT_NOT_ACTIVE' } {
  const view = deriveAssignments(log).assignments.get(assignmentId)
  if (!view) return { proceed: false, reason: 'NOT_RUNNING' }
  const agent = deriveAgents(log).agents.get(view.assignment.agentId)
  if (view.state === 'PAUSED') return { proceed: false, reason: 'PAUSED' }
  if (view.state === 'CANCEL_REQUESTED') return { proceed: false, reason: 'CANCEL_REQUESTED' }
  if (view.state === 'STOPPING') return { proceed: false, reason: 'STOPPING' }
  if (view.state !== 'RUNNING') return { proceed: false, reason: 'NOT_RUNNING' }
  if (agent?.state !== 'ACTIVE') return { proceed: false, reason: 'AGENT_NOT_ACTIVE' }
  return { proceed: true, reason: 'OK' }
}

/** Recovery: RUNNING/STOPPING/CANCEL_REQUESTED assignments whose last activity is older than `staleMs` are marked INTERRUPTED. Idempotent. */
export function recoverInterruptedAssignments(log: AgentOpsLog, now: Date = new Date(), staleMs = 120_000): string[] {
  const done: string[] = []
  log.withLock(() => {
    for (const a of deriveAssignments(log).assignments.values()) {
      if (!['RUNNING', 'STOPPING', 'CANCEL_REQUESTED'].includes(a.state)) continue
      if (now.getTime() - Date.parse(a.lastActivityAt) <= staleMs) continue
      interruptAssignment(log, a.assignment.id, 'system:recovery', 'no activity; process ended or restarted mid-assignment', now)
      done.push(a.assignment.id)
    }
  })
  return done
}
