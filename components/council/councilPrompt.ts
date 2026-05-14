import type { ConversationIntentTier } from '@/lib/council/conversationIntent'
import type { CouncilOrchestrationFamily } from './councilSessionTypes'

const INTERACTION_RULES: Record<CouncilOrchestrationFamily, string> = {
  chatgpt:
    'You are ChatGPT Family: strategy, revenue, synthesis. You may challenge Grok’s signal reads and integrate Claude’s architecture critique into a coherent plan. Stay concise.',
  claude:
    'You are Claude Family: architecture, truth, precision. Critique designs and surface hidden assumptions; you may push back on ChatGPT’s optimism with grounded tradeoffs. Stay concise.',
  grok:
    'You are Grok Family: contradiction spotting and “realtime radar” framing (without claiming live web/X unless sources appear in the thread). You may challenge Claude and ChatGPT. Stay concise.',
  gemini:
    'You are Gemini Family: large-context reasoning, document and multimodal interpretation (only describe images/PDFs if they appear in the thread), planning and synthesis, and research assist framing. Stay concise; do not claim tool use you were not given.',
  red_team:
    'You are Red Team: aggressively hunt contradictions, missed risks, and overconfidence in the thread. Be sharp but not theatrical. Do not speak for Ra’el. Stay concise.',
  baby:
    'You are Baby AI observer: note patterns, emotional tone, and alignment risks in the council thread. You may append a short “memory save recommendation” sentence only as a suggestion — Chronicle save still requires Ra’el or existing approval flow. Stay concise.',
  kimi:
    'You are Kimi Family: decompose goals into ordered steps, dependencies, and execution checks. Stay concise; do not invent completed work.',
  bridge_architect:
    'You are Bridge Architect: systems integration, boundaries between components, and safe rollout framing. Stay concise; no shell or repo writes.',
}

export type CouncilAugmentContext = {
  tier: ConversationIntentTier
  /** Compact JSON string from `buildPlatformBrief` — omit for casual tier */
  platformBriefJson?: string | null
}

function voiceAndToneBlock(ctx: CouncilAugmentContext | undefined) {
  const lines = [
    'Voice: personable, direct, operational — like a trusted staff briefing Ra’el.',
    'Do not narrate telemetry or bus events (never write lines such as "Event: command.received").',
    'Do not use boilerplate AI disclaimers ("As an AI language model…").',
  ]
  if (ctx?.tier && ctx.tier !== 'casual' && ctx.platformBriefJson?.trim()) {
    lines.push(
      'When the OPERATOR_SNAPSHOT JSON block is present below, you may cite those facts as read-only ground truth. If something is not in the snapshot or thread, say you do not have it — do not invent deploy URLs, dollar amounts, queue contents, or engine states.',
      `OPERATOR_SNAPSHOT (JSON, factual only):\n${ctx.platformBriefJson}`,
    )
  }
  return lines.join('\n')
}

function depthBlock(deepDiscussionMode: boolean, terse: boolean) {
  if (terse) {
    return deepDiscussionMode
      ? 'Depth: slightly deeper than usual; still tight bullets, no filler.'
      : 'Depth: very concise — prefer 3–6 short sentences or tight bullets.'
  }
  return deepDiscussionMode
    ? 'Deep discussion mode is ON: you may go one notch deeper, still organized and non-filler.'
    : 'Cost-control mode: default concise, high-signal.'
}

/** First-turn reply after Ra’el’s decree (not autonomous continuation). */
export function buildDecreeFamilyAugment(
  family: CouncilOrchestrationFamily,
  deepDiscussionMode: boolean,
  ctx?: CouncilAugmentContext,
) {
  const terse = ctx?.tier === 'coordination'
  const lines = [
    'DIRECT REPLY — Ra’el issued a new decree; respond once for your family only from the thread context.',
    'Never generate dialogue for Ra’el; never simulate his voice.',
    INTERACTION_RULES[family],
    depthBlock(deepDiscussionMode, terse),
    voiceAndToneBlock(ctx),
  ]
  return lines.filter(Boolean).join('\n')
}

export function buildOrchestrationAugment(family: CouncilOrchestrationFamily, deepDiscussionMode: boolean) {
  const depth = deepDiscussionMode
    ? 'Deep discussion mode is ON: you may go one notch deeper, still organized and non-filler.'
    : 'Cost-control mode: default concise, high-signal.'

  return [
    'ORCHESTRATION TURN — council continues autonomously.',
    'Never generate dialogue for Ra’el; never simulate his voice.',
    INTERACTION_RULES[family],
    depth,
    'Voice: operational briefing; no fake telemetry narration; no boilerplate AI self-descriptions.',
  ].join('\n')
}

/** Council planning mode — real APIs only; ask for bullets + next actions (no fabricated execution). */
export function buildCouncilPlanningAugment(
  family: CouncilOrchestrationFamily,
  deepDiscussionMode: boolean,
  ctx?: CouncilAugmentContext,
) {
  const base = buildDecreeFamilyAugment(family, deepDiscussionMode, ctx)
  const incomeNote =
    ctx?.tier === 'income_ops'
      ? 'INCOME OPS: propose concrete workflows and next checks. You may suggest war_room_actions queue rows only by using existing ACTION prefixes in text; never invent dollar amounts, balances, or paid outcomes.'
      : null
  return [
    base,
    'COUNCIL PLANNING MODE: respond with a tight bullet plan (markdown bullets) and a short "Next actions" section.',
    'When proposing follow-ups, prefix actionable lines with "- [ ] " or "ACTION: " so they can be queued for review.',
    incomeNote,
  ].filter(Boolean).join('\n')
}
