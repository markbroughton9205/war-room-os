import { randomUUID } from 'node:crypto'
import type { AgentOpsLog } from './log'
import { isCommander, isSystem } from './lifecycle'
import { deriveAgents } from './registry'
import { BUILTIN_RUNNERS } from './builtinWorkers'
import { deriveWorkers, executeWorker, type WorkerRunner, type WorkerView } from './workers'
import type { Actor, AgentOpsRecord, WorkerCategory } from './types'

/** First-party read-only categories whose runners exist. Anything else is never schedulable. */
export const SCHEDULER_ELIGIBLE: readonly WorkerCategory[] = ['evaluation_scoring', 'documentation_freshness']
export const CADENCE_MIN = 1
export const CADENCE_MAX = 10_080 // one week
export const SCHED_MAX_CONCURRENT = 2
export const SCHED_MAX_CLAIMS_PER_TICK = 2
const MAX_BACKOFF_FACTOR = 16
const SKIP_REPEAT_MS = 60 * 60_000

export class SchedulerError extends Error {
  constructor(public readonly code: 'NOT_AUTHORIZED' | 'INVALID' | 'NOT_ELIGIBLE', msg: string) { super(msg) }
}

export const validCadence = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= CADENCE_MIN && n <= CADENCE_MAX

/** Why a worker can never be scheduled (null = schedulable). */
export function schedulabilityProblem(w: WorkerView | undefined): string | null {
  if (!w) return 'unknown worker'
  if (!SCHEDULER_ELIGIBLE.includes(w.spec.category)) return `category ${w.spec.category} has no scheduler-eligible runner`
  if (w.spec.preApprovedEffects.length > 0) return 'worker has pre-approved protected effects; only read-only workers can be scheduled'
  return null
}

export type ScheduleState = { enabled: boolean; cadenceMinutes: number; by: Actor; at: string; reason: string }
export type SchedulerState = {
  global: { enabled: boolean; by: Actor; at: string; reason: string } | null
  schedules: Map<string, ScheduleState>
  lastClaim: Map<string, Extract<AgentOpsRecord, { t: 'schedClaim' }>>
  lastDecision: Map<string, Extract<AgentOpsRecord, { t: 'schedDecision' }>>
  lastSkip: Map<string, Extract<AgentOpsRecord, { t: 'schedDecision' }>>
}

/** Replay: schedule/global records are valid only from a Commander (enable/cadence) or the scheduler/system (disable only). */
export function deriveScheduler(log: AgentOpsLog): SchedulerState {
  const v = log.view()
  const workers = deriveWorkers(log).workers
  const st: SchedulerState = { global: null, schedules: new Map(), lastClaim: new Map(), lastDecision: new Map(), lastSkip: new Map() }
  for (const r of v.records) {
    if (r.t === 'schedulerGlobal') {
      if (isCommander(r.by) || (isSystem(r.by) && !r.enabled)) st.global = { enabled: r.enabled, by: r.by, at: r.at, reason: r.reason }
    } else if (r.t === 'schedule') {
      const w = workers.get(r.workerId)
      if (!w || !validCadence(r.cadenceMinutes)) continue
      const okActor = isCommander(r.by) || (isSystem(r.by) && !r.enabled)
      if (!okActor) continue
      if (r.enabled && schedulabilityProblem(w)) continue
      st.schedules.set(r.workerId, { enabled: r.enabled, cadenceMinutes: r.cadenceMinutes, by: r.by, at: r.at, reason: r.reason })
    } else if (r.t === 'schedClaim' && isSystem('system:' + r.instanceId.replace(/[^A-Za-z0-9._-]/g, '')) && workers.has(r.workerId)) st.lastClaim.set(r.workerId, r)
    else if (r.t === 'schedDecision') { st.lastDecision.set(r.workerId, r); if (r.decision === 'SKIP') st.lastSkip.set(r.workerId, r) }
  }
  return st
}

export function setSchedule(log: AgentOpsLog, workerId: string, input: { enabled: boolean; cadenceMinutes: number }, by: Actor, reason: string, now: Date = new Date()) {
  const isDisable = !input.enabled
  if (!isCommander(by) && !(isSystem(by) && isDisable)) throw new SchedulerError('NOT_AUTHORIZED', 'scheduling changes require a Commander (the scheduler may only disable)')
  if (!validCadence(input.cadenceMinutes)) throw new SchedulerError('INVALID', `cadence must be an integer between ${CADENCE_MIN} and ${CADENCE_MAX} minutes`)
  if (!reason.trim()) throw new SchedulerError('INVALID', 'reason required')
  const w = deriveWorkers(log).workers.get(workerId)
  if (!w) throw new SchedulerError('INVALID', `unknown worker: ${workerId}`)
  if (input.enabled) { const p = schedulabilityProblem(w); if (p) throw new SchedulerError('NOT_ELIGIBLE', p) }
  return log.append({ t: 'schedule', workerId, enabled: input.enabled, cadenceMinutes: input.cadenceMinutes, by, at: now.toISOString(), reason: reason.slice(0, 200) })
}

