/**
 * Quiet Execution presentation validation - cases A..L.
 * Fixture events mirror a real persisted engineering campaign (event order, summaries, command output).
 * Pure: no filesystem, git, or network.
 */
import {
  BLOCKED_DETAIL,
  CMD,
  FAIL_OUT,
  ev,
  fullMission,
  quietFixtureCases,
  setFixtureClock,
  truthFor,
} from './foundryQuietFixtures'
import {
  buildCompletionPresentation,
  buildQuietThread,
  groupEngineeringEvents,
  humanFailure,
  shortFailureCause,
  translateInternalState,
  type QuietEvent,
  type QuietThread,
} from './foundryQuietPresentation'

type CaseResult = { name: string; pass: boolean; detail: string }
const results: CaseResult[] = []
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`)
}

const flat = (thread: QuietThread) => thread.activity.flatMap(item => item.events)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const RAW_ENUM = /\b[A-Z]{3,}(?:_[A-Z]{2,})+\b/
const mainText = (thread: QuietThread) => [
  thread.progress.headline,
  ...thread.progress.steps.map(s => s.label),
  thread.progress.failure?.title ?? '',
  thread.intervention?.title ?? '',
  thread.intervention?.body ?? '',
  ...(thread.completion?.facts ?? []),
].join(' | ')

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function main() {
  const FULL = fullMission()
  const generic = (name: string, thread: QuietThread, input: QuietEvent[], maxActivity: number) => {
    check(`${name}_underlying_events_preserved`, same(flat(thread), input), `${flat(thread).length}/${input.length}`)
    check(`${name}_main_ui_compact`, thread.activity.length <= maxActivity && thread.progress.steps.length === 5, `activity=${thread.activity.length} steps=${thread.progress.steps.length}`)
    check(`${name}_no_raw_enums_or_role_dupes_in_main_ui`, !RAW_ENUM.test(mainText(thread)) && !/ARCHITECT ARCHITECT|BACKEND BACKEND/.test(mainText(thread)), mainText(thread).slice(0, 90))
  }

  // ---- CASE A: new mission ----
  const a = buildQuietThread({ events: [], missionStatus: 'running' })
  generic('A', a, [], 0)
  check('A_no_intervention_no_completion', a.intervention === null && a.completion === null && a.progress.working, `working=${a.progress.working}`)
  check('A_all_steps_pending', a.progress.steps.every(s => s.state === 'pending'), a.progress.steps.map(s => s.state).join(','))

  // ---- CASE B: architect working ----
  const bIn = FULL.slice(0, 4)
  const b = buildQuietThread({ events: bIn, missionStatus: 'running' })
  generic('B', b, bIn, 2)
  check('B_translated_headline', b.progress.headline === 'Understanding the project…', b.progress.headline)
  check('B_architect_events_grouped_into_one_item', b.activity.length === 1 && b.activity[0].kind === 'understand' && b.activity[0].status === 'running', `${b.activity.length}`)

  // ---- CASE C: implementation ----
  const cIn = FULL.slice(0, 10)
  const c = buildQuietThread({ events: cIn, missionStatus: 'running' })
  generic('C', c, cIn, 3)
  check('C_translated_headline', c.progress.headline === 'Updating backend…', c.progress.headline)
  check('C_architect_collapsed_to_one_done_item', c.activity.filter(i => i.kind === 'understand').length === 1 && c.activity[0].status === 'done' && c.activity[0].title === 'Analyzed the project', c.activity[0].title)

  // ---- CASE D: test failure ----
  const dIn = FULL.slice(0, 18)
  const d = buildQuietThread({ events: dIn, missionStatus: 'running' })
  generic('D', d, dIn, 6)
  check('D_failure_is_one_compact_line', d.progress.failure?.title === 'NameError in test_tickets', d.progress.failure?.title ?? 'none')
  check('D_raw_output_only_in_technical_detail', d.progress.failure?.outputTail?.includes('Traceback') === true && !mainText(d).includes('Traceback'), 'outputTail present, not in main text')
  check('D_failure_technical_fields', d.progress.failure?.command === CMD && d.progress.failure?.exitCode === 1, `${d.progress.failure?.command} ${d.progress.failure?.exitCode}`)
  check('D_no_intervention_for_recoverable_failure', d.intervention === null && d.progress.working, String(d.intervention))
  const failedItem = d.activity.find(i => i.kind === 'test')
  check('D_failed_test_item_keeps_governance_and_exit', failedItem?.technical.commands[0]?.exitCode === 1 && failedItem.technical.governance[0]?.commandClass === 'REVERSIBLE_MUTATION', JSON.stringify(failedItem?.technical.commands[0]))

  // ---- CASE E: debug / rework ----
  const eIn = FULL.slice(0, 22)
  const campaign = {
    repairFinding: "HYPOTHESIS: The root cause is that 'STATUS_QUERY' is not defined in the backend/api.py file. EVIDENCE: The failing line is 'wanted = normalize_status(query.get(STATUS_QUERY))'. REPAIR_TARGET: backend/api.py. The implementer applies the repair.",
    reworkCycles: 1,
    workerReceipts: [{ role: 'DEBUGGER', provider: 'ollama', model: 'qwen2.5-coder:14b', taskId: 'debug-1', attempt: 1, resultStatus: 'pass', failureClass: null }],
    testReceipts: [{ testedMutationGeneration: 0, command: CMD, exitCode: 1, result: 'FAILED' }],
    mutationGeneration: 1,
  }
  const e = buildQuietThread({ events: eIn, missionStatus: 'running', campaign })
  generic('E', e, eIn, 8)
  check('E_repair_cycle_collapsed', e.progress.repairCycle === 1 && e.progress.steps.find(s => s.id === 'test')?.label === 'Fixing a failing test', e.progress.steps.find(s => s.id === 'test')?.label ?? '')
  const debugItem = e.activity.find(i => i.kind === 'debug')
  check('E_debug_evidence_retained', debugItem?.technical.hypothesis?.includes('STATUS_QUERY') === true && debugItem.technical.repairTarget === 'backend/api.py', `${debugItem?.technical.repairTarget}`)
  check('E_worker_attribution_retained', debugItem?.technical.workers[0]?.provider === 'ollama' && debugItem.technical.workers[0]?.model === 'qwen2.5-coder:14b', JSON.stringify(debugItem?.technical.workers[0]))
  check('E_generation_retained_on_test_item', e.activity.find(i => i.kind === 'test')?.technical.mutationGeneration === 0, String(e.activity.find(i => i.kind === 'test')?.technical.mutationGeneration))

  // two cycles still collapse to 5 steps and "Repair cycle 2"
  setFixtureClock(100)
  const twoCycles: QuietEvent[] = [
    ...FULL.slice(0, 22),
    ev('TASK_COMPLETE', 'pass', 'BACKEND backend'),
    ev('TASK_STARTED', 'running', 'TEST — verifying'),
    ev('COMMAND_COMPLETED', 'fail', 'FAIL', { command: CMD, exitCode: 1, outputTail: FAIL_OUT }),
    ev('REWORKING', 'fail', 'integration defect AssertionError: Lists differ'),
    ev('TASK_STARTED', 'running', 'DEBUGGER — diagnosing'),
    ev('TASK_COMPLETE', 'pass', 'DEBUGGER debug-2'),
    ev('TASK_STARTED', 'running', 'BACKEND — implementing'),
  ]
  const e2 = buildQuietThread({ events: twoCycles, missionStatus: 'running' })
  check('E_two_cycles_collapse_to_one_progress_label', e2.progress.steps.length === 5 && e2.progress.steps.find(s => s.id === 'test')?.label === 'Fixing a failing test' && same(flat(e2), twoCycles), e2.progress.steps.find(s => s.id === 'test')?.label ?? '')

  // ---- CASE F: green tests ----
  const fIn = FULL.slice(0, 28)
  const f = buildQuietThread({ events: fIn, missionStatus: 'running' })
  generic('F', f, fIn, 9)
  check('F_tests_passing_step', f.progress.steps.find(s => s.id === 'test')?.state === 'done' && f.progress.steps.find(s => s.id === 'test')?.label === '6 / 6 tests passing', f.progress.steps.find(s => s.id === 'test')?.label ?? '')
  check('F_no_failure_view_after_green', f.progress.failure === null, String(f.progress.failure))
  check('F_activity_has_green_title', f.activity.some(i => i.title === '6/6 tests passed'), f.activity.map(i => i.title).join(' | '))

  // ---- CASE G: review ----
  const gIn = FULL.slice(0, 29)
  const g = buildQuietThread({ events: gIn, missionStatus: 'running' })
  generic('G', g, gIn, 9)
  check('G_translated_headline', g.progress.headline === 'Reviewing changes…', g.progress.headline)

  // ---- CASE H: verification ----
  const hIn = FULL.slice(0, 34)
  const h = buildQuietThread({ events: hIn, missionStatus: 'running' })
  generic('H', h, hIn, 10)
  check('H_translated_headline', h.progress.headline === 'Verifying from disk…', h.progress.headline)

  // ---- CASE I: complete ----
  const truth = truthFor(FULL, 'completed')
  const i = buildQuietThread({ events: FULL, missionStatus: 'completed', completionTruth: truth, campaign })
  generic('I', i, FULL, 10)
  check('I_ten_compact_items_for_38_events', i.activity.length === 10 && FULL.length === 38, `${i.activity.length}/${FULL.length}`)
  check('I_completion_facts_from_historical_truth', same(i.completion?.facts, ['1 file changed', '6 / 6 tests passed', 'Review accepted', 'Verifier accepted']) && i.completion?.diff === '+1 −1', JSON.stringify(i.completion?.facts))
  check('I_not_working_and_no_intervention', !i.progress.working && i.intervention === null && !i.completion?.rolledBack, `${i.progress.working}`)
  check('I_all_steps_done', i.progress.steps.every(s => s.state === 'done'), i.progress.steps.map(s => s.state).join(','))
  check('I_no_redundant_workspace_paragraphs', !JSON.stringify(i.completion).includes('GENERATED PROJECT COMPLETE') && !JSON.stringify(i.completion).includes('generated project workspace'), 'ok')

  // ---- CASE J: blocked stagnation ----
  const jIn = [...FULL.slice(0, 18), ev('BLOCKED', 'blocked', 'BLOCKED_STAGNATION')]
  const j = buildQuietThread({ events: jIn, missionStatus: 'blocked', blocked: BLOCKED_DETAIL, campaign })
  generic('J', j, jIn, 8)
  check('J_intervention_shown', j.intervention?.kind === 'paused' && j.intervention.title === 'Foundry paused', j.intervention?.title ?? 'none')
  check('J_body_does_not_repeat_the_title', !RAW_ENUM.test(`${j.intervention?.title} ${j.intervention?.body}`) && (j.intervention?.body ?? '').startsWith("I've tried multiple approaches, but the same failure is still present and I'm not gaining new evidence.") && !(j.intervention?.body ?? '').includes('Foundry paused'), j.intervention?.body ?? '')
  check('J_names_the_remaining_problem', (j.intervention?.body ?? '').includes("What keeps failing: the results don't match what a test expects") && !(j.intervention?.body ?? '').includes('AssertionError') && (j.intervention?.technical.failure ?? '').includes('AssertionError: Lists differ'), j.intervention?.body ?? '')
  check('J_technical_reason_retained', j.intervention?.technical.rawState === 'BLOCKED_STAGNATION' && j.intervention.technical.boundary === BLOCKED_DETAIL.boundary && j.intervention.technical.attempts?.[0] === 'CONTRACT_FIELD: failed', JSON.stringify(j.intervention?.technical.rawState))
  check('J_actionable_not_a_dead_end', j.intervention?.actions.map(x => x.id).join(',') === 'retry,review,stop' && j.intervention?.actions[0].label === 'Keep trying', j.intervention?.actions.map(x => x.id).join(',') ?? '')
  check('J_not_working_and_not_complete', !j.progress.working && j.completion === null && j.progress.failure === null, `${j.progress.working}`)

  // ---- CASE K: provider unavailable ----
  const k = buildQuietThread({ events: [], missionStatus: undefined, provider: { blocking: true, detail: 'Local Ollama provider is unreachable.' } })
  check('K_provider_intervention', k.intervention?.kind === 'provider' && k.intervention.title === 'The selected model is unavailable', k.intervention?.title ?? 'none')
  check('K_raw_reason_only_in_technical', k.intervention?.technical.rawState === 'PROVIDER_UNAVAILABLE' && k.intervention.technical.summary === 'Local Ollama provider is unreachable.' && !RAW_ENUM.test(mainText(k)), k.intervention?.technical.rawState ?? '')
  const kNone = buildQuietThread({ events: [], provider: { blocking: false } })
  check('K_no_intervention_when_model_available', kNone.intervention === null, String(kNone.intervention))

  // ---- CASE L: rolled-back completed mission ----
  const lTruth = truthFor(FULL, 'rolled_back')
  const l = buildQuietThread({ events: FULL, missionStatus: 'rolled_back', completionTruth: lTruth, campaign })
  generic('L', l, FULL, 10)
  check('L_history_still_completed', same(l.completion?.facts, ['1 file changed', '6 / 6 tests passed', 'Review accepted', 'Verifier accepted']) && l.completion?.headline === 'Completed', JSON.stringify(l.completion?.facts))
  check('L_rollback_shown_separately', l.completion?.rolledBack === true && l.completion.rolledBackLine === 'Changes from this mission were later reverted.', l.completion?.rolledBackLine ?? '')
  check('L_only_difference_from_I_is_rollback', same({ ...l.completion, rolledBack: false, rolledBackLine: null }, { ...i.completion, rolledBack: false, rolledBackLine: null }), 'ok')

  // ---- Cross-cutting ----
  check('X_intervention_only_when_needed', [a, b, c, d, e, f, g, h, i, l].every(thread => thread.intervention === null) && j.intervention !== null && k.intervention !== null, 'A-I,L none; J,K present')
  check('X_translate_known_states', translateInternalState('BLOCKED_STAGNATION').text === 'Foundry paused after repeated unsuccessful repair attempts.' && translateInternalState('PROVIDER_UNAVAILABLE').text === 'The selected model is unavailable.' && translateInternalState('TEST_RUNNING').text === 'Running tests…' && translateInternalState('REVIEW_RUNNING').text === 'Reviewing changes…', 'table')
  check('X_translate_keeps_raw', translateInternalState('BLOCKED_STAGNATION').raw === 'BLOCKED_STAGNATION' && translateInternalState('Something odd').text.startsWith('Foundry paused: '), 'raw kept')
  check('X_short_cause', shortFailureCause("integration defect NameError: name 'X' is not defined  ====") === "NameError: name 'X' is not defined" && shortFailureCause('nothing') === null, 'cause')
  check('X_no_completion_when_not_complete', buildCompletionPresentation(null) === null, 'null')
  const frozen = deepFreeze(fullMission())
  let pure = true
  try {
    buildQuietThread({ events: frozen, missionStatus: 'completed', completionTruth: truth })
    groupEngineeringEvents(frozen, { terminal: true })
  } catch {
    pure = false
  }
  check('X_pure_does_not_mutate_input', pure, String(pure))

  // ---- CASES M / N: smart stagnation presentation (real evaluator output) ----
  const cases = quietFixtureCases()
  const cm = cases.find(item => item.id === 'M')!
  const cn = cases.find(item => item.id === 'N')!
  const m = buildQuietThread(cm.input)
  generic('M', m, [...cm.input.events], 8)
  check('M_productive_rework_is_not_a_pause', m.intervention === null && m.progress.working, m.intervention?.title ?? 'no intervention')
  check('M_headline_says_still_working', m.progress.headline === 'Foundry is still working…', m.progress.headline)
  check('M_notes_fixed_deeper_repairing', m.progress.notes.map(n => n.text).join(' | ') === 'Fixed missing import | Found a deeper test failure | Repairing it' && m.progress.notes[0].icon === '✓' && m.progress.notes[2].icon === '↻', m.progress.notes.map(n => `${n.icon} ${n.text}`).join(' | '))
  check('M_no_raw_enum_in_main_surface', !RAW_ENUM.test(`${m.progress.headline} ${m.progress.notes.map(n => n.text).join(' ')}`), 'ok')
  check('M_technical_progress_available_in_activity', m.activity.some(item => item.technical.progress.length > 0 && item.technical.progress.some(v => v.classification === 'PROGRESSING' && v.signals.includes('FAILURE_CHANGED'))), m.activity.map(i => i.technical.progress.length).join(','))
  const n = buildQuietThread(cn.input)
  generic('N', n, [...cn.input.events], 16)
  check('N_stagnation_pause_uses_spec_text', n.intervention?.kind === 'paused' && (n.intervention.body).startsWith("I've tried multiple approaches, but the same failure is still present and I'm not gaining new evidence."), n.intervention?.body ?? '')
  check('N_actions_keep_trying_review_stop', n.intervention?.actions.map(a => a.label).join(',') === 'Keep trying,Review problem,Stop', n.intervention?.actions.map(a => a.label).join(',') ?? '')
  check('N_raw_state_only_under_technical_details', !RAW_ENUM.test(`${n.intervention?.title} ${n.intervention?.body}`) && n.intervention?.technical.rawState === 'BLOCKED_STAGNATION', n.intervention?.technical.rawState ?? '')
  const evidence = (n.intervention?.technical.progress ?? []).join(' || ')
  check('N_technical_has_fingerprint_strategy_signals_cycles_budget', /failure fingerprint/.test(evidence) && /strategy changes/.test(evidence) === true && /cycles used \d+ · window \d+ · absolute limit 9/.test(evidence) && /streaks: same failure/.test(evidence), evidence.slice(0, 200))
  check('N_activity_retains_progress_evaluations', n.activity.some(item => item.technical.progress.some(v => v.stop === 'STAGNATION_SAME_STRATEGY')), 'stop persisted')
  const limit = buildQuietThread({ events: [], missionStatus: 'blocked', blocked: { summary: 'BLOCKED_REPAIR_LIMIT', failure: 'x' } })
  check('N_repair_limit_is_not_reported_as_stagnation', limit.intervention?.body.startsWith('I was making progress') === true && limit.intervention.technical.rawState === 'BLOCKED_REPAIR_LIMIT', limit.intervention?.body ?? '')
  const cap = buildQuietThread({ events: [], missionStatus: 'blocked', blocked: { summary: 'BLOCKED_CAPABILITY', failure: 'x' } })
  check('N_capability_block_has_its_own_message', cap.intervention?.body.startsWith('The model kept returning results') === true && cap.intervention.actions.map(a => a.label).join(',') === 'Keep trying,Review problem,Stop', cap.intervention?.body ?? '')

  // ---- Human-language main thread: no counters, ids, enums, worker names, or raw output in the default conversation ----
  const MAIN_FORBIDDEN = /\b(cycle|fingerprint|strategy|PROGRESS_EVALUATED|TASK_STARTED|BLOCKED_[A-Z_]+|FAILURE_CHANGED|NEW_STRATEGY|credits?|absolute|attempt \d|\d+\/\d+ cycles?)\b|Traceback|\bat 0x|File "/i
  const mainFor = (thread: QuietThread) => [thread.progress.headline, ...thread.progress.steps.map(x => x.label), ...thread.progress.narrative, thread.progress.failure ? '' : '', thread.intervention?.title ?? '', thread.intervention?.body ?? '', ...(thread.completion?.facts ?? [])].join(' | ')
  for (const fixtureCase of quietFixtureCases()) {
    const thread = buildQuietThread(fixtureCase.input)
    check(`H_${fixtureCase.id}_main_thread_is_plain_language`, !MAIN_FORBIDDEN.test(mainFor(thread)), mainFor(thread).slice(0, 160))
  }
  check('H_productive_narrative_reads_like_a_person', m.progress.narrative.join(' ').includes('I fixed the missing import, but the tests exposed a deeper problem') && m.progress.narrative.join(' ').includes("I'm tracing that now") || m.progress.narrative.join(' ').includes("I'm repairing it now"), m.progress.narrative.join(' | '))
  check('H_narrative_says_what_happened_and_what_happens_next', m.progress.narrative.length >= 2 && /fixed the missing import/.test(m.progress.narrative[0]) && /now\.$/.test(m.progress.narrative[m.progress.narrative.length - 1]), m.progress.narrative.join(' | '))
  check('H_human_failure_translation', humanFailure("NameError: name 'STATUS_QUERY' is not defined") === "STATUS_QUERY isn't defined" && humanFailure('AssertionError: Lists differ: [] != [1]') === "the results don't match what a test expects" && humanFailure('ImportError: Failed to import test module: t') === 'the tests could not even load' && humanFailure(null) === 'a test failed', 'translations')
  check('H_technical_detail_stays_available_but_collapsed', m.activity.some(item => item.technical.progress.length > 0) && Boolean(n.intervention?.technical.progress?.length) && n.intervention?.technical.failure !== undefined, 'Activity + Technical details keep the raw evidence')
  const decisionEvents = [ev('COMMANDER_DECISION', 'info', 'The Commander chose Keep trying.')]
  const dec = groupEngineeringEvents(decisionEvents)
  check('H_commander_decision_is_a_visible_activity_item', dec.length === 1 && dec[0].kind === 'decision' && dec[0].title === 'You chose to keep trying' && same(dec[0].events, decisionEvents), dec[0]?.title ?? '')

  // Robustness: unknown event types and non-campaign runtime events must still be preserved and grouped.
  setFixtureClock(500)
  const generic2: QuietEvent[] = [
    ev('MISSION_STARTED', 'info', 'Started'), ev('WORKSPACE_SCAN_STARTED', 'running', 'scan'), ev('FILE_READ', 'pass', 'read', { filePath: 'a.py' }),
    ev('FILE_EDITED', 'pass', 'a.py', { filePath: 'a.py' }), ev('COMMAND_COMPLETED', 'pass', 'ok', { command: 'pytest', exitCode: 0 }),
    ev('SOMETHING_NEW', 'info', 'unknown type'),
  ]
  const r = buildQuietThread({ events: generic2, missionStatus: 'running' })
  check('X_unknown_and_non_campaign_events_preserved', same(flat(r), generic2) && r.activity.length < generic2.length, `${r.activity.length} groups / ${generic2.length} events`)

  const failed = results.filter(result => !result.pass)
  console.log(`QUIET_PRESENTATION_VALIDATION ${failed.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}

main()
