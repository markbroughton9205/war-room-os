import { createHash } from 'node:crypto'
import type { AgentOpsLog } from '../log'
import { isCommander, isSystem } from '../lifecycle'
import { deriveAgents } from '../registry'
import type { Actor, CheckpointState, EffectRecord, FileChange, HandoffPacket } from '../types'
import { AssignmentError, assign, deriveAssignments, keyFor } from './assignments'

export class ContinuityError extends Error {
  constructor(public readonly code: 'UNKNOWN_ASSIGNMENT' | 'INVALID' | 'CONFLICT' | 'NOT_AUTHORIZED', msg: string) { super(msg) }
}
const MAX_TRACKED_FILES = 400
export const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')

const must = (log: AgentOpsLog, id: string) => {
  const v = deriveAssignments(log).assignments.get(id)
  if (!v) throw new ContinuityError('UNKNOWN_ASSIGNMENT', `unknown assignment: ${id}`)
  return v
}
const actorOk = (by: Actor) => { if (!isCommander(by) && !isSystem(by)) throw new ContinuityError('NOT_AUTHORIZED', 'checkpoints are written by a Commander or a system runner') }

/** Persist a structured engineering checkpoint (state only, never conversation). Latest wins by seq. */
export function saveCheckpoint(log: AgentOpsLog, assignmentId: string, state: CheckpointState, by: Actor, now: Date = new Date()): number {
  actorOk(by)
  must(log, assignmentId)
  if (!state.objective.trim() || !Array.isArray(state.steps)) throw new ContinuityError('INVALID', 'checkpoint needs an objective and steps')
  if (state.fileChanges.length > 200 || state.steps.length > 80 || state.validations.length > 120) throw new ContinuityError('INVALID', 'checkpoint exceeds bounded size')
  const bf = state.workspace.baselineFileHashes
  if (bf !== 'UNKNOWN' && Object.keys(bf).length > MAX_TRACKED_FILES) throw new ContinuityError('INVALID', `baseline file hashes capped at ${MAX_TRACKED_FILES}; use UNKNOWN`)
  return log.withLock(() => {
    const seq = log.view().records.filter((r) => r.t === 'checkpoint' && r.assignmentId === assignmentId).length + 1
    log.append({ t: 'checkpoint', assignmentId, seq, at: now.toISOString(), by, state })
    return seq
  })
}

export function latestCheckpoint(log: AgentOpsLog, assignmentId: string): { seq: number; at: string; state: CheckpointState } | null {
  let best: { seq: number; at: string; state: CheckpointState } | null = null
  for (const r of log.view().records) if (r.t === 'checkpoint' && r.assignmentId === assignmentId && (!best || r.seq > best.seq)) best = { seq: r.seq, at: r.at, state: r.state }
  return best
}
export function checkpointHistory(log: AgentOpsLog, assignmentId: string) {
  return log.view().records.filter((r) => r.t === 'checkpoint' && r.assignmentId === assignmentId).map((r) => (r as Extract<typeof r, { t: 'checkpoint' }>)).sort((a, b) => a.seq - b.seq).map((r) => ({ seq: r.seq, at: r.at, currentStepId: r.state.currentStepId, done: r.state.steps.filter((s) => s.status === 'DONE').length, total: r.state.steps.length }))
}

// ---- consequential-action ledger
export type EffectStatus = { state: 'NONE' } | { state: 'DONE'; effect: EffectRecord } | { state: 'FAILED'; effect: EffectRecord } | { state: 'UNRESOLVED'; effect: EffectRecord }
export function effectStatus(log: AgentOpsLog, assignmentId: string, key: string): EffectStatus {
  const evs = log.view().records.filter((r): r is Extract<typeof r, { t: 'effect' }> => r.t === 'effect' && r.effect.assignmentId === assignmentId && r.effect.key === key).map((r) => r.effect)
  if (!evs.length) return { state: 'NONE' }
  const last = evs[evs.length - 1]
  return last.status === 'DONE' ? { state: 'DONE', effect: last } : last.status === 'FAILED' ? { state: 'FAILED', effect: last } : { state: 'UNRESOLVED', effect: last }
}
const effectRid = (a: string, key: string, status: string, n: number) => `effect:${a}:${sha256(key).slice(0, 16)}:${status}:${n}`
function appendEffect(log: AgentOpsLog, e: EffectRecord) {
  const n = log.view().records.filter((r) => r.t === 'effect' && r.effect.assignmentId === e.assignmentId && r.effect.key === e.key).length
  log.append({ t: 'effect', rid: effectRid(e.assignmentId, e.key, e.status, n), effect: e })
}
export const beginEffect = (log: AgentOpsLog, assignmentId: string, key: string, d: Pick<EffectRecord, 'kind' | 'consequential' | 'summary'> & { fileChanges?: FileChange[] }, now = new Date()) =>
  appendEffect(log, { assignmentId, key, kind: d.kind, consequential: d.consequential, summary: d.summary.slice(0, 300), status: 'STARTED', at: now.toISOString(), ...(d.fileChanges ? { fileChanges: d.fileChanges } : {}) })
