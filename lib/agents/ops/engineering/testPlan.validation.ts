/** Phase 10: contract-first test plan, Foundry-owned isolation harness, pre-execution review, defect classification. Run: pnpm run validate:agent-eng-testplan */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { harness, tmp } from './engtestkit'
import { CHAT_FEATURE, makeChatApp } from './chatFixture'
import { TASK_FEATURE } from './taskFixture'
import { ALERT_FEATURE } from './alertFixture'
import { completionClass } from './completionClass'
import { runHermetic } from './runtime/commandRunner'
import { correctContractAssertions } from './testContract'
import { HARNESS_PATH, buildTestPlan, clausesOf, correctionAcceptance, classifyTestDefect, dropUngrounded, harnessSource, parseReviewerVerdict, planPromptFor, reviewProblem, reviewTestFile, reviewerPrompt, startEntry, uncoveredCriteria } from './testPlan'
import type { EngineeringTool } from '../types'

const { check, finish } = harness('AGENT_ENG_TESTPLAN_VALIDATION')
const TOOLS: EngineeringTool[] = ['read_workspace', 'write_workspace', 'run_workspace_tests', 'run_typecheck', 'model_local', 'read_runtime_output']
const PKG = JSON.stringify({ name: 'x', type: 'module', scripts: { start: 'node server.mjs', test: 'node --test test/' } })
const ACC = CHAT_FEATURE.acceptance

// ---- the plan
const plan = buildTestPlan(ACC, PKG)!
check('P01_every_criterion_gets_a_plan_row_with_all_required_fields_and_the_untestable_ones_are_recorded_with_their_reason_not_dropped', !!plan && plan.tests.length === ACC.length && plan.tests.every((t) => t.criterion_id > 0 && t.behavior && t.preconditions && t.action && t.expected_result && Array.isArray(t.state_requirements) && Array.isArray(t.isolation_requirements) && t.priority && t.source === 'acceptance-contract') && plan.tests.filter((t) => t.priority === 'COVERED_ELSEWHERE').map((t) => t.criterion_id).join() === '7,8' && plan.tests.filter((t) => t.priority === 'COVERED_ELSEWHERE').every((t) => !!t.covered_by) && plan.tests.filter((t) => t.priority === 'REQUIRED').every((t) => t.isolation_requirements.length >= 3))
check('P02_the_persistence_and_environment_criteria_carry_their_state_requirements', plan.tests[3].state_requirements.some((s) => /restart/.test(s)) && plan.tests[4].state_requirements.some((s) => s.includes('CHAT_DATA_FILE')) && plan.storageVars.join() === 'CHAT_DATA_FILE')
check('P03_each_file_covers_at_most_four_criteria_and_every_required_criterion_is_assigned_to_exactly_one_file', plan.files.every((f) => f.criteria.length <= 4) && plan.files.flatMap((f) => f.criteria).sort().join() === '1,2,3,4,5,6' && plan.tests.filter((t) => t.priority === 'REQUIRED').every((t) => plan.files.filter((f) => f.criteria.includes(t.criterion_id)).length === 1))
const tp = buildTestPlan(TASK_FEATURE.acceptance, PKG)!, ap = buildTestPlan(ALERT_FEATURE.acceptance, PKG)!
check('P04_the_same_planner_handles_the_task_and_alert_contracts_with_their_own_storage_variable', tp.storageVars.join() === 'TASKS_FILE' && ap.storageVars.join() === 'ALERTS_FILE' && tp.files.length === 2 && ap.files.length === 2 && tp.tests.filter((t) => t.priority === 'COVERED_ELSEWHERE').length === 2 && ap.tests.filter((t) => t.priority === 'COVERED_ELSEWHERE').length === 2)
check('P05_the_plan_does_not_apply_without_a_node_start_script_and_the_legacy_flow_runs_unchanged', buildTestPlan(ACC, null) === null && buildTestPlan(ACC, JSON.stringify({ scripts: { start: 'next dev' } })) === null && startEntry(PKG) === 'server.mjs' && buildTestPlan(['the page shows a list', 'node tests cover the service'], PKG) === null)
const prompt = planPromptFor(plan, plan.files[1].path)
check('P06_the_writer_prompt_contains_only_the_rows_assigned_to_that_file_plus_the_harness_api_and_forbids_invention', prompt.includes('[C5]') && prompt.includes('[C6]') && !prompt.includes('[C1]') && !prompt.includes('[C4]') && prompt.includes('withApp') && prompt.includes('app.restart()') && /Do NOT import anything from \.\.\/src/.test(prompt) && prompt.includes('NOT TESTED IN THIS FILE') && prompt.includes('[C7]'))

