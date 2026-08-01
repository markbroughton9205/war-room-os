import { pathToFileURL } from 'node:url'
import {
  classifyGatheredProviderText,
  responseSuccessfulForRuntime,
  type LiveGatherRenderGateOutcome,
} from './liveGatherClassification'
import { providerRuntimeFailed } from './messagePersistenceFilter'
import { applyCouncilRenderGate, PROVIDER_RESPONSE_INCOMPLETE_FALLBACK_DISPLAY } from './councilRenderGate'
import type { ProviderFamilyOutcomeStatus } from './providerIsolation'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const acceptedGate: LiveGatherRenderGateOutcome = {
  displayText: 'A complete, integrity-validated council response with real substance.',
  degraded: false,
  renderable: true,
}

const degradedGate: LiveGatherRenderGateOutcome = {
  displayText: PROVIDER_RESPONSE_INCOMPLETE_FALLBACK_DISPLAY,
  degraded: true,
  renderable: false,
}

const nonRenderableGate: LiveGatherRenderGateOutcome = {
  displayText: '',
  degraded: false,
  renderable: false,
}

const ALL_RUNTIME_STATUSES: ProviderFamilyOutcomeStatus[] = [
  'READY',
  'RESPONDED',
  'TIMED_OUT',
  'DEGRADED',
  'FAILED',
  'SKIPPED',
  'IN_FLIGHT',
]

export function runLiveGatherClassificationValidation(): CaseResult[] {
  const results: CaseResult[] = []

  // Case: fallback placeholder text (non-empty) must not be classified RESPONDED, even though the
  // extracted text itself is non-empty — this is the exact write-time bug: previously only text
  // emptiness was checked, so substituted fallback boilerplate passed as a "response."
  const fallbackClassification = classifyGatheredProviderText(
    PROVIDER_RESPONSE_INCOMPLETE_FALLBACK_DISPLAY,
    degradedGate,
  )
  results.push(check(
    'gather_classify_01_fallback_placeholder_not_responded',
    fallbackClassification.runtime !== 'RESPONDED' && fallbackClassification.textOut === null,
    JSON.stringify(fallbackClassification),
  ))

  // Case: render-gate degraded:true must produce a non-RESPONDED runtime (DEGRADED, the codebase's
  // existing runtime state for this exact situation — see lib/council/providerIsolation.ts).
  results.push(check(
    'gather_classify_02_degraded_gate_produces_degraded_runtime',
    fallbackClassification.runtime === 'DEGRADED',
    `runtime=${fallbackClassification.runtime}`,
  ))

  // Case: a genuinely accepted, non-degraded, renderable response is still classified RESPONDED.
  const acceptedClassification = classifyGatheredProviderText('raw provider text', acceptedGate)
  results.push(check(
    'gather_classify_03_accepted_content_is_responded',
    acceptedClassification.runtime === 'RESPONDED'
      && acceptedClassification.textOut === acceptedGate.displayText,
    JSON.stringify(acceptedClassification),
  ))

  // Case: gate says renderable:false without degraded:true (e.g. truly empty raw text) still
  // resolves to a non-RESPONDED, non-DEGRADED (plain FAILED) runtime.
  const nonRenderableClassification = classifyGatheredProviderText('raw provider text', nonRenderableGate)
  results.push(check(
    'gather_classify_04_non_renderable_non_degraded_is_failed',
    nonRenderableClassification.runtime === 'FAILED' && nonRenderableClassification.textOut === null,
    JSON.stringify(nonRenderableClassification),
  ))

  // Case: truly empty extracted text (no gate ever run) is FAILED/empty_response.
  const emptyClassification = classifyGatheredProviderText('', null)
  results.push(check(
    'gather_classify_05_empty_extracted_text_is_failed',
    emptyClassification.runtime === 'FAILED' && emptyClassification.runtimeDetail === 'empty_response',
    JSON.stringify(emptyClassification),
  ))

  // Case: persisted responseSuccessful must be false for DEGRADED runtime.
  results.push(check(
    'gather_classify_06_response_successful_false_for_degraded',
    responseSuccessfulForRuntime('DEGRADED') === false,
    `responseSuccessfulForRuntime('DEGRADED')=${responseSuccessfulForRuntime('DEGRADED')}`,
  ))

  // Case: persisted responseSuccessful must be true for RESPONDED runtime.
  results.push(check(
    'gather_classify_07_response_successful_true_for_responded',
    responseSuccessfulForRuntime('RESPONDED') === true,
    `responseSuccessfulForRuntime('RESPONDED')=${responseSuccessfulForRuntime('RESPONDED')}`,
  ))

  // Case: providerRuntime and responseSuccessful never contradict each other, across every runtime
  // status the codebase defines — responseSuccessful is true for exactly one status (RESPONDED),
  // and every other status must agree that the response was not successful.
  const contradictions = ALL_RUNTIME_STATUSES.filter(status => {
    const successful = responseSuccessfulForRuntime(status)
    return successful !== (status === 'RESPONDED')
  })
  results.push(check(
    'gather_classify_08_runtime_and_success_never_contradict',
    contradictions.length === 0,
    `contradictingStatuses=${JSON.stringify(contradictions)}`,
  ))

  // Case: live (persist-time) classification and reload (render-time) classification agree for the
  // same degraded content. Both now derive from the SAME applyCouncilRenderGate verdict instead of
  // persist-time only checking text emptiness — feed a known fallback string through the real gate
  // (as a reload/render pass would) and confirm the persist-time classifier reaches the same
  // non-successful conclusion for that gate's verdict.
  const renderTimeGate = applyCouncilRenderGate('chatgpt', PROVIDER_RESPONSE_INCOMPLETE_FALLBACK_DISPLAY, {})
  const persistTimeClassification = classifyGatheredProviderText(
    PROVIDER_RESPONSE_INCOMPLETE_FALLBACK_DISPLAY,
    renderTimeGate,
  )
  results.push(check(
    'gather_classify_09_live_and_reload_classification_agree_for_degraded',
    renderTimeGate.degraded === true
      && persistTimeClassification.runtime !== 'RESPONDED'
      && responseSuccessfulForRuntime(persistTimeClassification.runtime) === false,
    `renderTimeGate.degraded=${renderTimeGate.degraded} persistRuntime=${persistTimeClassification.runtime}`,
  ))

  // Case: degraded providers are excluded from "responded" counts — the shared persistence filter
  // (used to decide what counts as a successful, countable contribution) must treat a DEGRADED
  // runtime with responseSuccessful:false as a failed/non-countable contribution.
  const degradedMessage = {
    providerRuntime: 'DEGRADED' as const,
    responseSuccessful: responseSuccessfulForRuntime('DEGRADED'),
    content: PROVIDER_RESPONSE_INCOMPLETE_FALLBACK_DISPLAY,
  }
  results.push(check(
    'gather_classify_10_degraded_excluded_from_responded_counts',
    providerRuntimeFailed(degradedMessage) === true,
    JSON.stringify(degradedMessage),
  ))

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runLiveGatherClassificationValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`\nLive gather classification validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
