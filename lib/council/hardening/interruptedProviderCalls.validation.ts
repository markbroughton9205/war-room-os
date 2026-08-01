import { pathToFileURL } from 'node:url'
import { raceWithTimeout } from '@/lib/council/providerIsolation'
import { providerRuntimeFailed, isSuccessfulVisibleMessage } from '@/lib/council/messagePersistenceFilter'
import { compressCouncilOutput } from '@/lib/council/compression'
import type { CouncilCompressionMessage } from '@/lib/council/compression'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function testRaceWithTimeout(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  // 1. A fast provider response wins the race — no timeout classification.
  const fastResult = await raceWithTimeout(delay(5).then(() => 'ok'), 200)
  results.push(check(
    'interrupt_01_fast_response_wins_race',
    fastResult.ok === true && fastResult.value === 'ok',
    JSON.stringify(fastResult),
  ))

  // 2. A provider that never settles within budget is classified as timeout, not silently hung.
  const neverResolves = new Promise<string>(() => { /* intentionally never settles */ })
  const timeoutResult = await raceWithTimeout(neverResolves, 30)
  results.push(check(
    'interrupt_02_slow_response_classified_as_timeout',
    timeoutResult.ok === false && timeoutResult.reason === 'timeout',
    JSON.stringify(timeoutResult),
  ))

  // 3. A rejected provider call (connection reset, malformed JSON parse throw, etc.) is classified
  //    as a rejection, not silently swallowed or misreported as a timeout.
  const rejectedResult = await raceWithTimeout(Promise.reject(new Error('ECONNRESET')), 200)
  results.push(check(
    'interrupt_03_connection_reset_classified_as_rejected_not_timeout',
    rejectedResult.ok === false && rejectedResult.reason === 'rejected',
    JSON.stringify({ ok: rejectedResult.ok, reason: rejectedResult.ok ? null : rejectedResult.reason }),
  ))

  // 4. "Response arriving after timeout" — the underlying promise is NOT cancelled by
  //    raceWithTimeout (documented behavior), so it resolves later regardless, but the caller's
  //    race result was already settled to 'timeout' and can never retroactively flip to 'ok'.
  //    This is guaranteed by native Promise settle-once semantics; this test proves it end-to-end
  //    rather than only by inspection.
  let observedAfterTimeout: string | null = null
  const lateResolver = delay(60).then(() => {
    observedAfterTimeout = 'late-value-observed'
    return 'late-value'
  })
  const raceResult = await raceWithTimeout(lateResolver, 20)
  await delay(80) // let the late resolver actually settle, well after the race already returned
  results.push(check(
    'interrupt_04_late_response_after_timeout_cannot_retroactively_overwrite_result',
    raceResult.ok === false && raceResult.reason === 'timeout' && observedAfterTimeout === 'late-value-observed',
    `raceResult=${JSON.stringify(raceResult)} laterObserved=${observedAfterTimeout}`,
  ))

  return results
}