// ---- the harness really isolates: run the SAME two tests in both orders against the baseline in-memory chat app
const root = makeChatApp(path.join(tmp(), 'chat'))
mkdirSync(path.join(root, 'test', 'support'), { recursive: true })
writeFileSync(path.join(root, HARNESS_PATH), harnessSource('server.mjs', []))
const A = `import test from 'node:test'\nimport assert from 'node:assert'\nimport { withApp } from './support/harness.mjs'\ntest('[C1] posting stores a message', () => withApp(async (app) => {\n  const r = await app.post('/api/messages', { text: 'hello' })\n  assert.strictEqual(r.status, 201)\n  assert.strictEqual((await app.get('/api/messages')).body.length, 1)\n}))\n`
const B = `import test from 'node:test'\nimport assert from 'node:assert'\nimport { withApp } from './support/harness.mjs'\ntest('[C2] a fresh server starts empty', () => withApp(async (app) => {\n  const r = await app.get('/api/messages')\n  assert.strictEqual(r.status, 200)\n  assert.strictEqual(r.body.length, 0)\n}))\n`
writeFileSync(path.join(root, 'test/a.test.mjs'), A); writeFileSync(path.join(root, 'test/b.test.mjs'), B)
const ab = await runHermetic(root, ['node', '--test', 'test/a.test.mjs', 'test/b.test.mjs'], TOOLS, { timeoutMs: 60_000 })
const ba = await runHermetic(root, ['node', '--test', 'test/b.test.mjs', 'test/a.test.mjs'], TOOLS, { timeoutMs: 60_000 })
check('P07_test_order_does_not_change_the_result_A_then_B_and_B_then_A_both_pass_because_every_test_has_its_own_server_and_data', ab.exitCode === 0 && ba.exitCode === 0, `${ab.exitCode}/${ba.exitCode} ${ab.stderr.slice(-200)}`)
const restartApp = `import test from 'node:test'\nimport assert from 'node:assert'\nimport { withApp } from './support/harness.mjs'\ntest('[C1] the harness restarts the server on the same data', () => withApp(async (app) => { assert.strictEqual((await app.get('/')).status, 200); await app.restart(); assert.strictEqual((await app.get('/')).status, 200) }))\ntest('[C2] default storage runs in a private working directory', () => withApp(async (app) => { assert.ok(app.cwd.includes('wr-app-')); assert.strictEqual((await app.get('/api/messages')).status, 200) }, { defaultStorage: true }))\n`
writeFileSync(path.join(root, 'test/r.test.mjs'), restartApp)
const rr = await runHermetic(root, ['node', '--test', 'test/r.test.mjs'], TOOLS, { timeoutMs: 60_000 })
check('P08_the_harness_can_restart_a_server_on_the_same_data_and_run_without_the_storage_variables_in_a_private_directory', rr.exitCode === 0, `${rr.stdout.slice(-300)} ${rr.stderr.slice(-200)}`)
check('P09_the_harness_text_is_deterministic_so_it_can_be_hashed_and_it_names_the_entry_and_storage_variables', harnessSource('server.mjs', ['CHAT_DATA_FILE']) === harnessSource('server.mjs', ['CHAT_DATA_FILE']) && harnessSource('server.mjs', ['CHAT_DATA_FILE']).includes('"CHAT_DATA_FILE"') && harnessSource('app/main.mjs', []).includes('"app/main.mjs"'))

