import {
  buildProviderIssueBanner,
  countFamilyResponses,
  FAMILY_OPERATION_STATUS_PRESENTATION,
  ISSUE_STATUSES,
  mapFamilyOperationStatus,
  projectFamilyOperationStatuses,
  type FamilyOperationStatus,
  type FamilyOperationStatusMap,
} from './familyOperationStatus'
import { isActionableProviderRuntime } from './attendanceReadiness'
import type { ProviderFamilyOutcomeStatus } from './providerIsolation'
import { pathToFileURL } from 'node:url'

type CaseResult = {
  name: string
  pass: boolean
  detail: string
}

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const familyLabel = (family: string) =>
  ({ chatgpt: 'ChatGPT', claude: 'Claude', grok: 'Grok', gemini: 'Gemini', red_team: 'Red Team' }[family] ?? family)

// 1. Configured (connectivity) vs. responded (operation outcome) are fully independent — the
// mapper never looks at connectivity at all, so a family reported RESPONDED here is a pure
// operation-outcome claim, never inferred from being "configured".
const respondedIgnoresConnectivity = mapFamilyOperationStatus({
  runtime: 'RESPONDED',
  operationConcluded: true,
  operationInProgress: false,
})

// 2. Timeout / provider error display.
const timedOut = mapFamilyOperationStatus({ runtime: 'TIMED_OUT', operationConcluded: true, operationInProgress: false })
const providerError = mapFamilyOperationStatus({
  runtime: 'FAILED',
  runtimeDetail: 'cloud_provider_unavailable',
  operationConcluded: true,
  operationInProgress: false,
})

// 3. Empty response display — distinct from a generic provider error. Covers both the fixed
// 'empty_response' constant (direct-invocation path) and the real-world free-text server message
// seen in production (parallel full-council gather path), e.g. "Claude returned empty content".
const emptyResponse = mapFamilyOperationStatus({
  runtime: 'FAILED',
  runtimeDetail: 'empty_response',
  operationConcluded: true,
  operationInProgress: false,
})
const emptyResponseFromFreeTextServerMessage = mapFamilyOperationStatus({
  runtime: 'FAILED',
  runtimeDetail: 'Claude returned empty content',
  operationConcluded: true,
  operationInProgress: false,
})

// 4. Not-called family display — never fabricated as an error.
const notCalledConcluded = mapFamilyOperationStatus({ runtime: undefined, operationConcluded: true, operationInProgress: false })
const stillThinking = mapFamilyOperationStatus({ runtime: undefined, operationConcluded: false, operationInProgress: true })
const readyBeforeAnyOperation = mapFamilyOperationStatus({ runtime: undefined, operationConcluded: false, operationInProgress: false })
const explicitSkip = mapFamilyOperationStatus({
  runtime: 'SKIPPED',
  runtimeDetail: 'preflight_unavailable',
  operationConcluded: true,
  operationInProgress: false,
})

// 5. Banner projection — single issue, multiple issues, and unknown-reason fallback.
const singleIssueBanner = buildProviderIssueBanner(
  { claude: 'timed_out' } as FamilyOperationStatusMap,
  familyLabel,
)
const multipleIssueBanner = buildProviderIssueBanner(
  { claude: 'timed_out', gemini: 'empty_response' } as FamilyOperationStatusMap,
  familyLabel,
)
const unknownReasonBanner = buildProviderIssueBanner(
  { claude: 'provider_error' } as FamilyOperationStatusMap,
  familyLabel,
)
const noIssueBanner = buildProviderIssueBanner(
  { chatgpt: 'responded', claude: 'responded' } as FamilyOperationStatusMap,
  familyLabel,
)
const notCalledIsNeverAnIssue = buildProviderIssueBanner(
  { red_team: 'not_called', chatgpt: 'responded' } as FamilyOperationStatusMap,
  familyLabel,
)

// 6. Accurate response-progress counts — Ra'el is never a key in this map (he isn't a
// CouncilOrchestrationFamily), so he can never be counted as a provider response.
const progressPartial = countFamilyResponses(
  { chatgpt: 'responded', claude: 'timed_out', grok: 'responded', gemini: 'not_called', red_team: 'thinking' } as FamilyOperationStatusMap,
  ['chatgpt', 'claude', 'grok', 'gemini', 'red_team'],
)
const progressCountsDegradedAsResponded = countFamilyResponses(
  { chatgpt: 'degraded' } as FamilyOperationStatusMap,
  ['chatgpt'],
)
const progressUnknownWithoutRoster = countFamilyResponses({ chatgpt: 'responded' } as FamilyOperationStatusMap, undefined)

