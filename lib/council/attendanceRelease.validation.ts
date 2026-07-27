import { buildAttendanceLateLines, type AttendanceReleaseCell } from './attendanceRelease'
import { pathToFileURL } from 'node:url'

type CaseResult = {
  name: string
  pass: boolean
  detail: string
}

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function cell(overrides: Partial<AttendanceReleaseCell> & Pick<AttendanceReleaseCell, 'family'>): AttendanceReleaseCell {
  return { textOut: null, runtime: 'RESPONDED', ...overrides }
}

const fallback = (family: string, slotStatus: string) => `${family} ${slotStatus.toLowerCase()}.`

// Scenario: all five completed before soft cap — nothing left to late-release, so the
// late batch must be empty and no family should be duplicated into it.
const allFiveInSoftCap = buildAttendanceLateLines(
  [
    cell({ family: 'chatgpt', textOut: 'chatgpt reply', runtime: 'RESPONDED' }),
    cell({ family: 'claude', textOut: 'claude reply', runtime: 'RESPONDED' }),
    cell({ family: 'grok', textOut: 'grok reply', runtime: 'RESPONDED' }),
    cell({ family: 'gemini', textOut: 'gemini reply', runtime: 'RESPONDED' }),
    cell({ family: 'red_team', textOut: 'red team reply', runtime: 'RESPONDED' }),
  ],
  new Set(['chatgpt', 'claude', 'grok', 'gemini', 'red_team']),
  fallback,
)

// Scenario: chatgpt/claude/grok made the soft-cap batch; gemini and red_team arrived
// late (before hard-close) with real content — both must appear in the late batch,
// and the three already-revealed families must not reappear.
const threeSoftCapTwoLate = buildAttendanceLateLines(
  [
    cell({ family: 'chatgpt', textOut: 'chatgpt reply', runtime: 'RESPONDED' }),
    cell({ family: 'claude', textOut: 'claude reply', runtime: 'RESPONDED' }),
    cell({ family: 'grok', textOut: 'grok late reply', runtime: 'RESPONDED' }),
    cell({ family: 'gemini', textOut: 'gemini late reply', runtime: 'RESPONDED' }),
    cell({ family: 'red_team', textOut: 'red team late reply', runtime: 'RESPONDED' }),
  ],
  new Set(['chatgpt', 'claude', 'grok']),
  fallback,
)

// Scenario: one family truly never completed by hard-close — it must still appear
// exactly once, honestly marked via the fallback line, never with fabricated content.
const oneTrulyLateAfterHardClose = buildAttendanceLateLines(
  [
    cell({ family: 'chatgpt', textOut: 'chatgpt reply', runtime: 'RESPONDED' }),
    cell({ family: 'claude', textOut: 'claude reply', runtime: 'RESPONDED' }),
    cell({ family: 'grok', textOut: 'grok reply', runtime: 'RESPONDED' }),
    cell({ family: 'gemini', textOut: 'gemini reply', runtime: 'RESPONDED' }),
    cell({ family: 'red_team', textOut: null, runtime: 'TIMED_OUT', runtimeDetail: 'attendance_hard_close' }),
  ],
  new Set(['chatgpt', 'claude', 'grok', 'gemini']),
  fallback,
)

// Scenario: a family already revealed in the soft-cap batch must never be duplicated
// into the late batch even though its cell still carries real content.
const noDoubleRelease = buildAttendanceLateLines(
  [cell({ family: 'chatgpt', textOut: 'chatgpt reply', runtime: 'RESPONDED' })],
  new Set(['chatgpt']),
  fallback,
)

// Scenario: order must follow the input cell order (the packet's directed family order),
// not alphabetical or insertion-into-map order.
const orderPreserved = buildAttendanceLateLines(
  [
    cell({ family: 'red_team', textOut: 'red team reply', runtime: 'RESPONDED' }),
    cell({ family: 'grok', textOut: 'grok reply', runtime: 'RESPONDED' }),
    cell({ family: 'chatgpt', textOut: 'chatgpt reply', runtime: 'RESPONDED' }),
  ],
  new Set(),
  fallback,
)

// Scenario: a failed/empty provider must get an honest fallback line, never a fabricated
// response body.
const failedProviderHonestFallback = buildAttendanceLateLines(
  [cell({ family: 'gemini', textOut: '', runtime: 'FAILED' })],
  new Set(),
  fallback,
)

export function runAttendanceReleaseValidation(): CaseResult[] {
  return [
    check(
      'attendance_release_01_all_five_in_soft_cap_yields_empty_late_batch',
      allFiveInSoftCap.length === 0,
      JSON.stringify(allFiveInSoftCap),
    ),
    check(
      'attendance_release_02_three_soft_cap_two_late_both_released_once',
      threeSoftCapTwoLate.length === 2
        && threeSoftCapTwoLate.some(l => l.family === 'gemini' && l.textOut === 'gemini late reply')
        && threeSoftCapTwoLate.some(l => l.family === 'red_team' && l.textOut === 'red team late reply'),
      JSON.stringify(threeSoftCapTwoLate),
    ),
    check(
      'attendance_release_03_late_grok_and_red_team_released',
      threeSoftCapTwoLate.find(l => l.family === 'grok') === undefined
        && threeSoftCapTwoLate.find(l => l.family === 'red_team')?.textOut === 'red team late reply',
      JSON.stringify(threeSoftCapTwoLate),
    ),
    check(
      'attendance_release_04_truly_late_family_honestly_marked_not_fabricated',
      oneTrulyLateAfterHardClose.length === 1
        && oneTrulyLateAfterHardClose[0]?.family === 'red_team'
        && oneTrulyLateAfterHardClose[0]?.textOut === 'red_team unavailable.',
      JSON.stringify(oneTrulyLateAfterHardClose),
    ),
    check(
      'attendance_release_05_no_double_release_for_already_revealed_family',
      noDoubleRelease.length === 0,
      JSON.stringify(noDoubleRelease),
    ),
    check(
      'attendance_release_06_order_follows_input_cell_order',
      orderPreserved.map(l => l.family).join(',') === 'red_team,grok,chatgpt',
      JSON.stringify(orderPreserved),
    ),
    check(
      'attendance_release_07_failed_empty_provider_gets_honest_fallback_not_fake_message',
      failedProviderHonestFallback.length === 1
        && failedProviderHonestFallback[0]?.textOut === 'gemini failed.',
      JSON.stringify(failedProviderHonestFallback),
    ),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runAttendanceReleaseValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Attendance late-release validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
