/**
 * Mission Executive (pure decision logic + durable graph/ledger/failure state).
 * Owns: task readiness, WAITING vs BLOCKED, next-best-action selection, event-driven wake, bounded retry,
 * evidence staleness, and the monotonic acceptance ledger. Execution (spawning jobs) lives in foundryBackgroundJobs.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { findClaimConflicts, type ClaimHolder, type PressureHint } from './foundryResourceClaims'
import { jobTaskFor, listJobs, liveClaimHolders, reconcileJobs, type BackgroundJob, type JobReconciliation } from './foundryBackgroundJobs'

export type MissionTaskState = 'READY' | 'RUNNING' | 'WAITING' | 'BLOCKED' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
export type BlockerKind = 'JOB' | 'CLAIM' | 'DEPENDENCY' | 'COMMANDER' | 'CREDENTIALS' | 'SUDO' | 'EXTERNAL_SERVICE'
/** WAITING = a known event/resource is expected. BLOCKED = nothing moves without new information. */
const BLOCKING_KINDS: readonly BlockerKind[] = ['COMMANDER', 'CREDENTIALS', 'SUDO', 'EXTERNAL_SERVICE']

export type MissionBlocker = { kind: BlockerKind; ref: string; detail: string }

export type MissionTask = {
  taskId: string
  missionId: string
  description: string
  state: MissionTaskState
  dependencies: string[]
  blockers: MissionBlocker[]
  owner?: string
  resourceClaims: string[]
  filesAtRisk: string[]
  subsystem?: string
  evidenceNeeded: string[]
  completionCondition: string
  retryState: { attempts: number; lastSignature?: string; waits?: number }
  /** Read-only work never needs a writer slot; used to fill wait time safely. */
  readOnly?: boolean
  /** Authoring task: the spec handed to a child mission, and the files it will create/rewrite. */
  spec?: string
  files?: string[]
  /** Digest of the owned files when they last passed the completion gate; unchanged files are not re-validated every tick. */
  completionCheck?: { digest: string; at: string }
  /** Digest of the owned files when the task FIRST started (kept across retries: a retry that begins on a file an earlier attempt already changed still counts as changed). A task that owns files cannot COMPLETE with them byte-identical to this. */
  startDigest?: string
  /** What was once reported done and then found not to be: kept, never erased. */
  completionHistory?: Array<{ at: string; event: 'COMPLETION_INVALIDATED'; priorCompletedAt: string; reason: string; diagnostics: string[] }>
  /** Escalations that replaced a file wholesale after narrow repair was proven unable to repair it in place. Kept, never erased. */
  regenerations?: Array<{ at: string; reason: string; quarantined: string[] }>
  childMissionId?: string
  /** Children of failed attempts whose claims must be released before the next attempt. */
  priorChildren?: string[]
  /** Set on fix tasks generated from a failed verification job (the verification task id they repair). */
  fixFor?: string
  fixForAttempt?: number
  /** Optional hint of how much of the goal sits behind this task; computed from the graph when absent. */
  risk?: 'LOW' | 'MEDIUM' | 'HIGH'
  createdAt: string
  updatedAt: string
}

export type MissionGraph = { missionId: string; goal: string; tasks: MissionTask[]; updatedAt: string }

export function newTask(input: Partial<MissionTask> & Pick<MissionTask, 'taskId' | 'missionId' | 'description' | 'completionCondition'>): MissionTask {
  const now = new Date().toISOString()
  return {
    state: 'READY', dependencies: [], blockers: [], resourceClaims: [], filesAtRisk: [], evidenceNeeded: [],
    retryState: { attempts: 0 }, createdAt: now, updatedAt: now, ...input,
  }
}

/* ----------------------------- WAITING vs BLOCKED ----------------------------- */

export function classifyStall(blockers: readonly MissionBlocker[]): 'WAITING' | 'BLOCKED' | null {
  if (!blockers.length) return null
  return blockers.some(blocker => BLOCKING_KINDS.includes(blocker.kind)) ? 'BLOCKED' : 'WAITING'
}