export const finishEffect = (log: AgentOpsLog, assignmentId: string, key: string, d: Pick<EffectRecord, 'kind' | 'consequential' | 'summary'> & { fileChanges?: FileChange[]; result?: EffectRecord['result'] }, now = new Date()) =>
  appendEffect(log, { assignmentId, key, kind: d.kind, consequential: d.consequential, summary: d.summary.slice(0, 300), status: 'DONE', at: now.toISOString(), ...(d.fileChanges ? { fileChanges: d.fileChanges } : {}), ...(d.result ? { result: d.result } : {}) })
export const failEffect = (log: AgentOpsLog, assignmentId: string, key: string, d: Pick<EffectRecord, 'kind' | 'consequential' | 'summary'> & { result?: EffectRecord['result'] }, now = new Date()) =>
  appendEffect(log, { assignmentId, key, kind: d.kind, consequential: d.consequential, summary: d.summary.slice(0, 300), status: 'FAILED', at: now.toISOString(), ...(d.result ? { result: d.result } : {}) })

export type EffectOutcome<T> = { ran: boolean; skipped: 'ALREADY_DONE' | 'RECONCILED_LANDED' | null; value?: T; conflict?: string }
/**
 * Run a consequential action exactly once. DONE -> skipped. STARTED-but-unfinished (crash) -> reconcile against the
 * actual file state: already landed -> mark DONE without re-running; untouched -> re-run; drifted -> CONFLICT (never overwrite).
 * Non-consequential effects (tests, type checks) always re-run on the current state.
 */
export async function runEffectOnce<T>(
  log: AgentOpsLog,
  assignmentId: string,
  key: string,
  d: { kind: EffectRecord['kind']; consequential: boolean; summary: string; expectedChanges?: FileChange[] },
  run: () => Promise<{ value: T; fileChanges?: FileChange[]; result?: EffectRecord['result'] }>,
  currentHash: (path: string) => string | null,
): Promise<EffectOutcome<T>> {
  const st = effectStatus(log, assignmentId, key)
  if (d.consequential) {
    if (st.state === 'DONE') return { ran: false, skipped: 'ALREADY_DONE' }
    if (st.state === 'UNRESOLVED') {
      const changes = st.effect.fileChanges ?? d.expectedChanges ?? []
      if (changes.length) {
        const states = changes.map((c) => { const cur = currentHash(c.path); return cur === c.afterHash ? 'landed' : cur === c.beforeHash ? 'untouched' : 'drift' })
        if (states.every((x) => x === 'landed')) { finishEffect(log, assignmentId, key, { kind: d.kind, consequential: true, summary: `${d.summary} (reconciled: effect had already landed before the interruption)`, fileChanges: changes }); return { ran: false, skipped: 'RECONCILED_LANDED' } }
        if (states.includes('drift')) return { ran: false, skipped: null, conflict: `file state drifted since the interrupted effect "${key}" (${changes.filter((c, i) => states[i] === 'drift').map((c) => c.path).join(', ')}); refusing to overwrite` }
      }
    }
  }
  beginEffect(log, assignmentId, key, { kind: d.kind, consequential: d.consequential, summary: d.summary, ...(d.expectedChanges ? { fileChanges: d.expectedChanges } : {}) })
  try {
    const out = await run()
    finishEffect(log, assignmentId, key, { kind: d.kind, consequential: d.consequential, summary: d.summary, ...(out.fileChanges ? { fileChanges: out.fileChanges } : {}), ...(out.result ? { result: out.result } : {}) })
    return { ran: true, skipped: null, value: out.value }
  } catch (err) {
    failEffect(log, assignmentId, key, { kind: d.kind, consequential: d.consequential, summary: `${d.summary}: ${err instanceof Error ? err.message : 'failed'}` })
    throw err
  }
}

