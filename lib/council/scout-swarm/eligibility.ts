import type { ClassifiedCouncilTurn } from '@/lib/council/session-orchestration/turnIntent'
import { classifyAstraIntent } from '@/lib/council/nebula/roundFlow'

const CLOSED_FORM_ARITHMETIC =
  /(?:what(?:'s|s|\s+is)\s+)?(\d+)\s*(?:plus|\+|minus|-|times|x|×|\*|divided\s+by|\/)\s*(\d+)/i

const CLOSED_FORM_CAPITAL =
  /what(?:'s|s|\s+is)\s+the\s+capital\s+of\s+[a-z][a-z\s.'-]+/i

const SIMPLE_GREETING =
  /^\s*(hi|hello|hey|yo|sup|good\s+(morning|afternoon|evening))[!.,\s]*$/i

export function isClosedFormKnowledgeQuestion(text: string): boolean {
  const raw = text.trim()
  if (!raw) return false
  if (CLOSED_FORM_ARITHMETIC.test(raw) && raw.length < 160) return true
  if (CLOSED_FORM_CAPITAL.test(raw) && raw.length < 180) return true
  return false
}

export function isSimpleFastPathPrompt(text: string, classified?: ClassifiedCouncilTurn): boolean {
  const raw = text.trim()
  if (!raw) return true
  if (SIMPLE_GREETING.test(raw)) return true
  if (isClosedFormKnowledgeQuestion(raw)) return true
  if (classified?.depth === 'FAST' && classified.intent !== 'STATUS_CHECK') return true
  if (classified?.intent === 'GREETING' || classified?.intent === 'SOCIAL_CHECKIN') return true
  return false
}

export function shouldRunIndependentScoutSwarm(text: string, classified: ClassifiedCouncilTurn): boolean {
  if (isSimpleFastPathPrompt(text, classified)) return false
  if (classified.intent === 'STATUS_CHECK') return false
  if (classified.intent === 'GREETING' || classified.intent === 'SOCIAL_CHECKIN') return false
  if (classified.depth !== 'FULL') return false

  const astra = classifyAstraIntent(text)
  if (astra === 'SOCIAL' || astra === 'STATUS_CHECK') return false

  if (classified.shouldResearch) return true
  if (
    classified.intent === 'RESEARCH_REQUEST'
    || classified.intent === 'TIME_SENSITIVE'
    || classified.intent === 'FRESHNESS_SENSITIVE'
    || classified.intent === 'STRATEGIC_ANALYSIS'
  ) {
    return true
  }
  if (astra === 'RESEARCH' || astra === 'VERIFICATION' || astra === 'COMPREHENSIVE' || astra === 'STRATEGY' || astra === 'HUMAN_IMPACT' || astra === 'ENGINEERING' || astra === 'DECISION') {
    return true
  }
  if (/\bengineering\b/i.test(text) || (/\bwar room\b/i.test(text) && /\b(risk|runtime|telemetry|repo)\b/i.test(text))) {
    return true
  }
  return false
}
