import type { CouncilEntityId } from '../entities/types'

export type CouncilSkillId =
  | 'system_architecture'
  | 'engineering_review'
  | 'feasibility_analysis'
  | 'long_reasoning_decomposition'
  | 'business_strategy'
  | 'planning'
  | 'synthesis'
  | 'writing'
  | 'command_translation'
  | 'knowledge_organization'
  | 'research_review'
  | 'pattern_recognition'
  | 'cross_reference'
  | 'source_comparison'
  | 'current_signal_detection'
  | 'internet_awareness'
  | 'market_intelligence'
  | 'opportunity_sensing'
  | 'realtime_context_framing'
  | 'implementation_planning'
  | 'task_sequencing'
  | 'technical_execution_planning'
  | 'operations_mapping'
  | 'dependency_mapping'
  | 'assumption_challenge'
  | 'risk_analysis'
  | 'contradiction_checking'
  | 'scam_detection'
  | 'stress_testing'

export type CouncilSkillCategory =
  | 'reasoning'
  | 'planning'
  | 'research'
  | 'implementation'
  | 'review'
  | 'risk'
  | 'memory'
  | 'communication'
  | 'coordination'

export type CouncilSkillRiskLevel =
  | 'low'
  | 'medium'
  | 'high'
  | 'financial'
  | 'legal'
  | 'identity'
  | 'deployment'

export type CouncilSkillActivationStatus =
  | 'foundation'
  | 'available'
  | 'disabled'
  | 'requires_tooling'

export type CouncilSkillDefinition = {
  id: CouncilSkillId
  displayName: string
  description: string
  category: CouncilSkillCategory
  ownerEntityIds: CouncilEntityId[]
  supportingEntityIds: CouncilEntityId[]
  requiredTools: string[]
  riskLevel: CouncilSkillRiskLevel
  approvalRequired: boolean
  memoryEligible: boolean
  learningEligible: boolean
  activationStatus: CouncilSkillActivationStatus
  createdAt: string
  updatedAt: string
}

export type CouncilSkillSummary = {
  id: CouncilSkillId
  displayName: string
  category: CouncilSkillCategory
  ownerEntityIds: CouncilEntityId[]
  riskLevel: CouncilSkillRiskLevel
  approvalRequired: boolean
  activationStatus: CouncilSkillActivationStatus
}

export type CouncilSpecialtyAlias =
  | 'architecture'
  | 'engineering review'
  | 'systems reasoning'
  | 'long reasoning'
  | 'feasibility'
  | 'strategy'
  | 'planning'
  | 'synthesis'
  | 'writing'
  | 'communication'
  | 'knowledge'
  | 'research'
  | 'pattern recognition'
  | 'cross reference'
  | 'large context'
  | 'current events'
  | 'internet awareness'
  | 'signals'
  | 'market intelligence'
  | 'realtime radar'
  | 'implementation planning'
  | 'task sequencing'
  | 'technical execution'
  | 'decomposition'
  | 'operations'
  | 'challenge assumptions'
  | 'find flaws'
  | 'risk analysis'
  | 'contradiction checking'
  | 'stress test'