/** Only BLOCKED states may ask the Commander; WAITING must stay quiet. */
export function mayAskCommander(task: MissionTask): boolean {
  return task.state === 'BLOCKED' && task.blockers.some(blocker => blocker.kind === 'COMMANDER' || blocker.kind === 'CREDENTIALS' || blocker.kind === 'SUDO')
}

/* ------------------------------ readiness & selection ------------------------------ */

function byId(graph: MissionGraph): Map<string, MissionTask> {
  return new Map(graph.tasks.map(task => [task.taskId, task]))
}

export function dependenciesComplete(graph: MissionGraph, task: MissionTask): boolean {
  const tasks = byId(graph)
  return task.dependencies.every(id => tasks.get(id)?.state === 'COMPLETED')
}

/** Number of tasks transitively depending on this one: the critical-path weight. */
export function downstreamCount(graph: MissionGraph, taskId: string): number {
  const seen = new Set<string>()
  const walk = (id: string) => {
    for (const task of graph.tasks) if (task.dependencies.includes(id) && !seen.has(task.taskId)) { seen.add(task.taskId); walk(task.taskId) }
  }
  walk(taskId)
  return seen.size
}

export type FailureSignature = { signature: string; count: number; lastAt: string }
export type FailureBook = Record<string, FailureSignature>
export const MAX_IDENTICAL_FAILURES = 2

export function recordFailure(book: FailureBook, taskId: string, signature: string, now = new Date()): { book: FailureBook; verdict: 'RETRY' | 'STOP_AND_CLASSIFY' } {
  const key = `${taskId}::${signature}`
  const count = (book[key]?.count ?? 0) + 1
  const next = { ...book, [key]: { signature, count, lastAt: now.toISOString() } }
  return { book: next, verdict: count > MAX_IDENTICAL_FAILURES ? 'STOP_AND_CLASSIFY' : 'RETRY' }
}

export function retryExhausted(book: FailureBook, taskId: string, signature: string): boolean {
  return (book[`${taskId}::${signature}`]?.count ?? 0) > MAX_IDENTICAL_FAILURES
}

export type SelectionDecision = {
  start: MissionTask[]
  deferred: { taskId: string; reason: string }[]
  /** Set when nothing is started: says why, so "idle" is never an invented action. */
  idleReason: 'MISSION_COMPLETE' | 'ALL_WAITING' | 'AWAITING_COMMANDER' | 'NOTHING_RUNNABLE' | null
}

/**
 * Next-best-action. Considers readiness, claim conflicts (against running tasks and live jobs), prior failures,
 * critical-path weight, risk and evidence gaps. Starts every non-conflicting task (safe parallelism);
 * starts nothing when nothing is genuinely useful.
 */
export function selectNextActions(input: {
  graph: MissionGraph
  heldByJobs?: ClaimHolder[]
  failures?: FailureBook
  pressure?: PressureHint
  maxStart?: number
}): SelectionDecision {
  const { graph } = input
  const failures = input.failures ?? {}
  const deferred: SelectionDecision['deferred'] = []
  const open = graph.tasks.filter(task => task.state !== 'COMPLETED' && task.state !== 'CANCELLED')
  if (!open.length) return { start: [], deferred, idleReason: 'MISSION_COMPLETE' }

  const held: ClaimHolder[] = [
    ...(input.heldByJobs ?? []),
    ...graph.tasks.filter(task => task.state === 'RUNNING').map(task => ({ holderId: `task:${task.taskId}`, claims: task.resourceClaims })),
  ]
  const writers = new Set(graph.tasks.filter(task => task.state === 'RUNNING' && !task.readOnly).flatMap(task => [task.subsystem ?? '', ...task.filesAtRisk]).filter(Boolean))

  const candidates = graph.tasks
    .filter(task => task.state === 'READY' || (task.state === 'WAITING' && task.blockers.length === 0))
    .filter(task => dependenciesComplete(graph, task))
    .filter(task => !(task.retryState.lastSignature && retryExhausted(failures, task.taskId, task.retryState.lastSignature)))
  const scored = candidates
    .map(task => ({ task, score: downstreamCount(graph, task.taskId) * 10 + task.evidenceNeeded.length * 2 + (task.risk === 'HIGH' ? 3 : task.risk === 'MEDIUM' ? 1 : 0) - (task.retryState.attempts * 4) }))
    .sort((a, b) => b.score - a.score || a.task.taskId.localeCompare(b.task.taskId))

  const start: MissionTask[] = []
  const limit = input.maxStart ?? Number.POSITIVE_INFINITY
  for (const { task } of scored) {
    if (start.length >= limit) { deferred.push({ taskId: task.taskId, reason: 'start limit' }); continue }
    if (!task.readOnly) {
      const keys = [task.subsystem ?? '', ...task.filesAtRisk].filter(Boolean)
      const clash = keys.find(key => writers.has(key))
      if (clash) { deferred.push({ taskId: task.taskId, reason: `another writer owns ${clash}` }); continue }
    }
    const conflicts = findClaimConflicts(task.resourceClaims, [...held, ...start.map(item => ({ holderId: `task:${item.taskId}`, claims: item.resourceClaims }))], input.pressure)
    if (conflicts.length) { deferred.push({ taskId: task.taskId, reason: conflicts[0].reason }); continue }
    start.push(task)
    held.push({ holderId: `task:${task.taskId}`, claims: task.resourceClaims })
    if (!task.readOnly) for (const key of [task.subsystem ?? '', ...task.filesAtRisk].filter(Boolean)) writers.add(key)
  }
  if (start.length) return { start, deferred, idleReason: null }
  if (graph.tasks.some(task => mayAskCommander(task))) return { start, deferred, idleReason: 'AWAITING_COMMANDER' }
  if (open.every(task => task.state === 'WAITING' || task.state === 'RUNNING')) return { start, deferred, idleReason: 'ALL_WAITING' }
  return { start, deferred, idleReason: 'NOTHING_RUNNABLE' }
}

