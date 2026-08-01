import { pathToFileURL } from 'node:url'
import { councilSessionReducer, createInitialCouncilPersisted } from '@/components/council/councilSessionReducer'
import { clipMessages, MAX_PERSISTED_MESSAGES } from '@/components/council/useCouncilSession'
import { shouldReplacePersistedTranscript } from '@/lib/conversation-runtime/transcriptReconciliation'
import { simulateRounds, type SimulatedRound } from './roundSimulator'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

// Rounds sized generously above the message targets (~4.8 persisted messages/round on average,
// since some simulated families fail per round) to guarantee each target is actually crossed.
const TARGETS: { messages: number; rounds: number }[] = [
  { messages: 100, rounds: 25 },
  { messages: 250, rounds: 60 },
  { messages: 300, rounds: 70 },
  { messages: 500, rounds: 110 },
  { messages: 1000, rounds: 215 },
  { messages: 1500, rounds: 320 },
]

function buildConversation(rounds: SimulatedRound[]) {
  let store = createInitialCouncilPersisted('long-conversation-session')
  for (const round of rounds) {
    store = councilSessionReducer(store, { type: 'ADD_MESSAGES', payload: [round.decree, ...round.responses] })
  }
  return store
}

export function runLongConversationValidation(): CaseResult[] {
  const results: CaseResult[] = []

  for (const target of TARGETS) {
    const rounds = simulateRounds(target.rounds, 5000 + target.rounds)
    const store = buildConversation(rounds)
    const reachedTarget = store.messages.length >= target.messages

    // 1. The full (unclipped) accumulated history actually crosses the target size.
    results.push(check(
      `long_${target.messages}_01_conversation_reaches_target_size`,
      reachedTarget,
      `built=${store.messages.length} target=${target.messages}`,
    ))

    // 2. Reload/hydration ("newest window") retains the newest round, never the oldest, once the
    //    conversation exceeds the local persisted cap — this is the exact Phase 2 "newest messages
    //    remain accessible, not the oldest" requirement, proven at real scale.
    const clipped = clipMessages(store)
    const lastRound = rounds[rounds.length - 1]!
    const clippedContents = new Set(clipped.messages.map(m => m.content))
    const newestSurvived = clippedContents.has(lastRound.decree.content)
      && lastRound.responses.every(r => clippedContents.has(r.content))
    const oldestExcluded = rounds.length > 20 && !clippedContents.has(rounds[0]!.decree.content)
    results.push(check(
      `long_${target.messages}_02_newest_round_survives_not_oldest`,
      clipped.messages.length <= MAX_PERSISTED_MESSAGES && newestSurvived && oldestExcluded,
      `clippedCount=${clipped.messages.length} newestSurvived=${newestSurvived} oldestExcluded=${oldestExcluded}`,
    ))

    // 3. A server-side reconciliation fetch that only has the OLDEST page of this large history
    //    (the exact bug-B failure mode: an ascending+limit query frozen on the first N rows) must
    //    never be preferred over the locally clipped, newest-window transcript.
    const staleOldestPage = store.messages.slice(0, MAX_PERSISTED_MESSAGES)
    const guardKeepsLocal = shouldReplacePersistedTranscript(clipped.messages, staleOldestPage) === false
    results.push(check(
      `long_${target.messages}_03_stale_oldest_page_never_preferred_over_local`,
      guardKeepsLocal,
      `guardWouldReplace=${!guardKeepsLocal}`,
    ))

    // 4. A genuinely newer/larger server fetch (e.g. another tab/device) is still correctly applied.
    const largerServerFetch = store.messages
    const guardAppliesLarger = shouldReplacePersistedTranscript(clipped.messages, largerServerFetch) === true
    results.push(check(
      `long_${target.messages}_04_genuinely_newer_server_data_still_applies`,
      guardAppliesLarger,
      `guardWouldReplace=${guardAppliesLarger}`,
    ))

    // 5. Family labels survive across the full clipped window at this scale.
    const knownLabels = new Set(['ChatGPT Family', 'Claude Family', 'Gemini Family', 'Grok Family', 'RED TEAM', "RA'EL"])
    const unlabeled = clipped.messages.filter(m => !knownLabels.has(m.familyName)).length
    results.push(check(
      `long_${target.messages}_05_family_labels_survive_at_scale`,
      unlabeled === 0,
      `unlabeled=${unlabeled} of ${clipped.messages.length}`,
    ))
  }

  // 6. Identical timestamps must not produce unstable ordering. The live transcript is strictly
  //    append-only (no re-sort by timestamp anywhere in the reducer path — confirmed by inspection:
  //    only ArchiveViewer/BuildAgentDivisionPanel sort by timestamp, and neither is in this path),
  //    so insertion order alone must be preserved even when every message shares one timestamp.
  {
    const identicalTs = '11:00:00 AM'
    let store = createInitialCouncilPersisted('tie-breaker-session')
    const decree = {
      id: 'tie-decree', familyName: "RA'EL", content: 'Round T: report status.',
      timestamp: identicalTs, color: '#FFD700', icon: '⚔', provider: '', messageType: 'decree',
    }
    const responseOrder = ['ChatGPT Family', 'Claude Family', 'Grok Family', 'Gemini Family', 'RED TEAM']
    const responses = responseOrder.map((familyName, i) => ({
      id: `tie-response-${i}`, familyName, content: `Round T status from ${familyName} #${i}`,
      timestamp: identicalTs, color: '#9CA3AF', icon: '•', provider: '', messageType: 'response',
    }))
    store = councilSessionReducer(store, { type: 'ADD_MESSAGES', payload: [decree, ...responses] })
    const actualOrder = store.messages.filter(m => m.messageType === 'response').map(m => m.familyName)
    const orderPreserved = JSON.stringify(actualOrder) === JSON.stringify(responseOrder)
    results.push(check(
      'long_06_identical_timestamps_preserve_insertion_order',
      orderPreserved,
      `expected=${JSON.stringify(responseOrder)} actual=${JSON.stringify(actualOrder)}`,
    ))
  }

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runLongConversationValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`\nLong conversation validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
