import type { RoutingNote } from '../routing'
import type { CouncilSkillId } from '../skills/types'
import type {
  BrainLatencyTolerance,
  BrainNeedLevel,
  BrainReasoningStyle,
  RequiredBrainProfile,
} from './types'

const HIGH_CONTEXT_SKILLS = new Set<CouncilSkillId>([
  'long_reasoning_decomposition',
  'knowledge_organization',
  'cross_reference',
  'source_comparison',
  'system_architecture',
])

const LIVE_RESEARCH_SKILLS = new Set<CouncilSkillId>([
  'current_signal_detection',
  'internet_awareness',
  'market_intelligence',
  'opportunity_sensing',
  'realtime_context_framing',
])

const TOOL_USE_SKILLS = new Set<CouncilSkillId>([
  'internet_awareness',
  'current_signal_detection',
  'market_intelligence',
  'opportunity_sensing',
  'technical_execution_planning',
])

function hasAnySkill(routingNote: RoutingNote, skillIds: Set<CouncilSkillId>): boolean {
  return routingNote.selectedSkillIds.some(skillId => skillIds.has(skillId))
}

function resolveReasoningStyle(routingNote: RoutingNote): BrainReasoningStyle {
  if (routingNote.intent === 'architecture') return 'architectural'
  if (routingNote.intent === 'strategy') return 'strategic'
  if (routingNote.intent === 'research') return 'research'
  if (routingNote.intent === 'implementation') return 'coding'
  if (routingNote.intent === 'risk') return 'risk'
  if (routingNote.selectedSkillIds.includes('synthesis')) return 'synthesis'
  return 'synthesis'
}

function resolveContextWindowNeed(routingNote: RoutingNote): BrainNeedLevel {
  if (hasAnySkill(routingNote, HIGH_CONTEXT_SKILLS)) return 'high'
  if (routingNote.selectedSkillIds.length >= 3 || routingNote.rejectedSkillIds.length >= 4) return 'medium'
  return 'low'
}

function resolveLatencyTolerance(routingNote: RoutingNote): BrainLatencyTolerance {
  if (routingNote.intent === 'communication' || routingNote.intent === 'risk') return 'fast'
  if (routingNote.intent === 'architecture' || routingNote.intent === 'research') return 'slow'
  return 'normal'
}

function resolveCostSensitivity(routingNote: RoutingNote): BrainNeedLevel {
  if (!routingNote.approvalRequired && routingNote.riskLevel === 'low') return 'high'
  if (routingNote.riskLevel === 'high') return 'low'
  return 'medium'
}

// Privacy sensitivity must reflect the *content/data type* the commander message
// actually names, not the skill's riskLevel. A high-risk implementation task (e.g.
// "build me a login system") is not automatically privacy-sensitive just because
// it's risky — risk (impact of getting it wrong) and privacy (sensitivity of the
// data involved) are independent axes and were previously conflated.
type PrivacySignal = { label: string; regex: RegExp }

const PRIVACY_SIGNALS: PrivacySignal[] = [
  {
    label: 'personal records',
    regex: /\b(personal (?:record|information|info|data)|social security(?: number)?|\bssn\b|date of birth|home address)\b/,
  },
  {
    label: 'financial data',
    regex: /\b(bank account|credit card|debit card|routing number|account number|financial (?:data|record|records)|payment (?:info|information|details)|salary|payroll|tax return)\b/,
  },
  {
    label: 'legal documents',
    regex: /\b(legal document|contract terms|non-disclosure|\bnda\b|litigation|lawsuit)\b/,
  },
  {
    label: 'medical info',
    regex: /\b(medical record|health record|diagnosis|patient (?:data|record|information)|\bhipaa\b)\b/,
  },
  {
    label: 'credentials',
    regex: /\b(password|api key|secret key|private key|auth token|access token|login credentials)\b/,
  },
  {
    label: 'private files',
    regex: /\b(private file|confidential file|personal file)\b/,
  },
  {
    label: 'internal business secrets',
    regex: /\b(trade secret|internal secret|proprietary (?:data|information)|confidential business)\b/,
  },
]

export function detectPrivacySignals(commanderMessage: string): string[] {
  const normalized = commanderMessage.trim().toLowerCase()
  if (!normalized) return []
  return PRIVACY_SIGNALS.filter(signal => signal.regex.test(normalized)).map(signal => signal.label)
}

function resolvePrivacySensitivity(commanderMessage: string): BrainNeedLevel {
  return detectPrivacySignals(commanderMessage).length > 0 ? 'high' : 'low'
}

export class BrainProfileResolver {
  resolve(routingNote: RoutingNote, commanderMessage: string): RequiredBrainProfile {
    const liveResearchNeed = hasAnySkill(routingNote, LIVE_RESEARCH_SKILLS)
    const toolUseNeed = liveResearchNeed || hasAnySkill(routingNote, TOOL_USE_SKILLS)

    return {
      reasoningStyle: resolveReasoningStyle(routingNote),
      contextWindowNeed: resolveContextWindowNeed(routingNote),
      latencyTolerance: resolveLatencyTolerance(routingNote),
      costSensitivity: resolveCostSensitivity(routingNote),
      privacySensitivity: resolvePrivacySensitivity(commanderMessage),
      liveResearchNeed,
      toolUseNeed,
    }
  }
}
