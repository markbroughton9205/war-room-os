import type { BabyAgentKey } from '@/lib/baby-ai/model'

export const GROWTH_CALENDAR_EVENT_TYPES = [
  'income_action',
  'feature_build_session',
  'opportunity_follow_up',
  'skill_training',
  'business_development',
  'freight_logistics_outreach',
  'ai_automation_research',
  'family_personal_recovery',
  'war_room_maintenance',
  'council_review',
  'outcome_review',
  'strategic_planning',
  'deep_work_block',
] as const

export type GrowthCalendarEventType = (typeof GROWTH_CALENDAR_EVENT_TYPES)[number]

export const GROWTH_CALENDAR_EVENT_STATUSES = [
  'proposed',
  'planned',
  'completed',
  'cancelled',
  'rejected',
] as const

export type GrowthCalendarEventStatus = (typeof GROWTH_CALENDAR_EVENT_STATUSES)[number]

export const GROWTH_CALENDAR_RECOMMENDATION_STATUSES = [
  'proposed',
  'approved',
  'converted_to_event',
  'rejected',
  'archived',
] as const

export type GrowthCalendarRecommendationStatus = (typeof GROWTH_CALENDAR_RECOMMENDATION_STATUSES)[number]

export type GrowthCalendarFamily = BabyAgentKey

export type GrowthCalendarScore = {
  leverageScore: number
  urgencyScore: number
  incomePotential: number
  energyCost: number
  familyImpact: number
  deadlinePressure: number
  compoundingValue: number
}

export type GrowthCalendarSource =
  | 'revenue_engine'
  | 'signal_radar'
  | 'baby_daily_briefing'
  | 'feature_builder'
  | 'approval_queue'
  | 'outcome_ledger'
  | 'calendar_seed'

export type GrowthCalendarRecommendationInput = {
  title: string
  eventType: GrowthCalendarEventType
  source: GrowthCalendarSource
  sourceId?: string | null
  description?: string | null
  assignedFamily?: GrowthCalendarFamily | null
  reason?: string | null
  recommendedDurationMinutes?: number | null
  recommendedTimeWindow?: string | null
  scores?: Partial<GrowthCalendarScore>
  metadata?: Record<string, unknown>
}

export type GrowthCalendarRecommendation = {
  id: string
  title: string
  eventType: GrowthCalendarEventType
  status: GrowthCalendarRecommendationStatus
  source: GrowthCalendarSource
  sourceId: string | null
  description: string
  score: GrowthCalendarScore
  recommendedDurationMinutes: number
  recommendedTimeWindow: string
  assignedFamily: GrowthCalendarFamily
  reason: string
  approvalRequired: true
  canScheduleExternally: false
  hiddenSchedulingAllowed: false
  createdAt: string
  updatedAt: string | null
  metadata: Record<string, unknown>
}

export type GrowthCalendarEventInput = {
  recommendationId?: string | null
  title: string
  eventType: GrowthCalendarEventType
  plannedStart?: string | null
  plannedEnd?: string | null
  durationMinutes?: number | null
  commanderApproved: boolean
  approvalNote?: string | null
}

export type GrowthCalendarEvent = {
  id: string
  recommendationId: string | null
  title: string
  eventType: GrowthCalendarEventType
  status: GrowthCalendarEventStatus
  plannedStart: string | null
  plannedEnd: string | null
  durationMinutes: number
  approvedByCommander: boolean
  externalCalendarWrite: false
  hiddenSchedulingPerformed: false
  createdAt: string
  updatedAt: string | null
  metadata: Record<string, unknown>
}

export type GrowthCalendarReview = {
  id: string
  recommendationId: string | null
  eventId: string | null
  reviewType: 'council' | 'overload' | 'family_balance' | 'outcome_prompt'
  summary: string
  assignedFamily: GrowthCalendarFamily
  approvalRequired: true
  canExecute: false
  createdAt: string
}

export type GrowthCalendarOutcome = {
  id: string
  eventId: string | null
  recommendationId: string | null
  outcomeType: 'completed' | 'missed' | 'rescheduled' | 'overloaded' | 'useful' | 'low_roi'
  summary: string
  validated: boolean
  evidence: Record<string, unknown>
  createdAt: string
}

export type GrowthCalendarSnapshot = {
  generatedAt: string
  persistenceAvailable: boolean
  persistenceNote: string
  todayHighestLeverageBlock: GrowthCalendarRecommendation | null
  weekPlan: GrowthCalendarRecommendation[]
  recommendations: GrowthCalendarRecommendation[]
  events: GrowthCalendarEvent[]
  reviews: GrowthCalendarReview[]
  outcomes: GrowthCalendarOutcome[]
  alerts: GrowthCalendarReview[]
  stats: {
    proposedRecommendations: number
    approvedEvents: number
    incomeFirstSuggestions: number
    buildSessions: number
    overloadWarnings: number
    recoveryAlerts: number
  }
  integrations: {
    revenueEngine: string[]
    signalRadar: string[]
    babyDailyBriefing: string[]
    featureBuilder: string[]
    approvalQueue: string[]
    outcomeLedger: string[]
  }
  guardrails: {
    recommendationOnlyUntilApproval: true
    commanderApprovalRequired: true
    noExternalCalendarMutation: true
    noHiddenScheduling: true
    noFakeAutomation: true
    noBackgroundActions: true
  }
}
