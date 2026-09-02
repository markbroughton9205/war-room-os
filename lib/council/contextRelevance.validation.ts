import {
  filterDecreeRelevantPriorReplies,
  isLightweightPingDecree,
  isPriorContextDecreeRelevant,
} from './contextRelevance'
import { pathToFileURL } from 'node:url'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

// 1. Clear topic mismatch on a substantive decree — the exact shape of the reported bug: an old
// dev/platform thread ("archive route") leaking into a fresh, unrelated Commander decree.
const staleArchiveRouteDropped = !isPriorContextDecreeRelevant(
  'What should our pricing strategy be for the Panama freight contracts this quarter?',
  'Following up on the archive route discussion — the legacy endpoint migration handles pagination differently than the new one.',
)

// 2. Genuine keyword-overlap continuation is kept.
const overlappingContextKept = isPriorContextDecreeRelevant(
  'Let\'s go deeper on the Panama freight contract pricing model.',
  'The Panama freight contract pricing model we discussed depends on fuel surcharges.',
)

// 3. Explicit continuation language always keeps prior context, even with zero keyword overlap.
const continuationSignalKept = isPriorContextDecreeRelevant(
  'Continue from where we left off.',
  'The legacy archive route migration handles pagination differently.',
)

// 4. Genuine short follow-ups (not a bare greeting/ping) stay permissive — nothing concrete to
// compare against, so we do not fabricate a mismatch. (This case previously used "Hi council."
// as its example, which is a bare greeting, not a genuine short follow-up — see cases 08-13
// below: Phase 49-A-1 corrected that exact bug, where a greeting incorrectly inherited unrelated
// prior context just because it was short.)
const shortFollowUpKept = isPriorContextDecreeRelevant('What about the timeline?', 'The archive route migration is still pending review.')

// 5. Empty inputs never filter.
const emptyCandidateKept = isPriorContextDecreeRelevant('What is our current revenue position?', '')
const emptyDecreeKept = isPriorContextDecreeRelevant('', 'Some unrelated prior content here.')

// 6. List-filter helper preserves order and only removes the irrelevant entry.
const filtered = filterDecreeRelevantPriorReplies(
  'What should our pricing strategy be for the Panama freight contracts this quarter?',
  [
    { family: 'chatgpt', content: 'Panama freight contract pricing should factor in fuel surcharges.' },
    { family: 'grok', content: 'Following up on the archive route discussion from the legacy endpoint migration.' },
    { family: 'claude', content: 'Freight contract terms in Panama also depend on customs timing.' },
  ],
)

// 8. Phase 49-A-1: a bare greeting ("Hi council.") must NOT inherit unrelated prior context —
// this is the exact case case_04 previously encoded as "correct" using this same input.
const greetingDropsUnrelatedContext = !isPriorContextDecreeRelevant(
  'Hi council.',
  'The archive route migration is still pending review.',
)

// 9. The Commander's named test-ping phrasings must not inherit unrelated (e.g. Panama/
// relocation) prior context.
const bareHelloDropsUnrelatedContext = !isPriorContextDecreeRelevant(
  'hello',
  'Panama relocation logistics depend on the visa timeline.',
)
const hiCouncilDropsUnrelatedContext = !isPriorContextDecreeRelevant(
  'hi council',
  'Panama relocation logistics depend on the visa timeline.',
)
const quickCheckInDropsUnrelatedContext = !isPriorContextDecreeRelevant(
  'quick check in',
  'Panama relocation logistics depend on the visa timeline.',
)
const statusCheckDropsUnrelatedContext = !isPriorContextDecreeRelevant(
  'status check',
  'Panama relocation logistics depend on the visa timeline.',
)

// 10. Explicit continuation language overrides the greeting/ping shape — "hi, continuing from
// before" must still keep context.
const greetingWithContinuationKept = isPriorContextDecreeRelevant(
  'hi, continuing from before',
  'Panama relocation logistics depend on the visa timeline.',
)

// 11. A genuine short follow-up after a relocation discussion still keeps relevant context —
// the greeting/ping fix must not destroy normal continuity for real questions.
const genuineFollowUpAfterRelocationKept = isPriorContextDecreeRelevant(
  'What about school requirements?',
  'Compare Panama and Costa Rica for relocation.',
)

// 12. A longer message that merely contains "status check" mid-sentence is not a bare ping and
// falls through to ordinary keyword-overlap analysis, not the blanket ping-drop rule.
const elaboratedStatusCheckNotTreatedAsBarePing = isPriorContextDecreeRelevant(
  'status check on the archive route migration',
  'The archive route migration is still pending review.',
)

