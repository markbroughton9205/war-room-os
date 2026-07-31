import { countOperationFamilyContributions } from './operationSummary'
import type { CommanderOperationEvent, CommanderOperationEventType } from './types'
import { pathToFileURL } from 'node:url'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function ev(overrides: Partial<CommanderOperationEvent> & { sequence: number; type: CommanderOperationEventType }): CommanderOperationEvent {
  return {
    id: `event-${overrides.sequence}`,
    timestamp: null,
    familyId: null,
    familyLabel: null,
    roleLabel: null,
    statusLabel: 'Status',
    messageId: null,
    outputText: null,
    replyToEventId: null,
    replyToFamilyId: null,
    replyToLabel: null,
    provenance: 'provider_response',
    isActualProviderOutput: false,
    isFinal: false,
    ...overrides,
  }
}

export function runOperationSummaryValidation(): CaseResult[] {
  // 1. Two response events for one family count as one.
  const duplicateResponded = countOperationFamilyContributions([
    ev({ sequence: 1, type: 'family_responded', familyId: 'claude' }),
    ev({ sequence: 2, type: 'family_responded', familyId: 'claude' }),
  ])

  // 2. Three distinct successful families count as three.
  const threeDistinct = countOperationFamilyContributions([
    ev({ sequence: 1, type: 'family_responded', familyId: 'chatgpt' }),
    ev({ sequence: 2, type: 'family_responded', familyId: 'claude' }),
    ev({ sequence: 3, type: 'family_responded', familyId: 'gemini' }),
  ])

  // 3. synthesis_completed does not increase the provider count.
  const withSynthesis = countOperationFamilyContributions([
    ev({ sequence: 1, type: 'family_responded', familyId: 'chatgpt' }),
    ev({ sequence: 2, type: 'synthesis_completed', familyId: 'chatgpt' }),
  ])

  // 4. A failed or incomplete family is not reported as successfully responded.
  const failedFamily = countOperationFamilyContributions([
    ev({ sequence: 1, type: 'family_failed', familyId: 'grok' }),
  ])

  // 5. A retry that eventually succeeds counts once (premature "responded" event superseded by a
  // later, higher-sequence "responded" event for the same family — still exactly one contribution).
  const retrySucceeds = countOperationFamilyContributions([
    ev({ sequence: 1, type: 'family_responded', familyId: 'gemini' }),
    ev({ sequence: 2, type: 'family_responded', familyId: 'gemini' }),
  ])

  // 6. A retry that remains incomplete is represented as degraded/failed, not successful — a
  // premature "responded" event later corrected by a "failed" event must resolve to failed.
  const retryStillIncomplete = countOperationFamilyContributions([
    ev({ sequence: 1, type: 'family_responded', familyId: 'gemini' }),
    ev({ sequence: 2, type: 'family_failed', familyId: 'gemini' }),
  ])

  // Extra: unknown/null/system family identities never count as a successful contribution.
  const unresolvedIdentities = countOperationFamilyContributions([
    ev({ sequence: 1, type: 'family_responded', familyId: 'unknown' }),
    ev({ sequence: 2, type: 'family_responded', familyId: 'system' }),
    ev({ sequence: 3, type: 'family_responded', familyId: null }),
  ])

  // Extra: timed-out family counts as failed, not responded, and not silently dropped.
  const timedOut = countOperationFamilyContributions([
    ev({ sequence: 1, type: 'family_timed_out', familyId: 'grok' }),
  ])

  return [
    check(
      'summary_01_two_events_one_family_counts_once',
      duplicateResponded.respondedCount === 1,
      JSON.stringify(duplicateResponded),
    ),
    check(
      'summary_02_three_distinct_families_count_three',
      threeDistinct.respondedCount === 3,
      JSON.stringify(threeDistinct),
    ),
    check(
      'summary_03_synthesis_completed_does_not_add_to_responded_count',
      withSynthesis.respondedCount === 1,
      JSON.stringify(withSynthesis),
    ),
    check(
      'summary_04_failed_family_not_counted_as_responded',
      failedFamily.respondedCount === 0 && failedFamily.failedCount === 1,
      JSON.stringify(failedFamily),
    ),
    check(
      'summary_05_retry_that_succeeds_counts_once',
      retrySucceeds.respondedCount === 1,
      JSON.stringify(retrySucceeds),
    ),
    check(
      'summary_06_retry_still_incomplete_counts_as_failed_not_responded',
      retryStillIncomplete.respondedCount === 0 && retryStillIncomplete.failedCount === 1,
      JSON.stringify(retryStillIncomplete),
    ),
    check(
      'summary_07_unresolved_family_identities_never_count_as_responded',
      unresolvedIdentities.respondedCount === 0,
      JSON.stringify(unresolvedIdentities),
    ),
    check(
      'summary_08_timed_out_family_counts_as_failed',
      timedOut.failedCount === 1 && timedOut.respondedCount === 0,
      JSON.stringify(timedOut),
    ),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runOperationSummaryValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Operation summary validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
