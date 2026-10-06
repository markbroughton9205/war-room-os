import { randomUUID } from 'node:crypto'
import { redactText } from '@/lib/recursive-learning/ingestion/redact'
import type { AgentOpsLog } from './log'
import { isCommander } from './lifecycle'
import { deriveAgents, AgentRegistry } from './registry'
import { PROTECTED_EFFECTS, WORKER_CATEGORIES, type Actor, type ProtectedEffect, type RunRecord, type RunStatus, type WorkerSpec } from './types'

/** Hard ceilings a Commander-registered worker spec can never exceed. */
export const HARD_LIMITS = { maxRuntimeMs: 10 * 60_000, maxRunsPerDay: 1000, maxConsecutiveFailures: 10 } as const

export class WorkerError extends Error {
  constructor(public readonly code: 'NOT_AUTHORIZED' | 'INVALID' | 'AGENT_NOT_ELIGIBLE' | 'LIMIT_EXCEEDED', msg: string) { super(msg) }
}
export class EffectBlockedError extends Error { constructor(public readonly effect: ProtectedEffect, why = 'protected effect blocked') { super(`${why}: ${effect}`) } }

export type WorkerDraft = Omit<WorkerSpec, 'createdAt' | 'preApprovedEffects'> & { preApprovedEffects?: ProtectedEffect[] }

export function registerWorker(log: AgentOpsLog, draft: WorkerDraft, by: Actor, now: Date = new Date()): WorkerSpec {
  if (!isCommander(by)) throw new WorkerError('NOT_AUTHORIZED', 'registering a worker requires a Commander')
  if (!WORKER_CATEGORIES.includes(draft.category)) throw new WorkerError('INVALID', `unknown worker category: ${draft.category}`)
  if (!draft.id.trim() || !draft.version.trim() || !draft.mission.trim()) throw new WorkerError('INVALID', 'id, version and mission required')
  const agent = deriveAgents(log).agents.get(draft.agentId)
  if (!agent || (agent.state !== 'APPROVED' && agent.state !== 'ACTIVE' && agent.state !== 'PAUSED')) throw new WorkerError('AGENT_NOT_ELIGIBLE', `agent ${draft.agentId} is ${agent?.state ?? 'unknown'}`)
  if (draft.permissionScope.some((p) => !agent.spec.permissionScope.includes(p)) || draft.memoryScope.some((m) => !agent.spec.memoryScope.includes(m))) throw new WorkerError('INVALID', 'worker scope must be within the agent scope')
  const l = draft.limits
  const ints = [l.maxRuntimeMs, l.maxRunsPerDay, l.maxConsecutiveFailures]
  if (ints.some((n) => !Number.isInteger(n) || n < 1)) throw new WorkerError('INVALID', 'limits must be positive integers')
  if (l.maxRuntimeMs > HARD_LIMITS.maxRuntimeMs || l.maxRunsPerDay > HARD_LIMITS.maxRunsPerDay || l.maxConsecutiveFailures > HARD_LIMITS.maxConsecutiveFailures) throw new WorkerError('LIMIT_EXCEEDED', 'limits exceed the hard ceilings')
  if (l.cadenceMinutes !== null && (!Number.isInteger(l.cadenceMinutes) || l.cadenceMinutes < 1)) throw new WorkerError('INVALID', 'cadence must be a positive integer or null')
  if ((draft.preApprovedEffects ?? []).some((e) => !PROTECTED_EFFECTS.includes(e))) throw new WorkerError('INVALID', 'unknown protected effect in preApprovedEffects')
  if (draft.id.length > 80 || draft.version.length > 40 || draft.mission.length > 300) throw new WorkerError('INVALID', 'id/version/mission too long')
  if (deriveWorkers(log).workers.has(draft.id)) throw new WorkerError('INVALID', `worker already exists: ${draft.id}`)
  const spec: WorkerSpec = { ...draft, preApprovedEffects: draft.preApprovedEffects ?? [], createdAt: now.toISOString() }
  log.append({ t: 'worker', worker: spec, approvedBy: by })
  return spec
}

