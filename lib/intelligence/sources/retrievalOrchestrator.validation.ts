import { buildRetrievalOrchestration, evaluateMandatoryLiveRetrieval } from './retrievalOrchestrator'
import { pathToFileURL } from 'node:url'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

// Phase 49-A-1: relocation/travel/logistics/real-world-planning language previously matched no
// `MandatoryRetrievalReason`, so `detectResearchIntent`'s mandatory-retrieval escalation path
// never fired for requests like "how can we get to Panama."

const panamaTravel = evaluateMandatoryLiveRetrieval('how can we get to Panama')
const relocateSomewhere = evaluateMandatoryLiveRetrieval('how can we relocate somewhere')
const visaRequirements = evaluateMandatoryLiveRetrieval('what are the visa requirements for moving to Portugal')

// Already-working reasons must remain unaffected (regression guard).
const weatherStillRequired = evaluateMandatoryLiveRetrieval('what is the weather forecast today')
const bareGreetingNotRequired = evaluateMandatoryLiveRetrieval('hello')
const freshRoundRuntimeHealthNotRequired = evaluateMandatoryLiveRetrieval(
  'Council, verify this is a fresh Council round and give me one sentence on current runtime health.',
)

// Requirement E — research-failure truthfulness: a qualifying request (relocation/travel) for
// which every provider fails must NOT produce a false success/live-verified state, must not
// allow synthesis, and must carry the existing truthful failure-disclosure message. This proves
// the already-built truthfulness mechanism in `buildRetrievalOrchestration` correctly covers the
// newly-recognized `relocation_planning` trigger — no new fabricated-evidence path was added.
const panamaRetrievalAllProvidersFailed = buildRetrievalOrchestration({
  decree: 'how can we get to Panama',
  generatedAt: new Date().toISOString(),
  tavilyOk: false,
  grokOk: false,
  directOk: false,
})

// A qualifying request that succeeds at at least one provider is allowed to synthesize — proves
// the failure case above isn't a blanket "always fails," only a truthful one.
const panamaRetrievalOneProviderSucceeded = buildRetrievalOrchestration({
  decree: 'how can we get to Panama',
  generatedAt: new Date().toISOString(),
  tavilyOk: true,
  grokOk: false,
  directOk: false,
})

// "help plan our move" previously missed every mandatory-retrieval reason (false negative).
const helpPlanOurMove = evaluateMandatoryLiveRetrieval('help plan our move')

// Confirmed false positives from an independent review, and the emigrated/\w*-suffix
// inconsistency between this file and lib/research/researchIntent.ts specifically: "our
// fictional character emigrated" previously matched here (via a looser `emigrat\w*`) while the
// narrower researchIntent.ts pattern correctly excluded it — now aligned.
const relocateFunctionNotRequired = evaluateMandatoryLiveRetrieval('relocate this function into another file')
const immigrationMetaNotRequired = evaluateMandatoryLiveRetrieval('immigration is a word in this document')
const fictionalEmigratedNotRequired = evaluateMandatoryLiveRetrieval('our fictional character emigrated')
const travelPlanningRegexNotRequired = evaluateMandatoryLiveRetrieval('test the travel planning regex')
const relocationVariableNotRequired = evaluateMandatoryLiveRetrieval('update the relocation variable name')

export function runRetrievalOrchestratorValidation(): CaseResult[] {
  return [
    check(
      'retrieval_orchestrator_01_panama_travel_marks_relocation_planning_required',
      panamaTravel.required && panamaTravel.reasons.includes('relocation_planning'),
      JSON.stringify(panamaTravel),
    ),
    check(
      'retrieval_orchestrator_02_relocate_somewhere_marks_relocation_planning_required',
      relocateSomewhere.required && relocateSomewhere.reasons.includes('relocation_planning'),
      JSON.stringify(relocateSomewhere),
    ),
    check(
      'retrieval_orchestrator_03_visa_requirements_marks_relocation_planning_required',
      visaRequirements.required && visaRequirements.reasons.includes('relocation_planning'),
      JSON.stringify(visaRequirements),
    ),
    check(
      'retrieval_orchestrator_04_weather_still_required_unaffected',
      weatherStillRequired.required && weatherStillRequired.reasons.includes('weather'),
      JSON.stringify(weatherStillRequired),
    ),
    check(
      'retrieval_orchestrator_05_bare_greeting_not_required',
      !bareGreetingNotRequired.required,
      JSON.stringify(bareGreetingNotRequired),
    ),
    check(
      'retrieval_orchestrator_05b_fresh_round_runtime_health_not_required',
      !freshRoundRuntimeHealthNotRequired.required,
      JSON.stringify(freshRoundRuntimeHealthNotRequired),
    ),
    check(
      'retrieval_orchestrator_06_failed_relocation_retrieval_not_falsely_successful',
      panamaRetrievalAllProvidersFailed.required === true
        && panamaRetrievalAllProvidersFailed.retrieval_failed === true
        && panamaRetrievalAllProvidersFailed.synthesis_allowed === false
        && panamaRetrievalAllProvidersFailed.retrieval_gaps.some(g => g.includes('must disclose failure')),
      JSON.stringify({
        required: panamaRetrievalAllProvidersFailed.required,
        retrieval_failed: panamaRetrievalAllProvidersFailed.retrieval_failed,
        synthesis_allowed: panamaRetrievalAllProvidersFailed.synthesis_allowed,
        gaps: panamaRetrievalAllProvidersFailed.retrieval_gaps,
      }),
    ),
    check(
      'retrieval_orchestrator_07_successful_relocation_retrieval_allows_synthesis',
      panamaRetrievalOneProviderSucceeded.retrieval_failed === false
        && panamaRetrievalOneProviderSucceeded.synthesis_allowed === true,
      JSON.stringify({
        retrieval_failed: panamaRetrievalOneProviderSucceeded.retrieval_failed,
        synthesis_allowed: panamaRetrievalOneProviderSucceeded.synthesis_allowed,
      }),
    ),
    check(
      'retrieval_orchestrator_08_help_plan_our_move_marks_relocation_planning_required',
      helpPlanOurMove.required && helpPlanOurMove.reasons.includes('relocation_planning'),
      JSON.stringify(helpPlanOurMove),
    ),
    check(
      'retrieval_orchestrator_09a_relocate_function_code_discussion_not_required',
      !relocateFunctionNotRequired.required,
      JSON.stringify(relocateFunctionNotRequired),
    ),
    check(
      'retrieval_orchestrator_09b_immigration_meta_discussion_not_required',
      !immigrationMetaNotRequired.required,
      JSON.stringify(immigrationMetaNotRequired),
    ),
    check(
      'retrieval_orchestrator_09c_fictional_emigrated_not_required',
      !fictionalEmigratedNotRequired.required,
      JSON.stringify(fictionalEmigratedNotRequired),
    ),
    check(
      'retrieval_orchestrator_09d_travel_planning_regex_discussion_not_required',
      !travelPlanningRegexNotRequired.required,
      JSON.stringify(travelPlanningRegexNotRequired),
    ),
    check(
      'retrieval_orchestrator_09e_relocation_variable_name_not_required',
      !relocationVariableNotRequired.required,
      JSON.stringify(relocationVariableNotRequired),
    ),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runRetrievalOrchestratorValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Retrieval orchestrator validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
