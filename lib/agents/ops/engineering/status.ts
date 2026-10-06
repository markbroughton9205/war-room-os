import type { AgentOpsLog } from '../log'
import { deriveAssignments, ASSIGNMENT_TERMINAL, type AssignmentView } from './assignments'
import { latestCheckpoint } from './continuity'
import { deriveLedger } from './debugLedger'

/** Plain operator view of one assignment. Every field is derived from durable evidence; nothing is estimated (no percent-complete, no ETA). */
export type SimpleStatus = {
  assignmentId: string
  agentId: string
  goal: string
  state: string
  doingNow: string
  verified: string[]
  remaining: string[]
  blocker: string | 'NONE'
  approvalNeeded: string | 'NONE'
  details: {
    cancellation: AssignmentView['cancellation']
    stopReason: string | 'NONE'
    steps: { id: string; title: string; status: string }[]
    filesChanged: string[]
    checkpointSeq: number | 'NONE'
    openFailures: number
    undetermined: number
    repairs: number
    modelCalls: number | 'UNKNOWN'
    executor: string
    lastActivityAt: string
    handoffTo: string | 'NONE'
    limits: AssignmentView['assignment']['limits']
  }
}

export function buildAssignmentStatus(log: AgentOpsLog, view: AssignmentView): SimpleStatus {
  const a = view.assignment
  const cp = latestCheckpoint(log, a.id)
  const steps = cp?.state.steps ?? []
  const led = deriveLedger(log, a.id)
  const fixed = new Set(led.validations.filter((v) => v.outcome === 'ORIGINAL_FIXED').map((v) => v.failureId))
  const open = [...led.failures.keys()].filter((id) => !fixed.has(id) && !led.undetermined.has(id)).length
  const passed = (cp?.state.validations ?? []).filter((v) => v.status === 'PASSED')
  const failedLast = (cp?.state.validations ?? []).filter((v) => v.status === 'FAILED').slice(-1)[0]
  const active = steps.find((s) => s.status === 'ACTIVE')
  const terminal = ASSIGNMENT_TERMINAL.includes(view.state)
  const doingNow = view.state === 'RUNNING' ? (active ? `${active.title}` : steps.length ? 'between steps' : 'starting') :
    view.state === 'QUEUED' ? 'waiting to start' :
    view.state === 'PAUSED' ? 'paused by the Commander; no work is happening' :
    view.state === 'BLOCKED' ? 'blocked; waiting' :
    view.state === 'CANCEL_REQUESTED' ? 'cancel requested; stopping at the next safe point' :
    view.state === 'STOPPING' ? 'stopping' :
    view.state === 'COMPLETED' ? 'finished' : view.state === 'FAILED' ? 'stopped (failed)' : view.state === 'CANCELLED' ? 'cancelled' : view.state === 'HANDED_OFF' ? 'handed to another agent' : 'interrupted; needs recovery'
  const verified = [
    ...passed.slice(-6).map((v) => `${v.command}${v.summary ? ` — ${v.summary}` : ''}`),
    ...(view.outcome?.validation === 'PASSED' ? ['final independent validation passed'] : []),
  ]
  const remaining = terminal && view.state === 'COMPLETED' ? [] : steps.filter((s) => s.status === 'PENDING' || s.status === 'ACTIVE' || s.status === 'FAILED').map((s) => `${s.title}${s.status === 'FAILED' ? ' (failed)' : ''}`)
  const blocker = view.blocker || (view.state === 'FAILED' ? view.stopReason ?? 'failed' : failedLast && !terminal ? `last check failed: ${failedLast.command}` : 'NONE')
  const approvalNeeded = view.state === 'PAUSED' ? 'Commander must resume' : view.state === 'INTERRUPTED' ? 'Commander must review recovery' : view.state === 'BLOCKED' ? 'Commander decision' : 'NONE'
  return {
    assignmentId: a.id, agentId: a.agentId, goal: a.objective, state: view.state, doingNow, verified, remaining, blocker, approvalNeeded,
    details: {
      cancellation: view.cancellation, stopReason: view.stopReason ?? 'NONE',
      steps: steps.map((s) => ({ id: s.id, title: s.title, status: s.status })),
      filesChanged: [...new Set((cp?.state.fileChanges ?? []).map((c) => c.path))],
      checkpointSeq: cp ? cp.seq : 'NONE', openFailures: open, undetermined: led.undetermined.size, repairs: led.repairs.length,
      modelCalls: 'UNKNOWN', // the assignment record does not carry a model-call count; never guessed
      executor: view.outcome && view.outcome.executor !== 'UNKNOWN' ? `${(view.outcome.executor as { provider: string }).provider}/${(view.outcome.executor as { model: string }).model}` : 'UNKNOWN',
      lastActivityAt: view.lastActivityAt, handoffTo: view.handoffTo ?? 'NONE', limits: a.limits,
    },
  }
}

export function listAssignmentStatuses(log: AgentOpsLog, limit = 50): SimpleStatus[] {
  return [...deriveAssignments(log).assignments.values()].sort((x, y) => y.lastActivityAt.localeCompare(x.lastActivityAt)).slice(0, limit).map((v) => buildAssignmentStatus(log, v))
}
