import type { BabyAgentKey } from '@/lib/baby-ai/model'

export const OUTCOME_CATEGORIES = [
  'freight',
  'sprinter_van',
  'SMB_automation',
  'AI_service',
  'consulting',
  'app_factory',
  'data_annotation',
  'AI_evaluation',
  'customer_operations',
  'lead_generation',
  'outreach',
  'learning',
  'infrastructure',
  'distraction',
  'overbuilding',
  'failed_experiment',
] as const

export type OutcomeCategory = (typeof OUTCOME_CATEGORIES)[number]

export const OUTCOME_RESULT_STATUSES = [
  'profitable',
  'break_even',
  'loss',
  'failed',
  'time_wasted',
  'shipped',
  'not_shipped',
  'abandoned',
  'compounded',
  'needs_review',
] as const

export type OutcomeResultStatus = (typeof OUTCOME_RESULT_STATUSES)[number]

export const OUTCOME_RECOMMENDATIONS = ['repeat', 'avoid', 'iterate', 'monitor'] as const

export type OutcomeRecommendation = (typeof OUTCOME_RECOMMENDATIONS)[number]

export const OUTCOME_APPROVAL_STATUSES = [
  'not_required',
  'pending',
  'approved',
  'rejected',
  'completed',
] as const

export type OutcomeApprovalStatus = (typeof OUTCOME_APPROVAL_STATUSES)[number]

