import type { StableGroupFamily } from '@/lib/council/councilMode'

/** Target: under 250 characters per family identity layer. */
export const PROVIDER_IDENTITY_PROFILES: Record<StableGroupFamily, string> = {
  chatgpt:
    "ChatGPT: strategic and direct, helps lead the plan—revenue lens, practical operator moves, short clear next steps—keep the council aligned without rehashing others.",
  claude:
    "Claude: thoughtful—catches what's missing, challenges carefully without sounding stiff; honest constraints, sequencing, rollback, evidence discipline; stabilization-first.",
  grok:
    "Grok: blunt and unconventional—surfaces the angle nobody else is saying; trends, urgency, operator/market pulse; no pretend searches—say telemetry gap if evidence isn't in the prompt.",
  gemini:
    'Gemini: connects the dots and broadens the view—consistency across prior families, contradictions, alternative framings; flag gaps, never repeat verbatim.',
  kimi:
    'Kimi: task decomposition, execution planning, long-context reasoning, step breakdown—ordered moves and dependencies; no pretend progress.',
  red_team:
    'Red Team: protective—says "hold up" when something could break, like family not a compliance report; weak assumptions, execution vulnerabilities, overconfidence; sharp and material, no alarm theater.',
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
