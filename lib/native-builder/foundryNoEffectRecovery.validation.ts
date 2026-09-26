/**
 * Phase 2 Proof C blocker: a worker that keeps proposing an edit which would change nothing.
 * A no-op is evidence about the STRATEGY ("edit this file"), not proof the hypothesis is false. It must never write to disk, never count as
 * independent fresh attempts, force a materially different next move, and only after every distinct approach is exhausted become a capability block.
 * Pure: the runtime wiring is asserted textually; the live behaviour is proven by the Phase 2 live proof.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  NO_EFFECT_REPEAT,
  debugFilesFor,
  isolatedLayerEvidence,
  mergeRuledOut,
  noEffectExhausted,
  noEffectStatements,
  recordNoEffect,
  reopenAfterNoEffect,
  repeatedNoEffect,
  ruledOutStatements,
  verboseTestOutcomes,
  type NoEffectRecord,
} from './foundryGoalAnchor'
import { buildInitialPlan, linkHypothesis, revisePlan, PLAN_TRIGGER_SUMMARY, type CampaignTaskLike, type ComponentFilesLike } from './foundryEngineeringPlan'
import { backendUsesField, buildCampaignPlan, diskMeetsContract, implementationNeedsEdit, reviewCampaign } from './foundryEngineeringCampaign'
import { blockedSummaryFor, emptyCampaignProgress, ensureCampaignProgress, evaluateInvalidOutput, evaluateNoEffectiveChange, type CampaignProgress } from './foundryProgressEvaluation'
import { noEffectKey, parseSpecialistPayload } from './foundryEngineeringSpecialist'
import { resolveRepoRoot } from '@/lib/repo/paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`.trimEnd()) }

const repo = resolveRepoRoot()
const fixture = (rel: string) => readFileSync(path.join(repo, 'tmp/foundry-phase2/fixtures/c-final', rel), 'utf8')
const components: ComponentFilesLike = { contract: ['shared/contract.py'], backend: ['backend/api.py'], frontend: ['frontend/board.py'], tests: ['tests/test_rows.py'], database: [] }
const testSources = { 'tests/test_rows.py': fixture('tests/test_rows.py') }
const VERBOSE = `test_closed_rows_come_back (test_rows.RowTests.test_closed_rows_come_back) ... ok
test_every_closed_row_is_listed (test_rows.RowTests.test_every_closed_row_is_listed) ... FAIL
test_open_rows_come_back (test_rows.RowTests.test_open_rows_come_back) ... ok

======================================================================
FAIL: test_every_closed_row_is_listed (test_rows.RowTests.test_every_closed_row_is_listed)
----------------------------------------------------------------------
AssertionError: 'B' != 'B\\nC'
`
const at = '2026-09-25T12:00:00.000Z'
const noOp = (progress: CampaignProgress, file: string, repeated: boolean, exhausted: boolean, cycles = 1) => evaluateNoEffectiveChange(progress, { file, role: 'BACKEND', repeated, exhausted, at, mutationGeneration: 0, reworkCycles: cycles })

async function main() {
  const backend = fixture('backend/api.py')
  const noOpCall = (source: string) => parseSpecialistPayload({
    raw: JSON.stringify({ decision: 'TOOL', reasoningSummary: 'filter', tool: { name: 'file.replace_unique', args: { path: 'backend/api.py', matchText: 'return list(projects)', replacementText: 'return list(projects)' } } }),
    summary: 'filter', role: 'BACKEND', needsEdit: true, sources: new Map([['backend/api.py', source]]),
  })

  // ---- A. a single no-op never mutates disk and is typed, not just "invalid"
  const call = noOpCall(backend)
  check('A_a_no_op_proposal_produces_no_edit_and_is_typed', call.edit === null && call.failureClass === 'INVALID_OUTPUT' && call.noEffect?.file === 'backend/api.py' && call.noEffect.attempts === 1, JSON.stringify(call.noEffect))
  const realEdit = parseSpecialistPayload({ raw: JSON.stringify({ decision: 'TOOL', reasoningSummary: 'x', tool: { name: 'file.replace_unique', args: { path: 'backend/api.py', matchText: 'return list(projects)', replacementText: 'return [p for p in projects]' } } }), summary: 'x', role: 'BACKEND', needsEdit: true, sources: new Map([['backend/api.py', backend]]) })
  check('A_a_real_edit_is_never_typed_as_no_effect', realEdit.failureClass === null && !realEdit.noEffect && Boolean(realEdit.edit), '')
  const unknownFile = parseSpecialistPayload({ raw: JSON.stringify({ decision: 'TOOL', reasoningSummary: 'x', tool: { name: 'file.replace_unique', args: { path: 'nope.py', matchText: 'a', replacementText: 'a' } } }), summary: 'x', role: 'BACKEND', needsEdit: true, sources: new Map([['backend/api.py', backend]]) })
  check('A_a_no_op_outside_the_working_set_is_not_typed_as_no_effect', !unknownFile.noEffect, '')
  const first = recordNoEffect(undefined, { file: 'backend/api.py', layer: 'backend', key: noEffectKey('return list(projects)') })
  const firstEval = noOp(emptyCampaignProgress(), 'backend/api.py', first.repeated, false)
  check('A_the_first_no_op_keeps_the_mission_alive_and_is_not_stagnation', !first.repeated && firstEval.decision.proceed && firstEval.decision.stop === null && firstEval.progress.classification !== 'BLOCKED_CAPABILITY', firstEval.decision.summary)
  check('A_no_op_is_not_counted_as_invalid_output', firstEval.progress.invalidOutputTotal === 0 && firstEval.progress.invalidOutputStreak === 0 && firstEval.progress.noEffectTotal === 1, '')

  // ---- B. repeated identical no-ops are ONE ineffective strategy
  const second = recordNoEffect(first.records, { file: 'backend/api.py', layer: 'backend', key: noEffectKey('return list(projects)') })
  check('B_a_repeat_against_the_same_file_is_the_same_ineffective_strategy', second.repeated && second.sameProposal && second.records.length === 1 && second.record.attempts === NO_EFFECT_REPEAT, JSON.stringify(second.record))
  const inCall = recordNoEffect(undefined, { file: 'backend/api.py', layer: 'backend', key: 'k', attempts: 2 })
  check('B_a_proposal_and_its_correction_both_changing_nothing_is_already_repeated', inCall.repeated && inCall.records.length === 1, '')
  check('B_four_no_ops_are_one_strategy_not_four_fresh_attempts', (() => { let r: NoEffectRecord[] | undefined; for (let i = 0; i < 4; i += 1) r = recordNoEffect(r, { file: 'backend/api.py', layer: 'backend', key: 'k' }).records; return r!.length === 1 && r![0].attempts === 4 && repeatedNoEffect(r).length === 1 })(), '')
  const repeatedEval = noOp(firstEval.progress, 'backend/api.py', true, false, 2)
  check('B_a_repeat_counts_as_stagnating_strategy_evidence', repeatedEval.progress.classification === 'STAGNATING' && repeatedEval.progress.noEffectSwitches === 1 && repeatedEval.progress.observations.at(-1)?.kind === 'NO_EFFECTIVE_CHANGE' && repeatedEval.progress.observations.at(-1)?.strategy === 'NO_MUTATION', repeatedEval.decision.summary)
  check('B_the_repeat_is_told_to_the_next_attempt_in_plain_words', noEffectStatements(second.records)[0]?.includes('backend/api.py') === true && repeatedEval.progress.triedSummaries.some(item => item.includes('would not change')) && repeatedEval.progress.notes.some(note => /different approach/.test(note.text)), noEffectStatements(second.records)[0])

  // ---- C. a no-op alone never proves the hypothesis false
  const plan0 = buildInitialPlan({ request: 'Update item status filtering', acceptance: ['status closed returns only closed rows'], tasks: buildCampaignPlan({ contract: components.contract, backend: components.backend, frontend: components.frontend, tests: components.tests ?? [], database: [] } as never, 'Update item status filtering').tasks as unknown as CampaignTaskLike[], components, at })
  const plan1 = revisePlan(plan0, { at, trigger: 'NO_EFFECTIVE_CHANGE', summary: PLAN_TRIGGER_SUMMARY.NO_EFFECTIVE_CHANGE, evidence: ['backend/api.py: the proposed edit would have changed nothing'], components })
  check('C_a_no_op_revises_the_plan_as_no_effective_change_never_as_disproven', plan1.revisions.at(-1)?.trigger === 'NO_EFFECTIVE_CHANGE' && !plan1.revisions.some(r => r.trigger === 'HYPOTHESIS_DISPROVEN' || r.trigger === 'CONTRADICTION' || r.trigger === 'EDIT_INEFFECTIVE'), plan1.revisions.map(r => r.trigger).join(','))
  check('C_no_verbose_output_means_no_evidence', isolatedLayerEvidence({ layer: 'backend', components, verboseOutput: "F\nAssertionError: 'B' != 'B\\nC'\n", testSources }) === null, '')
  check('C_a_file_is_ruled_out_only_inside_the_evidence_branch', (() => {
    const src = readFileSync(path.join(repo, 'lib/native-builder/foundryEngineeringRuntime.ts'), 'utf8').replace(/\r\n/g, '\n')
    const handler = src.slice(src.indexOf('const handleNoEffectiveChange'), src.indexOf('const UNBLOCK'))
    const at = handler.indexOf('state.ruledOut = mergeRuledOut')
    return at > 0 && handler.split('state.ruledOut = mergeRuledOut').length === 2 && handler.lastIndexOf('if (evidence) {', at) > 0 && handler.lastIndexOf('} else {', at) < handler.lastIndexOf('if (evidence) {', at)
  })(), '')

  // ---- D. a repeat forces a materially different next move
  check('D_the_working_set_puts_other_layers_before_the_ineffective_file', debugFilesFor(components, [], second.records)[0] === 'frontend/board.py' && debugFilesFor(components, [], undefined)[0] === 'backend/api.py', debugFilesFor(components, [], second.records).join(','))
  check('D_the_ineffective_layer_is_not_reopened_the_other_layer_is', reopenAfterNoEffect(['backend'], [], second.records, components).join() === 'frontend' && reopenAfterNoEffect(['backend'], [], first.records, components).join() === 'backend', reopenAfterNoEffect(['backend'], [], second.records, components).join())
  check('D_the_named_layers_still_win_when_they_are_not_ineffective', reopenAfterNoEffect(['backend', 'frontend'], [], second.records, components).join() === 'frontend', '')

  // ---- E. bounded alternate strategies are attempted before BLOCKED_CAPABILITY
  const backendOnly = recordNoEffect(undefined, { file: 'backend/api.py', layer: 'backend', key: 'a', attempts: 2 }).records
  check('E_one_ineffective_strategy_is_not_exhaustion', !noEffectExhausted(backendOnly, components), '')
  const bothLayers = recordNoEffect(backendOnly, { file: 'frontend/board.py', layer: 'frontend', key: 'b', attempts: 2 }).records
  check('E_every_editable_layer_ineffective_is_exhaustion', noEffectExhausted(bothLayers, components), '')
  const stopped = noOp(repeatedEval.progress, 'frontend/board.py', true, true, 3)
  check('E_exhaustion_is_a_capability_block_not_stagnation', !stopped.decision.proceed && stopped.decision.stop?.reason === 'CAPABILITY_NO_EFFECTIVE_CHANGE' && stopped.decision.classification === 'BLOCKED_CAPABILITY' && blockedSummaryFor('CAPABILITY_NO_EFFECTIVE_CHANGE') === 'BLOCKED_CAPABILITY', stopped.decision.stop?.message.slice(0, 80))
  const three = ['a.py', 'b.py', 'c.py'].reduce<NoEffectRecord[] | undefined>((acc, file) => recordNoEffect(acc, { file, layer: 'other', key: file, attempts: 2 }).records, undefined)
  check('E_three_distinct_ineffective_files_are_exhaustion_even_without_layers', noEffectExhausted(three, { contract: [], backend: [], frontend: [] }), '')
  // the old behaviour: the fourth unusable output blocked everything. Four no-op proposals against one file now do not.
  let old = emptyCampaignProgress(); let oldStopped = false
  for (let i = 0; i < 4; i += 1) { const v = evaluateInvalidOutput(old, { role: 'BACKEND', summary: 'x', at, mutationGeneration: 0, reworkCycles: i }); old = v.progress; oldStopped = oldStopped || !v.decision.proceed }
  let now = emptyCampaignProgress(); let nowStopped = false; let recs: NoEffectRecord[] | undefined
  for (let i = 0; i < 4; i += 1) { const r = recordNoEffect(recs, { file: 'backend/api.py', layer: 'backend', key: 'k' }); recs = r.records; const v = noOp(now, 'backend/api.py', r.repeated, noEffectExhausted(recs, components), i + 1); now = v.progress; nowStopped = nowStopped || !v.decision.proceed }
  check('E_the_old_path_blocked_on_four_no_ops_the_new_path_does_not', oldStopped && !nowStopped, `old=${oldStopped} new=${nowStopped}`)

  // ---- F. restart restores no-op evidence
  const persisted = JSON.parse(JSON.stringify({ noEffect: second.records, progress: repeatedEval.progress }))
  const restoredProgress = ensureCampaignProgress({ progress: persisted.progress })
  const continued = recordNoEffect(persisted.noEffect, { file: 'backend/api.py', layer: 'backend', key: 'k2' })
  check('F_no_effect_records_and_stagnation_evidence_survive_a_restart', restoredProgress.noEffectTotal === repeatedEval.progress.noEffectTotal && restoredProgress.noEffectSwitches === 1 && restoredProgress.triedSummaries.length > 0 && continued.record.attempts === 3 && continued.repeated, `attempts=${continued.record.attempts}`)
  check('F_an_old_record_without_the_fields_resumes_with_safe_defaults', (() => { const old = { ...emptyCampaignProgress() } as Partial<CampaignProgress>; delete old.noEffectTotal; delete old.noEffectSwitches; const r = ensureCampaignProgress({ progress: old }); return r.noEffectTotal === 0 && r.noEffectSwitches === 0 })(), '')

  // ---- G. once alternate evidence truly disproves the hypothesis, the disproval and the contradiction can still fire
  const evidence = isolatedLayerEvidence({ layer: 'backend', components, verboseOutput: VERBOSE, testSources })
  check('G_tests_that_call_the_backend_directly_pass_while_the_failure_goes_through_the_frontend', Boolean(evidence) && evidence!.passing.length === 2 && evidence!.failing.join() === 'test_every_closed_row_is_listed' && evidence!.suspectLayers.join() === 'frontend', JSON.stringify(evidence))
  check('G_the_frontend_test_does_not_clear_the_frontend', isolatedLayerEvidence({ layer: 'frontend', components, verboseOutput: VERBOSE, testSources }) === null, '')
  check('G_a_failure_that_only_calls_the_layer_itself_is_not_exonerating', isolatedLayerEvidence({ layer: 'backend', components, verboseOutput: VERBOSE.replace('test_every_closed_row_is_listed (test_rows.RowTests.test_every_closed_row_is_listed) ... FAIL', 'test_open_rows_come_back (test_rows.RowTests.test_open_rows_come_back) ... FAIL').replace(/test_open_rows_come_back \(test_rows.RowTests.test_open_rows_come_back\) \.\.\. ok\n$/m, ''), testSources }) === null, '')
  check('G_unreadable_test_source_is_never_evidence', isolatedLayerEvidence({ layer: 'backend', components, verboseOutput: VERBOSE, testSources: {} }) === null, '')
  check('G_verbose_output_is_parsed_per_test', verboseTestOutcomes(VERBOSE).map(o => `${o.name}:${o.result}`).join() === 'test_closed_rows_come_back:ok,test_every_closed_row_is_listed:FAIL,test_open_rows_come_back:ok', '')
  const ruled = mergeRuledOut(undefined, [{ file: 'backend/api.py', layer: 'backend', basis: 'ISOLATED_TESTS' }])
  check('G_evidence_based_rule_out_is_worded_as_evidence_not_as_an_edit_that_was_made', ruledOutStatements(ruled)[0].startsWith('The tests that call backend/api.py directly pass') && !/I changed/.test(ruledOutStatements(ruled)[0]), ruledOutStatements(ruled)[0])
  check('G_after_evidence_the_working_set_starts_at_the_frontend', debugFilesFor(components, ruled, second.records)[0] === 'frontend/board.py', '')
  let plan = revisePlan(plan1, { at, trigger: 'HYPOTHESIS_DISPROVEN', summary: PLAN_TRIGGER_SUMMARY.HYPOTHESIS_DISPROVEN, evidence: ['The tests that call backend/api.py directly pass'], components })
  plan = revisePlan(plan, { at, trigger: 'CONTRADICTION', summary: PLAN_TRIGGER_SUMMARY.CONTRADICTION, evidence: ['The failing test goes through the frontend'], reopen: [{ taskId: 'frontend', why: 'The failing test goes through the frontend.' }], components })
  check('G_disproven_and_contradiction_revisions_are_recorded_after_the_no_effect_revision', plan.revisions.map(r => r.trigger).join(',').endsWith('NO_EFFECTIVE_CHANGE,HYPOTHESIS_DISPROVEN,CONTRADICTION') && plan.revisions.at(-1)?.changes.some(c => c.op === 'REOPEN' && c.taskId === 'frontend') === true, plan.revisions.map(r => r.trigger).join(','))
  check('G_the_plan_can_still_link_a_frontend_hypothesis', linkHypothesis(plan, 'frontend', 'the board truncates rows', 'frontend/board.py').tasks.find(t => t.id === 'frontend')?.repairTarget === 'frontend/board.py', '')

  // ---- H. a legitimately incapable model still reaches the capability block, after bounded distinct strategies
  let progress = emptyCampaignProgress(); let records: NoEffectRecord[] | undefined; const trace: string[] = []
  for (const file of ['backend/api.py', 'frontend/board.py']) {
    const r = recordNoEffect(records, { file, layer: file.startsWith('backend') ? 'backend' : 'frontend', key: file, attempts: 2 }); records = r.records
    const v = noOp(progress, file, r.repeated, noEffectExhausted(records, components), trace.length + 1); progress = v.progress; trace.push(v.decision.proceed ? 'switch' : v.decision.stop!.reason)
  }
  check('H_incapable_model_switches_once_then_is_blocked_as_capability', trace.join() === 'switch,CAPABILITY_NO_EFFECTIVE_CHANGE' && progress.classification === 'BLOCKED_CAPABILITY', trace.join())

  // ---- R. a semantically equivalent backend is not a reason for a reviewer chase
  const contractText = fixture('shared/contract.py')
  const withDefault = 'def list_projects(projects, status=None):\n    if status is None:\n        return list(projects)\n    return [item for item in projects if item.get("status", "") == status]\n'
  const board = fixture('frontend/board.py')
  check('R_a_get_with_a_default_still_reads_the_contract_field', backendUsesField(withDefault, 'status') && backendUsesField(backend, 'status') && !backendUsesField('def f(x):\n    return x.get("state", "")\n', 'status'), '')
  check('R_the_disk_meets_the_contract_with_a_defaulted_get_so_a_repeated_claim_is_settled', diskMeetsContract(contractText, withDefault, board) && diskMeetsContract(contractText, backend, board), '')
  check('R_a_defaulted_get_is_not_treated_as_an_unfiltered_backend_needing_an_edit', !implementationNeedsEdit('BACKEND', withDefault, contractText, null), '')
  check('R_the_review_heuristic_agrees', reviewCampaign({ backend: withDefault, frontend: board, contracts: [contractText], mutated: [], dirty: [] }).every(f => !/contract field/.test(f)), '')
  check('R_a_backend_that_ignores_the_field_still_fails_the_contract', !diskMeetsContract(contractText, 'def list_projects(projects, status=None):\n    return list(projects)\n', board), '')

  // ---- presentation: nothing raw in the Commander-facing sentence
  const sentence = PLAN_TRIGGER_SUMMARY.NO_EFFECTIVE_CHANGE
  check('P_the_main_thread_sentence_has_no_raw_names', !/[A-Z][A-Z_]{4,}|replacementText|matchText|mutationGeneration|fingerprint/.test(sentence) && sentence.length > 20, sentence)

  // ---- production wiring
  const runtime = readFileSync(path.join(repo, 'lib/native-builder/foundryEngineeringRuntime.ts'), 'utf8').replace(/\r\n/g, '\n')
  const noEffectBranch = runtime.indexOf('call.noEffect && (current.role')
  check('W_the_no_effect_branch_runs_before_any_edit_is_applied_and_before_the_invalid_output_streak', noEffectBranch > 0 && noEffectBranch < runtime.indexOf('const reopened = openModelRework(`invalid specialist output') && noEffectBranch < runtime.indexOf('await applyModelEdit(current, call.edit'), '')
  check('W_only_implementer_roles_take_the_no_effect_path', runtime.includes("call.failureClass === 'INVALID_OUTPUT' && call.noEffect && (current.role === 'BACKEND' || current.role === 'FRONTEND')"), '')
  check('W_the_handler_records_persists_and_evaluates_the_strategy', ['recordNoEffect(state.noEffect,', 'state.noEffect = recorded.records', 'evaluateNoEffectiveChange(state.progress', "revisePlanFor('NO_EFFECTIVE_CHANGE'", 'noEffectExhausted(state.noEffect, state.componentFiles)'].every(part => runtime.includes(part)), '')
  check('W_hypothesis_disproven_is_reached_only_through_evidence', (() => { const at = runtime.indexOf("planTrigger = 'HYPOTHESIS_DISPROVEN'"); const gate = runtime.lastIndexOf('if (evidence) {', at); return at > 0 && gate > 0 && at - gate < 900 && runtime.split("planTrigger = 'HYPOTHESIS_DISPROVEN'").length === 2 })(), '')
  check('W_alternate_evidence_is_one_governed_bounded_command_per_file_and_generation', ['gatherIsolationEvidence', '`${file}@${state.mutationGeneration}`', "'unittest', 'discover', '-s', 'tests', '-v'", 'state.commandsRun >= commandLimit()'].every(part => runtime.includes(part)), '')
  check('W_the_rework_reorders_the_working_set_and_avoids_reopening_the_ineffective_layer', runtime.includes('debugFilesFor(state.componentFiles, state.ruledOut, state.noEffect)') && runtime.includes('reopenAfterNoEffect(reworkImplementationIds(finding), state.ruledOut, state.noEffect, state.componentFiles)'), '')
  check('W_the_original_failure_stays_the_evidence_for_the_signature', runtime.includes("(trigger === 'INVALID_OUTPUT' || trigger === 'NO_EFFECTIVE_CHANGE') && state.repairFinding"), '')
  check('W_the_no_effect_stop_has_an_unblock_message', runtime.includes('CAPABILITY_NO_EFFECTIVE_CHANGE:'), '')
  const specialist = readFileSync(path.join(repo, 'lib/native-builder/foundryEngineeringSpecialist.ts'), 'utf8').replace(/\r\n/g, '\n')
  check('W_the_prompt_carries_the_ineffective_strategy', specialist.includes('...noEffectStatements(campaign.noEffect)'), '')
  const live = readFileSync(path.join(repo, 'lib/native-builder/foundryLiveProgress.ts'), 'utf8')
  check('W_a_no_effective_change_is_a_real_replan_in_live_progress', live.includes("'NO_EFFECTIVE_CHANGE'"), '')

  const failed = results.filter(r => !r.pass)
  console.log(`NO_EFFECT_RECOVERY_VALIDATION ${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}
main()
