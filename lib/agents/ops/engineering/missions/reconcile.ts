import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { AgentOpsLog } from '../../log'
import { deriveAssignments, interruptAssignment } from '../assignments'
import { latestCheckpoint, planResume } from '../continuity'
import { Workspace } from '../runtime/workspaceFs'
import { assessLiveness, pidAliveReal, type LivenessFacts } from './liveness'
import { ACTIVE_STATES, type MissionRecord, type RecoveryRecord } from './types'
import type { MissionStore } from './store'

const KEY = Symbol.for('war-room.engineering-missions.runners')
export type LocalRunner = { workerId: string; startedAt: string }
/** The runners this process actually has. A lease that names this process but has no entry here belongs to a runner that ended or was lost. */
export function localRunners(): Map<string, LocalRunner> {
  const g = globalThis as unknown as Record<symbol, Map<string, LocalRunner> | undefined>
  return (g[KEY] ??= new Map())
}
export const realFacts = (now: Date = new Date()): LivenessFacts => ({ pidAlive: pidAliveReal, hasLocalRunner: (id) => localRunners().has(id), ownPid: process.pid, now })

/** Can the dead run continue? Only when the workspace exists, a checkpoint exists, and no file the checkpoint recorded was changed by someone else (the resume planner's own conflict test). */
export function resumability(log: AgentOpsLog, m: MissionRecord): { resumable: boolean; why: string; checkpointSeq: number | 'NONE'; files: string[] } {
  const cp = latestCheckpoint(log, m.assignmentId)
  const files = [...new Set((cp?.state.fileChanges ?? []).map((c) => c.path))]
  if (!existsSync(m.workspace.root)) return { resumable: false, why: 'the mission workspace no longer exists', checkpointSeq: cp ? cp.seq : 'NONE', files }
  if (!cp) return { resumable: true, why: 'no checkpoint yet: the run restarts from the plan (nothing was completed, so nothing is duplicated)', checkpointSeq: 'NONE', files }
  try {
    const ws = new Workspace(m.workspace.root)
    const plan = planResume(log, m.assignmentId, { fileHash: (p) => ws.hash(p), allFileHashes: ws.snapshot() })
    return plan.safeToResume
      ? { resumable: true, why: `checkpoint ${cp.seq}: ${plan.skip.length} completed step(s) are kept, ${plan.redo.length} are redone`, checkpointSeq: cp.seq, files }
      : { resumable: false, why: `checkpoint ${cp.seq} cannot be resumed safely: ${plan.conflicts.join('; ')}`, checkpointSeq: cp.seq, files }
  } catch (e) { return { resumable: false, why: `resume check failed: ${e instanceof Error ? e.message : String(e)}`, checkpointSeq: cp.seq, files } }
}

/**
 * Dead-run reconciliation. A mission in an active state whose worker is gone is moved to INTERRUPTED (an honest, recoverable state), never to COMPLETED.
 * Checkpoint, workspace, lease and ledger are preserved; the assignment is interrupted in the log; a recovery record says what is resumable and why.
 * Idempotent and safe to run from several places (boot, a timer, every read): it re-checks under the lock.
 */
export function reconcileMissions(log: AgentOpsLog, store: MissionStore, facts: LivenessFacts = realFacts(), detectedBy = 'system:reconciler'): string[] {
  const changed: string[] = []
  for (const m0 of store.list()) {
    if (!ACTIVE_STATES.includes(m0.state)) continue
    if (assessLiveness(m0, facts).verdict !== 'DEAD') continue
    try {
      store.update(m0.id, (m) => {
        if (!ACTIVE_STATES.includes(m.state)) return null
        const l = assessLiveness(m, facts)
        if (l.verdict !== 'DEAD') return null
        const r = resumability(log, m)
        const rec: RecoveryRecord = { at: facts.now.toISOString(), detectedBy, reason: l.reason, fromState: m.state, attempt: m.attempts.length, checkpointSeq: r.checkpointSeq, resumable: r.resumable, resumableWhy: r.why, filesPreserved: r.files }
        const last = m.attempts[m.attempts.length - 1]
        if (last && !last.endedAt) { last.endedAt = facts.now.toISOString(); last.endState = 'INTERRUPTED'; last.endReason = l.reason }
        m.recoveries.push(rec)
        m.state = 'INTERRUPTED'; m.stateAt = facts.now.toISOString(); m.stateReason = `worker died: ${l.reason}. ${r.resumable ? 'Resumable: ' : 'Not resumable: '}${r.why}`
        return m
      })
      store.retireLease(m0.id, 'dead')
      writeInterruption(store, m0, facts.now)
      store.event(m0.id, { kind: 'DEAD_RUN_DETECTED', detail: assessLiveness(m0, facts).reason, attempt: m0.attempts.length })
      const v = deriveAssignments(log).assignments.get(m0.assignmentId)
      if (v && ['RUNNING', 'STOPPING', 'CANCEL_REQUESTED'].includes(v.state)) interruptAssignment(log, m0.assignmentId, 'system:recovery', `engineering worker is gone (${assessLiveness(m0, facts).reason}); mission ${m0.id} is INTERRUPTED and resumable from its checkpoint`)
      changed.push(m0.id)
    } catch { /* another reconciler won, or the record vanished: nothing to do */ }
  }
  return changed
}

/** What was on disk when the worker died, written once per attempt (never overwrites an earlier one): the evidence a recovery starts from. */
function writeInterruption(store: MissionStore, m: MissionRecord, now: Date) {
  try {
    const seed = JSON.parse(readFileSync(path.join(store.dir(m.id), 'seed-snapshot.json'), 'utf8')) as Record<string, string>
    const final = existsSync(m.workspace.root) ? new Workspace(m.workspace.root).snapshot() : {}
    const created = Object.keys(final).filter((p) => !(p in seed)), modified = Object.keys(final).filter((p) => p in seed && seed[p] !== final[p])
    store.writeReceipt(m.id, `interrupted-a${m.attempts.length}.json`, { missionId: m.id, attempt: m.attempts.length, at: now.toISOString(), kind: 'INTERRUPTION_EVIDENCE', filesCreated: created.map((p) => ({ path: p, sha256: final[p] })), filesModified: modified.map((p) => ({ path: p, sha256: final[p], beforeSha256: seed[p] })), note: 'partial work present when the worker died; not a completion receipt' })
  } catch { /* evidence is best effort and must never block recovery */ }
}
