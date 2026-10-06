/** Phase 10 continuation: evidence-driven debugging (real commands, real failing tests). Run: pnpm run validate:agent-eng-debugging */
import path from 'node:path'
import { harness, engWorld, addAgent, draftFor, C, NOW, tmp } from './engtestkit'
import { AgentOpsLog } from '../log'
import { assign, startAssignment } from './assignments'
import { Workspace } from './runtime/workspaceFs'
import { runCommand } from './runtime/commandRunner'
import { makeNotesApp } from './fixtures'
import { buildWorkspaceIndex } from './workspaceIndex'
import { DebugError, MAX_REPAIR_ATTEMPTS, addEvidence, authorizeRepair, debugEntries, debugSummary, deriveLedger, detectWrongTest, markUndetermined, parseToolOutput, proposeHypothesis, recordFailure, recordRepair, recordValidation } from './debugLedger'
import type { EngineeringTool } from '../types'

const { check, finish } = harness('AGENT_ENG_DEBUGGING_VALIDATION')
const TOOLS: EngineeringTool[] = ['read_workspace', 'write_workspace', 'run_workspace_tests', 'run_typecheck', 'model_local', 'read_runtime_output']
const S = 'system:runner'
const code = (fn: () => unknown) => { try { fn(); return 'none' } catch (e) { return e instanceof DebugError ? e.code : 'other' } }

const root = makeNotesApp(path.join(tmp(), 'app'))
const ws = new Workspace(root)
ws.write('test/pin.test.mjs', `import test from 'node:test'
import assert from 'node:assert'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
process.env.NOTES_DATA_FILE = path.join(mkdtempSync(path.join(tmpdir(), 'pin-')), 'notes.json')
const svc = await import('../src/notesService.mjs')

test('a pinned note stays pinned after reload', () => {
  const n = svc.addNote({ text: 'remember me' })
  svc.pinNote(n.id)
  const reloaded = svc.listNotes().find((x) => x.id === n.id)
  assert.strictEqual(reloaded.pinned, true)
})
`)
const w = engWorld(); const ag = addAgent(w, 'agent-dbg'); const asg = assign(w.log, draftFor(ag.id, 'md', 'pin notes'), C, NOW).assignment; startAssignment(w.log, asg.id, S, NOW)
const REPRO = ['node', '--test', 'test/pin.test.mjs']
const run = () => runCommand(root, REPRO, TOOLS, { timeoutMs: 30_000 })

// ---- real failure #1: pinNote does not exist
const r1 = await run()
const parsed1 = parseToolOutput(r1.stdout, r1.stderr)
check('M01_the_real_failing_run_is_parsed_into_test_counts_and_failure_names', r1.exitCode !== 0 && parsed1.tests === 1 && parsed1.fail === 1 && parsed1.failures[0].name.includes('pinned note stays pinned'), JSON.stringify({ tests: parsed1.tests, fail: parsed1.fail, f: parsed1.failures[0] }))
check('M02_narrative_or_refused_or_successful_commands_cannot_become_failures', code(() => recordFailure(w.log, asg.id, { argv: [], cwd: '', exitCode: 1, timedOut: false, stdout: 'it broke', stderr: '', durationMs: 0, startedAt: '', outputHash: '' }, S, NOW)) === 'NOT_A_REAL_RUN' && code(() => recordFailure(w.log, asg.id, { ...r1, refused: 'x' }, S, NOW)) === 'NOT_A_REAL_RUN' && code(() => recordFailure(w.log, asg.id, { ...r1, exitCode: 0 }, S, NOW)) === 'INVALID')
const f1 = recordFailure(w.log, asg.id, r1, S, NOW)
const led1 = deriveLedger(w.log, asg.id).failures.get(f1.failureId)!
check('M03_failure_records_the_exact_command_exit_output_hash_and_targeted_test', JSON.stringify(led1.argv) === JSON.stringify(REPRO) && led1.exitCode === r1.exitCode && led1.outputHash === r1.outputHash && led1.testsTargeted.includes('test/pin.test.mjs') && led1.testsRun === 1 && led1.excerpt.length > 0 && led1.signature.includes('pinned note stays pinned'))
check('M04_signature_is_stable_across_reruns_with_different_timings_and_paths', recordFailure(w.log, asg.id, await run(), S, NOW).signature === f1.signature)
check('M05_the_same_run_is_not_recorded_twice', recordFailure(w.log, asg.id, r1, S, NOW).duplicate)

