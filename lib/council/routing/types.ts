import type { CouncilEntityId } from '../entities/types'
import type {
  CouncilSkillCategory,
  CouncilSkillId,
  CouncilSkillRiskLevel,
} from '../skills/types'

export type CommanderIntentKind =
  | 'architecture'
  | 'strategy'
  | 'research'
  | 'implementation'
  | 'review'
  | 'risk'
  | 'memory'
  | 'communication'
  | 'coordination'
  | 'unknown'

export type IntentClarificationReason = 'none' | 'low_signal' | 'ambiguous_categories'

export type IntentClassification = {
  intent: CommanderIntentKind
  normalizedMessage: string
  matchedSignals: string[]
  candidateCategories: CouncilSkillCategory[]
  candidateTools: string[]
  confidence: number
  clarificationRecommended: boolean
  clarificationReason: IntentClarificationReason
}

export type RejectedSkill = {
  skillId: CouncilSkillId
  reason: string
}

export type SkillRoutingDecision = {
  candidateSkillIds: CouncilSkillId[]
  rejectedSkillIds: RejectedSkill[]
  selectedSkillIds: CouncilSkillId[]
  confidence: number
}

export type EntityRoutingDecision = {
  selectedEntityIds: CouncilEntityId[]
  confidence: number
}

export type ApprovalDecision = {
  approvalRequired: boolean
  riskLevel: CouncilSkillRiskLevel
}

export type RoutingNote = {
  routingId: string
  intent: string
  routingConfidence: number
  candidateSkillIds: CouncilSkillId[]
  rejectedSkillIds: RejectedSkill[]
  selectedSkillIds: CouncilSkillId[]
  selectedEntityIds: CouncilEntityId[]
  approvalRequired: boolean
  riskLevel: CouncilSkillRiskLevel
  reason: string
  decisionPath: string[]
  providerRecommendation: null
  timestamp: string
}

export type CouncilDecisionInput = {
  message: string
  timestamp?: string
  routingId?: string
}