// ---- the pre-execution reviewer
const F1 = plan.files[0].path
const GOOD = `import test from 'node:test'\nimport assert from 'node:assert'\nimport { withApp } from './support/harness.mjs'\n` + [1, 2, 3, 4].map((n) => `test('[C${n}] behavior ${n}', () => withApp(async (app) => {\n  const r = await app.get('/api/sessions')\n  assert.strictEqual(r.status, 200)\n}))\n`).join('')
check('P10_a_file_that_follows_the_plan_passes_review', reviewTestFile(F1, GOOD, plan).length === 0 && reviewProblem([]) === null)
const codes = (t: string) => reviewTestFile(F1, t, plan).map((f) => f.code)
check('P11_importing_the_implementation_directly_is_rejected_before_execution', codes(GOOD.replace("import { withApp }", "import { createSession } from '../src/messageStore.mjs'\nimport { withApp }")).includes('IMPORTS_IMPLEMENTATION'))
check('P12_creating_files_servers_temp_paths_or_changing_the_environment_is_rejected', codes(GOOD.replace("import test", "import { tmpdir } from 'node:os'\nimport test")).includes('OWN_FILES_OR_SERVER') && codes(GOOD + "process.env.CHAT_DATA_FILE = 'x'\n").includes('MUTATES_ENV'))
check('P13_module_level_mutable_state_is_rejected', codes(GOOD.replace("test('[C1]", "let shared = 0\ntest('[C1]")).includes('SHARED_STATE'))
check('P14_skipped_todo_and_only_tests_are_rejected', codes(GOOD.replace("test('[C2] behavior 2'", "test.skip('[C2] behavior 2'")).includes('SKIPPED_TEST') && codes(GOOD.replace("test('[C3] behavior 3'", "test.only('[C3] behavior 3'")).includes('SKIPPED_TEST'))
check('P15_a_test_with_no_assertion_or_only_a_trivial_one_is_rejected', codes(GOOD.replace("  assert.strictEqual(r.status, 200)\n}))\ntest('[C2]", "}))\ntest('[C2]")).includes('NO_ASSERTION') && codes(GOOD.replace("assert.strictEqual(r.status, 200)", "assert.ok(true)")).includes('TRIVIAL_ASSERTION'))
check('P16_every_test_must_trace_to_an_assigned_criterion_an_untagged_or_foreign_tag_is_rejected_before_execution', codes(GOOD.replace('[C1] behavior 1', 'behavior 1')).includes('UNTAGGED') && codes(GOOD.replace('[C1] behavior 1', '[C6] behavior 1')).includes('FOREIGN_CRITERION'))
check('P17_dropping_a_required_criterion_is_rejected_as_missing_coverage_so_weakening_by_omission_is_caught', codes(GOOD.replace(/test\('\[C4\][\s\S]*$/, '')).includes('MISSING_COVERAGE') && reviewTestFile(F1, GOOD.replace(/test\('\[C4\][\s\S]*$/, ''), plan).find((f) => f.code === 'MISSING_COVERAGE')!.detail.includes('C4'))
check('P18_a_test_that_does_not_use_withApp_is_rejected', codes(GOOD.replace("withApp(async (app) => {\n  const r = await app.get('/api/sessions')\n  assert.strictEqual(r.status, 200)\n})", "(async () => { assert.strictEqual(1, 2) })()")).includes('NO_WITHAPP'))
const UG = GOOD + `test('helper label wording', () => withApp(async (app) => { assert.strictEqual((await app.get('/')).status, 200) }))\n`
const dropped = dropUngrounded(F1, UG, ACC)
check('P19_ungrounded_tests_are_removed_BEFORE_execution_with_a_record_and_grounded_tests_stay', !!dropped && dropped.names.length === 1 && dropped.names[0] === 'helper label wording' && dropped.content.includes('REJECTED BEFORE EXECUTION') && dropped.content.includes('[C1] behavior 1') && dropUngrounded(F1, GOOD, ACC) === null)
check('P20_nothing_is_dropped_when_no_grounded_test_would_remain', dropUngrounded(F1, `import test from 'node:test'\ntest('only ungrounded', () => {})\n`, ACC) === null)
const GOOD2 = `import test from 'node:test'\nimport assert from 'node:assert'\nimport { withApp } from './support/harness.mjs'\n` + [5, 6].map((n) => `test('[C${n}] behavior ${n}', () => withApp(async (app) => {\n  assert.strictEqual((await app.get('/api/messages')).status, 200)\n}))\n`).join('')
check('P21_required_coverage_is_computed_from_the_final_files_a_missing_file_leaves_its_criteria_uncovered', uncoveredCriteria(plan, { [F1]: GOOD }, ACC).join() === '5,6' && uncoveredCriteria(plan, { [F1]: GOOD, [plan.files[1].path]: GOOD2 }, ACC).length === 0)

// ---- defect classification
const dc = (o: Partial<Parameters<typeof classifyTestDefect>[0]> = {}) => classifyTestDefect({ verifierPassed: true, grounded: true, message: 'AssertionError: 4 == 2', contradictsContract: false, ...o }).kind
check('P22_a_server_start_or_connection_failure_is_an_ENVIRONMENT_DEFECT_whatever_else_is_true', dc({ message: 'HARNESS_SERVER_NOT_READY: x' }) === 'ENVIRONMENT_DEFECT' && dc({ message: 'connect ECONNREFUSED 127.0.0.1:2' }) === 'ENVIRONMENT_DEFECT' && dc({ message: 'EADDRINUSE', verifierPassed: false }) === 'ENVIRONMENT_DEFECT')
check('P23_when_the_independent_verifier_does_not_pass_the_implementation_is_the_suspect', dc({ verifierPassed: false }) === 'IMPLEMENTATION_DEFECT')
check('P24_a_verifier_passing_implementation_never_makes_the_implementation_chase_a_test_an_ungrounded_or_contract_contradicting_test_is_a_TEST_DEFECT', dc({ grounded: false }) === 'TEST_DEFECT' && dc({ contradictsContract: true }) === 'TEST_DEFECT')
check('P25_a_grounded_failure_that_nothing_proves_wrong_stays_AMBIGUOUS', dc() === 'AMBIGUOUS')

// ---- reviewer role
check('P26_the_reviewer_verdict_parser_accepts_only_OK_or_REVISE_with_problems', parseReviewerVerdict('{"verdict":"OK"}')!.verdict === 'OK' && parseReviewerVerdict('noise {"verdict":"REVISE","problems":["a","b"]} tail')!.problems.length === 2 && parseReviewerVerdict('{"verdict":"MAYBE"}') === null && parseReviewerVerdict('no json') === null && parseReviewerVerdict('{"verdict":"REVISE"}') === null)
check('P27_the_reviewer_prompt_judges_against_the_plan_rows_only_and_asks_for_quotable_problems', reviewerPrompt(plan, F1, GOOD).includes('[C1]') && !reviewerPrompt(plan, F1, GOOD).includes('[C5]') && /do not write code/i.test(reviewerPrompt(plan, F1, GOOD)) && reviewerPrompt(plan, F1, GOOD).includes('"verdict"'))

// ---- clean classification
check('P28_clean_blockers_other_than_quarantine_also_keep_a_run_out_of_CLEAN_and_none_means_CLEAN', completionClass({ status: 'COMPLETED', quarantinedTests: 0, cleanBlockers: [] }, true) === 'CLEAN' && completionClass({ status: 'COMPLETED', quarantinedTests: 0, cleanBlockers: ['required criteria without a grounded passing test: C4'] }, true) === 'WITH_QUARANTINE' && completionClass({ status: 'COMPLETED', quarantinedTests: 0 }, false) === 'UNVERIFIED' && completionClass({ status: 'FAILED' }, null) === 'FAILED')
// ---- fix 1: storage-location recipe; fix 2: multi-status criteria become single-status clauses
const chatPrompt = planPromptFor(plan, plan.files[1].path)
check('P50_a_storage_location_row_carries_the_exact_recipe_the_default_path_and_the_warning_about_the_file_name', chatPrompt.includes("existsSync(app.storageFile('CHAT_DATA_FILE'))") && chatPrompt.includes("app.cwd + '/data/sessions.json'") && chatPrompt.includes('{ defaultStorage: true }') && /never assert anything about the name/.test(chatPrompt) && !planPromptFor(plan, plan.files[0].path).includes('STORAGE LOCATION RECIPE'))
const cl = (a: string) => clausesOf(a)
check('P51_a_criterion_naming_several_statuses_is_split_into_clauses_each_with_one_status_and_a_single_status_criterion_is_not_split', cl(CHAT_FEATURE.acceptance[0]).length === 2 && cl(CHAT_FEATURE.acceptance[0])[1] === 'rejects an empty name (400)' && cl(TASK_FEATURE.acceptance[1]).length === 4 && cl(TASK_FEATURE.acceptance[1]).slice(1).every((c) => (c.match(/\b[1-5]\d\d\b/g) ?? []).length === 1) && cl(TASK_FEATURE.acceptance[1])[0].includes('allowed moves') && cl(CHAT_FEATURE.acceptance[3]).length === 0 && cl('GET /api/x returns 404 for an unknown id').length === 0)
const tprompt = planPromptFor(tp, tp.files[0].path)
check('P52_the_plan_prompt_asks_for_one_test_per_clause_and_states_the_rule_to_reach_each_state_only_through_allowed_requests', tprompt.includes('CLAUSES (write ONE separate test per clause') && tprompt.includes('rejected with 409') && tprompt.includes('an unknown task id with 404') && /STATE RULE/.test(tprompt) && /one step at a time/.test(tprompt) && !planPromptFor(plan, plan.files[1].path).includes('CLAUSES ('))
const ca = correctionAcceptance(CHAT_FEATURE.acceptance)
check('P53_the_correction_list_keeps_the_original_criteria_in_place_and_appends_clauses_with_their_parent', ca.list.slice(0, 8).join('|') === CHAT_FEATURE.acceptance.join('|') && ca.list.length === 10 && ca.parent.slice(8).join() === '0,0' && ca.parent.slice(0, 8).join() === '0,1,2,3,4,5,6,7')
const perClause = `import test from 'node:test'\nimport assert from 'node:assert'\nimport { withApp } from './support/harness.mjs'\ntest('[C1] rejects an empty name (400)', () => withApp(async (app) => {\n  const r = await app.post('/api/sessions', { name: '' })\n  assert.strictEqual(r.status, 200)\n}))\n`
const failure = [{ line: 6, actual: '400', expected: '200' }]
const fixed = correctContractAssertions('test/c.test.mjs', perClause, failure, ca.list), unsplit = correctContractAssertions('test/c.test.mjs', perClause, failure, CHAT_FEATURE.acceptance)
check('P54_a_per_clause_test_with_a_wrong_status_is_corrected_against_its_own_clause_while_the_unsplit_criterion_stays_refused', !!fixed && fixed.corrections.length === 1 && fixed.corrections[0].to === 400 && fixed.content.includes('r.status, 400') && (!unsplit || unsplit.corrections.length === 0), JSON.stringify(fixed?.refused))
const combined = `import test from 'node:test'\nimport assert from 'node:assert'\nimport { withApp } from './support/harness.mjs'\ntest('[C1] creates a session and rejects an empty name', () => withApp(async (app) => {\n  const a = await app.post('/api/sessions', { name: 'x' })\n  assert.strictEqual(a.status, 201)\n  const r = await app.post('/api/sessions', { name: '' })\n  assert.strictEqual(r.status, 200)\n}))\n`
const comb = correctContractAssertions('test/c.test.mjs', combined, [{ line: 8, actual: '400', expected: '200' }], ca.list)
check('P55_a_test_that_spans_clauses_is_still_refused_the_fail_closed_rule_is_unchanged', !comb || comb.corrections.length === 0, JSON.stringify(comb?.corrections))
finish()
