/** Phase 10 scheduler validation. Run: pnpm run validate:agent-ops-scheduler */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { harness, freshOps, fullNeed, draft, NOW, tmp } from './testkit'
import { AgentOpsLog } from './log'
import { AgentRegistry, deriveAgents } from './registry'
import { SchedulerError, deriveScheduler, schedulerTick, setSchedule, setSchedulerGlobal, SCHED_MAX_CONCURRENT } from './scheduler'
import { approveEffect, deriveWorkers, registerWorker, stopWorker, resumeWorker, executeWorker, type WorkerRunner } from './workers'
import { startAgentScheduler } from './schedulerBoot'
import { readSchedulerHealth } from './schedulerHealth'
import { handleOpsControl, handleOpsRead } from './api'
import { buildOpsSnapshot } from './readModel'
import { buildOpsViewModel } from './uiState'
import type { WorkerCategory } from './types'

const { check, finish } = harness('AGENT_OPS_SCHEDULER_VALIDATION')
const C = 'commander:mark'
const at = (min: number) => new Date(NOW.getTime() + min * 60_000)
const ok: WorkerRunner = async () => ({ outputs: [{ kind: 'k', ref: 'r', summary: 'ran' }], toolsUsed: ['test'] })
const runners = (r: WorkerRunner) => ({ documentation_freshness: r, evaluation_scoring: r })

/** Fresh registry with ACTIVE agent(s) and scheduled workers (global scheduling enabled). */
function world(opts: { workers?: number; cadence?: number; category?: WorkerCategory; enableGlobal?: boolean; limits?: Partial<{ maxRuntimeMs: number; maxRunsPerDay: number; maxConsecutiveFailures: number }> } = {}) {
  const o = freshOps()
  const need = fullNeed(); o.reg.recordNeed(need)
  const spec = o.reg.propose(need.id, draft({ permissionScope: ['read_docs', 'read_learning_log', 'write_own_reports'], memoryScope: ['docs', 'learning_evidence'] }), NOW)
  o.reg.transition(spec.id, 'APPROVED', C, 'a', NOW); o.reg.transition(spec.id, 'ACTIVE', C, 'a', NOW)
  const ids: string[] = []
  for (let i = 0; i < (opts.workers ?? 1); i++) {
    const id = `w${i}`
    registerWorker(o.log, { id, agentId: spec.id, category: opts.category ?? 'documentation_freshness', version: '1', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], limits: { maxRuntimeMs: 3000, maxRunsPerDay: 500, maxConsecutiveFailures: 3, cadenceMinutes: null, ...(opts.limits ?? {}) } }, C, NOW)
    ids.push(id)
    if ((opts.category ?? 'documentation_freshness') !== 'incident_watch') setSchedule(o.log, id, { enabled: true, cadenceMinutes: opts.cadence ?? 5 }, C, 'schedule', NOW)
  }
  if (opts.enableGlobal !== false) setSchedulerGlobal(o.log, true, C, 'on', NOW)
  return { ...o, spec, ids }
}
const errCode = (fn: () => unknown) => { try { fn(); return 'none' } catch (e) { return e instanceof SchedulerError ? e.code : 'other' } }
const ranCount = (log: AgentOpsLog, id: string) => deriveWorkers(log).workers.get(id)!.runs.length

