import { orchestrateProviderResponse, type InvokeProviderFn } from './retryOrchestration'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const FALLBACK_SUMMARY =
  'ChatGPT summarizes the incomplete Gemini attempt: the core recommendation was to proceed with the Panama logistics review next week and confirm the budget figures with Claude before the Commander signs off on the freight contract terms.'

const COMPLETE_PRIMARY =
  'Gemini here — the Panama logistics review looks solid for next week. I would confirm the fuel surcharge assumptions with Claude before we lock in the freight contract numbers, since those shift the margin more than anything else in the plan.'

async function runFallbackAttributionCase(): Promise<{
  fallbackUsed: boolean
  family: string
  displayText: string
  text: string
}> {
  delete process.env.COUNCIL_STABILITY_MODE
  process.env.OPENAI_API_KEY = 'test-key-for-validation-only'

  const invoke: InvokeProviderFn = async args => {
    if (args.family === 'gemini') return '' // retries stay empty, forcing the fallback branch
    if (args.family === 'chatgpt') return FALLBACK_SUMMARY
    return ''
  }

  const outcome = await orchestrateProviderResponse({
    family: 'gemini',
    prompt: 'Commander decree: what is our Panama logistics plan for next week?',
    rawText: 'Hi', // near-empty (<12 chars) -> EMPTY status, fallback_recommended: true
    invoke,
  })

  return {
    fallbackUsed: outcome.fallbackUsed,
    family: outcome.family,
    displayText: outcome.displayText,
    text: outcome.text,
  }
}

async function runNoFallbackCase(): Promise<{ displayText: string; text: string }> {
  delete process.env.COUNCIL_STABILITY_MODE
  const invoke: InvokeProviderFn = async () => ''
  const outcome = await orchestrateProviderResponse({
    family: 'gemini',
    prompt: 'Commander decree: what is our Panama logistics plan for next week?',
    rawText: COMPLETE_PRIMARY,
    invoke,
  })
  return { displayText: outcome.displayText, text: outcome.text }
}

// --- Retry-call budget verification (Phase 48-C4D Step 4) -------------------------------------
// Exact discovered maximum: reading the real source (not the earlier classification estimate),
// `orchestrateProviderResponse` itself never makes the *original* provider call — that call is
// already made by the caller (`execute.ts`) before this function runs. Within this function:
//   retry stage:    Gemini gets up to 3 strategies (simplified, no_compression, short_context);
//                    every other family gets exactly 1 ('simplified' only, explicit early break).
//   fallback stage:  runs only if still incomplete after retries; iterates FALLBACK_CHAIN[family]
//                    (2 candidates for gemini/grok/claude/chatgpt/red_team, 1 for baby, 2 default
//                    for any family absent from the map), one invoke() call per configured
//                    candidate, stopping at the first COMPLETE result.
// Worst case: Gemini = 3 (retry) + 2 (fallback) = 5 invoke() calls. Any other mapped family with a
// 2-candidate chain = 1 + 2 = 3. `baby` = 1 + 1 = 2. This is strictly larger than the earlier
// classification's "3 Gemini retries + 1 fallback = 4" estimate, which undercounted the fallback
// stage (it can try more than one candidate).

function installBudgetEnv(): void {
  delete process.env.COUNCIL_STABILITY_MODE
  process.env.OPENAI_API_KEY = 'test-key-for-validation-only'
  process.env.ANTHROPIC_API_KEY = 'test-key-for-validation-only'
}

async function runGeminiMaxBudgetCase() {
  installBudgetEnv()
  let invokeCallCount = 0
  const invoke: InvokeProviderFn = async () => {
    invokeCallCount += 1
    return '' // always empty -> integrity never completes, forcing full retry+fallback exhaustion
  }
  const outcome = await orchestrateProviderResponse({
    family: 'gemini',
    prompt: 'Commander decree: budget probe.',
    rawText: '',
    invoke,
  })
  return {
    invokeCallCount,
    strategies: outcome.diagnostics?.retryStrategies ?? [],
    fallbackUsed: outcome.fallbackUsed,
    integrityStatus: outcome.integrity.integrity_status,
  }
}