// ---- evidence and hypotheses
const svcText = ws.read('src/notesService.mjs')
const e1 = addEvidence(w.log, asg.id, f1.failureId, { kind: 'test_result', ref: 'test/pin.test.mjs', content: r1.stdout, summary: 'failing test message: pinNote is not a function' }, S, NOW)
const e2 = addEvidence(w.log, asg.id, f1.failureId, { kind: 'file_read', ref: 'src/notesService.mjs', content: svcText, summary: 'notesService exports no pinNote' }, S, NOW)
const eUi = addEvidence(w.log, asg.id, f1.failureId, { kind: 'browser_console', ref: 'http://127.0.0.1/', summary: 'no browser console in this run', available: false, unavailableReason: 'no browser attached to this environment' }, S, NOW)
check('M06_unavailable_evidence_is_recorded_as_unavailable_with_a_reason_never_fabricated', !eUi.available && eUi.unavailableReason!.includes('no browser') && code(() => addEvidence(w.log, asg.id, f1.failureId, { kind: 'network', ref: 'x', summary: 'x', available: false }, S, NOW)) === 'INVALID')
check('M07_hypothesis_needs_recorded_available_evidence', code(() => proposeHypothesis(w.log, asg.id, f1.failureId, { statement: 'pinNote is missing', supporting: [] }, S, NOW)) === 'NEEDS_EVIDENCE' && code(() => proposeHypothesis(w.log, asg.id, f1.failureId, { statement: 'x', supporting: ['ev-nope'] }, S, NOW)) === 'NEEDS_EVIDENCE' && code(() => proposeHypothesis(w.log, asg.id, f1.failureId, { statement: 'x', supporting: [eUi.id] }, S, NOW)) === 'NEEDS_EVIDENCE')
const h1 = proposeHypothesis(w.log, asg.id, f1.failureId, { statement: 'pinNote is not implemented, so the test throws before reaching persistence', supporting: [e1.id, e2.id] }, S, NOW)

// ---- repair attempt 1 (real edit): implement pinNote but forget to persist
check('M08_first_repair_is_authorized_with_a_hypothesis', authorizeRepair(w.log, asg.id, f1.failureId, { hypothesisId: h1, newEvidence: [], differsFromPrevious: null, files: ['src/notesService.mjs'] }).ok)
const edit1 = ws.write('src/notesService.mjs', svcText + `\nexport function pinNote(id) {\n  const notes = loadNotes()\n  const n = notes.find((x) => x.id === id)\n  if (n) n.pinned = true\n  return n\n}\n`)
const rep1 = recordRepair(w.log, asg.id, f1.failureId, { hypothesisId: h1, filesEdited: [{ path: 'src/notesService.mjs', afterHash: edit1.afterHash }], rationale: 'add pinNote that sets pinned on the note', differsFromPrevious: null, newEvidence: [] }, S, NOW)
const idx = buildWorkspaceIndex(root)
const v1 = recordValidation(w.log, asg.id, f1.failureId, rep1.repairId, await run(), { changedFiles: ['src/notesService.mjs'], index: idx }, S, NOW)
check('M09_validation_reruns_the_original_reproducer_and_detects_the_failure_changed_not_fixed', v1.outcome === 'NEW_FAILURE' && !!v1.signature && v1.signature !== f1.signature && JSON.stringify(v1.argv) === JSON.stringify(REPRO) && v1.note.includes('changed'), `${v1.outcome} ${v1.signature?.slice(0, 120)}`)
check('M10_only_the_original_command_may_be_used_to_validate', await (async () => { try { recordValidation(w.log, asg.id, f1.failureId, rep1.repairId, await runCommand(root, ['node', '--test', 'test/notesService.test.mjs'], TOOLS), { changedFiles: [], index: idx }, S, NOW); return 'none' } catch (e) { return e instanceof DebugError ? e.code : 'other' } })() === 'INVALID')