// ---- eligibility, cadence, authority
{
  const w = world({ workers: 1 })
  check('S01_invalid_cadence_rejected', [0, -1, 1.5, 10_081, NaN, '5' as never].every((c) => errCode(() => setSchedule(w.log, 'w0', { enabled: true, cadenceMinutes: c as number }, C, 'x', NOW)) === 'INVALID'))
  const inc = world({ workers: 1, category: 'incident_watch' })
  check('S02_category_without_runner_cannot_be_scheduled', errCode(() => setSchedule(inc.log, 'w0', { enabled: true, cadenceMinutes: 5 }, C, 'x', NOW)) === 'NOT_ELIGIBLE')
  const pre = freshOps(); const n = fullNeed(); pre.reg.recordNeed(n); const sp = pre.reg.propose(n.id, draft(), NOW); pre.reg.transition(sp.id, 'APPROVED', C, 'a', NOW); pre.reg.transition(sp.id, 'ACTIVE', C, 'a', NOW)
  registerWorker(pre.log, { id: 'wp', agentId: sp.id, category: 'documentation_freshness', version: '1', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], limits: { maxRuntimeMs: 1000, maxRunsPerDay: 5, maxConsecutiveFailures: 3, cadenceMinutes: null }, preApprovedEffects: ['external_communication'] }, C, NOW)
  check('S03_worker_with_preapproved_effects_cannot_be_scheduled', errCode(() => setSchedule(pre.log, 'wp', { enabled: true, cadenceMinutes: 5 }, C, 'x', NOW)) === 'NOT_ELIGIBLE')
  check('S04_only_commander_enables_scheduler_may_only_disable', errCode(() => setSchedule(w.log, 'w0', { enabled: true, cadenceMinutes: 5 }, 'agent:self', 'x', NOW)) === 'NOT_AUTHORIZED' && errCode(() => setSchedule(w.log, 'w0', { enabled: true, cadenceMinutes: 5 }, 'system:scheduler-1', 'x', NOW)) === 'NOT_AUTHORIZED' && errCode(() => setSchedule(w.log, 'w0', { enabled: false, cadenceMinutes: 5 }, 'system:scheduler-1', 'auto', NOW)) === 'none' && errCode(() => setSchedulerGlobal(w.log, true, 'system:x', 'x', NOW)) === 'NOT_AUTHORIZED')
  const fz = freshOps(); void fz
  const forged = world({ workers: 1, category: 'incident_watch' })
  forged.log.append({ t: 'schedule', workerId: 'w0', enabled: true, cadenceMinutes: 5, by: C, at: NOW.toISOString(), reason: 'forged for ineligible' })
  forged.log.append({ t: 'schedule', workerId: 'w0', enabled: true, cadenceMinutes: 5, by: 'agent:self', at: NOW.toISOString(), reason: 'forged actor' })
  forged.log.append({ t: 'schedulerGlobal', enabled: true, by: 'agent:self', at: NOW.toISOString(), reason: 'forged global' })
  check('S05_forged_schedule_and_global_records_ignored_on_replay', !deriveScheduler(forged.log).schedules.has('w0') && deriveScheduler(forged.log).global?.enabled === true && deriveScheduler(forged.log).global?.by === C)
}

// ---- global switch, defaults, first-run timing
{
  const off = world({ enableGlobal: false })
  const t0 = await schedulerTick(off.log, { now: at(60), runners: runners(ok) })
  check('S06_default_global_state_is_off_nothing_runs', t0.globalEnabled === false && t0.ran.length === 0 && t0.skipped[0].reason === 'GLOBAL_DISABLED' && ranCount(off.log, 'w0') === 0)
  const envOff = world()
  const te = await schedulerTick(envOff.log, { now: at(60), runners: runners(ok), envOff: true })
  check('S07_env_switch_hard_disables_even_when_enabled', te.ran.length === 0 && te.skipped[0].reason === 'SCHEDULER_ENV_OFF')
  const w = world({ cadence: 5 })
  const early = await schedulerTick(w.log, { now: at(4), runners: runners(ok) })
  const due = await schedulerTick(w.log, { now: at(5), runners: runners(ok) })
  check('S08_first_run_is_one_cadence_after_enabling_not_immediate', early.ran.length === 0 && due.ran.length === 1 && due.ran[0].status === 'SUCCEEDED')
  const run = deriveWorkers(w.log).workers.get('w0')!.runs[0]
  const claim = deriveScheduler(w.log).lastClaim.get('w0')!
  check('S09_automatic_run_identity_is_auditable', run.origin === 'scheduled' && run.claimId === claim.claimId && run.runId === `sched-w0-${claim.slotMs}` && claim.instanceId.startsWith('scheduler-') && deriveScheduler(w.log).lastDecision.get('w0')!.decision === 'RUN' && deriveScheduler(w.log).lastDecision.get('w0')!.claimId === claim.claimId)
  check('S10_executor_and_cost_recorded_honestly', run.executor === 'UNKNOWN' && run.resource.costUsd === 'UNKNOWN')
  const m = world(); await schedulerTick(m.log, { now: at(5), runners: { documentation_freshness: async () => ({ executor: { provider: 'ollama', model: 'qwen2.5-coder:14b' }, resource: { costUsd: 0, tokens: 100 } }) } })
  const mr = deriveWorkers(m.log).workers.get('w0')!.runs[0]
  check('S11_model_executor_recorded_as_reported', mr.executor !== 'UNKNOWN' && (mr.executor as { model: string }).model === 'qwen2.5-coder:14b' && mr.resource.tokens === 100)
  const paused = await (async () => { setSchedulerGlobal(w.log, false, C, 'pause', at(6)); return schedulerTick(w.log, { now: at(11), runners: runners(ok) }) })()
  check('S12_pause_scheduling_stops_further_runs_and_resume_restores', paused.ran.length === 0 && paused.skipped[0].reason === 'GLOBAL_DISABLED' && (setSchedulerGlobal(w.log, true, C, 'resume', at(12)), (await schedulerTick(w.log, { now: at(12), runners: runners(ok) })).ran.length === 1))
}

