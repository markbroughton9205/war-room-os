/**
 * Bounded escalation for a file that narrow repair has proven it cannot repair in place (every in-place candidate was rejected: the file was
 * written against an API that does not exist, so fixing one error exposes more). The file is moved to quarantine (reversible, never deleted),
 * its repair ledger is cleared, and its task gets a fresh authoring attempt that creates the file again from the real types. One regeneration
 * per task; a second stagnation is final. Pure over injected file operations, so the rule is validated without the executive.
 */
import type { MissionGraph, MissionTask } from './foundryMissionExecutive'

export const REGENERATION_SIGNATURE = /NARROW_REPAIR_STAGNANT/
export const MAX_REGENERATIONS_PER_TASK = 1
/** A file this close to clean is repaired in place, never thrown away: regeneration needs real distance to cover (and may not make things worse). */
export const MIN_DIAGNOSTICS_FOR_REGENERATION = 5

export type RegenerationOps = {
  /** Move the file out of the repo into quarantine; returns where the copy lives, or null when there was nothing to move. */
  quarantine: (file: string) => string | null
  clearLedger: (file: string) => void
  /** Authoritative diagnostics currently remaining in the file. */
  diagnosticCount: (file: string) => number
}

export type Regeneration = { taskId: string; quarantined: string[] }

export const regenerationNote = 'the previous version of the file was removed because it could not be repaired in place (it was written against types and members that do not exist). Write it again from the real exports of the modules it imports.'

export function regenerateStagnantTasks(graph: MissionGraph, ops: RegenerationOps, now = new Date()): { graph: MissionGraph; regenerated: Regeneration[] } {
  const stamp = now.toISOString()
  const regenerated: Regeneration[] = []
  const tasks: MissionTask[] = graph.tasks.map(task => {
    if (task.state !== 'FAILED' || !task.files?.length || !REGENERATION_SIGNATURE.test(task.retryState.lastSignature ?? '')) return task
    if ((task.regenerations?.length ?? 0) >= MAX_REGENERATIONS_PER_TASK) return task
    if (task.files.reduce((total, file) => total + ops.diagnosticCount(file), 0) < MIN_DIAGNOSTICS_FOR_REGENERATION) return task
    const quarantined: string[] = []
    for (const file of task.files) {
      const where = ops.quarantine(file)
      if (where) quarantined.push(`${file} -> ${where}`)
      ops.clearLedger(file)
    }
    if (!quarantined.length) return task
    regenerated.push({ taskId: task.taskId, quarantined })
    return {
      ...task,
      state: 'READY' as const,
      owner: undefined,
      childMissionId: undefined,
      priorChildren: [...(task.priorChildren ?? []), ...(task.childMissionId ? [task.childMissionId] : [])],
      retryState: { attempts: 0, lastSignature: regenerationNote },
      regenerations: [...(task.regenerations ?? []), { at: stamp, reason: task.retryState.lastSignature ?? 'narrow repair stagnant', quarantined }],
      updatedAt: stamp,
    }
  })
  return { graph: { ...graph, tasks, updatedAt: regenerated.length ? stamp : graph.updatedAt }, regenerated }
}
