export const COMMANDER_REVIEW_PERIODS = ['daily', 'weekly', 'monthly'] as const

export type CommanderReviewPeriod = (typeof COMMANDER_REVIEW_PERIODS)[number]

export type CommanderDirection = 'unknown' | 'advancing' | 'holding' | 'drifting' | 'overloaded'

export type CommanderSeverity = 'info' | 'watch' | 'important' | 'critical'

export type CommanderPatternKind =
  | 'leverage_zone'
  | 'distraction'
  | 'bottleneck'
  | 'compounding_win'
  | 'repeated_failure'
  | 'best_workflow'
  | 'best_execution_window'
  | 'burnout_load'

export type CommanderProfileInput = {
  activeGoals?: string[]
  unfinishedInitiatives?: string[]
  recurringBottlenecks?: string[]
  strongestLeverageZones?: string[]
  distractionPatterns?: string[]
  bestExecutionWindows?: string[]
  bestWorkflows?: string[]
  stressLoadScore?: number | null
  familyImpactScore?: number | null
  notes?: string | null
  evidence?: Record<string, unknown>
}

export type CommanderProfile = {
  id: string
  activeGoals: string[]
  unfinishedInitiatives: string[]
  recurringBottlenecks: string[]
  strongestLeverageZones: string[]
  distractionPatterns: string[]
  bestExecutionWindows: string[]
  bestWorkflows: string[]
  stressLoadScore: number
  familyImpactScore: number
  notes: string
  approvalRequired: true
  canExecute: false
  evidence: Record<string, unknown>
  createdAt: string
  updatedAt: string | null
}

export type CommanderMetrics = {
  id: string
  leverageScore: number
  executionScore: number
  focusStability: number
  momentumScore: number
  compoundingScore: number
  burnoutRisk: number
  strategicAlignment: number
  opportunityResponsiveness: number
  timeToActionHours: number | null
  incomePerHourEstimate: number | null
  roiTrend: 'unknown' | 'up' | 'flat' | 'down'
  trajectoryDirection: CommanderDirection
  sourceSummary: {
    outcomeCount: number
    activeOpportunityCount: number
    signalCount: number
    calendarRecommendationCount: number
    explicitProfileAvailable: boolean
  }
  evidence: Record<string, unknown>
  generatedAt: string
}

export type CommanderPattern = {
  id: string
  kind: CommanderPatternKind
  title: string
  summary: string
  score: number
  severity: CommanderSeverity
  source: 'outcome_ledger' | 'revenue_engine' | 'signal_radar' | 'growth_calendar' | 'baby_ai' | 'commander_profile' | 'derived'
  approvalRequired: true
  canExecute: false
  evidence: string[]
  generatedAt: string
}

export type CommanderHighestLeverageMove = {
  title: string
  summary: string
  score: number
  whyNow: string
  nextManualAction: string
  sourceBlend: string[]
  approvalRequired: true
  canExecute: false
  evidence: string[]
}

export type CommanderRealityCorrectionAlert = {
  id: string
  severity: CommanderSeverity
  title: string
  summary: string
  leverageDecay: number
  distractionIncrease: number
  growthCalendarAdjustment: 'none' | 'deprioritize_low_value_work' | 'pause_until_evidence' | 'repeat_source_backed_winners'
  redTeamBabyWarning: boolean
  approvalRequired: true
  canExecute: false
  evidence: string[]
}

export type CommanderMomentum = {
  direction: CommanderDirection
  streakDays: number
  inactivityDays: number | null
  unfinishedLoopCount: number
  executionDrift: number
  focusFragmentation: number
  compoundingExecutionCount: number
  summary: string
  evidence: string[]
}

export type CommanderLifePositioning = {
  economicPositioning: number
  skillPositioning: number
  infrastructurePositioning: number
  operationalMaturity: number
  leverageGrowth: number
  strategicOptionality: number
  summary: string
  evidence: string[]
}

export type CommanderTrajectoryPoint = {
  id: string
  period: CommanderReviewPeriod
  direction: CommanderDirection
  leverageScore: number
  executionScore: number
  momentumScore: number
  incomePerHourEstimate: number | null
  summary: string
  approvalRequired: true
  canExecute: false
  evidence: Record<string, unknown>
  createdAt: string
}

export type CommanderReview = {
  id: string
  period: CommanderReviewPeriod
  summary: string
  advancedPosition: string[]
  wastedTime: string[]
  strongestOpportunities: string[]
  highestRoiActions: string[]
  compoundingBehaviors: string[]
  repeatedMistakes: string[]
  nextStrategicFocus: string
  approvalRequired: true
  canExecute: false
  evidence: Record<string, unknown>
  createdAt: string
}

export type CommanderSnapshot = {
  generatedAt: string
  persistenceAvailable: boolean
  persistenceNote: string
  profile: CommanderProfile | null
  metrics: CommanderMetrics
  highestLeverageMove: CommanderHighestLeverageMove
  momentum: CommanderMomentum
  lifePositioning: CommanderLifePositioning
  patterns: CommanderPattern[]
  realityCorrectionAlerts: CommanderRealityCorrectionAlert[]
  reviews: CommanderReview[]
  trajectory: CommanderTrajectoryPoint[]
  integrations: {
    revenueEngine: string[]
    signalRadar: string[]
    outcomeLedger: string[]
    growthCalendar: string[]
    babyAi: string[]
  }
  guardrails: {
    recommendationOnly: true
    approvalGated: true
    noHiddenActions: true
    noAutonomousSpending: true
    noFakeIncomeClaims: true
    noMedicalOrPsychologicalDiagnosis: true
    burnoutIsOperationalLoadOnly: true
    noExternalExecution: true
  }
}
