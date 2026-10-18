/**
 * Durable background job manager. Jobs are real detached processes whose truth lives on disk
 * (record + log + exit sentinel), so they survive Foundry/Electron restarts. A small sh wrapper writes the
 * exit status itself, so completion is recoverable even when no Foundry process was watching.
 */
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { identityIsLive, readProcessIdentity, type ProcessIdentity } from './foundryProcessIdentity'
import { heldLeaseHolders } from './foundryClaimLeases'
import { findClaimConflicts, normalizeClaims, type ClaimConflict, type PressureHint } from './foundryResourceClaims'

export type BackgroundJobState = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ORPHANED' | 'CANCELLED'
export type JobReconciliation = 'QUEUED' | 'COMPLETED' | 'FAILED' | 'STILL_RUNNING' | 'COMPLETED_WHILE_AWAY' | 'FAILED_WHILE_AWAY' | 'STALE_ORPHAN_RECORD'

export type BackgroundJob = {
  jobId: string
  missionId: string
  taskId: string
  kind: string
  command: string
  args: string[]
  cwd: string
  dedupeKey: string
  identity: ProcessIdentity
  startedAt: string
  lastHeartbeat: string
  state: BackgroundJobState
  exitStatus: number | null
  finishedAt: string | null
  logPath: string
  exitPath: string
  claims: string[]
  reconciliation?: JobReconciliation
  /** Other missions that joined this live job instead of starting a duplicate. */
  attached?: string[]
  /** For attached missions: the task id each mission uses for this shared job. */
  attachedTasks?: Record<string, string>
  /** Identity of the process that launched the job, and of the process that recorded its outcome. Different => the outcome happened while away. */
  startedBy?: ProcessIdentity | null
  observedBy?: ProcessIdentity | null
  /** Digests of the source files this job's result depends on, captured at start. */
  evidenceSources?: Record<string, string>
  /** Files a task job produces; their digests become the evidence when it succeeds. */
  evidenceFiles?: string[]
  childMissionId?: string
}

export type StartJobResult =
  | { status: 'STARTED'; job: BackgroundJob }
  | { status: 'DUPLICATE'; job: BackgroundJob }
  | { status: 'QUEUED'; job: BackgroundJob; conflicts: ClaimConflict[] }
  | { status: 'CLAIM_CONFLICT'; conflicts: ClaimConflict[] }

const WRAPPER = 'exitfile=$1; shift; "$@"; code=$?; printf "%s" "$code" > "$exitfile.tmp" && mv "$exitfile.tmp" "$exitfile"; exit "$code"'

function jobsDir(root: string): string {
  return path.join(root, 'jobs')
}
function recordPath(root: string, jobId: string): string {
  return path.join(jobsDir(root), `${jobId}.json`)
}

const TERMINAL: readonly BackgroundJobState[] = ['SUCCEEDED', 'FAILED', 'ORPHANED', 'CANCELLED']

/** Short per-record lock (mkdir is atomic). Stale locks from a crashed holder are broken after 5s. */
function withRecordLock<T>(root: string, jobId: string, fn: () => T): T {
  const lock = path.join(jobsDir(root), `${jobId}.lock`)
  const deadline = Date.now() + 5000
  for (;;) {
    try { mkdirSync(lock); break } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try { if (Date.now() - statSync(lock).mtimeMs > 5000) rmSync(lock, { recursive: true, force: true }) } catch { /* raced with release */ }
      if (Date.now() > deadline) { rmSync(lock, { recursive: true, force: true }); continue }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
    }
  }
  try { return fn() } finally { rmSync(lock, { recursive: true, force: true }) }
}

/** Another writer may have moved the record forward; terminal outcomes and attachments are monotonic and never lost. */
function mergeJob(current: BackgroundJob | null, next: BackgroundJob): BackgroundJob {
  if (!current) return next
  const merged: BackgroundJob = { ...next }
  if (TERMINAL.includes(current.state) && !TERMINAL.includes(next.state)) {
    Object.assign(merged, { state: current.state, exitStatus: current.exitStatus, finishedAt: current.finishedAt, reconciliation: current.reconciliation })
  }
  if (current.state === 'RUNNING' && next.state === 'QUEUED') Object.assign(merged, { state: current.state, identity: current.identity, startedAt: current.startedAt })
  const attached = [...new Set([...(current.attached ?? []), ...(next.attached ?? [])])]
  if (attached.length) merged.attached = attached
  const attachedTasks = { ...(current.attachedTasks ?? {}), ...(next.attachedTasks ?? {}) }
  if (Object.keys(attachedTasks).length) merged.attachedTasks = attachedTasks
  return merged
}