function classificationCases(): CaseResult[] {
  const results: CaseResult[] = []

  // Every Phase-4 failure category must be classified as failed, never as a successful response.
  const failureCategories: { label: string; providerRuntime: 'FAILED' | 'TIMED_OUT'; content: string }[] = [
    { label: 'http_429_rate_limited', providerRuntime: 'FAILED', content: 'HTTP 429: rate limit exceeded' },
    { label: 'http_500_server_error', providerRuntime: 'FAILED', content: 'HTTP 500: internal server error' },
    { label: 'http_502_bad_gateway', providerRuntime: 'FAILED', content: 'HTTP 502: bad gateway' },
    { label: 'http_503_unavailable', providerRuntime: 'FAILED', content: 'HTTP 503: service unavailable' },
    { label: 'malformed_json', providerRuntime: 'FAILED', content: 'Unexpected token in JSON at position 0' },
    { label: 'connection_reset', providerRuntime: 'FAILED', content: 'ECONNRESET' },
    { label: 'timeout', providerRuntime: 'TIMED_OUT', content: 'Request timed out after 30000ms' },
    { label: 'empty_response', providerRuntime: 'FAILED', content: '' },
  ]

  for (const category of failureCategories) {
    const message = {
      messageType: 'response',
      sender: 'claude',
      content: category.content,
      providerRuntime: category.providerRuntime,
    }
    const failed = providerRuntimeFailed(message)
    const visible = isSuccessfulVisibleMessage(message)
    results.push(check(
      `interrupt_classify_${category.label}_never_counted_as_responded`,
      failed === true && visible === false,
      `providerRuntimeFailed=${failed} isSuccessfulVisibleMessage=${visible}`,
    ))
  }

  // A partial (truncated mid-sentence) response with no explicit providerRuntime status is not
  // auto-classified as failed by providerRuntimeFailed alone (that's the render-gate's job via
  // response-integrity validation, already covered by the render-gate suite) — but it must not be
  // silently promoted to "responded" just because content exists; this documents the boundary.
  const partial = { messageType: 'response', sender: 'grok', content: 'The current status is that the sys' }
  results.push(check(
    'interrupt_classify_partial_response_has_content_but_relies_on_render_gate_for_integrity',
    isSuccessfulVisibleMessage(partial) === true,
    'partial responses with non-empty content pass the persistence filter; integrity is enforced separately by councilRenderGate (see councilRenderGate.validation.ts)',
  ))

  return results
}

function partialSynthesisCase(): CaseResult {
  // A round where 2 of 5 families produced real, substantive answers and 3 failed must still
  // synthesize from the 2 real answers — a total provider outage isn't required to lose synthesis.
  const messages: CouncilCompressionMessage[] = [
    { id: 'd1', familyName: "RA'EL", content: 'What is our current deployment risk?', messageType: 'decree' },
    { id: 'r1', familyName: 'Claude Family', content: 'Analysis shows deployment risk is low because the last three builds passed validation and no schema changes are pending; recommended action is to proceed.', messageType: 'response' },
    { id: 'r2', familyName: 'ChatGPT Family', content: 'Provider response incomplete; fallback summary used', messageType: 'response' },
    { id: 'r3', familyName: 'Gemini Family', content: 'Gemini response incomplete — retry/fallback required.', messageType: 'response' },
    { id: 'r4', familyName: 'Grok Family', content: 'Provider response unavailable', messageType: 'response' },
    { id: 'r5', familyName: 'Red Team', content: 'Evidence review confirms no active harm observed; risk assessment aligns with Claude analysis and no contradiction found.', messageType: 'response' },
  ]
  const compressed = compressCouncilOutput(messages, 'standard', { stabilityMode: false })
  const boilerplateStrings = [
    'Provider response incomplete; fallback summary used',
    'Provider response unavailable',
    'Gemini response incomplete — retry/fallback required.',
  ]
  const summaryText = compressed.decisionSummary.join(' | ')
  const hasRealSynthesis = compressed.decisionSummary.length > 0
    && !summaryText.includes('Council could not produce a reliable synthesis')
  const leakedBoilerplate = boilerplateStrings.some(text => summaryText.includes(text))
  return check(
    'interrupt_05_partial_synthesis_from_surviving_families_excludes_fallback_boilerplate',
    hasRealSynthesis && !leakedBoilerplate,
    `decisionSummary=${JSON.stringify(compressed.decisionSummary)} leakedBoilerplate=${leakedBoilerplate}`,
  )
}

export async function runInterruptedProviderCallsValidation(): Promise<CaseResult[]> {
  const raceResults = await testRaceWithTimeout()
  return [...raceResults, ...classificationCases(), partialSynthesisCase()]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runInterruptedProviderCallsValidation().then(results => {
    for (const result of results) {
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    }
    const failed = results.filter(result => !result.pass)
    console.log(`\nInterrupted provider calls validation: ${results.length - failed.length}/${results.length} PASS`)
    if (failed.length) process.exit(1)
  })
}