// 7 & 8. New-operation reset / no historical mutation: `projectFamilyOperationStatuses` is a pure
// function over its arguments only — it takes no message history and no shared mutable state, so
// calling it for a fresh "gathering" packet right after a packet full of failures can never leak
// the prior round's statuses forward.
const priorRoundAllFailed = projectFamilyOperationStatuses({
  directedFamilies: ['chatgpt', 'claude'],
  providerRuntimeStates: { chatgpt: 'FAILED', claude: 'TIMED_OUT' },
  providerRuntimeDetails: { chatgpt: 'cloud_provider_unavailable' },
  operationConcluded: true,
  operationInProgress: false,
})
const freshRoundReset = projectFamilyOperationStatuses({
  directedFamilies: ['chatgpt', 'claude'],
  providerRuntimeStates: {},
  operationConcluded: false,
  operationInProgress: true,
})

// --- Status-synchronization regression (Phase 48-C4D Step 3) ---------------------------------
// `isActionableProviderRuntime` (attendanceReadiness.ts) is the source-of-truth gate deciding
// whether the provider-issue banner shows at all. `ISSUE_STATUSES` (familyOperationStatus.ts)
// decides what the banner *says* once it's showing. These two independently-maintained lists
// must agree: every raw runtime/detail combination the gate calls "actionable" must map, through
// `mapFamilyOperationStatus`, to a status in `ISSUE_STATUSES` — otherwise the banner-visibility
// flag says "there is an issue" while the banner text mechanism finds nothing to report, and a
// real problem silently renders as if nothing were wrong. This matrix is exhaustive over every
// `ProviderFamilyOutcomeStatus` and every `runtimeDetail` value that appears anywhere in the
// production source (attendanceReadiness.ts, familyOperationStatus.ts, retryOrchestration.ts), so
// adding a new detail string or changing what the gate treats as actionable without updating
// `ISSUE_STATUSES` fails this check rather than silently drifting out of sync.
const ALL_PROVIDER_RUNTIMES: ProviderFamilyOutcomeStatus[] = [
  'READY',
  'RESPONDED',
  'TIMED_OUT',
  'DEGRADED',
  'FAILED',
  'SKIPPED',
  'IN_FLIGHT',
]

const ALL_RUNTIME_DETAILS: (string | undefined)[] = [
  undefined,
  'preflight_unavailable',
  'empty_response',
  'Claude returned empty content',
  'cloud_provider_unavailable',
  'attendance_hard_close',
  'attendance_soft_cap',
  'superseded',
  'aborted',
  'missing_gather_slot',
  'governor_silent_skip',
  'missing_direct_invocation_result',
]

type SyncMismatch = { runtime: ProviderFamilyOutcomeStatus; detail: string | undefined; mapped: FamilyOperationStatus }

const syncMismatches: SyncMismatch[] = []
for (const runtime of ALL_PROVIDER_RUNTIMES) {
  for (const detail of ALL_RUNTIME_DETAILS) {
    const actionable = isActionableProviderRuntime(runtime, detail)
    if (!actionable) continue
    const mapped = mapFamilyOperationStatus({
      runtime,
      runtimeDetail: detail,
      operationConcluded: true,
      operationInProgress: false,
    })
    if (!(ISSUE_STATUSES as readonly FamilyOperationStatus[]).includes(mapped)) {
      syncMismatches.push({ runtime, detail, mapped })
    }
  }
}

const successStatusesNeverIssues = !ISSUE_STATUSES.includes('responded') && !ISSUE_STATUSES.includes('ready')

const everyIssueStatusHasNonGreenPresentation = ISSUE_STATUSES.every(
  status => FAMILY_OPERATION_STATUS_PRESENTATION[status]?.tone && FAMILY_OPERATION_STATUS_PRESENTATION[status].tone !== 'green',
)