function save(root: string, job: BackgroundJob): void {
  mkdirSync(jobsDir(root), { recursive: true })
  const file = recordPath(root, job.jobId)
  withRecordLock(root, job.jobId, () => {
    let current: BackgroundJob | null = null
    try { current = JSON.parse(readFileSync(file, 'utf8')) as BackgroundJob } catch { /* new record */ }
    const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
    writeFileSync(tmp, JSON.stringify(mergeJob(current, job), null, 2))
    renameSync(tmp, file)
  })
}

export function listJobs(root: string, filter?: { missionId?: string }): BackgroundJob[] {
  if (!existsSync(jobsDir(root))) return []
  const jobs: BackgroundJob[] = []
  for (const name of readdirSync(jobsDir(root))) {
    if (!name.endsWith('.json')) continue
    try {
      const job = JSON.parse(readFileSync(path.join(jobsDir(root), name), 'utf8')) as BackgroundJob
      if (!filter?.missionId || job.missionId === filter.missionId || job.attached?.includes(filter.missionId)) jobs.push(job)
    } catch {
      /* torn record: ignored, not trusted */
    }
  }
  return jobs.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

export function jobDedupeKey(kind: string, cwd: string, command: string, args: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify([kind, path.resolve(cwd), command, args])).digest('hex').slice(0, 24)
}

function readExit(job: BackgroundJob): number | null {
  try {
    const value = Number(readFileSync(job.exitPath, 'utf8').trim())
    return Number.isInteger(value) ? value : null
  } catch {
    return null
  }
}

/** Live truth for one job; persists any state change. Never trusts the pid alone. */
export function inspectJob(root: string, job: BackgroundJob, now = new Date()): { job: BackgroundJob; reconciliation: JobReconciliation } {
  if (job.state === 'QUEUED') return { job, reconciliation: 'QUEUED' }
  if (job.state !== 'RUNNING') {
    const reconciliation: JobReconciliation = job.reconciliation ?? (job.state === 'SUCCEEDED' ? 'COMPLETED' : job.state === 'FAILED' ? 'FAILED' : 'STALE_ORPHAN_RECORD')
    return { job, reconciliation }
  }
  const exit = readExit(job)
  if (exit === null && identityIsLive(job.identity)) {
    const next = { ...job, lastHeartbeat: now.toISOString() }
    save(root, next)
    return { job: next, reconciliation: 'STILL_RUNNING' }
  }
  const finishedAt = now.toISOString()
  if (exit === null) {
    // Process gone (or pid recycled by something else) and no exit sentinel: the outcome is unknowable.
    const next: BackgroundJob = { ...job, state: 'ORPHANED', finishedAt, reconciliation: 'STALE_ORPHAN_RECORD' }
    save(root, next)
    return { job: next, reconciliation: 'STALE_ORPHAN_RECORD' }
  }
  const ok = exit === 0
  const observer = readProcessIdentity(process.pid)
  // "While away" is a fact about processes: the recorder is not the process that launched the job (or the launcher is gone).
  const away = !job.startedBy || !observer || job.startedBy.pid !== observer.pid || job.startedBy.startTicks !== observer.startTicks || job.startedBy.bootId !== observer.bootId
  const reconciliation: JobReconciliation = ok ? (away ? 'COMPLETED_WHILE_AWAY' : 'COMPLETED') : (away ? 'FAILED_WHILE_AWAY' : 'FAILED')
  const next: BackgroundJob = { ...job, state: ok ? 'SUCCEEDED' : 'FAILED', exitStatus: exit, finishedAt, reconciliation, observedBy: observer }
  save(root, next)
  return { job: next, reconciliation }
}

export function reconcileJobs(root: string, filter?: { missionId?: string }): { job: BackgroundJob; reconciliation: JobReconciliation }[] {
  // Jobs that were live (running or queued) when we started: these are the ones whose classification is being asked for.
  const wasLive = new Set(listJobs(root, filter).filter(job => job.state === 'RUNNING' || job.state === 'QUEUED').map(job => job.jobId))
  // Settle finished jobs first so their claims are released, then start queued work that no longer conflicts.
  for (const job of listJobs(root).filter(item => item.state === 'RUNNING')) inspectJob(root, job)
  for (const started of promoteQueuedJobs(root)) if (!filter?.missionId || started.missionId === filter.missionId || started.attached?.includes(filter.missionId)) wasLive.add(started.jobId)
  return listJobs(root, filter).filter(job => wasLive.has(job.jobId) || job.state === 'RUNNING' || job.state === 'QUEUED').map(job => inspectJob(root, job))
}

