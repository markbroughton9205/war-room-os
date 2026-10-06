/** Phase 10 validation. Run: pnpm run validate:agent-ops */
import { appendFileSync, readFileSync } from 'node:fs'
import { harness, freshOps, fullNeed, draft, activeAgent, NOW, mins, tmp } from './testkit'
import { AgentOpsLog } from './log'
import { AgentRegistry, NeedGateError, deriveAgents } from './registry'
import { AgentTransitionError, assertTransition } from './lifecycle'
import { detectNeed, missingCriteria } from './need'
import { NEED_CRITERIA, type AgentState } from './types'
import { EffectBlockedError, WorkerError, approveEffect, auditCompleteness, deriveWorkers, executeWorker, recoverInterruptedRuns, registerWorker, resumeWorker, stopWorker, type WorkerDraft } from './workers'
import { FeedbackError, evaluateAgent, executorEvidence, recommendForAgent, recordFeedback } from './evaluation'
import { freshLog as p9Log, ev as p9Ev } from '@/lib/recursive-learning/testkit'
import { scoreMatrix } from '@/lib/recursive-learning/scoring'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { documentationFreshnessRunner } from './builtinWorkers'
import { handleOpsControl } from './api'
import { MAX_RECORD_BYTES } from './log'
import { buildOpsSnapshot } from './readModel'
import { buildOpsViewModel } from './uiState'
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
  const appr2 = approveEffect(e.log, 'worker-docs-freshness', ['external_communication'], 'commander:mark', 'second', NOW)
  const wrongEffect = await executeWorker(e.log, 'worker-docs-freshness', async (ctx) => { ctx.requestEffect('spend'); return {} }, { now: NOW, runId: 'e4', approvalRid: appr2.rid })
  check('C20_approval_authorizes_one_run_and_only_its_effects', allowed.ok && allowed.run.status === 'SUCCEEDED' && allowed.run.approvalRef === appr.rid && !reused.ok && reused.reason === 'APPROVAL_INVALID' && wrongEffect.ok && wrongEffect.run.status === 'BLOCKED')
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
// ---- P10-D: evaluation, recommendations, Phase 9 consumption
{
  const mk = (specialization: 'documentation_synthesis' | 'codebase_triage' = 'documentation_synthesis') => {
    const o = activeAgent({ specialization })
    registerWorker(o.log, { id: 'w', agentId: o.spec.id, category: 'documentation_freshness', version: '1', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], limits: { maxRuntimeMs: 1000, maxRunsPerDay: 500, maxConsecutiveFailures: 10, cadenceMinutes: null } }, 'commander:mark', NOW)
    return o
  }
  let seq = 0
  const run = (o: ReturnType<typeof mk>, outcome: 'ok' | 'fail' | 'block', extra: Record<string, unknown> = {}) => executeWorker(o.log, 'w', async (ctx) => { if (outcome === 'fail') throw new Error('x'); if (outcome === 'block') ctx.requestEffect('spend'); return extra }, { now: NOW, runId: `d-${++seq}` })
  const empty = mk()
  const e0 = evaluateAgent(empty.log, empty.spec.id, NOW)
  check('D01_no_evidence_is_UNKNOWN_never_zero', e0.runs.total === 0 && Object.values(e0.dimensions).every((v) => v === 'UNKNOWN'), JSON.stringify(e0.dimensions))
  const m = mk()
  for (let i = 0; i < 6; i++) await run(m, 'ok')
  for (let i = 0; i < 2; i++) await run(m, 'fail')
  for (let i = 0; i < 3; i++) await run(m, 'block')
  const em = evaluateAgent(m.log, m.spec.id, NOW)
  check('D02_success_rate_excludes_blocked_stopped_interrupted', em.runs.terminal === 8 && em.runs.blocked === 3 && em.dimensions.taskSuccessRate === 6 / 8 && em.dimensions.failureRate === 2 / 8 && em.blockedEffectAttempts === 3)
  check('D03_cost_unknown_when_unreported_latency_known', em.dimensions.meanCostUsd === 'UNKNOWN' && typeof em.dimensions.meanLatencyMs === 'number' && em.dimensions.auditCompleteness === 1 && em.dimensions.approvalDoctrineCompliance === 1)
  await run(m, 'ok', { resource: { costUsd: 0.5 } }); await run(m, 'ok', { resource: { costUsd: 1.5 } })
  check('D04_mean_cost_over_reporters_only', evaluateAgent(m.log, m.spec.id, NOW).dimensions.meanCostUsd === 1)
  const r0 = recommendForAgent(freshOps().log, 'nobody', NOW)
  const rThin = recommendForAgent(empty.log, empty.spec.id, NOW)
  check('D05_insufficient_evidence_never_recommends_action', r0.action === 'none' && rThin.action === 'none' && rThin.reasons[0].startsWith('INSUFFICIENT_EVIDENCE'))

  const bad = mk(); for (let i = 0; i < 6; i++) { await run(bad, 'fail'); await run(bad, 'ok') }
  const bad2 = mk(); for (let i = 0; i < 9; i++) { await run(bad2, 'fail'); if (i < 2) await run(bad2, 'ok') }
  const retrain = recommendForAgent(bad.log, bad.spec.id, NOW)
  const retire = recommendForAgent(bad2.log, bad2.spec.id, NOW)
  check('D06_underperformers_get_retrain_or_retire_recommendation', retrain.action === 'retrain' && retire.action === 'retire', `${retrain.action}/${retire.action}`)
  const stateBefore = bad2.reg.get(bad2.spec.id)!.state
  const persisted = recommendForAgent(bad2.log, bad2.spec.id, NOW, { persist: true })
  check('D07_recommendation_is_not_applied_and_agent_state_unchanged', persisted.applied === false && bad2.reg.get(bad2.spec.id)!.state === stateBefore && stateBefore === 'ACTIVE' && bad2.log.view().records.some((r) => r.t === 'recommendation'))
  recommendForAgent(bad2.log, bad2.spec.id, NOW, { flagForReview: true })
  check('D08_flag_for_review_is_opt_in_and_only_parks_to_UNDER_REVIEW_by_system', bad2.reg.get(bad2.spec.id)!.state === 'UNDER_REVIEW' && bad2.reg.get(bad2.spec.id)!.history.at(-1)!.by === 'system:evaluator' && (await run(bad2, 'ok')).ok === false)

  const c = mk(); for (let i = 0; i < 10; i++) await run(c, 'ok')
  const runIds = evaluateAgent(c.log, c.spec.id, NOW).evidenceRunIds
  let fbErr = 0
  for (const fn of [() => recordFeedback(c.log, runIds[0], 'accepted', 'agent:x', 'n', {}, NOW), () => recordFeedback(c.log, 'nope', 'accepted', 'commander:mark', 'n', {}, NOW), () => recordFeedback(c.log, runIds[0], 'meh' as never, 'commander:mark', 'n', {}, NOW)]) { try { fn() } catch (e) { if (e instanceof FeedbackError) fbErr += 1 } }
  check('D09_feedback_requires_commander_known_finished_run', fbErr === 3)
  for (let i = 0; i < 4; i++) recordFeedback(c.log, runIds[i], 'corrected', 'commander:mark', 'wrong', {}, NOW)
  check('D10_correction_rate_unknown_until_enough_reviewed_then_narrow', evaluateAgent(c.log, c.spec.id, NOW).dimensions.commanderCorrectionRate === 1 && recommendForAgent(c.log, c.spec.id, NOW).action === 'none')
  for (let i = 4; i < 6; i++) recordFeedback(c.log, runIds[i], 'accepted', 'commander:mark', 'fine', {}, NOW)
  const narrowed = recommendForAgent(c.log, c.spec.id, NOW)
  check('D11_high_correction_rate_recommends_narrowing', narrowed.action === 'narrow' && evaluateAgent(c.log, c.spec.id, NOW).dimensions.accuracy === 2 / 6)
  recordFeedback(c.log, runIds[0], 'accepted', 'commander:mark', 'on reflection ok', {}, NOW)
  check('D12_latest_feedback_wins', evaluateAgent(c.log, c.spec.id, NOW).dimensions.commanderCorrectionRate === 3 / 6)
  // approval doctrine violation injected (cannot occur through the governor): detected
  c.log.append({ t: 'run', rid: 'run:viol:start', run: { ...{ runId: 'viol', workerId: 'w', agentId: c.spec.id, workerVersion: '1', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], startedAt: NOW.toISOString(), endedAt: NOW.toISOString(), status: 'SUCCEEDED', toolsUsed: [], outputs: [], escalations: [], errors: [], executor: 'UNKNOWN', resource: { durationMs: 1, costUsd: 'UNKNOWN', tokens: 'UNKNOWN' }, requestedEffects: ['spend'] } } as never })
  const viol = evaluateAgent(c.log, c.spec.id, NOW)
  check('D13_approval_doctrine_violation_is_detected_and_recommends_retire', (viol.dimensions.approvalDoctrineCompliance as number) < 1 && recommendForAgent(c.log, c.spec.id, NOW).action === 'retire')

  // merge candidate
  const two = freshOps(); const dr = (id: string) => { const nd = fullNeed(`n-${id}`); two.reg.recordNeed(nd); const sp = two.reg.propose(nd.id, draft({ id, specialization: 'codebase_triage', permissionScope: ['read_docs', 'write_own_reports'] }), NOW); two.reg.transition(sp.id, 'APPROVED', 'commander:mark', 'a', NOW); two.reg.transition(sp.id, 'ACTIVE', 'commander:mark', 'a', NOW); registerWorker(two.log, { id: `w-${id}`, agentId: sp.id, category: 'incident_watch', version: '1', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], limits: { maxRuntimeMs: 1000, maxRunsPerDay: 500, maxConsecutiveFailures: 10, cadenceMinutes: null } }, 'commander:mark', NOW) }
  dr('big'); dr('small')
  for (let i = 0; i < 12; i++) await executeWorker(two.log, 'w-big', async () => ({}), { now: NOW, runId: `mb-${i}` })
  for (let i = 0; i < 2; i++) await executeWorker(two.log, 'w-small', async () => ({}), { now: NOW, runId: `ms-${i}` })
  const lone = freshOps(); void lone
  check('D14_overlapping_low_usage_agent_gets_merge_recommendation', recommendForAgent(two.log, 'small', NOW).action === 'merge' && recommendForAgent(two.log, 'big', NOW).action === 'none')
  const one = freshOps(); const nb = fullNeed('b'); one.reg.recordNeed(nb); const bg = one.reg.propose(nb.id, draft({ id: 'big2', specialization: 'codebase_triage' }), NOW); one.reg.transition(bg.id, 'APPROVED', 'commander:mark', 'a', NOW); one.reg.transition(bg.id, 'ACTIVE', 'commander:mark', 'a', NOW)
  registerWorker(one.log, { id: 'wb', agentId: bg.id, category: 'incident_watch', version: '1', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], limits: { maxRuntimeMs: 1000, maxRunsPerDay: 500, maxConsecutiveFailures: 10, cadenceMinutes: null } }, 'commander:mark', NOW)
  for (let i = 0; i < 12; i++) await executeWorker(one.log, 'wb', async () => ({}), { now: NOW, runId: `ob-${i}` })
  const ns = fullNeed('s'); one.reg.recordNeed(ns); const sm = one.reg.propose(ns.id, draft({ id: 'small2', specialization: 'codebase_triage' }), NOW); one.reg.transition(sm.id, 'APPROVED', 'commander:mark', 'a', NOW); one.reg.transition(sm.id, 'ACTIVE', 'commander:mark', 'a', NOW)
  registerWorker(one.log, { id: 'ws', agentId: sm.id, category: 'incident_watch', version: '1', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], limits: { maxRuntimeMs: 1000, maxRunsPerDay: 500, maxConsecutiveFailures: 10, cadenceMinutes: null } }, 'commander:mark', NOW)
  for (let i = 0; i < 10; i++) await executeWorker(one.log, 'ws', async () => ({}), { now: NOW, runId: `os-${i}` })
  check('D15_no_merge_when_both_agents_have_real_usage', recommendForAgent(one.log, 'small2', NOW).action === 'none')

  // Phase 9 consumption
  const p9 = p9Log()
  for (let i = 1; i <= 6; i++) p9.recordEvent(p9Ev('ollama', 'code_modification', 'SUCCESS', i), NOW)
  const cards = scoreMatrix(p9.view().activeEvents, NOW)
  const k = mk(); await run(k, 'ok', { executor: { provider: 'ollama', model: 'qwen2.5-coder:14b' } }); await run(k, 'ok')
  const p9Before = readFileSync(p9.file, 'utf8')
  const evd = executorEvidence(k.log, k.spec.id, cards)
  const recA = recommendForAgent(k.log, k.spec.id, NOW)
  const recB = (() => { const r = recommendForAgent(k.log, k.spec.id, NOW); return r })()
  check('D16_phase9_evidence_attached_for_actual_executor_only', evd.length === 1 && evd[0].executor === 'ollama/qwen2.5-coder:14b' && evd[0].runCount === 1 && evd[0].phase9.length >= 1 && evd[0].phase9[0].samples === 6)
  check('D17_phase9_is_read_only_and_does_not_change_recommendations', readFileSync(p9.file, 'utf8') === p9Before && recA.action === recB.action && recA.action === 'none')
  const restartedEval = evaluateAgent(new AgentOpsLog(m.dir), m.spec.id, NOW)
  check('D18_evaluation_identical_after_restart', JSON.stringify({ ...restartedEval, generatedAt: 0 }) === JSON.stringify({ ...evaluateAgent(m.log, m.spec.id, NOW), generatedAt: 0 }))
}
// ---- Review-driven regression tests (independent review of P10-A..G)
{
  const W = (agentId: string, over: Record<string, unknown> = {}) => ({ id: 'rw', agentId, category: 'incident_watch' as const, version: '1', mission: 'm', permissionScope: ['read_docs' as const], memoryScope: ['docs' as const], limits: { maxRuntimeMs: 100, maxRunsPerDay: 500, maxConsecutiveFailures: 5, cadenceMinutes: null }, ...over })
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  // HIGH-1: effects after timeout / stop / finish are denied
  const a = activeAgent(); registerWorker(a.log, W(a.spec.id), 'commander:mark', NOW)
  let late = 'untouched'
  const t = await executeWorker(a.log, 'rw', async (ctx) => { await sleep(300); try { ctx.requestEffect('spend'); late = 'allowed' } catch (e) { late = e instanceof EffectBlockedError ? 'denied' : 'other' } return {} }, { now: NOW, runId: 'r-t' })
  await sleep(450)
  check('R01_effect_after_timeout_is_denied', t.ok && t.run.status === 'TIMED_OUT' && late === 'denied', late)
  const b = activeAgent(); registerWorker(b.log, W(b.spec.id, { limits: { maxRuntimeMs: 3000, maxRunsPerDay: 50, maxConsecutiveFailures: 5, cadenceMinutes: null } }), 'commander:mark', NOW)
  let lateStop = 'untouched'
  await executeWorker(b.log, 'rw', async (ctx) => { stopWorker(b.log, 'rw', 'commander:mark', 'stop', NOW); try { ctx.requestEffect('spend'); lateStop = 'allowed' } catch { lateStop = 'denied' } return {} }, { now: NOW, runId: 'r-s' })
  check('R02_effect_after_stop_is_denied', lateStop === 'denied')
  // HIGH-2: real cross-process race (3 OS processes, one spend approval, one shared start instant)
  const r = activeAgent(); registerWorker(r.log, W(r.spec.id, { limits: { maxRuntimeMs: 5000, maxRunsPerDay: 50, maxConsecutiveFailures: 5, cadenceMinutes: null } }), 'commander:mark', NOW)
  const ap = approveEffect(r.log, 'rw', ['spend'], 'commander:mark', 'one run', NOW)
  const barrier = String(Date.now() + 1500)
  const run = promisify(execFile)
  const outs = await Promise.all(['a', 'b', 'c'].map((tag) => run('node', ['--loader', './scripts/ts-extension-loader.mjs', '--experimental-transform-types', 'lib/agents/ops/race.child.validation.ts', r.dir, 'rw', ap.rid, barrier, tag]).then((o) => JSON.parse(o.stdout.trim().split('\n').pop()!))))
  const okCount = outs.filter((o) => o.ok).length
  const rv = new AgentOpsLog(r.dir).view()
  check('R03_cross_process_race_one_run_one_approval_use', okCount === 1 && outs.filter((o) => !o.ok && ['ALREADY_RUNNING', 'APPROVAL_INVALID'].includes(o.reason)).length === 2 && rv.records.filter((x) => x.t === 'run' && x.rid.endsWith(':start')).length === 1, JSON.stringify(outs))
  // HIGH-4: run id collision refused
  const c = activeAgent(); registerWorker(c.log, W(c.spec.id), 'commander:mark', NOW)
  await executeWorker(c.log, 'rw', async () => ({}), { now: NOW, runId: 'same' })
  const second = await executeWorker(c.log, 'rw', async () => { throw new Error('should not run') }, { now: NOW, runId: 'same' })
  check('R04_runid_collision_refused_runner_not_executed', !second.ok && second.reason === 'RUN_ID_EXISTS')
  // HIGH-5: secret / malformed output never leaves the worker stuck
  const d = activeAgent(); registerWorker(d.log, W(d.spec.id), 'commander:mark', NOW)
  const f1 = await executeWorker(d.log, 'rw', async () => ({ executor: { provider: 'sk-abcdefghijklmnopqrstuvwxyz123456', model: 'm' } }), { now: NOW, runId: 'f1' })
  const f2 = await executeWorker(d.log, 'rw', async () => ({ outputs: [null as never] }), { now: NOW, runId: 'f2' })
  const f3 = await executeWorker(d.log, 'rw', async () => ({ resource: { costUsd: -5, tokens: NaN } }), { now: NOW, runId: 'f3' })
  check('R05_malformed_or_secret_result_is_recorded_not_stuck', f1.ok && f1.run.status !== 'RUNNING' && f2.ok && f2.run.status !== 'RUNNING' && !deriveWorkers(d.log).workers.get('rw')!.running && !readFileSync(d.log.file, 'utf8').includes('abcdefghijklmnopqrstuvwxyz1234'))
  check('R06_negative_or_nan_cost_is_UNKNOWN', f3.ok && f3.run.resource.costUsd === 'UNKNOWN' && f3.run.resource.tokens === 'UNKNOWN')
  // HIGH-3: pre-approved policy is not a violation; honest label
  const g = activeAgent(); registerWorker(g.log, W(g.spec.id, { preApprovedEffects: ['external_communication'], limits: { maxRuntimeMs: 1000, maxRunsPerDay: 500, maxConsecutiveFailures: 5, cadenceMinutes: null } }), 'commander:mark', NOW)
  for (let i = 0; i < 10; i++) await executeWorker(g.log, 'rw', async (ctx) => { ctx.requestEffect('external_communication'); return {} }, { now: NOW, runId: `pa-${i}` })
  const gev = evaluateAgent(g.log, g.spec.id, NOW)
  check('R07_preapproved_effects_are_not_flagged_as_violations', gev.dimensions.approvalDoctrineCompliance === 1 && recommendForAgent(g.log, g.spec.id, NOW).action === 'none' && gev.notes.some((n) => n.includes('DECLARED effects only')))

  // MED-1: replay hardening
  const h = activeAgent()
  h.log.append({ t: 'agent', agent: { ...h.spec, id: 'agent-forged', needId: 'no-need' } })
  const need2 = fullNeed('thin'); need2.evidence.pop(); h.reg.recordNeed(need2)
  h.log.append({ t: 'agent', agent: { ...h.spec, id: 'agent-forged2', needId: need2.id } })
  check('R08_forged_agent_without_evidenced_need_is_not_an_agent', !deriveAgents(h.log).agents.has('agent-forged') && !deriveAgents(h.log).agents.has('agent-forged2'))
  const prop = proposeAdaptation(h.log, h.spec.id, { kind: 'permission_change_request', summary: 'repo read', evidenceRefs: ['r'], requestedPermissions: ['read_repo'] }, NOW)
  h.log.append({ t: 'adaptation', proposal: { ...prop, requestedPermissions: ['read_repo', 'read_mission_records'], requestedMemory: ['mission_state'] } as never })
  check('R09_adaptation_proposal_cannot_be_rewritten', h.log.view().records.filter((x) => x.t === 'adaptation').length >= 1)
  decideAdaptation(h.log, prop.id, 'APPROVED', 'commander:mark', 'ok', NOW)
  h.log.append({ t: 'scope', agentId: h.spec.id, proposalId: prop.id, permissionScope: ['read_docs', 'write_own_reports', 'read_repo', 'read_mission_records'], memoryScope: ['docs', 'agent_operational', 'mission_state'], by: 'commander:mark', at: NOW.toISOString() })
  const forgedScope = h.reg.get(h.spec.id)!.spec
  check('R10_forged_scope_beyond_approved_request_ignored', forgedScope.version === 1 && !forgedScope.permissionScope.includes('read_mission_records'))
  const once = applyApprovedScopeChange(h.log, prop.id, 'commander:mark', NOW)
  let twice = false
  try { applyApprovedScopeChange(h.log, prop.id, 'commander:mark', NOW) } catch { twice = true }
  check('R11_scope_apply_is_once_per_proposal', once.spec.version === 2 && twice && h.reg.get(h.spec.id)!.spec.version === 2)
  h.log.append({ t: 'worker', worker: { ...W(h.spec.id, { id: 'forged-w', limits: { maxRuntimeMs: 99_999_999, maxRunsPerDay: 5, maxConsecutiveFailures: 2, cadenceMinutes: null } }), preApprovedEffects: [], createdAt: NOW.toISOString() }, approvedBy: 'commander:mark' })
  h.log.append({ t: 'worker', worker: { ...W(h.spec.id, { id: 'forged-w2', permissionScope: ['read_mission_records'] }), preApprovedEffects: ['spend'] as never, createdAt: NOW.toISOString() }, approvedBy: 'commander:mark' })
  check('R12_forged_workers_beyond_limits_scope_or_effects_are_inert', !deriveWorkers(h.log).workers.has('forged-w') && !deriveWorkers(h.log).workers.has('forged-w2'))
  // MED-3: a late end record cannot override interrupted
  const i = activeAgent(); registerWorker(i.log, W(i.spec.id), 'commander:mark', NOW)
  i.log.append({ t: 'run', rid: 'run:z:start', run: { runId: 'z', workerId: 'rw', agentId: i.spec.id, workerVersion: '1', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], startedAt: NOW.toISOString(), status: 'RUNNING', toolsUsed: [], outputs: [], escalations: [], errors: [], executor: 'UNKNOWN', resource: { costUsd: 'UNKNOWN', tokens: 'UNKNOWN' }, requestedEffects: [] } })
  recoverInterruptedRuns(i.log, mins(10))
  const base = deriveWorkers(i.log).workers.get('rw')!.runs[0]
  i.log.append({ t: 'run', rid: 'run:z:end', run: { ...base, status: 'SUCCEEDED', endedAt: mins(11).toISOString() } })
  check('R13_terminal_run_record_is_final', deriveWorkers(i.log).workers.get('rw')!.runs.find((x) => x.runId === 'z')!.status === 'INTERRUPTED')

  // MED-2: docs worker robustness
  const docs = path.join(tmp(), 'docs'); mkdirSync(path.join(docs, 'sub'), { recursive: true })
  writeFileSync(path.join(docs, 'a.md'), '# a'); symlinkSync(path.join(docs, 'missing.md'), path.join(docs, 'dangling.md')); symlinkSync(tmp(), path.join(docs, 'escape'))
  process.env.WAR_ROOM_DOCS_DIR = docs
  const dw = activeAgent(); registerWorker(dw.log, W(dw.spec.id, { id: 'dw', category: 'documentation_freshness', limits: { maxRuntimeMs: 5000, maxRunsPerDay: 50, maxConsecutiveFailures: 5, cadenceMinutes: null } }), 'commander:mark', NOW)
  const dr = await executeWorker(dw.log, 'dw', documentationFreshnessRunner, { now: NOW, runId: 'dw1' })
  check('R14_docs_worker_skips_symlinks_and_reports_skips', dr.ok && dr.run.status === 'SUCCEEDED' && dr.run.outputs[0].summary.includes('1 markdown docs scanned') && dr.run.outputs[0].summary.includes('2 entries skipped'), dr.ok ? dr.run.outputs[0].summary : '')
  delete process.env.WAR_ROOM_DOCS_DIR
  // MED-4/6: pending approvals clear, limits
  const p = activeAgent(); registerWorker(p.log, W(p.spec.id, { limits: { maxRuntimeMs: 1000, maxRunsPerDay: 50, maxConsecutiveFailures: 5, cadenceMinutes: null } }), 'commander:mark', NOW)
  await executeWorker(p.log, 'rw', async (ctx) => { ctx.requestEffect('spend'); return {} }, { now: NOW, runId: 'pb' })
  const pendBefore = buildOpsSnapshot(p.log, NOW).pendingApprovals.filter((x) => x.kind === 'blocked_effect').length
  const vm = buildOpsViewModel({ generatedAt: NOW.toISOString(), totals: buildOpsSnapshot(p.log, NOW).totals, governance: buildOpsSnapshot(p.log, NOW).governance, data: buildOpsSnapshot(p.log, NOW) })
  approveEffect(p.log, 'rw', ['spend'], 'commander:mark', 'ok', mins(1))
  const pendAfter = buildOpsSnapshot(p.log, mins(2)).pendingApprovals.filter((x) => x.kind === 'blocked_effect').length
  check('R15_blocked_effect_pending_until_answered_and_actionable_in_ui', pendBefore === 1 && pendAfter === 0 && vm.sections.approvals.rows[0].controls![0].action === 'approveEffect')
  const big = await handleOpsControl({ action: 'detectNeed', title: 't', evidence: [{ criterion: 'recurring_task_pattern', summary: 'x'.repeat(70_000), evidenceRefs: ['r'] }] }, 'commander:mark', p.log, NOW)
  let tooLarge = false
  try { p.log.append({ t: 'need', need: { id: 'n', title: 'x'.repeat(MAX_RECORD_BYTES + 10), detectedAt: NOW.toISOString(), evidence: [] } }) } catch { tooLarge = true }
  check('R16_oversized_requests_and_records_refused', big.status === 413 && tooLarge)
  const regV = freshOps(); const rv2 = new AgentOpsLog(regV.dir); rv2.view()
  new AgentOpsLog(regV.dir).append({ t: 'need', need: fullNeed('cache') })
  check('R17_log_cache_sees_other_writers', rv2.view().records.length === 1)
  // MED-6 / stale RUNNING gets a recover control
  const sr = activeAgent(); registerWorker(sr.log, W(sr.spec.id), 'commander:mark', NOW)
  sr.log.append({ t: 'run', rid: 'run:st:start', run: { runId: 'st', workerId: 'rw', agentId: sr.spec.id, workerVersion: '1', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], startedAt: NOW.toISOString(), status: 'RUNNING', toolsUsed: [], outputs: [], escalations: [], errors: [], executor: 'UNKNOWN', resource: { costUsd: 'UNKNOWN', tokens: 'UNKNOWN' }, requestedEffects: [] } })
  const stale = buildOpsSnapshot(sr.log, mins(10)); const svm = buildOpsViewModel({ generatedAt: stale.generatedAt, totals: stale.totals, governance: stale.governance, data: stale })
  check('R18_stale_running_worker_offers_recover_control', svm.sections.workers.rows[0].controls.some((c) => c.action === 'recoverRuns'))
}
finish()
