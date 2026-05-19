import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

/** Required fields for each actionable opportunity packet (Phase 32B). */
export type OpportunityPacket = {
  opportunityTitle: string
  startupCost: string
  estimatedRevenue: string
  timeToLaunch: string
  toolsRequired: string[]
  targetCustomer: string
  executionDifficulty: 'low' | 'medium' | 'high' | string
  confidence: number
  risks: string[]
  whyNow: string
}

export type OpportunityEvidenceLabel = 'LIVE_SIGNAL_BACKED' | 'HISTORICAL_PATTERN_BASED'

export type OpportunityApprovalStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED'

export type OperatorOpportunityFilterId =
  | 'under500'
  | 'recurring'
  | 'local'
  | 'remote'
  | 'ai-based'
  | 'logistics-aligned'
  | 'passive'
  | 'service-based'

export type ScoutOpportunity = OpportunityPacket & {
  id: string
  threadId: string
  family: CouncilOrchestrationFamily
  providerId: string
  evidenceLabel: OpportunityEvidenceLabel
  approvalStatus: OpportunityApprovalStatus
  filterTags: OperatorOpportunityFilterId[]
  estimatedRoi: number | null
  generatedAt: string
}

export const OPPORTUNITY_REQUIRED_KEYS: (keyof OpportunityPacket)[] = [
  'opportunityTitle',
  'startupCost',
  'estimatedRevenue',
  'timeToLaunch',
  'toolsRequired',
  'targetCustomer',
  'executionDifficulty',
  'confidence',
  'risks',
  'whyNow',
]

export const OPPORTUNITY_MANDATE_FAMILIES: CouncilOrchestrationFamily[] = [
  'chatgpt',
  'claude',
  'grok',
  'gemini',
  'red_team',
]

export function familyRequiresOpportunity(family: CouncilOrchestrationFamily): boolean {
  return OPPORTUNITY_MANDATE_FAMILIES.includes(family)
}