export function approveEffect(log: AgentOpsLog, workerId: string, effects: ProtectedEffect[], by: Actor, reason: string, now: Date = new Date()) {
  if (!isCommander(by)) throw new WorkerError('NOT_AUTHORIZED', 'effect approval requires a Commander')
  if (!effects.length || effects.some((e) => !PROTECTED_EFFECTS.includes(e))) throw new WorkerError('INVALID', 'unknown protected effect')
  if (!reason.trim()) throw new WorkerError('INVALID', 'reason required')
  if (!deriveWorkers(log).workers.has(workerId)) throw new WorkerError('INVALID', `unknown worker: ${workerId}`)
  return log.append({ t: 'effectApproval', workerId, effects, by, at: now.toISOString(), reason })
}

export function stopWorker(log: AgentOpsLog, workerId: string, by: Actor, reason: string, now: Date = new Date()) {
  if (!isCommander(by) && !/^system:/.test(by)) throw new WorkerError('NOT_AUTHORIZED', 'stop requires a Commander or system governor')
  if (!reason.trim()) throw new WorkerError('INVALID', 'reason required')
  if (!deriveWorkers(log).workers.has(workerId)) throw new WorkerError('INVALID', `unknown worker: ${workerId}`)
  return log.append({ t: 'stop', workerId, by, at: now.toISOString(), reason, resumed: false })
}
export function resumeWorker(log: AgentOpsLog, workerId: string, by: Actor, reason: string, now: Date = new Date()) {
  if (!isCommander(by)) throw new WorkerError('NOT_AUTHORIZED', 'only a Commander can resume a stopped worker')
  if (!reason.trim()) throw new WorkerError('INVALID', 'reason required')
  if (!deriveWorkers(log).workers.has(workerId)) throw new WorkerError('INVALID', `unknown worker: ${workerId}`)
  return log.append({ t: 'stop', workerId, by, at: now.toISOString(), reason, resumed: true })
}

export type WorkerView = { spec: WorkerSpec; stopped: boolean; stopReason?: string; consecutiveFailures: number; runs: RunRecord[]; running: RunRecord | null }

