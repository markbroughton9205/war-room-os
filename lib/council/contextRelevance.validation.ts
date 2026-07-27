import {
  filterDecreeRelevantPriorReplies,
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

// 4. Short/low-information decrees ("Hi council.", greetings) never filter anything — nothing to
// compare against, so we stay permissive rather than fabricate a mismatch.
const shortDecreeKept = isPriorContextDecreeRelevant('Hi council.', 'The archive route migration is still pending review.')

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

export function runContextRelevanceValidation(): CaseResult[] {
  return [
    check('context_relevance_01_stale_unrelated_thread_dropped', staleArchiveRouteDropped, String(staleArchiveRouteDropped)),
    check('context_relevance_02_overlapping_context_kept', overlappingContextKept, String(overlappingContextKept)),
    check('context_relevance_03_explicit_continuation_always_kept', continuationSignalKept, String(continuationSignalKept)),
    check('context_relevance_04_short_decree_stays_permissive', shortDecreeKept, String(shortDecreeKept)),
    check('context_relevance_05_empty_candidate_stays_permissive', emptyCandidateKept, String(emptyCandidateKept)),
    check('context_relevance_06_empty_decree_stays_permissive', emptyDecreeKept, String(emptyDecreeKept)),
    check(
      'context_relevance_07_list_filter_keeps_relevant_drops_stale_preserves_order',
      filtered.length === 2 && filtered[0]?.family === 'chatgpt' && filtered[1]?.family === 'claude',
      JSON.stringify(filtered.map(f => f.family)),
    ),
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