// ---- repeated edit without new evidence is blocked; new evidence + explanation unlocks it
const blocked = authorizeRepair(w.log, asg.id, f1.failureId, { hypothesisId: h1, newEvidence: [e1.id, e2.id], differsFromPrevious: 'try again', files: ['src/notesService.mjs'] })
check('M11_second_attempt_with_only_old_evidence_is_blocked', !blocked.ok && blocked.code === 'REPEATED_EDIT_WITHOUT_NEW_EVIDENCE' && code(() => recordRepair(w.log, asg.id, f1.failureId, { hypothesisId: h1, filesEdited: [], rationale: 'again', differsFromPrevious: 'again', newEvidence: [e1.id] }, S, NOW)) === 'REPEATED_EDIT_WITHOUT_NEW_EVIDENCE')
const f2 = recordFailure(w.log, asg.id, await run(), S, NOW)
const e3 = addEvidence(w.log, asg.id, f1.failureId, { kind: 'test_result', ref: 'test/pin.test.mjs#attempt2', content: v1.signature ?? '', summary: `after attempt 1 the failure is: ${v1.signature?.slice(0, 120)} (pinned flag is lost on reload: pinNote never saves)` }, S, NOW)
const h2 = proposeHypothesis(w.log, asg.id, f1.failureId, { statement: 'pinNote mutates the loaded array but never calls saveNotes, so nothing persists', supporting: [e3.id, e2.id], revisionOf: h1, whyRevised: 'attempt 1 made the call succeed but the reload still lacks pinned: persistence is the actual gap' }, S, NOW)
check('M12_revising_a_hypothesis_refutes_the_earlier_one_with_the_reason', deriveLedger(w.log, asg.id).hypotheses.get(h1)!.status === 'REFUTED' && deriveLedger(w.log, asg.id).hypotheses.get(h1)!.reason.includes('persistence is the actual gap'))
check('M13_a_revised_hypothesis_must_reference_the_earlier_one_and_say_what_changed', code(() => proposeHypothesis(w.log, asg.id, f1.failureId, { statement: 'z', supporting: [e3.id], revisionOf: 'hyp-nope', whyRevised: 'x' }, S, NOW)) === 'INVALID' && code(() => proposeHypothesis(w.log, asg.id, f1.failureId, { statement: 'y', supporting: [e3.id], revisionOf: h1 }, S, NOW)) === 'INVALID' && deriveLedger(w.log, asg.id).hypotheses.get(h2)!.revisionOf === h1)
const ok2 = authorizeRepair(w.log, asg.id, f1.failureId, { hypothesisId: h2, newEvidence: [e3.id], differsFromPrevious: 'attempt 1 only set the flag in memory; attempt 2 also persists with saveNotes', files: ['src/notesService.mjs'] })
check('M14_new_evidence_plus_an_explanation_of_why_it_differs_unlocks_the_next_attempt', ok2.ok && (ok2 as { attempt: number }).attempt === 2)
const edit2 = ws.write('src/notesService.mjs', ws.read('src/notesService.mjs').replace('if (n) n.pinned = true\n  return n', 'if (n) { n.pinned = true; saveNotes(notes) }\n  return n'))
const rep2 = recordRepair(w.log, asg.id, f1.failureId, { hypothesisId: h2, filesEdited: [{ path: 'src/notesService.mjs', afterHash: edit2.afterHash }], rationale: 'persist the pinned flag with saveNotes', differsFromPrevious: 'attempt 1 only set the flag in memory; attempt 2 also persists with saveNotes', newEvidence: [e3.id] }, S, NOW)
const v2 = recordValidation(w.log, asg.id, f1.failureId, rep2.repairId, await run(), { changedFiles: ['src/notesService.mjs'], index: buildWorkspaceIndex(root) }, S, NOW)
check('M15_the_repair_is_validated_against_the_original_failure_and_only_then_called_fixed', v2.outcome === 'ORIGINAL_FIXED' && v2.exitCode === 0 && v2.testsRun === 1 && deriveLedger(w.log, asg.id).hypotheses.get(h2)!.status === 'SUPPORTED', v2.note)
void f2
const sum = debugSummary(w.log, asg.id).find((s) => s.failureId === f1.failureId)!
check('M16_summary_states_exact_command_state_hypotheses_and_why_each_repair_differs', sum.state === 'FIXED' && sum.command === REPRO.join(' ') && sum.attempts === 2 && sum.hypotheses.length === 2 && sum.whyEachRepairDiffers[0].differs === 'first attempt' && sum.whyEachRepairDiffers[1].differs.includes('persists') && sum.unavailableEvidence.some((u) => u.includes('browser_console')))
// existing test suite must still pass: no regression
const reg = await runCommand(root, ['node', '--test', 'test/notesService.test.mjs'], TOOLS)
check('M17_regression_suite_still_passes_after_the_repair', reg.exitCode === 0)