/* ------------------------------ events ------------------------------ */

/** Event-driven resume: a finished job clears its JOB blockers and promotes/updates dependent tasks. */
export function applyJobEvent(graph: MissionGraph, job: Pick<BackgroundJob, 'jobId' | 'taskId' | 'state' | 'exitStatus'>, now = new Date()): MissionGraph {
  const stamp = now.toISOString()
  const tasks = graph.tasks.map(task => {
    let next = task
    if (task.blockers.some(blocker => blocker.kind === 'JOB' && blocker.ref === job.jobId)) {
      if (job.state === 'SUCCEEDED') {
        const blockers = task.blockers.filter(blocker => !(blocker.kind === 'JOB' && blocker.ref === job.jobId))
        next = { ...task, blockers, state: classifyStall(blockers) ?? 'READY', updatedAt: stamp }
      } else if (job.state === 'ORPHANED') {
        // Outcome unknown: the producer will be re-run, so keep waiting on the producer task itself.
        const blockers = task.blockers.map(blocker => blocker.kind === 'JOB' && blocker.ref === job.jobId ? { kind: 'DEPENDENCY' as const, ref: job.taskId, detail: blocker.detail } : blocker)
        next = { ...task, blockers, state: 'WAITING', updatedAt: stamp }
      } else {
        // A failed/cancelled prerequisite is not an event to wait for: the dependent needs a decision.
        const blockers = task.blockers.map(blocker => blocker.kind === 'JOB' && blocker.ref === job.jobId ? { ...blocker, kind: 'EXTERNAL_SERVICE' as const, detail: `job ${job.jobId} ${job.state}` } : blocker)
        next = { ...task, blockers, state: 'BLOCKED', updatedAt: stamp }
      }
    }
    if (task.state === 'RUNNING' && task.owner === `job:${job.jobId}`) {
      next = job.state === 'ORPHANED'
        ? { ...next, state: 'READY', owner: undefined, updatedAt: stamp }
        : { ...next, state: job.state === 'SUCCEEDED' ? 'COMPLETED' : job.state === 'CANCELLED' ? 'CANCELLED' : 'FAILED', updatedAt: stamp }
    }
    return next
  })
  return { ...graph, tasks, updatedAt: stamp }
}

/** Dependencies completing promotes QUEUED-by-dependency tasks; call after any task transition. */
export function promoteReady(graph: MissionGraph): MissionGraph {
  const tasks = graph.tasks.map(task => {
    if (task.state === 'WAITING' && task.blockers.every(blocker => blocker.kind === 'DEPENDENCY') && dependenciesComplete(graph, task)) {
      return { ...task, blockers: [], state: 'READY' as const, updatedAt: new Date().toISOString() }
    }
    return task
  })
  return { ...graph, tasks }
}