// ---- stopped / paused / retired / tripped / caps / concurrency
{
  const s = world(); stopWorker(s.log, 'w0', C, 'operator', NOW)
  const t = await schedulerTick(s.log, { now: at(30), runners: runners(ok) })
  check('S13_stopped_worker_never_auto_runs', t.ran.length === 0 && t.skipped[0].reason === 'WORKER_STOPPED' && ranCount(s.log, 'w0') === 0)
  await schedulerTick(s.log, { now: at(31), runners: runners(ok) }); await schedulerTick(s.log, { now: at(32), runners: runners(ok) })
  check('S14_repeated_identical_skips_are_not_log_spam', s.log.view().records.filter((r) => r.t === 'schedDecision' && r.reason === 'WORKER_STOPPED').length === 1)
  resumeWorker(s.log, 'w0', C, 'ok', at(33))
  const back = await schedulerTick(s.log, { now: at(40), runners: runners(ok) })
  check('S15_resume_restores_automatic_operation_at_next_eligible_cadence', back.ran.length === 1)
  const p = world(); new AgentRegistry(p.log).transition(p.spec.id, 'PAUSED', C, 'pause', NOW)
  check('S16_paused_agent_never_auto_runs', (await schedulerTick(p.log, { now: at(30), runners: runners(ok) })).skipped[0].reason === 'AGENT_PAUSED' && ranCount(p.log, 'w0') === 0)
  const r = world(); new AgentRegistry(r.log).transition(r.spec.id, 'RETIRED', C, 'retire', NOW)
  check('S17_retired_agent_never_auto_runs', (await schedulerTick(r.log, { now: at(30), runners: runners(ok) })).ran.length === 0 && ranCount(r.log, 'w0') === 0)
  // failure trip + backoff
  const f = world({ cadence: 1, limits: { maxConsecutiveFailures: 2 } })
  const boom: WorkerRunner = async () => { throw new Error('x') }
  const t1 = await schedulerTick(f.log, { now: at(1), runners: runners(boom) })
  const tEarly = await schedulerTick(f.log, { now: at(2), runners: runners(boom) })
  const t2 = await schedulerTick(f.log, { now: at(3), runners: runners(boom) })
  const t3 = await schedulerTick(f.log, { now: at(60), runners: runners(ok) })
  check('S18_failure_backoff_then_trip_stops_all_automatic_runs', t1.ran.length === 1 && tEarly.ran.length === 0 && t2.ran.length === 1 && t3.ran.length === 0 && deriveAgents(f.log).agents.get(f.spec.id)!.state === 'PAUSED' && ranCount(f.log, 'w0') === 2, `reason=${t3.skipped[0]?.reason}`)
  // caps
  const cap = world({ cadence: 1, limits: { maxRunsPerDay: 1 } })
  await schedulerTick(cap.log, { now: at(1), runners: runners(ok) })
  check('S19_daily_cap_respected_by_scheduler', (await schedulerTick(cap.log, { now: at(5), runners: runners(ok) })).skipped[0].reason === 'DAILY_CAP_REACHED')
  // concurrency
  const c = world({ workers: 4 })
  const slow = new Promise<void>(() => { /* never resolves: simulates in-flight scheduled runs */ }); void slow
  for (const id of ['w0', 'w1']) c.log.append({ t: 'run', rid: `run:inflight-${id}:start`, run: { runId: `inflight-${id}`, workerId: id, agentId: c.spec.id, workerVersion: '1', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], startedAt: at(4).toISOString(), status: 'RUNNING', toolsUsed: [], outputs: [], escalations: [], errors: [], executor: 'UNKNOWN', resource: { costUsd: 'UNKNOWN', tokens: 'UNKNOWN' }, requestedEffects: [], origin: 'scheduled' } })
  const tc = await schedulerTick(c.log, { now: at(5), runners: runners(ok) })
  check('S20_global_concurrent_scheduled_run_cap_enforced', tc.ran.length === 0 && tc.skipped.filter((x) => x.reason === 'CONCURRENCY_LIMIT').length === 2 && tc.skipped.filter((x) => x.reason === 'ALREADY_RUNNING').length === 2 && SCHED_MAX_CONCURRENT === 2)
  const lim = world({ workers: 5 })
  const tl = await schedulerTick(lim.log, { now: at(5), runners: runners(ok) })
  check('S21_bounded_claims_per_tick', tl.ran.length === 2 && tl.skipped.filter((x) => x.reason === 'TICK_CLAIM_LIMIT').length === 3)
}

