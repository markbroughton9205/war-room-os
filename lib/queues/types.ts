import type { OperatorAction } from '@/lib/operator/deckTypes'

export const QUEUE_DOMAINS = [
  'operator_priority_queue',
  'engineering_queue',
  'runtime_queue',
  'revenue_queue',
  'council_queue',
] as const

export type QueueDomain = (typeof QUEUE_DOMAINS)[number]

export const QUEUE_SOURCE_TYPES = [
  'revenue_opportunity',
  'approval_request',
  'mission_action',
  'debt_progress',
  'operator_review',
  'income_task',
  'runtime_repair',
  'provider_repair',
  'schema_repair',
  'diagnostics',
  'infra_alert',
  'council_proposal',
  'strategic_recommendation',
  'research_packet',
  'contradiction_analysis',
  'lead_generation',
  'arbitrage',
  'contract',
  'automation_income',
  'recurring_revenue_action',
] as const

export type QueueSourceType = (typeof QUEUE_SOURCE_TYPES)[number]

export type QueueSeverity = 'info' | 'watch' | 'important' | 'critical'
export type QueueTruthLabel = 'SOURCE_BACKED' | 'PROPOSED' | 'APPROVAL_REQUIRED' | 'UNAVAILABLE'

export type QueueWeights = {
  revenue: number
  mission: number
  urgency: number
  dependency: number
  confidence: number
  debtFreedom: number
  operatorTime: number
}

export type QueueItem = {
  id: string
  queueType: QueueDomain
  title: string
  translatedTitle: string
  description: string
  sourceType: QueueSourceType
  severity: QueueSeverity
  confidence: number
  revenueImpact: number
  missionImpact: number
  estimatedMinutes: number | null
  approvalRequired: boolean
  operatorVisible: boolean
  engineeringVisible: boolean
  createdAt: string
  resolvedAt: string | null
  priorityScore: number
  truthLabel: QueueTruthLabel
  weights: QueueWeights
  canExecute: false
}

export type QueueSnapshot = {
  generatedAt: string
  queueType: QueueDomain
  items: QueueItem[]
  actions?: OperatorAction[]
  diagnostics: {
    sourceItemCount: number
    persistedItemCount: number
    rejectedOperatorItemCount: number
    cappedAt: number | null
    sortedBy: 'priority_score'
  }
  guardrails: {
    noAutonomousExecution: true
    approvalGatesPreserved: true
    operatorJargonFiltered: boolean
    engineeringInternalsIsolated: boolean
  }
}
