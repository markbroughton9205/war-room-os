import { detectResearchIntent } from './researchIntent'
import { pathToFileURL } from 'node:url'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

// Phase 49-A-1: real-world planning/relocation/logistics requests previously matched zero
// trigger families and silently fell through to pure model judgment with no live grounding.

// 1. The Commander's own example — previously matched nothing.
const panamaTravelTriggers = detectResearchIntent('how can we get to Panama', { intentKind: 'business_ops' })

// 2. Relocation planning phrased generically.
const relocateSomewhereTriggers = detectResearchIntent('how can we relocate somewhere', { intentKind: 'business_ops' })

// 3. Travel/visa/logistics vocabulary.
const travelLogisticsTriggers = detectResearchIntent('what are the visa requirements for moving to Portugal', {
  intentKind: 'natural',
})

// 4. Already-working current-event phrasing must remain unaffected (regression guard).
const whatHappenedThisWeekTriggers = detectResearchIntent('what happened this week', { intentKind: 'natural' })

// 5. Bare greetings/test-pings must NOT trigger research — regression guard for the exact
// inputs named in the Commander's authorization.
const helloNoResearch = detectResearchIntent('hello', { intentKind: 'greeting' })
const hiCouncilNoResearch = detectResearchIntent('hi council', { intentKind: 'greeting' })
const quickCheckInNoResearch = detectResearchIntent('quick check in', { intentKind: 'natural' })
const statusCheckNoResearch = detectResearchIntent('status check', { intentKind: 'natural' })
const freshRoundRuntimeHealthNoResearch = detectResearchIntent(
  'Council, verify this is a fresh Council round and give me one sentence on current runtime health.',
  { intentKind: 'natural' },
)

// 6. Commander adversarial case 9: a "status check" elaborated with a real current-information
// ask (Panama visa requirements) must trigger research — a bare ping does not, but this is not
// bare.
const statusCheckOnPanamaVisaTriggers = detectResearchIntent('status check on current Panama visa requirements', {
  intentKind: 'business_ops',
})

// 7. Excluded flows stay excluded (attendance/diagnostic/decree-soft) — regression guard.
const attendanceFlowExcluded = detectResearchIntent('roll call', { attendanceFlow: true })

// 8. "help plan our move" previously missed every trigger family (false negative confirmed by
// an independent review against this exact phrasing).
const helpPlanOurMoveTriggers = detectResearchIntent('help plan our move', { intentKind: 'natural' })

// 9. Confirmed false positives from an independent review — developer/code-discussion messages
// that merely contain a relocation-shaped word must NOT be classified as real-world planning
// requests. Each of these previously returned shouldResearch:true before the
// PLANNING_CODE_OR_META_CONTEXT exclusion was added.
const relocateFunctionNoResearch = detectResearchIntent('relocate this function into another file', {
  intentKind: 'natural',
})
const immigrationMetaNoResearch = detectResearchIntent('immigration is a word in this document', {
  intentKind: 'natural',
})
const fictionalEmigratedNoResearch = detectResearchIntent('our fictional character emigrated', {
  intentKind: 'natural',
})
const travelPlanningRegexNoResearch = detectResearchIntent('test the travel planning regex', {
  intentKind: 'natural',
})
const relocationVariableNoResearch = detectResearchIntent('update the relocation variable name', {
  intentKind: 'natural',
})

// 10. Natural world-state questions must retrieve live evidence even without an explicit
// "search", "latest", or "today" instruction. Includes the Commander's exact phrasing/typo.
const worldUpToTriggers = detectResearchIntent('whats the world up too', { intentKind: 'natural' })
const economyStateTriggers = detectResearchIntent('how is the economy doing', { intentKind: 'natural' })

// 11. RSS-fallback build phase (Phase 49-J): the intent gate must stay word-boundary-only, never
// naive substring matching. "what's the world up to" (apostrophe form) is the exact acceptance
// case from that build request; "can you explain what he said about the deal" is the regression
// guard for the substring bug it called out (a naive .includes("ai") match inside "said" would
// wrongly trigger research here — this codebase's WORLD_STATE_TRIGGERS/DOMAIN_TRIGGERS/etc. are
// already \b-bounded regexes, never .includes(), so this must stay false).
const worldUpToApostropheTriggers = detectResearchIntent("what's the world up to", { intentKind: 'natural' })
const explainWhatHeSaidNoResearch = detectResearchIntent('can you explain what he said about the deal', { intentKind: 'natural' })
const worldGoingOnWithWorld = detectResearchIntent("Council, what's going on with the world?", { intentKind: 'natural' })
const heyCouncilNoResearchFast = detectResearchIntent('Hey council', { intentKind: 'greeting' })
const quickStatusPingNoResearch = detectResearchIntent('Quick status ping', { intentKind: 'natural' })