// ---- risky effects, approvals
{
  const k = world()
  const risky: WorkerRunner = async (ctx) => { ctx.requestEffect('spend'); return {} }
  const ap = approveEffect(k.log, 'w0', ['spend'], C, 'a stale/unused approval exists', NOW)
  const t = await schedulerTick(k.log, { now: at(5), runners: runners(risky) })
  const run = deriveWorkers(k.log).workers.get('w0')!.runs[0]
  check('S22_scheduled_run_never_uses_approvals_risky_effect_blocked', t.ran[0].status === 'BLOCKED' && run.approvalRef === undefined && run.requestedEffects.join() === 'spend' && !deriveWorkers(k.log).workers.get('w0')!.runs.some((r) => r.approvalRef === ap.rid))
  check('S23_blocked_scheduled_run_disables_its_schedule_pending_commander', deriveScheduler(k.log).schedules.get('w0')!.enabled === false && deriveScheduler(k.log).schedules.get('w0')!.by.startsWith('system:scheduler'))
  const next = await schedulerTick(k.log, { now: at(60), runners: runners(ok) })
  check('S24_no_further_automatic_runs_until_commander_reenables', next.ran.length === 0)
  const manual = await executeWorker(k.log, 'w0', risky, { now: at(61), runId: 'manual-1', approvalRid: ap.rid })
  check('S25_unused_approval_still_valid_for_a_manual_run_and_is_single_use', manual.ok && manual.run.status === 'SUCCEEDED' && manual.run.approvalRef === ap.rid && manual.run.origin === 'manual' && !(await executeWorker(k.log, 'w0', risky, { now: at(62), runId: 'manual-2', approvalRid: ap.rid })).ok)
  setSchedule(k.log, 'w0', { enabled: true, cadenceMinutes: 5 }, C, 'reviewed', at(70))
  check('S26_commander_can_reenable', (await schedulerTick(k.log, { now: at(76), runners: runners(ok) })).ran.length === 1)
}