/* ------------------------------ evidence & ledger ------------------------------ */

export type EvidenceRecord = {
  evidenceId: string
  criterion: string
  source: string
  /** Digest of every source file the conclusion depends on at the time it was gathered. */
  sourceDigests: Record<string, string>
  at: string
  status: 'CURRENT' | 'STALE'
  staleBecause?: string[]
}

/** Invalidate only evidence whose own sources changed; everything else stays current and attributable. */
export function invalidateEvidence(records: readonly EvidenceRecord[], currentDigests: Record<string, string>): { records: EvidenceRecord[]; staleIds: string[] } {
  const staleIds: string[] = []
  const next = records.map(record => {
    if (record.status === 'STALE') return record
    const changed = Object.entries(record.sourceDigests).filter(([file, digest]) => currentDigests[file] !== digest).map(([file]) => file)
    if (!changed.length) return record
    staleIds.push(record.evidenceId)
    return { ...record, status: 'STALE' as const, staleBecause: changed }
  })
  return { records: next, staleIds }
}

export type LedgerState = 'UNPROVEN' | 'PROVEN'
export type AcceptanceLedger = Record<string, { state: LedgerState; evidenceId?: string; provenAt?: string }>

/** Monotonic: PROVEN only regresses when its evidence goes stale and is deliberately reopened, never silently. */
export function reconcileLedger(ledger: AcceptanceLedger, claims: { criterion: string; state: LedgerState; evidenceId?: string }[], evidence: readonly EvidenceRecord[]): { ledger: AcceptanceLedger; rejected: { criterion: string; reason: string }[]; needsReverify: string[] } {
  const next: AcceptanceLedger = { ...ledger }
  const rejected: { criterion: string; reason: string }[] = []
  for (const claim of claims) {
    const existing = next[claim.criterion]
    if (claim.state === 'UNPROVEN' && existing?.state === 'PROVEN') {
      rejected.push({ criterion: claim.criterion, reason: 'silent regression of a proven criterion' })
      continue
    }
    if (claim.state === 'PROVEN') {
      const record = evidence.find(item => item.evidenceId === claim.evidenceId)
      if (!record || record.status !== 'CURRENT') { rejected.push({ criterion: claim.criterion, reason: 'no current evidence' }); continue }
      next[claim.criterion] = { state: 'PROVEN', evidenceId: record.evidenceId, provenAt: record.at }
    }
  }
  const needsReverify = Object.entries(next).filter(([, entry]) => entry.state === 'PROVEN' && evidence.find(item => item.evidenceId === entry.evidenceId)?.status === 'STALE').map(([criterion]) => criterion)
  return { ledger: next, rejected, needsReverify }
}

/* ------------------------------ narration ------------------------------ */

