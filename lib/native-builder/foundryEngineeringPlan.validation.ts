/**
 * Planning + dynamic replanning validation (pure). The runtime integration (a real campaign that fails, replans, keeps finished
 * work, reloads) is asserted in foundryEngineeringCampaign.validation.ts; this file proves the plan model itself.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  PLAN_LIMITS,
  decideRepairTarget,
  PLAN_TRIGGER_SUMMARY,
  buildInitialPlan,
  ensurePlan,
  layerForRepairTarget,
  linkHypothesis,
  planEventPayload,
  planProblems,
  planSummary,
  revisePlan,
  syncPlanStatus,
  unjustifiedReopens,
  type CampaignTaskLike,
  type ComponentFilesLike,
  type EngineeringPlan,
} from './foundryEngineeringPlan'
import { buildLiveProgress } from './foundryLiveProgress'
import type { QuietEvent } from './foundryQuietPresentation'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`.trimEnd()) }

const components: ComponentFilesLike = { contract: ['shared/contract.py'], backend: ['backend/api.py'], frontend: ['frontend/board.py'], tests: ['tests/test_api.py', 'tests/test_ui.py'], database: [] }
const task = (id: string, role: string, dependsOn: string[], workingSet: string[], status = 'PLANNED'): CampaignTaskLike => ({ id, role, status, dependsOn, purpose: `${id} purpose`, acceptance: `${id} accepted`, workingSet })
const graph = (): CampaignTaskLike[] => [
  task('discover', 'ARCHITECT', [], components.backend),
  task('architect', 'ARCHITECT', ['discover'], [...components.contract, ...components.backend]),
  task('contract', 'ARCHITECT', ['architect'], components.contract),
  task('backend', 'BACKEND', ['contract'], components.backend),
  task('frontend', 'FRONTEND', ['contract'], components.frontend),
  task('integrate', 'TEST', ['backend', 'frontend'], components.tests),
  task('review', 'REVIEWER', ['integrate'], []),
  task('verify', 'VERIFIER', ['review'], components.tests),
]
const at = '2026-01-01T00:00:00.000Z'
const initial = () => buildInitialPlan({ request: 'Update the backend ticket API and the UI so listing works with and without a status filter.', acceptance: ['listing works with a filter', 'listing works without a filter'], tasks: graph(), components, at })
const withStatus = (tasks: CampaignTaskLike[], done: string[]) => tasks.map(t => ({ ...t, status: done.includes(t.id) ? 'COMPLETE' : 'PLANNED' }))
const RAW = /\b(debug-\d|TASK_|PLAN_|BLOCKED_|FAILURE_CHANGED|TEST_FAILURE|CONTRADICTION|REPAIR_RETARGET|REOPENED|fingerprint|mutationGeneration|revision \d)\b/

function main() {
  // ---------------------------------------------------------------- A. build from project truth
  const plan = initial()
  check('A_goal_is_decomposed_into_dependency_ordered_tasks', plan.tasks.length === 8 && plan.tasks[0].id === 'discover' && plan.tasks.find(t => t.id === 'backend')!.dependsOn.join() === 'contract' && plan.tasks.find(t => t.id === 'integrate')!.dependsOn.join() === 'backend,frontend', plan.tasks.map(t => t.id).join(','))
  check('A_every_task_has_acceptance_and_a_stated_working_set_reason', plan.tasks.every(t => t.acceptance.length > 0 && t.workingSetWhy.length > 0), '')
  check('A_working_set_comes_from_the_projects_own_files', plan.tasks.find(t => t.id === 'backend')!.workingSet.join() === 'backend/api.py' && plan.tasks.find(t => t.id === 'frontend')!.workingSet.join() === 'frontend/board.py' && plan.tasks.find(t => t.id === 'backend')!.workingSetWhy.includes('backend/api.py'), '')
  check('A_plan_carries_the_goal_and_acceptance', plan.goal.startsWith('Update the backend') && plan.acceptance.length === 2, '')
  check('A_plan_is_structurally_sound', planProblems(plan).length === 0, planProblems(plan).join(';'))
  check('A_initial_revision_records_every_task_added', plan.revision === 1 && plan.revisions.length === 1 && plan.revisions[0].trigger === 'INITIAL' && plan.revisions[0].changes.length === 8, '')
  const cyclic: EngineeringPlan = { ...plan, tasks: plan.tasks.map(t => (t.id === 'discover' ? { ...t, dependsOn: ['verify'] } : t)) }
  check('A_a_dependency_cycle_is_detected', planProblems(cyclic).some(p => p.includes('cycle')), planProblems(cyclic).join(';'))
  const dangling: EngineeringPlan = { ...plan, tasks: plan.tasks.map(t => (t.id === 'verify' ? { ...t, dependsOn: ['ghost'] } : t)) }
  check('A_a_dependency_on_an_unknown_task_is_detected', planProblems(dangling).some(p => p.includes('unknown task')), planProblems(dangling).join(';'))

  // ---------------------------------------------------------------- B. status follows execution
  const running = syncPlanStatus(plan, graph().map(t => ({ ...t, status: t.id === 'discover' || t.id === 'architect' || t.id === 'contract' ? 'COMPLETE' : t.id === 'backend' ? 'RUNNING' : 'PLANNED' })))
  check('B_done_and_active_tasks_are_tracked', ['discover', 'architect', 'contract'].every(id => running.tasks.find(t => t.id === id)!.status === 'DONE') && running.tasks.find(t => t.id === 'backend')!.status === 'ACTIVE' && running.tasks.find(t => t.id === 'frontend')!.status === 'PLANNED', running.tasks.map(t => `${t.id}:${t.status}`).join(' '))
  const allDone = syncPlanStatus(running, withStatus(graph(), graph().map(t => t.id)))
  check('B_completion_stamps_the_revision_it_finished_in', allDone.tasks.every(t => t.status === 'DONE' && t.completedAtRevision === 1), '')

  // ---------------------------------------------------------------- C. a failing test replans, keeps finished work, and states why
  const failedTasks = withStatus(graph(), ['discover', 'architect', 'contract', 'frontend'])
  const beforeFailure = syncPlanStatus(plan, withStatus(graph(), graph().map(t => t.id)))
  const debug = { ...task('debug-1', 'DEBUGGER', [], components.backend), purpose: "NameError: name 'normalize_status' is not defined" }
  const afterStatus = syncPlanStatus(beforeFailure, [...failedTasks, { ...debug, status: 'READY' }])
  const revised = revisePlan(afterStatus, {
    at, trigger: 'TEST_FAILURE', summary: PLAN_TRIGGER_SUMMARY.TEST_FAILURE, evidence: ["NameError: name 'normalize_status' is not defined"], components,
    add: [{ task: debug, why: 'Find the cause before changing the code again.' }],
    reopen: afterStatus.tasks.filter(t => t.status === 'REOPENED').map(t => ({ taskId: t.id, why: t.id === 'backend' ? 'The failure points at this layer.' : 'It has to run again after the change.' })),
    keep: ['discover', 'architect', 'contract', 'frontend'].map(taskId => ({ taskId, why: 'Already done and still valid, so it is not repeated.' })),
  })
  const rev = revised.revisions[revised.revisions.length - 1]
  check('C_the_plan_gains_a_debug_step_and_a_new_revision', revised.revision === 2 && revised.tasks.some(t => t.id === 'debug-1') && rev.trigger === 'TEST_FAILURE', rev.changes.map(c => `${c.op}:${c.taskId}`).join(' '))
  check('C_only_implicated_work_is_reopened_and_each_reopen_has_a_reason', revised.tasks.filter(t => t.status === 'REOPENED').map(t => t.id).sort().join() === 'backend,integrate,review,verify' && unjustifiedReopens(revised).length === 0, revised.tasks.filter(t => t.status === 'REOPENED').map(t => t.id).join())
  check('C_finished_work_is_kept_and_recorded_as_kept', ['discover', 'architect', 'contract', 'frontend'].every(id => rev.changes.some(c => c.op === 'KEEP' && c.taskId === id) && revised.tasks.find(t => t.id === id)!.status === 'DONE') && !rev.changes.some(c => c.op === 'REOPEN' && c.taskId === 'frontend'), '')
  check('C_a_reopen_without_a_recorded_reason_is_flagged', unjustifiedReopens(syncPlanStatus(beforeFailure, failedTasks)).length > 0, unjustifiedReopens(syncPlanStatus(beforeFailure, failedTasks)).join())
  check('C_evidence_is_recorded_on_the_revision', rev.evidence.length === 1 && rev.evidence[0].includes('normalize_status'), rev.evidence.join('|'))
  check('C_the_earlier_revision_is_preserved_not_rewritten', revised.revisions[0].trigger === 'INITIAL' && revised.revisions[0].changes.length === 8, '')

  // ---------------------------------------------------------------- D. hypothesis-linked repair, retarget and architecture contradiction
  const linked = linkHypothesis(revised, 'debug-1', "normalize_status is used in backend/api.py but never defined", 'Define normalize_status in backend/api.py')
  const debugPlanTask = linked.tasks.find(t => t.id === 'debug-1')!
  check('D_the_repair_is_linked_to_its_hypothesis_and_target', debugPlanTask.hypothesis?.includes('normalize_status') === true && debugPlanTask.repairTarget?.includes('backend/api.py') === true, `${debugPlanTask.hypothesis} -> ${debugPlanTask.repairTarget}`)
  check('D_repair_target_maps_to_the_layer_it_names', layerForRepairTarget('Define normalize_status in backend/api.py', components) === 'backend' && layerForRepairTarget('forward the status in board.py', components) === 'frontend' && layerForRepairTarget('add the field to shared/contract.py', components) === 'contract' && layerForRepairTarget('something vague', components) === null && layerForRepairTarget(null, components) === null, '')
  const contradiction = revisePlan(linked, {
    at, trigger: 'CONTRADICTION', summary: PLAN_TRIGGER_SUMMARY.CONTRADICTION, evidence: ['The UI drops the status before it reaches the API', 'Forward the status in frontend/board.py'], components,
    reopen: [{ taskId: 'frontend', why: 'The diagnosis puts the cause in the frontend.' }],
    retarget: [{ taskId: 'frontend', workingSet: ['frontend/board.py', 'shared/contract.py'], why: 'frontend/board.py is the file the diagnosis names.' }],
  })
  const crev = contradiction.revisions[contradiction.revisions.length - 1]
  check('D_an_architecture_contradiction_reopens_the_layer_the_evidence_names', contradiction.tasks.find(t => t.id === 'frontend')!.status === 'REOPENED' && crev.trigger === 'CONTRADICTION' && crev.changes.some(c => c.op === 'REOPEN' && c.taskId === 'frontend' && c.why.includes('frontend')), crev.changes.map(c => `${c.op}:${c.taskId}`).join(' '))
  check('D_a_retarget_changes_the_working_set_and_says_why', contradiction.tasks.find(t => t.id === 'frontend')!.workingSet[0] === 'frontend/board.py' && contradiction.tasks.find(t => t.id === 'frontend')!.workingSetWhy.includes('names') && crev.changes.some(c => c.op === 'RETARGET'), '')
  check('D_revision_order_is_monotonic', contradiction.revisions.map(r => r.version).join() === '1,2,3' && contradiction.revision === 3, contradiction.revisions.map(r => r.version).join())

  // ---------------------------------------------------------------- D2. the runtime's decision about what a repair target means
  const tasksNow = [{ id: 'backend', status: 'PLANNED', workingSet: ['backend/api.py'] }, { id: 'frontend', status: 'COMPLETE', workingSet: ['frontend/board.py'] }]
  const sameLayer = decideRepairTarget({ target: 'Define normalize_status in backend/api.py', components, tasks: tasksNow })
  check('D2_a_target_in_the_layer_already_being_reopened_changes_nothing', sameLayer === null, JSON.stringify(sameLayer))
  const wrongLayer = decideRepairTarget({ target: 'Forward the status in frontend/board.py', components, tasks: tasksNow })
  check('D2_a_target_in_a_finished_layer_is_an_architecture_contradiction', wrongLayer?.contradiction === true && wrongLayer.layer === 'frontend' && wrongLayer.named === 'frontend/board.py', JSON.stringify(wrongLayer))
  const multi: ComponentFilesLike = { ...components, backend: ['backend/api.py', 'backend/store.py'] }
  const retarget = decideRepairTarget({ target: 'The bug is in store.py', components: multi, tasks: [{ id: 'backend', status: 'PLANNED', workingSet: ['backend/api.py'] }] })
  check('D2_a_target_naming_another_file_in_the_layer_retargets_the_working_set', retarget?.contradiction === false && retarget.workingSet?.join() === 'backend/store.py,backend/api.py', JSON.stringify(retarget))
  check('D2_the_contract_is_read_only_so_it_never_reopens_a_layer', decideRepairTarget({ target: 'add the field to shared/contract.py', components, tasks: tasksNow }) === null && decideRepairTarget({ target: 'something vague', components, tasks: tasksNow }) === null && decideRepairTarget({ target: null, components, tasks: tasksNow }) === null, '')
  check('D2_no_task_for_the_layer_means_no_decision', decideRepairTarget({ target: 'edit backend/api.py', components, tasks: [{ id: 'frontend', status: 'COMPLETE', workingSet: [] }] }) === null, '')

  // ---------------------------------------------------------------- E. bounded and durable
  let grown = plan
  for (let i = 0; i < 40; i += 1) grown = revisePlan(grown, { at, trigger: 'FAILURE_CHANGED', summary: 'x', evidence: ['a', 'b', 'c', 'd', 'e', 'f'], components, add: [{ task: task(`debug-${i + 1}`, 'DEBUGGER', [], []), why: 'cause' }] })
  check('E_revisions_and_tasks_are_capped', grown.revisions.length === PLAN_LIMITS.maxRevisions && grown.tasks.length <= PLAN_LIMITS.maxTasks && grown.revisions.every(r => r.evidence.length <= PLAN_LIMITS.maxEvidence && r.evidence.every(e => e.length <= PLAN_LIMITS.maxEvidenceChars)), `revisions=${grown.revisions.length} tasks=${grown.tasks.length}`)
  check('E_the_newest_revision_is_the_one_kept', grown.revisions[grown.revisions.length - 1].version === grown.revision, `${grown.revisions[0].version}..${grown.revision}`)
  check('E_plan_round_trips_through_json_unchanged', JSON.stringify(JSON.parse(JSON.stringify(contradiction))) === JSON.stringify(contradiction), '')
  const recovered = ensurePlan({ plan: null, request: 'Old mission', acceptance: [], tasks: withStatus(graph(), ['discover', 'architect']), componentFiles: components }, at)
  check('E_a_record_from_before_plans_existed_gets_a_rebuilt_plan_with_true_status', recovered.revisions[0].trigger === 'RECOVERED' && recovered.tasks.find(t => t.id === 'discover')!.status === 'DONE' && recovered.tasks.find(t => t.id === 'backend')!.status === 'PLANNED', recovered.revisions[0].summary)
  check('E_an_existing_plan_is_never_replaced_on_resume', ensurePlan({ plan: contradiction, request: 'x', acceptance: [], tasks: graph(), componentFiles: components }, at) === contradiction, '')

  // ---------------------------------------------------------------- F. human summary
  const summary = planSummary(contradiction)!
  check('F_default_summary_is_plain_language_only', [summary.headline, summary.lastRevision ?? '', ...summary.steps].every(text => !RAW.test(text)), `${summary.headline} | ${summary.lastRevision}`)
  check('F_summary_is_concise', summary.headline.length <= 200 && (summary.lastRevision ?? '').length <= 200 && summary.steps.length === 8, `${summary.headline.length} chars, ${summary.steps.length} steps`)
  check('F_debug_steps_are_not_listed_as_plan_steps', !summary.steps.some(step => /cause of the failing test/i.test(step)), '')
  check('F_every_trigger_has_a_plain_sentence', Object.values(PLAN_TRIGGER_SUMMARY).every(text => text.length > 10 && !RAW.test(text)), '')
  check('F_a_finished_mission_gets_a_past_tense_line_that_claims_no_specific_edits', /^I read the project/.test(summary.retrospective) && summary.retrospective.includes('changed course 2 times') && !RAW.test(summary.retrospective) && !/backend\/api\.py|frontend\//.test(summary.retrospective) && planSummary(plan)!.retrospective === 'I read the project, made the change, ran the tests, reviewed it and verified it from disk.', summary.retrospective)
  check('F_no_plan_no_summary', planSummary(null) === null && planSummary(undefined) === null, '')

  // ---------------------------------------------------------------- G. the live panel reacts only to real revisions
  const ev = (type: string, summary: string, extra: Partial<QuietEvent> = {}): QuietEvent => ({ eventId: `${type}-${Math.random()}`, type, summary, timestamp: at, status: 'info', ...extra } as QuietEvent)
  const stream = [ev('CAMPAIGN_STARTED', 'One engineering campaign started.'), ev('INTEGRATING', 'Running tests.'), ev('COMMAND_COMPLETED', 'Tests failed.', { status: 'fail', exitCode: 1, outputTail: "NameError: name 'x' is not defined" })]
  const before = buildLiveProgress({ events: stream, missionStatus: 'collecting_evidence' })
  const changedPlan = buildLiveProgress({ events: [...stream, ev('REWORKING', 'Tests failed', { status: 'fail' }), ev('PLAN_REVISED', PLAN_TRIGGER_SUMMARY.FAILURE_CHANGED, { detail: planEventPayload(revisePlan(plan, { at, trigger: 'FAILURE_CHANGED', summary: PLAN_TRIGGER_SUMMARY.FAILURE_CHANGED, evidence: ['x'], components })) })], missionStatus: 'collecting_evidence' })
  const plainFailure = buildLiveProgress({ events: [...stream, ev('REWORKING', 'Tests failed', { status: 'fail' }), ev('PLAN_REVISED', PLAN_TRIGGER_SUMMARY.TEST_FAILURE, { detail: planEventPayload(revisePlan(plan, { at, trigger: 'TEST_FAILURE', summary: PLAN_TRIGGER_SUMMARY.TEST_FAILURE, evidence: ['x'], components })) })], missionStatus: 'collecting_evidence' })
  const notesOf = (p: ReturnType<typeof buildLiveProgress>) => p.steps.find(s => s.id === 'fix')!.notes.map(n => n.text)
  check('G_a_changed_failure_shows_as_a_real_plan_update', notesOf(changedPlan).includes('Updated the plan') && !notesOf(before).includes('Updated the plan'), notesOf(changedPlan).join('|'))
  check('G_an_ordinary_failure_does_not_claim_a_replan', !notesOf(plainFailure).includes('Updated the plan'), notesOf(plainFailure).join('|'))
  check('G_replanning_never_lowers_the_count', changedPlan.done >= before.done, `${before.done} -> ${changedPlan.done}`)
  check('G_plan_revision_technical_detail_stays_out_of_the_main_panel', changedPlan.steps.every(s => !RAW.test(`${s.label} ${s.detail ?? ''} ${s.notes.map(n => n.text).join(' ')}`)) && changedPlan.steps.some(s => s.technical.some(line => line.includes('plan revised'))), changedPlan.steps.flatMap(s => s.technical).join('|'))

  // ---------------------------------------------------------------- H. source-level guarantees
  const runtime = readFileSync(path.join(process.cwd(), 'lib/native-builder/foundryEngineeringRuntime.ts'), 'utf8')
  check('H_the_runtime_builds_replans_links_and_resumes_the_plan', ['buildInitialPlan(', 'revisePlanFor(', 'linkRepairToPlan(', 'ensurePlan(state', 'announcePlanRevision(', "'PLAN_REVISED'", 'syncPlanStatus('].every(token => runtime.includes(token)), '')
  const panel = readFileSync(path.join(process.cwd(), 'components/war-room/foundry/FoundryLiveProgressPanel.tsx'), 'utf8')
  check('H_the_panel_shows_the_plan_and_switches_to_the_past_tense_when_complete', panel.includes('foundry-plan-summary') && panel.includes("progress.status === 'complete' ? plan.retrospective") && panel.includes('<details'), 'plan line + collapsed plan steps')
  check('H_the_plan_module_is_pure', !/from 'node:(fs|net|http|child_process)|fetch\(|Date\.now\(|new Date\(|Math\.random\(/.test(readFileSync(path.join(process.cwd(), 'lib/native-builder/foundryEngineeringPlan.ts'), 'utf8')), 'no fs, network, clock or randomness')

  const failed = results.filter(r => !r.pass)
  console.log(`ENGINEERING_PLAN_VALIDATION ${failed.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}

main()
