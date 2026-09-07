// Real-Ollama server-side decree-freshness check (no mocks). Runs 3 sequential, topically
// unrelated decrees through executeCouncilChatRequest directly, on both the legacy
// stable-group single-family path and the family_to_family_v1 path, and asserts the model's
// core answer (391, then Tokyo) is never overridden by a deliberately stale `activeTopic`.
// Requires a running local Ollama with huihui_ai/qwen3-abliterated:14b and .env.local loaded:
//   node --env-file=.env.local --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types scripts/run-council-decree-freshness-live-check.mjs
// This proves server-side prompt freshness only — it does not exercise app/page.tsx's client
// round-supersession guards (see lib/council/sessionBarrier.validation.ts for those).
import { executeCouncilChatRequest } from '../app/api/chat/execute.ts'

function req(body) {
  return new Request('http://local/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const rounds = [
  { decree: 'Reply with exactly one short sentence describing War Room.', expect: '(descriptive sentence)' },
  { decree: 'What is 17 multiplied by 23? Reply with only the number.', expect: '391' },
  { decree: 'Name the capital of Japan in one word.', expect: 'Tokyo' },
]

async function runLegacySingleFamilySequence(family) {
  console.log(`\n=== LEGACY stable-group single-family path (family=${family}) — 3 real sequential rounds ===`)
  const threadHistory = []
  const priorDecreeMessages = [] // simulates council.messages entries tagged as decree/RA'EL
  const failures = []
  for (let i = 0; i < rounds.length; i++) {
    const { decree, expect } = rounds[i]
    // Mimic deriveActiveTopicFromMessages: last decree-tagged message BEFORE this round's own
    // decree has been appended to state (the one-render-lag bug) -> previous round's decree text,
    // or the current decree itself if this is round 1 (no prior messages).
    const activeTopic = priorDecreeMessages.length ? priorDecreeMessages[priorDecreeMessages.length - 1] : decree
    const body = {
      message: decree,
      profile: '',
      threadHistory,
      mode: 'continue',
      toneMode: 'casual',
      councilSingleFamily: family,
      orchestrationAugment: '',
      councilCommand: { mode: 'normal', directInvocation: false, targetFamilies: [] },
      raelDirectiveText: decree,
      councilIntentKind: 'general',
      councilActiveScope: 'general',
      councilModeGovernor: {},
      councilProviderRuntimeStates: {},
      councilFlowMode: 'stable_group',
      councilLogicalRequestId: `diag-h-legacy-round${i + 1}`,
      councilLogicalExpectedFamilies: [family],
      councilLogicalTurnIndex: 0,
      councilLogicalTurnTotal: 1,
      activeTopic,
    }
    const t0 = Date.now()
    const res = await executeCouncilChatRequest(req(body))
    const json = await res.json()
    const answer = json.councilSingleResponse ?? '(none — stableGroupSkipped=' + json.stableGroupSkipped + ')'
    console.log(`\nROUND ${i + 1} decree: "${decree}"`)
    console.log(`  activeTopic sent: "${activeTopic}"`)
    console.log(`  expected: ${expect}`)
    console.log(`  elapsed: ${Date.now() - t0}ms`)
    console.log(`  ANSWER: ${answer}`)
    if (i === 1 && !answer.includes('391')) failures.push(`round2 expected '391' in answer, got: ${answer}`)
    if (i === 2 && !/tokyo/i.test(answer)) failures.push(`round3 expected 'Tokyo' in answer, got: ${answer}`)
    threadHistory.push({ role: 'user', content: decree }, { role: 'assistant', content: answer })
    priorDecreeMessages.push(decree)
  }
  return failures
}

async function runFamilyToFamilySequence() {
  console.log(`\n=== family_to_family_v1 path — 3 real sequential rounds ===`)
  const threadHistory = []
  const priorDecreeMessages = []
  const failures = []
  for (let i = 0; i < rounds.length; i++) {
    const { decree, expect } = rounds[i]
    const activeTopic = priorDecreeMessages.length ? priorDecreeMessages[priorDecreeMessages.length - 1] : decree
    const body = {
      message: decree,
      profile: '',
      threadHistory,
      mode: 'continue',
      toneMode: 'casual',
      councilSingleFamily: 'chatgpt',
      orchestrationAugment: '',
      councilCommand: { mode: 'normal', directInvocation: false, targetFamilies: [] },
      raelDirectiveText: decree,
      councilIntentKind: 'general',
      councilActiveScope: 'general',
      councilModeGovernor: {},
      councilProviderRuntimeStates: {},
      councilFlowMode: 'stable_group',
      councilLogicalRequestId: `diag-h-f2f-round${i + 1}`,
      councilLogicalExpectedFamilies: ['claude', 'gemini', 'chatgpt'],
      councilLogicalTurnIndex: 0,
      councilLogicalTurnTotal: 3,
      activeTopic,
      councilDeliberationMode: 'family_to_family_v1',
    }
    const t0 = Date.now()
    const res = await executeCouncilChatRequest(req(body))
    const json = await res.json()
    console.log(`\nROUND ${i + 1} decree: "${decree}"`)
    console.log(`  activeTopic sent: "${activeTopic}"`)
    console.log(`  expected: ${expect}`)
    console.log(`  elapsed: ${Date.now() - t0}ms`)
    console.log(`  has familyDeliberation: ${Boolean(json.familyDeliberation)}`)
    let synthText = ''
    if (json.familyDeliberation) {
      for (const turn of json.familyDeliberation.turns ?? []) {
        console.log(`    [${turn.provider_family}] role=${turn.turn_role} :: ${(turn.full_response ?? '').slice(0, 200).replace(/\n/g, ' ')}`)
        if (turn.turn_id === json.familyDeliberation.synthesis_turn_id) synthText = turn.full_response
      }
    }
    if (i === 1 && !synthText.includes('391')) failures.push(`round2 synthesis expected '391', got: ${synthText}`)
    if (i === 2 && !/tokyo/i.test(synthText)) failures.push(`round3 synthesis expected 'Tokyo', got: ${synthText}`)
    threadHistory.push({ role: 'user', content: decree }, { role: 'assistant', content: synthText })
    priorDecreeMessages.push(decree)
  }
  return failures
}

const legacyFailures = await runLegacySingleFamilySequence('claude')
const f2fFailures = await runFamilyToFamilySequence()
const allFailures = [...legacyFailures, ...f2fFailures]
console.log('\n=== COUNCIL DECREE FRESHNESS LIVE CHECK COMPLETE ===')
if (allFailures.length) {
  for (const f of allFailures) console.log(`FAIL: ${f}`)
  console.log(`\n${allFailures.length} failure(s).`)
  process.exit(1)
}
console.log('All rounds answered correctly on both paths.')
process.exit(0)
