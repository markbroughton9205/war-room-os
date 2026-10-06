/** Phase 10 validation. Run: pnpm run validate:agent-ops */
import { appendFileSync, readFileSync } from 'node:fs'
import { harness, freshOps, fullNeed, draft, activeAgent, NOW, mins, tmp } from './testkit'
import { AgentOpsLog } from './log'
import { AgentRegistry, NeedGateError, deriveAgents } from './registry'
import { AgentTransitionError, assertTransition } from './lifecycle'
import { detectNeed, missingCriteria } from './need'
import { NEED_CRITERIA, type AgentState } from './types'
import { EffectBlockedError, WorkerError, approveEffect, auditCompleteness, deriveWorkers, executeWorker, recoverInterruptedRuns, registerWorker, resumeWorker, stopWorker, type WorkerDraft } from './workers'
import { checkTaskScope, type AgentTask } from './specialization'
import { AdaptationError, applyApprovedScopeChange, decideAdaptation, proposeAdaptation } from './adaptation'

const { check, finish } = harness('AGENT_OPS_VALIDATION')

// ---- P10-A: need gate, lifecycle, durability
{
  const o = freshOps()
  const partial = detectNeed({ title: 'vague idea', evidence: NEED_CRITERIA.slice(0, 5).map((criterion) => ({ criterion, summary: `evidence for ${criterion}`, evidenceRefs: ['r'] })) }, NOW)
  o.reg.recordNeed(partial)
  let gate: NeedGateError | null = null
  try { o.reg.propose(partial.id, draft(), NOW) } catch (e) { gate = e as NeedGateError }
  check('A01_proposal_refused_without_all_seven_criteria', gate instanceof NeedGateError && gate.missing.join() === 'known_escalation_path,failure_drift_review_process' && o.reg.list().length === 0, gate?.message ?? '')
  const thin = detectNeed({ title: 't', evidence: NEED_CRITERIA.map((criterion) => ({ criterion, summary: 'x', evidenceRefs: [] })) }, NOW)
  check('A02_empty_or_ref_less_evidence_does_not_count', missingCriteria(thin).length === 7)

  const need = fullNeed(); o.reg.recordNeed(need)
  const spec = o.reg.propose(need.id, draft(), NOW)
  check('A03_valid_proposal_creates_PROPOSED_agent_with_stable_id', o.reg.get(spec.id)?.state === 'PROPOSED' && spec.id.startsWith('agent-documentation_synthesis-') && spec.version === 1)
  const bad = (d: Parameters<typeof draft>[0]) => { try { o.reg.propose(need.id, draft({ id: 'x-' + Math.random(), ...d }), NOW); return false } catch { return true } }
  check('A04_scope_validation', bad({ permissionScope: [] }) && bad({ permissionScope: ['external_action' as never] }) && bad({ memoryScope: ['everything' as never] }) && bad({ escalationPath: ' ' }) && bad({ specialization: 'vibes' as never }))

  const expectErr = (fn: () => unknown, code: string) => { try { fn(); return false } catch (e) { return e instanceof AgentTransitionError && e.code === code } }
  check('A05_only_commander_approves_and_activates', expectErr(() => o.reg.transition(spec.id, 'APPROVED', 'agent:self', 'self approve', NOW), 'ACTOR_NOT_AUTHORIZED') && expectErr(() => o.reg.transition(spec.id, 'APPROVED', 'system:governor', 'x', NOW), 'ACTOR_NOT_AUTHORIZED') && expectErr(() => o.reg.transition(spec.id, 'APPROVED', 'commander:', 'x', NOW), 'ACTOR_NOT_AUTHORIZED') && o.reg.get(spec.id)!.state === 'PROPOSED')
  check('A06_illegal_transitions_fail_closed_and_write_nothing', expectErr(() => o.reg.transition(spec.id, 'ACTIVE', 'commander:mark', 'skip approval', NOW), 'ILLEGAL_TRANSITION') && expectErr(() => o.reg.transition(spec.id, 'PAUSED', 'commander:mark', 'x', NOW), 'ILLEGAL_TRANSITION') && o.log.view().records.filter((r) => r.t === 'transition').length === 0)
  o.reg.transition(spec.id, 'APPROVED', 'commander:mark', 'ok', NOW)
  o.reg.transition(spec.id, 'ACTIVE', 'commander:mark', 'go', NOW)
  check('A07_system_governor_may_only_make_safer', o.reg.transition(spec.id, 'PAUSED', 'system:governor', 'failure trip', NOW).state === 'PAUSED' && expectErr(() => o.reg.transition(spec.id, 'ACTIVE', 'system:governor', 'self resume', NOW), 'ACTOR_NOT_AUTHORIZED') && o.reg.transition(spec.id, 'ACTIVE', 'commander:mark', 'resume', NOW).state === 'ACTIVE')
  o.reg.transition(spec.id, 'RETIRED', 'commander:mark', 'low value', NOW)
  const states: AgentState[] = ['PROPOSED', 'APPROVED', 'ACTIVE', 'PAUSED', 'UNDER_REVIEW', 'REJECTED', 'RETIRED']
  check('A08_retired_is_terminal_for_every_target', states.every((s) => expectErr(() => assertTransition('RETIRED', s, 'commander:mark'), 'TERMINAL_STATE')) && expectErr(() => o.reg.transition(spec.id, 'ACTIVE', 'commander:mark', 'revive', NOW), 'TERMINAL_STATE'))

  // durability: restart, torn line, duplicates, forged transition
  const dir = o.dir
  const reopened = new AgentRegistry(new AgentOpsLog(dir))
  check('A09_state_survives_restart_with_history', reopened.get(spec.id)?.state === 'RETIRED' && reopened.get(spec.id)!.history.map((h) => h.to).join() === 'APPROVED,ACTIVE,PAUSED,ACTIVE,RETIRED')
  appendFileSync(o.log.file, '{"t":"transition","rid":"torn')
  const forged = JSON.stringify({ t: 'transition', rid: 'forged-1', tr: { agentId: spec.id, from: 'RETIRED', to: 'ACTIVE', by: 'commander:mark', at: NOW.toISOString(), reason: 'forged' } })
  new AgentOpsLog(dir).append({ t: 'need', need: fullNeed('another') }) // append after torn line repairs newline
  appendFileSync(o.log.file, forged + '\n')
  const lines = readFileSync(o.log.file, 'utf8').split('\n').filter(Boolean)
  appendFileSync(o.log.file, lines[1] + '\n') // duplicate record line
  const v = new AgentOpsLog(dir).view()
  const d = deriveAgents(new AgentOpsLog(dir))
  check('A10_torn_duplicate_and_forged_records_are_tolerated', v.corruptLines === 1 && v.duplicateLines === 1 && d.rejectedTransitions === 1 && d.agents.get(spec.id)!.state === 'RETIRED', `corrupt=${v.corruptLines} dup=${v.duplicateLines} rejected=${d.rejectedTransitions}`)
  let secret = false
  try { new AgentOpsLog(tmp()).append({ t: 'need', need: detectNeed({ title: 'sk-abcdefghijklmnopqrstuvwxyz123456', evidence: [] }, NOW) }) } catch { secret = true }
  check('A11_records_with_credentials_are_refused', secret)
  let ro = false
  try { new AgentOpsLog(dir, { readOnly: true }).append({ t: 'need', need: fullNeed('x') }) } catch { ro = true }
  check('A12_read_only_log_refuses_writes', ro)
  const a = activeAgent()
  check('A13_agent_identity_independent_of_provider', !('provider' in a.spec) && !('model' in a.spec) && a.reg.get(a.spec.id)!.state === 'ACTIVE')
}
// ---- P10-B: specialization boundaries, escalation, bounded adaptation
{
  const a = activeAgent()
  const view = () => a.reg.get(a.spec.id)!
  const task = (over: Partial<AgentTask> = {}): AgentTask => ({ title: 't', domain: 'documentation_synthesis', riskClass: 'low', permissions: ['read_docs'], memory: ['docs'], effects: [], ...over })
  check('B01_in_scope_task_accepted', checkTaskScope(view(), task()).verdict === 'IN_SCOPE')
  const off = checkTaskScope(view(), task({ domain: 'financial_review' }))
  check('B02_out_of_domain_escalates_to_known_path', off.verdict === 'ESCALATE' && off.to === 'commander' && off.reasons[0].includes('outside specialization'))
  check('B03_over_risk_escalates', checkTaskScope(view(), task({ riskClass: 'elevated' })).verdict === 'ESCALATE')
  const wide = checkTaskScope(view(), task({ permissions: ['read_repo'], memory: ['project_knowledge'] }))
  check('B04_permission_and_memory_outside_scope_escalate', wide.verdict === 'ESCALATE' && wide.reasons.length === 2)
  check('B05_protected_effects_always_escalate', ['external_action', 'production_change', 'spend', 'external_communication'].every((e) => checkTaskScope(view(), task({ effects: [e as never] })).verdict === 'ESCALATE'))
  const paused = freshOps(); const need = fullNeed(); paused.reg.recordNeed(need); const ps = paused.reg.propose(need.id, draft(), NOW)
  check('B06_non_active_agent_refuses_work', checkTaskScope(paused.reg.get(ps.id)!, task()).verdict === 'REFUSE')
  a.reg.transition(a.spec.id, 'RETIRED', 'commander:mark', 'done', NOW)
  check('B07_retired_agent_refuses_work', checkTaskScope(view(), task()).verdict === 'REFUSE')

  const b = activeAgent()
  const propose = (over: Record<string, unknown>) => proposeAdaptation(b.log, b.spec.id, { kind: 'workflow_change', summary: 'tweak', evidenceRefs: ['run:1'], ...over } as never, NOW)
  const err = (fn: () => unknown, code: string) => { try { fn(); return false } catch (e) { return e instanceof AdaptationError && e.code === code } }
  check('B08_forbidden_adaptations_refused', ['silent_permission_expansion', 'hidden_external_action', 'production_mutation', 'spending', 'external_communication', 'anything_else'].every((k) => err(() => propose({ kind: k }), 'FORBIDDEN_KIND')))
  check('B09_permitted_kinds_are_recommend_only', ['workflow_change', 'narrow_task_classification', 'retrieval_strategy_update', 'weak_tool_flag', 'retire_step'].every((k) => propose({ kind: k }).applied === false))
  check('B10_evidence_required', err(() => propose({ evidenceRefs: [] }), 'INVALID') && err(() => propose({ summary: ' ' }), 'INVALID'))
  check('B11_only_permission_request_may_carry_permissions_and_only_safe_ones', err(() => propose({ requestedPermissions: ['read_repo'] }), 'OUT_OF_BOUNDS') && err(() => propose({ kind: 'permission_change_request', requestedPermissions: ['spend'] }), 'OUT_OF_BOUNDS') && err(() => propose({ kind: 'permission_change_request' }), 'INVALID'))
  const before = b.reg.get(b.spec.id)!.spec
  const req = propose({ kind: 'permission_change_request', requestedPermissions: ['read_repo'], summary: 'needs repo read for triage' })
  check('B12_proposal_alone_changes_nothing', JSON.stringify(b.reg.get(b.spec.id)!.spec) === JSON.stringify(before))
  check('B13_apply_without_approval_refused_and_not_logged', err(() => applyApprovedScopeChange(b.log, req.id, 'commander:mark', NOW), 'NOT_AUTHORIZED') && !b.log.view().records.some((r) => r.t === 'scope'))
  check('B14_only_commander_decides', err(() => decideAdaptation(b.log, req.id, 'APPROVED', 'agent:self', 'x', NOW), 'NOT_AUTHORIZED') && err(() => decideAdaptation(b.log, req.id, 'APPROVED', 'system:governor', 'x', NOW), 'NOT_AUTHORIZED'))
  decideAdaptation(b.log, req.id, 'REJECTED', 'commander:mark', 'not now', NOW)
  check('B15_rejected_request_cannot_be_applied_and_stays_auditable', err(() => applyApprovedScopeChange(b.log, req.id, 'commander:mark', NOW), 'NOT_AUTHORIZED') && b.log.view().records.some((r) => r.t === 'decision' && r.status === 'REJECTED'))
  decideAdaptation(b.log, req.id, 'APPROVED', 'commander:mark', 'ok, scoped', NOW)
  const applied = applyApprovedScopeChange(b.log, req.id, 'commander:mark', NOW)
  check('B16_approved_scope_change_creates_new_version_only_for_requested_scope', applied.spec.version === 2 && applied.spec.permissionScope.includes('read_repo') && applied.spec.permissionScope.length === before.permissionScope.length + 1 && JSON.stringify(applied.spec.memoryScope) === JSON.stringify(before.memoryScope))
  check('B17_scope_change_survives_restart', new AgentRegistry(new AgentOpsLog(b.dir)).get(b.spec.id)!.spec.version === 2)
  // forged scope record (no matching approval) is ignored on replay
  const c = activeAgent()
  c.log.append({ t: 'scope', agentId: c.spec.id, proposalId: 'none', permissionScope: ['read_repo', 'read_docs', 'write_own_reports'], memoryScope: ['docs'], by: 'commander:mark', at: NOW.toISOString() })
  check('B18_forged_scope_record_ignored', c.reg.get(c.spec.id)!.spec.version === 1 && !c.reg.get(c.spec.id)!.spec.permissionScope.includes('read_repo'))
}
// ---- P10-C: workers, runtime governor, run log, stop controls
{
  const wd = (agentId: string, over: Partial<WorkerDraft> = {}): WorkerDraft => ({
    id: 'worker-docs-freshness', agentId, category: 'documentation_freshness', version: '1.0.0', mission: 'Report stale docs',
    permissionScope: ['read_docs'], memoryScope: ['docs'], limits: { maxRuntimeMs: 2000, maxRunsPerDay: 5, maxConsecutiveFailures: 2, cadenceMinutes: 60 }, ...over,
  })
  const ok = async () => ({ outputs: [{ kind: 'report', ref: 'docs/report', summary: '3 stale docs' }], toolsUsed: ['fs.stat'] })
  const werr = (fn: () => unknown, code: string) => { try { fn(); return false } catch (e) { return e instanceof WorkerError && e.code === code } }

  const a = activeAgent()
  check('C01_register_requires_commander_and_bounded_scope', werr(() => registerWorker(a.log, wd(a.spec.id), 'agent:x', NOW), 'NOT_AUTHORIZED') && werr(() => registerWorker(a.log, wd(a.spec.id, { permissionScope: ['read_repo'] }), 'commander:mark', NOW), 'INVALID') && werr(() => registerWorker(a.log, wd(a.spec.id, { limits: { maxRuntimeMs: 99_999_999, maxRunsPerDay: 5, maxConsecutiveFailures: 2, cadenceMinutes: null } }), 'commander:mark', NOW), 'LIMIT_EXCEEDED') && werr(() => registerWorker(a.log, wd(a.spec.id, { category: 'vibes' as never }), 'commander:mark', NOW), 'INVALID'))
  const pend = freshOps(); const n = fullNeed(); pend.reg.recordNeed(n); const ps = pend.reg.propose(n.id, draft(), NOW)
  check('C02_worker_needs_an_approved_agent', werr(() => registerWorker(pend.log, wd(ps.id), 'commander:mark', NOW), 'AGENT_NOT_ELIGIBLE'))
  registerWorker(a.log, wd(a.spec.id), 'commander:mark', NOW)
  check('C03_duplicate_worker_id_refused', werr(() => registerWorker(a.log, wd(a.spec.id), 'commander:mark', NOW), 'INVALID'))

  const r1 = await executeWorker(a.log, 'worker-docs-freshness', ok, { now: NOW, runId: 'run-1' })
  const run1 = r1.ok ? r1.run : null
  check('C04_run_records_every_roadmap_field', !!run1 && run1.status === 'SUCCEEDED' && auditCompleteness(run1).complete && run1.workerVersion === '1.0.0' && run1.mission === 'Report stale docs' && run1.permissionScope.join() === 'read_docs' && run1.memoryScope.join() === 'docs' && run1.toolsUsed[0] === 'fs.stat' && run1.outputs.length === 1 && Array.isArray(run1.escalations) && Array.isArray(run1.errors), JSON.stringify(auditCompleteness(run1!)))
  check('C05_cost_tokens_and_executor_stay_UNKNOWN', run1!.resource.costUsd === 'UNKNOWN' && run1!.resource.tokens === 'UNKNOWN' && run1!.executor === 'UNKNOWN' && typeof run1!.resource.durationMs === 'number')
  const withModel = await executeWorker(a.log, 'worker-docs-freshness', async () => ({ executor: { provider: 'ollama', model: 'qwen2.5-coder:14b' }, resource: { costUsd: 0, tokens: 1200 } }), { now: NOW, runId: 'run-2' })
  check('C06_actual_executor_and_reported_cost_recorded_as_given', withModel.ok && withModel.run.executor !== 'UNKNOWN' && (withModel.run.executor as { model: string }).model === 'qwen2.5-coder:14b' && withModel.run.resource.costUsd === 0 && withModel.run.resource.tokens === 1200)

  const slow = await executeWorker(a.log, 'worker-docs-freshness', () => new Promise((r) => setTimeout(() => r({}), 4000)), { now: NOW, runId: 'run-3' })
  check('C07_runtime_limit_enforced', slow.ok && slow.run.status === 'TIMED_OUT' && slow.run.errors[0].message.includes('2000ms'))
  // daily cap (limit 5): runs 1,2,3 so far + 2 more
  await executeWorker(a.log, 'worker-docs-freshness', ok, { now: NOW, runId: 'run-4' }); await executeWorker(a.log, 'worker-docs-freshness', ok, { now: NOW, runId: 'run-5' })
  const capped = await executeWorker(a.log, 'worker-docs-freshness', ok, { now: NOW, runId: 'run-6' })
  check('C08_daily_cap_enforced', !capped.ok && capped.reason === 'DAILY_CAP_REACHED')
  const nextDay = await executeWorker(a.log, 'worker-docs-freshness', ok, { now: new Date(NOW.getTime() + 86_400_000), runId: 'run-7' })
  check('C09_cap_resets_next_utc_day', nextDay.ok)

  // failure trip + resume
  const f = activeAgent(); registerWorker(f.log, wd(f.spec.id), 'commander:mark', NOW)
  const boom = async () => { throw new Error('disk exploded with token=abcdefgh12345678') }
  const f1 = await executeWorker(f.log, 'worker-docs-freshness', boom, { now: NOW, runId: 'f1' })
  check('C10_failure_recorded_scrubbed_not_thrown', f1.ok && f1.run.status === 'FAILED' && !JSON.stringify(f1.run).includes('abcdefgh12345678') && f1.run.errors[0].recovery.length > 0)
  await executeWorker(f.log, 'worker-docs-freshness', boom, { now: NOW, runId: 'f2' })
  check('C11_consecutive_failures_trip_agent_to_PAUSED_by_system', f.reg.get(f.spec.id)!.state === 'PAUSED' && f.reg.get(f.spec.id)!.history.at(-1)!.by === 'system:governor')
  const afterTrip = await executeWorker(f.log, 'worker-docs-freshness', ok, { now: NOW, runId: 'f3' })
  check('C12_paused_agent_cannot_run_workers', !afterTrip.ok && afterTrip.reason === 'AGENT_NOT_ACTIVE')
  f.reg.transition(f.spec.id, 'ACTIVE', 'commander:mark', 'reviewed failures', NOW)
  const stillTripped = await executeWorker(f.log, 'worker-docs-freshness', ok, { now: NOW, runId: 'f4' })
  check('C13_resuming_agent_alone_does_not_clear_the_trip', !stillTripped.ok && stillTripped.reason === 'TRIPPED')
  check('C14_only_commander_resumes_worker', werr(() => resumeWorker(f.log, 'worker-docs-freshness', 'system:governor', 'x', NOW), 'NOT_AUTHORIZED'))
  resumeWorker(f.log, 'worker-docs-freshness', 'commander:mark', 'fixed disk', NOW)
  const recovered = await executeWorker(f.log, 'worker-docs-freshness', ok, { now: NOW, runId: 'f5' })
  check('C15_commander_resume_clears_trip', recovered.ok && recovered.run.status === 'SUCCEEDED' && deriveWorkers(f.log).workers.get('worker-docs-freshness')!.consecutiveFailures === 0)

  // stop controls
  const s = activeAgent(); registerWorker(s.log, wd(s.spec.id), 'commander:mark', NOW)
  stopWorker(s.log, 'worker-docs-freshness', 'commander:mark', 'operator stop', NOW)
  const refused = await executeWorker(s.log, 'worker-docs-freshness', ok, { now: NOW, runId: 's1' })
  const restarted = deriveWorkers(new AgentOpsLog(s.dir)).workers.get('worker-docs-freshness')!
  check('C16_stop_halts_new_runs_and_persists', !refused.ok && refused.reason === 'STOPPED' && restarted.stopped && restarted.stopReason === 'operator stop')
  resumeWorker(s.log, 'worker-docs-freshness', 'commander:mark', 'ok', NOW)
  const midStop = await executeWorker(s.log, 'worker-docs-freshness', async (ctx) => { stopWorker(s.log, 'worker-docs-freshness', 'commander:mark', 'stop mid-run', NOW); return { outputs: [{ kind: 'k', ref: 'r', summary: ctx.shouldStop() ? 'saw stop' : 'no stop' }] } }, { now: NOW, runId: 's2' })
  check('C17_stop_during_run_is_observed_and_recorded', midStop.ok && midStop.run.status === 'STOPPED' && midStop.run.outputs[0].summary === 'saw stop')

  // protected effects
  const e = activeAgent(); registerWorker(e.log, wd(e.spec.id), 'commander:mark', NOW)
  const blocked = await executeWorker(e.log, 'worker-docs-freshness', async (ctx) => { ctx.requestEffect('external_communication'); return {} }, { now: NOW, runId: 'e1' })
  check('C18_unapproved_protected_effect_blocked_and_escalated_not_failed', blocked.ok && blocked.run.status === 'BLOCKED' && blocked.run.escalations[0].to === 'commander' && blocked.run.requestedEffects.join() === 'external_communication' && deriveWorkers(e.log).workers.get('worker-docs-freshness')!.consecutiveFailures === 0)
  check('C19_effect_approval_requires_commander', werr(() => approveEffect(e.log, 'worker-docs-freshness', ['spend'], 'agent:self', 'x', NOW), 'NOT_AUTHORIZED') && werr(() => approveEffect(e.log, 'worker-docs-freshness', ['launch_missiles' as never], 'commander:mark', 'x', NOW), 'INVALID'))
  const appr = approveEffect(e.log, 'worker-docs-freshness', ['external_communication'], 'commander:mark', 'one notification', NOW)
  const allowed = await executeWorker(e.log, 'worker-docs-freshness', async (ctx) => { ctx.requestEffect('external_communication'); return {} }, { now: NOW, runId: 'e2', approvalRid: appr.rid })
  const reused = await executeWorker(e.log, 'worker-docs-freshness', async (ctx) => { ctx.requestEffect('external_communication'); return {} }, { now: NOW, runId: 'e3', approvalRid: appr.rid })
  const wrongEffect = await executeWorker(e.log, 'worker-docs-freshness', async (ctx) => { ctx.requestEffect('spend'); return {} }, { now: NOW, runId: 'e4', approvalRid: appr.rid })
  check('C20_approval_is_single_use_and_effect_specific', allowed.ok && allowed.run.status === 'SUCCEEDED' && allowed.run.approvalRef === appr.rid && reused.ok && reused.run.status === 'BLOCKED' && wrongEffect.ok && wrongEffect.run.status === 'BLOCKED')
  const pre = activeAgent(); registerWorker(pre.log, wd(pre.spec.id, { preApprovedEffects: ['external_communication'] }), 'commander:mark', NOW)
  const preRun = await executeWorker(pre.log, 'worker-docs-freshness', async (ctx) => { ctx.requestEffect('external_communication'); ctx.requestEffect('spend'); return {} }, { now: NOW, runId: 'p1' })
  check('C21_narrow_preapproved_policy_honored_but_only_for_listed_effects', preRun.ok && preRun.run.status === 'BLOCKED' && preRun.run.requestedEffects.join() === 'external_communication,spend')

  // secrets, crash recovery, idempotence
  const x = activeAgent(); registerWorker(x.log, wd(x.spec.id), 'commander:mark', NOW)
  const leak = await executeWorker(x.log, 'worker-docs-freshness', async () => ({ outputs: [{ kind: 'k', ref: 'r', summary: 'key sk-abcdefghijklmnopqrstuvwxyz123456 found' }] }), { now: NOW, runId: 'x1' })
  check('C22_credential_in_output_is_redacted_run_still_recorded', leak.ok && leak.run.outputs[0].summary.includes('[REDACTED]') && !readFileSync(x.log.file, 'utf8').includes('abcdefghijklmnopqrstuvwxyz1234'))
  x.log.append({ t: 'run', rid: 'run:crash:start', run: { runId: 'crash', workerId: 'worker-docs-freshness', agentId: x.spec.id, workerVersion: '1.0.0', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], startedAt: NOW.toISOString(), status: 'RUNNING', toolsUsed: [], outputs: [], escalations: [], errors: [], executor: 'UNKNOWN', resource: { costUsd: 'UNKNOWN', tokens: 'UNKNOWN' }, requestedEffects: [] } })
  const blockedByGhost = await executeWorker(x.log, 'worker-docs-freshness', ok, { now: mins(0), runId: 'x2' })
  const sizeBefore = readFileSync(x.log.file, 'utf8').length
  const early = recoverInterruptedRuns(x.log, mins(0))
  const rec1 = recoverInterruptedRuns(x.log, mins(10))
  const bytes = readFileSync(x.log.file, 'utf8')
  const rec2 = recoverInterruptedRuns(x.log, mins(20))
  check('C23_running_run_blocks_second_run_until_recovered', !blockedByGhost.ok && blockedByGhost.reason === 'ALREADY_RUNNING' && early.length === 0 && rec1.join() === 'crash')
  check('C24_recovery_idempotent_append_only_and_marks_INTERRUPTED', rec2.length === 0 && readFileSync(x.log.file, 'utf8') === bytes && bytes.startsWith(readFileSync(x.log.file, 'utf8').slice(0, sizeBefore)) && deriveWorkers(x.log).workers.get('worker-docs-freshness')!.runs.find((r) => r.runId === 'crash')!.status === 'INTERRUPTED')
  const after = await executeWorker(x.log, 'worker-docs-freshness', ok, { now: mins(10), runId: 'x3' })
  check('C25_worker_runs_again_after_recovery', after.ok && after.run.status === 'SUCCEEDED')
  // retired agent
  const rt = activeAgent(); registerWorker(rt.log, wd(rt.spec.id), 'commander:mark', NOW); rt.reg.transition(rt.spec.id, 'RETIRED', 'commander:mark', 'obsolete', NOW)
  const dead = await executeWorker(rt.log, 'worker-docs-freshness', ok, { now: NOW, runId: 'rt1' })
  check('C26_retired_agent_workers_never_run', !dead.ok && dead.reason === 'AGENT_NOT_ACTIVE')
  void EffectBlockedError
}
finish()
