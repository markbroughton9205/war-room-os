import { pathToFileURL } from 'node:url'
import { applyCouncilRenderGate } from './councilRenderGate'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

export function runCouncilRenderGateValidation(): CaseResult[] {
  const brevityDecree = 'In one sentence, state the current phase.'
  const shortValidResponse = 'Current phase: council stabilization — holding at Phase 32B.'

  // 1. A short, legitimate response to an explicit brevity request must render as-is when the
  //    caller supplies decree context (the live-round render path always does this).
  const withContext = applyCouncilRenderGate('claude', shortValidResponse, { decreeText: brevityDecree })

  // 2. The same content, reconstructed with NO decree context (the historical-row reload bug this
  //    guards against), must not silently discard the real text — this documents why every call
  //    site that reconstructs persisted messages (e.g. mapWarRoomRowToCouncilMessage) MUST thread
  //    decreeText/promptIntent through, exactly like the live render path already does.
  const withoutContext = applyCouncilRenderGate('claude', shortValidResponse, {})

  // 3. A normal, longer analytical response renders correctly with or without context (the
  //    default 80-char minLength alone doesn't reject it), so this isn't a blanket relaxation.
  const longResponse =
    'Analysis shows the mount-time reconciliation fetch races ahead of fire-and-forget persist writes, therefore a query window that never advances past the first page of history is the primary finding.'
  const longWithoutContext = applyCouncilRenderGate('claude', longResponse, {})

  // 4. A long, complete, substantive response ending in terminal punctuation followed by a trailing
  //    emoji flourish (a common council-persona pattern) must render as COMPLETE, not be
  //    misclassified as TRUNCATED just because the very last character isn't literal punctuation.
  const decree5 = 'In two sentences, state your current operational status and one active risk.'
  const emojiTerminatedResponse =
    'Operational and responding normally on this turn, but noting for the record: several prior turns came back as fallback/incomplete rather than a real response, so the trace has gaps that should not be read as all green. Active risk is exactly that — silent degradation getting smoothed over into a clean status report when the underlying provider hiccups were not actually resolved. \u{1F914}'
  const emojiTerminated = applyCouncilRenderGate('claude', emojiTerminatedResponse, { decreeText: decree5 })

  // 5. A response that is genuinely truncated (ends mid-word with no terminal punctuation at all,
  //    emoji or otherwise) must still be flagged — the emoji allowance must not become a blanket
  //    truncation bypass.
  const genuinelyTruncatedResponse =
    'Operational and responding normally on this turn, but noting for the record that several prior turns came back as fallback or incomplete rather than a real response and the active risk is exactly'
  const genuinelyTruncated = applyCouncilRenderGate('claude', genuinelyTruncatedResponse, { decreeText: decree5 })

  // 6. Council Runtime Stability Overhaul regression: a long, complete, substantive response that
  //    ends in a markdown bullet list (no trailing period on the last line — a normal and common
  //    council output shape) must render as COMPLETE, not be misclassified INCOMPLETE and blocked
  //    with the "response incomplete" placeholder. This is the concrete root cause traced for
  //    successful providers being shown as DEGRADED despite the runtime reporting them connected
  //    and completed: `validateProviderResponseIntegrity`'s "no sentence terminator on substantial
  //    body" check did not previously recognize list/table/code-fence endings as complete.
  const decree6 = 'Give me the deployment findings.'
  const bulletEndedResponse =
    'Findings: because the mount-time reconciliation fetch races ahead of the persist write, the evidence shows the following synthesis of risk and recommended action for this deploy window:\n- Rollback plan verified against the prior release tag\n- Provider health checks all reported healthy at dispatch time\n- Recommended action: proceed with the 3pm deploy window'
  const bulletEnded = applyCouncilRenderGate('claude', bulletEndedResponse, { decreeText: decree6 })

  return [
    check(
      'render_gate_01_short_brevity_response_passes_with_decree_context',
      withContext.renderable === true && withContext.displayText === shortValidResponse,
      JSON.stringify(withContext),
    ),
    check(
      'render_gate_02_missing_decree_context_degrades_a_valid_short_response',
      withoutContext.renderable === false && withoutContext.degraded === true,
      JSON.stringify(withoutContext),
    ),
    check(
      'render_gate_03_long_response_unaffected_by_missing_context',
      longWithoutContext.renderable === true && longWithoutContext.displayText === longResponse,
      JSON.stringify(longWithoutContext),
    ),
    check(
      'render_gate_04_trailing_emoji_after_punctuation_is_complete_not_truncated',
      emojiTerminated.renderable === true
      && emojiTerminated.degraded === false
      && emojiTerminated.integrityStatus === 'COMPLETE'
      && emojiTerminated.displayText === emojiTerminatedResponse,
      JSON.stringify(emojiTerminated),
    ),
    check(
      'render_gate_05_genuinely_truncated_response_still_flagged',
      genuinelyTruncated.renderable === false && genuinelyTruncated.degraded === true,
      JSON.stringify(genuinelyTruncated),
    ),
    check(
      'render_gate_06_bullet_list_ending_is_complete_not_degraded',
      bulletEnded.renderable === true
      && bulletEnded.degraded === false
      && bulletEnded.integrityStatus === 'COMPLETE'
      && bulletEnded.displayText === bulletEndedResponse,
      JSON.stringify(bulletEnded),
    ),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runCouncilRenderGateValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Council render gate validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