export type OutcomeEntryInput = {
  title: string
  category: OutcomeCategory
  relatedOpportunity?: string | null
  estimatedRevenue?: number | null
  actualRevenue?: number | null
  timeInvestedHours?: number | null
  stressLoad?: number | null
  leverageScore?: number | null
  repeatabilityScore?: number | null
  scalabilityScore?: number | null
  familyImpact?: number | null
  executionDifficulty?: number | null
  resultStatus: OutcomeResultStatus
  whatWorked?: string | null
  whatFailed?: string | null
  lessonsLearned?: string | null
  recommendedRepeatAvoid: OutcomeRecommendation
  linkedFeatureProject?: string | null
  linkedBabyAiFamily?: BabyAgentKey | null
  approvalStatus?: OutcomeApprovalStatus | null
  sourceUri?: string | null
  evidence?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export type OutcomeEntry = {
  id: string
  title: string
  category: OutcomeCategory
  relatedOpportunity: string | null
  estimatedRevenue: number | null
  actualRevenue: number | null
  timeInvestedHours: number | null
  stressLoad: number
  leverageScore: number
  repeatabilityScore: number
  scalabilityScore: number
  familyImpact: number
  executionDifficulty: number
  resultStatus: OutcomeResultStatus
  whatWorked: string
  whatFailed: string
  lessonsLearned: string
  recommendedRepeatAvoid: OutcomeRecommendation
  linkedFeatureProject: string | null
  linkedBabyAiFamily: BabyAgentKey | null
  approvalStatus: OutcomeApprovalStatus
  sourceUri: string | null
  explicitCommanderLog: true
  sourceBacked: boolean
  externalActionPerformedByWarRoom: false
  autonomousSpendPerformed: false
  hiddenActionPerformed: false
  fakeRevenueClaimed: false
  evidence: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string | null
}

export type RoiReviewInput = {
  outcomeId: string
  reviewer?: BabyAgentKey | 'commander' | 'system' | null
  reviewSummary: string
  confidenceBefore?: number | null
  actualResultScore?: number | null
  estimateAccuracy?: number | null
  timeValueScore?: number | null
  distractionScore?: number | null
  leverageAdjustment?: number | null
  recommendedPriorityChange?: 'increase' | 'hold' | 'decrease' | 'deprioritize' | null
  evidence?: Record<string, unknown>
}

export type RoiReview = {
  id: string
  outcomeId: string
  reviewer: BabyAgentKey | 'commander' | 'system'
  reviewSummary: string
  confidenceBefore: number | null
  actualResultScore: number | null
  estimateAccuracy: number | null
  timeValueScore: number | null
  distractionScore: number | null
  leverageAdjustment: number
  recommendedPriorityChange: 'increase' | 'hold' | 'decrease' | 'deprioritize'
  approvalRequired: true
  canExecute: false
  evidence: Record<string, unknown>
  createdAt: string
}

export type ExecutionResult = {
  id: string
  outcomeId: string
  category: OutcomeCategory
  shipped: boolean
  madeMoney: boolean
  wastedTime: boolean
  createdLeverage: boolean
  compounded: boolean
  shouldRepeat: boolean
  shouldAvoid: boolean
  timeToMoneyHours: number | null
  valuePerHour: number | null
  stressAdjustedRoi: number | null
  sourceBacked: boolean
  createdAt: string
}

export type CompoundingPattern = {
  id: string
  category: OutcomeCategory
  title: string
  summary: string
  recurrenceCount: number
  averageActualRevenue: number
  averageValuePerHour: number | null
  averageStressLoad: number
  confidence: number
  recommendation: 'repeat' | 'scale_carefully' | 'study_more'
  approvalRequired: true
  canExecute: false
  evidence: Record<string, unknown>
  createdAt: string
  updatedAt: string | null
}

export type FailurePattern = {
  id: string
  category: OutcomeCategory
  title: string
  summary: string
  recurrenceCount: number
  estimatedRevenueMiss: number
  timeLostHours: number
  confidence: number
  recommendedAvoidance: string
  approvalRequired: true
  canExecute: false
  evidence: Record<string, unknown>
  createdAt: string
  updatedAt: string | null
}

export type TimeWastePattern = {
  id: string
  category: OutcomeCategory
  title: string
  summary: string
  recurrenceCount: number
  timeLostHours: number
  distractionScore: number
  priorityDecay: number
  approvalRequired: true
  canExecute: false
  evidence: Record<string, unknown>
  createdAt: string
  updatedAt: string | null
}

export type RealityCorrectionAlert = {
  id: string
  severity: 'info' | 'watch' | 'important' | 'critical'
  title: string
  summary: string
  category: OutcomeCategory | null
  redTeamBabyWarning: boolean
  leverageDecay: number
  distractionIncrease: number
  priorityAdjustment: 'none' | 'deprioritize_similar' | 'pause_until_evidence' | 'repeat_winners'
  approvalRequired: true
  canExecute: false
  evidence: string[]
}

export type OutcomeSnapshot = {
  generatedAt: string
  persistenceAvailable: boolean
  persistenceNote: string
  categories: readonly OutcomeCategory[]
  outcomes: OutcomeEntry[]
  reviews: RoiReview[]
  executionResults: ExecutionResult[]
  compoundingPatterns: CompoundingPattern[]
  failurePatterns: FailurePattern[]
  timeWastePatterns: TimeWastePattern[]
  realityCorrectionAlerts: RealityCorrectionAlert[]
  roiTrends: {
    loggedOutcomeCount: number
    profitableOutcomeCount: number
    failedOutcomeCount: number
    totalEstimatedRevenue: number
    totalActualRevenue: number
    estimateDelta: number
    totalTimeInvestedHours: number
    valuePerHour: number | null
    timeWastedHours: number
    averageStressLoad: number
    averageLeverageScore: number
    distractionTrend: 'unknown' | 'low' | 'rising' | 'high'
    actualVsEstimatedPerformance: 'unknown' | 'outperforming' | 'on_track' | 'underperforming'
  }
  highestLeverageCategories: Array<{
    category: OutcomeCategory
    outcomeCount: number
    actualRevenue: number
    valuePerHour: number | null
    averageLeverage: number
    averageStress: number
  }>
  integrations: {
    revenueEngine: string[]
    signalRadar: string[]
    featureBuilder: string[]
    babyAiLearning: string[]
    growthCalendar: string[]
    dailyBriefing: string[]
    priorityEngine: string[]
  }
  guardrails: {
    explicitLoggingOnly: true
    noFakeRevenueClaims: true
    noFabricatedOutcomes: true
    noAutonomousSpending: true
    noHiddenActions: true
    noFakeAiSuccess: true
    sourceBackedOrCommanderLogged: true
    approvalRequiredForExternalAction: true
  }
}
