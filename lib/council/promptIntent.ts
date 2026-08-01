/**
 * User decree intent for council response integrity and render gates.
 * Pure heuristics — no I/O.
 */

import type { ResponseIntegrityExpectation } from '@/lib/providers/responseIntegrity'

export type PromptIntent =
  | 'GREETING'
  | 'CASUAL'
  | 'SIMPLE_HELP'
  | 'ANALYSIS'
  | 'RESEARCH'
  | 'REPAIR'
  | 'OPPORTUNITY'
  | 'SYSTEM_DIAGNOSTIC'

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\u2019/g, "'").replace(/\s+/g, ' ')
}

const GREETING_LINE =
  /^\s*(hi+|hello|hey+|yo+|sup|what'?s up|whats\s+up|good\s+(morning|afternoon|evening)|howdy)\b[!?.\s,]*$/i
const GREETING_PREFIX = /^\s*(hi+|hello|hey+|yo+|good\s+morning)\b[,!\s]/i
const FAMILY_GREETING =
  /^\s*(?:hey\s+family|hi+\s+family|hello\s+family|hey+)\b[^.!?\n]{0,48}\b(?:family|council|team|everyone|folks|ra['']?el)\b/i
const CONVERSATIONAL_OPEN =
  /^\s*(?:hello|hey|hi|good\s+morning|good\s+afternoon|good\s+evening|what'?s\s+up)\b[!?.,\s]/i
const THANKS_ONLY =
  /^\s*(thanks|thank you|thx|ty|appreciate it|much appreciated|cheers)\b[!?.\s]*$/i

const DIRECT_FAMILY =
  /\b(?:@)?(?:chatgpt|claude|grok|gemini|kimi|baby|red\s*team|bridge\s*architect)\b/i

const ANALYSIS_MARKERS =
  /\b(?:analyze|analysis|compare|evaluate|assess|break\s*down|what\s+do\s+you\s+think|your\s+take|perspective|recommend|trade-?offs?|implications?)\b/i

const RESEARCH_MARKERS =
  /\b(?:research|investigate|look\s*up|what'?s\s+going\s+on|current\s+events?|news|headlines|happening\s+in|situation\s+in|live\s+data|sources?)\b/i
const GEO_RESEARCH = /\b(?:usa|u\.s\.a?|united\s+states|america|global|world)\b/i

const REPAIR_MARKERS =
  /\b(?:repair\s+packet|fix\s+the|broken|regression|stack\s*trace|debug|diagnose\s+the|panel\s+broken|not\s+rendering)\b/i

const OPPORTUNITY_MARKERS =
  /\b(?:scout|opportunit(?:y|ies)|side\s+hustle|under\s+\$?\d+|income\s+ops|revenue\s+play|monetize)\b/i

const SYSTEM_DIAGNOSTIC_MARKERS =
  /\b(?:canonical\s+status|runtime\s+diagnostic|stability\s+mode|provider\s+health|engine\s+control|integrity\s+snapshot)\b/i

const CASUAL_MARKERS =
  /\b(?:just\s+checking\s+in|quick\s+question|btw|by\s+the\s+way|how\s+are\s+you|what'?s\s+new)\b/i

const SIMPLE_HELP_MARKERS =
  /\b(?:how\s+do\s+i|can\s+you\s+help|what\s+should\s+i|quick\s+tip|remind\s+me)\b/i

export function isRelaxedPromptIntent(intent: PromptIntent): boolean {
  return intent === 'GREETING' || intent === 'CASUAL'
}

/**
 * Decree explicitly asked for a short reply (e.g. "one sentence", "yes or no", "under 20 words").
 * Orthogonal to `PromptIntent` — an analytical decree can still ask for a one-line answer. Lowers
 * only the numeric length/meaningful-token floor in `buildIntegrityExpectationForPrompt`; it does
 * not disable emptiness, fragment, greeting-stub, or repeated-fallback checks, and does not imply
 * `relaxedCasual`.
 */
const BREVITY_MARKERS =
  /\b(?:one[- ]sentence|a\s+single\s+sentence|one[- ]liner?s?|one[- ]word|brief(?:ly)?\s+repl(?:y|ies)?|brief\s+answer|short\s+answer|concise\s+(?:response|answer|confirmation|reply)|answer\s+brief(?:ly)?|reply\s+brief(?:ly)?|keep\s+it\s+(?:brief|short|concise)|yes\s+or\s+no|yes\/no|under\s+\d+\s+words?|no\s+more\s+than\s+\d+\s+words?|in\s+(?:no\s+more\s+than\s+)?\d+\s+words?|in\s+one\s+line)\b/i

export function detectsExplicitBrevityRequest(message: string): boolean {
  const raw = typeof message === 'string' ? message : ''
  return BREVITY_MARKERS.test(norm(raw))
}

export function isStrictAnalyticalIntent(intent: PromptIntent): boolean {
  return (
    intent === 'ANALYSIS'
    || intent === 'RESEARCH'
    || intent === 'REPAIR'
    || intent === 'OPPORTUNITY'
    || intent === 'SYSTEM_DIAGNOSTIC'
  )
}

/** Relaxed integrity thresholds for greeting / casual decree replies. */
export const RELAXED_MIN_LENGTH = 12
export const RELAXED_MIN_MEANINGFUL_TOKENS = 4

/**
 * Classify the operator decree before response integrity scoring.
 */
export function detectPromptIntent(message: string): PromptIntent {
  const raw = typeof message === 'string' ? message : ''
  const t = norm(raw)
  if (!t) return 'CASUAL'

  if (SYSTEM_DIAGNOSTIC_MARKERS.test(t)) return 'SYSTEM_DIAGNOSTIC'
  if (REPAIR_MARKERS.test(t)) return 'REPAIR'
  if (OPPORTUNITY_MARKERS.test(t)) return 'OPPORTUNITY'

  if (RESEARCH_MARKERS.test(t) || (GEO_RESEARCH.test(t) && /\b(?:what|how|going|happening|news)\b/i.test(raw))) {
    return 'RESEARCH'
  }

  const trimmed = raw.trim()
  if (
    GREETING_LINE.test(trimmed)
    || FAMILY_GREETING.test(trimmed)
    || (CONVERSATIONAL_OPEN.test(trimmed) && trimmed.length < 96)
    || (GREETING_PREFIX.test(trimmed) && trimmed.length < 80)
  ) {
    return 'GREETING'
  }
  if (THANKS_ONLY.test(trimmed)) return 'CASUAL'

  if (DIRECT_FAMILY.test(t) && ANALYSIS_MARKERS.test(t)) return 'ANALYSIS'
  if (ANALYSIS_MARKERS.test(t)) return 'ANALYSIS'

  if (
    (CASUAL_MARKERS.test(t) || /\b(?:hey\s+family|what'?s\s+up|good\s+morning)\b/i.test(t))
    && t.length < 120
  ) {
    return 'CASUAL'
  }
  if (SIMPLE_HELP_MARKERS.test(t) && t.length < 160) return 'SIMPLE_HELP'

  if (t.length < 48 && !RESEARCH_MARKERS.test(t) && !OPPORTUNITY_MARKERS.test(t)) {
    if (GREETING_PREFIX.test(trimmed)) return 'GREETING'
    return 'CASUAL'
  }

  return 'ANALYSIS'
}

export function intentRequiresOpportunityStructure(intent: PromptIntent): boolean {
  return intent === 'OPPORTUNITY'
}

export function intentRequiresResearchDiscipline(intent: PromptIntent): boolean {
  return intent === 'RESEARCH'
}

/**
 * Map decree intent to provider integrity expectation overrides.
 *
 * `brevityRequested` (from `detectsExplicitBrevityRequest`) only lowers the numeric length/
 * meaningful-token floor to the same relaxed values already trusted for GREETING/CASUAL decrees
 * — it never sets `relaxedCasual` and never touches `councilMode`, so emptiness, fragment,
 * greeting-stub, and repeated-fallback checks still apply in full. Not applied to OPPORTUNITY,
 * which requires enough substance to be independently actionable regardless of brevity phrasing.
 */
export function buildIntegrityExpectationForPrompt(
  intent: PromptIntent,
  base: ResponseIntegrityExpectation = {},
  opts?: { brevityRequested?: boolean },
): ResponseIntegrityExpectation {
  if (isRelaxedPromptIntent(intent)) {
    return {
      ...base,
      promptIntent: intent,
      relaxedCasual: true,
      councilMode: false,
      minLength: RELAXED_MIN_LENGTH,
      minMeaningfulTokens: RELAXED_MIN_MEANINGFUL_TOKENS,
    }
  }

  const brevityFloor = opts?.brevityRequested && intent !== 'OPPORTUNITY'
    ? { minLength: RELAXED_MIN_LENGTH, minMeaningfulTokens: RELAXED_MIN_MEANINGFUL_TOKENS, brevityRequested: true as const }
    : null

  if (intent === 'SIMPLE_HELP') {
    return {
      ...base,
      promptIntent: intent,
      councilMode: base.councilMode ?? true,
      minLength: brevityFloor?.minLength ?? base.minLength ?? 40,
      minMeaningfulTokens: brevityFloor?.minMeaningfulTokens ?? base.minMeaningfulTokens ?? 12,
      ...(brevityFloor ? { brevityRequested: true } : {}),
    }
  }

  if (intent === 'OPPORTUNITY') {
    return {
      ...base,
      promptIntent: intent,
      councilMode: true,
      requireActionableOpportunity: true,
      minLength: base.minLength ?? 80,
      minMeaningfulTokens: base.minMeaningfulTokens ?? 24,
    }
  }

  if (intent === 'RESEARCH' || intent === 'ANALYSIS' || intent === 'REPAIR' || intent === 'SYSTEM_DIAGNOSTIC') {
    return {
      ...base,
      promptIntent: intent,
      councilMode: base.councilMode ?? true,
      minLength: brevityFloor?.minLength ?? base.minLength ?? 80,
      minMeaningfulTokens: brevityFloor?.minMeaningfulTokens ?? base.minMeaningfulTokens ?? 24,
      ...(brevityFloor ? { brevityRequested: true } : {}),
    }
  }

  return {
    ...base,
    promptIntent: intent,
    ...(brevityFloor ?? {}),
  }
}
