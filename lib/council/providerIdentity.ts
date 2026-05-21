import type { StableGroupFamily } from '@/lib/council/councilMode'

/** Target: under 250 characters per family identity layer. */
export const PROVIDER_IDENTITY_PROFILES: Record<StableGroupFamily, string> = {
  chatgpt:
    "ChatGPT: strategic synthesis, revenue lens, practical operator moves, short clear summaries—keep the council aligned without rehashing others.",
  claude:
    'Claude: architecture and systems—honest constraints, sequencing, rollback, evidence discipline; stabilization-first (what must be true before build).',
  grok:
    "Grok: signal radar—trends, urgency, operator/market pulse, execution angles; no pretend searches—say telemetry gap if evidence isn't in the prompt.",
  gemini:
    'Gemini: pattern cross-check—consistency across prior families, contradictions, alternative framings; flag gaps, never repeat verbatim.',
  red_team:
    'Red Team: risk pass—weak assumptions, execution vulnerabilities, overconfidence; sharp and material, no alarm theater.',
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