const TERMINAL: RunStatus[] = ['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'BLOCKED', 'STOPPED', 'INTERRUPTED']

/** Structural validity of a worker record at replay (a forged record cannot exceed hard limits, the agent's scope, or invent effects). */
function validWorkerRecord(w: WorkerSpec, agents: ReturnType<typeof deriveAgents>['agents']): boolean {
  const a = agents.get(w.agentId)
  const l = w.limits
  return !!a && WORKER_CATEGORIES.includes(w.category)
    && w.permissionScope.every((p) => a.spec.permissionScope.includes(p)) && w.memoryScope.every((m) => a.spec.memoryScope.includes(m))
    && [l.maxRuntimeMs, l.maxRunsPerDay, l.maxConsecutiveFailures].every((n) => Number.isInteger(n) && n >= 1)
    && l.maxRuntimeMs <= HARD_LIMITS.maxRuntimeMs && l.maxRunsPerDay <= HARD_LIMITS.maxRunsPerDay && l.maxConsecutiveFailures <= HARD_LIMITS.maxConsecutiveFailures
    && (w.preApprovedEffects ?? []).every((e) => PROTECTED_EFFECTS.includes(e))
}

export function deriveWorkers(log: AgentOpsLog): { workers: Map<string, WorkerView>; approvals: Extract<ReturnType<AgentOpsLog['view']>['records'][number], { t: 'effectApproval' }>[] } {
  const v = log.view()
  const agents = deriveAgents(log).agents
  const workers = new Map<string, WorkerView>()
  const approvals: ReturnType<typeof deriveWorkers>['approvals'] = []
  const runById = new Map<string, RunRecord>()
  const runIndex = new Map<string, number>()
  const order: string[] = []
  const resetAt = new Map<string, number>()
  v.records.forEach((r, i) => {
    if (r.t === 'worker' && isCommander(r.approvedBy) && !workers.has(r.worker.id) && validWorkerRecord(r.worker, agents)) workers.set(r.worker.id, { spec: r.worker, stopped: false, consecutiveFailures: 0, runs: [], running: null })
    else if (r.t === 'effectApproval' && isCommander(r.by) && r.effects.every((e) => PROTECTED_EFFECTS.includes(e))) approvals.push(r)
    else if (r.t === 'run') {
      const prev = runById.get(r.run.runId)
      if (!prev) { order.push(r.run.runId); runIndex.set(r.run.runId, i); runById.set(r.run.runId, r.run) }
      else if (!TERMINAL.includes(prev.status)) runById.set(r.run.runId, r.run) // a terminal record is final: late records never overwrite it
    } else if (r.t === 'stop') {
      const w = workers.get(r.workerId)
      if (!w) return
      if (r.resumed) { if (isCommander(r.by)) { w.stopped = false; w.stopReason = undefined; resetAt.set(r.workerId, i) } }
      else { w.stopped = true; w.stopReason = r.reason }
    }
  })
  for (const id of order) {
    const run = runById.get(id)!
    const w = workers.get(run.workerId)
    if (!w) continue
    w.runs.push(run)
    if (run.status === 'RUNNING') w.running = run
    if ((runIndex.get(id) ?? 0) < (resetAt.get(w.spec.id) ?? -1)) continue // failures before the last Commander resume no longer count
    if (run.status === 'FAILED' || run.status === 'TIMED_OUT') w.consecutiveFailures += 1
    else if (run.status === 'SUCCEEDED') w.consecutiveFailures = 0
  }
  return { workers, approvals }
}

export type RunnerResult = {
  outputs?: { kind: string; ref: string; summary: string }[]
  toolsUsed?: string[]
  executor?: { provider: string; model: string }
  resource?: { costUsd?: number; tokens?: number }
  escalations?: { to: string; reason: string }[]
}
export type RunContext = { runId: string; worker: WorkerSpec; signal: AbortSignal; shouldStop: () => boolean; requestEffect: (effect: ProtectedEffect) => void }
export type WorkerRunner = (ctx: RunContext) => Promise<RunnerResult>

export type ExecuteResult =
  | { ok: true; run: RunRecord }
  | { ok: false; reason: 'WORKER_UNKNOWN' | 'AGENT_NOT_ACTIVE' | 'STOPPED' | 'ALREADY_RUNNING' | 'DAILY_CAP_REACHED' | 'TRIPPED' | 'RUN_ID_EXISTS' | 'APPROVAL_INVALID'; detail: string }

const scrub = (s: string, n = 500) => redactText(String(s ?? '')).slice(0, n)
const sameUtcDay = (a: string, b: Date) => a.slice(0, 10) === b.toISOString().slice(0, 10)
const okNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0

/**
 * Runs a worker once under its limits. Runners are COOPERATIVE and in-process: a runner that ignores the abort signal
 * cannot be killed, but after a timeout/stop/finish every `requestEffect` call is denied and nothing further is recorded.
 * Effect gating is declared-effects-only: a runner that performs an effect without calling requestEffect is not detected.
 * Built-in workers are read-only. The start check, approval claim and start record are one cross-process critical section.
 * An approval authorizes ONE RUN (unlimited calls of its approved effects within that run).
 */
export async function executeWorker(
  log: AgentOpsLog,
  workerId: string,
  runner: WorkerRunner,
  opts: { now?: Date; runId?: string; approvalRid?: string } = {},
): Promise<ExecuteResult> {
  const now = opts.now ?? new Date()
  const runId = opts.runId ?? `run-${randomUUID()}`
  type Claim = { refusal: Extract<ExecuteResult, { ok: false }> } | { w: WorkerView; agentEscalation: string; approval?: ReturnType<typeof deriveWorkers>['approvals'][number]; base: RunRecord }
  const claim: Claim = log.withLock(() => {
    const { workers, approvals } = deriveWorkers(log)
    const w = workers.get(workerId)
    if (!w) return { refusal: { ok: false, reason: 'WORKER_UNKNOWN', detail: workerId } }
    const agent = deriveAgents(log).agents.get(w.spec.agentId)
    if (!agent || agent.state !== 'ACTIVE') return { refusal: { ok: false, reason: 'AGENT_NOT_ACTIVE', detail: `agent is ${agent?.state ?? 'unknown'}` } }
    if (w.stopped) return { refusal: { ok: false, reason: 'STOPPED', detail: w.stopReason ?? 'stopped' } }
    if (w.consecutiveFailures >= w.spec.limits.maxConsecutiveFailures) return { refusal: { ok: false, reason: 'TRIPPED', detail: `${w.consecutiveFailures} consecutive failures` } }
    if (w.running) return { refusal: { ok: false, reason: 'ALREADY_RUNNING', detail: w.running.runId } }
    if (w.runs.filter((r) => sameUtcDay(r.startedAt, now)).length >= w.spec.limits.maxRunsPerDay) return { refusal: { ok: false, reason: 'DAILY_CAP_REACHED', detail: `${w.spec.limits.maxRunsPerDay}/day` } }
    if ([...workers.values()].some((x) => x.runs.some((r) => r.runId === runId)) || log.has(`run:${runId}:start`)) return { refusal: { ok: false, reason: 'RUN_ID_EXISTS', detail: runId } }
    let approval: ReturnType<typeof deriveWorkers>['approvals'][number] | undefined
    if (opts.approvalRid) {
      approval = approvals.find((a) => a.rid === opts.approvalRid && a.workerId === workerId)
      const consumed = [...workers.values()].some((x) => x.runs.some((r) => r.approvalRef === opts.approvalRid))
      if (!approval || consumed) return { refusal: { ok: false, reason: 'APPROVAL_INVALID', detail: !approval ? 'no such approval for this worker' : 'approval already used by another run' } }
    }
    const base: RunRecord = {
      runId, workerId, agentId: w.spec.agentId, workerVersion: w.spec.version, mission: w.spec.mission,
      permissionScope: w.spec.permissionScope, memoryScope: w.spec.memoryScope, startedAt: now.toISOString(), status: 'RUNNING',
      toolsUsed: [], outputs: [], escalations: [], errors: [], executor: 'UNKNOWN', resource: { costUsd: 'UNKNOWN', tokens: 'UNKNOWN' }, requestedEffects: [],
      approvalRef: approval?.rid,
    }
    log.append({ t: 'run', rid: `run:${runId}:start`, run: base })
    return { w, agentEscalation: agent.spec.escalationPath, approval, base }
  })
  if ('refusal' in claim) return claim.refusal
  const { w, agentEscalation, approval, base } = claim

  const effectAllowed = (e: ProtectedEffect) => w.spec.preApprovedEffects.includes(e) || (!!approval && approval.effects.includes(e))
  const requested: ProtectedEffect[] = []
  const ac = new AbortController()
  let ended = false
  const shouldStop = () => deriveWorkers(log).workers.get(workerId)?.stopped === true
  const ctx: RunContext = {
    runId, worker: w.spec, signal: ac.signal, shouldStop,
    requestEffect: (e) => {
      if (ended || shouldStop()) throw new EffectBlockedError(e, 'run ended or stopped; effect denied')
      requested.push(e)
      if (!effectAllowed(e)) throw new EffectBlockedError(e)
    },
  }

  let status: RunStatus = 'SUCCEEDED'
  let result: RunnerResult = {}
  const errors: RunRecord['errors'] = []
  const escalations: RunRecord['escalations'] = []
  const t0 = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    result = (await Promise.race([
      runner(ctx),
      new Promise<never>((_, rej) => { timer = setTimeout(() => { ended = true; ac.abort(); rej(new Error('__TIMEOUT__')) }, w.spec.limits.maxRuntimeMs) }),
    ])) ?? {}
    if (shouldStop()) status = 'STOPPED'
  } catch (err) {
    if (err instanceof EffectBlockedError) {
      status = 'BLOCKED'
      escalations.push({ to: agentEscalation, reason: scrub(`blocked: ${err.message}; Commander approval required`) })
    } else if (err instanceof Error && err.message === '__TIMEOUT__') {
      status = 'TIMED_OUT'
      errors.push({ message: `exceeded ${w.spec.limits.maxRuntimeMs}ms`, recovery: 'run aborted; counted toward consecutive-failure trip' })
    } else {
      status = 'FAILED'
      errors.push({ message: scrub(err instanceof Error ? err.message : String(err)), recovery: 'recorded; counted toward consecutive-failure trip' })
    }
  } finally { ended = true; if (timer) clearTimeout(timer) }

  const duration = Date.now() - t0
  const endedAt = new Date(now.getTime() + duration).toISOString()
  const build = (): RunRecord => ({
    ...base, status, endedAt,
    toolsUsed: (Array.isArray(result.toolsUsed) ? result.toolsUsed : []).slice(0, 20).map((t) => scrub(String(t), 80)),
    outputs: (Array.isArray(result.outputs) ? result.outputs : []).slice(0, 20).map((o) => ({ kind: scrub(o?.kind, 60), ref: scrub(o?.ref, 200), summary: scrub(o?.summary) })),
    escalations: [...(Array.isArray(result.escalations) ? result.escalations : []).slice(0, 10).map((e) => ({ to: scrub(e?.to, 80), reason: scrub(e?.reason) })), ...escalations],
    errors,
    executor: result.executor && typeof result.executor === 'object' ? { provider: scrub(result.executor.provider, 80), model: scrub(result.executor.model, 120) } : 'UNKNOWN',
    resource: { durationMs: duration, costUsd: okNum(result.resource?.costUsd) ? result.resource!.costUsd! : 'UNKNOWN', tokens: okNum(result.resource?.tokens) ? result.resource!.tokens! : 'UNKNOWN' },
    requestedEffects: requested,
  })
  let final: RunRecord
  try {
    final = build()
    log.append({ t: 'run', rid: `run:${runId}:end`, run: final })
  } catch (err) {
    // a malformed/unsafe runner result must never leave the worker stuck RUNNING: record a minimal honest FAILED outcome
    final = { ...base, status: 'FAILED', endedAt, errors: [{ message: scrub(`result could not be recorded: ${err instanceof Error ? err.message : 'invalid'}`), recovery: 'recorded as FAILED; counted toward consecutive-failure trip' }], requestedEffects: requested, resource: { durationMs: duration, costUsd: 'UNKNOWN', tokens: 'UNKNOWN' } }
    log.append({ t: 'run', rid: `run:${runId}:end`, run: final })
  }

  // failure handling: trip the agent to PAUSED (system governor) after too many consecutive failures
  const after = deriveWorkers(log).workers.get(workerId)!
  if (after.consecutiveFailures >= w.spec.limits.maxConsecutiveFailures) {
    try { new AgentRegistry(log).transition(w.spec.agentId, 'PAUSED', 'system:governor', `worker ${workerId} tripped after ${after.consecutiveFailures} consecutive failures`, now) } catch { /* already paused/retired */ }
  }
  return { ok: true, run: final }
}

