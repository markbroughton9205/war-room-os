import { pathToFileURL } from 'node:url'
import {
  buildGreetingSystemPrompt,
  buildStableGroupGreetingUserPrompt,
  GREETING_META_BY_FAMILY,
  STABLE_GROUP_GREETING_META,
} from './greetingPrompt'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

// Distinctive substrings that only appear if RAEL_PROFILE / OPERATOR_CONTEXT_FACTS content was
// actually interpolated into the prompt — deliberately NOT generic words like "relocation" or
// "mission", since those legitimately appear inside the prompt's own prohibition instruction
// ("Do not mention Ra'el's profile, mission, or relocation goals.") and would false-positive.
const FORBIDDEN_INJECTED_CONTENT = [
  'goal: panama relocation',
  'panama relocation.',
  'generational wealth',
  'nation of islam',
  'ruah patent',
  'broughton transports llc',
  'seven children',
  'higher vision — war room',
  'base: akron',
]

function containsAny(haystack: string, terms: string[]): string | null {
  const lower = haystack.toLowerCase()
  return terms.find(term => lower.includes(term)) ?? null
}

// 1 & 2 & 3. A bare-hello system prompt never receives RAEL_PROFILE / Panama / relocation
// strategy content — it's built from (label, roleShort, knownState) only, with no profile
// argument to accept it in the first place. Assert the generated text is clean across the full
// non-stable-group family roster and the stable-group roster.
const gptGreeting = buildGreetingSystemPrompt(
  GREETING_META_BY_FAMILY.chatgpt.label,
  GREETING_META_BY_FAMILY.chatgpt.roleShort,
  'READY',
)
const gptGreetingClean = containsAny(gptGreeting, FORBIDDEN_INJECTED_CONTENT) === null

const allFamilyGreetingsClean = (Object.keys(GREETING_META_BY_FAMILY) as (keyof typeof GREETING_META_BY_FAMILY)[]).every(family => {
  const meta = GREETING_META_BY_FAMILY[family]
  const prompt = buildGreetingSystemPrompt(meta.label, meta.roleShort, undefined)
  return containsAny(prompt, FORBIDDEN_INJECTED_CONTENT) === null
})

const stableGroupGreetingsClean = (Object.keys(STABLE_GROUP_GREETING_META) as (keyof typeof STABLE_GROUP_GREETING_META)[]).every(family => {
  const meta = STABLE_GROUP_GREETING_META[family]
  const prompt = buildGreetingSystemPrompt(meta.label, meta.roleShort, 'READY')
  return containsAny(prompt, FORBIDDEN_INJECTED_CONTENT) === null
})

// The greeting prompt must also explicitly instruct the model not to bring up profile/mission/
// location content, as a second line of defense beyond simply omitting the data.
const explicitlyForbidsProfileMissionLocation =
  gptGreeting.includes('Do not propose plans, strategies, missions, or locations.')
  && gptGreeting.includes("Do not mention Ra'el's profile, mission, or relocation goals.")

// 4. A bare-hello stable-group user prompt never receives prior thread/topic context — it takes
// only the commander's current message text, with no `activeTopic`/`priorReplies`/
// `providerStatusBlock` parameters to carry stale context through.
const staleTopicText = 'Following up on the Panama relocation and freight contract pricing from last week.'
const stableGreetingUserPrompt = buildStableGroupGreetingUserPrompt('hello council')
const stableGreetingPromptCleanOfStaleTopic = !stableGreetingUserPrompt.toLowerCase().includes(staleTopicText.toLowerCase())
  && containsAny(stableGreetingUserPrompt, FORBIDDEN_INJECTED_CONTENT) === null

// The dedicated stable-group greeting prompt must not carry the normal builder's "give 2-3
// sentences of substance" instruction, which is what forced fabricated content in the first
// place — and must explicitly instruct brevity instead.
const doesNotForceSubstance = !stableGreetingUserPrompt.includes('at least 2-3 sentences of substance')
const instructsBriefStatusOnly = stableGreetingUserPrompt.includes('brief greeting and your current status/availability only')

// 5 & 6. Each greeting states the family's *actual* current status — a known runtime state is
// echoed truthfully, and an unavailable/unknown state must not be reworded into a false claim of
// connection. buildGreetingSystemPrompt itself never fabricates "connected" for an unknown state
// — it falls back to a generic "currently able to respond" framing only when no status was
// supplied by the caller (i.e., the caller/execute.ts is responsible for passing the real state;
// this asserts the pure function faithfully reflects whatever state it's given, verbatim, rather
// than normalizing every case to "connected").
const knownStateEchoedTruthfully = buildGreetingSystemPrompt('Kimi Family', 'task decomposition', 'DEGRADED')
  .includes('Your reported runtime status this session is "DEGRADED"')
const unknownStateNotClaimedConnected = !buildGreetingSystemPrompt('Kimi Family', 'task decomposition', undefined)
  .toLowerCase()
  .includes('connected')

// 7. Substantive (non-greeting) requests are unaffected — this module only ever produces the
// greeting-shaped prompt; it takes no branch that could accidentally fire for a real decree. The
// actual branch condition (`isLightweightPingDecree`) is covered by contextRelevance.validation.ts;
// this asserts the greeting prompt text itself is always scoped as a greeting reply, never framed
// as a general-purpose response, so callers can't misuse it for substantive turns.
const greetingPromptSelfDescribesAsGreetingOnly = gptGreeting.includes('bare greeting or status check with no substantive request')

export function runGreetingPromptValidation(): CaseResult[] {
  return [
    check('greeting_01_gpt_greeting_excludes_panama_relocation', gptGreetingClean, gptGreeting),
    check('greeting_02_all_family_greetings_clean_of_forbidden_terms', allFamilyGreetingsClean, String(allFamilyGreetingsClean)),
    check('greeting_03_stable_group_family_greetings_clean_of_forbidden_terms', stableGroupGreetingsClean, String(stableGroupGreetingsClean)),
    check('greeting_04_explicitly_forbids_plans_missions_locations_profile', explicitlyForbidsProfileMissionLocation, String(explicitlyForbidsProfileMissionLocation)),
    check('greeting_05_stable_group_user_prompt_excludes_stale_topic', stableGreetingPromptCleanOfStaleTopic, stableGreetingUserPrompt),
    check('greeting_06_stable_group_user_prompt_does_not_force_substance', doesNotForceSubstance, String(doesNotForceSubstance)),
    check('greeting_07_stable_group_user_prompt_instructs_brief_status_only', instructsBriefStatusOnly, String(instructsBriefStatusOnly)),
    check('greeting_08_known_runtime_status_echoed_truthfully', knownStateEchoedTruthfully, String(knownStateEchoedTruthfully)),
    check('greeting_09_unknown_status_not_reworded_as_connected', unknownStateNotClaimedConnected, String(unknownStateNotClaimedConnected)),
    check('greeting_10_prompt_self_scoped_to_greeting_only', greetingPromptSelfDescribesAsGreetingOnly, String(greetingPromptSelfDescribesAsGreetingOnly)),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runGreetingPromptValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Greeting prompt validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