// ---- successor handoff and resume planning
export function buildHandoffPacket(log: AgentOpsLog, assignmentId: string, reason: string): HandoffPacket {
  const v = must(log, assignmentId)
  const cp = latestCheckpoint(log, assignmentId)
  if (!cp) throw new ContinuityError('INVALID', 'no checkpoint recorded: nothing structured to hand off')
  const st = cp.state
  const effects = log.view().records.filter((r): r is Extract<typeof r, { t: 'effect' }> => r.t === 'effect' && r.effect.assignmentId === assignmentId).map((r) => r.effect)
  const lastByKey = new Map<string, EffectRecord>(); for (const e of effects) lastByKey.set(e.key, e)
  return {
    objective: st.objective,
    acceptanceCriteria: st.acceptanceCriteria,
    attempted: st.steps.filter((s) => s.status !== 'PENDING').map((s) => `${s.id}: ${s.title} [${s.status}]`),
    changed: st.fileChanges.map((c) => ({ path: c.path, beforeHash: c.beforeHash, afterHash: c.afterHash })),
    succeeded: [...st.steps.filter((s) => s.status === 'DONE').map((s) => `${s.id}: ${s.title}`), ...st.validations.filter((x) => x.status === 'PASSED').map((x) => `validation passed: ${x.command}`)],
    failed: [...st.steps.filter((s) => s.status === 'FAILED').map((s) => `${s.id}: ${s.title}${s.note ? ' — ' + s.note : ''}`), ...st.validations.filter((x) => x.status === 'FAILED').map((x) => `validation failed: ${x.command} — ${x.summary}`), ...(st.failureReason ? [`failure: ${st.failureReason}`] : [])],
    doNotRepeat: [...st.doNotRepeat, ...[...lastByKey.values()].filter((e) => e.consequential && e.status === 'DONE').map((e) => ({ key: e.key, reason: `consequential action already completed: ${e.summary}` }))],
    remaining: st.steps.filter((s) => s.status === 'PENDING' || s.status === 'ACTIVE' || s.status === 'FAILED').map((s) => `${s.id}: ${s.title}`),
    stopReason: v.stopReason ?? st.stopReason ?? reason,
    blockers: st.blockers,
    validations: st.validations.slice(-10).map((x) => ({ command: x.command, status: x.status, summary: x.summary.slice(0, 200) })),
    workspace: st.workspace,
    consequentialActionsDone: [...lastByKey.values()].filter((e) => e.consequential && e.status === 'DONE').map((e) => e.key),
  }
}

export type ResumeClassification = 'APPLIED' | 'NOT_APPLIED' | 'DRIFT'
export type ResumePlan = {
  checkpointSeq: number
  safeToResume: boolean
  conflicts: string[]
  fileStates: { path: string; state: ResumeClassification; stepId: string }[]
  /** Steps already DONE and still intact: NOT repeated. */
  skip: string[]
  /** Steps to (re)do, including DONE steps whose files drifted or were not applied. */
  redo: { stepId: string; reason: string }[]
  remaining: string[]
  unresolvedEffects: string[]
  /** Validations are always re-run on the current actual state. */
  revalidate: string[]
  /** Files that differ from the baseline but are not part of this assignment: preserved, never touched. */
  unrelatedChanges: string[] | 'UNKNOWN'
}

