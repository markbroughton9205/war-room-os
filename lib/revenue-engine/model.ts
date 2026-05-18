export const REVENUE_ENGINE_CATEGORIES = [
  'freight',
  'sprinter_van_routes',
  'local_delivery',
  'smb_automation',
  'ai_operations',
  'call_center_customer_operations',
  'scheduling_intake_systems',
  'ai_tooling',
  'consulting',
  'agency_services',
  'app_factory_ideas',
  'data_annotation_evaluation',
  'operational_dashboards',
] as const

export type RevenueEngineCategory = (typeof REVENUE_ENGINE_CATEGORIES)[number]

export const REVENUE_ENGINE_STATUSES = [
  'watching',
  'researching',
  'ready_for_review',
  'approved_to_execute',
  'in_progress',
  'won',
  'lost',
  'paused',
  'archived',
] as const

export type RevenueEngineStatus = (typeof REVENUE_ENGINE_STATUSES)[number]

export const REVENUE_OUTCOME_TYPES = [
  'successful',
  'failed',
  'time_wasted',
  'profitable_workflow',
  'repeatable_pattern',
  'low_roi_distraction',
  'blocked',
] as const

export type RevenueOutcomeType = (typeof REVENUE_OUTCOME_TYPES)[number]

export type RevenueMetricKey =
  | 'leverageScore'
  | 'confidence'
  | 'urgency'
  | 'startupCost'
  | 'scalability'
  | 'automationPotential'
  | 'repeatability'
  | 'timeToProfit'
  | 'strategicAlignment'
  | 'stressLoad'
  | 'familyImpact'
  | 'longTermCompoundingValue'

export type RevenueScoreBreakdown = Record<RevenueMetricKey, number>

export type RevenueOpportunityInput = {
  title: string
  category: RevenueEngineCategory
  notes?: string | null
  source?: string | null
  estimatedRevenue?: number | null
  estimatedTimeHours?: number | null
  startupCostUsd?: number | null
  regionalSignal?: string | null
  shipperPainPoint?: string | null
  smbPainPoint?: string | null
  nextReviewAction?: string | null
  scores?: Partial<Omit<RevenueScoreBreakdown, 'leverageScore'>>
}

export type RevenueOpportunity = {
  id: string
  title: string
  category: RevenueEngineCategory
  status: RevenueEngineStatus
  source: string
  notes: string
  estimatedRevenue: number | null
  estimatedTimeHours: number | null
  startupCostUsd: number | null
  regionalSignal: string | null
  shipperPainPoint: string | null
  smbPainPoint: string | null
  nextReviewAction: string
  score: RevenueScoreBreakdown
  priorityRank: number
  familyImpactEstimate: 'positive' | 'neutral' | 'watch' | 'high_stress'
  guardrails: {
    recommendationOnly: true
    approvalRequired: true
    externalExecutionAllowed: false
    hiddenExecutionAllowed: false
    incomeClaimed: false
  }
  createdAt: string
  updatedAt: string | null
  metadata?: Record<string, unknown>
}

export type RevenueOutcome = {
  id: string
  opportunityId: string | null
  outcomeType: RevenueOutcomeType
  summary: string
  estimatedRoi: number | null
  actualRevenueAmount: number | null
  timeSpentHours: number | null
  validated: boolean
  evidence: Record<string, unknown>
  createdAt: string
}

export type RevenueLeverageScore = {
  id: string
  opportunityId: string | null
  category: RevenueEngineCategory
  score: RevenueScoreBreakdown
  rationale: string
  createdAt: string
}

export type RevenueExecutionPattern = {
  id: string
  category: RevenueEngineCategory
  patternType: 'profitable_repeat' | 'bottleneck' | 'low_roi' | 'compounding_asset' | 'family_stress_risk'
  title: string
  summary: string
  confidence: number
  approvalRequired: true
  canExecute: false
  createdAt: string
}

export type RevenueStrategicAlert = {
  id: string
  kind: 'high_opportunity' | 'low_roi_warning' | 'distraction_warning' | 'execution_bottleneck' | 'compounding_opportunity'
  severity: 'info' | 'watch' | 'important' | 'critical'
  title: string
  summary: string
  sourceAttribution: string
  approvalRequired: true
  canExecute: false
}

export type HighestLeverageMove = {
  title: string
  summary: string
  opportunityId: string | null
  score: number
  whyNow: string
  nextManualAction: string
  approvalRequired: true
  canExecute: false
}

export type RevenueEngineSnapshot = {
  generatedAt: string
  persistenceAvailable: boolean
  persistenceNote: string
  categories: readonly RevenueEngineCategory[]
  opportunities: RevenueOpportunity[]
  outcomes: RevenueOutcome[]
  leverageScores: RevenueLeverageScore[]
  executionPatterns: RevenueExecutionPattern[]
  highestLeverageMove: HighestLeverageMove
  strategicAlerts: RevenueStrategicAlert[]
  stats: {
    activeOpportunities: number
    averageLeverageScore: number
    estimatedPipelineRevenue: number
    repeatablePatterns: number
    lowRoiWarnings: number
    compoundingOpportunities: number
  }
  guardrails: {
    recommendationOnly: true
    approvalRequired: true
    hiddenExecution: false
    autonomousDeployment: false
    filesystemMutation: false
    shellExecution: false
    fakeIncomeClaims: false
  }
}

