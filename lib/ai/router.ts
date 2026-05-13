/**
 * Keyword router for council “decrees”. Pure logic — no network or env reads.
 *
 * Confidence is **0–100** (integer), consistent with `confidenceScore` in `lib/mockCouncilData.ts`.
 * - **90**: clear keyword / phrase hit (first matching rule wins).
 * - **35**: no keyword matched — **default family is ChatGPT** (OpenAI) with low confidence.
 *   If product policy prefers Claude as default instead, change `DEFAULT_FAMILY` and `DEFAULT_PROVIDER`.
 */

export type CouncilFamilyName =
  | 'Claude'
  | 'ChatGPT'
  | 'Kimi'
  | 'Grok'
  | 'Gemini'
  | 'Red Team'

export type RoutingResult = {
  selectedFamily: CouncilFamilyName
  provider: string
  reason: string
  /** 0–100 inclusive; see module docstring. */
  confidence: number
  originalDecree: string
}

type Rule = {
  /** Substrings matched against normalized decree; first rule with any hit wins. */
  needles: string[]
  selectedFamily: CouncilFamilyName
  provider: string
  describeHit: (needle: string) => string
}

const DEFAULT_FAMILY: CouncilFamilyName = 'ChatGPT'
const DEFAULT_PROVIDER = 'OpenAI'
const DEFAULT_CONFIDENCE = 35

/** Order matters: earlier rules win on first substring match. */
const RULES: Rule[] = [
  {
    needles: ['red team', 'redteam', 'internal safety', 'policy edge'],
    selectedFamily: 'Red Team',
    provider: 'Internal',
    describeHit: (n) => `Matched council keyword “${n}” → Red Team (Internal).`,
  },
  {
    needles: ['kimi', 'moonshot'],
    selectedFamily: 'Kimi',
    provider: 'Moonshot',
    describeHit: (n) => `Matched council keyword “${n}” → Kimi (Moonshot).`,
  },
  {
    needles: ['grok', 'xai', 'x.ai'],
    selectedFamily: 'Grok',
    provider: 'xAI',
    describeHit: (n) => `Matched council keyword “${n}” → Grok (xAI).`,
  },
  {
    needles: ['gemini', 'google ai', 'multimodal shard'],
    selectedFamily: 'Gemini',
    provider: 'Google',
    describeHit: (n) => `Matched council keyword “${n}” → Gemini (Google).`,
  },
  {
    needles: ['claude', 'anthropic'],
    selectedFamily: 'Claude',
    provider: 'Anthropic',
    describeHit: (n) => `Matched council keyword “${n}” → Claude (Anthropic).`,
  },
  {
    needles: ['chatgpt', 'openai', 'gpt-4o', 'gpt-4', 'gpt4'],
    selectedFamily: 'ChatGPT',
    provider: 'OpenAI',
    describeHit: (n) => `Matched council keyword “${n}” → ChatGPT (OpenAI).`,
  },
]

function normalizeDecree(decree: string): string {
  return decree.trim().toLowerCase()
}

export function routeDecreeByKeywords(originalDecree: string): RoutingResult {
  const trimmed = originalDecree.trim()
  const haystack = normalizeDecree(trimmed)

  for (const rule of RULES) {
    for (const needle of rule.needles) {
      const n = needle.toLowerCase()
      if (n.length === 0) continue
      if (haystack.includes(n)) {
        return {
          selectedFamily: rule.selectedFamily,
          provider: rule.provider,
          reason: rule.describeHit(needle),
          confidence: 90,
          originalDecree: trimmed,
        }
      }
    }
  }

  return {
    selectedFamily: DEFAULT_FAMILY,
    provider: DEFAULT_PROVIDER,
    reason:
      'No council family keyword matched in decree; defaulting to ChatGPT (OpenAI) with lower confidence.',
    confidence: DEFAULT_CONFIDENCE,
    originalDecree: trimmed,
  }
}
