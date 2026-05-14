/**
 * Lightweight intent routing for Ra'el → Live Council.
 * No LLM — keyword / pattern heuristics only.
 */

export type ConversationIntentTier = 'casual' | 'coordination' | 'council_full' | 'income_ops'

export type ClassifyRaElMessageResult = {
  tier: ConversationIntentTier
  /** Phase-4 style ledger emits (command.received / command.routed) — gated, not every casual line */
  shouldEmitBusEvents: boolean
  /** Whether to invoke any council family LLM round for this message */
  shouldRunFamilyRound: boolean
  /** Cap on families consulted this turn */
  maxFamilies: number
}

/** Emits ledger events only when these match (or tier is income_ops / council_full). */
const PHASE4_BUS_KEYWORDS =
  /@council\b|\b(council|plan|coordinate|income|money|opportunity|opportunities|assign|execute|approve)\b/i

const INCOME_OPS_PATTERN = new RegExp(
  [
    '\\b(income|money|revenue|earn|earning|paid survey|side hustle|cashflow)\\b',
    '\\b(get to work|find opportunities|make money|what should run next|assign agents)\\b',
  ].join('|'),
  'i',
)

const COUNCIL_FULL_PATTERN = /@council\b|\b(full council|all families|every family|war council|summon the council)\b/i

const COORDINATION_PATTERN =
  /\b(coordinate|coordination|sync up|align teams|handoff|status meeting|standup|roadmap|milestone|dependencies)\b/i

const GREETING_OR_THANKS_PATTERN =
  /^\s*(hi+|hello|hey+|yo+|sup|what'?s up|good\s+(morning|afternoon|evening)|howdy)\b[!?.\s]*$/i

const THANKS_ONLY_PATTERN =
  /^\s*(thanks|thank you|thx|ty|appreciate it|much appreciated|cheers)\b[!?.\s]*$/i

function busKeywordHit(text: string): boolean {
  return PHASE4_BUS_KEYWORDS.test(text)
}

export function classifyRaElMessage(text: string): ClassifyRaElMessageResult {
  const raw = text.trim()

  const isGreetingOrThanks = GREETING_OR_THANKS_PATTERN.test(raw) || THANKS_ONLY_PATTERN.test(raw)

  if (isGreetingOrThanks) {
    return {
      tier: 'casual',
      shouldEmitBusEvents: false,
      shouldRunFamilyRound: true,
      maxFamilies: 1,
    }
  }

  if (INCOME_OPS_PATTERN.test(raw)) {
    return {
      tier: 'income_ops',
      shouldEmitBusEvents: true,
      shouldRunFamilyRound: true,
      maxFamilies: 4,
    }
  }

  if (COUNCIL_FULL_PATTERN.test(raw)) {
    return {
      tier: 'council_full',
      shouldEmitBusEvents: true,
      shouldRunFamilyRound: true,
      maxFamilies: 12,
    }
  }

  if (COORDINATION_PATTERN.test(raw)) {
    return {
      tier: 'coordination',
      shouldEmitBusEvents: busKeywordHit(raw),
      shouldRunFamilyRound: true,
      maxFamilies: 2,
    }
  }

  if (busKeywordHit(raw)) {
    return {
      tier: 'coordination',
      shouldEmitBusEvents: true,
      shouldRunFamilyRound: true,
      maxFamilies: raw.length > 140 ? 2 : 1,
    }
  }

  return {
    tier: 'casual',
    shouldEmitBusEvents: false,
    shouldRunFamilyRound: true,
    maxFamilies: 1,
  }
}
