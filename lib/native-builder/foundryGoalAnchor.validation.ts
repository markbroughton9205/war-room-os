/**
 * Phase 2 remainder — goal anchor (myopia protection), belief change, dependency order, scoped verification.
 * Pure: the runtime wiring is asserted textually; the live behaviour is proven by the Phase 2 live proofs.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { contradictedClaim, debugFilesFor, failingTestFiles, filesNamedBy, ineffectiveEdits, mentionsComponent, mergeRuledOut, reopenableLayers, ruledOutStatements, scopeTestFailures, testFileFromHeader } from './foundryGoalAnchor'
import { buildInitialPlan, disprovenHypothesis, linkHypothesis, planSummary, revisePlan, PLAN_TRIGGER_SUMMARY, type CampaignTaskLike, type ComponentFilesLike } from './foundryEngineeringPlan'
import { buildCampaignPlan, implementationNeedsEdit, isOpenOnly, readyCampaignTasks, recordTestFinish, recordTestStart, verificationBarrierSatisfied, type CampaignTestReceipt } from './foundryEngineeringCampaign'
import { validateModelToolRequest } from './foundryToolCatalog'
import { TOOL_NOT_AVAILABLE_CORRECTION, TOOL_NOT_EXPOSED, compactDiff, editBrokeTheProject, editFromProposal, explainProposalRefusal, locateUniqueMatch, missingNamesFromFailure } from './foundryEngineeringSpecialist'
import { buildLiveProgress } from './foundryLiveProgress'
import type { QuietEvent } from './foundryQuietPresentation'
import { planEventPayload } from './foundryEngineeringPlan'
import { resolveRepoRoot } from '@/lib/repo/paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`.trimEnd()) }

const ROOT = '/work/ticketdesk'
const components: ComponentFilesLike = { contract: ['shared/contract.py'], backend: ['backend/api.py'], frontend: ['frontend/view.py'], tests: ['tests/test_tickets.py'], database: [] }
const ticketTestSource = 'import sys\nfrom backend.api import list_tickets\nfrom frontend.view import badge, visible\nfrom shared.contract import normalize_status\n'
const legacyTestSource = 'import sys\nfrom legacy.export import to_csv\n'
const sources = { 'tests/test_tickets.py': ticketTestSource, 'tests/test_legacy_export.py': legacyTestSource }

const legacyBlock = `======================================================================
FAIL: test_totals_are_rounded_to_cents (test_legacy_export.LegacyExportTests.test_totals_are_rounded_to_cents)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "${ROOT}/tests/test_legacy_export.py", line 14, in test_totals_are_rounded_to_cents
    self.assertEqual(to_csv(rows), "id,total\\na,2.68")
AssertionError: 'id,total\\na,2.67' != 'id,total\\na,2.68'
`
const nameErrorBlock = `======================================================================
ERROR: test_backend_lists_everything_without_a_filter (test_tickets.TicketDeskTests.test_backend_lists_everything_without_a_filter)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "${ROOT}/tests/test_tickets.py", line 14, in test_backend_lists_everything_without_a_filter
    self.assertEqual([t["id"] for t in list_tickets({})], ["t1"])
  File "${ROOT}/backend/api.py", line 16, in list_tickets
    wanted = normalize_status(query.get(STATUS_QUERY))
NameError: name 'STATUS_QUERY' is not defined
`
const summary = (f: number, e: number) => `
----------------------------------------------------------------------
Ran 7 tests in 0.001s

FAILED (${[f ? `failures=${f}` : '', e ? `errors=${e}` : ''].filter(Boolean).join(', ')})
`

function main() {
  // ---------------------------------------------------------------- D. myopia: the request stays the anchor
  const only = scopeTestFailures({ output: legacyBlock + summary(1, 0), root: ROOT, components, mutated: ['backend/api.py'], sources })
  check('D_an_unrelated_only_failure_is_deferred_not_chased', only.reliable && only.onlyUnrelated && only.deferred.length === 1 && only.related.length === 0, JSON.stringify(only.deferred.map(d => d.file)))
  check('D_the_deferred_failure_names_its_test_file_and_says_why', only.deferred[0]?.file === 'tests/test_legacy_export.py' && only.deferred[0].why.length > 20, only.deferred[0]?.why ?? '')
  const mixed = scopeTestFailures({ output: nameErrorBlock + legacyBlock + summary(1, 1), root: ROOT, components, mutated: [], sources })
  check('D_a_mixed_run_keeps_the_real_failure_and_defers_the_unrelated_one', mixed.reliable && !mixed.onlyUnrelated && mixed.related.length === 1 && mixed.deferred.length === 1, `${mixed.related.length}/${mixed.deferred.length}`)
  check('D_the_text_handed_to_the_next_step_never_mentions_the_unrelated_error', mixed.relatedText.includes('NameError') && !/to_csv|legacy|2\.68/.test(mixed.relatedText), '')
  const reached = `======================================================================
FAIL: test_totals_are_rounded_to_cents (test_legacy_export.LegacyExportTests.test_totals_are_rounded_to_cents)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "${ROOT}/tests/test_legacy_export.py", line 14, in test_totals_are_rounded_to_cents
    x
  File "${ROOT}/backend/api.py", line 16, in list_tickets
    y
NameError: boom
`
  check('D_a_failure_that_reaches_a_project_component_is_never_deferred', !scopeTestFailures({ output: reached + summary(1, 0), root: ROOT, components, mutated: [], sources }).onlyUnrelated, '')
  const reachedMutated = reached.replace('backend/api.py', 'legacy/export.py')
  check('D_a_failure_that_reaches_a_file_foundry_changed_is_never_deferred', !scopeTestFailures({ output: reachedMutated + summary(1, 0), root: ROOT, components, mutated: ['legacy/export.py'], sources }).onlyUnrelated, '')
  check('D_a_failing_test_that_imports_the_components_is_related_even_with_a_test_only_traceback', !scopeTestFailures({ output: `======================================================================
FAIL: test_view_filters (test_tickets.TicketDeskTests.test_view_filters)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "${ROOT}/tests/test_tickets.py", line 24, in test_view_filters
    self.assertEqual(a, b)
AssertionError: 1 != 2
` + summary(1, 0), root: ROOT, components, mutated: [], sources }).onlyUnrelated, '')
  check('D_an_unreadable_test_source_stays_a_real_failure', !scopeTestFailures({ output: legacyBlock + summary(1, 0), root: ROOT, components, mutated: [], sources: {} }).onlyUnrelated, '')
  check('D_output_whose_failure_count_does_not_match_is_not_trusted', !scopeTestFailures({ output: legacyBlock + summary(2, 0), root: ROOT, components, mutated: [], sources }).reliable, '')
  check('D_output_that_is_not_a_test_report_is_not_trusted', !scopeTestFailures({ output: 'Traceback (most recent call last):\nModuleNotFoundError: x', root: ROOT, components, mutated: [], sources }).reliable, '')
  check('D_an_import_error_report_maps_to_its_test_file', testFileFromHeader('ERROR: test_legacy_export (unittest.loader._FailedTest.test_legacy_export)', rel => rel === 'tests/test_legacy_export.py') === 'tests/test_legacy_export.py', '')
  check('D_the_runtime_loads_exactly_the_failing_test_files', failingTestFiles(legacyBlock).includes('tests/test_legacy_export.py') && !failingTestFiles(legacyBlock).some(f => f.includes('tickets')), '')
  check('D_component_detection_uses_the_projects_own_layout', mentionsComponent('from backend.api import x', components) && mentionsComponent('import shared.contract', components) && !mentionsComponent('from legacy.export import y', components), '')

  // the plan records it, says it plainly and does not count it as a change of course
  const tasks = buildCampaignPlan({ ...components, tests: components.tests }, 'Update the backend ticket API and the UI so listing works with and without a status filter.').tasks as unknown as CampaignTaskLike[]
  const at = '2026-01-01T00:00:00.000Z'
  const base = buildInitialPlan({ request: 'Update the ticket API and UI', acceptance: ['listing works with a filter'], tasks, components, at })
  const deferredPlan = revisePlan(base, { at, trigger: 'DRIFT_GUARD', summary: PLAN_TRIGGER_SUMMARY.DRIFT_GUARD, evidence: only.deferred.map(d => d.test), defer: only.deferred, components })
  check('D_the_plan_records_the_deferral_with_a_revision', deferredPlan.revision === 2 && deferredPlan.deferred?.length === 1 && deferredPlan.revisions[1].changes.some(c => c.op === 'DEFER'), '')
  check('D_recording_the_same_failure_twice_does_not_duplicate_it', revisePlan(deferredPlan, { at, trigger: 'DRIFT_GUARD', summary: PLAN_TRIGGER_SUMMARY.DRIFT_GUARD, evidence: [], defer: only.deferred, components }).deferred?.length === 1, '')
  check('D_no_task_is_reopened_or_changed_by_a_deferral', JSON.stringify(deferredPlan.tasks) === JSON.stringify(base.tasks), '')
  const s = planSummary(deferredPlan)!
  check('D_a_deferral_is_not_reported_as_a_change_of_course', s.changes === 0 && /left as found/.test(s.retrospective) && !/changed course/.test(s.retrospective), s.retrospective)
  check('D_the_drift_sentence_is_plain_language', !/DRIFT|DEFER|TASK_|debug-|revision \d/.test(PLAN_TRIGGER_SUMMARY.DRIFT_GUARD) && /nothing to do with your request/.test(PLAN_TRIGGER_SUMMARY.DRIFT_GUARD), PLAN_TRIGGER_SUMMARY.DRIFT_GUARD)

  // the live panel says it in plain words, from a real recorded revision only
  const ev = (type: string, summary: string, extra: Partial<QuietEvent> = {}): QuietEvent => ({ eventId: `${type}-${Math.random()}`, type, summary, timestamp: at, status: 'info', ...extra } as QuietEvent)
  const driftStream = [ev('CAMPAIGN_STARTED', 'One engineering campaign started.'), ev('INTEGRATING', 'Running tests.'), ev('PLAN_REVISED', PLAN_TRIGGER_SUMMARY.DRIFT_GUARD, { detail: planEventPayload(deferredPlan) })]
  const withDrift = buildLiveProgress({ events: driftStream, missionStatus: 'collecting_evidence' })
  const testNotes = withDrift.steps.find(step => step.id === 'test')!.notes.map(note => note.text)
  check('D_the_panel_says_an_unrelated_failure_was_left_alone_in_plain_words', testNotes.includes('Left an unrelated failing test alone') && !withDrift.steps.some(step => /DRIFT|DEFER|debug-|revision \d/.test(`${step.label} ${step.detail ?? ''} ${step.notes.map(note => note.text).join(' ')}`)), testNotes.join('|'))
  const withoutDrift = buildLiveProgress({ events: driftStream.slice(0, 2), missionStatus: 'collecting_evidence' })
  check('D_nothing_is_claimed_without_a_recorded_revision', !withoutDrift.steps.find(step => step.id === 'test')!.notes.some(note => /left .* alone/i.test(note.text)), '')
  check('D_leaving_a_failure_alone_is_not_counted_as_updating_the_plan', !withDrift.steps.find(step => step.id === 'fix')!.notes.some(note => note.text === 'Updated the plan'), '')

  // scoped verification stays honest: the runner's exit code is kept and the barrier needs a real deferral
  const receipts: CampaignTestReceipt[] = []
  const campaign = { mutationGeneration: 2, testReceipts: receipts, tasks: [{ id: 'integrate', role: 'TEST', status: 'COMPLETE' }] }
  recordTestStart(campaign, 'python3 -m unittest discover -s tests -q', at)
  recordTestFinish(campaign, 1, at, { deferred: 1 })
  campaign.testReceipts[0].testedMutationGeneration = 2
  check('D_a_scoped_pass_keeps_the_real_exit_code_and_says_it_was_scoped', receipts[0].exitCode === 1 && receipts[0].result === 'PASSED_SCOPED' && receipts[0].deferredFailures === 1, JSON.stringify(receipts[0]))
  check('D_a_scoped_pass_satisfies_the_verification_barrier_for_the_current_files', verificationBarrierSatisfied(campaign), '')
  const plainFail: CampaignTestReceipt[] = []
  recordTestStart({ mutationGeneration: 2, testReceipts: plainFail }, 'python3 -m unittest discover', at)
  recordTestFinish({ testReceipts: plainFail }, 1, at)
  plainFail[0].testedMutationGeneration = 2
  check('D_an_ordinary_failure_is_still_a_failure', plainFail[0].result === 'FAILED' && !verificationBarrierSatisfied({ mutationGeneration: 2, testReceipts: plainFail, tasks: [] }), '')
  const zeroDeferred: CampaignTestReceipt[] = [{ testedMutationGeneration: 2, command: 'python3 -m unittest', exitCode: 1, startedAt: at, completedAt: at, result: 'PASSED_SCOPED' }]
  check('D_a_scoped_pass_without_any_deferral_is_not_accepted', !verificationBarrierSatisfied({ mutationGeneration: 2, testReceipts: zeroDeferred, tasks: [] }), '')
  const stale = [{ ...receipts[0], testedMutationGeneration: 1 }]
  check('D_a_scoped_pass_for_older_files_is_not_accepted', !verificationBarrierSatisfied({ mutationGeneration: 2, testReceipts: stale, tasks: [] }), '')

  // ---------------------------------------------------------------- C. a disproven belief changes the plan
  let plan = revisePlan(base, { at, trigger: 'TEST_FAILURE', summary: PLAN_TRIGGER_SUMMARY.TEST_FAILURE, evidence: ['KeyError status in frontend/view.py'], add: [{ task: { id: 'debug-1', role: 'DEBUGGER', status: 'PLANNED', dependsOn: ['integrate'], purpose: 'find the cause', acceptance: 'name the cause', workingSet: [] }, why: 'cause first' }], components })
  plan = linkHypothesis(plan, 'debug-1', 'badge() should read the status with .get', 'frontend/view.py badge')
  plan = revisePlan(plan, { at, trigger: 'FAILURE_CHANGED', summary: PLAN_TRIGGER_SUMMARY.FAILURE_CHANGED, evidence: ['badge is now unknown'], add: [{ task: { id: 'debug-2', role: 'DEBUGGER', status: 'PLANNED', dependsOn: ['integrate'], purpose: 'find the cause', acceptance: 'name the cause', workingSet: [] }, why: 'again' }], components })
  const evidence = disprovenHypothesis(plan, 'debug-2', 'list_tickets drops the status key', 'backend/api.py list_tickets', components)
  check('C_a_new_diagnosis_in_another_layer_disproves_the_earlier_belief', Boolean(evidence) && evidence![0].includes('Earlier idea') && evidence![1].includes('Now'), JSON.stringify(evidence))
  check('C_the_same_layer_again_is_not_a_change_of_belief', disprovenHypothesis(plan, 'debug-2', 'badge should default', 'frontend/view.py badge', components) === null, '')
  check('C_no_earlier_belief_means_nothing_is_disproven', disprovenHypothesis(base, 'debug-1', 'x', 'backend/api.py', components) === null, '')
  check('C_a_target_naming_no_layer_disproves_nothing', disprovenHypothesis(plan, 'debug-2', 'unclear', null, components) === null, '')
  const disproven = revisePlan(plan, { at, trigger: 'HYPOTHESIS_DISPROVEN', summary: PLAN_TRIGGER_SUMMARY.HYPOTHESIS_DISPROVEN, evidence: evidence!, components })
  check('C_the_belief_change_is_a_recorded_plan_revision_in_plain_language', disproven.revisions[disproven.revisions.length - 1].trigger === 'HYPOTHESIS_DISPROVEN' && /first fix didn't settle it/.test(disproven.revisions[disproven.revisions.length - 1].summary), '')

  // ---------------------------------------------------------------- E. dependency order
  const graph = buildCampaignPlan(components, 'listing works with and without a status filter').tasks
  const readyNow = readyCampaignTasks(graph).map(task => task.id)
  check('E_only_tasks_whose_dependencies_are_done_can_run', readyNow.join() === 'discover', readyNow.join())
  const afterArchitect = graph.map(task => ({ ...task, status: ['discover', 'architect'].includes(task.id) ? 'COMPLETE' : task.status })) as typeof graph
  const readyAfterArchitect = readyCampaignTasks(afterArchitect).map(task => task.id)
  check('E_a_dependent_task_is_not_ready_before_its_dependency_completes', ['contract', 'backend', 'frontend'].every(id => readyAfterArchitect.includes(id)) && !readyAfterArchitect.some(id => ['integrate', 'review', 'verify'].includes(id)), readyAfterArchitect.join())
  const afterBackendOnly = afterArchitect.map(task => ({ ...task, status: ['contract', 'backend'].includes(task.id) ? 'COMPLETE' : task.status })) as typeof graph
  check('E_tests_wait_for_every_layer_they_depend_on', !readyCampaignTasks(afterBackendOnly).some(task => task.id === 'integrate') && readyCampaignTasks(afterBackendOnly).some(task => task.id === 'frontend'), readyCampaignTasks(afterBackendOnly).map(task => task.id).join())
  const debugGate = graph.map(task => ({ ...task, status: ['discover', 'architect', 'contract', 'backend', 'frontend', 'integrate'].includes(task.id) ? 'COMPLETE' : task.status })) as typeof graph
  debugGate.push({ ...graph[0], id: 'debug-1', role: 'DEBUGGER', status: 'READY', dependsOn: [] } as (typeof graph)[number])
  const reopened = debugGate.map(task => (task.id === 'backend' ? { ...task, status: 'PLANNED', dependsOn: ['debug-1', ...task.dependsOn] } : task)) as typeof graph
  check('E_a_reopened_task_waits_for_the_diagnosis_it_depends_on', !readyCampaignTasks(reopened).some(task => task.id === 'backend') && readyCampaignTasks(reopened).some(task => task.id === 'debug-1'), readyCampaignTasks(reopened).map(task => task.id).join())


  // ---------------------------------------------------------------- P. later steps keep the evidence that explains the newest failure
  const undef = missingNamesFromFailure(["NameError: name 'STATUS_QUERY' is not defined"])
  check('P_a_missing_name_is_named_exactly_for_the_worker', undef.undefinedNames.join() === 'STATUS_QUERY' && undef.unknownImports.length === 0, JSON.stringify(undef))
  const unk = missingNamesFromFailure(["ImportError: cannot import name 'CONTRACT' from 'shared.contract' (/x/shared/contract.py)"])
  check('P_an_import_of_a_name_the_module_does_not_define_is_recognised', unk.unknownImports.join() === 'CONTRACT' && unk.undefinedNames.length === 0, JSON.stringify(unk))
  const editArgs = { path: 'backend/api.py', matchText: 'a', replacementText: 'b' }
  const permissions = { filesystem: true, terminal: false, browser: false, computerUse: false, tests: true, lint: false, typecheck: false, build: false, package: false, installProduction: false } as unknown as Parameters<typeof validateModelToolRequest>[2]
  const withoutReason = validateModelToolRequest('file.replace_unique', editArgs, permissions)
  check('P_a_governed_edit_without_a_reason_is_no_longer_refused', withoutReason.ok && withoutReason.args.reason === 'Edit proposed by the model for the current task.', withoutReason.ok ? String(withoutReason.args.reason) : withoutReason.error)
  const withReason = validateModelToolRequest('file.replace_unique', { ...editArgs, reason: 'add the missing import' }, permissions)
  check('P_a_reason_the_model_gave_is_kept', withReason.ok && withReason.args.reason === 'add the missing import', '')
  const otherTool = validateModelToolRequest('terminal.execute', { command: 'ls' }, permissions)
  check('P_the_default_reason_is_only_for_the_governed_edit_tool', !otherTool.ok || !('reason' in otherTool.args), otherTool.ok ? 'ok' : otherTool.error)
  const prose = missingNamesFromFailure(["HYPOTHESIS: The root cause is the missing definition of 'STATUS_QUERY' in the backend/api.py file. EVIDENCE: The failing line is 'wanted = normalize_status(query.get(STATUS_QUERY))'"])
  check('P_a_diagnosis_written_in_prose_still_yields_the_exact_missing_name', prose.undefinedNames.join() === 'STATUS_QUERY', JSON.stringify(prose))
  const claimed = missingNamesFromFailure(["HYPOTHESIS: The root cause is that 'MAX_TICKETS' is not defined in the shared contract, leading to a NameError"])
  check('P_a_name_reported_missing_is_extracted_even_when_the_diagnosis_blames_the_wrong_file', claimed.undefinedNames.join() === 'MAX_TICKETS', JSON.stringify(claimed))
  check('P_a_complaint_about_the_edit_tool_arguments_is_never_a_missing_import', missingNamesFromFailure(["HYPOTHESIS: The 'matchText' is missing or not unique in the working-set file"]).undefinedNames.length === 0 && missingNamesFromFailure(["invalid specialist output: 'reason' is not defined"]).undefinedNames.length === 0, '')
  check('P_ordinary_words_in_quotes_are_not_taken_for_names', missingNamesFromFailure(["the test 'passes' when it runs"]).undefinedNames.length === 0, '')
  check('P_an_edit_is_only_suspected_when_the_project_stopped_loading', editBrokeTheProject(['ImportError: cannot import name X']) && editBrokeTheProject(['SyntaxError: invalid syntax']) && !editBrokeTheProject(['AssertionError: 1 != 2']) && !editBrokeTheProject(["NameError: name 'x' is not defined"]), '')
  check('P_a_diff_is_compacted_to_its_changed_lines', compactDiff('--- a.py\n+++ a.py\n-from x import a\n+from x import a, matchText\n ctx') === '-from x import a +from x import a, matchText', compactDiff('--- a\n+++ a\n-x\n+y'))
  check('P_a_tool_the_step_does_not_offer_is_answered_once_with_where_the_files_are', TOOL_NOT_EXPOSED.test('Tool "file.read" was not exposed for this reasoning turn.') && /Everything you need is in SOURCE/.test(TOOL_NOT_AVAILABLE_CORRECTION), '')
  const specialist = readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryEngineeringSpecialist.ts'), 'utf8')
  check('P_the_prompt_no_longer_tells_the_worker_to_import_from_the_word_CONTRACT', !/missing import from CONTRACT/.test(specialist), '')
  check('P_the_newest_test_results_are_not_pushed_out_of_a_long_missions_facts', specialist.includes('campaign.knowledge.tests.slice(-4)') && !specialist.includes('...campaign.knowledge.tests].slice(0, 6)'), '')
  check('P_the_backend_worker_is_told_the_real_row_key_not_the_word_contract', specialist.includes('is the row key; it is not a variable named contract') && specialist.includes('contractFieldName([input.missionContract])') && !specialist.includes('whose contract field equals'), '')
  check('P_a_reviewer_and_a_verifier_are_not_handed_a_stale_failure', specialist.includes("input.role === 'REVIEWER' || input.role === 'VERIFIER' ? []"), '')
  check('P_the_retry_for_an_unavailable_tool_is_wired_into_the_call', specialist.includes('TOOL_NOT_EXPOSED.test(routed.error)'), '')
  check('P_the_worker_is_told_the_exact_missing_name_and_to_import_no_other', specialist.includes('Add exactly ${named.undefinedNames.join') && specialist.includes('Do not invent a name'), '')

  // ---------------------------------------------------------------- R. a right edit is not refused for whitespace, and a refusal says why
  const py = 'def list_tickets(query=None):\n    query = query or {}\n    wanted = normalize_status(query.get(STATUS_QUERY))\n    return list(TICKETS)\n'
  const exactHit = locateUniqueMatch(py, '    wanted = normalize_status(query.get(STATUS_QUERY))', '    wanted = 1')
  check('R_exact_text_is_used_as_is', exactHit !== null && py.slice(exactHit.start, exactHit.end) === '    wanted = normalize_status(query.get(STATUS_QUERY))', '')
  const wrongIndent = locateUniqueMatch(py, '        wanted = normalize_status(query.get(STATUS_QUERY))', '        wanted = query.get(STATUS_QUERY)')
  check('R_lines_copied_with_the_wrong_indentation_still_find_the_one_place', wrongIndent !== null && py.slice(wrongIndent.start, wrongIndent.end) === '    wanted = normalize_status(query.get(STATUS_QUERY))', JSON.stringify(wrongIndent))
  check('R_the_replacement_is_re_indented_to_the_real_lines', wrongIndent?.replacement === '    wanted = query.get(STATUS_QUERY)', JSON.stringify(wrongIndent?.replacement))
  const edited = editFromProposal({ file: 'a.py', search: '\treturn list(TICKETS)', replace: '\treturn list(TICKETS)[:5]' }, new Map([['a.py', py]]))
  check('R_a_tolerant_edit_lands_on_the_real_line_only', edited !== null && edited.after.includes('    return list(TICKETS)[:5]') && edited.after.includes('    wanted = normalize_status'), edited?.after.slice(-60) ?? 'null')
  check('R_a_substring_of_a_line_is_an_exact_match_and_keeps_the_indentation', locateUniqueMatch(py, 'wanted = normalize_status(query.get(STATUS_QUERY))', 'wanted = 1') !== null && py.slice(locateUniqueMatch(py, 'wanted = normalize_status(query.get(STATUS_QUERY))', 'x')!.start).startsWith('wanted'), '')
  const twice = 'a = 1\nx = 2\nb = 3\nx = 2\n'
  check('R_an_ambiguous_match_is_still_refused', locateUniqueMatch(twice, 'x = 2', 'x = 3') === null && locateUniqueMatch(twice, '  x = 2', 'x = 3') === null, '')
  check('R_text_that_is_not_in_the_file_is_still_refused', locateUniqueMatch(py, 'does not exist anywhere', 'x') === null, '')
  check('R_the_refusal_says_the_text_was_not_found', explainProposalRefusal({ search: 'nope', replace: 'x' }, py).includes('was not found'), explainProposalRefusal({ search: 'nope', replace: 'x' }, py))
  check('R_the_refusal_says_when_the_text_occurs_twice', explainProposalRefusal({ search: 'x = 2', replace: 'x = 3' }, twice).includes('more than once'), '')
  check('R_the_refusal_says_when_nothing_would_change', explainProposalRefusal({ search: 'a = 1', replace: 'a = 1' }, twice).includes('identical'), '')
  check('R_the_refusal_says_when_the_edit_would_break_the_file', explainProposalRefusal({ search: 'return list(TICKETS)', replace: 'return list(TICKETS' }, py).includes('syntax error'), '')
  check('R_the_word_missing_is_not_used_for_every_refusal', !readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryEngineeringSpecialist.ts'), 'utf8').includes("'matchText is missing or not unique in the working-set file'"), '')

  // ---------------------------------------------------------------- V. evidence outweighs a reviewer's sentence
  const fixedBackend = 'from shared.contract import STATUS_QUERY, MAX_TICKETS, normalize_status\n\nTICKETS = []\n\ndef list_tickets(query=None):\n    query = query or {}\n    wanted = normalize_status(query.get(STATUS_QUERY))\n    if wanted is None:\n        return list(TICKETS)[:MAX_TICKETS]\n    return [item for item in TICKETS if normalize_status(item.get("status")) == wanted]\n'
  const claim = "STATUS fail: 'MAX_TICKETS' is not defined in backend/api.py."
  const contractText0 = ''
  void contractText0
  const contractText = 'STATUS_QUERY = "status"\nMAX_TICKETS = 50\n'
  check('V_a_review_claim_of_an_undefined_name_is_ignored_when_the_source_binds_it', implementationNeedsEdit('BACKEND', fixedBackend, contractText, claim, 'REVIEW') === false, '')
  check('V_the_same_words_from_a_failing_test_still_reopen_the_code', implementationNeedsEdit('BACKEND', fixedBackend, contractText, "NameError: name 'MAX_TICKETS' is not defined", 'TEST') === true, '')
  const unbound = fixedBackend.replace('MAX_TICKETS, ', '').replace('[:MAX_TICKETS]', '[:limit(1)]')
  check('V_a_review_claim_is_believed_when_the_source_really_uses_an_unbound_name', implementationNeedsEdit('BACKEND', unbound, contractText, claim, 'REVIEW') === true, '')

  // ---------------------------------------------------------------- K. runtime evidence beats a diagnosis
  const disk = { 'shared/contract.py': 'STATUS_QUERY = "status"\nMAX_TICKETS = 50\n\ndef normalize_status(value):\n    return value\n', 'backend/api.py': 'from shared.contract import STATUS_QUERY\n\ndef list_tickets(query=None):\n    return []\n' }
  const named = filesNamedBy("HYPOTHESIS: The root cause is that 'MAX_TICKETS' is not defined in the shared contract, leading to a NameError", components)
  check('K_a_diagnosis_naming_the_shared_contract_is_mapped_to_the_contract_file', named.join() === 'shared/contract.py', named.join())
  check('K_a_diagnosis_naming_a_path_is_mapped_to_that_file', filesNamedBy("'STATUS_QUERY' is not defined in the backend/api.py file", components).join() === 'backend/api.py', '')
  const hit = contradictedClaim(['MAX_TICKETS'], disk, ['shared/contract.py'])
  check('K_a_name_the_diagnosis_calls_undefined_in_a_file_is_found_defined_there', hit?.name === 'MAX_TICKETS' && hit.file === 'shared/contract.py', JSON.stringify(hit))
  check('K_the_normal_not_imported_here_diagnosis_is_never_contradicted', contradictedClaim(['STATUS_QUERY'], disk, ['backend/api.py']) === null, '')
  check('K_a_diagnosis_that_names_no_file_is_left_alone', contradictedClaim(['MAX_TICKETS'], disk, []) === null, '')
  check('K_a_function_definition_counts_as_a_definition', contradictedClaim(['normalize_status'], disk, ['shared/contract.py'])?.file === 'shared/contract.py', '')
  check('K_a_name_that_is_really_undefined_is_not_contradicted', contradictedClaim(['NOT_THERE'], disk, ['shared/contract.py']) === null, '')
  check('K_a_comparison_is_not_a_definition', contradictedClaim(['X'], { 'a.py': 'if X == 1:\n    pass\n' }, ['a.py']) === null, '')
  check('K_the_contradiction_is_a_plain_language_replan', /checked that idea against the files/.test(PLAN_TRIGGER_SUMMARY.HYPOTHESIS_CONTRADICTED) && !/CONTRADICT|HYPOTHESIS|debug-/.test(PLAN_TRIGGER_SUMMARY.HYPOTHESIS_CONTRADICTED), PLAN_TRIGGER_SUMMARY.HYPOTHESIS_CONTRADICTED)
  check('V_a_backend_that_only_special_cases_open_is_open_only', isOpenOnly('def f(p, status=None):\n    if status == "open":\n        return [i for i in p if i.get("status") == "open"]\n    return list(p)\n'), '')
  check('V_a_backend_that_also_handles_closed_is_not_open_only', !isOpenOnly('def f(p, status=None):\n    if status == "open":\n        return 1\n    elif status == "closed":\n        return 2\n    return list(p)\n'), '')
  check('V_a_general_status_comparison_is_not_open_only', !isOpenOnly('def f(p, status=None):\n    if status == "open":\n        pass\n    return [i for i in p if i.get("status") == status]\n'), '')

  // ---------------------------------------------------------------- ruling out a repair that did not work
  const board = { contract: ['shared/contract.py'], backend: ['backend/api.py'], frontend: ['frontend/board.py'], tests: ['tests/test_rows.py'], database: [] as string[] }
  const noted = ineffectiveEdits({ sameFailure: true, editsSinceFailure: 2, recentEdits: [{ file: 'backend/api.py' }, { file: 'backend/api.py' }], components: board })
  check('W_the_same_failure_after_an_edit_rules_that_file_and_layer_out', noted.length === 1 && noted[0].file === 'backend/api.py' && noted[0].layer === 'backend', JSON.stringify(noted))
  check('W_a_changed_failure_rules_nothing_out', ineffectiveEdits({ sameFailure: false, editsSinceFailure: 1, recentEdits: [{ file: 'backend/api.py' }], components: board }).length === 0, '')
  check('W_a_failure_with_no_edit_since_rules_nothing_out', ineffectiveEdits({ sameFailure: true, editsSinceFailure: 0, recentEdits: [{ file: 'backend/api.py' }], components: board }).length === 0, '')
  check('W_only_edits_made_since_the_last_failure_count', ineffectiveEdits({ sameFailure: true, editsSinceFailure: 1, recentEdits: [{ file: 'frontend/board.py' }, { file: 'backend/api.py' }], components: board }).map(item => item.file).join() === 'backend/api.py', '')
  check('W_a_file_outside_the_project_layers_is_never_ruled_out', ineffectiveEdits({ sameFailure: true, editsSinceFailure: 1, recentEdits: [{ file: 'docs/readme.md' }], components: board }).length === 0, '')
  check('W_the_first_diagnosis_still_starts_from_the_backend_file', debugFilesFor(board, undefined).join() === 'backend/api.py' && debugFilesFor(board, []).join() === 'backend/api.py', '')
  check('W_after_the_backend_is_ruled_out_the_diagnosis_sees_the_other_layers_first', debugFilesFor(board, noted).join() === 'frontend/board.py,shared/contract.py,backend/api.py', debugFilesFor(board, noted).join())
  check('W_the_ruled_out_layer_is_not_reopened_again', reopenableLayers(['backend'], noted).length === 0 && reopenableLayers(['backend', 'frontend'], noted).join() === 'frontend' && reopenableLayers(['backend'], undefined).join() === 'backend', '')
  check('W_ruled_out_files_accumulate_without_duplicates_and_stay_bounded', mergeRuledOut(mergeRuledOut(undefined, noted), noted).length === 1 && mergeRuledOut(Array.from({ length: 9 }, (_, i) => ({ file: `f${i}.py`, layer: 'backend' })), []).length === 6, '')
  check('W_the_prompt_says_plainly_what_was_tried_and_did_not_work', ruledOutStatements(noted)[0] === 'I changed backend/api.py and the same test still fails, so the cause is not in backend/api.py', ruledOutStatements(noted)[0])
  check('W_the_ineffective_edit_replan_is_a_plain_sentence', /didn't fix it/.test(PLAN_TRIGGER_SUMMARY.EDIT_INEFFECTIVE) && !/EDIT_INEFFECTIVE|debug-|ruledOut/.test(PLAN_TRIGGER_SUMMARY.EDIT_INEFFECTIVE), PLAN_TRIGGER_SUMMARY.EDIT_INEFFECTIVE)

  // ---------------------------------------------------------------- wiring
  const runtime = readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryEngineeringRuntime.ts'), 'utf8')
  check('H_the_runtime_scopes_every_test_run_and_defers_through_the_plan', ['scopeTests(', 'deferUnrelated(', "revisePlanFor('HYPOTHESIS_CONTRADICTED'", 'contradictedClaim(claimedNames, definitions, filesNamedBy(', "revisePlanFor('DRIFT_GUARD'", "revisePlanFor('HYPOTHESIS_DISPROVEN'", 'scoped?.relatedText'].every(needle => runtime.includes(needle)) && (runtime.match(/scopeTests\(`/g) ?? []).length === 3, '')
  const live = readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryLiveProgress.ts'), 'utf8')
  check('C_a_belief_is_only_disproven_after_a_repair_edit_was_applied', runtime.includes('const editsSinceFailure = state.appliedEditKeys.length - (state.editsAtFailure ?? 0)') && runtime.includes('editedSinceLastFailure = editsSinceFailure > 0') && runtime.includes('editedSinceLastFailure ? disprovenHypothesis('), '')
  check('M_a_reviewer_or_tester_that_answers_unusably_is_asked_again_not_treated_as_a_code_failure', runtime.includes("!['BACKEND', 'FRONTEND'].includes(invalid.role)") && runtime.includes('{ role: current.role, taskId: current.id }'), '')
  check('M_an_unusable_worker_answer_never_replaces_the_real_failure_as_the_evidence', runtime.includes("(trigger === 'INVALID_OUTPUT' || trigger === 'NO_EFFECTIVE_CHANGE') && state.repairFinding ? state.repairFinding : finding") && runtime.includes('const signature = failureSignature(carried)'), '')
  check('W_the_runtime_rules_out_ineffective_edits_widens_the_diagnosis_and_never_reopens_the_ruled_out_layer', ['ineffectiveEdits({ sameFailure:', 'mergeRuledOut(state.ruledOut, ineffective)', 'debugFilesFor(state.componentFiles, state.ruledOut, state.noEffect)', 'reopenableLayers(reworkImplementationIds(finding), state.ruledOut)', "ineffective.length ? 'EDIT_INEFFECTIVE'"].every(part => runtime.includes(part)), '')
  check('W_a_ruled_out_edit_is_a_real_replan_in_live_progress', live.includes("'EDIT_INEFFECTIVE'"), '')
  check('W_the_prompt_carries_what_was_ruled_out', readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryEngineeringSpecialist.ts'), 'utf8').includes('...ruledOutStatements(campaign.ruledOut)'), '')
  check('H_a_disproven_belief_counts_as_a_real_replan_in_live_progress', live.includes("'HYPOTHESIS_DISPROVEN'") && !live.includes("'DRIFT_GUARD'].includes"), '')
  const anchor = readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryGoalAnchor.ts'), 'utf8')
  check('H_the_goal_anchor_module_is_pure', !/from 'node:(fs|net|http|child_process)|fetch\(|Date\.now\(|new Date\(|Math\.random\(/.test(anchor), '')

  const failed = results.filter(r => !r.pass)
  console.log(`GOAL_ANCHOR_VALIDATION ${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}
main()
