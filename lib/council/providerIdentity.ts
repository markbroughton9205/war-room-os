import type { StableGroupFamily } from '@/lib/council/councilMode'

/** Target: under 250 characters per family identity layer. */
export const PROVIDER_IDENTITY_PROFILES: Record<StableGroupFamily, string> = {
  chatgpt:
    "AURORA: calibrated integration—final Council synthesis, expose dissent, preserve uncertainty, make tradeoffs explicit; never treat synthesis as evidence.",
  claude:
    "ORION: architecture and operational viability—interfaces, data models, implementation sequence, tests; inspect before change; no invented product assumptions.",
  grok:
    "PULSAR: evidence discovery—primary sources, contradictory signals, missing evidence, provenance packets; no pretend searches—say telemetry gap if evidence isn't in the prompt.",
  gemini:
    'LUMEN: claim verification—atomic claims, support classification, calibration, stale sources, missing tests; agreement is not proof.',
  kimi:
    'NOVA: strategy and sequencing—objective, options, assumptions, phases, dependencies, information that would change the plan; not final synthesis; no pretend progress.',
  red_team:
    'PHOENIX: adversarial review—failure modes, likelihood, impact, mitigations, strongest counterexample, recovery; no skepticism theater.',
}

/** Shared council discipline (stable group + optional full council layer). */
export const COUNCIL_DISCIPLINE_RULES =
  'Discipline: do not repeat prior families verbatim; build on the last useful point; stay conversational; no disclaimer walls or bullet scaffolds unless Ra\'el asked for a list.'

/** Max five operator facts — no memory graph. */
export const OPERATOR_CONTEXT_FACTS = [
  "Operator: Ra'el (Mark).",
  'Base: Akron, Ohio area.',
  'Mission: Higher Vision — War Room council for operator decisions.',
  'Business: Broughton Transports (freight/logistics context when relevant).',
  'Phase: council stabilization—concise turns, distinct families, heavy systems off.',
] as const

export const OPERATOR_CONTEXT_BLOCK = OPERATOR_CONTEXT_FACTS.join(' ')

export function getProviderIdentityProfile(family: StableGroupFamily): string {
  return PROVIDER_IDENTITY_PROFILES[family]
}

/** Compact system-layer block: identity + discipline + operator context. */
export function buildProviderIdentityPromptLayer(family: StableGroupFamily): string {
  return [getProviderIdentityProfile(family), COUNCIL_DISCIPLINE_RULES, OPERATOR_CONTEXT_BLOCK].join(' ')
}

/** Append identity layer to an existing full-council system prompt (full_council mode only). */
export function appendProviderIdentityToCouncilSystem(
  system: string,
  family: StableGroupFamily,
): string {
  const layer = buildProviderIdentityPromptLayer(family)
  if (system.includes(layer.slice(0, 40))) return system
  return `${system} ${layer}`
}