/** Marks RUNNING runs that cannot still be alive (older than their runtime limit) as INTERRUPTED. Idempotent; never rewrites records. */
export function recoverInterruptedRuns(log: AgentOpsLog, now: Date = new Date()): string[] {
  const done: string[] = []
  log.withLock(() => {
  for (const w of deriveWorkers(log).workers.values()) {
    const r = w.running
    if (!r) continue
    if (now.getTime() - Date.parse(r.startedAt) <= w.spec.limits.maxRuntimeMs + 5_000) continue
    log.append({ t: 'run', rid: `run:${r.runId}:interrupted`, run: { ...r, status: 'INTERRUPTED', endedAt: now.toISOString(), errors: [...r.errors, { message: 'no completion record; process ended or restarted mid-run', recovery: 'marked INTERRUPTED; not retried automatically' }] } })
    done.push(r.runId)
  }
  })
  return done
}

export function auditCompleteness(run: RunRecord): { complete: boolean; missing: string[] } {
  const missing: string[] = []
  if (!run.workerId || !run.workerVersion) missing.push('identity+version')
  if (!run.mission) missing.push('mission')
  if (!run.permissionScope?.length) missing.push('permissionScope')
  if (!run.memoryScope?.length) missing.push('memoryScope')
  if (!run.endedAt && run.status !== 'RUNNING') missing.push('endedAt')
  if (!Array.isArray(run.toolsUsed) || !Array.isArray(run.outputs) || !Array.isArray(run.escalations) || !Array.isArray(run.errors)) missing.push('tools/outputs/escalations/errors')
  if (!run.resource || run.resource.costUsd === undefined || run.resource.tokens === undefined) missing.push('resource')
  if (run.executor === undefined) missing.push('executor')
  return { complete: missing.length === 0, missing }
}