export function setSchedulerGlobal(log: AgentOpsLog, enabled: boolean, by: Actor, reason: string, now: Date = new Date()) {
  if (!isCommander(by) && !(isSystem(by) && !enabled)) throw new SchedulerError('NOT_AUTHORIZED', 'global scheduler control requires a Commander')
  if (!reason.trim()) throw new SchedulerError('INVALID', 'reason required')
  return log.append({ t: 'schedulerGlobal', enabled, by, at: now.toISOString(), reason: reason.slice(0, 200) })
}

export type DueEvaluation =
  | { action: 'RUN'; reason: string; dueAt: Date; nextEligibleAt: Date; collapsedIntervals: number }
  | { action: 'SKIP'; reason: string; nextEligibleAt: Date | null }

/** Pure: is this worker due, and if not, why not. `nextEligibleAt` is derived from durable state only. */
export function evaluateDue(w: WorkerView, schedule: ScheduleState | undefined, lastClaimAt: string | undefined, agentState: string | undefined, runningScheduled: number, now: Date): DueEvaluation {
  if (!schedule || !schedule.enabled) return { action: 'SKIP', reason: 'SCHEDULE_DISABLED', nextEligibleAt: null }
  const p = schedulabilityProblem(w)
  if (p) return { action: 'SKIP', reason: 'NOT_ELIGIBLE', nextEligibleAt: null }
  const cadenceMs = schedule.cadenceMinutes * 60_000
  const backoff = Math.min(2 ** w.consecutiveFailures, MAX_BACKOFF_FACTOR)
  const anchor = Math.max(Date.parse(schedule.at), lastClaimAt ? Date.parse(lastClaimAt) : 0)
  const due = new Date(anchor + cadenceMs * backoff)
  if (agentState !== 'ACTIVE') return { action: 'SKIP', reason: `AGENT_${agentState ?? 'UNKNOWN'}`, nextEligibleAt: due }
  if (w.stopped) return { action: 'SKIP', reason: 'WORKER_STOPPED', nextEligibleAt: due }
  if (w.consecutiveFailures >= w.spec.limits.maxConsecutiveFailures) return { action: 'SKIP', reason: 'TRIPPED', nextEligibleAt: null }
  if (w.running) return { action: 'SKIP', reason: 'ALREADY_RUNNING', nextEligibleAt: due }
  if (now.getTime() < due.getTime()) return { action: 'SKIP', reason: 'NOT_DUE', nextEligibleAt: due }
  const today = now.toISOString().slice(0, 10)
  if (w.runs.filter((r) => r.startedAt.slice(0, 10) === today).length >= w.spec.limits.maxRunsPerDay) return { action: 'SKIP', reason: 'DAILY_CAP_REACHED', nextEligibleAt: due }
  if (runningScheduled >= SCHED_MAX_CONCURRENT) return { action: 'SKIP', reason: 'CONCURRENCY_LIMIT', nextEligibleAt: due }
  const collapsed = Math.max(0, Math.floor((now.getTime() - due.getTime()) / cadenceMs))
  return { action: 'RUN', reason: collapsed > 0 ? `due; ${collapsed} missed interval(s) collapsed into this single run` : 'due', dueAt: due, nextEligibleAt: new Date(now.getTime() + cadenceMs), collapsedIntervals: collapsed }
}

export type TickResult = { at: string; instanceId: string; globalEnabled: boolean; ran: { workerId: string; runId: string; status: string; claimId: string }[]; skipped: { workerId: string; reason: string }[] }
export type TickOptions = { now?: Date; instanceId?: string; runners?: Partial<Record<WorkerCategory, WorkerRunner>>; envOff?: boolean }

function recordDecision(log: AgentOpsLog, workerId: string, now: Date, decision: 'RUN' | 'SKIP', reason: string, next: Date | null, claimId?: string) {
  if (decision === 'SKIP') {
    const last = deriveScheduler(log).lastDecision.get(workerId)
    if (last && last.decision === 'SKIP' && last.reason === reason && now.getTime() - Date.parse(last.at) < SKIP_REPEAT_MS) return // no log spam for repeated identical skips
    if (reason === 'NOT_DUE' || reason === 'SCHEDULE_DISABLED') return
  }
  log.append({ t: 'schedDecision', workerId, at: now.toISOString(), decision, reason, nextEligibleAt: next ? next.toISOString() : null, ...(claimId ? { claimId } : {}) })
}

/**
 * One bounded scheduler wake-up. Idempotent: a due slot is claimed with a deterministic record id inside the log lock, so
 * duplicate ticks or competing processes produce exactly one winner. Never passes an approval; a BLOCKED scheduled run
 * disables that worker's schedule. At most SCHED_MAX_CLAIMS_PER_TICK runs; overdue slots collapse into one.
 */