export function runResearchIntentValidation(): CaseResult[] {
  return [
    check(
      'research_intent_01_panama_travel_planning_triggers_research',
      panamaTravelTriggers.shouldResearch,
      JSON.stringify(panamaTravelTriggers),
    ),
    check(
      'research_intent_02_relocate_somewhere_triggers_research',
      relocateSomewhereTriggers.shouldResearch,
      JSON.stringify(relocateSomewhereTriggers),
    ),
    check(
      'research_intent_03_travel_visa_logistics_triggers_research',
      travelLogisticsTriggers.shouldResearch,
      JSON.stringify(travelLogisticsTriggers),
    ),
    check(
      'research_intent_04_what_happened_this_week_still_triggers',
      whatHappenedThisWeekTriggers.shouldResearch,
      JSON.stringify(whatHappenedThisWeekTriggers),
    ),
    check('research_intent_05a_hello_does_not_trigger_research', !helloNoResearch.shouldResearch, JSON.stringify(helloNoResearch)),
    check(
      'research_intent_05b_hi_council_does_not_trigger_research',
      !hiCouncilNoResearch.shouldResearch,
      JSON.stringify(hiCouncilNoResearch),
    ),
    check(
      'research_intent_05c_quick_check_in_does_not_trigger_research',
      !quickCheckInNoResearch.shouldResearch,
      JSON.stringify(quickCheckInNoResearch),
    ),
    check(
      'research_intent_05d_bare_status_check_does_not_trigger_research',
      !statusCheckNoResearch.shouldResearch,
      JSON.stringify(statusCheckNoResearch),
    ),
    check(
      'research_intent_05e_fresh_round_runtime_health_does_not_trigger_research',
      !freshRoundRuntimeHealthNoResearch.shouldResearch,
      JSON.stringify(freshRoundRuntimeHealthNoResearch),
    ),
    check(
      'research_intent_06_status_check_on_panama_visa_triggers_research',
      statusCheckOnPanamaVisaTriggers.shouldResearch,
      JSON.stringify(statusCheckOnPanamaVisaTriggers),
    ),
    check(
      'research_intent_07_attendance_flow_excluded',
      !attendanceFlowExcluded.shouldResearch,
      JSON.stringify(attendanceFlowExcluded),
    ),
    check(
      'research_intent_08_help_plan_our_move_triggers_research',
      helpPlanOurMoveTriggers.shouldResearch,
      JSON.stringify(helpPlanOurMoveTriggers),
    ),
    check(
      'research_intent_09a_relocate_function_code_discussion_no_research',
      !relocateFunctionNoResearch.shouldResearch,
      JSON.stringify(relocateFunctionNoResearch),
    ),
    check(
      'research_intent_09b_immigration_meta_discussion_no_research',
      !immigrationMetaNoResearch.shouldResearch,
      JSON.stringify(immigrationMetaNoResearch),
    ),
    check(
      'research_intent_09c_fictional_emigrated_no_research',
      !fictionalEmigratedNoResearch.shouldResearch,
      JSON.stringify(fictionalEmigratedNoResearch),
    ),
    check(
      'research_intent_09d_travel_planning_regex_discussion_no_research',
      !travelPlanningRegexNoResearch.shouldResearch,
      JSON.stringify(travelPlanningRegexNoResearch),
    ),
    check(
      'research_intent_09e_relocation_variable_name_no_research',
      !relocationVariableNoResearch.shouldResearch,
      JSON.stringify(relocationVariableNoResearch),
    ),
    check(
      'research_intent_10a_world_up_to_triggers_live_research',
      worldUpToTriggers.shouldResearch,
      JSON.stringify(worldUpToTriggers),
    ),
    check(
      'research_intent_10b_economy_state_triggers_live_research',
      economyStateTriggers.shouldResearch,
      JSON.stringify(economyStateTriggers),
    ),
    check(
      'research_intent_11a_world_up_to_apostrophe_form_triggers_research',
      worldUpToApostropheTriggers.shouldResearch,
      JSON.stringify(worldUpToApostropheTriggers),
    ),
    check(
      'research_intent_11b_explain_what_he_said_no_research_substring_regression_guard',
      !explainWhatHeSaidNoResearch.shouldResearch,
      JSON.stringify(explainWhatHeSaidNoResearch),
    ),
    check(
      'research_intent_12_world_going_on_with_the_world_triggers',
      worldGoingOnWithWorld.shouldResearch,
      JSON.stringify(worldGoingOnWithWorld),
    ),
    check(
      'research_intent_13_hey_council_no_research',
      !heyCouncilNoResearchFast.shouldResearch,
      JSON.stringify(heyCouncilNoResearchFast),
    ),
    check(
      'research_intent_14_quick_status_ping_no_research',
      !quickStatusPingNoResearch.shouldResearch,
      JSON.stringify(quickStatusPingNoResearch),
    ),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runResearchIntentValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Research intent validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
