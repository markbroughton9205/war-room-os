import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import {
  STABLE_GROUP_FAMILY_ORDER,
  type StableGroupFamily,
} from '@/lib/council/councilMode'
import {
  buildProviderIdentityPromptLayer,
} from '@/lib/council/providerIdentity'
import {
  estimateTextTokens,
  STABLE_GROUP_PROMPT_TOKEN_CEILING,
} from '@/lib/council/providerTokenDiagnostics'

export { STABLE_GROUP_PROMPT_TOKEN_CEILING }

export type StableGroupPriorReply = {
  family: string
  content: string
}

export type StableGroupThreadEntry = {
  sender: string
  content: string
}

const SENTENCE_LIMIT =
  'Reply in plain language. Maximum 4–6 sentences. No bullet scaffolds unless Ra\'el asked for a list.'

const ROLE_BY_FAMILY: Record<StableGroupFamily, string> = {
  chatgpt:
    "You are ChatGPT Family — strategic and direct, the one helping lead the plan: restate Ra'el's point simply, then add the one useful angle that organizes the next move. Talk like you're leading, not filing a report.",
  claude:
    "You are Claude Family — thoughtful: catch what might be missing and raise it carefully, without sounding stiff. Add the constraint or sequencing point that actually changes the plan.",
  grok:
    "You are Grok Family — blunt and unconventional: say the angle nobody else is bringing up. External volatility or contradiction only when evidence is in the prompt; otherwise say telemetry gap, plainly, like you're just being straight with the room.",
  gemini:
    "You are Gemini Family — connect the dots: show how prior family lines fit together or where they don't, broadening the picture rather than repeating it. Respond with at least 2-3 sentences addressing the Commander's message directly — do not reply with only a greeting or acknowledgment.",
  kimi:
    'You are Kimi Family — decompose Ra\'el\'s ask into ordered steps, dependencies, and execution checks; stay practical and concise.',
  red_team:
    'You are Red Team — the protective one: say "hold up" when something could break, in one sharp, natural pass — material risks, overconfidence, or missing evidence. Sound like family looking out for Ra\'el, not a compliance report. No theatrical alarmism.',
}

const FINAL_SYNTHESIS_ROLE =
  "You are ChatGPT Family — optional closing synthesis: one short, natural paragraph weaving what the family already said; no new topics, no report structure."

export function isStableGroupFamily(family: string): family is StableGroupFamily {
  return (STABLE_GROUP_FAMILY_ORDER as readonly string[]).includes(family)
}

/** Last two non-commander family responses from thread history. */
export function extractLastTwoFamilyReplies(
  threadHistory: unknown,
  commanderLabel = "Ra'el",
): StableGroupPriorReply[] {
  if (!Array.isArray(threadHistory)) return []
  const rows = threadHistory as StableGroupThreadEntry[]
  const out: StableGroupPriorReply[] = []
  for (let i = rows.length - 1; i >= 0 && out.length < 2; i--) {
    const row = rows[i]
    if (!row?.sender || !row?.content?.trim()) continue
    if (row.sender === commanderLabel || /ra['']?el/i.test(row.sender)) continue
    out.push({ family: row.sender, content: row.content.trim() })
  }
  return out.reverse()
}

export function formatProviderStatusBlock(
  states: Partial<Record<CouncilOrchestrationFamily, string>> | undefined,
): string {
  if (!states || !Object.keys(states).length) return 'Provider status: not supplied (assume available unless this turn fails).'
  const lines = Object.entries(states)
    .map(([f, s]) => `- ${f}: ${s}`)
    .slice(0, 8)
  return ['Provider status (basic):', ...lines].join('\n')
}

export function buildStableGroupPriorBlock(prior: StableGroupPriorReply[]): string {
  if (!prior.length) return 'Prior family replies this turn: (none yet — you speak first after Ra\'el).'
  return [
    'Prior family replies this turn (build on these; do not repeat verbatim):',
    ...prior.map(p => `${p.family}: ${p.content}`),
  ].join('\n')
}

/**
 * Trim oldest prior family replies until prompt estimate is under ceiling.
 * Commander message and active topic are never trimmed.
 */
export function trimStableGroupPriorForCeiling(args: {
  prior: StableGroupPriorReply[]
  commanderMessage: string
  activeTopic: string
  providerStatusBlock: string
  systemPrompt: string
  ceiling?: number
}): { prior: StableGroupPriorReply[]; trimmed: boolean; estimatedPromptTokens: number } {
  const ceiling = args.ceiling ?? STABLE_GROUP_PROMPT_TOKEN_CEILING
  const trimmedPrior = [...args.prior]
  let trimmed = false

  const estimate = (prior: StableGroupPriorReply[]) =>
    estimateTextTokens(
      [
        args.systemPrompt,
        buildStableGroupUserPrompt({
          commanderMessage: args.commanderMessage,
          activeTopic: args.activeTopic,
          priorReplies: prior,
          providerStatusBlock: args.providerStatusBlock,
        }),
      ].join('\n'),
    )

  let estimatedPromptTokens = estimate(trimmedPrior)
  while (estimatedPromptTokens > ceiling && trimmedPrior.length > 0) {
    trimmedPrior.shift()
    trimmed = true
    estimatedPromptTokens = estimate(trimmedPrior)
  }

  return { prior: trimmedPrior, trimmed, estimatedPromptTokens }
}

export function buildStableGroupSystemPrompt(args: {
  family: StableGroupFamily
  toneInstruction: string
  finalSynthesis?: boolean
}): string {
  const role = args.finalSynthesis ? FINAL_SYNTHESIS_ROLE : ROLE_BY_FAMILY[args.family]
  const identity = buildProviderIdentityPromptLayer(
    args.finalSynthesis ? 'chatgpt' : args.family,
  )
  return [
    role,
    identity,
    "War Room stable group chat. Never speak for Ra'el. Never simulate his lines. Talk like family in a real conversation, not a report — no headers or labeled sections. Don't open the same way every time or lead with agreement by default; if a prior family reply already covered your point, build on it or say something new instead of repeating it.",
    'If live research evidence is included below, ground your answer in it and speak naturally about what it shows — do not label or cite it like a report. If no live research evidence is included, do not claim you searched or browsed the web; say so plainly or reason from what you already know.',
    SENTENCE_LIMIT,
    args.toneInstruction,
  ].join(' ')
}

export function buildStableGroupUserPrompt(args: {
  commanderMessage: string
  activeTopic: string
  priorReplies: StableGroupPriorReply[]
  providerStatusBlock: string
  turnPriorFromClient?: StableGroupPriorReply[]
  /** Live research grounding block (already includes its own success/partial/unavailable
   * framing) — Stable Group previously dropped this entirely, so no family ever saw it. */
  researchBlock?: string
}): string {
  const prior =
    args.turnPriorFromClient && args.turnPriorFromClient.length
      ? args.turnPriorFromClient
      : args.priorReplies
  return [
    'Commander message:',
    args.commanderMessage,
    '',
    'Active topic:',
    args.activeTopic.trim() || '(same as commander message)',
    '',
    buildStableGroupPriorBlock(prior),
    '',
    args.providerStatusBlock,
    args.researchBlock?.trim() ? `\n${args.researchBlock.trim()}` : '',
    '',
    "Respond once for your family only, with at least 2-3 sentences of substance addressing the Commander's message directly — do not reply with only a greeting or acknowledgment, then stop.",
  ].join('\n')
}
