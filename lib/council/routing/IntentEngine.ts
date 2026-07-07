import type {
  CommanderIntentKind,
  IntentClassification,
} from './types'
import type { CouncilSkillCategory } from '../skills/types'

type IntentPattern = {
  regex: RegExp
  label: string
}

type IntentRule = {
  intent: CommanderIntentKind
  category: CouncilSkillCategory
  signals: string[]
  patterns?: IntentPattern[]
  tools?: string[]
}

const INTENT_RULES: IntentRule[] = [
  {
    intent: 'architecture',
    category: 'reasoning',
    signals: ['architecture', 'system design', 'design review', 'structure', 'scalable', 'feasible'],
  },
  {
    intent: 'strategy',
    category: 'planning',
    signals: ['strategy', 'plan', 'roadmap', 'business', 'positioning', 'next steps'],
  },
  {
    intent: 'research',
    category: 'research',
    signals: [
      'research', 'search', 'look up', 'current', 'latest', 'source', 'verify online', 'internet',
      'news', 'update', 'trend', 'market', 'prices', 'happening',
    ],
    patterns: [
      { regex: /what'?s happening/, label: "what's happening" },
      { regex: /how (?:is|are) .+ doing/, label: 'how is ... doing' },
      { regex: /\blately\b/, label: 'lately' },
      { regex: /\brecently\b/, label: 'recently' },
      { regex: /\bthese days\b/, label: 'these days' },
      { regex: /\bnowadays\b/, label: 'nowadays' },
      { regex: /\bright now\b/, label: 'right now' },
      { regex: /\bany update(?:s)? on\b/, label: 'any update(s) on' },
    ],
    tools: ['internet'],
  },
  {
    intent: 'implementation',
    category: 'implementation',
    signals: ['implement', 'build', 'code', 'patch', 'fix', 'ship', 'technical execution'],
  },
  {
    intent: 'review',
    category: 'review',
    signals: ['review', 'audit', 'inspect', 'check this', 'qa'],
  },
  {
    intent: 'risk',
    category: 'risk',
    signals: ['risk', 'scam', 'flaw', 'contradiction', 'stress test', 'assumption'],
  },
  {
    intent: 'memory',
    category: 'memory',
    signals: ['remember', 'memory', 'save this', 'chronicle', 'recall'],
  },
  {
    intent: 'communication',
    category: 'communication',
    signals: ['write', 'draft', 'summarize', 'explain', 'message'],
  },
  {
    intent: 'coordination',
    category: 'coordination',
    signals: ['coordinate', 'assign', 'route', 'handoff', 'organize'],
  },
]

const unique = <T>(values: T[]): T[] => Array.from(new Set(values))

function matchSignals(rule: IntentRule, normalizedMessage: string): string[] {
  const literalMatches = rule.signals.filter(signal => normalizedMessage.includes(signal))
  const patternMatches = (rule.patterns ?? [])
    .filter(pattern => pattern.regex.test(normalizedMessage))
    .map(pattern => pattern.label)
  return unique([...literalMatches, ...patternMatches])
}

const CONFIDENCE_THRESHOLD = 0.6

export class IntentEngine {
  classify(message: string): IntentClassification {
    const normalizedMessage = message.trim().toLowerCase()
    if (!normalizedMessage) {
      return {
        intent: 'unknown',
        normalizedMessage,
        matchedSignals: [],
        candidateCategories: [],
        candidateTools: [],
        confidence: 0,
        clarificationRecommended: true,
        clarificationReason: 'low_signal',
      }
    }

    const matchedRules = INTENT_RULES
      .map(rule => ({
        rule,
        matchedSignals: matchSignals(rule, normalizedMessage),
      }))
      .filter(match => match.matchedSignals.length > 0)

    if (matchedRules.length === 0) {
      return {
        intent: 'unknown',
        normalizedMessage,
        matchedSignals: [],
        candidateCategories: ['communication'],
        candidateTools: [],
        confidence: 0.35,
        clarificationRecommended: true,
        clarificationReason: 'low_signal',
      }
    }

    const sortedMatches = [...matchedRules].sort((a, b) => b.matchedSignals.length - a.matchedSignals.length)
    const primaryMatch = sortedMatches[0]
    const tiedPrimaryCount = sortedMatches.filter(
      match => match.matchedSignals.length === primaryMatch.matchedSignals.length,
    ).length
    const matchedSignals = unique(matchedRules.flatMap(match => match.matchedSignals))
    const candidateCategories = unique(matchedRules.map(match => match.rule.category))
    const candidateTools = unique(matchedRules.flatMap(match => match.rule.tools ?? []))

    // A single, unambiguous category match starts at the confidence threshold itself —
    // one clean signal should not read as "needs clarification." Extra corroborating
    // signals within that same category push confidence higher; a genuine tie between
    // categories (ambiguity, not sparseness) is what pulls confidence back down.
    const baseConfidence = CONFIDENCE_THRESHOLD + Math.min(matchedSignals.length - 1, 4) * 0.07
    const isAmbiguous = tiedPrimaryCount > 1 || candidateCategories.length > 2
    const ambiguityPenalty = isAmbiguous ? 0.25 : 0
    const confidence = Math.max(0.1, Math.min(0.95, baseConfidence - ambiguityPenalty))
    const clarificationRecommended = isAmbiguous || confidence < CONFIDENCE_THRESHOLD

    return {
      intent: primaryMatch.rule.intent,
      normalizedMessage,
      matchedSignals,
      candidateCategories,
      candidateTools,
      confidence,
      clarificationRecommended,
      clarificationReason: isAmbiguous ? 'ambiguous_categories' : clarificationRecommended ? 'low_signal' : 'none',
    }
  }
}