// ---- idempotence, races, restart, catch-up
{
  const d = world({ cadence: 5 })
  const slowRunner: WorkerRunner = async () => { await new Promise((r) => setTimeout(r, 150)); return {} }
  const rs = await Promise.all([1, 2, 3].map((i) => schedulerTick(d.log, { now: at(5), instanceId: `scheduler-t${i}`, runners: runners(slowRunner) })))
  check('S27_duplicate_ticks_at_the_same_instant_produce_one_run', rs.reduce((n, r) => n + r.ran.length, 0) === 1 && ranCount(d.log, 'w0') === 1)
  // cross-process race
  const x = world({ cadence: 5 })
  const barrier = String(Date.now() + 1500)
  const exec = promisify(execFile)
  const outs = await Promise.all(['a', 'b', 'c'].map((tag) => exec('node', ['--loader', './scripts/ts-extension-loader.mjs', '--experimental-transform-types', 'lib/agents/ops/schedTick.child.validation.ts', x.dir, tag, barrier, at(5).toISOString()]).then((o) => JSON.parse(o.stdout.trim().split('\n').pop()!))))
  const claims = new AgentOpsLog(x.dir).view().records.filter((r) => r.t === 'schedClaim')
  check('S28_two_or_more_processes_racing_for_a_due_worker_one_winner', outs.reduce((n, o) => n + o.ran, 0) === 1 && claims.length === 1 && ranCount(new AgentOpsLog(x.dir), 'w0') === 1, JSON.stringify(outs))
  // restart: in-flight run is not duplicated
  const rst = world({ cadence: 5 })
  rst.log.append({ t: 'run', rid: 'run:fly:start', run: { runId: 'fly', workerId: 'w0', agentId: rst.spec.id, workerVersion: '1', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], startedAt: at(4).toISOString(), status: 'RUNNING', toolsUsed: [], outputs: [], escalations: [], errors: [], executor: 'UNKNOWN', resource: { costUsd: 'UNKNOWN', tokens: 'UNKNOWN' }, requestedEffects: [], origin: 'scheduled' } })
  const afterRestart = await schedulerTick(new AgentOpsLog(rst.dir), { now: at(5), runners: runners(ok) })
  check('S29_restart_does_not_duplicate_an_active_run', afterRestart.ran.length === 0 && afterRestart.skipped[0].reason === 'ALREADY_RUNNING' && ranCount(rst.log, 'w0') === 1)
  // missed cadence collapse
  const cu = world({ cadence: 5 })
  const storm = await schedulerTick(new AgentOpsLog(cu.dir), { now: at(50), runners: runners(ok) })
  const again = await schedulerTick(new AgentOpsLog(cu.dir), { now: at(51), runners: runners(ok) })
  const dec = deriveScheduler(cu.log).lastDecision.get('w0')!
  const later = await schedulerTick(new AgentOpsLog(cu.dir), { now: at(56), runners: runners(ok) })
  check('S30_missed_cadences_collapse_to_one_run_no_storm', storm.ran.length === 1 && again.ran.length === 0 && dec.reason.includes('9 missed') && later.ran.length === 1 && ranCount(cu.log, 'w0') === 2)
  const persisted = buildOpsSnapshot(new AgentOpsLog(cu.dir), at(57)).scheduler.workers[0]
  check('S31_next_schedule_survives_restart_from_durable_state', persisted.nextEligibleAt === at(61).toISOString() && persisted.lastAutomaticRunAt === at(56).toISOString())
  const crash = world({ cadence: 5 })
  crash.log.append({ t: 'schedClaim', rid: `sched:w0:${at(5).getTime()}`, claimId: 'claim-crash', workerId: 'w0', slotMs: at(5).getTime(), dueAt: at(5).toISOString(), instanceId: 'scheduler-dead', at: at(5).toISOString(), collapsedIntervals: 0 })
  const noReplay = await schedulerTick(crash.log, { now: at(6), runners: runners(ok) })
  check('S32_claim_without_run_after_crash_is_not_replayed_this_slot', noReplay.ran.length === 0 && (await schedulerTick(crash.log, { now: at(10), runners: runners(ok) })).ran.length === 1)
}