export function planResume(log: AgentOpsLog, assignmentId: string, current: { fileHash: (path: string) => string | null; allFileHashes?: Record<string, string> }): ResumePlan {
  must(log, assignmentId)
  const cp = latestCheckpoint(log, assignmentId)
  if (!cp) throw new ContinuityError('INVALID', 'no checkpoint to resume from')
  const st = cp.state
  const fileStates = st.fileChanges.map((c) => { const cur = current.fileHash(c.path); const state: ResumeClassification = cur === c.afterHash ? 'APPLIED' : cur === c.beforeHash || (c.beforeHash === null && cur === null) ? 'NOT_APPLIED' : 'DRIFT'; return { path: c.path, state, stepId: c.stepId } })
  const conflicts = fileStates.filter((f) => f.state === 'DRIFT').map((f) => `${f.path} changed since step ${f.stepId} (neither the recorded before nor after state)`)
  const redo: ResumePlan['redo'] = []
  const skip: string[] = []
  for (const s of st.steps) {
    if (s.status !== 'DONE') continue
    const mine = fileStates.filter((f) => f.stepId === s.id)
    const bad = mine.find((f) => f.state !== 'APPLIED')
    if (bad) redo.push({ stepId: s.id, reason: bad.state === 'DRIFT' ? `${bad.path} drifted: needs review before continuing` : `${bad.path} is not in its recorded state` })
    else skip.push(s.id)
  }
  const unresolved = log.view().records.filter((r): r is Extract<typeof r, { t: 'effect' }> => r.t === 'effect' && r.effect.assignmentId === assignmentId).map((r) => r.effect).reduce((m, e) => m.set(e.key, e), new Map<string, EffectRecord>())
  const unresolvedEffects = [...unresolved.values()].filter((e) => e.status === 'STARTED').map((e) => e.key)
  let unrelated: ResumePlan['unrelatedChanges'] = 'UNKNOWN'
  const base = st.workspace.baselineFileHashes
  if (base !== 'UNKNOWN' && current.allFileHashes) {
    const touched = new Set(st.fileChanges.map((c) => c.path))
    unrelated = Object.keys({ ...base, ...current.allFileHashes }).filter((p) => !touched.has(p) && base[p] !== current.allFileHashes![p]).sort()
  }
  return {
    checkpointSeq: cp.seq, safeToResume: conflicts.length === 0, conflicts, fileStates, skip, redo,
    remaining: st.steps.filter((s) => s.status !== 'DONE' && s.status !== 'SKIPPED').map((s) => s.id),
    unresolvedEffects, revalidate: st.validations.map((x) => x.command).filter((c, i, a) => a.indexOf(c) === i), unrelatedChanges: unrelated,
  }
}

/** Create the successor/continuation assignment and link it to the predecessor with a bounded packet (never a transcript). */
export function continueAssignment(log: AgentOpsLog, fromId: string, toAgentId: string, by: Actor, reason: string, now: Date = new Date()): { assignmentId: string; created: boolean; packet: HandoffPacket } {
  actorOk(by)
  const from = must(log, fromId)
  const agent = deriveAgents(log).agents.get(toAgentId)
  if (!agent || agent.state !== 'ACTIVE') throw new AssignmentError('AGENT_NOT_ACTIVE', `successor agent is ${agent?.state ?? 'unknown'}`)
  const packet = buildHandoffPacket(log, fromId, reason)
  const a = from.assignment
  // the same agent may be resumed by the system under its existing grant; giving ANOTHER agent write access needs a Commander
  if (toAgentId !== a.agentId && a.tools.includes('write_workspace') && !isCommander(by)) throw new ContinuityError('NOT_AUTHORIZED', 'handing write access to a different agent requires a Commander')
  const objective = `${a.objective}\n\n[continuation of ${a.id}: ${reason.slice(0, 200)}]`
  const res = assign(log, { ...a, idempotencyKey: keyFor(a.parentMission.id, a.taskClass, `continue:${fromId}:${toAgentId}`), agentId: toAgentId, objective: objective.slice(0, 1990), dependencies: [] }, isCommander(by) ? by : a.createdBy, now)
  if (res.created) log.append({ t: 'handoff', fromAssignment: fromId, toAssignment: res.assignment.id, at: now.toISOString(), by, reason: reason.slice(0, 300), packet })
  return { assignmentId: res.assignment.id, created: res.created, packet }
}
export function handoffFor(log: AgentOpsLog, toAssignmentId: string) {
  return log.view().records.find((r): r is Extract<typeof r, { t: 'handoff' }> => r.t === 'handoff' && r.toAssignment === toAssignmentId) ?? null
}
