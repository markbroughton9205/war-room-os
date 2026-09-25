/**
 * Completed-mission history truth validation.
 * Evidence shapes mirror a real persisted engineering-campaign record (unittest output, FILE_EDITED
 * diff, REVIEWING / PROJECT_READY / MISSION_COMPLETE events). Does not touch the filesystem or git.
 */
import { buildFoundryCompletionTruth } from './foundryCompletionTruth'
import { buildEngineeringCompletionTruth, parseUnittestCounts, type EngineeringRuntimeEvidence } from './foundryCompletionHistory'

type CaseResult = { name: string; pass: boolean; detail: string }
const results: CaseResult[] = []
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`)
}

const FAILED_OUTPUT = "\nNameError: name 'STATUS_QUERY' is not defined\n\n----------------------------------------------------------------------\nRan 6 tests in 0.001s\n\nFAILED (errors=4)\n"
const OK_OUTPUT = '----------------------------------------------------------------------\nRan 6 tests in 0.000s\n\nOK\n'
const EDIT_DIFF = '--- backend/api.py\n+++ backend/api.py\n-from shared.contract import normalize_status\n+from shared.contract import normalize_status, STATUS_QUERY'

function completedRuntime(patch: Partial<EngineeringRuntimeEvidence> = {}): EngineeringRuntimeEvidence {
  return {
    completion: {
      canComplete: true,
      changedFiles: ['backend/api.py'],
      tests: [{ command: 'unittest discover tests', ok: true, summary: 'integrate fail; integrate pass; verify pass' }],
    },
    events: [
      { type: 'CAMPAIGN_STARTED', status: 'running' },
      { type: 'COMMAND_COMPLETED', status: 'fail', exitCode: 1, outputTail: FAILED_OUTPUT },
      { type: 'FILE_EDITED', status: 'pass', diff: EDIT_DIFF },
      { type: 'COMMAND_COMPLETED', status: 'pass', exitCode: 0, outputTail: OK_OUTPUT },
      { type: 'REVIEWING', status: 'pass' },
      { type: 'COMMAND_COMPLETED', status: 'pass', exitCode: 0, outputTail: OK_OUTPUT },
      { type: 'PROJECT_READY', status: 'pass' },
      { type: 'MISSION_COMPLETE', status: 'pass' },
    ],
    scope: { created: [] },
    blockedDetail: null,
    campaign: { verification: 'PROJECT_READY' },
    ...patch,
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function main() {
  // ---- CASE A: completed mission, no rollback ----
  const a = buildEngineeringCompletionTruth({ missionStatus: 'completed', runtime: completedRuntime() })
  check('A_completed_not_null', a !== null, String(a !== null))
  check('A_can_complete', a?.canComplete === true && a.headline === 'GENERATED PROJECT COMPLETE', `${a?.canComplete} ${a?.headline}`)
  check('A_changed_file_count', (a?.created.length ?? 0) + (a?.modified.length ?? 0) === 1 && a?.modified[0] === 'backend/api.py', JSON.stringify(a?.modified))
  check('A_test_count', a?.tests.ran === true && a.tests.ok && a.tests.pass === 6 && a.tests.total === 6 && a.tests.fail === 0, `${a?.tests.pass}/${a?.tests.total}`)
  check('A_diff_from_mission_edits', a?.plus === 1 && a?.minus === 1, `+${a?.plus} -${a?.minus}`)
  check('A_validation_verified', a?.history?.validation === 'COMPLETE / VERIFIED', a?.history?.validation ?? 'none')
  check('A_review_and_verifier', a?.history?.review === 'accepted' && a?.history?.verifier === 'accepted', `${a?.history?.review}/${a?.history?.verifier}`)
  check('A_not_rolled_back', a?.history?.rolledBack === false, String(a?.history?.rolledBack))
  check('A_counts_recorded', a?.history?.testsCounted === true && a?.history?.diffKnown === true, `${a?.history?.testsCounted}/${a?.history?.diffKnown}`)

  // ---- CASE B: app restart + reopen ----
  const persisted = completedRuntime()
  const reopened = clone(persisted) // the record as re-read from disk after a restart
  const b = buildEngineeringCompletionTruth({ missionStatus: 'completed', runtime: reopened })
  check('B_restart_roundtrip_identical', same(a, b), 'json roundtrip')
  // The exact inputs the card used to fall back on after reopen: no legacy files, no validation operations, no live diff.
  const legacy = buildFoundryCompletionTruth({ surface: 'generated_project', filesChanged: [], diff: undefined, validationResults: [] })
  check('B_legacy_fallback_is_the_bug', legacy.canComplete === false && legacy.headline === 'NOT COMPLETE' && legacy.tests.ran === false, `${legacy.headline} ran=${legacy.tests.ran}`)
  check('B_history_beats_legacy_for_same_mission', b?.canComplete === true && legacy.canComplete === false, `${b?.canComplete} vs ${legacy.canComplete}`)
  check('B_historical_test_count_survives_restart', b?.tests.pass === 6 && b?.tests.total === 6, `${b?.tests.pass}/${b?.tests.total}`)
  check('B_historical_file_count_survives_restart', (b?.modified.length ?? 0) === 1, String(b?.modified.length))

  // ---- CASE C: completed, then mission rollback ----
  const c = buildEngineeringCompletionTruth({ missionStatus: 'rolled_back', runtime: completedRuntime() })
  check('C_completion_survives_rollback', c?.canComplete === true && c?.history?.validation === 'COMPLETE / VERIFIED', `${c?.canComplete} ${c?.history?.validation}`)
  check('C_files_and_tests_survive_rollback', (c?.modified.length ?? 0) === 1 && c?.tests.pass === 6 && c?.tests.total === 6 && c?.plus === 1 && c?.minus === 1, `${c?.modified.length} ${c?.tests.pass}/${c?.tests.total}`)
  check('C_rollback_rendered_separately', c?.history?.rolledBack === true, String(c?.history?.rolledBack))
  const cComparable = clone(c)
  if (cComparable?.history) cComparable.history.rolledBack = false
  check('C_rollback_only_adds_the_rollback_flag', same(a, cComparable), 'A == C except rolledBack')
  check('C_rolled_back_is_never_not_complete', c?.headline !== 'NOT COMPLETE', c?.headline ?? '')

  // ---- CASE D: incomplete / blocked missions must never show complete ----
  const blockedRuntime: EngineeringRuntimeEvidence = {
    completion: null,
    events: [{ type: 'BLOCKED', status: 'blocked' }],
    scope: { created: [] },
    blockedDetail: { summary: 'BLOCKED_STAGNATION' },
    campaign: { verification: null },
  }
  const d1 = buildEngineeringCompletionTruth({ missionStatus: 'blocked', runtime: blockedRuntime })
  check('D_blocked_has_no_historical_completion', d1 === null, String(d1))
  const d1Legacy = buildFoundryCompletionTruth({ surface: 'generated_project', filesChanged: [], validationResults: [] })
  check('D_blocked_falls_back_to_not_complete', d1Legacy.canComplete === false && d1Legacy.headline === 'NOT COMPLETE', d1Legacy.headline)
  const d2 = buildEngineeringCompletionTruth({
    missionStatus: 'blocked',
    runtime: completedRuntime({ completion: { canComplete: false, changedFiles: ['backend/api.py'], tests: [{ command: 'unittest discover tests', ok: false, summary: 'integrate fail' }] } }),
  })
  check('D_failed_tests_not_complete', d2?.canComplete === false && d2.headline === 'NOT COMPLETE' && d2.history?.validation === 'NOT COMPLETE' && d2.tests.ok === false, `${d2?.canComplete} ${d2?.headline}`)
  const noReady = completedRuntime({ events: [{ type: 'COMMAND_COMPLETED', status: 'pass', exitCode: 0, outputTail: OK_OUTPUT }], campaign: { verification: null } })
  const d3 = buildEngineeringCompletionTruth({ missionStatus: 'running', runtime: noReady })
  check('D_completion_never_inferred_without_ready_event', d3?.canComplete === false && d3?.history?.verifier === 'none', `${d3?.canComplete} ${d3?.history?.verifier}`)
  const d4 = buildEngineeringCompletionTruth({ missionStatus: 'blocked', runtime: completedRuntime({ blockedDetail: { summary: 'BLOCKED_STAGNATION' } }) })
  check('D_blocked_detail_overrides_ready_event', d4?.canComplete === false, String(d4?.canComplete))
  check('D_no_blocked_false_complete', [d1, d2, d3, d4].every(item => item === null || item.canComplete === false), 'count=0')

  // ---- No invention / robustness ----
  const noOutput = buildEngineeringCompletionTruth({
    missionStatus: 'completed',
    runtime: completedRuntime({ events: [{ type: 'PROJECT_READY', status: 'pass' }] }),
  })
  check('E_unknown_test_count_is_not_guessed', noOutput?.history?.testsCounted === false && noOutput?.tests.total === 0 && (noOutput?.tests.reason ?? '').includes('count not recorded'), noOutput?.tests.reason ?? '')
  check('E_unknown_diff_is_not_guessed', noOutput?.history?.diffKnown === false && noOutput?.plus === 0 && noOutput?.minus === 0, String(noOutput?.history?.diffKnown))
  check('E_files_still_from_completion_record', (noOutput?.modified.length ?? 0) === 1, String(noOutput?.modified.length))
  check('F_parse_ok', same(parseUnittestCounts(OK_OUTPUT), { total: 6, passed: 6, failed: 0 }), JSON.stringify(parseUnittestCounts(OK_OUTPUT)))
  check('F_parse_failed_mixed', same(parseUnittestCounts('Ran 10 tests in 0.1s\n\nFAILED (failures=1, errors=2)\n'), { total: 10, passed: 7, failed: 3 }), 'failures+errors')
  check('F_parse_singular', same(parseUnittestCounts('Ran 1 test in 0.0s\n\nOK\n'), { total: 1, passed: 1, failed: 0 }), 'Ran 1 test')
  check('F_parse_unknown_outcome_is_null', parseUnittestCounts('Ran 3 tests in 0.0s\n') === null && parseUnittestCounts('no counts here') === null && parseUnittestCounts(undefined) === null, 'null')
  const lastPass = buildEngineeringCompletionTruth({
    missionStatus: 'completed',
    runtime: completedRuntime({
      events: [
        { type: 'COMMAND_COMPLETED', status: 'pass', exitCode: 0, outputTail: 'Ran 4 tests in 0.0s\n\nOK\n' },
        { type: 'COMMAND_COMPLETED', status: 'fail', exitCode: 1, outputTail: FAILED_OUTPUT },
        { type: 'COMMAND_COMPLETED', status: 'pass', exitCode: 0, outputTail: OK_OUTPUT },
        { type: 'PROJECT_READY', status: 'pass' },
      ],
    }),
  })
  check('G_uses_last_passing_run', lastPass?.tests.total === 6, String(lastPass?.tests.total))
  const meta = buildEngineeringCompletionTruth({
    missionStatus: 'completed',
    runtime: completedRuntime({ completion: { canComplete: true, changedFiles: ['backend/api.py', '.war-room/native-builder/x.json', 'new.py'], tests: [{ command: 'unittest discover tests', ok: true }] }, scope: { created: ['new.py'] } }),
  })
  check('G_metadata_excluded_and_created_split', same(meta?.modified, ['backend/api.py']) && same(meta?.created, ['new.py']) && meta?.metadataFiles.length === 1, `${meta?.modified} | ${meta?.created} | ${meta?.metadataFiles}`)
  const findings = buildEngineeringCompletionTruth({
    missionStatus: 'completed',
    runtime: completedRuntime({ events: [{ type: 'REVIEWING', status: 'pass' }, { type: 'REVIEWING', status: 'fail' }, { type: 'MISSION_COMPLETE', status: 'pass' }], campaign: { verification: null } }),
  })
  check('G_last_review_decides', findings?.history?.review === 'findings' && findings?.history?.verifier === 'none', `${findings?.history?.review}/${findings?.history?.verifier}`)
  check('G_no_runtime_or_completion_is_null', buildEngineeringCompletionTruth({}) === null && buildEngineeringCompletionTruth({ runtime: { completion: null } }) === null, 'null')
  let frozenOk = true
  try {
    buildEngineeringCompletionTruth({ missionStatus: 'rolled_back', runtime: deepFreeze(completedRuntime()) })
  } catch {
    frozenOk = false
  }
  check('H_pure_does_not_mutate_input', frozenOk, String(frozenOk))

  const failed = results.filter(result => !result.pass)
  console.log(`COMPLETION_HISTORY_VALIDATION ${failed.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}

main()
