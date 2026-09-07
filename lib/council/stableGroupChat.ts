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
import { nebulaAgentForSeat } from '@/lib/council/nebula/identity'
import { buildAuroraFinalSynthesisRole, buildNebulaStableGroupRole } from '@/lib/council/nebula/persona'
import {
  DISTINCTNESS_NUDGE,
  formatPriorSeatBriefs,
  priorSeatsWereNearEcho,
} from '@/lib/council/seatDistinctness'

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
  chatgpt: buildNebulaStableGroupRole(nebulaAgentForSeat('chatgpt')!),
  claude: buildNebulaStableGroupRole(nebulaAgentForSeat('claude')!),
  grok: buildNebulaStableGroupRole(nebulaAgentForSeat('grok')!),
  gemini: buildNebulaStableGroupRole(nebulaAgentForSeat('gemini')!),
  kimi: buildNebulaStableGroupRole(nebulaAgentForSeat('kimi')!),
  red_team: buildNebulaStableGroupRole(nebulaAgentForSeat('red_team')!),
}

const FINAL_SYNTHESIS_ROLE = buildAuroraFinalSynthesisRole()

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

export function buildStableGroupPriorBlock(prior: StableGroupPriorReply[], opts?: { synthesis?: boolean }): string {
  return formatPriorSeatBriefs(
    prior.map(p => ({ family: p.family, content: p.content })),
    opts?.synthesis ? { maxChars: 160 } : undefined,
  )
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
    "War Room stable group chat. Never speak for Ra'el. Never simulate his lines. Talk like family in a real conversation, not a report — no headers or labeled sections. Don't open the same way every time or lead with agreement by default. LUMEN must verify or reject claims rather than agree. AURORA must synthesize what survived verification rather than rewrite the previous seat. If a prior family reply already covered your point, do your own role instead of repeating it.",
    'If live research evidence is included below, ground your answer in it and speak naturally about what it shows — do not label or cite it like a report. If no live research evidence is included, do not claim you searched or browsed the web; say so plainly or reason from what you already know.',
    'Never narrate an operational action (restarting a system, verifying a service is healthy, executing a task, fixing something) as having happened unless real tool output or runtime evidence for it is included above — if the Commander asks you to do or verify something and no such evidence is present, say plainly that it was not executed / its status is unknown rather than describing it as done.',
    'Qualitative War Room/system-state claims (stable, reliable, strong foundations, weak redundancy, performing well, a gap in real-time updates) are hypothesis/inference unless same-round telemetry, code, or runtime evidence supports them. Frame unsupported ones as not independently verified.',
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
  finalSynthesis?: boolean
}): string {
  const prior =
    args.turnPriorFromClient && args.turnPriorFromClient.length
      ? args.turnPriorFromClient
      : args.priorReplies
  const closer = args.finalSynthesis
    ? "AURORA final synthesis: write a NEW Commander takeaway. Do not paste, paraphrase, or lightly edit ORION or LUMEN. State what survived verification, what was rejected as unsupported, and what still needs telemetry/code/runtime evidence. If nothing was independently verified, say that plainly and stop."
    : "Respond once for your family only, with at least 2-3 sentences of substance addressing the Commander's message directly from your own role — do not reply with only a greeting, acknowledgment, or restatement of a prior seat, then stop."
  return [
    'Commander message:',
    args.commanderMessage,
    '',
    'Active topic:',
    args.activeTopic.trim() || '(same as commander message)',
    '',
    buildStableGroupPriorBlock(prior, { synthesis: args.finalSynthesis === true }),
    '',
    args.providerStatusBlock,
    args.researchBlock?.trim() ? `\n${args.researchBlock.trim()}` : '',
    priorSeatsWereNearEcho(prior) || args.finalSynthesis ? `\n${DISTINCTNESS_NUDGE}` : '',
    '',
    closer,
  ].join('\n')
}