export function narrate(graph: MissionGraph, jobs: Pick<BackgroundJob, 'kind' | 'taskId' | 'state'>[]): string {
  const queued = jobs.filter(job => job.state === 'QUEUED')
  const done = graph.tasks.filter(task => task.state === 'COMPLETED')
  const running = jobs.filter(job => job.state === 'RUNNING')
  const active = graph.tasks.filter(task => task.state === 'RUNNING' && !running.some(job => job.taskId === task.taskId))
  const waiting = graph.tasks.filter(task => task.state === 'WAITING')
  const blocked = graph.tasks.filter(task => task.state === 'BLOCKED')
  const parts: string[] = []
  if (done.length) parts.push(`${done.length} of ${graph.tasks.length} tasks are done`)
  if (running.length) {
    const label = running.map(job => job.kind).join(' and ')
    parts.push(`the ${label} ${running.length > 1 ? 'are' : 'is'} still running${active.length ? `, so I'm working on ${active.map(task => task.description).join('; ')} meanwhile` : ''}`)
  } else if (active.length) parts.push(`I'm working on ${active.map(task => task.description).join('; ')}`)
  if (queued.length) parts.push(`the ${queued.map(job => job.kind).join(' and ')} ${queued.length > 1 ? 'are' : 'is'} queued behind running work and will start by itself`)
  if (waiting.length && !running.length) parts.push(`${waiting.length} task${waiting.length > 1 ? 's are' : ' is'} waiting on ${waiting[0].blockers[0]?.detail ?? 'a dependency'}`)
  if (blocked.length) parts.push(`I need you for: ${blocked.map(task => task.blockers[0]?.detail ?? task.description).join('; ')}`)
  if (!parts.length) return graph.tasks.every(task => task.state === 'COMPLETED') ? 'Mission complete.' : 'Nothing is runnable right now.'
  const sentence = parts.join('. ')
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}

/* ------------------------------ persistence ------------------------------ */

export type MissionCeilings = { maxModelCalls: number; maxToolCalls: number; maxWallMs: number; startedAt: string; approvedBy: string; /** Active execution time accounting: the wall-clock ceiling counts time the mission was actually executing, not time spent BLOCKED waiting for a decision. */
  activeMs?: number; activeAt?: string; priorWindows?: Array<{ startedAt: string; resetAt: string; reason: string; modelCalls: number; toolCalls: number }> }
export type TimelineEntry = { at: string; kind: string; text: string }
export type ProcessGeneration = { pid: number; startTicks: string; firstSeenAt: string }
export type MissionStateFiles = { graph: MissionGraph; failures: FailureBook; evidence: EvidenceRecord[]; ledger: AcceptanceLedger; ceilings?: MissionCeilings; timeline?: TimelineEntry[]; generations?: ProcessGeneration[] }

function stateFile(root: string, missionId: string): string {
  return path.join(root, 'missions', `${missionId}.executive.json`)
}

export function saveMissionState(root: string, missionId: string, state: MissionStateFiles): void {
  const file = stateFile(root, missionId)
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, file)
}

export function loadMissionState(root: string, missionId: string): MissionStateFiles | null {
  const file = stateFile(root, missionId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as MissionStateFiles
  } catch {
    return null
  }
}

/* ------------------------------ resume ------------------------------ */

export type ResumeReport = {
  state: MissionStateFiles
  jobs: { jobId: string; taskId: string; reconciliation: JobReconciliation }[]
  next: SelectionDecision
}

/** Disk/process truth wins: reconcile persisted jobs, fold their outcomes into the graph, then choose the next action. */
export function resumeMission(root: string, missionId: string, jobsRoot = root): ResumeReport | null {
  const loaded = loadMissionState(root, missionId)
  if (!loaded) return null
  let graph = loaded.graph
  reconcileJobs(jobsRoot, { missionId })
  // Fold in every finished job the graph still references (idempotent). Another caller may already have resolved the
  // record on disk (claim checks reconcile too), so graph references, not the reconcile transition, decide what is new.
  const missionJobs = listJobs(jobsRoot, { missionId })
  const reconciled: { job: BackgroundJob; reconciliation: JobReconciliation }[] = missionJobs.map(job => ({
    job,
    reconciliation: job.state === 'RUNNING' ? 'STILL_RUNNING' : job.state === 'QUEUED' ? 'QUEUED' : (job.reconciliation ?? (job.state === 'SUCCEEDED' ? 'COMPLETED' : job.state === 'FAILED' ? 'FAILED' : 'STALE_ORPHAN_RECORD')),
  }))
  for (const { job, reconciliation } of reconciled) {
    if (reconciliation === 'STILL_RUNNING') continue
    const referenced = graph.tasks.some(task => (task.state === 'RUNNING' && task.owner === `job:${job.jobId}`) || task.blockers.some(blocker => blocker.ref === job.jobId))
    if (referenced) graph = applyJobEvent(graph, { ...job, taskId: jobTaskFor(job, missionId), state: job.state })
  }
  // A task persisted RUNNING under a job that no longer runs and that the graph could not fold (orphan) lost its executor: reopen it.
  const liveTaskIds = new Set(reconciled.filter(item => item.reconciliation === 'STILL_RUNNING').map(item => item.job.taskId))
  graph = { ...graph, tasks: graph.tasks.map(task => task.state === 'RUNNING' && !liveTaskIds.has(task.taskId) && task.owner?.startsWith('job:') ? { ...task, state: 'READY' as const, owner: undefined, updatedAt: new Date().toISOString() } : task) }
  graph = promoteReady(graph)
  const state = { ...loaded, graph }
  saveMissionState(root, missionId, state)
  return {
    state,
    jobs: reconciled.filter(item => item.reconciliation === 'STILL_RUNNING' || graphReferenced(loaded.graph, item.job)).map(item => ({ jobId: item.job.jobId, taskId: item.job.taskId, reconciliation: item.reconciliation })),
    next: selectNextActions({ graph, heldByJobs: liveClaimHolders(jobsRoot), failures: state.failures }),
  }
}