export async function schedulerTick(log: AgentOpsLog, opts: TickOptions = {}): Promise<TickResult> {
  // tests inject a fixed `now`; production reads the real clock again for every worker so run timestamps are true start/end times
  const clock = opts.now ? () => opts.now as Date : () => new Date()
  let now = clock()
  const instanceId = (opts.instanceId ?? `scheduler-${process.pid}`).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64) || `scheduler-${process.pid}`
  const result: TickResult = { at: now.toISOString(), instanceId, globalEnabled: false, ran: [], skipped: [] }
  const envOff = opts.envOff ?? process.env.WAR_ROOM_AGENT_SCHEDULER === 'off'
  const state = deriveScheduler(log)
  result.globalEnabled = !envOff && state.global?.enabled === true
  const runners = { ...BUILTIN_RUNNERS, ...(opts.runners ?? {}) }
  const enabledIds = [...state.schedules.entries()].filter(([, s]) => s.enabled).map(([id]) => id)
  if (!result.globalEnabled) {
    for (const id of enabledIds) { result.skipped.push({ workerId: id, reason: envOff ? 'SCHEDULER_ENV_OFF' : 'GLOBAL_DISABLED' }); if (!log.readOnly) recordDecision(log, id, now, 'SKIP', envOff ? 'SCHEDULER_ENV_OFF' : 'GLOBAL_DISABLED', null) }
    return result
  }
  let claims = 0
  for (const workerId of enabledIds) {
    now = clock()
    if (claims >= SCHED_MAX_CLAIMS_PER_TICK) { result.skipped.push({ workerId, reason: 'TICK_CLAIM_LIMIT' }); continue }
    const claim = log.withLock(() => {
      const fresh = deriveScheduler(log)
      // pause/disable is re-checked at claim time: a pause that lands mid-tick stops further claims (it cannot stop a run already in flight)
      if (process.env.WAR_ROOM_AGENT_SCHEDULER === 'off' || fresh.global?.enabled !== true) { result.skipped.push({ workerId, reason: 'GLOBAL_DISABLED' }); return null }
      const ws = deriveWorkers(log).workers
      const w = ws.get(workerId)
      if (!w) return null
      const agent = deriveAgents(log).agents.get(w.spec.agentId)
      const runningScheduled = [...ws.values()].reduce((n, x) => n + x.runs.filter((r) => r.status === 'RUNNING').length, 0) // all origins: a manual run uses the same resources
      const ev = evaluateDue(w, fresh.schedules.get(workerId), fresh.lastClaim.get(workerId)?.at, agent?.state, runningScheduled, now)
      if (ev.action === 'SKIP') { result.skipped.push({ workerId, reason: ev.reason }); recordDecision(log, workerId, now, 'SKIP', ev.reason, ev.nextEligibleAt); return null }
      const slotMs = Math.floor(ev.dueAt.getTime() / 60_000) * 60_000
      const claimId = `claim-${workerId}-${slotMs}`
      try {
        log.append({ t: 'schedClaim', rid: `sched:${workerId}:${slotMs}`, claimId, workerId, slotMs, dueAt: ev.dueAt.toISOString(), instanceId, at: now.toISOString(), collapsedIntervals: ev.collapsedIntervals })
      } catch { result.skipped.push({ workerId, reason: 'CLAIM_LOST' }); return null }
      recordDecision(log, workerId, now, 'RUN', ev.reason, ev.nextEligibleAt, claimId)
      return { claimId, slotMs, category: w.spec.category }
    })
    if (!claim) continue
    claims += 1
    const runner = runners[claim.category]
    if (!runner) { result.skipped.push({ workerId, reason: 'NO_RUNNER' }); recordDecision(log, workerId, now, 'SKIP', 'NO_RUNNER', null); continue }
    const res = await executeWorker(log, workerId, runner, { now, runId: `sched-${workerId}-${claim.slotMs}`, origin: 'scheduled', claimId: claim.claimId })
    if (!res.ok) { result.skipped.push({ workerId, reason: res.reason }); recordDecision(log, workerId, now, 'SKIP', res.reason, null); continue }
    result.ran.push({ workerId, runId: res.run.runId, status: res.run.status, claimId: claim.claimId })
    if (res.run.status === 'BLOCKED') {
      const sch = deriveScheduler(log).schedules.get(workerId)
      try { setSchedule(log, workerId, { enabled: false, cadenceMinutes: sch?.cadenceMinutes ?? CADENCE_MIN }, `system:${instanceId.replace(/[^A-Za-z0-9._-]/g, '')}`, 'scheduled run requested a protected effect; scheduling disabled pending Commander review', now) } catch { /* already disabled */ }
    }
  }
  return result
}

export const newInstanceId = () => `scheduler-${process.pid}-${randomUUID().slice(0, 8)}`
