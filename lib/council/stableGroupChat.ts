import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import {
  STABLE_GROUP_FAMILY_ORDER,
  type StableGroupFamily,
} from '@/lib/council/councilMode'

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
    'You are ChatGPT Family — open with plain synthesis: restate Ra\'el\'s point simply and add one useful angle.',
  claude:
    'You are Claude Family — add structure: clarify constraints, sequencing, and what would need to be true.',
  grok:
    'You are Grok Family — add a signal angle: external volatility or contradiction only when evidence is in the prompt; otherwise say telemetry gap.',
  gemini:
    'You are Gemini Family — cross-check prior family lines for consistency; flag gaps without repeating them.',
  red_team:
    'You are Red Team — name material risks, overconfidence, or missing evidence in one sharp pass. No theatrical alarmism.',
}

const FINAL_SYNTHESIS_ROLE =
  'You are ChatGPT Family — optional closing synthesis: one short paragraph weaving prior families; no new topics.'

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

export function buildStableGroupSystemPrompt(args: {
  family: StableGroupFamily
  toneInstruction: string
  finalSynthesis?: boolean
}): string {
  const role = args.finalSynthesis ? FINAL_SYNTHESIS_ROLE : ROLE_BY_FAMILY[args.family]
  return [
    role,
    "War Room stable group chat. Never speak for Ra'el. Never simulate his lines.",
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
    '',
    'Respond once for your family only, then stop.',
  ].join('\n')
}
