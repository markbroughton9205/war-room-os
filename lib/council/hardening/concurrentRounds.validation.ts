import { pathToFileURL } from 'node:url'
import { councilSessionReducer, createInitialCouncilPersisted } from '@/components/council/councilSessionReducer'
import { reduceCouncilProgressEvent } from '@/lib/council/progress-events/reducer'
import { makeRequest, terminalExecution } from '@/lib/council/request-state/fixtures'
import { councilRequestId } from '@/lib/council/request-state/types'
import { createCouncilProgressEvent } from '@/lib/council/progress-events/event-factory'
import { countOperationFamilyContributions } from '../unified-experience/operationSummary'
import { simulateRound } from './roundSimulator'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

export function runConcurrentRoundsValidation(): CaseResult[] {
  const results: CaseResult[] = []

  // 1. A late progress event from an OLDER, already-superseded request must be rejected outright
  //    by the request-state reducer when applied against a NEWER request's state — this is the
  //    core "late events cannot overwrite newer state" guarantee, proven across two real requestIds.
  const requestA = councilRequestId('round-a-request')
  const requestB = councilRequestId('round-b-request')
  const stateB = makeRequest({
    requestId: requestB,
    familyExecutions: [terminalExecution('claude', 'complete')],
  })
  const lateEventFromA = createCouncilProgressEvent({
    eventId: 'late-from-a-1',
    requestId: requestA,
    sequence: 1,
    eventType: 'family_response_completed',
    occurredAt: '2026-07-18T00:05:00.000Z',
    source: 'provider_adapter',
    family: 'grok',
  })
  const rejectedResult = reduceCouncilProgressEvent(stateB, lateEventFromA)
  results.push(check(
    'concurrent_01_late_event_from_older_request_rejected_by_newer_state',
    rejectedResult.ok === false && rejectedResult.state === stateB,
    `ok=${rejectedResult.ok} stateUnchanged=${rejectedResult.state === stateB} issues=${rejectedResult.issues.map(i => i.code).join(',')}`,
  ))

  // 2. Two overlapping rounds' canonical counts never leak into each other — round A's retries and
  //    failures must not influence round B's respondedCount/failedCount, and vice versa, even when
  //    both rounds' raw event streams exist in memory simultaneously (the realistic "second decree
  //    submitted immediately after the first completes, or while it's still finishing" scenario).
  const roundA = simulateRound(1, 4242)
  const roundB = simulateRound(2, 9191)
  const countsA = countOperationFamilyContributions(roundA.events)
  const countsB = countOperationFamilyContributions(roundB.events)
  results.push(check(
    'concurrent_02_round_counts_independent_when_correctly_scoped',
    countsA.respondedCount === roundA.expectedResponded.length
    && countsB.respondedCount === roundB.expectedResponded.length,
    `countsA.responded=${countsA.respondedCount} expectedA=${roundA.expectedResponded.length} countsB.responded=${countsB.respondedCount} expectedB=${roundB.expectedResponded.length}`,
  ))
  // Documents the caller contract: countOperationFamilyContributions has no requestId awareness of
  // its own (by design — see operationSummary.ts) — mixing two rounds' events WOULD corrupt counts,
  // which is exactly why every production caller (adapter.ts/live-controller.ts summaryFor) must
  // only ever pass one operation's own `events` array, never a merged/unscoped stream. Uses a
  // minimal hand-built pair of events (not the full-coverage round simulator, which always touches
  // every family every round and so can't produce a family "round A never mentions at all") so the
  // inflation is unambiguous.
  const isolatedRoundAEvents = countOperationFamilyContributions([
    { id: 'iso-a-1', sequence: 1, timestamp: null, type: 'family_responded', familyId: 'claude', familyLabel: null, roleLabel: null, statusLabel: 'Status', messageId: null, outputText: null, replyToEventId: null, replyToFamilyId: null, replyToLabel: null, provenance: 'provider_response', isActualProviderOutput: true, isFinal: true },
  ])
  const misscopedCombined = countOperationFamilyContributions([
    { id: 'iso-a-1', sequence: 1, timestamp: null, type: 'family_responded', familyId: 'claude', familyLabel: null, roleLabel: null, statusLabel: 'Status', messageId: null, outputText: null, replyToEventId: null, replyToFamilyId: null, replyToLabel: null, provenance: 'provider_response', isActualProviderOutput: true, isFinal: true },
    { id: 'iso-b-1', sequence: 1, timestamp: null, type: 'family_responded', familyId: 'chatgpt', familyLabel: null, roleLabel: null, statusLabel: 'Status', messageId: null, outputText: null, replyToEventId: null, replyToFamilyId: null, replyToLabel: null, provenance: 'provider_response', isActualProviderOutput: true, isFinal: true },
  ])
  results.push(check(
    'concurrent_03_mixed_event_streams_would_corrupt_counts_documenting_caller_contract',
    misscopedCombined.respondedCount === isolatedRoundAEvents.respondedCount + 1,
    `roundAAlone=${isolatedRoundAEvents.respondedCount} misscopedCombined=${misscopedCombined.respondedCount}`,
  ))

  // 3. Persisted messages from two rounds retain distinct, non-colliding IDs and content — proving
  //    "provider responses never cross into another round" at the actual persisted-transcript layer.
  let store = createInitialCouncilPersisted('concurrent-session')
  store = councilSessionReducer(store, { type: 'ADD_MESSAGES', payload: [roundA.decree, ...roundA.responses] })
  store = councilSessionReducer(store, { type: 'ADD_MESSAGES', payload: [roundB.decree, ...roundB.responses] })
  const roundAContentInStore = roundA.responses.every(r => store.messages.some(m => m.id === r.id && m.content === r.content))
  const roundBContentInStore = roundB.responses.every(r => store.messages.some(m => m.id === r.id && m.content === r.content))
  const noCrossContamination = roundA.responses.every(r => !roundB.responses.some(rb => rb.content === r.content))
  results.push(check(
    'concurrent_04_both_rounds_persist_distinctly_without_cross_contamination',
    roundAContentInStore && roundBContentInStore && noCrossContamination,
    `roundAIntact=${roundAContentInStore} roundBIntact=${roundBContentInStore} noCrossContamination=${noCrossContamination}`,
  ))

  // 4. Rapid resubmission — a second decree dispatched immediately after the first via ADD_MESSAGES
  //    (simulating "attempt a second submission the instant the first completes") never overwrites
  //    or reorders the first round's already-persisted messages; both remain present in submission
  //    order (append-only reducer semantics, not a request-replaces-request model).
  const firstRoundIds = new Set([roundA.decree.id, ...roundA.responses.map(r => r.id)])
  const survivingAfterB = [...firstRoundIds].every(id => store.messages.some(m => m.id === id))
  const roundAIndex = store.messages.findIndex(m => m.id === roundA.decree.id)
  const roundBIndex = store.messages.findIndex(m => m.id === roundB.decree.id)
  results.push(check(
    'concurrent_05_rapid_resubmission_does_not_overwrite_prior_round',
    survivingAfterB && roundAIndex >= 0 && roundBIndex > roundAIndex,
    `survivingAfterB=${survivingAfterB} roundAIndex=${roundAIndex} roundBIndex=${roundBIndex}`,
  ))

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runConcurrentRoundsValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`\nConcurrent rounds validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
