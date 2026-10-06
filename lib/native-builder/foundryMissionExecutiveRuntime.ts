/**
 * Mission Executive runtime: the single seam between the controller/tool broker and the Phase 8 primitives.
 * One persisted graph per mission (foundryMissionExecutive), durable jobs (foundryBackgroundJobs), claims (foundryResourceClaims).
 * Nothing here runs a second scheduler; the controller calls in at: turn start (tick), before a tool (precheck),
 * after a tool (failure ledger) and through the job.* / mission.graph tools.
 */
import { createHash } from 'node:crypto'
import { watch, existsSync } from 'node:fs'
import path from 'node:path'
import { freemem } from 'node:os'
import { readProcessIdentity } from './foundryProcessIdentity'
import { findClaimConflicts } from './foundryResourceClaims'
import { commanderDeclaredNewFiles } from './foundryEngineeringContract'
import { acquireLease, listLeases } from './foundryClaimLeases'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { coarseTreeDigests, currentDigest, digestFiles, sourceClosure, suiteEntryFile } from './foundryEvidenceSources'
import { foundryDataHierarchy } from './foundryPaths'
import { classifyArgv } from './commandPolicy'
import {
  attachMissionToJob, jobTaskFor, inspectJob, listJobs, liveClaimHolders, reconcileJobs, startBackgroundJob, cancelJob, jobLogTail,
  type BackgroundJob,
} from './foundryBackgroundJobs'
import {
  loadMissionState, narrate, newTask, promoteReady, recordFailure, resumeMission, saveMissionState, selectNextActions,
  invalidateEvidence, reconcileLedger, MAX_IDENTICAL_FAILURES, MAX_TRANSIENT_WAITS, isTransientChildWait, childEnvelopeLimits, advanceActiveClock, activeElapsedMs, type EvidenceRecord, type MissionStateFiles, type MissionTask, type MissionBlocker,
} from './foundryMissionExecutive'

let rootOverride: string | null = null
export function setExecutiveRootForTests(root: string | null): void { rootOverride = root }
export function executiveRoot(): string { return rootOverride ?? path.join(foundryDataHierarchy().foundryRoot, 'executive') }

function freshState(missionId: string, goal = ''): MissionStateFiles {
  return { graph: { missionId, goal, tasks: [], updatedAt: new Date().toISOString() }, failures: {}, evidence: [], ledger: {} }
}
export function loadExecutiveState(missionId: string, goal = ''): MissionStateFiles {
  return loadMissionState(executiveRoot(), missionId) ?? freshState(missionId, goal)
}
function save(missionId: string, state: MissionStateFiles): void {
  state.graph.updatedAt = new Date().toISOString()
  saveMissionState(executiveRoot(), missionId, state)
}

/* --------------------------------- claims --------------------------------- */

const HEAVY_TOOLS: Record<string, string[]> = {
  'build.run': ['CPU_HEAVY', 'SUBSYSTEM_WRITE:build-output'],
  'package.run': ['CPU_HEAVY', 'MEMORY_HEAVY', 'SUBSYSTEM_WRITE:build-output'],
  'typecheck.run': ['CPU_HEAVY'],
  'lint.run': ['CPU_HEAVY'],
  'test.run': ['CPU_HEAVY'],
  'runtime.launch': ['RUNTIME_CONTROL'],
  'runtime.stop': ['RUNTIME_CONTROL'],
  'runtime.launch_installed': ['RUNTIME_CONTROL'],
  'runtime.stop_installed': ['RUNTIME_CONTROL'],
  'runtime.transition_to_active': ['RUNTIME_CONTROL'],
  'installer.activate': ['RUNTIME_CONTROL'],
}

export function toolClaims(tool: string, input: Record<string, unknown> = {}): string[] {
  const claims = new Set(HEAVY_TOOLS[tool] ?? [])
  if (tool.startsWith('browser.') && tool !== 'browser.status') claims.add('BROWSER_SESSION')
  const port = Number(input.port)
  if (Number.isInteger(port) && port > 0 && (tool.startsWith('runtime.') || tool === 'process.start')) claims.add(`PORT:${port}`)
  return [...claims]
}

function pressure() { return { ramFreeMb: Math.round(freemem() / 1024 / 1024) } }

/* --------------------------------- failure ledger --------------------------------- */

export function normalizeFailure(text: string): string {
  const line = (text.split(/\r?\n/).find(item => /error|fail|cannot|not found|ts\d{4}|exit/i.test(item)) ?? text.split(/\r?\n/)[0] ?? '').toLowerCase()
  return createHash('sha256').update(line.replace(/\d{4}-\d\d-\d\dt[\d:.z]+/g, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '').replace(/\d+(ms|s)\b/g, '').replace(/\s+/g, ' ').trim().slice(0, 300)).digest('hex').slice(0, 16)
}

/** Same call on a file that has since changed is a new attempt, not a repeat: checks (lint/typecheck/tests) are keyed on their targets' content. */
function argsKey(tool: string, input: Record<string, unknown>): string {
  let content = ''
  if (tool === 'lint.run' || tool === 'typecheck.run') {
    const targets = Array.isArray(input.targets) ? input.targets.map(String) : typeof input.scopeGlob === 'string' ? [input.scopeGlob] : []
    const digests = digestFiles(resolveRepoRoot(), targets.filter(target => /^[\w./@-]+$/.test(target)))
    content = JSON.stringify(digests)
  }
  // A rewrite is the same attempt when the file and the text are the same, whatever explanation the model attached to it.
  const identity = tool === 'file.write' ? JSON.stringify({ path: input.path, content: input.content, startLine: input.startLine, endLine: input.endLine }) : JSON.stringify(input)
  return `${tool}:${createHash('sha256').update(identity + content).digest('hex').slice(0, 12)}`
}

/** Persisted, process-restart-proof: a tool+args that already failed identically too many times is refused until the plan changes. */
export function repeatedFailureBlock(missionId: string, tool: string, input: Record<string, unknown>): string | null {
  const state = loadMissionState(executiveRoot(), missionId)
  if (!state) return null
  const key = argsKey(tool, input)
  const hit = Object.entries(state.failures).find(([k, v]) => k.startsWith(`${key}::`) && v.count > MAX_IDENTICAL_FAILURES)
  return hit ? `REPEATED_FAILURE: ${tool} with these arguments failed identically ${hit[1].count} times (signature ${hit[1].signature}). Classify the root cause and change the approach or arguments; do not retry unchanged.` : null
}

export function executiveAfterTool(missionId: string, tool: string, input: Record<string, unknown>, result: { ok: boolean; error?: string }): string | null {
  if (result.ok) return null
  const state = loadExecutiveState(missionId)
  const { book, verdict } = recordFailure(state.failures, argsKey(tool, input), normalizeFailure(result.error ?? tool))
  state.failures = book
  save(missionId, state)
  return verdict === 'STOP_AND_CLASSIFY' ? `Identical failure of ${tool} repeated; stop retrying and diagnose or replan.` : null
}

/* --------------------------------- precheck --------------------------------- */

export type ExecutivePrecheck = { ok: true } | { ok: false; wait: boolean; error: string }

export function executivePrecheck(missionId: string, tool: string, input: Record<string, unknown>): ExecutivePrecheck {
  const repeated = repeatedFailureBlock(missionId, tool, input)
  if (repeated) return { ok: false, wait: false, error: repeated }
  const claims = toolClaims(tool, input)
  if (!claims.length) return { ok: true }
  const held = liveClaimHolders(executiveRoot())
  const live = reconcileJobs(executiveRoot()).filter(item => item.reconciliation === 'STILL_RUNNING')
  // Same heavy tool already running as a background job: do not start a duplicate.
  const twin = live.find(item => item.job.kind === tool.split('.')[0] && claims.some(claim => item.job.claims.includes(claim) && claim.startsWith('SUBSYSTEM_WRITE')))
  if (twin) return { ok: false, wait: true, error: `WAITING: a ${twin.job.kind} job (${twin.job.jobId.slice(0, 8)}) is already running and owns the same output. Use job.wait or continue independent work; it will complete on its own.` }
  const conflicts = findClaimConflicts(claims, held, pressure())
  if (conflicts.length) return { ok: false, wait: true, error: `WAITING: ${conflicts[0].reason}. Continue independent work or job.wait; this is queued, not refused.` }
  return { ok: true }
}

/* --------------------------------- jobs --------------------------------- */

export type JobSpecKind = 'build' | 'typecheck' | 'test' | 'lint'

export function argvForJobSpec(spec: { kind: JobSpecKind; suite?: string; targets?: string[] }): { command: string; args: string[]; claims: string[] } | { error: string } {
  switch (spec.kind) {
    case 'build': return { command: 'pnpm', args: ['run', 'build'], claims: ['CPU_HEAVY', 'MEMORY_HEAVY', 'SUBSYSTEM_WRITE:build-output'] }
    case 'typecheck': return { command: 'pnpm', args: ['exec', 'tsc', '--noEmit'], claims: ['CPU_HEAVY'] }
    case 'lint': return { command: 'pnpm', args: ['exec', 'eslint', ...(spec.targets ?? []).filter(item => /^[\w@./-]+$/.test(item) && !item.startsWith('-'))], claims: ['CPU_HEAVY'] }
    case 'test':
      if (!spec.suite || !/^validate:[\w:-]+$/.test(spec.suite)) return { error: 'job.start kind=test requires suite matching validate:*' }
      return { command: 'pnpm', args: ['run', spec.suite], claims: ['CPU_HEAVY'] }
    default: return { error: `Unsupported job kind ${(spec as { kind: string }).kind}` }
  }
}

export type StartJobOutcome =
  | { ok: true; job: BackgroundJob; taskId: string; duplicate: boolean; queued?: string }
  | { ok: false; error: string; waiting?: boolean }