function graphReferenced(graph: MissionGraph, job: BackgroundJob): boolean {
  return graph.tasks.some(task => task.owner === `job:${job.jobId}` || task.blockers.some(blocker => blocker.ref === job.jobId))
}

/**
 * A child that ended because it was waiting for a shared resource or the model provider was queued, not wrong: that must not consume an attempt.
 * After MAX_TRANSIENT_WAITS in a row it is treated as a real failure so a stuck resource cannot loop forever.
 */
export const MAX_TRANSIENT_WAITS = 12
export const isTransientChildWait = (reason: string): boolean => /^(WAITING_RESOURCE|PAUSED)\b/.test(reason.trim()) || /\bREPO_WRITE busy\b|Transient model provider outage/i.test(reason)

/** Per-child budget limits derived from the Commander-approved ceilings: model/tool/wall as before, and the build/test/replan sub-meters scaled with the tool allowance. */
export function childEnvelopeLimits(ceilings: { maxModelCalls: number; maxToolCalls: number; maxWallMs: number }, usage: { modelCalls: number; toolCalls: number; wallMs: number }, share: number, inputPerCall: number, outputPerCall: number) {
  const calls = Math.max(1, Math.floor(Math.min(ceilings.maxModelCalls * share, ceilings.maxModelCalls - usage.modelCalls)))
  const tools = Math.max(1, Math.floor(Math.min(ceilings.maxToolCalls * share, ceilings.maxToolCalls - usage.toolCalls)))
  const wall = Math.max(60_000, ceilings.maxWallMs - usage.wallMs)
  const input = calls * inputPerCall
  const output = calls * outputPerCall
  return {
    maxModelCalls: calls, maxToolCalls: tools, maxWallClockMs: wall, maxInputTokens: input, maxOutputTokens: output, maxTotalTokens: input + output,
    // Authoring checks (typecheck/lint/build, validator runs) all ride inside the tool allowance; the defaults (6 builds / 12 tests) refused models mid-repair.
    maxBuildRuns: Math.max(6, Math.floor(tools * 0.1)), maxTestRuns: Math.max(12, Math.floor(tools * 0.1)),
  }
}

/** Ticks closer together than this are one continuous stretch of execution; a longer silence is idle (blocked, waiting for the Commander, process gone). */
export const ACTIVE_GAP_MS = 6 * 60_000

/** Active execution time so far. Missions without active accounting fall back to calendar time since the window started (the old behaviour). */
export function activeElapsedMs(ceilings: Pick<MissionCeilings, 'startedAt' | 'activeMs' | 'activeAt'>, nowMs: number): number {
  if (ceilings.activeMs === undefined) return nowMs - Date.parse(ceilings.startedAt)
  const last = ceilings.activeAt ? Date.parse(ceilings.activeAt) : null
  return ceilings.activeMs + (last !== null && nowMs - last >= 0 && nowMs - last <= ACTIVE_GAP_MS ? nowMs - last : 0)
}

/** One executive tick: extend the active clock by the time since the previous tick when that is a continuous stretch, and remember this tick. */
export function advanceActiveClock<T extends Pick<MissionCeilings, 'startedAt' | 'activeMs' | 'activeAt'>>(ceilings: T, nowMs: number): T {
  const activeMs = ceilings.activeMs ?? (nowMs - Date.parse(ceilings.startedAt))
  const last = ceilings.activeAt ? Date.parse(ceilings.activeAt) : null
  const gained = last !== null && nowMs - last >= 0 && nowMs - last <= ACTIVE_GAP_MS ? nowMs - last : 0
  return { ...ceilings, activeMs: activeMs + gained, activeAt: new Date(nowMs).toISOString() }
}