async function runNonGeminiMaxBudgetCase() {
  installBudgetEnv()
  let invokeCallCount = 0
  const invoke: InvokeProviderFn = async () => {
    invokeCallCount += 1
    return ''
  }
  const outcome = await orchestrateProviderResponse({
    family: 'grok',
    prompt: 'Commander decree: budget probe.',
    rawText: '',
    invoke,
  })
  return { invokeCallCount, strategies: outcome.diagnostics?.retryStrategies ?? [] }
}

async function runEarlySuccessStopsRetryCase() {
  delete process.env.COUNCIL_STABILITY_MODE
  let invokeCallCount = 0
  const invoke: InvokeProviderFn = async () => {
    invokeCallCount += 1
    return COMPLETE_PRIMARY // full valid response on the very first retry attempt
  }
  await orchestrateProviderResponse({
    family: 'gemini',
    prompt: 'Commander decree: budget probe.',
    rawText: '',
    invoke,
  })
  return { invokeCallCount }
}

async function runFallbackStopsAtFirstSuccessCase() {
  installBudgetEnv()
  let invokeCallCount = 0
  let claudeInvoked = false
  const invoke: InvokeProviderFn = async args => {
    invokeCallCount += 1
    if (args.family === 'gemini') return '' // retries never complete -> forces fallback stage
    if (args.family === 'chatgpt') return FALLBACK_SUMMARY // first fallback candidate succeeds
    if (args.family === 'claude') claudeInvoked = true
    return FALLBACK_SUMMARY
  }
  const outcome = await orchestrateProviderResponse({
    family: 'gemini',
    prompt: 'Commander decree: budget probe.',
    rawText: '',
    invoke,
  })
  return { invokeCallCount, claudeInvoked, fallbackUsed: outcome.fallbackUsed, displayText: outcome.displayText }
}

async function runStabilityModeBypassCase() {
  process.env.COUNCIL_STABILITY_MODE = 'true'
  let invokeCallCount = 0
  const invoke: InvokeProviderFn = async () => {
    invokeCallCount += 1
    return ''
  }
  const outcome = await orchestrateProviderResponse({
    family: 'gemini',
    prompt: 'Commander decree: budget probe.',
    rawText: 'Some already-produced provider text.',
    invoke,
  })
  delete process.env.COUNCIL_STABILITY_MODE
  return { invokeCallCount, retryCount: outcome.retryCount, fallbackUsed: outcome.fallbackUsed }
}

/** Structural guarantee against recursive retry chains: `orchestrateProviderResponse` must never
 * call itself — fallback and retry both go through the caller-supplied `invoke`, not back into
 * this function. Checked by reading this module's own compiled/source text rather than asserting
 * it via runtime behavior, since a recursive call site (if one existed) could still terminate for
 * the specific fixtures above without proving the general case. */
