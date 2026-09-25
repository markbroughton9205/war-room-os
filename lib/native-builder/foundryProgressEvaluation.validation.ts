/**
 * Smart stagnation validation. Deterministic and pure: no model, filesystem writes, or network.
 * Cases A..L are the brief's required cases; the rest pin fingerprints, normalization, strategy identity,
 * the bounded budget, restart survival, real-record replays, and that the verification gates are unchanged.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  PROGRESS_LIMITS,
  clearPendingContinuation,
  grantContinuation,
  applyIterationStop,
  applyWindowStop,
  assertionDistance,
  blockedEvidence,
  blockedSummaryFor,
  classifyBlock,
  emptyCampaignProgress,
  ensureCampaignProgress,
  evaluateFailure,
  evaluateInvalidOutput,
  evaluateNoTests,
  fingerprintFinding,
  fingerprintTestFailure,
  mutationOf,
  noteDebuggerFinding,
  noteGreen,
  noteMutation,
  normalizeVolatile,
  progressLimits,
  resetInvalidOutputStreak,
  type CampaignProgress,
  type ProgressDecision,
} from './foundryProgressEvaluation'
import { emptyEngineeringCampaign, verificationBarrierSatisfied, campaignCompletionAllowed, reviewerFoundGap } from './foundryEngineeringCampaign'

type CaseResult = { name: string; pass: boolean; detail: string }
const results: CaseResult[] = []
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`)
}

// ---- realistic unittest output ----
type Fail = { test: string; kind: 'ERROR' | 'FAIL'; exception: string; message: string; frames?: { file: string; fn: string; line?: number }[] }
function unittestOut(fails: Fail[], ran = 6, dir = '/tmp/x'): string {
  const blocks = fails.map(f => [
    '======================================================================',
    `${f.kind}: ${f.test} (tests.test_tickets.TicketDeskTests.${f.test})`,
    '----------------------------------------------------------------------',
    'Traceback (most recent call last):',
    ...(f.frames ?? [{ file: 'tests/test_tickets.py', fn: f.test }, { file: 'backend/api.py', fn: 'list_tickets' }]).flatMap(fr => [`  File "${dir}/${fr.file}", line ${fr.line ?? 20}, in ${fr.fn}`, '    code()']),
    `${f.exception}: ${f.message}`,
    '',
  ].join('\n'))
  const errors = fails.filter(f => f.kind === 'ERROR').length
  const failures = fails.filter(f => f.kind === 'FAIL').length
  const summary = [errors ? `errors=${errors}` : '', failures ? `failures=${failures}` : ''].filter(Boolean)
  return `${blocks.join('\n')}\n----------------------------------------------------------------------\nRan ${ran} tests in 0.001s\n\nFAILED (${summary.join(', ')})\n`
}
const nameError = (name = 'STATUS_QUERY', tests = ['test_a', 'test_b', 'test_c', 'test_d']) => unittestOut(tests.map(test => ({ test, kind: 'ERROR', exception: 'NameError', message: `name '${name}' is not defined` })))
const assertion = (left: string, right: string, tests = ['test_a']) => unittestOut(tests.map(test => ({ test, kind: 'FAIL', exception: 'AssertionError', message: `Lists differ: ${left} != ${right}` })))

const at = () => '2026-09-24T18:00:00.000Z'
const edit = (after: string, before = 'from shared.contract import normalize_status') => ({ file: 'backend/api.py', before, after, start: 0, end: before.length })
const IMPORT_EDIT = edit('from shared.contract import normalize_status, STATUS_QUERY')

type Run = { progress: CampaignProgress; decisions: ProgressDecision[] }
/** Feeds a sequence of (failure output, edit-made-before-it) pairs the way the runtime does. */
function feed(steps: { out: string; edits?: ReturnType<typeof edit>[]; hypothesis?: string; target?: string }[], start?: CampaignProgress, startCycles = 0): Run {
  let progress = start ?? emptyCampaignProgress()
  const decisions: ProgressDecision[] = []
  let cycles = startCycles
  steps.forEach((step, index) => {
    for (const e of step.edits ?? []) progress = noteMutation(progress, e)
    if (step.hypothesis || step.target) progress = noteDebuggerFinding(progress, { hypothesis: step.hypothesis, repairTarget: step.target })
    const result = evaluateFailure(progress, { fingerprint: fingerprintTestFailure(step.out), at: at(), mutationGeneration: index, reworkCycles: cycles })
    progress = result.progress
    decisions.push(result.decision)
    if (result.decision.proceed) cycles += 1
  })
  return { progress, decisions }
}
const lastOf = (run: Run) => run.decisions[run.decisions.length - 1]
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value) }
  return value
}