export function liveClaimHolders(root: string): { holderId: string; claims: string[] }[] {
  return [
    ...reconcileJobs(root)
      .filter(item => item.reconciliation === 'STILL_RUNNING')
      .map(item => ({ holderId: `job:${item.job.jobId}`, claims: item.job.claims })),
    ...heldLeaseHolders(root).map(holder => ({ holderId: holder.holderId, claims: [...holder.claims] })),
  ]
}

export function startBackgroundJob(input: {
  root: string
  missionId: string
  taskId: string
  kind: string
  command: string
  args?: string[]
  cwd: string
  claims?: string[]
  env?: NodeJS.ProcessEnv
  externalHolders?: { holderId: string; claims: string[] }[]
  pressure?: PressureHint
  evidenceSources?: Record<string, string>
  evidenceFiles?: string[]
  childMissionId?: string
  /** On a claim conflict, persist the job as QUEUED (FIFO, started automatically when the claims clear) instead of refusing. */
  queueIfBlocked?: boolean
}): StartJobResult {
  const args = input.args ?? []
  const dedupeKey = jobDedupeKey(input.kind, input.cwd, input.command, args)
  const live = reconcileJobs(input.root)
  const duplicate = live.find(item => item.job.dedupeKey === dedupeKey)
  if (duplicate) return { status: 'DUPLICATE', job: duplicate.job }
  const held = [...live.filter(item => item.reconciliation === 'STILL_RUNNING').map(item => ({ holderId: `job:${item.job.jobId}`, claims: item.job.claims })), ...heldLeaseHolders(input.root), ...(input.externalHolders ?? [])]
  const claims = normalizeClaims(input.claims ?? [])
  const queuedAhead = live.filter(item => item.reconciliation === 'QUEUED')
  // Strict FIFO: new work also waits behind earlier queued work that wants the same scarce resource.
  const conflicts = [...findClaimConflicts(claims, held, input.pressure), ...findClaimConflicts(claims, queuedAhead.map(item => ({ holderId: `queued:${item.job.jobId}`, claims: item.job.claims })), input.pressure).filter(c => c.claim !== 'CPU_HEAVY' && c.claim !== 'MEMORY_HEAVY')]
  const jobId = randomUUID()
  mkdirSync(jobsDir(input.root), { recursive: true })
  const logPath = path.join(jobsDir(input.root), `${jobId}.log`)
  const exitPath = path.join(jobsDir(input.root), `${jobId}.exit`)
  if (conflicts.length) {
    if (!input.queueIfBlocked) return { status: 'CLAIM_CONFLICT', conflicts }
    const queued: BackgroundJob = { ...baseJob({ jobId, input, args, dedupeKey, identity: { pid: 0, startTicks: 'queued', bootId: 'queued' }, logPath, exitPath, claims }), state: 'QUEUED', evidenceSources: input.evidenceSources, evidenceFiles: input.evidenceFiles, childMissionId: input.childMissionId }
    save(input.root, queued)
    return { status: 'QUEUED', job: queued, conflicts }
  }
  const job = launch(input.root, { ...baseJob({ jobId, input, args, dedupeKey, identity: { pid: 0, startTicks: 'pending', bootId: 'pending' }, logPath, exitPath, claims }), evidenceSources: input.evidenceSources, evidenceFiles: input.evidenceFiles, childMissionId: input.childMissionId }, input.env)
  return { status: 'STARTED', job }
}

/** Spawn the detached process for a job record and persist it as RUNNING with its real process identity. */
function launch(root: string, draft: BackgroundJob, env?: NodeJS.ProcessEnv): BackgroundJob {
  const fd = openSync(draft.logPath, 'a')
  try {
    const child = spawn('/bin/sh', ['-c', WRAPPER, 'foundry-job', draft.exitPath, draft.command, ...draft.args], {
      cwd: draft.cwd, detached: true, stdio: ['ignore', fd, fd], env: env ?? process.env, shell: false,
    })
    child.unref()
    const identity = child.pid ? readProcessIdentity(child.pid) : null
    const now = new Date().toISOString()
    // Fast exit before /proc could be read: the exit sentinel still holds the truth.
    const job: BackgroundJob = { ...draft, startedBy: readProcessIdentity(process.pid), state: 'RUNNING', startedAt: now, lastHeartbeat: now, identity: identity ?? { pid: child.pid ?? 0, startTicks: 'exited', bootId: 'exited' } }
    save(root, job)
    return job
  } finally {
    closeSync(fd)
  }
}