// 13. Required greeting-classification matrix (Commander correction — Requirement A). The
// optional greeting addressee is restricted to an explicit small word list (council/team/
// family/everyone/everybody/all); an unrestricted trailing token previously misclassified
// substantive short decrees like "hello Panama" as bare pings.
const greetingMatrix: { input: string; expectedPing: boolean }[] = [
  { input: 'hello', expectedPing: true },
  { input: 'hello council', expectedPing: true },
  { input: 'hello team', expectedPing: true },
  { input: 'good morning everyone', expectedPing: true },
  { input: 'hello Panama', expectedPing: false },
  { input: 'hey relocation', expectedPing: false },
  { input: 'good morning schools', expectedPing: false },
  { input: 'quick status ping', expectedPing: true },
  { input: 'Hey council whats going on', expectedPing: true },
  { input: 'Council check in', expectedPing: true },
  { input: 'Hi council', expectedPing: true },
]
const greetingMatrixResults = greetingMatrix.map(c => ({
  ...c,
  actual: isLightweightPingDecree(c.input),
}))

export function runContextRelevanceValidation(): CaseResult[] {
  const matrixChecks = greetingMatrixResults.map(r =>
    check(
      `context_relevance_13_greeting_matrix_${r.input.replace(/\s+/g, '_').toLowerCase()}`,
      r.actual === r.expectedPing,
      `input=${JSON.stringify(r.input)} expected=${r.expectedPing} actual=${r.actual}`,
    ),
  )
  return [
    check('context_relevance_01_stale_unrelated_thread_dropped', staleArchiveRouteDropped, String(staleArchiveRouteDropped)),
    check('context_relevance_02_overlapping_context_kept', overlappingContextKept, String(overlappingContextKept)),
    check('context_relevance_03_explicit_continuation_always_kept', continuationSignalKept, String(continuationSignalKept)),
    check('context_relevance_04_short_followup_stays_permissive', shortFollowUpKept, String(shortFollowUpKept)),
    check('context_relevance_05_empty_candidate_stays_permissive', emptyCandidateKept, String(emptyCandidateKept)),
    check('context_relevance_06_empty_decree_stays_permissive', emptyDecreeKept, String(emptyDecreeKept)),
    check(
      'context_relevance_07_list_filter_keeps_relevant_drops_stale_preserves_order',
      filtered.length === 2 && filtered[0]?.family === 'chatgpt' && filtered[1]?.family === 'claude',
      JSON.stringify(filtered.map(f => f.family)),
    ),
    check('context_relevance_08_bare_greeting_drops_unrelated_context', greetingDropsUnrelatedContext, String(greetingDropsUnrelatedContext)),
    check('context_relevance_09a_hello_drops_unrelated_context', bareHelloDropsUnrelatedContext, String(bareHelloDropsUnrelatedContext)),
    check('context_relevance_09b_hi_council_drops_unrelated_context', hiCouncilDropsUnrelatedContext, String(hiCouncilDropsUnrelatedContext)),
    check('context_relevance_09c_quick_check_in_drops_unrelated_context', quickCheckInDropsUnrelatedContext, String(quickCheckInDropsUnrelatedContext)),
    check('context_relevance_09d_status_check_drops_unrelated_context', statusCheckDropsUnrelatedContext, String(statusCheckDropsUnrelatedContext)),
    check('context_relevance_10_greeting_with_continuation_signal_kept', greetingWithContinuationKept, String(greetingWithContinuationKept)),
    check('context_relevance_11_genuine_followup_after_relocation_kept', genuineFollowUpAfterRelocationKept, String(genuineFollowUpAfterRelocationKept)),
    check(
      'context_relevance_12_elaborated_status_check_not_bare_ping',
      elaboratedStatusCheckNotTreatedAsBarePing,
      String(elaboratedStatusCheckNotTreatedAsBarePing),
    ),
    ...matrixChecks,
    check('context_relevance_14_quick_status_ping_drops_panama', !isPriorContextDecreeRelevant('quick status ping', 'Panama visas and property law'), 'ping panama'),
    check('context_relevance_15_hey_going_on_drops_panama', !isPriorContextDecreeRelevant("Hey council whats going on", 'Panama relocation logistics'), 'going on panama'),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runContextRelevanceValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Context relevance validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
