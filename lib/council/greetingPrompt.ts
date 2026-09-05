import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { STABLE_GROUP_FAMILY_ORDER } from '@/lib/council/councilMode'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'

/**
 * Phase 49 preview correction (2026-08-05): a bare greeting/status ping ("hello", "hello
 * council", "checking in") must get a brief greeting + truthful status/availability, not the
 * full persona/role prompt or the Stable Group "give at least 2-3 sentences of substance"
 * instruction — both of those independently caused models to fabricate mission/strategy content
 * (including Ra'el's real RAEL_PROFILE "Goal: Panama relocation" fact, and separately the
 * Stable Group OPERATOR_CONTEXT_FACTS "Mission: Higher Vision" fact) when a decree carried no
 * topic of its own. Extracted here (out of app/api/chat/execute.ts) so it's unit-testable
 * without needing a live request/response cycle.
 */
export function buildGreetingSystemPrompt(
  label: string,
  roleShort: string,
  knownState: ProviderFamilyOutcomeStatus | undefined,
): string {
  const statusFact = knownState
    ? `Your reported runtime status this session is "${knownState}" — state that truthfully as part of your greeting, in your own words.`
    : 'You are currently able to respond, so state that you are available.'
  return `You are ${label} in Ra'el's War Room. This decree is a bare greeting or status check with no substantive request. Respond in one or two short sentences only: greet Ra'el, then state your status and availability/function (${roleShort}). ${statusFact} Do not propose plans, strategies, missions, or locations. Do not continue any prior topic. Do not mention Ra'el's profile, mission, or relocation goals. Stay role-distinct. Do not produce a Decision Summary or live-signal analysis.`
}

export type GreetingPromptMeta = { label: string; roleShort: string }

/** Non-stable-group (Direct / Full Council) family labels — matches each family's full persona prompt. */
export const GREETING_META_BY_FAMILY: Record<CouncilOrchestrationFamily, GreetingPromptMeta> = {
  chatgpt: { label: 'AURORA', roleShort: 'calibrated integration and final Council synthesis' },
  claude: { label: 'ORION', roleShort: 'architecture and operational viability' },
  grok: { label: 'PULSAR', roleShort: 'evidence discovery and signals' },
  gemini: { label: 'LUMEN', roleShort: 'claim verification and calibration' },
  kimi: { label: 'NOVA', roleShort: 'strategy, options, and sequencing' },
  red_team: { label: 'PHOENIX', roleShort: 'adversarial review and recovery' },
  baby: { label: 'Baby AI', roleShort: 'observational council witness' },
  // Always short-circuited to "currently unavailable" in execute.ts's callCouncilProvider
  // before any system prompt is built — entry exists only to satisfy the Record type.
  bridge_architect: { label: 'Bridge Architect', roleShort: 'unavailable' },
}

/** Stable Group's family roster is a subset (no 'baby') — reuse the same meta by key. */
export const STABLE_GROUP_GREETING_META: Record<(typeof STABLE_GROUP_FAMILY_ORDER)[number], GreetingPromptMeta> =
  Object.fromEntries(
    STABLE_GROUP_FAMILY_ORDER.map(family => [family, GREETING_META_BY_FAMILY[family]]),
  ) as Record<(typeof STABLE_GROUP_FAMILY_ORDER)[number], GreetingPromptMeta>

/**
 * Stable Group's normal `buildStableGroupUserPrompt` ends with "do not reply with only a
 * greeting or acknowledgment, then stop" — the opposite of what a lightweight greeting needs.
 * This dedicated prompt replaces it entirely for that case; it deliberately omits `activeTopic`,
 * prior replies, and the operator identity/status blocks that the normal builder always includes.
 */
export function buildStableGroupGreetingUserPrompt(commanderMessage: string): string {
  return [
    'Commander message:',
    commanderMessage,
    '',
    'This is a bare greeting or status check with no substantive request.',
    'Respond once for your family only, with a brief greeting and your current status/availability only.',
    'Do not add plans, strategy, missions, locations, or unrelated topics. Do not resurrect prior conversation subjects.',
  ].join('\n')
}