/** FIFO promotion of queued jobs whose claims no longer conflict. Exclusive marker files make concurrent promoters safe. */
export function promoteQueuedJobs(root: string, pressure?: PressureHint): BackgroundJob[] {
  const queued = listJobs(root).filter(job => job.state === 'QUEUED')
  if (!queued.length) return []
  const held = [...listJobs(root).filter(job => job.state === 'RUNNING' && identityIsLive(job.identity) && readExit(job) === null).map(job => ({ holderId: `job:${job.jobId}`, claims: job.claims })), ...heldLeaseHolders(root)]
  const promoted: BackgroundJob[] = []
  for (const job of queued) {
    if (findClaimConflicts(job.claims, held, pressure).length) continue
    const marker = path.join(jobsDir(root), `${job.jobId}.promote`)
    try { closeSync(openSync(marker, 'wx')) } catch { continue } // another promoter owns it
    try {
      const fresh = listJobs(root).find(item => item.jobId === job.jobId)
      if (!fresh || fresh.state !== 'QUEUED') continue
      const started = launch(root, fresh)
      held.push({ holderId: `job:${started.jobId}`, claims: started.claims })
      promoted.push(started)
    } finally {
      try { rmSync(marker, { force: true }) } catch { /* best effort */ }
    }
  }
  return promoted
}

function baseJob(p: { jobId: string; input: { missionId: string; taskId: string; kind: string; command: string; cwd: string }; args: string[]; dedupeKey: string; identity: ProcessIdentity; logPath: string; exitPath: string; claims: string[] }): BackgroundJob {
  const now = new Date().toISOString()
  return {
    jobId: p.jobId, missionId: p.input.missionId, taskId: p.input.taskId, kind: p.input.kind, command: p.input.command, args: p.args,
    cwd: p.input.cwd, dedupeKey: p.dedupeKey, identity: p.identity, startedAt: now, lastHeartbeat: now, state: 'RUNNING',
    exitStatus: null, finishedAt: null, logPath: p.logPath, exitPath: p.exitPath, claims: p.claims,
  }
}

export function cancelJob(root: string, jobId: string): BackgroundJob | null {
  const job = listJobs(root).find(item => item.jobId === jobId)
  if (job?.state === 'QUEUED') { const next: BackgroundJob = { ...job, state: 'CANCELLED', finishedAt: new Date().toISOString() }; save(root, next); return next }
  if (!job || job.state !== 'RUNNING') return job ?? null
  // Only signal if the generation still matches; never kill a recycled pid.
  if (identityIsLive(job.identity)) {
    try { process.kill(-job.identity.pid, 'SIGTERM') } catch { /* already gone */ }
  }
  const next: BackgroundJob = { ...job, state: 'CANCELLED', finishedAt: new Date().toISOString() }
  save(root, next)
  return next
}

export function jobLogTail(job: BackgroundJob, bytes = 4000): string {
  try {
    const text = readFileSync(job.logPath, 'utf8')
    return text.slice(-bytes)
  } catch {
    return ''
  }
}

/** A second mission needing the same live work joins it (shared result) instead of duplicating an expensive job. */
export function attachMissionToJob(root: string, jobId: string, missionId: string, taskId?: string): BackgroundJob | null {
  const job = listJobs(root).find(item => item.jobId === jobId)
  if (!job) return null
  if (job.missionId === missionId) return job
  const attachedTasks = { ...(job.attachedTasks ?? {}), ...(taskId ? { [missionId]: taskId } : {}) }
  if (job.attached?.includes(missionId) && JSON.stringify(attachedTasks) === JSON.stringify(job.attachedTasks ?? {})) return job
  const next = { ...job, attached: [...new Set([...(job.attached ?? []), missionId])], attachedTasks }
  save(root, next)
  return next
}

/** The task id this mission uses for the job (its own, or the name it gave a shared job it attached to). */
export function jobTaskFor(job: BackgroundJob, missionId: string): string {
  return job.missionId === missionId ? job.taskId : (job.attachedTasks?.[missionId] ?? job.taskId)
}