export function executiveStartJob(input: {
  missionId: string
  goal?: string
  cwd: string
  spec: { kind: JobSpecKind; suite?: string; targets?: string[] }
  taskId?: string
  /** Tasks that must wait for this job; they become WAITING with a JOB blocker and wake on completion. */
  blocks?: string[]
  extraClaims?: string[]
}): StartJobOutcome {
  const argv = argvForJobSpec(input.spec)
  if ('error' in argv) return { ok: false, error: argv.error }
  const policy = classifyArgv(argv.command, argv.args)
  if (policy.policyClass !== 'SAFE_LOCAL') return { ok: false, error: policy.reason }
  const state = loadExecutiveState(input.missionId, input.goal)
  const taskId = input.taskId ?? `job-${input.spec.kind}${input.spec.suite ? `-${input.spec.suite}` : ''}`
  const repoRoot = resolveRepoRoot()
  const entry = input.spec.kind === 'test' && input.spec.suite ? suiteEntryFile(repoRoot, input.spec.suite) : null
  const evidenceSources = entry ? digestFiles(repoRoot, sourceClosure(repoRoot, entry)) : coarseTreeDigests(repoRoot)
  const started = startBackgroundJob({
    evidenceSources,
    root: executiveRoot(), missionId: input.missionId, taskId, kind: input.spec.kind, command: argv.command, args: argv.args, cwd: input.cwd,
    claims: [...argv.claims, ...(input.extraClaims ?? [])], pressure: pressure(), queueIfBlocked: true,
  })
  if (started.status === 'CLAIM_CONFLICT') return { ok: false, waiting: true, error: `WAITING: ${started.conflicts[0].reason}. Queued, not refused.` }
  const job = started.status === 'DUPLICATE' ? (attachMissionToJob(executiveRoot(), started.job.jobId, input.missionId, taskId) ?? started.job) : started.job
  const existing = state.graph.tasks.find(task => task.taskId === taskId)
  if (!existing) {
    state.graph.tasks.push(newTask({ taskId, missionId: input.missionId, description: `${input.spec.kind}${input.spec.suite ? ` ${input.spec.suite}` : ''}`, completionCondition: `${input.spec.kind} exits 0`, state: 'RUNNING', owner: `job:${job.jobId}`, resourceClaims: job.claims, readOnly: input.spec.kind !== 'build' }))
  } else if (existing.state !== 'RUNNING') {
    existing.state = 'RUNNING'; existing.owner = `job:${job.jobId}`; existing.resourceClaims = job.claims; existing.updatedAt = new Date().toISOString()
  }
  for (const dependent of input.blocks ?? []) {
    const task = state.graph.tasks.find(item => item.taskId === dependent)
    if (!task || task.state === 'COMPLETED') continue
    const blocker: MissionBlocker = { kind: 'JOB', ref: job.jobId, detail: `the ${input.spec.kind}` }
    if (!task.dependencies.includes(taskId)) task.dependencies.push(taskId)
    if (!task.blockers.some(item => item.ref === job.jobId)) task.blockers.push(blocker)
    task.state = 'WAITING'; task.updatedAt = new Date().toISOString()
  }
  save(input.missionId, state)
  logTimeline(input.missionId, 'job', started.status === 'QUEUED' ? `${input.spec.kind} queued behind running work` : started.status === 'DUPLICATE' ? `${input.spec.kind} already running; joined it instead of starting another` : `Started ${input.spec.kind}${input.spec.suite ? ` (${input.spec.suite})` : ''} in the background`)
  return { ok: true, job, taskId, duplicate: started.status === 'DUPLICATE', ...(started.status === 'QUEUED' ? { queued: started.conflicts[0].reason } : {}) }
}

/** Event-driven: resolves when the job's exit sentinel appears (fs.watch), bounded by timeoutMs. No busy polling. */
export function waitForJobEvent(jobId: string, timeoutMs: number): Promise<BackgroundJob | null> {
  const root = executiveRoot()
  const job = listJobs(root).find(item => item.jobId === jobId)
  if (!job) return Promise.resolve(null)
  const settled = () => { const { job: next, reconciliation } = inspectJob(root, job); return reconciliation === 'STILL_RUNNING' ? null : next }
  const already = settled()
  if (already) return Promise.resolve(already)
  return new Promise(resolve => {
    let done = false
    const finish = (value: BackgroundJob | null) => { if (done) return; done = true; clearTimeout(timer); clearInterval(safety); watcher?.close(); resolve(value) }
    const timer = setTimeout(() => finish(settled()), timeoutMs)
    // Safety re-check handles a process that dies without writing the sentinel (SIGKILL): rare, so it is slow (2s).
    const safety = setInterval(() => { const value = settled(); if (value) finish(value) }, 2000)
    let watcher: ReturnType<typeof watch> | null = null
    try {
      watcher = watch(path.dirname(job.exitPath), () => { if (existsSync(job.exitPath)) { const value = settled(); if (value) finish(value) } })
    } catch { /* safety interval covers it */ }
  })
}

/* --------------------------------- tick / resume --------------------------------- */

export type TickResult = { events: string[]; brief: string; next: ReturnType<typeof selectNextActions> }

/** Called at each turn start and on resume. Disk/process truth wins; finished jobs are folded in exactly once. */
/** Authoritative diagnostics (compiler + lint) for one owned file; non-source files and files that do not exist have none (the missing-file rule covers those). */
const ownedFileDiagnose: Diagnose = file => {
  const root = resolveRepoRoot()
  if (!/\.(?:tsx?|mts)$/.test(file) || !existsSyncCeil(path.join(root, file))) return []
  return diagnoseAll(root, file).map(item => ({ file, line: item.line, code: item.code, message: item.message }))
}
/** Bump when the authoritative diagnostics gain a rule: tasks already marked complete are validated again under it. */
const COMPLETION_GATE_RULES_VERSION = 8
const digestOwnedFiles = (files: string[]) => {
  const root = resolveRepoRoot()
  return createHash('sha256').update(`rules:${COMPLETION_GATE_RULES_VERSION}\n` + files.map(file => { try { return `${file}\n${readFileSyncCeil(path.join(root, file), 'utf8')}` } catch { return `${file}\n-` } }).join('\n--\n')).digest('hex').slice(0, 16)
}

/**
 * Completion truth: a task that owns files is not COMPLETED while those files fail authoritative validation. Re-checked whenever the owned files
 * change (and the first time a task is seen completed); invalidations are recorded in the task history and the durable timeline.
 */
export function enforceCompletionGate(missionId: string, diagnose: Diagnose = ownedFileDiagnose): string[] {
  const state = loadMissionState(executiveRoot(), missionId)
  if (!state) return []
  const outcome = gateCompletion(state.graph, state.evidence, diagnose, { maxAttempts: MAX_TASK_ATTEMPTS, digestOf: digestOwnedFiles })
  const checked = JSON.stringify(outcome.graph.tasks.map(task => task.completionCheck)) !== JSON.stringify(state.graph.tasks.map(task => task.completionCheck))
  if (!outcome.invalidated.length && !checked) return []
  state.graph = outcome.graph
  state.evidence = outcome.evidence
  save(missionId, state)
  const events = outcome.invalidated.map(item => `${item.taskId} was marked COMPLETED but ${item.unchanged ? 'none of its files changed since it started' : `its files still fail validation (${item.diagnostics.length} diagnostic(s))`}; completion invalidated, ${item.failed ? 'attempts used up: FAILED' : 'repair required'}${item.dependentsWaiting.length ? `; ${item.dependentsWaiting.join(', ')} wait on it again` : ''}${item.staleEvidence.length ? `; ${item.staleEvidence.length} evidence record(s) stale` : ''}`)
  return events
}

/** Executive tick -> the active clock advances by the time since the previous tick (continuous stretches only). */
export function touchActiveClock(missionId: string): void {
  const state = loadMissionState(executiveRoot(), missionId)
  if (!state?.ceilings) return
  state.ceilings = advanceActiveClock(state.ceilings, Date.now())
  save(missionId, state)
}

export function executiveTick(missionId: string, goal = ''): TickResult {
  const root = executiveRoot()
  const events: string[] = []
  const generation = recordGeneration(missionId)
  touchActiveClock(missionId)
  if (generation.reopened) {
    const live = listJobs(root, { missionId })
    logTimeline(missionId, 'reopened', `Foundry reopened this mission (process generation ${generation.generation}); ${live.filter(job => job.state === 'RUNNING').length} background job(s) were still running, ${live.filter(job => job.state === 'SUCCEEDED' || job.state === 'FAILED' || job.state === 'ORPHANED').length} already settled`)
  }
  let state = loadMissionState(root, missionId)
  const jobs = listJobs(root, { missionId })
  if (!state && !jobs.length) {
    return { events, brief: '', next: selectNextActions({ graph: freshState(missionId).graph }) }
  }
  state ??= freshState(missionId, goal)
  const before = new Map(state.graph.tasks.map(task => [task.taskId, task.state]))
  save(missionId, state)
  const report = resumeMission(root, missionId)
  const after = report?.state ?? state
  for (const item of report?.jobs ?? []) {
    if (item.reconciliation === 'STILL_RUNNING') continue
    const task = after.graph.tasks.find(entry => entry.owner === `job:${item.jobId}` || entry.taskId === item.taskId)
    if (task && before.get(task.taskId) === 'RUNNING' && task.state !== 'RUNNING') {
      const job = listJobs(root).find(entry => entry.jobId === item.jobId)
      events.push(`${job?.kind ?? 'job'} ${job?.state === 'SUCCEEDED' ? (item.reconciliation === 'COMPLETED_WHILE_AWAY' ? 'finished while Foundry was away' : 'finished') : job?.state === 'FAILED' ? `failed${item.reconciliation === 'FAILED_WHILE_AWAY' ? ' while Foundry was away' : ''} (exit ${job?.exitStatus})` : 'worker was lost; partial output discarded'}`)
      if (job?.state === 'FAILED') {
        const verdict = recordFailure(after.failures, `job:${job.kind}:${job.dedupeKey}`, normalizeFailure(jobLogTail(job, 2000)))
        after.failures = verdict.book
      }
    }
  }
  for (const task of after.graph.tasks) if (before.get(task.taskId) === 'WAITING' && task.state === 'READY') events.push(`${task.description} is ready`)
  save(missionId, after)
  events.push(...reactToJobOutcomes(missionId))
  events.push(...enforceCompletionGate(missionId))
  const evidence = evaluateEvidence(missionId, true)
  for (const item of evidence.newlyStale) events.push(`evidence for ${item.criterion} is stale (${item.changed.slice(0, 3).join(', ')} changed); other evidence stays current`)
  for (const event of events) logTimeline(missionId, 'event', event)
  const running = listJobs(root, { missionId })
  return { events, brief: narrate(after.graph, running), next: selectNextActions({ graph: after.graph, heldByJobs: liveClaimHolders(root), failures: after.failures, pressure: pressure() }) }
}