function main() {
  const A_OUT = assertion('[]', "['t1', 't4']")

  // =============================== A ===============================
  // Same failure + same (equivalent) strategy repeatedly -> STAGNATING.
  const a = feed([
    { out: A_OUT },
    { out: A_OUT, edits: [IMPORT_EDIT] },
    { out: A_OUT, edits: [edit('from shared.contract import STATUS_QUERY, normalize_status')] }, // same import, reordered
    { out: A_OUT, edits: [IMPORT_EDIT] },
  ])
  check('A_same_failure_same_strategy_is_stagnating', lastOf(a).classification === 'STAGNATING' && !lastOf(a).proceed && lastOf(a).stop?.reason === 'STAGNATION_SAME_STRATEGY', `${lastOf(a).classification} stop=${lastOf(a).stop?.reason}`)
  check('A_earlier_repeats_are_within_the_bounded_window', a.decisions.slice(0, 3).every(d => d.proceed), a.decisions.map(d => d.proceed).join(','))
  check('A_equivalent_import_edits_share_one_strategy_identity', mutationOf(IMPORT_EDIT).key === mutationOf(edit('from shared.contract import STATUS_QUERY, normalize_status')).key && a.decisions[2].strategy === 'SAME_STRATEGY' && a.decisions[1].strategy === 'NEW_STRATEGY', a.decisions.map(d => d.strategy).join(','))

  // =============================== B ===============================
  // NameError fixed -> a different, deeper AssertionError. PROGRESS, not a repeat.
  const b = feed([{ out: nameError() }, { out: A_OUT, edits: [IMPORT_EDIT], hypothesis: 'STATUS_QUERY is not defined', target: 'backend/api.py' }])
  const bd = lastOf(b)
  check('B_nameerror_to_assertion_is_progressing', bd.classification === 'PROGRESSING' && bd.proceed && bd.signals.includes('FAILURE_CHANGED') && bd.signals.includes('CONFIRMED_DEFECT_RESOLVED'), `${bd.classification} ${bd.signals.join('+')}`)
  check('B_narrates_fixed_import_then_deeper_failure', bd.notes.map(n => `${n.icon} ${n.text}`).join(' | ') === '✓ Fixed missing import | ↻ Found a deeper test failure | ↻ Repairing it', bd.notes.map(n => n.text).join(' | '))
  check('B_progress_burns_no_stagnation_budget', b.progress.sameFailureStreak === 0 && b.progress.sameStrategyStreak === 0 && b.progress.noStrongProgressStreak === 0 && b.progress.credits === 1, `streaks ${b.progress.sameFailureStreak}/${b.progress.sameStrategyStreak}/${b.progress.noStrongProgressStreak} credits=${b.progress.credits}`)

  // =============================== C ===============================
  const five = ['t1', 't2', 't3', 't4', 't5']
  const c = feed([
    { out: assertion('[]', "['x']", five) },
    { out: assertion('[]', "['x']", ['t1', 't2']), edits: [edit('return sorted(items)', 'return items')] },
  ])
  const cd = lastOf(c)
  check('C_five_failing_to_two_is_partial_progress', cd.classification === 'PARTIAL_PROGRESS' && cd.signals.includes('FAILING_TEST_COUNT_DECREASED') && !cd.signals.includes('NEW_TESTS_PASSING'), `${cd.classification} ${cd.signals.join('+')}`)
  const cf = fingerprintTestFailure(assertion('[]', "['x']", five))
  check('C_failing_count_and_names_parsed', cf.failingCount === 5 && cf.totalTests === 6 && cf.failingTests.join(',') === five.join(','), `${cf.failingCount}/${cf.totalTests} ${cf.failingTests.join(',')}`)
  const cr = feed([{ out: assertion('[]', "['x']", ['t1']) }, { out: assertion('[]', "['x']", ['t1', 't2', 't3']), edits: [edit('return None', 'return items')] }])
  check('C_more_failing_tests_is_regression_not_progress', lastOf(cr).classification === 'REGRESSING' && !lastOf(cr).signals.includes('FAILURE_CHANGED'), `${lastOf(cr).classification} ${lastOf(cr).signals.join('+')}`)

  const incomplete = feed([
    { out: unittestOut(five.map(test => ({ test, kind: 'ERROR', exception: 'NameError', message: "name 'X' is not defined" })), 6) },
    { out: unittestOut([{ test: 't1', kind: 'ERROR', exception: 'NameError', message: "name 'X' is not defined" }], 1), edits: [IMPORT_EDIT] },
  ])
  check('C_smaller_test_run_cannot_claim_new_passing_tests', !lastOf(incomplete).signals.includes('NEW_TESTS_PASSING') && !lastOf(incomplete).signals.includes('FAILING_TEST_COUNT_DECREASED'), lastOf(incomplete).signals.join('+'))
  const explicitPass = feed([
    { out: assertion('[]', "['x']", ['test_a', 'test_b']) },
    { out: 'test_b (tests.test_tickets.TicketDeskTests.test_b) ... ok\n' + assertion('[]', "['x']", ['test_a']), edits: [IMPORT_EDIT] },
  ])
  check('C_explicit_passing_test_is_evidence', lastOf(explicitPass).signals.includes('NEW_TESTS_PASSING'), lastOf(explicitPass).signals.join('+'))
  const regressionCloser = feed([
    { out: assertion('[]', "['a', 'b']", ['test_a']) },
    { out: assertion("['a']", "['a', 'b']", ['test_a', 'test_b']), edits: [IMPORT_EDIT] },
  ])
  check('C_regression_takes_precedence_over_local_improvement', lastOf(regressionCloser).classification === 'REGRESSING' && regressionCloser.progress.credits === 0, lastOf(regressionCloser).classification)

  // =============================== D ===============================
  const d = feed([{ out: assertion('[]', "['t1', 't4']") }, { out: assertion("['t1']", "['t1', 't4']"), edits: [edit('return open_only(items)', 'return items')] }])
  check('D_assertion_actual_moves_toward_target_is_partial_progress', lastOf(d).classification === 'PARTIAL_PROGRESS' && lastOf(d).signals.includes('ASSERTION_MOVED_TOWARD_TARGET'), `${lastOf(d).classification} ${lastOf(d).signals.join('+')}`)
  check('D_value_change_keeps_failure_identity', fingerprintTestFailure(assertion('[]', "['t1', 't4']")).id === fingerprintTestFailure(assertion("['t1']", "['t1', 't4']")).id && fingerprintTestFailure(assertion('[]', "['t1', 't4']")).valueKey !== fingerprintTestFailure(assertion("['t1']", "['t1', 't4']")).valueKey, 'same id, different valueKey')
  const dAway = feed([{ out: assertion("['t1']", "['t1', 't4']") }, { out: assertion('[]', "['t1', 't4']"), edits: [edit('return []', 'return items')] }])
  check('D_value_moving_away_is_not_progress', !lastOf(dAway).signals.includes('ASSERTION_MOVED_TOWARD_TARGET') && lastOf(dAway).classification === 'STAGNATING', `${lastOf(dAway).classification} ${lastOf(dAway).signals.join('+')}`)
  check('D_assertion_distance_orders_closer_values', (assertionDistance({ left: "['t1']", right: "['t1', 't4']" }) ?? 1) < (assertionDistance({ left: '[]', right: "['t1', 't4']" }) ?? 0), 'closer < farther')

  // A repair that breaks the test module's import is a REGRESSION, not "fewer failing tests" (found in the first live run).
  const importBreak = unittestOut([{ test: 'test_tickets', kind: 'ERROR', exception: 'ImportError', message: "Failed to import test module: test_tickets" }], 1).replace('tests.test_tickets.TicketDeskTests.test_tickets', 'unittest.loader._FailedTest.test_tickets')
  check('D_import_failure_is_flagged_as_a_load_failure', fingerprintTestFailure(importBreak).loadFailure === true && fingerprintTestFailure(importBreak).totalTests === 1 && fingerprintTestFailure(nameError()).loadFailure === false, 'loadFailure')
  const truncatedTail = "  File \"/tmp/p/tests/test_tickets.py\", line 8, in <module>\n    from backend.api import list_tickets\n  File \"/tmp/p/backend/api.py\", line 3, in <module>\n    from shared.contract import normalize_status, CONTRACT\nImportError: cannot import name 'CONTRACT' from 'shared.contract' (/tmp/p/shared/contract.py)\n\n----------------------------------------------------------------------\nRan 1 test in 0.000s\n\nFAILED (errors=1)\n"
  check('D_load_failure_is_recognised_from_a_truncated_tail_too', fingerprintTestFailure(truncatedTail).loadFailure === true, 'module frame in tests/')
  const brokeImport = feed([{ out: nameError() }, { out: importBreak, edits: [edit('from shared.contract import normalize_status, CONTRACT')] }])
  check('D_nameerror_to_broken_import_is_regression_not_progress', lastOf(brokeImport).classification === 'REGRESSING' && !lastOf(brokeImport).signals.some(s => ['FAILURE_CHANGED', 'FAILING_TEST_COUNT_DECREASED', 'NEW_TESTS_PASSING', 'CONFIRMED_DEFECT_RESOLVED'].includes(s)) && brokeImport.progress.credits === 0, `${lastOf(brokeImport).classification} ${lastOf(brokeImport).signals.join('+')}`)
  const recovered = feed([{ out: nameError() }, { out: importBreak, edits: [edit('from shared.contract import normalize_status, CONTRACT')] }, { out: A_OUT, edits: [edit('from shared.contract import normalize_status, STATUS_QUERY', 'from shared.contract import normalize_status, CONTRACT')] }])
  check('D_broken_import_repaired_to_a_deeper_failure_is_progress', lastOf(recovered).classification === 'PROGRESSING' && lastOf(recovered).signals.includes('CONFIRMED_DEFECT_RESOLVED') && lastOf(recovered).notes.some(n => n.text === 'Fixed import problem'), `${lastOf(recovered).classification} ${lastOf(recovered).notes.map(n => n.text).join('|')}`)
  const shrunk = feed([{ out: assertion('[]', "['x']", ['t1', 't2', 't3', 't4']) }, { out: unittestOut([{ test: 't1', kind: 'FAIL', exception: 'AssertionError', message: "Lists differ: [] != ['x']" }], 2) , edits: [edit('return None', 'return items')] }])
  check('D_fewer_tests_ran_is_not_fewer_failures', !lastOf(shrunk).signals.includes('FAILING_TEST_COUNT_DECREASED') && !lastOf(shrunk).signals.includes('NEW_TESTS_PASSING'), lastOf(shrunk).signals.join('+'))

  // Live finding (05d, frozen variant 4): a different undefined name is a distinct defect B, not "the same failure narrowing".
  const stacked = feed([
    { out: nameError('STATUS_QUERY', ['t1', 't2', 't3', 't4']) },
    { out: nameError('MAX_TICKETS', ['t1', 't2']), edits: [IMPORT_EDIT] },
  ])
  check('B_distinct_second_defect_with_fewer_failing_tests_is_productive_progress', lastOf(stacked).classification === 'PROGRESSING' && lastOf(stacked).signals.includes('FAILURE_CHANGED') && lastOf(stacked).signals.includes('FAILING_TEST_COUNT_DECREASED') && lastOf(stacked).notes.some(n => n.text === 'Fixed missing import'), `${lastOf(stacked).classification} ${lastOf(stacked).signals.join('+')}`)
  const narrowSame = feed([{ out: nameError('X', ['t1', 't2', 't3']) }, { out: nameError('X', ['t1']), edits: [IMPORT_EDIT] }])
  check('C_same_message_with_fewer_failing_tests_is_still_partial_progress', lastOf(narrowSame).classification === 'PARTIAL_PROGRESS' && !lastOf(narrowSame).signals.includes('FAILURE_CHANGED'), `${lastOf(narrowSame).classification} ${lastOf(narrowSame).signals.join('+')}`)

  // =============================== E ===============================
  // Same failure after a mutation that did nothing useful -> STAGNATING immediately (no bounded attempts wasted).
  const eNoop = feed([{ out: A_OUT }, { out: A_OUT, edits: [edit('return   items ', 'return items')] }])
  check('E_whitespace_only_mutation_is_not_a_mutation', mutationOf(edit('return   items ', 'return items')).kind === 'NOOP' && lastOf(eNoop).strategy === 'NO_MUTATION' && lastOf(eNoop).stop?.reason === 'STAGNATION_NO_MUTATION' && !lastOf(eNoop).proceed, `${lastOf(eNoop).strategy} ${lastOf(eNoop).stop?.reason}`)
  const eNone = feed([{ out: A_OUT }, { out: A_OUT }])
  check('E_no_mutation_at_all_and_same_failure_is_stagnating', lastOf(eNone).stop?.reason === 'STAGNATION_NO_MUTATION' && lastOf(eNone).classification === 'STAGNATING', `${lastOf(eNone).stop?.reason}`)
  check('E_mutation_alone_is_a_weak_signal', !lastOf(feed([{ out: A_OUT }, { out: A_OUT, edits: [edit('return sorted(items)', 'return items')] }])).signals.some(s => ['FAILURE_CHANGED', 'CONFIRMED_DEFECT_RESOLVED'].includes(s)) && lastOf(feed([{ out: A_OUT }, { out: A_OUT, edits: [edit('return sorted(items)', 'return items')] }])).classification === 'STAGNATING', 'MUTATION_ADVANCED is not progress')

  // =============================== F ===============================
  // Strategy keeps changing but no evidence improves -> eventually STAGNATING (bounded).
  const variants = ['return sorted(items)', 'return list(items)', 'return items[:]', 'return tuple(items)', 'return items[::1]', 'return [i for i in items]']
  const fRun = feed(variants.map((v, i) => ({ out: A_OUT, edits: i === 0 ? [] : [edit(v, 'return items')], hypothesis: `hypothesis number ${i} about ${['ordering', 'copying', 'slicing', 'typing', 'stride', 'comprehension'][i]}`, target: i % 2 ? 'backend/api.py' : 'backend/api.py list_tickets' })))
  const stopAt = fRun.decisions.findIndex(x => !x.proceed)
  check('F_changing_strategy_without_evidence_eventually_stagnates', stopAt === 4 && fRun.decisions[stopAt].stop?.reason === 'STAGNATION_SAME_FAILURE' && fRun.decisions[stopAt].classification === 'STAGNATING', `stop at observation ${stopAt + 1}: ${fRun.decisions[stopAt]?.stop?.reason}`)
  check('F_new_strategies_are_given_the_longer_window', fRun.decisions.slice(0, 4).every(x => x.proceed) && fRun.decisions.slice(1, 4).every(x => x.strategy === 'NEW_STRATEGY'), fRun.decisions.map(x => x.strategy).join(','))
  check('F_changing_hypotheses_alone_never_reset_the_window', fRun.progress.observations.some(o => o.signals.includes('HYPOTHESIS_CHANGED') || o.signals.includes('REPAIR_TARGET_CHANGED')) && stopAt === 4, fRun.progress.observations.map(o => o.signals.filter(s => s === 'HYPOTHESIS_CHANGED' || s === 'REPAIR_TARGET_CHANGED').length).join(','))

  // =============================== G ===============================
  const A = nameError('AAA', ['t1']); const B = unittestOut([{ test: 't1', kind: 'ERROR', exception: 'AttributeError', message: "'NoneType' object has no attribute 'lower'" }])
  const g = feed([{ out: A }, { out: B, edits: [edit('x = 1', 'x = 0')] }, { out: A, edits: [edit('x = 2', 'x = 0')] }, { out: B, edits: [edit('x = 3', 'x = 0')] }])
  check('G_a_b_a_b_is_oscillating', lastOf(g).classification === 'OSCILLATING' && !lastOf(g).proceed && lastOf(g).stop?.reason === 'OSCILLATION', `${lastOf(g).classification}`)
  check('G_returning_to_a_seen_failure_is_regression_not_progress', g.decisions[2].classification === 'REGRESSING' && g.decisions[2].proceed && !g.decisions[2].signals.includes('FAILURE_CHANGED'), `${g.decisions[2].classification} ${g.decisions[2].signals.join('+')}`)
  check('G_first_a_to_b_is_credited_as_progress', g.decisions[1].classification === 'PROGRESSING' && g.decisions[1].signals.includes('FAILURE_CHANGED'), g.decisions[1].signals.join('+'))

  // =============================== H ===============================
  check('H_provider_unavailable_is_typed_not_stagnation', classifyBlock('PROVIDER_UNAVAILABLE') === 'BLOCKED_PROVIDER' && classifyBlock('MODEL_UNAVAILABLE') === 'BLOCKED_PROVIDER' && blockedSummaryFor('PROVIDER') === 'PROVIDER_UNAVAILABLE' && blockedSummaryFor('PROVIDER') !== 'BLOCKED_STAGNATION', `${classifyBlock('PROVIDER_UNAVAILABLE')}`)
  const runtimeSource = readFileSync(path.join(process.cwd(), 'lib/native-builder/foundryEngineeringRuntime.ts'), 'utf8').replace(/\r\n/g, '\n')
  check('H_runtime_provider_failures_never_route_through_stagnation', runtimeSource.includes("'PROVIDER_UNAVAILABLE',\n        health.detail") && runtimeSource.includes('return sealBlocked(repairId, blocked(call.failureClass, call.receipt.summary'), 'typed provider/capability blocks kept')

  // =============================== I ===============================
  let inv = emptyCampaignProgress()
  const invalids: ProgressDecision[] = []
  for (let i = 0; i < 3; i += 1) {
    const r = evaluateInvalidOutput(inv, { role: 'BACKEND', summary: 'Tool "file.replace_unique" is missing required argument "reason".', at: at(), mutationGeneration: 1, reworkCycles: i })
    inv = r.progress; invalids.push(r.decision)
  }
  check('I_repeated_invalid_output_is_a_capability_block', invalids[0].proceed && invalids[1].proceed && !invalids[2].proceed && invalids[2].classification === 'BLOCKED_CAPABILITY' && invalids[2].stop?.reason === 'CAPABILITY_INVALID_OUTPUT', invalids.map(x => `${x.classification}:${x.proceed}`).join(' '))
  check('I_capability_block_is_not_reported_as_stagnation', blockedSummaryFor('CAPABILITY_INVALID_OUTPUT') === 'BLOCKED_CAPABILITY' && /unusable structured output 3 times during this mission/.test(invalids[2].stop?.message ?? ''), invalids[2].stop?.message ?? '')
  check('I_invalid_output_does_not_count_as_a_code_failure', inv.sameFailureStreak === 0 && inv.noStrongProgressStreak === 0 && inv.observations.every(o => o.kind === 'INVALID_OUTPUT'), 'streaks untouched')
  check('I_a_valid_result_resets_the_invalid_output_streak', resetInvalidOutputStreak(inv).invalidOutputStreak === 0, '0')
  const noTests = evaluateNoTests(emptyCampaignProgress(), { at: at(), mutationGeneration: 0, reworkCycles: 0 })
  check('I_no_tests_collected_is_a_policy_block', noTests.decision.classification === 'BLOCKED_POLICY' && blockedSummaryFor('POLICY_NO_TESTS') === 'BLOCKED_POLICY', noTests.decision.classification)

  // =============================== J ===============================
  // Real-record shape: tests go green, then the reviewer exposes a distinct defect. Progress, and the window that
  // progress earned lets the review-driven rework proceed where a flat 5-cycle ceiling would have stopped it.
  const pre = feed([{ out: nameError() }, { out: A_OUT, edits: [IMPORT_EDIT] }])
  const green = noteGreen(pre.progress, { at: at(), mutationGeneration: 3 })
  const review = evaluateFailure(green, { fingerprint: fingerprintFinding("STATUS fail: the 'list_items' function does not return the expected items when no filter is applied", 'REVIEW'), at: at(), mutationGeneration: 3, reworkCycles: 5 })
  check('J_review_driven_new_defect_is_progress', review.decision.classification === 'PROGRESSING' && review.decision.signals.includes('REVIEW_FINDING_CHANGED') && review.decision.proceed, `${review.decision.classification} ${review.decision.signals.join('+')}`)
  check('J_earned_window_exceeds_the_old_flat_ceiling', progressLimits(green).cycles > 5 && progressLimits(green).cycles <= PROGRESS_LIMITS.absoluteCycles, `window ${progressLimits(green).cycles}`)
  check('J_green_run_is_confirmed_resolution', green.greens === 1 && green.lastSignals.includes('CONFIRMED_DEFECT_RESOLVED') && green.lastFingerprint === null && green.notes.some(n => n.text === 'Fixed missing import'), green.notes.map(n => n.text).join('|'))
  const reviewSame = evaluateFailure(review.progress, { fingerprint: fingerprintFinding("STATUS fail: the 'list_items' function does not return the expected items when no filter is applied", 'REVIEW'), at: at(), mutationGeneration: 3, reworkCycles: 6 })
  check('J_same_review_finding_repeating_is_not_new_progress', !reviewSame.decision.signals.includes('REVIEW_FINDING_CHANGED') && reviewSame.progress.sameFailureStreak === 1, reviewSame.decision.signals.join('+'))

  // =============================== K ===============================
  const mid = feed([{ out: nameError() }, { out: A_OUT, edits: [IMPORT_EDIT], hypothesis: 'h1', target: 'backend/api.py' }])
  const withOpenCycle = noteMutation(noteDebuggerFinding(mid.progress, { hypothesis: 'h2 about ordering', repairTarget: 'backend/api.py' }), edit('return sorted(items)', 'return items'))
  const persisted = JSON.parse(JSON.stringify({ progress: withOpenCycle })) as { progress: CampaignProgress } // what the repair record holds
  const restored = ensureCampaignProgress(persisted)
  const next = { out: assertion("['t1']", "['t1', 't4']") }
  const direct = evaluateFailure(withOpenCycle, { fingerprint: fingerprintTestFailure(next.out), at: at(), mutationGeneration: 2, reworkCycles: 2 })
  const afterRestart = evaluateFailure(restored, { fingerprint: fingerprintTestFailure(next.out), at: at(), mutationGeneration: 2, reworkCycles: 2 })
  check('K_progress_state_survives_restart_exactly', JSON.stringify(direct) === JSON.stringify(afterRestart), 'restart decision equals uninterrupted decision')
  check('K_restored_state_keeps_fingerprint_strategy_evidence_generation_counters', restored.lastFingerprint?.id === mid.progress.lastFingerprint?.id && restored.strategyKeys.length === mid.progress.strategyKeys.length && restored.credits === mid.progress.credits && restored.observations.length === mid.progress.observations.length && restored.cycle.mutations.length === 1 && restored.cycle.hypothesis === 'h2 about ordering' && restored.observations[restored.observations.length - 1].mutationGeneration === 1, `credits=${restored.credits} obs=${restored.observations.length} strategies=${restored.strategyKeys.length}`)
  const legacy = ensureCampaignProgress({ progress: undefined })
  check('K_records_from_before_smart_stagnation_resume_with_safe_defaults', legacy.version === 1 && legacy.credits === 0 && legacy.observations.length === 0 && legacy.stop === null, 'defaults')
  check('K_new_campaigns_start_with_progress_state', emptyEngineeringCampaign('x').progress.version === 1 && emptyEngineeringCampaign('x').progress.credits === 0, 'emptyEngineeringCampaign')
  check('K_runtime_restores_never_resets_progress_on_resume', runtimeSource.includes('ensureCampaignProgress(state)') && runtimeSource.includes('const state = resuming && prior ? prior : emptyEngineeringCampaign(request, prior?.pauseAfter)'), 'resume keeps prior campaign, ensures progress')

  // =============================== L ===============================
  // Progress keeps coming, but the absolute ceiling still stops the mission with an accurate reason.
  let progress = emptyCampaignProgress()
  let final: ProgressDecision | null = null
  const uniqueFailure = (i: number) => unittestOut([{ test: `test_${i}`, kind: 'ERROR', exception: i % 2 ? 'AttributeError' : 'TypeError', message: `defect number ${'x'.repeat(i)}`, frames: [{ file: `backend/mod${i}.py`, fn: `fn${i}` }] }])
  for (let i = 0; i < 12; i += 1) {
    progress = noteMutation(progress, edit(`x = ${i}`, 'x = -1'))
    const r = evaluateFailure(progress, { fingerprint: fingerprintTestFailure(uniqueFailure(i)), at: at(), mutationGeneration: i, reworkCycles: i })
    progress = r.progress; final = r.decision
    if (!r.decision.proceed) break
  }
  check('L_absolute_bound_stops_even_while_progressing', final !== null && !final.proceed && final.stop?.reason === 'ABSOLUTE_BOUND' && final.classification === 'PROGRESSING' && (final.stop?.message ?? '').includes(`absolute limit of ${PROGRESS_LIMITS.absoluteCycles}`), `${final?.classification} ${final?.stop?.reason}`)
  check('L_bounded_stop_is_typed_as_repair_limit_not_stagnation', blockedSummaryFor('ABSOLUTE_BOUND') === 'BLOCKED_REPAIR_LIMIT' && blockedSummaryFor('WINDOW_EXHAUSTED') === 'BLOCKED_REPAIR_LIMIT' && blockedEvidence(progress)?.reason === 'ABSOLUTE_BOUND', blockedEvidence(progress)?.reason ?? '')
  const capped = { ...emptyCampaignProgress(), credits: 99 }
  const lim = progressLimits(capped)
  check('L_credits_and_ceilings_are_finite', lim.cycles === PROGRESS_LIMITS.absoluteCycles && lim.modelCalls <= PROGRESS_LIMITS.absoluteModelCalls && lim.commands <= PROGRESS_LIMITS.absoluteCommands && progressLimits(emptyCampaignProgress()).cycles === PROGRESS_LIMITS.baseCycles, `${lim.cycles}/${lim.modelCalls}/${lim.commands}`)
  const windowNoProgress = evaluateFailure(emptyCampaignProgress(), { fingerprint: fingerprintTestFailure(A_OUT), at: at(), mutationGeneration: 0, reworkCycles: PROGRESS_LIMITS.baseCycles })
  check('L_exhausted_window_without_progress_is_stagnation_not_a_repair_limit', !windowNoProgress.decision.proceed && windowNoProgress.decision.stop?.reason === 'STAGNATION_WINDOW' && blockedSummaryFor('STAGNATION_WINDOW') === 'BLOCKED_STAGNATION' && windowNoProgress.decision.stop.cycleLimit === PROGRESS_LIMITS.baseCycles, `${windowNoProgress.decision.stop?.reason}`)
  const progressingWindow = evaluateFailure(feed([{ out: nameError() }]).progress, { fingerprint: fingerprintTestFailure(A_OUT), at: at(), mutationGeneration: 1, reworkCycles: PROGRESS_LIMITS.baseCycles + 1 })
  check('L_exhausted_window_while_progressing_is_a_repair_limit', !progressingWindow.decision.proceed && progressingWindow.decision.stop?.reason === 'WINDOW_EXHAUSTED' && blockedSummaryFor('WINDOW_EXHAUSTED') === 'BLOCKED_REPAIR_LIMIT' && progressingWindow.decision.classification === 'PROGRESSING', `${progressingWindow.decision.stop?.reason} ${progressingWindow.decision.classification}`)
  const earned = evaluateFailure({ ...emptyCampaignProgress(), credits: 2 }, { fingerprint: fingerprintTestFailure(A_OUT), at: at(), mutationGeneration: 0, reworkCycles: PROGRESS_LIMITS.baseCycles })
  check('L_earned_credit_extends_the_window_beyond_the_base', earned.decision.proceed && progressLimits({ credits: 2 }).cycles === PROGRESS_LIMITS.baseCycles + 2, `window=${progressLimits({ credits: 2 }).cycles}`)

  // Live finding (proof 2 exploration): undoing a regression lands on an already-seen state. That is a revert, not "narrowing".
  const revert = feed([
    { out: assertion('[]', "['x']", ['t_total']) },
    { out: assertion('[]', "['x']", ['t_total', 't_filter']), edits: [edit('return None', 'return items')] },
    { out: assertion('[]', "['x']", ['t_total']), edits: [edit('return items', 'return None')] },
  ])
  check('L_reverting_a_regression_is_not_progress_or_narrowing', lastOf(revert).classification === 'REGRESSING' && !lastOf(revert).signals.some(x => ['FAILING_TEST_COUNT_DECREASED', 'FAILURE_CHANGED', 'NEW_TESTS_PASSING'].includes(x)) && revert.progress.credits === 0, `${lastOf(revert).classification} ${lastOf(revert).signals.join('+')} credits=${revert.progress.credits}`)
  // Live finding: the task-loop bound (24) silently ended a productive mission as "Campaign did not verify". It now scales with progress, finitely.
  check('L_task_loop_bound_scales_with_progress_inside_an_absolute_limit', progressLimits(emptyCampaignProgress()).iterations === 24 && progressLimits({ credits: 2 }).iterations === 32 && progressLimits({ credits: 99 }).iterations === PROGRESS_LIMITS.absoluteIterations && PROGRESS_LIMITS.absoluteIterations === 40, `${progressLimits({ credits: 2 }).iterations}/${PROGRESS_LIMITS.absoluteIterations}`)
  const iterProgressing = applyIterationStop({ ...emptyCampaignProgress(), classification: 'PARTIAL_PROGRESS', credits: 2 }, 6)
  const iterStuck = applyIterationStop({ ...emptyCampaignProgress(), classification: 'STAGNATING' }, 5)
  check('L_task_step_exhaustion_is_typed_by_whether_progress_was_being_made', iterProgressing.stop?.reason === 'ITERATION_LIMIT' && blockedSummaryFor('ITERATION_LIMIT') === 'BLOCKED_REPAIR_LIMIT' && iterStuck.stop?.reason === 'STAGNATION_WINDOW' && blockedSummaryFor('STAGNATION_WINDOW') === 'BLOCKED_STAGNATION', `${iterProgressing.stop?.reason} / ${iterStuck.stop?.reason}`)
  check('L_window_guard_allows_cycles_inside_the_earned_window', applyWindowStop({ ...emptyCampaignProgress(), credits: 2 }, 7) === null && applyWindowStop({ ...emptyCampaignProgress(), credits: 2 }, 8) !== null && applyWindowStop({ ...emptyCampaignProgress(), credits: 0, invalidOutputTotal: 2 }, 7) === null, 'used = cycles - invalid outputs')
  let invTotal = emptyCampaignProgress()
  const invDecisions: boolean[] = []
  for (let i = 0; i < 4; i += 1) {
    const r = evaluateInvalidOutput(invTotal, { role: 'BACKEND', summary: 'bad output', at: at(), mutationGeneration: 1, reworkCycles: i })
    invTotal = resetInvalidOutputStreak(r.progress) // a valid result in between resets the streak, not the total
    invDecisions.push(r.decision.proceed)
  }
  check('I_non_consecutive_invalid_outputs_still_hit_the_mission_total', invDecisions.join(',') === 'true,true,true,false', invDecisions.join(','))

  // ---- Keep trying (Commander continuation): same mission, nothing erased, bounded new window ----
  const stuckRun = feed([{ out: A_OUT }, { out: A_OUT, edits: [IMPORT_EDIT] }, { out: A_OUT, edits: [edit('from shared.contract import STATUS_QUERY, normalize_status')] }, { out: A_OUT, edits: [IMPORT_EDIT] }])
  check('K2_the_run_stops_before_keep_trying', !lastOf(stuckRun).proceed && stuckRun.progress.stop?.reason === 'STAGNATION_SAME_STRATEGY', `${stuckRun.progress.stop?.reason}`)
  const beforeGrant = stuckRun.progress
  const granted = grantContinuation(beforeGrant, { at: at(), fromStop: beforeGrant.stop?.reason ?? null })
  const gp = granted.progress
  check('K2_grant_preserves_everything_Foundry_learned', granted.granted && JSON.stringify(gp.observations) === JSON.stringify(beforeGrant.observations) && JSON.stringify(gp.fingerprintHistory) === JSON.stringify(beforeGrant.fingerprintHistory) && JSON.stringify(gp.strategyKeys) === JSON.stringify(beforeGrant.strategyKeys) && JSON.stringify(gp.lastFingerprint) === JSON.stringify(beforeGrant.lastFingerprint) && gp.credits === beforeGrant.credits && gp.triedSummaries.join() === beforeGrant.triedSummaries.join() && gp.sameFailureStreak === beforeGrant.sameFailureStreak && gp.noStrongProgressStreak === beforeGrant.noStrongProgressStreak, 'observations, history, strategies, credits, streaks all identical')
  check('K2_grant_lifts_the_stop_records_the_decision_and_adds_a_bounded_window', gp.stop === null && gp.continuation.grants === 1 && gp.continuation.pending && gp.continuation.decisions.length === 1 && progressLimits(gp).cycles === progressLimits(beforeGrant).cycles + PROGRESS_LIMITS.grantCycles && progressLimits(gp).iterations === progressLimits(beforeGrant).iterations + PROGRESS_LIMITS.grantIterations, `window ${progressLimits(beforeGrant).cycles} -> ${progressLimits(gp).cycles}`)
  const resumed = evaluateFailure(noteMutation(clearPendingContinuation(gp), edit('return sorted(items)', 'return items')), { fingerprint: fingerprintTestFailure(A_OUT), at: at(), mutationGeneration: 4, reworkCycles: 4 })
  check('K2_after_a_grant_with_a_new_approach_the_same_stagnation_does_not_instantly_stop_again', resumed.decision.proceed && resumed.progress.sameFailureStreak === beforeGrant.sameFailureStreak + 1, `proceed=${resumed.decision.proceed} streak ${resumed.progress.sameFailureStreak} (kept, not reset)`)
  let more = resumed.progress
  let stopsAt = -1
  for (let i = 0; i < 8; i += 1) {
    more = noteMutation(more, edit(`return ${i}`, 'return items'))
    const r = evaluateFailure(more, { fingerprint: fingerprintTestFailure(A_OUT), at: at(), mutationGeneration: 5 + i, reworkCycles: 5 + i })
    more = r.progress
    if (!r.decision.proceed) { stopsAt = i; break }
  }
  check('K2_the_continuation_window_is_bounded_and_evidence_still_stops_it', stopsAt >= 0 && stopsAt <= 4, `stops again after ${stopsAt + 1} more attempts`)
  const second = grantContinuation(more, { at: at(), fromStop: more.stop?.reason ?? null })
  const third = grantContinuation(second.progress, { at: at(), fromStop: 'STAGNATION_NO_PROGRESS' })
  check('K2_continuation_grants_are_finite', second.granted && !third.granted && (third.reason ?? '').includes('already used') && progressLimits(second.progress).absoluteCycles === PROGRESS_LIMITS.absoluteCycles + 2 * PROGRESS_LIMITS.grantCycles, `${second.granted}/${third.granted}`)
  check('K2_tried_edits_are_remembered_for_the_next_attempt', gp.triedSummaries.length > 0 && gp.triedSummaries.every(x => x.startsWith('backend/api.py:')), gp.triedSummaries.join(' | '))

  // =========================== fingerprints ===========================
  const base = unittestOut([{ test: 'test_a', kind: 'ERROR', exception: 'NameError', message: "name 'STATUS_QUERY' is not defined", frames: [{ file: 'tests/test_a.py', fn: 'test_a', line: 20 }, { file: 'backend/api.py', fn: 'list_tickets', line: 15 }] }], 6, '/tmp/run-1')
  const drift = unittestOut([{ test: 'test_a', kind: 'ERROR', exception: 'NameError', message: "name 'STATUS_QUERY' is not defined", frames: [{ file: 'tests/test_a.py', fn: 'test_a', line: 27 }, { file: 'backend/api.py', fn: 'list_tickets', line: 19 }] }], 6, '/home/other/checkout').replace('0.001s', '0.734s')
  check('N_normalization_ignores_paths_line_drift_timings', fingerprintTestFailure(base).id === fingerprintTestFailure(drift).id, fingerprintTestFailure(base).id)
  check('N_semantic_change_is_preserved', fingerprintTestFailure(nameError('STATUS_QUERY')).id !== fingerprintTestFailure(nameError('OTHER_NAME')).id && fingerprintTestFailure(nameError()).id !== fingerprintTestFailure(A_OUT).id, 'name and class matter')
  check('N_failing_test_order_does_not_change_identity', fingerprintTestFailure(nameError('X', ['t_a', 't_b'])).id === fingerprintTestFailure(nameError('X', ['t_b', 't_a'])).id, 'sorted')
  check('N_a_different_failing_test_changes_identity', fingerprintTestFailure(nameError('X', ['t_a'])).id !== fingerprintTestFailure(nameError('X', ['t_b'])).id, 'test name')
  const volatile = normalizeVolatile('at 2026-09-24T17:00:01.123Z <Obj at 0xdeadbeef12> in 0.045s /home/u/proj/tests/x.py line 12')
  check('N_normalize_volatile', volatile === 'at <time> <Obj at <addr>> in <t>s <path>/x.py line <n>', volatile)
  const memoryDiff = fingerprintTestFailure(unittestOut([{ test: 't', kind: 'FAIL', exception: 'AssertionError', message: "<Ticket object at 0x7f1a2b3c4d5e> != <Ticket object at 0x7f9999999999>" }]))
  const memoryDiff2 = fingerprintTestFailure(unittestOut([{ test: 't', kind: 'FAIL', exception: 'AssertionError', message: "<Ticket object at 0x7f0000000001> != <Ticket object at 0x7f0000000002>" }]))
  check('N_memory_addresses_do_not_create_new_failures', memoryDiff.id === memoryDiff2.id && memoryDiff.valueKey === memoryDiff2.valueKey, 'addr normalized')
  check('N_deep_import_failure_is_structural_assertion_is_behavioral', fingerprintTestFailure(nameError()).depth === 'STRUCTURAL' && fingerprintTestFailure(A_OUT).depth === 'BEHAVIORAL', 'depth')
  check('N_project_frames_exclude_stdlib_and_line_numbers', fingerprintTestFailure(base).frames.join(',') === 'backend/api.py:list_tickets,tests/test_a.py:test_a', fingerprintTestFailure(base).frames.join(','))
  check('N_review_findings_use_fuzzy_identity', evaluateFailure(evaluateFailure(emptyCampaignProgress(), { fingerprint: fingerprintFinding('The list_items function ignores the status filter when empty', 'REVIEW'), at: at(), mutationGeneration: 1, reworkCycles: 0 }).progress, { fingerprint: fingerprintFinding('list_items function ignores the status filter when it is empty', 'REVIEW'), at: at(), mutationGeneration: 1, reworkCycles: 1 }).progress.sameFailureStreak === 1, 'paraphrase = same finding')

  // ======================= real recorded missions =======================
  // Record 379c86d4 (04d-era live run): NameError, four AssertionErrors with different edits, PASS at generation 6, then a review
  // finding. The flat ceiling (5) blocked it as BLOCKED_STAGNATION after tests were already green.
  const rec1 = feed([
    { out: nameError('normalize_status') },
    { out: A_OUT, edits: [edit('from shared.contract import normalize_status', 'x')], hypothesis: 'normalization not matching expected value', target: 'backend/api.py' },
    { out: A_OUT, edits: [edit('return [i for i in ITEMS if norm(i)]', 'return items')], hypothesis: 'status normalization is not matching between item and query' },
    { out: A_OUT, edits: [edit('return [i for i in ITEMS if i["status"].lower() == q]', 'return items')], hypothesis: 'query status is not applied correctly in list_items' },
    { out: A_OUT, edits: [edit('return list(ITEMS) if not q else filtered', 'return items')], hypothesis: 'list_items does not return expected items when no filter' },
  ])
  check('R1_recorded_mission_keeps_repairing_through_repeated_assertion_until_green', rec1.decisions.every(x => x.proceed), rec1.decisions.map(x => `${x.classification}${x.proceed ? '' : '!'}`).join(' '))
  const rec1Green = noteGreen(rec1.progress, { at: at(), mutationGeneration: 6 })
  const rec1Review = evaluateFailure(rec1Green, { fingerprint: fingerprintFinding("STATUS fail: The 'list_items' function in backend/api.py does not return the expected items when no filter is applied", 'REVIEW'), at: at(), mutationGeneration: 6, reworkCycles: 5 })
  check('R1_review_rework_proceeds_where_the_flat_ceiling_blocked', rec1Review.decision.proceed && rec1Review.decision.classification === 'PROGRESSING', `${rec1Review.decision.classification} window=${progressLimits(rec1Green).cycles}`)
  // Record 46a5d653: NameError, Assertion x2, AttributeError (a different failure), invalid specialist output, then another failure.
  const ATTR = unittestOut([{ test: 'test_same', kind: 'ERROR', exception: 'AttributeError', message: "'NoneType' object has no attribute 'lower'" }])
  const rec2a = feed([{ out: nameError('normalize_status') }, { out: A_OUT, edits: [edit('x = 1', 'x = 0')] }, { out: A_OUT, edits: [edit('x = 2', 'x = 0')] }, { out: ATTR, edits: [edit('x = 3', 'x = 0')] }])
  const rec2inv = evaluateInvalidOutput(rec2a.progress, { role: 'BACKEND', summary: 'Tool "file.replace_unique" is missing required argument "reason".', at: at(), mutationGeneration: 4, reworkCycles: 4 })
  check('R2_failure_change_then_one_invalid_output_keeps_going', rec2a.decisions.every(x => x.proceed) && rec2inv.decision.proceed, `${rec2a.decisions.map(x => x.classification).join(' ')} | invalid:${rec2inv.decision.proceed}`)

  // ============================ hygiene ============================
  const frozen = deepFreeze(emptyCampaignProgress())
  let pure = true
  try { evaluateFailure(frozen, { fingerprint: fingerprintTestFailure(A_OUT), at: at(), mutationGeneration: 0, reworkCycles: 0 }); noteMutation(frozen, IMPORT_EDIT); noteGreen(frozen, { at: at(), mutationGeneration: 0 }) } catch { pure = false }
  check('X_evaluation_is_pure_and_does_not_mutate_input', pure, String(pure))
  check('X_history_is_bounded', (() => { let p = emptyCampaignProgress(); for (let i = 0; i < 60; i += 1) p = evaluateFailure(p, { fingerprint: fingerprintTestFailure(uniqueFailure(i)), at: at(), mutationGeneration: i, reworkCycles: 0 }).progress; return p.observations.length <= 16 && p.fingerprintHistory.length <= 16 && p.seenFingerprints.length <= 16 && p.notes.length <= 8 })(), 'capped')
  const stopEvidence = blockedEvidence(feed([{ out: A_OUT }, { out: A_OUT }, { out: A_OUT }, { out: A_OUT }].map((step, i) => ({ ...step, edits: i ? [IMPORT_EDIT] : [] }))).progress)
  check('X_blocked_evidence_is_typed_and_persistable', stopEvidence !== null && JSON.parse(JSON.stringify(stopEvidence)).reason === 'STAGNATION_SAME_STRATEGY' && stopEvidence.fingerprint !== null && stopEvidence.recentStrategies.length > 0, JSON.stringify(stopEvidence?.recentStrategies))

  // ==================== gates and wiring are unchanged ====================
  const campaignSource = readFileSync(path.join(process.cwd(), 'lib/native-builder/foundryEngineeringCampaign.ts'), 'utf8').replace(/\r\n/g, '\n')
  const fn = (name: string) => { const start = campaignSource.indexOf(`export function ${name}`); return campaignSource.slice(start, campaignSource.indexOf('\n}\n', start) + 3) }
  check('G_barrier_function_source_unchanged', fn('verificationBarrierSatisfied') === `export function verificationBarrierSatisfied(campaign: {
  mutationGeneration: number
  testReceipts?: CampaignTestReceipt[]
  tasks: readonly { id: string; role: string; status: string }[]
}): boolean {
  const latest = [...(campaign.testReceipts ?? [])].reverse().find(item => item.command.includes('unittest'))
  if (!latest || latest.result !== 'PASSED' || latest.exitCode !== 0) return false
  if (latest.testedMutationGeneration !== campaign.mutationGeneration) return false
  if (campaign.tasks.some(task => task.role === 'DEBUGGER' && task.status !== 'COMPLETE')) return false
  return true
}
`, 'verificationBarrierSatisfied')
  check('G_completion_gate_source_unchanged', fn('campaignCompletionAllowed') === `export function campaignCompletionAllowed(input: {
  verification: string
  testsPassed: boolean
  reviewClear: boolean
  unresolvedFailure: boolean
}): boolean {
  return input.verification === 'PROJECT_READY'
    && input.testsPassed
    && input.reviewClear
    && !input.unresolvedFailure
}
`, 'campaignCompletionAllowed')
  check('G_barrier_still_gates_review_and_verify_and_project_ready', runtimeSource.includes("(current.id === 'review' || current.id === 'verify') && !verificationBarrierSatisfied(state)") && runtimeSource.includes('!allowed || !verificationBarrierSatisfied(state)') && (runtimeSource.match(/verificationBarrierSatisfied/g) ?? []).length === 5 && (runtimeSource.match(/campaignCompletionAllowed/g) ?? []).length === 2, `${(runtimeSource.match(/verificationBarrierSatisfied/g) ?? []).length} refs`)
  const barrierTasks = [{ id: 'debug-1', role: 'DEBUGGER', status: 'COMPLETE' }]
  check('G_barrier_behaviour_still_requires_current_generation_green', verificationBarrierSatisfied({ mutationGeneration: 2, tasks: barrierTasks, testReceipts: [{ testedMutationGeneration: 1, command: 'python3 -m unittest', exitCode: 0, startedAt: '', completedAt: '', result: 'PASSED' }] }) === false && verificationBarrierSatisfied({ mutationGeneration: 1, tasks: barrierTasks, testReceipts: [{ testedMutationGeneration: 1, command: 'python3 -m unittest', exitCode: 0, startedAt: '', completedAt: '', result: 'PASSED' }] }) === true && campaignCompletionAllowed({ verification: 'PROJECT_READY', testsPassed: true, reviewClear: false, unresolvedFailure: false }) === false && reviewerFoundGap('STATUS fail: x') === true, 'barrier + completion gate behave as before')
  check('W_runtime_uses_semantic_evaluation_not_raw_string_or_flat_count', !runtimeSource.includes('priorSame') && !runtimeSource.includes('stalledSameFailure(') && runtimeSource.includes('fingerprintTestFailure(raw') && runtimeSource.includes('openModelRework(finding, fingerprintFinding(finding, \'VERIFY\'), undefined, \'VERIFY\')') && runtimeSource.includes('blockedByProgress('), 'wired')
  check('W_blocked_stagnation_is_reserved_for_stagnation', (runtimeSource.match(/blocked\('BLOCKED_STAGNATION'/g) ?? []).length === 3 && runtimeSource.includes('applyWindowStop(state.progress, state.reworkCycles)') && !runtimeSource.includes("blocked('BLOCKED_REPAIR_LIMIT'"), `${(runtimeSource.match(/blocked\('BLOCKED_STAGNATION'/g) ?? []).length} literal sites (deterministic control path + evaluator fallback)`)
  check('W_events_and_typed_block_persist_in_the_authoritative_record', runtimeSource.includes("'PROGRESS_EVALUATED'") && runtimeSource.includes('detail.progress = blockedEvidence(state.progress)') && runtimeSource.includes('state.progress = noteMutation(') && runtimeSource.includes('noteDebuggerFinding(') && runtimeSource.includes('noteGreen('), 'events, blockedDetail.progress, campaign.progress')
  check('W_budget_extension_is_capped_and_never_shrinks', runtimeSource.includes('Math.max(state.modelCallBudget, progressLimits(state.progress).modelCalls)') && runtimeSource.includes('state.commandsRun > commandLimit()') && runtimeSource.includes('while (guard < progressLimits(state.progress).iterations)'), 'budgets derive from progressLimits')

  const failed = results.filter(result => !result.pass)
  console.log(`PROGRESS_EVALUATION_VALIDATION ${failed.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}

main()
