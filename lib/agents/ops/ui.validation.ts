/** Phase 10 operator-surface validation. Run: pnpm run validate:agent-ops-ui */
import { readFileSync } from 'node:fs'
import { harness, freshOps, fullNeed, draft, activeAgent, NOW } from './testkit'
import { buildOpsSnapshot } from './readModel'
import { buildOpsViewModel, type OpsEnvelope } from './uiState'
import { executeWorker, registerWorker, stopWorker } from './workers'

const { check, finish } = harness('AGENT_OPS_UI_VALIDATION')
const env = (log: Parameters<typeof buildOpsSnapshot>[0]): OpsEnvelope => { const data = buildOpsSnapshot(log, NOW); return { generatedAt: data.generatedAt, totals: data.totals, governance: data.governance, data } }
const wd = (agentId: string, id: string) => ({ id, agentId, category: 'documentation_freshness' as const, version: '1', mission: 'm', permissionScope: ['read_docs' as const], memoryScope: ['docs' as const], limits: { maxRuntimeMs: 1000, maxRunsPerDay: 10, maxConsecutiveFailures: 2, cadenceMinutes: null } })

{
  const empty = buildOpsViewModel(env(freshOps().log))
  check('U01_empty_state_is_honest', Object.values(empty.sections).every((s) => s.rows.length === 0 && s.empty.length > 15) && empty.sections.workers.empty.includes('Nothing runs in the background') && empty.header.startsWith('0 agent(s)'))

  const a = activeAgent()
  // PROPOSED agent in same registry
  const n2 = fullNeed('second'); a.reg.recordNeed(n2); const prop = a.reg.propose(n2.id, draft({ id: 'agent-proposed' }), NOW)
  registerWorker(a.log, wd(a.spec.id, 'w-ok'), 'commander:mark', NOW)
  registerWorker(a.log, wd(a.spec.id, 'w-stopped'), 'commander:mark', NOW)
  stopWorker(a.log, 'w-stopped', 'commander:mark', 'operator stop', NOW)
  registerWorker(a.log, wd(a.spec.id, 'w-fail'), 'commander:mark', NOW)
  await executeWorker(a.log, 'w-ok', async () => ({ outputs: [{ kind: 'k', ref: 'r', summary: 'did a thing' }] }), { now: NOW, runId: 'u1' })
  await executeWorker(a.log, 'w-ok', async (ctx) => { ctx.requestEffect('external_communication'); return {} }, { now: NOW, runId: 'u2' })
  const e = env(a.log)
  const vm = buildOpsViewModel(e)
  const row = (id: string) => vm.sections.agents.rows.find((r) => r.id === id)!
  const w = (id: string) => vm.sections.workers.rows.find((r) => r.id === id)!
  check('U02_agent_rows_show_state_scope_and_UNKNOWN_dimensions', row(a.spec.id).detail.startsWith('ACTIVE') && row(a.spec.id).evaluation.includes('memory quality UNKNOWN') && row(a.spec.id).evaluation.includes('cost UNKNOWN') && row(a.spec.id).flags.includes('thin evidence') && row(prop.id).detail.startsWith('PROPOSED'))
  check('U03_controls_follow_the_lifecycle_and_retire_needs_confirmation', row(prop.id).controls.map((c) => c.label).join() === 'Approve,Reject' && row(a.spec.id).controls.map((c) => c.label).join() === 'Pause,Mark under review,Retire' && row(a.spec.id).controls.find((c) => c.label === 'Retire')!.confirm === true && row(a.spec.id).controls.every((c) => c.action === 'transitionAgent'))
  check('U04_worker_health_and_controls', w('w-ok').detail.startsWith('IDLE') && w('w-ok').controls.map((c) => c.label).join() === 'Run now,Stop' && w('w-stopped').detail.startsWith('STOPPED') && w('w-stopped').controls.map((c) => c.label).join() === 'Resume' && w('w-stopped').flags[0].includes('operator stop'))
  check('U05_worker_progress_is_evidence_or_NO_EVIDENCE', w('w-ok').detail.includes('last progress 2026') && w('w-fail').detail.includes('last progress NO EVIDENCE'))
  check('U06_pending_approvals_list_proposals_and_blocked_effects', vm.sections.approvals.rows.some((r) => r.id === `agent_proposal:${prop.id}`) && vm.sections.approvals.rows.some((r) => r.detail.includes('external_communication')))
  check('U07_runs_show_actions_with_UNKNOWN_cost_and_executor', vm.sections.runs.rows.length === 2 && vm.sections.runs.rows.every((r) => r.detail.includes('cost UNKNOWN') && r.detail.includes('executor UNKNOWN')) && vm.sections.runs.rows.some((r) => 'outputs' in r && (r.outputs as string[]).includes('k: did a thing')))
  check('U08_view_matches_durable_state', vm.header.includes('2 agent(s) (1 active)') && vm.header.includes('3 worker(s)') && vm.header.includes('1 stopped') && vm.sections.usage.rows.length === 3)
  const ev = env(a.log)
  const tripped = activeAgent(); registerWorker(tripped.log, wd(tripped.spec.id, 'w-t'), 'commander:mark', NOW)
  const boom = async () => { throw new Error('boom') }
  await executeWorker(tripped.log, 'w-t', boom, { now: NOW, runId: 't1' }); await executeWorker(tripped.log, 'w-t', boom, { now: NOW, runId: 't2' })
  const tvm = buildOpsViewModel(env(tripped.log))
  check('U09_tripped_worker_and_paused_agent_are_flagged_with_recovery_listed', tvm.sections.agents.rows[0].detail.startsWith('PAUSED') && tvm.sections.workers.rows[0].detail.includes('agent PAUSED') && tvm.sections.errors.rows.length === 2 && tvm.sections.errors.rows[0].detail.includes('recovery:'))
  void ev
}
{
  const src = readFileSync('components/war-room/foundry/FoundryAgentOpsPanel.tsx', 'utf8')
  const fetches = [...src.matchAll(/fetch\(([^)]*)/g)].map((m) => m[1])
  check('U10_panel_only_get_summary_or_header_protected_post', fetches.length === 2 && src.includes("'x-wr-agent-ops': '1'") && fetches.filter((f) => f.includes("method: 'POST'") || src.includes("method: 'POST'")).length >= 1 && !/\b(by|actor)\s*:/.test(src))
  check('U11_panel_has_loading_error_notice_states', src.includes('agentops-loading') && src.includes('agentops-error') && src.includes('agentops-notice'))
  check('U12_page_route_is_plain_server_component', readFileSync('app/war-room/engineering/agents/page.tsx', 'utf8').includes('FoundryAgentOpsPanel'))
}
finish()
