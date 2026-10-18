/**
 * Completion truth for authoring tasks: a task that owns files is only COMPLETED while those files pass authoritative validation. Pure over an
 * injected `diagnose`, so the same rule is used by the executive (real compiler) and by the validator (fake or real). Generic: no task names.
 */
import type { EvidenceRecord, MissionGraph, MissionTask } from './foundryMissionExecutive'

/** A task that keeps being marked complete and then found invalid this many times is not looped on forever. */
export const MAX_INVALIDATIONS = 3

export type OwnedDiagnostic = { file: string; line: number; code: string; message: string }
export type Diagnose = (file: string) => OwnedDiagnostic[]

export type Invalidation = { taskId: string; diagnostics: OwnedDiagnostic[]; unchanged: boolean; dependentsWaiting: string[]; staleEvidence: string[]; failed: boolean }
export type GateOutcome = { graph: MissionGraph; evidence: EvidenceRecord[]; invalidated: Invalidation[] }

export const ownedDiagnostics = (files: readonly string[] | undefined, diagnose: Diagnose): OwnedDiagnostic[] => (files ?? []).flatMap(file => diagnose(file))

/** The baseline is the task's FIRST start and survives retries; only a task that never started takes the current digest. */
export const firstStartDigest = (task: Pick<MissionTask, 'startDigest'>, currentDigest: string): string => task.startDigest ?? currentDigest

/** A task that owns files did nothing if they are byte-identical to when its attempt started. No start digest (older tasks, read-only work) means no claim either way. */
export const unchangedSinceStart = (task: Pick<MissionTask, 'files' | 'startDigest'>, digestNow: string | undefined): boolean =>
  Boolean(task.files?.length) && task.startDigest !== undefined && digestNow !== undefined && task.startDigest === digestNow

/** Why a task may not be completed right now (empty = it may). Used before an explicit COMPLETED transition. */
export function completionRefusal(task: Pick<MissionTask, 'taskId' | 'files' | 'startDigest'>, diagnose: Diagnose, digestNow?: string): string | null {
  if (unchangedSinceStart(task, digestNow)) return `Task ${task.taskId} cannot be COMPLETED: none of the files it owns (${(task.files ?? []).join(', ')}) changed since it started. Write the change first.`
  const diagnostics = ownedDiagnostics(task.files, diagnose)
  if (!diagnostics.length) return null
  const first = diagnostics[0]
  return `Task ${task.taskId} cannot be COMPLETED: its files still fail validation (${diagnostics.length} diagnostic(s), first: ${first.file}:${first.line} ${first.code} ${first.message.slice(0, 160)}). Repair them first.`
}

const describe = (item: OwnedDiagnostic) => `${item.file}:${item.line} ${item.code} ${item.message.slice(0, 200)}`

/**
 * Re-validate every COMPLETED task that owns files (skipping those whose owned files are unchanged since they last passed, per `digestOf`).
 * A task whose files fail is invalidated, not erased: it returns to READY (or FAILED when its attempts are used up), its history records the
 * incorrect completion, tasks waiting on it wait again, and CURRENT evidence that depends on its files goes STALE. Unrelated tasks and evidence stay as they are.
 */
export function gateCompletion(graph: MissionGraph, evidence: readonly EvidenceRecord[], diagnose: Diagnose, options: { now?: Date; maxAttempts: number; digestOf?: (files: string[]) => string }): GateOutcome {
  const stamp = (options.now ?? new Date()).toISOString()
  const invalidated: Invalidation[] = []
  const tasks = graph.tasks.map(task => ({ ...task }))
  let records = [...evidence]
  for (const task of tasks) {
    if (task.state !== 'COMPLETED' || !task.files?.length) continue
    const digest = options.digestOf?.(task.files)
    if (digest !== undefined && task.completionCheck?.digest === digest) continue
    const unchanged = unchangedSinceStart(task, digest)
    const diagnostics = unchanged ? [] : ownedDiagnostics(task.files, diagnose)
    if (!diagnostics.length && !unchanged) { if (digest !== undefined) task.completionCheck = { digest, at: stamp }; continue }
    const reason = unchanged
      ? `completion invalidated: the task completed without changing any file it owns (${task.files.join(', ')})`
      : `completion invalidated: ${diagnostics.length} diagnostic(s) remain in the files this task owns (${[...new Set(diagnostics.map(item => item.file))].join(', ')})`
    task.completionHistory = [...(task.completionHistory ?? []), { at: stamp, event: 'COMPLETION_INVALIDATED', priorCompletedAt: task.updatedAt, reason, diagnostics: diagnostics.slice(0, 12).map(describe) }]
    if (task.childMissionId) task.priorChildren = [...(task.priorChildren ?? []), task.childMissionId]
    task.childMissionId = undefined; task.owner = undefined; task.completionCheck = undefined
    // The task DID complete once: its earlier failed attempts were spent getting there. An invalidation starts a fresh repair; repeated invalidations are what is bounded.
    const invalidations = (task.completionHistory ?? []).length
    const attempts = 1
    const failed = invalidations > MAX_INVALIDATIONS
    task.retryState = { attempts, lastSignature: reason }
    task.state = failed ? 'FAILED' : 'READY'
    task.blockers = []
    task.updatedAt = stamp
    const reopened = new Set<string>([task.taskId])
    for (let grew = true; grew;) { grew = false; for (const other of tasks) if (!reopened.has(other.taskId) && other.dependencies.some(id => reopened.has(id)) && ['WAITING', 'READY', 'COMPLETED'].includes(other.state)) { reopened.add(other.taskId); grew = true } }
    const waiting: string[] = []
    for (const other of tasks) {
      // Work that has not completed must wait for the repaired task again. Work already completed on clean files is left alone: it is re-gated on its own files.
      if (other.taskId === task.taskId || !reopened.has(other.taskId) || other.state === 'COMPLETED') continue
      other.state = 'WAITING'
      other.blockers = [...other.blockers.filter(blocker => blocker.kind !== 'DEPENDENCY'), ...other.dependencies.filter(id => reopened.has(id) || id === task.taskId).map(id => ({ kind: 'DEPENDENCY' as const, ref: id, detail: id }))]
      other.updatedAt = stamp
      waiting.push(other.taskId)
    }
    const files = new Set(task.files)
    const stale: string[] = []
    records = records.map(record => {
      if (record.status !== 'CURRENT') return record
      const touched = Object.keys(record.sourceDigests).filter(file => files.has(file))
      if (!touched.length) return record
      stale.push(record.evidenceId)
      return { ...record, status: 'STALE' as const, staleBecause: [...(record.staleBecause ?? []), `completion invalidated: ${touched.join(', ')} fail validation`] }
    })
    invalidated.push({ taskId: task.taskId, diagnostics, unchanged, dependentsWaiting: waiting, staleEvidence: stale, failed })
  }
  return { graph: { ...graph, tasks, updatedAt: invalidated.length ? stamp : graph.updatedAt }, evidence: records, invalidated }
}
