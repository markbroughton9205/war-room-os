import { pathToFileURL } from 'node:url'
import { councilSessionReducer, createInitialCouncilPersisted } from '@/components/council/councilSessionReducer'
import { clipMessages, MAX_PERSISTED_MESSAGES } from '@/components/council/useCouncilSession'
import { countOperationFamilyContributions } from '../unified-experience/operationSummary'
import { CORE_FAMILIES, simulateRounds, type SimulatedRound } from './roundSimulator'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

type BatchOutcome = {
  size: number
  results: CaseResult[]
  totalMs: number
  avgMsPerRound: number
  finalMessageCount: number
  clippedMessageCount: number
}

function runBatch(size: number): BatchOutcome {
  const results: CaseResult[] = []
  const started = Date.now()
  const rounds: SimulatedRound[] = simulateRounds(size, 1000 + size)

  // Per-round canonical counting invariants, checked against every simulated round in the batch.
  let countingViolations = 0
  let roundsWithInjectedUnknownFamily = 0
  let unknownFamilyInflatedCount = 0
  for (const round of rounds) {
    const counts = countOperationFamilyContributions(round.events)
    if (counts.respondedCount !== round.expectedResponded.length) countingViolations += 1
    if (counts.failedCount !== round.expectedFailed.length) countingViolations += 1
    if (counts.respondedCount + counts.failedCount + counts.unavailableCount + counts.skippedCount > CORE_FAMILIES.length) {
      countingViolations += 1
    }
    const hasUnknownInjection = round.events.some(e => e.familyId === 'unknown' && e.type === 'family_responded')
    if (hasUnknownInjection) {
      roundsWithInjectedUnknownFamily += 1
      if (counts.respondedCount !== round.expectedResponded.length) unknownFamilyInflatedCount += 1
    }
  }
  results.push(check(
    `batch_${size}_01_canonical_counts_correct_every_round`,
    countingViolations === 0,
    `violations=${countingViolations} of ${rounds.length} rounds`,
  ))
  results.push(check(
    `batch_${size}_02_unknown_family_never_contributes`,
    unknownFamilyInflatedCount === 0,
    `roundsWithInjectedUnknownFamily=${roundsWithInjectedUnknownFamily} inflated=${unknownFamilyInflatedCount}`,
  ))

  // Accumulate every round's messages through the REAL reducer, exactly as the live app would.
  let store = createInitialCouncilPersisted(`stress-session-${size}`)
  for (const round of rounds) {
    store = councilSessionReducer(store, { type: 'ADD_MESSAGES', payload: [round.decree, ...round.responses] })
  }
  const totalMs = Date.now() - started

  const allIds = store.messages.map(m => m.id)
  const uniqueIds = new Set(allIds)
  results.push(check(
    `batch_${size}_03_no_duplicate_message_ids`,
    uniqueIds.size === allIds.length,
    `total=${allIds.length} unique=${uniqueIds.size}`,
  ))

  // Message ordering must be deterministic — round index extracted from content must never decrease.
  const roundIndices = store.messages
    .map(m => /^Round (\d+)/.exec(m.content) ?? /Round (\d+) status/.exec(m.content))
    .map(match => (match ? Number(match[1]) : null))
    .filter((n): n is number => n !== null)
  let orderingViolations = 0
  for (let i = 1; i < roundIndices.length; i += 1) {
    if (roundIndices[i]! < roundIndices[i - 1]!) orderingViolations += 1
  }
  results.push(check(
    `batch_${size}_04_message_ordering_deterministic`,
    orderingViolations === 0,
    `violations=${orderingViolations} across ${roundIndices.length} ordered entries`,
  ))

  // Real clipMessages() must retain the newest round even when total history exceeds the cap —
  // this is the exact "no stale round replaces the latest round" invariant, at reducer scale.
  const clipped = clipMessages(store)
  const lastRound = rounds[rounds.length - 1]!
  const clippedContents = new Set(clipped.messages.map(m => m.content))
  const latestDecreeSurvived = clippedContents.has(lastRound.decree.content)
  const latestResponsesSurvivedCount = lastRound.responses.filter(r => clippedContents.has(r.content)).length
  results.push(check(
    `batch_${size}_05_clip_retains_newest_round`,
    clipped.messages.length <= MAX_PERSISTED_MESSAGES
      && latestDecreeSurvived
      && latestResponsesSurvivedCount === lastRound.responses.length,
    `clippedCount=${clipped.messages.length} decreeSurvived=${latestDecreeSurvived} responsesSurvived=${latestResponsesSurvivedCount}/${lastRound.responses.length}`,
  ))

  // Family labels must survive the full accumulate-then-clip pipeline unchanged.
  const knownLabels = new Set(['ChatGPT Family', 'Claude Family', 'Gemini Family', 'Grok Family', 'RED TEAM', "RA'EL"])
  const unlabeledFamilies = clipped.messages.filter(m => !knownLabels.has(m.familyName))
  results.push(check(
    `batch_${size}_06_family_labels_survive`,
    unlabeledFamilies.length === 0,
    `unlabeled=${unlabeledFamilies.length}`,
  ))

  return {
    size,
    results,
    totalMs,
    avgMsPerRound: totalMs / size,
    finalMessageCount: store.messages.length,
    clippedMessageCount: clipped.messages.length,
  }
}

export function runRoundStressValidation(): { results: CaseResult[]; batches: BatchOutcome[] } {
  const batches = [25, 50, 100].map(runBatch)
  return { results: batches.flatMap(b => b.results), batches }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { results, batches } = runRoundStressValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  console.log('')
  for (const b of batches) {
    console.log(
      `Batch ${b.size}: totalMs=${b.totalMs} avgMsPerRound=${b.avgMsPerRound.toFixed(2)} `
      + `finalMessages=${b.finalMessageCount} clippedMessages=${b.clippedMessageCount}`,
    )
  }
  const failed = results.filter(result => !result.pass)
  console.log(`\nRound stress validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