// ---- lifecycle / health / read model / API / UI
{
  const dir = tmp()
  const seedLog = new AgentOpsLog(dir)
  const reg = new AgentRegistry(seedLog); const need = fullNeed(); reg.recordNeed(need)
  const sp = reg.propose(need.id, draft({ permissionScope: ['read_docs', 'write_own_reports'] }), NOW); reg.transition(sp.id, 'APPROVED', C, 'a', NOW); reg.transition(sp.id, 'ACTIVE', C, 'a', NOW)
  registerWorker(seedLog, { id: 'wz', agentId: sp.id, category: 'documentation_freshness', version: '1', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], limits: { maxRuntimeMs: 1000, maxRunsPerDay: 5, maxConsecutiveFailures: 3, cadenceMinutes: null } }, C, NOW)
  seedLog.append({ t: 'run', rid: 'run:ghost:start', run: { runId: 'ghost', workerId: 'wz', agentId: sp.id, workerVersion: '1', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], startedAt: '2020-01-01T00:00:00.000Z', status: 'RUNNING', toolsUsed: [], outputs: [], escalations: [], errors: [], executor: 'UNKNOWN', resource: { costUsd: 'UNKNOWN', tokens: 'UNKNOWN' }, requestedEffects: [] } })
  process.env.WAR_ROOM_AGENT_SCHEDULER = 'off'
  check('S33_env_off_means_no_scheduler_process', startAgentScheduler({ dir, startupDelayMs: 0, intervalMs: 2000 }) === null && !existsSync(path.join(dir, 'scheduler-health.json')))
  delete process.env.WAR_ROOM_AGENT_SCHEDULER
  const h1 = startAgentScheduler({ dir, startupDelayMs: 0, intervalMs: 2000 })
  const h2 = startAgentScheduler({ dir, startupDelayMs: 0, intervalMs: 2000 })
  await new Promise((r) => setTimeout(r, 2600))
  const health = readSchedulerHealth(dir)
  check('S34_scheduler_singleton_starts_recovers_and_reports_real_health', !!h1 && h1 === h2 && health.state === 'RUNNING' && health.health!.lastTickAt !== null && health.health!.lastError === null && deriveWorkers(new AgentOpsLog(dir)).workers.get('wz')!.runs.find((r) => r.runId === 'ghost')!.status === 'INTERRUPTED')
  h1!.stop()
  check('S35_stopped_scheduler_health_goes_stale_not_fake_running', readSchedulerHealth(dir, new Date(Date.now() + 120_000)).state === 'STALE' && readSchedulerHealth(tmp()).state === 'UNKNOWN')

  const w = world({ cadence: 5 }); await schedulerTick(w.log, { now: at(5), runners: runners(ok) })
  const snap = buildOpsSnapshot(w.log, at(6))
  const sw = snap.scheduler.workers[0]
  check('S36_read_model_exposes_scheduler_state', snap.scheduler.globalEnabled && sw.enabled && sw.cadenceMinutes === 5 && sw.nextEligibleAt === at(10).toISOString() && sw.lastAutomaticRunAt === at(5).toISOString() && sw.lastClaimAt === at(5).toISOString() && sw.dueSince === null && sw.willRunNext === false && sw.lastDecision.startsWith('RUN') && sw.lastClaimId.startsWith('claim-w0-') && snap.scheduler.eligibleCategories.length === 2)
  const noHealth = snap.scheduler.health
  check('S37_health_unknown_when_no_scheduler_reported_never_assumed', noHealth.state === 'UNKNOWN')
  const vm = buildOpsViewModel({ generatedAt: snap.generatedAt, totals: snap.totals, governance: snap.governance, data: snap })
  const sched = vm.sections.scheduler.rows
  check('S38_ui_scheduler_section_has_pause_cadence_and_disable_controls_no_continuous_mode', sched[0].controls![0].label === 'Pause scheduling' && sched[1].controls!.some((c) => c.label === 'Disable scheduling') && sched[1].controls!.filter((c) => c.label.startsWith('Set every')).length === 4 && !JSON.stringify(sched).toLowerCase().includes('continuous mode:') && sched[0].detail.includes('no continuous mode'))
  check('S39_ui_distinguishes_scheduled_manual_and_recovered_runs', vm.sections.runs.rows.some((r) => r.title.includes('SCHEDULED')) && (await (async () => { await executeWorker(w.log, 'w0', ok, { now: at(7), runId: 'man' }); return buildOpsViewModel({ generatedAt: at(8).toISOString(), totals: snap.totals, governance: snap.governance, data: buildOpsSnapshot(w.log, at(8)) }).sections.runs.rows.some((r) => r.title.includes('MANUAL')) })()) && vm.sections.runs.rows[0].detail.includes('claim-w0-'))
  const api = await handleOpsControl({ action: 'setSchedule', workerId: 'w0', enabled: true, cadenceMinutes: 15, by: 'commander:impostor' }, 'commander:real', w.log, at(9))
  const bad = await handleOpsControl({ action: 'setSchedule', workerId: 'w0', enabled: true, cadenceMinutes: 0 }, C, w.log, at(9))
  const gl = await handleOpsControl({ action: 'setSchedulerGlobal', enabled: false }, C, w.log, at(9))
  const noauth = await handleOpsControl({ action: 'setSchedulerGlobal', enabled: true }, 'agent:x', w.log, at(9))
  check('S40_control_api_schedules_validates_and_requires_commander_session_actor', api.status === 200 && deriveScheduler(w.log).schedules.get('w0')!.by === 'commander:real' && bad.status === 400 && gl.status === 200 && noauth.status === 403 && handleOpsRead(new URL('http://x/?section=summary'), new AgentOpsLog(w.dir, { readOnly: true }), at(10)).status === 200)
  const instr = readFileSync('instrumentation.ts', 'utf8')
  check('S41_boot_hook_is_node_only_skips_build_and_cannot_throw_into_startup', instr.includes("NEXT_RUNTIME !== 'nodejs'") && instr.includes('phase-production-build') && /try \{[\s\S]*\} catch/.test(instr))
}
// ---- review-driven regressions (independent scheduler review)
{
  // MED-1: a pause that lands mid-tick stops further claims
  const w = world({ workers: 2, cadence: 5 })
  const pauser: WorkerRunner = async () => { setSchedulerGlobal(w.log, false, C, 'pause mid-tick', at(5)); return { outputs: [{ kind: 'k', ref: 'r', summary: 'w0 finished' }] } }
  const t = await schedulerTick(w.log, { now: at(5), runners: runners(pauser) })
  check('S42_pause_mid_tick_stops_further_claims_but_not_the_inflight_run', t.ran.length === 1 && t.ran[0].workerId === 'w0' && t.skipped.some((x) => x.workerId === 'w1' && x.reason === 'GLOBAL_DISABLED') && ranCount(w.log, 'w1') === 0)
  // MED-2/3: health honesty
  const dir = tmp()
  const mk = (over: Record<string, unknown>) => { writeFileSync(path.join(dir, 'scheduler-health.json'), JSON.stringify({ instanceId: 'scheduler-x', pid: 1, startedAt: NOW.toISOString(), intervalMs: 30_000, lastTickAt: NOW.toISOString(), lastHeartbeatAt: NOW.toISOString(), busySince: null, lastTickRan: 0, lastError: null, ...over })); return readSchedulerHealth(dir, new Date(NOW.getTime() + 10_000)) }
  check('S43_health_degraded_when_last_tick_failed_and_busy_run_is_not_stale', mk({ lastError: 'boom' }).state === 'DEGRADED' && mk({ lastTickAt: new Date(NOW.getTime() - 600_000).toISOString(), busySince: NOW.toISOString() }).state === 'RUNNING' && mk({ lastTickAt: null, lastHeartbeatAt: null }).state === 'UNKNOWN' && mk({ intervalMs: 'x' as never }).state === 'UNKNOWN' && mk({ lastHeartbeatAt: new Date(NOW.getTime() - 3_600_000).toISOString() }).state === 'STALE')
  // MED-4: real per-run clock when no `now` is injected
  const clk = world({ workers: 2, cadence: 1 })
  const sleepy: WorkerRunner = async () => { await new Promise((r) => setTimeout(r, 400)); return {} }
  const wallStart = Date.now()
  setSchedule(clk.log, 'w0', { enabled: true, cadenceMinutes: 1 }, C, 're-anchor in the past', new Date(wallStart - 120_000)); setSchedule(clk.log, 'w1', { enabled: true, cadenceMinutes: 1 }, C, 're-anchor in the past', new Date(wallStart - 120_000))
  await schedulerTick(clk.log, { runners: runners(sleepy) })
  const rr = ['w0', 'w1'].map((id) => deriveWorkers(clk.log).workers.get(id)!.runs[0])
  check('S44_run_timestamps_use_the_real_clock_not_the_tick_start', rr.every(Boolean) && Date.parse(rr[1].startedAt) - Date.parse(rr[0].startedAt) >= 350 && Date.parse(rr[0].endedAt!) - Date.parse(rr[0].startedAt) >= 350)
  // MED-5: truthful due / next-eligible fields
  const due = world({ cadence: 5 })
  const sDue = buildOpsSnapshot(due.log, at(65)).scheduler.workers[0]
  setSchedulerGlobal(due.log, false, C, 'pause', at(66))
  const sPaused = buildOpsSnapshot(due.log, at(67)).scheduler.workers[0]
  check('S45_due_worker_reports_dueSince_not_a_moving_future_time_and_paused_never_claims_it_will_run', sDue.dueSince === at(5).toISOString() && sDue.nextEligibleAt === at(5).toISOString() && sDue.willRunNext === true && sPaused.willRunNext === false && sPaused.dueSince !== null)
  const pvm = buildOpsViewModel({ generatedAt: at(67).toISOString(), totals: buildOpsSnapshot(due.log, at(67)).totals, governance: buildOpsSnapshot(due.log, at(67)).governance, data: buildOpsSnapshot(due.log, at(67)) })
  check('S46_ui_states_paused_due_worker_will_not_run_and_pause_does_not_stop_inflight', pvm.sections.scheduler.rows[1].detail.includes('will NOT run: scheduling is off') && pvm.sections.scheduler.rows[0].detail.includes('in-flight run finishes'))
  // LOW: caller-supplied oversized/empty instance ids cannot silently kill a worker
  const inst = world({ cadence: 5 })
  const ti = await schedulerTick(inst.log, { now: at(5), instanceId: 'x'.repeat(200) + '!!', runners: runners(ok) })
  check('S47_oversized_instance_id_is_sanitized_claim_stays_valid', ti.ran.length === 1 && deriveScheduler(inst.log).lastClaim.has('w0') && (await schedulerTick(inst.log, { now: at(10), instanceId: '', runners: runners(ok) })).ran.length === 1)
  // LOW: manual RUNNING runs count toward the concurrency cap
  const cap = world({ workers: 3 })
  for (const id of ['w0', 'w1']) cap.log.append({ t: 'run', rid: `run:man-${id}:start`, run: { runId: `man-${id}`, workerId: id, agentId: cap.spec.id, workerVersion: '1', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], startedAt: at(4).toISOString(), status: 'RUNNING', toolsUsed: [], outputs: [], escalations: [], errors: [], executor: 'UNKNOWN', resource: { costUsd: 'UNKNOWN', tokens: 'UNKNOWN' }, requestedEffects: [], origin: 'manual' } })
  const tcap = await schedulerTick(cap.log, { now: at(5), runners: runners(ok) })
  check('S48_manual_runs_count_toward_the_global_concurrency_cap', tcap.skipped.some((x) => x.workerId === 'w2' && x.reason === 'CONCURRENCY_LIMIT'))
}
finish()