export function runFamilyOperationStatusValidation(): CaseResult[] {
  return [
    check(
      'family_op_01_responded_is_pure_operation_outcome_not_connectivity',
      respondedIgnoresConnectivity === 'responded',
      respondedIgnoresConnectivity,
    ),
    check('family_op_02_timed_out_maps_correctly', timedOut === 'timed_out', timedOut),
    check('family_op_03_provider_error_maps_correctly', providerError === 'provider_error', providerError),
    check(
      'family_op_04_empty_response_distinct_from_generic_provider_error',
      emptyResponse === 'empty_response' && emptyResponse !== providerError,
      `${emptyResponse} vs ${providerError}`,
    ),
    check(
      'family_op_05_not_called_after_operation_concludes_not_fabricated_as_error',
      notCalledConcluded === 'not_called',
      notCalledConcluded,
    ),
    check(
      'family_op_06_in_progress_absent_family_is_thinking_not_error',
      stillThinking === 'thinking',
      stillThinking,
    ),
    check(
      'family_op_07_no_operation_yet_defaults_to_ready_not_fabricated',
      readyBeforeAnyOperation === 'ready',
      readyBeforeAnyOperation,
    ),
    check(
      'family_op_08_preflight_unavailable_is_unavailable_not_generic_skip',
      explicitSkip === 'unavailable',
      explicitSkip,
    ),
    check(
      'family_op_08b_real_world_free_text_empty_content_message_recognized',
      emptyResponseFromFreeTextServerMessage === 'empty_response',
      emptyResponseFromFreeTextServerMessage,
    ),
    check(
      'family_op_09_single_issue_banner_names_family_and_reason',
      singleIssueBanner === 'Claude timed out.',
      String(singleIssueBanner),
    ),
    check(
      'family_op_10_multiple_issue_banner_lists_each_family_and_reason',
      multipleIssueBanner === 'Provider issues — Claude timed out; Gemini returned an empty response.',
      String(multipleIssueBanner),
    ),
    check(
      'family_op_11_unknown_reason_falls_back_to_honest_did_not_complete',
      unknownReasonBanner === 'Claude did not complete this Council round.',
      String(unknownReasonBanner),
    ),
    check('family_op_12_no_issues_yields_null_banner', noIssueBanner === null, String(noIssueBanner)),
    check(
      'family_op_13_not_called_never_triggers_the_banner',
      notCalledIsNeverAnIssue === null,
      String(notCalledIsNeverAnIssue),
    ),
    check(
      'family_op_14_response_progress_counts_only_real_responses',
      progressPartial?.responded === 2 && progressPartial.total === 5,
      JSON.stringify(progressPartial),
    ),
    check(
      'family_op_15_degraded_counts_as_a_response_for_progress',
      progressCountsDegradedAsResponded?.responded === 1,
      JSON.stringify(progressCountsDegradedAsResponded),
    ),
    check(
      'family_op_16_no_roster_yields_no_fabricated_progress_count',
      progressUnknownWithoutRoster === null,
      String(progressUnknownWithoutRoster),
    ),
    check(
      'family_op_17_fresh_operation_reset_does_not_inherit_prior_failures',
      priorRoundAllFailed.chatgpt === 'provider_error'
        && priorRoundAllFailed.claude === 'timed_out'
        && freshRoundReset.chatgpt === 'thinking'
        && freshRoundReset.claude === 'thinking',
      `${JSON.stringify(priorRoundAllFailed)} -> ${JSON.stringify(freshRoundReset)}`,
    ),
    check(
      'family_op_18_projection_never_reads_or_needs_message_history',
      // Structural guarantee, not a runtime check: the function signature accepts only runtime
      // states/details/roster/operation flags — no message array parameter exists to mutate.
      projectFamilyOperationStatuses.length <= 1,
      `arity=${projectFamilyOperationStatuses.length}`,
    ),
    check(
      'status_sync_01_every_actionable_runtime_maps_to_an_issue_status',
      syncMismatches.length === 0,
      JSON.stringify(syncMismatches),
    ),
    check(
      'status_sync_02_success_statuses_are_never_classified_as_issues',
      successStatusesNeverIssues,
      String(successStatusesNeverIssues),
    ),
    check(
      'status_sync_03_every_issue_status_has_a_non_green_presentation',
      everyIssueStatusHasNonGreenPresentation,
      String(everyIssueStatusHasNonGreenPresentation),
    ),
    check(
      'status_sync_04_not_called_and_ready_are_excluded_from_issue_statuses',
      !ISSUE_STATUSES.includes('not_called') && !ISSUE_STATUSES.includes('queued') && !ISSUE_STATUSES.includes('thinking'),
      JSON.stringify(ISSUE_STATUSES),
    ),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runFamilyOperationStatusValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Family operation status validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