function noRecursiveSelfCallInSource(): boolean {
  const sourcePath = fileURLToPath(new URL('./retryOrchestration.ts', import.meta.url))
  const source = readFileSync(sourcePath, 'utf8')
  const callSites = source.match(/(?<!function\s)orchestrateProviderResponse\s*\(/g) ?? []
  return callSites.length === 0
}

export async function runRetryOrchestrationValidation(): Promise<CaseResult[]> {
  const fallback = await runFallbackAttributionCase()
  const noFallback = await runNoFallbackCase()
  const geminiBudget = await runGeminiMaxBudgetCase()
  const nonGeminiBudget = await runNonGeminiMaxBudgetCase()
  const earlySuccess = await runEarlySuccessStopsRetryCase()
  const fallbackStopsEarly = await runFallbackStopsAtFirstSuccessCase()
  const stabilityBypass = await runStabilityModeBypassCase()

  return [
    check(
      'retry_orchestration_01_fallback_actually_used_for_near_empty_primary',
      fallback.fallbackUsed === true,
      String(fallback.fallbackUsed),
    ),
    check(
      'retry_orchestration_02_family_identity_stays_the_original_family_not_the_fallback',
      fallback.family === 'gemini',
      fallback.family,
    ),
    check(
      'retry_orchestration_03_displayText_honestly_attributes_the_fallback_family',
      fallback.displayText.startsWith('[ChatGPT summarized Gemini'),
      fallback.displayText.slice(0, 60),
    ),
    check(
      'retry_orchestration_04_displayText_still_carries_the_real_fallback_content',
      fallback.displayText.includes(FALLBACK_SUMMARY),
      String(fallback.displayText.includes(FALLBACK_SUMMARY)),
    ),
    check(
      'retry_orchestration_05_raw_text_field_unprefixed_for_diagnostics',
      fallback.text === FALLBACK_SUMMARY,
      fallback.text.slice(0, 40),
    ),
    check(
      'retry_orchestration_06_no_fallback_path_has_no_attribution_prefix',
      noFallback.displayText === noFallback.text && !noFallback.displayText.startsWith('['),
      noFallback.displayText.slice(0, 40),
    ),
    check(
      'retry_orchestration_07_gemini_worst_case_budget_is_exactly_five_calls',
      geminiBudget.invokeCallCount === 5 && geminiBudget.fallbackUsed === false,
      `invokeCallCount=${geminiBudget.invokeCallCount} fallbackUsed=${geminiBudget.fallbackUsed}`,
    ),
    check(
      'retry_orchestration_08_gemini_uses_all_three_strategies_only_when_exhausted',
      geminiBudget.strategies.join(',') === 'simplified,no_compression,short_context',
      geminiBudget.strategies.join(','),
    ),
    check(
      'retry_orchestration_09_non_gemini_worst_case_budget_is_exactly_three_calls',
      nonGeminiBudget.invokeCallCount === 3,
      `invokeCallCount=${nonGeminiBudget.invokeCallCount}`,
    ),
    check(
      'retry_orchestration_10_non_gemini_never_receives_gemini_only_strategies',
      nonGeminiBudget.strategies.join(',') === 'simplified',
      nonGeminiBudget.strategies.join(','),
    ),
    check(
      'retry_orchestration_11_successful_first_retry_prevents_further_calls',
      earlySuccess.invokeCallCount === 1,
      `invokeCallCount=${earlySuccess.invokeCallCount}`,
    ),
    check(
      'retry_orchestration_12_fallback_stops_at_first_success_second_candidate_never_called',
      fallbackStopsEarly.invokeCallCount === 4 && fallbackStopsEarly.claudeInvoked === false && fallbackStopsEarly.fallbackUsed === true,
      `invokeCallCount=${fallbackStopsEarly.invokeCallCount} claudeInvoked=${fallbackStopsEarly.claudeInvoked} fallbackUsed=${fallbackStopsEarly.fallbackUsed}`,
    ),
    check(
      'retry_orchestration_13_fallback_stop_early_still_honestly_attributed',
      fallbackStopsEarly.displayText.startsWith('[ChatGPT summarized Gemini'),
      fallbackStopsEarly.displayText.slice(0, 40),
    ),
    check(
      'retry_orchestration_14_stability_mode_bypasses_orchestration_zero_calls',
      stabilityBypass.invokeCallCount === 0 && stabilityBypass.retryCount === 0 && stabilityBypass.fallbackUsed === false,
      `invokeCallCount=${stabilityBypass.invokeCallCount} retryCount=${stabilityBypass.retryCount} fallbackUsed=${stabilityBypass.fallbackUsed}`,
    ),
    check(
      'retry_orchestration_15_no_recursive_self_call_in_source',
      noRecursiveSelfCallInSource(),
      'orchestrateProviderResponse call-site count outside its own declaration',
    ),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRetryOrchestrationValidation().then(results => {
    for (const result of results) {
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    }
    const failed = results.filter(result => !result.pass)
    console.log(`Retry orchestration validation: ${results.length - failed.length}/${results.length} PASS`)
    if (failed.length) process.exit(1)
  })
}
