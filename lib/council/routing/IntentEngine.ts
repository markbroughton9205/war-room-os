import type {
  CommanderIntentKind,
  IntentClassification,
} from './types'
import type { CouncilSkillCategory } from '../skills/types'

type IntentRule = {
  intent: CommanderIntentKind
  category: CouncilSkillCategory
  signals: string[]
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
    signals: ['research', 'search', 'look up', 'current', 'latest', 'source', 'verify online', 'internet'],
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
      }
    }

    const matchedRules = INTENT_RULES
      .map(rule => ({
        rule,
        matchedSignals: rule.signals.filter(signal => normalizedMessage.includes(signal)),
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
    const baseConfidence = 0.45 + Math.min(matchedSignals.length, 5) * 0.1
    const ambiguityPenalty = tiedPrimaryCount > 1 || candidateCategories.length > 2 ? 0.2 : 0
    const confidence = Math.max(0.1, Math.min(0.95, baseConfidence - ambiguityPenalty))

    return {
      intent: primaryMatch.rule.intent,
      normalizedMessage,
      matchedSignals,
      candidateCategories,
      candidateTools,
      confidence,
      clarificationRecommended: confidence < 0.6 || candidateCategories.length > 2,
    }
  }
}
