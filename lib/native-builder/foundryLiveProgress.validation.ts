/**
 * Live progress validation: cases A..F from the brief, proven on the pure derivation that the UI renders.
 * The panel is a pure function of the persisted event stream, so "restart restores exact progress" and "reopen matches live"
 * are equality checks between derivations, and "no timers" is a property of the source.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fullMission, productiveProgressEvents, quietFixtureCases, setFixtureClock, trueStagnationEvents, stagnationBlockedDetail, truthFor } from './foundryQuietFixtures'
import { buildLiveProgress, buildLiveProgressFromItems, liveProgressLines, type LiveProgress, type LiveStepId } from './foundryLiveProgress'
import { buildQuietThread, type QuietEvent } from './foundryQuietPresentation'

type CaseResult = { name: string; pass: boolean; detail: string }
const results: CaseResult[] = []
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`)
}

const RAW = /\b(TASK_STARTED|TASK_COMPLETE|PROGRESS_EVALUATED|BLOCKED_[A-Z_]+|FAILURE_CHANGED|NEW_STRATEGY|mutationGeneration|cycle \d|QUEUED|RUNNING|PASS|FAIL|PAUSED|SKIPPED)\b/
const stateOf = (p: LiveProgress, id: LiveStepId) => p.steps.find(s => s.id === id)!.state
const walk = (events: readonly QuietEvent[], finalStatus: string) => events.map((_, i) => buildLiveProgress({ events: events.slice(0, i + 1), missionStatus: i === events.length - 1 ? finalStatus : 'running' }))
const stable = ['understand', 'plan', 'build'] as LiveStepId[]

function main() {
  const full = fullMission()
  // ------------------------------------------------------------------ A. normal successful mission (no failure)
  const clean = [...full.slice(0, 13), ...full.slice(23)] // drop the failure / repair segment
  const a = walk(clean, 'completed')
  check('A_final_state_is_8_of_8_project_ready', a[a.length - 1].done === 8 && a[a.length - 1].status === 'complete' && stateOf(a[a.length - 1], 'ready') === 'PASS' && stateOf(a[a.length - 1], 'fix') === 'SKIPPED', a[a.length - 1].countLabel)
  check('A_count_never_moves_backwards_and_reaches_every_stage_in_order', a.every((p, i) => i === 0 || p.done >= a[i - 1].done) && new Set(a.map(p => p.done)).size >= 6, `${[...new Set(a.map(p => p.done))].join(',')}`)
  check('A_at_most_one_active_step_at_any_moment', a.every(p => p.steps.filter(s => s.state === 'RUNNING').length <= 1), 'single primary active step')
  check('A_completed_steps_stay_visible_and_never_revert', a.every((p, i) => i === 0 || stable.every(id => stateOf(a[i - 1], id) !== 'PASS' || stateOf(p, id) === 'PASS')), 'understand/plan/build stay PASS')
  check('A_active_step_is_the_stage_the_runtime_is_in', a.some(p => p.activeId === 'test' && p.steps.find(s => s.id === 'test')!.label === 'Running tests…' && (p.steps.find(s => s.id === 'test')!.detail ?? '').length > 0) && a.some(p => p.activeId === 'review') && a.some(p => p.activeId === 'verify'), 'test/review/verify each become active from their own events')
  check('A_labels_are_plain_language', a.every(p => p.steps.every(s => !RAW.test(s.label) && !RAW.test(s.detail ?? '') && s.notes.every(n => !RAW.test(n.text)))) && /^Progress · \d\/8$/.test(a[0].countLabel), liveProgressLines(a[a.length - 1]).join(' | '))

  // A reviewer concern that needed no change (live finding: 05g normal mission) is not a failed review or a 7/8 finish.
  const concern = clean.flatMap(e => (e.type === 'REVIEWING' ? [{ ...e, status: 'fail', summary: 'STATUS fail: something the runtime judged non-actionable' }] : [e]))
  const cp = walk(concern, 'completed')
  check('A_nonactionable_review_concern_does_not_fail_the_panel', cp[cp.length - 1].done === 8 && cp.every(p => stateOf(p, 'review') !== 'FAIL') && cp[cp.length - 1].steps.find(s => s.id === 'review')!.technical.some(t => /needed no change/.test(t)), cp[cp.length - 1].countLabel)
  const actionable = full.flatMap(e => (e.type === 'REVIEWING' ? [{ ...e, status: 'fail', summary: 'STATUS fail: real gap' }, { ...e, type: 'REWORKING', status: 'fail', summary: 'STATUS fail: real gap' }] : [e]))
  check('A_a_review_that_leads_to_rework_does_fail_the_review_step_live', walk(actionable, 'running').some(p => stateOf(p, 'review') === 'FAIL'), 'FAIL only when a rework follows')

  // The real runtime order is REVIEWING(fail) → PROGRESS_EVALUATED → REWORKING → PLAN_REVISED; bookkeeping between them must not settle the review as passed.
  const realOrder = full.flatMap(e => (e.type === 'REVIEWING' ? [{ ...e, status: 'fail', summary: 'STATUS fail: real gap' }, { ...e, type: 'PROGRESS_EVALUATED', status: 'info', summary: 'PROGRESSING', detail: undefined }, { ...e, type: 'REWORKING', status: 'fail', summary: 'STATUS fail: real gap' }, { ...e, type: 'PLAN_REVISED', status: 'info', summary: 'The review found a gap.', detail: '{}' }] : [e]))
  const realWalk = walk(realOrder, 'running')
  const atRework = realWalk.find(p => p.steps.find(s => s.id === 'fix')!.state === 'RUNNING' && stateOf(p, 'review') !== 'QUEUED')
  check('A_review_stays_failed_while_its_rework_runs_even_with_bookkeeping_events_between', Boolean(atRework) && stateOf(atRework!, 'review') === 'FAIL', atRework ? `review=${stateOf(atRework, 'review')} ${atRework.countLabel}` : 'no rework sample')

  // ------------------------------------------------------------------ B. test fails, then repair succeeds
  const b = walk(full, 'completed')
  const failAt = b.findIndex(p => stateOf(p, 'test') === 'FAIL')
  const fixAt = b.findIndex(p => stateOf(p, 'fix') === 'RUNNING')
  const againAt = b.findIndex((p, i) => i > fixAt && stateOf(p, 'test') === 'RUNNING')
  check('B_failure_changes_the_flow_live', failAt >= 0 && fixAt >= failAt && stateOf(b[fixAt], 'test') === 'FAIL' && b[fixAt].steps.find(s => s.id === 'test')!.label.startsWith('Tests found') && b[fixAt].steps.find(s => s.id === 'fix')!.label === 'Fixing the problem…', `fail@${failAt} fix@${fixAt}`)
  const passAt = b.findIndex((p, i) => i > againAt && stateOf(p, 'test') === 'PASS')
  check('B_after_the_repair_tests_run_again_and_the_fix_is_not_claimed_before_the_tests_confirm_it', againAt > fixAt && b[againAt].steps.find(s => s.id === 'test')!.label === 'Running tests again…' && stateOf(b[againAt], 'fix') === 'QUEUED' && passAt > againAt && stateOf(b[passAt], 'fix') === 'PASS', `again@${againAt} pass@${passAt}`)
  check('B_progress_is_never_reset_during_repair', b.every((p, i) => i === 0 || p.done >= b[i - 1].done - 0) && b.slice(failAt).every(p => p.done >= 3), `min after failure ${Math.min(...b.slice(failAt).map(p => p.done))}/8`)
  check('B_ends_complete_with_every_stage_passed', b[b.length - 1].done === 8 && b[b.length - 1].steps.every(s => s.state === 'PASS'), liveProgressLines(b[b.length - 1]).join(' | '))

  // ------------------------------------------------------------------ C. deeper defect appears after the first repair
  const m = productiveProgressEvents()
  const c = walk(m.events, 'running')
  const deeper = c[c.length - 1]
  const fixNotes = deeper.steps.find(s => s.id === 'fix')!.notes.map(n => n.text)
  check('C_replanning_shows_as_real_progress', fixNotes.includes('Fixed missing import') && fixNotes.includes('Found a deeper issue') && fixNotes.includes('Updating the plan…'), fixNotes.join(' | '))
  check('C_deeper_defect_does_not_reset_the_panel', deeper.done >= 3 && stateOf(deeper, 'understand') === 'PASS' && stateOf(deeper, 'plan') === 'PASS' && stateOf(deeper, 'build') === 'PASS' && stateOf(deeper, 'fix') === 'RUNNING' && stateOf(deeper, 'test') === 'FAIL', `${deeper.countLabel} test=${stateOf(deeper, 'test')} fix=${stateOf(deeper, 'fix')}`)
  check('C_the_deeper_failure_is_named_in_human_words', deeper.steps.find(s => s.id === 'test')!.label === "Tests found the results don't match what a test expects", deeper.steps.find(s => s.id === 'test')!.label)

  // ------------------------------------------------------------------ D. real stagnation / pause
  const st = trueStagnationEvents()
  const d = buildLiveProgress({ events: st.events, missionStatus: 'blocked', blocked: stagnationBlockedDetail(st.progress) })
  const paused = d.steps.filter(s => s.state === 'PAUSED')
  check('D_pause_is_one_visible_step_and_prior_progress_is_kept', d.status === 'paused' && paused.length === 1 && paused[0].label === 'Foundry paused' && stateOf(d, 'understand') === 'PASS' && stateOf(d, 'plan') === 'PASS' && stateOf(d, 'build') === 'PASS' && d.done >= 3 && d.done < 8, `${d.countLabel} ${liveProgressLines(d).join(' | ')}`)
  check('D_steps_after_the_pause_stay_queued_not_faked', ['review', 'verify', 'ready'].every(id => stateOf(d, id as LiveStepId) === 'QUEUED'), 'review/verify/ready queued')

  check('D_repeated_failed_attempts_stay_visible_without_counters', d.steps.find(s => s.id === 'fix')!.notes.some(n => /attempts? didn't fix it/.test(n.text)) && !d.steps.some(s => s.notes.some(n => /\d/.test(n.text))), d.steps.find(s => s.id === 'fix')!.notes.map(n => n.text).join(' | '))
  const midStag = buildLiveProgress({ events: st.events.slice(0, 30), missionStatus: 'running' })
  check('D_live_detail_names_what_the_fix_step_is_doing_now', midStag.steps.some(s => s.id === 'fix' && s.state === 'RUNNING' && (s.detail ?? '').length > 0), midStag.steps.find(s => s.id === 'fix')?.detail ?? 'none')

  // ------------------------------------------------------------------ E. restart during an active mission
  const cut = full.slice(0, 22)
  const live = buildLiveProgress({ events: cut, missionStatus: 'running' })
  const persisted = JSON.parse(JSON.stringify(cut)) as QuietEvent[] // what the repair record holds
  const restored = buildLiveProgress({ events: persisted, missionStatus: 'running' })
  check('E_restart_restores_exact_progress_from_the_persisted_record', JSON.stringify(live) === JSON.stringify(restored), `${restored.countLabel} active=${restored.activeId}`)
  const restoredThread = buildQuietThread({ events: persisted, missionStatus: 'running' })
  check('E_restored_current_step_and_prior_statuses_are_preserved', JSON.stringify(restoredThread.live) === JSON.stringify(live) && restored.activeId === live.activeId && restored.steps.map(s => s.label).join('|') === live.steps.map(s => s.label).join('|'), 'labels identical')
  const panelSource = readFileSync(path.join(process.cwd(), 'components/war-room/foundry/FoundryLiveProgressPanel.tsx'), 'utf8')
  const shellSource = readFileSync(path.join(process.cwd(), 'components/war-room/foundry/FoundryShell.tsx'), 'utf8').replace(/\r\n/g, '\n')
  check('E_no_0_of_N_flash_before_hydration', panelSource.includes('Loading mission progress…') && panelSource.includes('if (loading || !progress)') && shellSource.includes("missionLoad === 'loading' && !engineeringEvents.length ? <FoundryLiveProgressPanel progress={null} loading />"), 'loading state renders text, not an empty count')
  check('E_empty_record_is_not_labelled_progress_until_hydrated', shellSource.includes("!(missionLoad === 'loading' && !engineeringEvents.length)"), 'the thread is withheld while loading')

  // ------------------------------------------------------------------ F. completed mission reopen
  const cases = quietFixtureCases()
  const finished = cases.find(x => x.id === 'I')!
  const rolled = cases.find(x => x.id === 'L')!
  const liveEnd = buildLiveProgress({ events: full, missionStatus: 'completed' })
  const reopened = buildQuietThread(finished.input).live
  const rolledLive = buildQuietThread(rolled.input).live
  check('F_reopened_completed_mission_shows_the_same_final_state', JSON.stringify(reopened) === JSON.stringify(liveEnd) && reopened.done === 8 && reopened.status === 'complete', reopened.countLabel)
  check('F_rolled_back_mission_keeps_its_historical_progress', rolledLive.done === 8 && rolledLive.status === 'complete', rolledLive.countLabel)
  void truthFor; void setFixtureClock

  // ------------------------------------------------------------------ runtime-truth source and presentation rules
  const liveSource = readFileSync(path.join(process.cwd(), 'lib/native-builder/foundryLiveProgress.ts'), 'utf8')
  check('T_no_timers_clocks_or_randomness_in_the_derivation', !/Date\.now|new Date|setTimeout|setInterval|Math\.random|requestAnimationFrame/.test(liveSource) && !/setTimeout|setInterval|requestAnimationFrame|Math\.random/.test(panelSource), 'pure function of the event stream')
  check('T_same_input_same_output_regardless_of_time', JSON.stringify(buildLiveProgress({ events: full, missionStatus: 'running' })) === JSON.stringify(buildLiveProgress({ events: JSON.parse(JSON.stringify(full)) as QuietEvent[], missionStatus: 'running' })), 'deterministic')
  check('T_source_is_the_mission_record_event_stream', liveSource.includes('derived from the authoritative mission record') && shellSource.includes('buildQuietThread({') && shellSource.includes('engineer?.engineeringRuntime?.events'), 'engineeringRuntime.events → buildQuietThread → live')
  check('T_every_case_uses_only_human_language_in_the_main_panel', cases.every(x => { const p = buildQuietThread(x.input).live; return p.steps.every(s => !RAW.test(s.label) && !RAW.test(s.detail ?? '') && s.notes.every(n => !RAW.test(n.text))) }), 'A..N')
  check('T_technical_evidence_stays_available_off_the_main_panel', buildLiveProgress({ events: m.events, missionStatus: 'running' }).steps.some(s => s.technical.some(t => /PROGRESSING|failure:/.test(t))), 'technical[] keeps raw evidence')

  // ------------------------------------------------------------------ controller (application-builder) missions use the same states
  const ctl = buildLiveProgressFromItems({ items: [
    { id: 'understand', label: 'Understanding what you want', state: 'done' },
    { id: 'requirements', label: 'Planning the build', state: 'done' },
    { id: 'patch_source', label: 'Building interface', state: 'active' },
    { id: 'test', label: 'Running tests', state: 'pending' },
    { id: 'diagnose', label: 'Fixing a problem', state: 'pending' },
    { id: 'browser', label: 'Checking desktop', state: 'pending' },
    { id: 'complete', label: 'Project ready', state: 'pending' },
  ], missionStatus: 'BUILDING' })
  check('C1_controller_plan_maps_to_live_states', ctl.done === 2 && (ctl.activeId as string) === 'patch_source' && ctl.steps[2].label === 'Building interface…' && ctl.steps[0].label === 'Understood the project' && ctl.steps[1].label === 'Build plan ready' && ctl.steps[3].state === 'QUEUED', liveProgressLines(ctl).join(' | '))
  const ctlDone = buildLiveProgressFromItems({ items: [{ id: 'understand', label: 'Understanding what you want', state: 'done' }, { id: 'test', label: 'Running tests', state: 'done' }, { id: 'browser', label: 'Checking desktop', state: 'done' }, { id: 'complete', label: 'Project ready', state: 'pending' }], missionStatus: 'PROJECT_READY' })
  check('C1_controller_completion_reaches_final_state', ctlDone.status === 'complete' && ctlDone.done === ctlDone.total && ctlDone.steps[ctlDone.steps.length - 1].label === 'Project ready', ctlDone.countLabel)
  const ctlPaused = buildLiveProgressFromItems({ items: [{ id: 'understand', label: 'Understanding what you want', state: 'done' }, { id: 'test', label: 'Running tests', state: 'failed' }, { id: 'complete', label: 'Project ready', state: 'pending' }], missionStatus: 'BLOCKED', blocked: true })
  check('C1_controller_pause_is_one_visible_step_and_keeps_prior_progress', ctlPaused.status === 'paused' && ctlPaused.steps.filter(s => s.state === 'PAUSED').length === 1 && ctlPaused.done === 1, ctlPaused.countLabel)

  const failed = results.filter(r => !r.pass)
  console.log(`LIVE_PROGRESS_VALIDATION ${failed.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}

main()
