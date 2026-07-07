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

function resolvePrivacySensitivity(routingNote: RoutingNote): BrainNeedLevel {
  if (routingNote.riskLevel === 'high' || routingNote.intent === 'memory') return 'high'
  if (routingNote.approvalRequired) return 'medium'
  return 'low'
}

export class BrainProfileResolver {
  resolve(routingNote: RoutingNote): RequiredBrainProfile {
    const liveResearchNeed = hasAnySkill(routingNote, LIVE_RESEARCH_SKILLS)
    const toolUseNeed = liveResearchNeed || hasAnySkill(routingNote, TOOL_USE_SKILLS)

    return {
      reasoningStyle: resolveReasoningStyle(routingNote),
      contextWindowNeed: resolveContextWindowNeed(routingNote),
      latencyTolerance: resolveLatencyTolerance(routingNote),
      costSensitivity: resolveCostSensitivity(routingNote),
      privacySensitivity: resolvePrivacySensitivity(routingNote),
      liveResearchNeed,
      toolUseNeed,
    }
  }
}