// ---- same-failure persistence refutes the hypothesis; budget exhaustion => UNDETERMINED
const w2 = engWorld(); const ag2 = addAgent(w2, 'agent-d2'); const asg2 = assign(w2.log, draftFor(ag2.id, 'md2', 'stubborn bug'), C, NOW).assignment; startAssignment(w2.log, asg2.id, S, NOW)
const root2 = makeNotesApp(path.join(tmp(), 'app2')); const ws2 = new Workspace(root2)
ws2.write('test/bug.test.mjs', "import test from 'node:test'\nimport assert from 'node:assert'\ntest('always fails', () => { assert.strictEqual(1 + 1, 3) })\n")
const run2 = () => runCommand(root2, ['node', '--test', 'test/bug.test.mjs'], TOOLS)
const g1 = recordFailure(w2.log, asg2.id, await run2(), S, NOW)
const ge = [1, 2, 3, 4].map((i) => addEvidence(w2.log, asg2.id, g1.failureId, { kind: 'file_read', ref: `file${i}`, content: `c${i}`, summary: `evidence ${i}` }, S, NOW))
let hyp = proposeHypothesis(w2.log, asg2.id, g1.failureId, { statement: 'arithmetic helper is off by one', supporting: [ge[0].id] }, S, NOW)
const validations: string[] = []
for (let i = 1; i <= MAX_REPAIR_ATTEMPTS; i++) {
  const ed = ws2.write('src/helper.mjs', `export const n = ${i}\n`)
  const r = recordRepair(w2.log, asg2.id, g1.failureId, { hypothesisId: hyp, filesEdited: [{ path: 'src/helper.mjs', afterHash: ed.afterHash }], rationale: `attempt ${i}`, differsFromPrevious: i === 1 ? null : `attempt ${i} edits a different thing than attempt ${i - 1}`, newEvidence: i === 1 ? [] : [ge[i - 1].id] }, S, NOW)
  const v = recordValidation(w2.log, asg2.id, g1.failureId, r.repairId, await run2(), { changedFiles: ['src/helper.mjs'], index: null }, S, NOW)
  validations.push(v.outcome)
  if (i < MAX_REPAIR_ATTEMPTS) hyp = proposeHypothesis(w2.log, asg2.id, g1.failureId, { statement: `hypothesis ${i + 1}`, supporting: [ge[i].id], revisionOf: hyp, whyRevised: `evidence ${i + 1} contradicts the previous hypothesis` }, S, NOW)
}
const led2 = deriveLedger(w2.log, asg2.id)
check('M18_a_hypothesis_whose_repair_leaves_the_failure_unchanged_is_REFUTED', validations.every((v) => v === 'SAME_FAILURE') && [...led2.hypotheses.values()].filter((h) => h.status === 'REFUTED').length === MAX_REPAIR_ATTEMPTS)
check('M19_budget_exhaustion_marks_UNDETERMINED_instead_of_manufacturing_a_root_cause', led2.undetermined.has(g1.failureId) && led2.undetermined.get(g1.failureId)!.attempts === MAX_REPAIR_ATTEMPTS && debugSummary(w2.log, asg2.id)[0].state === 'UNDETERMINED' && !authorizeRepair(w2.log, asg2.id, g1.failureId, { hypothesisId: hyp, newEvidence: [ge[3].id], differsFromPrevious: 'x', files: [] }).ok)
const gate = authorizeRepair(w2.log, asg2.id, g1.failureId, { hypothesisId: hyp, newEvidence: [ge[3].id], differsFromPrevious: 'x', files: [] })
check('M20_a_refuted_or_exhausted_path_cannot_be_repaired_again', !gate.ok && (gate.code === 'BUDGET_EXHAUSTED' || gate.code === 'NEEDS_EVIDENCE'))

// ---- wrong test / vacuous
writeEmpty(ws)
function writeEmpty(x: Workspace) { x.write('test/empty.test.mjs', "// no tests here\nconsole.log('hello')\n") }
const emptyRun = await runCommand(root, ['node', '--test', 'test/empty.test.mjs'], TOOLS)
const wt = detectWrongTest(emptyRun, ['src/notesService.mjs'], idx)
check('M21_a_run_that_executes_zero_tests_is_flagged_as_proving_nothing', wt.suspected && wt.reason!.includes('no named tests'))
const idxNow = buildWorkspaceIndex(root)
const unrelated = detectWrongTest({ ...r1, argv: ['node', '--test', 'test/pin.test.mjs'], stdout: '# tests 1\n# pass 1\n# fail 0', stderr: '' }, ['server.mjs'], idxNow)
check('M22_a_test_that_imports_none_of_the_changed_files_is_flagged_as_the_wrong_test', unrelated.suspected && unrelated.reason!.includes('server.mjs') && !detectWrongTest({ ...r1, argv: ['node', '--test', 'test/notesService.test.mjs'], stdout: '# tests 3\n# pass 3\n# fail 0', stderr: '' }, ['src/notesService.mjs'], idxNow).suspected)
check('M23_syntax_errors_are_parsed_with_file_and_line', (() => { const p = parseToolOutput('', '/x/src/broken.mjs:1\nexport function ((( {{{\n                ^\n\nSyntaxError: Unexpected token \'(\'\n    at ...'); return !!p.syntaxError && p.syntaxError.file.endsWith('broken.mjs') && p.syntaxError.line === 1 && p.syntaxError.message.includes('Unexpected token') })() && parseToolOutput('', 'src/a.ts(3,5): error TS2322: Type x is not assignable').typeErrors.length === 1)
check('M24_ledger_survives_restart_and_is_ordered', (() => { const re = debugEntries(new AgentOpsLog(w.dir), asg.id); return re.length >= 12 && re[0].kind === 'FAILURE' && re.filter((e) => e.kind === 'REPAIR').length === 2 })())
check('M25_ledger_writes_need_a_commander_or_system_actor', code(() => markUndetermined(w.log, asg.id, f1.failureId, 'x', 'agent:self', NOW)) === 'NOT_AUTHORIZED')
finish()