/* --------------------------------- graph tool --------------------------------- */

export function executiveGraphTool(missionId: string, input: Record<string, unknown>): { ok: boolean; result?: unknown; error?: string } {
  const state = loadExecutiveState(missionId)
  const action = String(input.action ?? 'list')
  if (action === 'add_task') {
    const taskId = String(input.taskId ?? '')
    if (!/^[\w.-]{1,60}$/.test(taskId)) return { ok: false, error: 'taskId must be 1-60 chars of [A-Za-z0-9_.-].' }
    const existing = state.graph.tasks.find(task => task.taskId === taskId)
    // Retry-safe: re-adding the same task is a no-op success, and says what to do next.
    if (existing) {
      const note = existing.state === 'READY' || existing.state === 'RUNNING'
        ? `NEXT CALL (task ${taskId} is ${existing.state}; do not add it again): mission.graph {"action":"update_task","taskId":"${taskId}","state":"COMPLETED"}`
        : existing.state === 'WAITING' ? `Task ${taskId} is WAITING on ${existing.blockers.map(b => b.detail).join(', ')}; it wakes automatically. Do independent read-only work now. Do not add it again.`
        : `Task ${taskId} is ${existing.state}; nothing to add.`
      return { ok: true, result: { note, taskId, state: existing.state } }
    }
    const dependencies = Array.isArray(input.dependencies) ? input.dependencies.map(String) : []
    const missing = dependencies.filter(id => !state.graph.tasks.some(task => task.taskId === id))
    if (missing.length) return { ok: false, error: `Unknown dependencies: ${missing.join(', ')}` }
    const description = String(input.description ?? taskId)
    const files = filesDeclaredBy(description)
    const task = newTask({
      ...(files.length ? { spec: description, files } : {}),
      taskId, missionId, description, completionCondition: String(input.completionCondition ?? 'done'), dependencies,
      resourceClaims: Array.isArray(input.resourceClaims) ? input.resourceClaims.map(String) : [], filesAtRisk: Array.isArray(input.filesAtRisk) ? input.filesAtRisk.map(String) : [],
      subsystem: typeof input.subsystem === 'string' ? input.subsystem : undefined, readOnly: input.readOnly === true,
    })
    const open = dependencies.filter(id => state.graph.tasks.find(item => item.taskId === id)?.state !== 'COMPLETED')
    if (open.length) { task.state = 'WAITING'; task.blockers = open.map(id => ({ kind: 'DEPENDENCY' as const, ref: id, detail: id })) }
    state.graph.tasks.push(task)
    save(missionId, state)
    logTimeline(missionId, 'plan', `Planned task ${taskId}: ${description.slice(0, 120)}`)
    return executiveGraphTool(missionId, { action: 'list' })
  } else if (action === 'update_task') {
    const task = state.graph.tasks.find(item => item.taskId === String(input.taskId))
    if (!task) return { ok: false, error: 'Unknown task.' }
    const next = String(input.state ?? '')
    if (!['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'READY'].includes(next)) return { ok: false, error: 'state must be RUNNING|COMPLETED|FAILED|CANCELLED|READY.' }
    if (next === 'RUNNING' && (task.state === 'WAITING' || task.state === 'BLOCKED')) return { ok: false, error: `Task ${task.taskId} is ${task.state}; it cannot run until its blockers clear.` }
    if (next === 'COMPLETED' && task.files?.length) {
      const refusal = completionRefusal(task, ownedFileDiagnose, digestOwnedFiles(task.files))
      if (refusal) return { ok: false, error: refusal }
    }
    task.state = next as MissionTask['state']; task.updatedAt = new Date().toISOString()
  } else if (action === 'block_task') {
    const task = state.graph.tasks.find(item => item.taskId === String(input.taskId))
    const kind = String(input.kind ?? '')
    if (!task || !['COMMANDER', 'CREDENTIALS', 'SUDO', 'EXTERNAL_SERVICE'].includes(kind)) return { ok: false, error: 'block_task needs a known taskId and kind COMMANDER|CREDENTIALS|SUDO|EXTERNAL_SERVICE (use job/dependency waits for WAITING).' }
    task.blockers = [{ kind: kind as MissionBlocker['kind'], ref: kind, detail: String(input.detail ?? kind) }]; task.state = 'BLOCKED'; task.updatedAt = new Date().toISOString()
  } else if (action !== 'list' && action !== 'next') return { ok: false, error: `Unknown action ${action}.` }
  state.graph = promoteReady(state.graph)
  save(missionId, state)
  const next = selectNextActions({ graph: state.graph, heldByJobs: liveClaimHolders(executiveRoot()), failures: state.failures, pressure: pressure() })
  return { ok: true, result: { tasks: state.graph.tasks.map(task => ({ taskId: task.taskId, state: task.state, dependencies: task.dependencies, blockers: task.blockers.map(item => `${item.kind}:${item.detail}`) })), next: { start: next.start.map(task => task.taskId), deferred: next.deferred, idleReason: next.idleReason } } }
}

export function executiveCancelJob(jobId: string): BackgroundJob | null { return cancelJob(executiveRoot(), jobId) }

/* --------------------------------- orchestration missions --------------------------------- */

const BACKGROUND_INTENT = /\b(?:job\.(start|wait|status)|task\.run)\b|\b(in the )?background\b|\bwhile (it|that|the \w+) (runs|is running|finishes)\b|\blong[- ]running\b|\bin parallel\b|\bmission\.graph\b/i
const EDIT_INTENT = /\b(change|fix|patch|replace|add|install|activate|implement|refactor|rewrite)\b/i
const EDIT_NEGATED = /\b(do not|don't|never|without)\s+(edit|change|modify|write)|\bread-only\b|\bno (source )?mutation\b/i

export function missionWantsBackgroundWork(request: string): boolean { return BACKGROUND_INTENT.test(request) }

/** A mission whose objective is to run and coordinate long-running work (not to edit source): gated on job truth, not on SOURCE_DONE. */
const EXPLICIT_EXECUTIVE_TOOL = /\b(job\.(start|wait|status)|task\.run|mission\.graph)\b/i

export function isBackgroundOrchestrationRequest(request: string): boolean {
  // A request that names files to create/rewrite is authoring work: loose words like "background" inside its spec must not turn it into
  // an orchestration mission (which completes on job truth, not on files). Only explicit executive tools make that call.
  if (commanderDeclaredNewFiles(request).length && !EXPLICIT_EXECUTIVE_TOOL.test(request)) return false
  return BACKGROUND_INTENT.test(request) && (!EDIT_INTENT.test(request) || EDIT_NEGATED.test(request))
}

export type OrchestrationProgress = {
  phase: 'START_JOB' | 'JOB_RUNNING' | 'TASKS_OPEN' | 'RUN_TASKS' | 'STUCK' | 'DONE'
  /** The Commander named graph steps that have not been taken yet. */
  wantsGraph: boolean
  /** READY non-job tasks that can be done now (independent work while a job runs). */
  readyIndependent: string[]
  running: BackgroundJob[]
  finished: BackgroundJob[]
  detail: string
}

export type RequestedTask = { action: 'add_task'; taskId: string; description?: string; dependencies?: string[]; readOnly?: boolean }

/** Every add_task the Commander spelled out (taskId / description / dependencies), in order. */
export function requestedAddTasks(request: string): RequestedTask[] {
  const tasks: RequestedTask[] = []
  const parts = request.split(/(?=\badd_task\b)/i).filter(part => /^add_task\b/i.test(part))
  for (const part of parts) {
    const sentence = part.split(/\.\s+(?=Use\s|Do not\s|When\s|While\s|Finish\s)/)[0]
    const taskId = /\btaskId\s+["']([\w.-]+)["']/i.exec(sentence)?.[1]
    if (!taskId) continue
    const description = /description\s+"([^"]+)"/i.exec(sentence)?.[1] ?? /description\s+'([^']+)'/i.exec(sentence)?.[1]
    const deps = /dependencies\s*\[([^\]]*)\]/i.exec(sentence.replace(/description\s+"[^"]*"/i, ''))?.[1]
    tasks.push({ action: 'add_task', taskId, ...(description ? { description } : {}), ...(deps ? { dependencies: [...deps.matchAll(/["']([\w.-]+)["']/g)].map(item => item[1]) } : {}), ...(/read-?only/i.test(sentence) ? { readOnly: true } : {}) })
  }
  return tasks
}
export function requestedAddTask(request: string): RequestedTask | null { return requestedAddTasks(request)[0] ?? null }

export type RequestedJob = { kind: string; taskId: string; suite?: string; targets?: string[]; afterAllTasks?: boolean }

/** Jobs the Commander spelled out as `job.start ... kind X [suite "validate:..."] ... taskId "Y"`, in order. */
export function requestedJobs(request: string): RequestedJob[] {
  const jobs: RequestedJob[] = []
  const parts = request.split(/(?=\bjob\.start\b)/i).filter(part => /^job\.start\b/i.test(part))
  for (const part of parts) {
    const sentence = part.split(/\.\s+(?=Use\s|Do not\s|When\s|While\s|Finish\s)/)[0]
    const kind = /\bkind\s+["']?(build|typecheck|test|lint)\b/i.exec(sentence)?.[1]?.toLowerCase()
    const taskId = /\btaskId\s+["']([\w.-]+)["']/i.exec(sentence)?.[1]
    const suite = /\bsuite\s+["']?(validate:[\w:-]+)["']?/i.exec(sentence)?.[1]
    const target = /\btargets?\s+\[?["']?((?:lib|app|components|scripts)\/[\w./@-]+)["']?/i.exec(sentence)?.[1]
    if (kind && taskId) jobs.push({ kind, taskId, ...(suite ? { suite } : {}), ...(target ? { targets: [target] } : {}), ...(/\bafter all tasks\b/i.test(sentence) ? { afterAllTasks: true } : {}) })
  }
  return jobs
}

export function orchestrationProgress(missionId: string, request = ''): OrchestrationProgress {
  if (isBuildMissionRequest(request)) {
    const build = buildMissionProgress(missionId, request)
    const finished = listJobs(executiveRoot(), { missionId }).filter(job => job.state !== 'RUNNING' && job.state !== 'QUEUED')
    const phase: OrchestrationProgress['phase'] = build.phase === 'DEFINE' ? 'TASKS_OPEN' : build.phase === 'WAIT' ? 'JOB_RUNNING' : build.phase
    return { phase, wantsGraph: build.phase === 'DEFINE', readyIndependent: [], running: build.running, finished, detail: build.detail }
  }
  const jobs = listJobs(executiveRoot(), { missionId })
  const settled = jobs.map(job => (job.state === 'RUNNING' ? inspectJob(executiveRoot(), job).job : job))
  const running = settled.filter(job => job.state === 'RUNNING' || job.state === 'QUEUED')
  const finished = settled.filter(job => job.state !== 'RUNNING' && job.state !== 'QUEUED')
  // A requested job is still owed if it never started, or its worker was lost (killed / signal death) and the retry budget remains.
  // A genuine nonzero exit is a build failure to diagnose, not a lost worker: it is not silently re-run.
  const lostWorker = (job: BackgroundJob) => job.state === 'ORPHANED' || (job.state === 'FAILED' && (job.exitStatus ?? 0) >= 128)
  const stale = settled.length ? staleCriteria(missionId) : new Set<string>()
  const pendingJobs = requestedJobs(request).filter(job => {
    const attempts = settled.filter(item => jobTaskFor(item, missionId) === job.taskId)
    if (!attempts.length) return true
    if (attempts.some(item => item.state === 'RUNNING' || item.state === 'QUEUED')) return false // already (re-)verifying
    if (stale.has(job.taskId) && attempts.length < 4) return true
    return lostWorker(attempts[attempts.length - 1]) && attempts.length < 3
  })
  if (pendingJobs.length) {
    const next = pendingJobs[0]
    const args = { kind: next.kind, taskId: next.taskId, ...(next.suite ? { suite: next.suite } : {}), ...(next.targets ? { targets: next.targets } : {}) }
    return { phase: 'START_JOB', wantsGraph: false, readyIndependent: [], running, finished, detail: `${settled.some(item => lostWorker(item)) ? 'A background worker was lost before finishing (partial output discarded; accepted evidence kept). ' : ''}${stale.size ? `Evidence for ${[...stale].join(', ')} is stale because its source files changed; re-verify only that. ` : ''}${running.length ? `${running.length} job(s) already running. ` : ''}Your ONLY next step: job.start ${JSON.stringify(args)} (the Commander asked for ${pendingJobs.length} more job(s); independent jobs may run at the same time).` }
  }
  if (!settled.length) return { phase: 'START_JOB', wantsGraph: false, readyIndependent: [], running, finished, detail: 'No background job has been started yet. Start the job the Commander asked for with job.start.' }
  if (running.length) {
    const graphTasks = loadMissionState(executiveRoot(), missionId)?.graph.tasks ?? []
    const undefinedSteps = requestedAddTasks(request).filter(step => !graphTasks.some(task => task.taskId === step.taskId))
    const wantsGraph = undefinedSteps.length > 0
    const readyIndependent = graphTasks.filter(task => task.state === 'READY' && !task.owner?.startsWith('job:')).map(task => task.taskId)
    const label = running.map(job => `${job.kind} (${job.jobId.slice(0, 8)}${job.state === 'QUEUED' ? ', queued' : ''})`).join(', ')
    const independent = 'then do the independent read-only work the Commander listed while it runs; call job.wait only when none remains'
    const detail = wantsGraph
      ? `${label} is running. Your ONLY next step: mission.graph ${JSON.stringify(undefinedSteps[0])} (${independent} after that). Do not call job.start again.`
      : readyIndependent.length
        ? `${label} still running. Independent task(s) ready now: ${readyIndependent.join(', ')}. Do their read-only work (file.read), then close each with mission.graph update_task COMPLETED. Waiting tasks wake by themselves when the job finishes.`
        : `${label} still running. Do the independent read-only work the Commander listed now; call job.wait only when none remains.`
    return { phase: 'JOB_RUNNING', wantsGraph, readyIndependent, running, finished, detail }
  }
  const graphNow = loadMissionState(executiveRoot(), missionId)?.graph.tasks ?? []
  const undefinedGraph = /\bmission\.graph\b/i.test(request) && !graphNow.some(task => !task.owner?.startsWith('job:'))
  if (undefinedGraph) {
    const call = requestedAddTask(request)
    return { phase: 'TASKS_OPEN', wantsGraph: true, readyIndependent: [], running, finished, detail: `Jobs finished (${finished.map(job => `${job.kind} ${job.state} exit=${job.exitStatus}`).join('; ')}). The Commander's task is not defined yet: ${call ? `call mission.graph ${JSON.stringify(call)}` : 'define it with mission.graph add_task'}. Do not return COMPLETE yet.` }
  }
  const open = graphNow.filter(task => !['COMPLETED', 'CANCELLED', 'FAILED'].includes(task.state) && !task.owner?.startsWith('job:'))
  if (open.length) {
    return { phase: 'TASKS_OPEN', wantsGraph: true, readyIndependent: [], running, finished, detail: `Jobs finished (${finished.map(job => `${job.kind} ${job.state} exit=${job.exitStatus}`).join('; ')}). Open tasks: ${open.map(task => `${task.taskId} [${task.state}]${task.state === 'READY' ? ' ready now' : ''}`).join(', ')}. Do each READY task (read-only evidence is enough unless it says otherwise), then mark it done with this exact call: mission.graph {"action":"update_task","taskId":"${(open.find(task => task.state === 'READY') ?? open[0]).taskId}","state":"COMPLETED"}. Do not return COMPLETE while tasks are open.` }
  }
  evaluateEvidence(missionId, true) // persist the final attributed evidence before the mission closes
  return { phase: 'DONE', wantsGraph: false, readyIndependent: [], running, finished, detail: `Background jobs finished: ${finished.map(job => `${job.kind} ${job.state} exit=${job.exitStatus}`).join('; ')}. Report the outcome and any independent findings, then return COMPLETE.` }
}

/** When the executive knows the exact next tool call, give it in the model's decision syntax. `hasRead`: the mission already holds read evidence. */
export function orchestrationNextCall(missionId: string, request: string, hasRead = false): string | null {
  if (!isBackgroundOrchestrationRequest(request)) return null
  if (isBuildMissionRequest(request)) return buildMissionProgress(missionId, request).nextCall
  const decision = (reasoningSummary: string, name: string, args: Record<string, unknown>) => JSON.stringify({ decision: 'TOOL', reasoningSummary, tool: { name, args } })
  const progress = orchestrationProgress(missionId, request)
  if (progress.phase === 'START_JOB') {
    const started = listJobs(executiveRoot(), { missionId })
    const staleNow = staleCriteria(missionId)
    const next = requestedJobs(request).find(job => {
      const attempts = started.filter(item => jobTaskFor(item, missionId) === job.taskId)
      if (!attempts.length) return true
      if (attempts.some(item => item.state === 'RUNNING' || item.state === 'QUEUED')) return false
      const last = attempts[attempts.length - 1]
      if (staleNow.has(job.taskId) && attempts.length < 4) return true
      return (last.state === 'ORPHANED' || (last.state === 'FAILED' && (last.exitStatus ?? 0) >= 128)) && attempts.length < 3
    })
    return next ? decision(`start ${next.taskId}`, 'job.start', { kind: next.kind, taskId: next.taskId, ...(next.suite ? { suite: next.suite } : {}), ...(next.targets ? { targets: next.targets } : {}) }) : null
  }
  const graphTasks = loadMissionState(executiveRoot(), missionId)?.graph.tasks ?? []
  const undefinedStep = requestedAddTasks(request).find(step => !graphTasks.some(task => task.taskId === step.taskId))
  if (undefinedStep && (progress.phase === 'JOB_RUNNING' || progress.phase === 'TASKS_OPEN')) return decision(`define task ${undefinedStep.taskId}`, 'mission.graph', undefinedStep)
  const ready = graphTasks.filter(task => task.state === 'READY' && !task.owner?.startsWith('job:'))
  if (progress.phase === 'JOB_RUNNING') {
    // Independent work during the wait: close it once there is read evidence; until then the model reads.
    return ready.length && hasRead ? decision(`finish independent task ${ready[0].taskId}`, 'mission.graph', { action: 'update_task', taskId: ready[0].taskId, state: 'COMPLETED' }) : null
  }
  if (progress.phase !== 'TASKS_OPEN' || !ready.length) return null
  return decision(`finish ready task ${ready[0].taskId}`, 'mission.graph', { action: 'update_task', taskId: ready[0].taskId, state: 'COMPLETED' })
}

/* --------------------------------- evidence continuity --------------------------------- */

export type EvidenceView = { records: EvidenceRecord[]; staleIds: string[]; newlyStale: { criterion: string; changed: string[] }[]; ledgerNeedsReverify: string[] }

/**
 * Bring evidence up to date with the files on disk. New terminal jobs become attributed evidence (source digests captured at job start);
 * records whose own sources changed go STALE; everything else stays CURRENT. Pure with respect to disk unless persist=true.
 */
export function evaluateEvidence(missionId: string, persist = false): EvidenceView {
  const root = repoRootForEvidence()
  const state = loadExecutiveState(missionId)
  let records = [...state.evidence]
  for (const job of listJobs(executiveRoot(), { missionId })) {
    if ((job.state !== 'SUCCEEDED' && job.state !== 'FAILED') || (!job.evidenceSources && !job.evidenceFiles)) continue
    const evidenceId = `job:${job.jobId}`
    if (records.some(record => record.evidenceId === evidenceId)) continue
    records.push({
      evidenceId, criterion: jobTaskFor(job, missionId), source: `${job.kind}${job.state === 'FAILED' ? ' (failed)' : ''} exit=${job.exitStatus}`,
      sourceDigests: job.evidenceFiles ? digestFiles(root, job.evidenceFiles) : job.evidenceSources!, at: job.finishedAt ?? new Date().toISOString(), status: 'CURRENT',
    })
  }
  let trees: Record<string, string> | null = null
  const treeDigests = () => (trees ??= coarseTreeDigests(root))
  const current: Record<string, string> = {}
  for (const record of records) if (record.status === 'CURRENT') for (const key of Object.keys(record.sourceDigests)) current[key] ??= currentDigest(root, key, treeDigests)
  const before = new Set(records.filter(record => record.status === 'STALE').map(record => record.evidenceId))
  const invalidated = invalidateEvidence(records, current)
  records = invalidated.records
  const newlyStale = records.filter(record => record.status === 'STALE' && !before.has(record.evidenceId)).map(record => ({ criterion: record.criterion, changed: record.staleBecause ?? [] }))
  const claims = records.filter(record => record.status === 'CURRENT' && /exit=0$/.test(record.source)).map(record => ({ criterion: record.criterion, state: 'PROVEN' as const, evidenceId: record.evidenceId }))
  const ledger = reconcileLedger(state.ledger, claims, records)
  if (persist && (newlyStale.length || records.length !== state.evidence.length || JSON.stringify(ledger.ledger) !== JSON.stringify(state.ledger))) {
    state.evidence = records
    state.ledger = ledger.ledger
    save(missionId, state)
  }
  return { records, staleIds: invalidated.staleIds, newlyStale, ledgerNeedsReverify: ledger.needsReverify }
}

let evidenceRootOverride: string | null = null
export function setEvidenceRootForTests(root: string | null): void { evidenceRootOverride = root }
function repoRootForEvidence(): string { return evidenceRootOverride ?? resolveRepoRoot() }

/** The criterion's latest evidence is stale: the job that proved it must run again (only that one). */
export function staleCriteria(missionId: string): Set<string> {
  const view = evaluateEvidence(missionId)
  const latest = new Map<string, EvidenceRecord>()
  for (const record of view.records) latest.set(record.criterion, record)
  return new Set([...latest.values()].filter(record => record.status === 'STALE').map(record => record.criterion))
}

/* --------------------------------- model turns (GPU / MODEL claims) --------------------------------- */

export type ModelTurn = { release: () => Promise<void>; queuedMs: number }

/**
 * One model turn. Local generation takes GPU + MODEL:<provider/model> as a FIFO claim lease (the arbiter), then PROVIDER_SLOT
 * (the physical single-flight record) - never the other way round, so the two cannot disagree. Remote providers keep only the slot.
 * Waiting is event-driven and unbounded (it ends on release, holder death, or cancellation) and never marks the mission BLOCKED.
 */
export async function acquireModelTurn(input: {
  missionId: string
  local: boolean
  model: string
  operation: string
  isCancelled?: () => boolean
  onQueued?: (holders: string[]) => void
}): Promise<ModelTurn | { refused: string }> {
  const { acquireResource } = await import('./foundryResourceLocks')
  let lease: Awaited<ReturnType<typeof acquireLease>> = null
  if (input.local) {
    lease = await acquireLease({
      root: executiveRoot(), missionId: input.missionId, purpose: input.operation, claims: ['GPU', `MODEL:ollama/${input.model}`],
      externalHeld: () => reconcileJobs(executiveRoot()).filter(item => item.reconciliation === 'STILL_RUNNING').map(item => ({ holderId: `job:${item.job.jobId}`, claims: item.job.claims })),
      isCancelled: input.isCancelled,
      onQueued: ahead => input.onQueued?.(ahead.map(item => item.missionId)),
    })
    if (!lease) return { refused: 'cancelled while queued for the local model' }
  }
  const slot = await acquireResource({ resource: 'PROVIDER_SLOT', missionId: input.missionId, operation: input.operation, exclusive: true, waitMs: 180_000 })
  if (slot.state !== 'ACQUIRED') {
    lease?.release()
    return { refused: `PROVIDER_SLOT busy${slot.state === 'DEADLOCK_REFUSED' ? `: ${slot.error}` : ''}` }
  }
  return { queuedMs: lease?.waitedMs ?? 0, release: async () => { await slot.release(); lease?.release() } }
}

/* --------------------------------- build missions (authoring task graph) --------------------------------- */

/** One child may use at most this share of the Commander-approved ceilings, so a single runaway attempt cannot spend the whole mission's allowance. */
const CHILD_SHARE_OF_APPROVED_CEILING = 0.5
/** Per-turn token allowance a local authoring turn needs (prompt + system, and the file it writes); the governor's defaults assume ~40 short turns. */
const CHILD_INPUT_TOKENS_PER_CALL = 8_000
const CHILD_OUTPUT_TOKENS_PER_CALL = 3_000

/**
 * A child mission's own governor budget defaults to 40 calls / ~100k input tokens (about 18 authoring turns), far below what the Commander approved
 * for the mission. Give the child a budget derived from the approved ceilings (its share of what is still unspent), never above them. The
 * mission-level ceiling still aggregates every child, and nothing here extends a budget the Commander set.
 */
export function applyApprovedEnvelopeToChild(missionId: string, childId: string): void {
  const ceilings = loadExecutiveState(missionId).ceilings
  const usage = ceilingUsage(missionId)
  if (!ceilings || !usage) return
  const limits = childEnvelopeLimits(ceilings, usage, CHILD_SHARE_OF_APPROVED_CEILING, CHILD_INPUT_TOKENS_PER_CALL, CHILD_OUTPUT_TOKENS_PER_CALL)
  createResourceBudget({ missionId: childId, ensure: true, limits })
}



export function filesDeclaredBy(text: string): string[] {
  return [...new Set(commanderDeclaredNewFiles(text))]
}

/** A build mission: the Commander's request defines authoring tasks (each names the file(s) to create) and verification jobs. */
export function isBuildMissionRequest(request: string): boolean {
  return /\btask\.run\b/i.test(request) || requestedAddTasks(request).some(task => filesDeclaredBy(task.description ?? '').length > 0)
}

const MAX_TASK_ATTEMPTS = 3

function authoredFiles(graph: { tasks: MissionTask[] }): string[] {
  return [...new Set(graph.tasks.flatMap(task => task.files ?? []))]
}

/** The child's own structured outcome (last JSON line the runner printed), never raw log noise. */
export function childFailureReason(job: BackgroundJob | undefined): string {
  const log = job ? jobLogTail(job, 4000) : ''
  const line = log.split('\n').reverse().find(item => item.startsWith('{"missionId"'))
  try {
    const parsed = JSON.parse(line ?? '') as { status?: string; blocker?: string | null; evidence?: string }
    return `${parsed.status ?? 'unfinished'}${parsed.blocker ? `: ${parsed.blocker}` : ''}${parsed.evidence ? ` - ${parsed.evidence}` : ''}`.replace(/\s+/g, ' ').slice(0, 220)
  } catch { return 'the child mission did not complete' }
}

/** Retry notes become part of a child's request, so they must not contain words that change what kind of mission it is. */
export function sanitizeRetryNote(note: string): string {
  return note.replace(/\b(package\w*|install\w*|production|activat\w*|deploy\w*|war room|header)\b/gi, '...')
}

/** Start the child mission for one READY authoring task as a durable, claim-scoped background job. */
export async function executiveRunTask(input: { missionId: string; taskId: string }): Promise<{ ok: boolean; error?: string; result?: unknown }> {
  const state = loadExecutiveState(input.missionId)
  const breach = ceilingUsage(input.missionId)?.breach
  if (breach) return { ok: false, error: `Mission safety ceiling reached (${breach}); the Commander must extend it.` }
  const task = state.graph.tasks.find(item => item.taskId === input.taskId)
  if (!task) return { ok: false, error: `Unknown task ${input.taskId}.` }
  if (!task.files?.length || !task.spec) return { ok: false, error: `Task ${input.taskId} is not an authoring task (no file named in its description).` }
  if (task.state === 'RUNNING' && task.owner) return { ok: true, result: { taskId: task.taskId, note: 'ALREADY RUNNING. Do not call task.run again for this task; continue with the next step.', owner: task.owner } }
  if (task.state !== 'READY') return { ok: false, error: `Task ${input.taskId} is ${task.state}; it can only run when READY (dependencies complete).` }
  const root = resolveRepoRoot()
  const { startMission, cancelMission } = await import('./foundryMissionController')
  // A failed attempt's child must not keep its write claims: release them before the next attempt starts.
  const { releaseMissionResources } = await import('./foundryResourceLocks')
  for (const prior of task.priorChildren ?? []) {
    await cancelMission(prior).catch(() => undefined)
    await releaseMissionResources(prior).catch(() => undefined)
  }
  if (task.priorChildren?.length) { task.priorChildren = []; save(input.missionId, state) }
  let childId = task.childMissionId
  if (!childId) {
    const retryNote = task.retryState.lastSignature ? sanitizeRetryNote(` A previous attempt failed (${task.retryState.lastSignature.slice(0, 200)}); avoid that.`) : ''
    const child = await startMission(`${task.spec}${retryNote}`, task.taskId, { parentMissionId: input.missionId })
    childId = child.missionId
    applyApprovedEnvelopeToChild(input.missionId, childId)
  }
  const started = startBackgroundJob({
    root: executiveRoot(), missionId: input.missionId, taskId: task.taskId, kind: 'task', command: 'node',
    args: ['--loader', './scripts/ts-extension-loader.mjs', '--experimental-transform-types', 'scripts/foundry-run-child-mission.ts', childId], cwd: resolveBaseRepoRoot(), // the runner script lives in the War Room root; the child mission re-binds its own workspace from its record, and the write claims below stay on the workspace
   
    claims: task.files.map(file => `PROJECT_WRITE:${root}/${file}`), pressure: pressure(), queueIfBlocked: true,
    evidenceFiles: task.files, childMissionId: childId,
  })
  if (started.status === 'CLAIM_CONFLICT') return { ok: false, error: `WAITING: ${started.conflicts[0].reason}` }
  const fresh = loadExecutiveState(input.missionId)
  const live = fresh.graph.tasks.find(item => item.taskId === input.taskId)!
  live.state = 'RUNNING'; live.startDigest = firstStartDigest(live, digestOwnedFiles(task.files)); live.owner = `job:${started.job.jobId}`; live.childMissionId = childId; live.resourceClaims = started.job.claims; live.updatedAt = new Date().toISOString()
  save(input.missionId, fresh)
  logTimeline(input.missionId, 'task', `Started task ${task.taskId} (${task.files.join(', ')})${started.job.state === 'QUEUED' ? ' - queued' : ''}`)
  return { ok: true, result: { taskId: task.taskId, jobId: started.job.jobId, childMissionId: childId, state: started.job.state, note: 'Authoring runs in the background as its own mission. Start the next READY task, or job.wait.' } }
}

type Diagnostic = { file: string; line: number; message: string }

export function parseDiagnostics(log: string): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const match of log.matchAll(/^(\S+?\.(?:ts|tsx|mjs|js))\((\d+),\d+\):\s*error\s+(TS\d+:[^\n]*)/gm)) out.push({ file: match[1], line: Number(match[2]), message: match[3].trim() })
  let current = ''
  for (const line of log.split('\n')) {
    const file = /^(\/\S+\.(?:ts|tsx|mjs|js))\s*$/.exec(line.trim())?.[1]
    if (file) { current = file.replace(`${resolveRepoRoot()}/`, ''); continue }
    const lint = /^\s*(\d+):\d+\s+error\s+(.+?)\s{2,}\S+\s*$/.exec(line)
    if (lint && current) out.push({ file: current, line: Number(lint[1]), message: lint[2] })
  }
  return out
}

/**
 * React to job outcomes the tick just folded in: failed authoring tasks get a bounded retry with a fresh child; failed verification jobs
 * produce one fix task per affected authored file (never for files the mission did not author). Idempotent.
 */
export function reactToJobOutcomes(missionId: string): string[] {
  const events: string[] = []
  const state = loadMissionState(executiveRoot(), missionId)
  if (!state) return events
  const jobs = listJobs(executiveRoot(), { missionId })
  let changed = false
  // A task is not done because its child said so: its declared files must exist. Reopen it, and everything built on top of it.
  const root = resolveRepoRoot()
  for (const task of state.graph.tasks) {
    if (task.state !== 'COMPLETED' || !task.files?.length) continue
    const missing = task.files.filter(file => !existsSyncCeil(path.join(root, file)))
    if (!missing.length) continue
    const reopen = new Set<string>([task.taskId])
    for (let grew = true; grew;) { grew = false; for (const other of state.graph.tasks) if (!reopen.has(other.taskId) && other.dependencies.some(id => reopen.has(id)) && other.state !== 'CANCELLED') { reopen.add(other.taskId); grew = true } }
    for (const other of state.graph.tasks) {
      if (!reopen.has(other.taskId)) continue
      if (other.childMissionId) other.priorChildren = [...(other.priorChildren ?? []), other.childMissionId]
      other.childMissionId = undefined; other.owner = undefined; other.retryState = { attempts: other.taskId === task.taskId ? 1 : 0, lastSignature: other.taskId === task.taskId ? `the child finished without producing ${missing.join(', ')}` : undefined }
      other.state = other.taskId === task.taskId ? 'READY' : 'WAITING'
      other.blockers = other.taskId === task.taskId ? [] : other.dependencies.filter(id => reopen.has(id)).map(id => ({ kind: 'DEPENDENCY' as const, ref: id, detail: id }))
      other.updatedAt = new Date().toISOString()
    }
    events.push(`${task.taskId} was reported done but ${missing.join(', ')} does not exist; reopened it${reopen.size > 1 ? ` and ${reopen.size - 1} task(s) that depend on it` : ''}`)
    changed = true
  }
  // Narrow repair proved it cannot repair a file in place: one bounded, reversible regeneration (quarantine copy kept) before the task is finally FAILED.
  {
    const quarantineRoot = path.join(executiveRoot(), 'quarantine', missionId, new Date().toISOString().replace(/[:.]/g, '-'))
    const outcome = regenerateStagnantTasks(state.graph, {
      quarantine: file => {
        const from = path.join(root, file)
        if (!existsSyncCeil(from)) return null
        const to = path.join(quarantineRoot, file)
        mkdirSyncQ(path.dirname(to), { recursive: true })
        copyFileSyncQ(from, to)
        rmSyncQ(from)
        return to
      },
      clearLedger: clearNarrowRepairLedger,
      diagnosticCount: file => ownedFileDiagnose(file).length,
    })
    if (outcome.regenerated.length) {
      state.graph = outcome.graph
      for (const item of outcome.regenerated) events.push(`${item.taskId}: narrow repair could not repair its file in place; the file was quarantined (${item.quarantined.join('; ')}) and the task rewrites it from the real types (one regeneration allowed)`)
      changed = true
    }
  }
  for (const task of state.graph.tasks) {
    if (task.state === 'FAILED' && task.files?.length && task.retryState.attempts < MAX_TASK_ATTEMPTS - 1) {
      const job = [...jobs].reverse().find(item => jobTaskFor(item, missionId) === task.taskId)
      const reason = childFailureReason(job)
      const waits = (task.retryState.waits ?? 0) + 1
      if (isTransientChildWait(reason) && waits <= MAX_TRANSIENT_WAITS) {
        // Queued behind a shared resource or the provider: not a failed attempt. Keep the same child so its progress is resumed, not discarded.
        task.retryState = { ...task.retryState, lastSignature: reason, waits }
        task.state = 'READY'; task.owner = undefined; task.updatedAt = new Date().toISOString()
        events.push(`${task.taskId} was waiting (${reason.slice(0, 90)}); it resumes the same child without using an attempt (wait ${waits} of ${MAX_TRANSIENT_WAITS})`)
        changed = true
        continue
      }
      task.retryState = { attempts: task.retryState.attempts + 1, lastSignature: reason }
      if (task.childMissionId) task.priorChildren = [...(task.priorChildren ?? []), task.childMissionId]
      task.state = 'READY'; task.owner = undefined; task.childMissionId = undefined; task.updatedAt = new Date().toISOString()
      events.push(`${task.taskId} did not finish; retrying with a fresh attempt (${task.retryState.attempts + 1} of ${MAX_TASK_ATTEMPTS})`)
      changed = true
    }
  }
  const authored = authoredFiles(state.graph)
  for (const job of jobs) {
    if (job.kind === 'task' || job.state !== 'FAILED' || (job.exitStatus ?? 0) >= 128) continue
    const taskId = jobTaskFor(job, missionId)
    if (state.graph.tasks.some(task => task.fixFor === taskId && task.fixForAttempt === jobs.filter(item => jobTaskFor(item, missionId) === taskId).indexOf(job))) continue
    const attempt = jobs.filter(item => jobTaskFor(item, missionId) === taskId).indexOf(job)
    const byFile = new Map<string, Diagnostic[]>()
    for (const diagnostic of parseDiagnostics(jobLogTail(job, 60_000))) if (authored.includes(diagnostic.file)) byFile.set(diagnostic.file, [...(byFile.get(diagnostic.file) ?? []), diagnostic])
    if (!byFile.size && job.kind === 'test') {
      // A failing suite names its culprit in the stack: repair the first authored implementation file in it (the validator only if nothing else is implicated).
      const log = jobLogTail(job, 60_000)
      const frames = [...log.matchAll(/([\w./@-]*?((?:lib|app|components)\/[\w./@-]+\.tsx?)):(\d+):\d+/g)].map(match => match[2]).filter(file => authored.includes(file))
      const target = frames.find(file => !/\.validation\./.test(file)) ?? frames[0]
      const message = (/(?:AssertionError|Error)[^\n]*(?:\n[^\n]*){0,6}/.exec(log)?.[0] ?? log.slice(-500)).replace(/\s+/g, ' ').slice(0, 420)
      if (target) byFile.set(target, [{ file: target, line: 0, message }])
    }
    for (const [file, diagnostics] of byFile) {
      const slug = file.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(-40)
      const fixId = `fix-${slug}-a${attempt}`
      if (state.graph.tasks.some(task => task.taskId === fixId)) continue
      const list = diagnostics.slice(0, 8).map(item => `line ${item.line}: ${item.message}`).join(' | ')
      state.graph.tasks.push(newTask({
        taskId: fixId, missionId, description: `Rewrite file ${file}. The ${job.kind} check reports: ${list}. Fix exactly these problems and keep everything else.`,
        completionCondition: `${job.kind} reports no problems in ${file}`, spec: `Rewrite file ${file}. The ${job.kind} check reports: ${list}. Fix exactly these problems and keep everything else.`, files: [file], fixFor: taskId, fixForAttempt: attempt,
      }))
      events.push(`${job.kind} found ${diagnostics.length} problem(s) in ${file}; created ${fixId} to repair it`)
      changed = true
    }
  }
  if (changed) { state.graph = promoteReady(state.graph); save(missionId, state) }
  return events
}

export type BuildProgress = {
  phase: 'DEFINE' | 'RUN_TASKS' | 'START_JOB' | 'WAIT' | 'STUCK' | 'DONE'
  detail: string
  nextCall: string | null
  running: BackgroundJob[]
}

/** The build mission's single source of "what happens next", derived only from persisted executive state. */
export function buildMissionProgress(missionId: string, request: string): BuildProgress {
  const decision = (reasoningSummary: string, name: string, args: Record<string, unknown>) => JSON.stringify({ decision: 'TOOL', reasoningSummary, tool: { name, args } })
  const state = loadExecutiveState(missionId)
  const usage = ceilingUsage(missionId)
  if (usage?.breach) return { phase: 'STUCK', running: [], nextCall: null, detail: `Mission safety ceiling reached (${usage.breach}). Commander decision required to extend it; nothing further will start.` }
  const jobsAll = listJobs(executiveRoot(), { missionId }).map(job => (job.state === 'RUNNING' ? inspectJob(executiveRoot(), job).job : job))
  const running = jobsAll.filter(job => job.state === 'RUNNING' || job.state === 'QUEUED')
  const tasks = state.graph.tasks
  const undefinedSteps = requestedAddTasks(request).filter(step => !tasks.some(task => task.taskId === step.taskId))
  if (undefinedSteps.length) {
    const step = undefinedSteps[0]
    return { phase: 'DEFINE', running, detail: `Define the Commander's next task: mission.graph ${JSON.stringify(step)}. ${undefinedSteps.length - 1} more to define after it.`, nextCall: decision(`define task ${step.taskId}`, 'mission.graph', step) }
  }
  const idle = (task: MissionTask) => task.state === 'READY' && !!task.files?.length && !!task.spec
  const readyTasks = tasks.filter(idle)
  if (readyTasks.length) {
    const graph = { missionId, goal: '', tasks, updatedAt: '' }
    const pick = selectNextActions({ graph, heldByJobs: liveClaimHolders(executiveRoot()), failures: state.failures, pressure: pressure(), maxStart: 1 }).start[0] ?? readyTasks[0]
    return { phase: 'RUN_TASKS', running, detail: `${readyTasks.length} authoring task(s) ready: ${readyTasks.map(task => task.taskId).join(', ')}. Your ONLY next step: task.run for ${pick.taskId}. Independent tasks run in parallel as background missions.`, nextCall: decision(`run task ${pick.taskId}`, 'task.run', { taskId: pick.taskId }) }
  }
  const stale = jobsAll.length ? staleCriteria(missionId) : new Set<string>()
  const allTasksDone = tasks.filter(task => task.files?.length).every(task => task.state === 'COMPLETED')
  const lost = (job: BackgroundJob) => job.state === 'ORPHANED' || (job.state === 'FAILED' && (job.exitStatus ?? 0) >= 128)
  const pending: RequestedJob[] = []
  let verificationStuck: string | null = null
  for (const wanted of requestedJobs(request)) {
    const attempts = jobsAll.filter(item => jobTaskFor(item, missionId) === wanted.taskId)
    if (wanted.afterAllTasks && !(allTasksDone && tasks.length)) continue
    if (attempts.some(item => item.state === 'RUNNING' || item.state === 'QUEUED')) continue
    const last = attempts[attempts.length - 1]
    if (!last) { pending.push(wanted); continue }
    if (stale.has(wanted.taskId) && attempts.length < 6) { pending.push(wanted); continue }
    if (lost(last) && attempts.length < 4) { pending.push(wanted); continue }
    if (last.state === 'FAILED' && !lost(last)) {
      const index = attempts.indexOf(last)
      const fixes = tasks.filter(task => task.fixFor === wanted.taskId && task.fixForAttempt === jobsAll.filter(item => jobTaskFor(item, missionId) === wanted.taskId).indexOf(last))
      if (fixes.length && fixes.every(task => task.state === 'COMPLETED') && attempts.length < 6) { pending.push(wanted); continue }
      if (!fixes.length || fixes.some(task => task.state === 'FAILED' && task.retryState.attempts >= MAX_TASK_ATTEMPTS - 1)) verificationStuck = `${wanted.taskId} failed (exit ${last.exitStatus}) and the problems are not in files this mission authored, or repairs ran out of attempts (attempt ${index + 1}).`
    }
  }
  if (pending.length) {
    const next = pending[0]
    const args = { kind: next.kind, taskId: next.taskId, ...(next.suite ? { suite: next.suite } : {}), ...(next.targets ? { targets: next.targets } : {}) }
    return { phase: 'START_JOB', running, detail: `Your ONLY next step: job.start ${JSON.stringify(args)}.`, nextCall: decision(`start ${next.taskId}`, 'job.start', args) }
  }
  if (running.length) {
    const first = running[0]
    return { phase: 'WAIT', running, detail: `${running.map(job => `${job.kind === 'task' ? `authoring ${jobTaskFor(job, missionId)}` : job.kind}${job.state === 'QUEUED' ? ' (queued)' : ''}`).join(', ')} running. Nothing else is ready: wait for it.`, nextCall: decision('wait for background work', 'job.wait', { jobId: first.jobId }) }
  }
  if (verificationStuck) return { phase: 'STUCK', running, detail: verificationStuck, nextCall: null }
  const openTasks = tasks.filter(task => !['COMPLETED', 'CANCELLED'].includes(task.state))
  if (openTasks.length) return { phase: 'STUCK', running, detail: `Tasks cannot proceed: ${openTasks.map(task => `${task.taskId} [${task.state}]`).join(', ')}.`, nextCall: null }
  evaluateEvidence(missionId, true)
  return { phase: 'DONE', running, detail: `All ${tasks.length} task(s) completed and every verification job passed with current evidence. Return COMPLETE with the summary.`, nextCall: null }
}


/* --------------------------------- Commander-approved safety ceilings --------------------------------- */

import { existsSync as existsSyncCeil, readFileSync as readFileSyncCeil, readdirSync as readdirSyncCeil, statSync as statSyncCeil } from 'node:fs'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import type { MissionCeilings } from './foundryMissionExecutive'
import { createResourceBudget } from './foundryResourceGovernor'
import { completionRefusal, firstStartDigest, gateCompletion, type Diagnose } from './foundryCompletionGate'
import { clearNarrowRepairLedger, diagnoseAll } from './foundryNarrowRepair'
import { regenerateStagnantTasks } from './foundryRegeneration'
import { copyFileSync as copyFileSyncQ, mkdirSync as mkdirSyncQ, rmSync as rmSyncQ } from 'node:fs'

/** Ceilings are safety limits the Commander approved for one objective, not targets. Usage = the parent mission plus every child mission it started. */
export function setMissionCeilings(missionId: string, ceilings: Omit<MissionCeilings, 'startedAt'> & { startedAt?: string }): void {
  const state = loadExecutiveState(missionId)
  state.ceilings = { ...ceilings, startedAt: state.ceilings?.startedAt ?? ceilings.startedAt ?? new Date().toISOString(), priorWindows: state.ceilings?.priorWindows ?? ceilings.priorWindows, activeMs: state.ceilings?.activeMs ?? ceilings.activeMs, activeAt: state.ceilings?.activeAt ?? ceilings.activeAt }
  save(missionId, state)
}

/**
 * Commander-approved restart of the wall-clock window (the limit counts active execution, not time spent BLOCKED waiting for a decision).
 * Limits and consumed model/tool usage are untouched; the previous window is kept in the ceilings record and in the timeline.
 */
export function restartWallClockWindow(missionId: string, reason: string): { previousStartedAt: string; resetAt: string } {
  const state = loadExecutiveState(missionId)
  const prior = state.ceilings
  if (!prior) throw new Error('mission has no ceilings to restart')
  const usage = ceilingUsage(missionId)
  const resetAt = new Date().toISOString()
  state.ceilings = { ...prior, startedAt: resetAt, activeMs: 0, activeAt: resetAt, priorWindows: [...(prior.priorWindows ?? []), { startedAt: prior.startedAt, resetAt, reason, modelCalls: usage?.modelCalls ?? 0, toolCalls: usage?.toolCalls ?? 0 }] }
  save(missionId, state)
  logTimeline(missionId, 'WALL_CLOCK_RESET', `${reason}. previous startedAt ${prior.startedAt}, reset ${resetAt}; usage retained: ${usage?.modelCalls ?? 0} model / ${usage?.toolCalls ?? 0} tool calls; limits unchanged (${prior.maxModelCalls}/${prior.maxToolCalls}/${Math.round(prior.maxWallMs / 3_600_000)}h)`)
  return { previousStartedAt: prior.startedAt, resetAt }
}

/**
 * Where a persisted mission record may live: the mission store's primary data directory first, the repository mirror second.
 * The mirror alone is wrong in the installed runtime (its working directory is inside the install tree and has no mirror), which made every lookup miss.
 */
export function missionRecordPaths(missionId: string): string[] {
  return [path.join(foundryDataHierarchy().missions, `${missionId}.json`), path.join(resolveBaseRepoRoot(), '.war-room', 'foundry-missions', `${missionId}.json`)]
}

function readMissionRecord<T>(missionId: string): T | null {
  for (const file of missionRecordPaths(missionId)) {
    try { return JSON.parse(readFileSyncCeil(file, 'utf8')) as T } catch { /* try the next location */ }
  }
  return null
}

function missionCounts(id: string): { calls: number; tools: number } {
  const record = readMissionRecord<{ modelState?: { calls?: number }; toolCalls?: unknown[] }>(id)
  return record ? { calls: record.modelState?.calls ?? 0, tools: record.toolCalls?.length ?? 0 } : { calls: 0, tools: 0 }
}

export function ceilingUsage(missionId: string): { modelCalls: number; toolCalls: number; wallMs: number; breach: string | null } | null {
  const state = loadMissionState(executiveRoot(), missionId)
  const ceilings = state?.ceilings
  if (!state || !ceilings) return null
  const ids = new Set([missionId, ...state.graph.tasks.map(task => task.childMissionId).filter((id): id is string => Boolean(id)), ...listJobs(executiveRoot(), { missionId }).map(job => job.childMissionId).filter((id): id is string => Boolean(id))])
  let modelCalls = 0, toolCalls = 0
  for (const id of ids) { const counts = missionCounts(id); modelCalls += counts.calls; toolCalls += counts.tools }
  const wallMs = activeElapsedMs(ceilings, Date.now())
  const breach = modelCalls >= ceilings.maxModelCalls ? `model calls ${modelCalls}/${ceilings.maxModelCalls}`
    : toolCalls >= ceilings.maxToolCalls ? `tool calls ${toolCalls}/${ceilings.maxToolCalls}`
    : wallMs >= ceilings.maxWallMs ? `wall clock ${Math.round(wallMs / 3_600_000)}h/${Math.round(ceilings.maxWallMs / 3_600_000)}h` : null
  return { modelCalls, toolCalls, wallMs, breach }
}

/* --------------------------------- durable timeline + process generations --------------------------------- */

export function logTimeline(missionId: string, kind: string, text: string): void {
  const state = loadExecutiveState(missionId)
  const timeline = state.timeline ?? []
  const last = timeline[timeline.length - 1]
  if (last && last.kind === kind && last.text === text) return
  timeline.push({ at: new Date().toISOString(), kind, text })
  state.timeline = timeline.slice(-500)
  save(missionId, state)
}

/** Record this process as a generation of the mission; a second distinct generation means the mission survived a restart. */
export function recordGeneration(missionId: string): { generation: number; reopened: boolean } {
  const identity = readProcessIdentity(process.pid)
  const state = loadExecutiveState(missionId)
  const generations = state.generations ?? []
  if (!identity) return { generation: generations.length, reopened: false }
  if (generations.some(item => item.pid === identity.pid && item.startTicks === identity.startTicks)) return { generation: generations.length, reopened: false }
  generations.push({ pid: identity.pid, startTicks: identity.startTicks, firstSeenAt: new Date().toISOString() })
  state.generations = generations
  save(missionId, state)
  return { generation: generations.length, reopened: generations.length > 1 }
}

export type MissionControlSource = {
  now: number
  mission: { missionId: string; title: string; objective: string; status: string; createdAt: string; updatedAt: string; sessionId: string | null; blocker: string | null; modelCalls: number; toolCalls: number; completedAt: string | null; verifiedStandaloneCompletion?: boolean }
  state: MissionStateFiles | null
  jobs: BackgroundJob[]
  leases: ReturnType<typeof listLeases>
  usage: ReturnType<typeof ceilingUsage>
  agentEvents: { at: string; type: string; text: string }[]
}

/** When a mission reached COMPLETE: the persisted journal entry for the transition into COMPLETE (the last one, if it was reopened), else null. */
export function completedAtOf(record: { status?: string; journal?: { at?: string; kind?: string; text?: string }[] }): string | null {
  if (record.status !== 'COMPLETE') return null
  const entry = [...(record.journal ?? [])].reverse().find(item => item.kind === 'transition' && /(?:→|->)\s*COMPLETE\b/.test(String(item.text ?? '')) && Number.isFinite(Date.parse(String(item.at ?? ''))))
  return entry?.at ?? null
}

/** The single read path for Mission Control. It only reads authoritative executive state; it never keeps or derives a parallel mission state. */
export function readMissionControlSource(missionId: string): MissionControlSource | null {
  /** The fields of the persisted mission record that Mission Control reads (read-only; the record itself is owned by the mission store). */
  type PersistedMission = { title?: string; userRequest?: string; status?: string; createdAt?: string; updatedAt?: string; sessionId?: string | null; blocker?: { blocker?: string; evidence?: string } | null; modelState?: { calls?: number }; toolCalls?: { tool?: string; ok?: boolean }[]; completionGate?: { complete?: boolean; missing?: unknown[] }; agentEvents?: unknown[]; journal?: { at?: string; kind?: string; text?: string }[] }
  const record = readMissionRecord<PersistedMission>(missionId)
  if (!record) return null
  const root = executiveRoot()
  const jobs = listJobs(root, { missionId }).map(job => (job.state === 'RUNNING' ? inspectJob(root, job).job : job))
  const state = loadMissionState(root, missionId)
  const completedAt = completedAtOf(record)
  // COMPLETE is a controller-owned, gate-checked durable transition, not a model sentence.
  // Generation-only executive state has an empty graph even for standalone coding missions.
  // Require positive durable gate evidence and exclude every known executive/graph path;
  // missing or corrupt graph data must not manufacture standalone completion.
  const graphReadable = !existsSync(path.join(root, 'missions', `${missionId}.executive.json`)) || state !== null
  const request = String(record.userRequest ?? '')
  const graphBacked = !graphReadable || !request.trim()
    || isBackgroundOrchestrationRequest(request) || isBuildMissionRequest(request)
    || EXPLICIT_EXECUTIVE_TOOL.test(request)
    || (record.toolCalls ?? []).some(call => /^(?:mission\.graph|task\.run|job\.)/.test(call.tool ?? ''))
    || jobs.length > 0
    || Boolean(state && (!Array.isArray(state.graph?.tasks) || state.graph.tasks.length > 0 || state.graph.goal?.trim()))
  const verifiedStandaloneCompletion = record.status === 'COMPLETE' && completedAt !== null
    && record.completionGate?.complete === true && Array.isArray(record.completionGate.missing)
    && record.completionGate.missing.length === 0 && !graphBacked
  return {
    now: Date.now(),
    mission: {
      missionId, title: String(record.title ?? ''), objective: String(record.userRequest ?? ''), status: String(record.status ?? ''), createdAt: String(record.createdAt ?? ''), updatedAt: String(record.updatedAt ?? ''),
      sessionId: record.sessionId ?? null, blocker: record.blocker ? `${record.blocker.blocker}: ${record.blocker.evidence}` : null, modelCalls: record.modelState?.calls ?? 0, toolCalls: record.toolCalls?.length ?? 0, completedAt, verifiedStandaloneCompletion,
    },
    state,
    jobs,
    leases: listLeases(root),
    usage: ceilingUsage(missionId),
    agentEvents: ((record.agentEvents ?? []) as { at: string; type: string; text: string }[]).slice(-60).map(event => ({ at: event.at, type: event.type, text: event.text })),
  }
}

/** Durable standalone and executive missions (newest first), for the Mission Control picker. */
export function listExecutiveMissionIds(): { missionId: string; mtimeMs: number }[] {
  const entries = new Map<string, { missionId: string; mtimeMs: number }>()
  const locations = [
    { dir: foundryDataHierarchy().missions, suffix: '.json' },
    { dir: path.join(resolveBaseRepoRoot(), '.war-room', 'foundry-missions'), suffix: '.json' },
    { dir: path.join(executiveRoot(), 'missions'), suffix: '.executive.json' },
  ]
  for (const { dir, suffix } of locations) {
    try {
      for (const name of readdirSyncCeil(dir)) {
        if (!name.endsWith(suffix)) continue
        const missionId = name.slice(0, -suffix.length)
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(missionId) || entries.has(missionId)) continue
        // Listing must use the same primary-first reader as the detail view.
        if (!readMissionRecord(missionId)) continue
        try { entries.set(missionId, { missionId, mtimeMs: statSyncCeil(path.join(dir, name)).mtimeMs }) } catch { /* a disappearing record does not hide its peers */ }
      }
    } catch { /* missing executive state must not hide standalone missions */ }
  }
  return [...entries.values()].sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/**
 * After a generic Foundry mechanism was repaired, tasks that failed because of that defect (not because of their own work) get a fresh
 * retry budget on the SAME mission. The reason is recorded in the durable timeline, so the history stays honest.
 */
export function resetTasksAfterCapabilityRepair(missionId: string, taskIds: string[], reason: string): string[] {
  const state = loadExecutiveState(missionId)
  const reset: string[] = []
  for (const task of state.graph.tasks) {
    if (!taskIds.includes(task.taskId) || !['FAILED', 'READY', 'RUNNING'].includes(task.state)) continue
    task.state = 'READY'; task.owner = undefined; task.childMissionId = undefined
    task.retryState = { attempts: 0 }; task.updatedAt = new Date().toISOString()
    reset.push(task.taskId)
  }
  state.graph = promoteReady(state.graph)
  save(missionId, state)
  if (reset.length) logTimeline(missionId, 'replan', `Foundry repaired a generic mechanism (${reason}); ${reset.join(', ')} get a fresh attempt`)
  return reset
}
