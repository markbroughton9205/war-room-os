import type { CanonicalProviderFamilyStatus, CanonicalRuntimeStatus, CanonicalSubsystemStatus } from '@/lib/runtime/canonicalStatus'
import type { Mission, MissionId } from '@/lib/missions/types'
import type { OutcomeSnapshot } from '@/lib/outcomes/model'
import type { RevenueEngineSnapshot } from '@/lib/revenue-engine/model'
import type { SignalSnapshot } from '@/lib/signals/model'

export type RuntimeGraphNodeKind =
  | 'mission'
  | 'provider'
  | 'subsystem'
  | 'outcome'
  | 'approval'
  | 'signal'
  | 'revenue'
  | 'repair'

export type RuntimeGraphNode = {
  id: string
  label: string
  kind: RuntimeGraphNodeKind
  status: string
  health: 'healthy' | 'degraded' | 'unavailable' | 'unknown'
  score: number
  evidence: string[]
}

export type RuntimeGraphEdge = {
  from: string
  to: string
  reason: string
  strength: number
}

export type RuntimeGraphDerivedState = {
  highestLeverageMove: string | null
  operationalPressure: number
  focusFragmentation: number
  missionDecay: number
  overloadRisk: number
  momentumTrend: 'rising' | 'stable' | 'decaying' | 'unknown'
  blockedSystems: string[]
  degradedProviders: string[]
  stalledOutcomes: string[]
  unfinishedLoops: string[]
  compoundingWins: string[]
  approvalBottlenecks: string[]
  executionDrift: string[]
}

export type SourceBackedMetric = {
  label: string
  value: string | null
  classification: 'SOURCE_BACKED' | 'UNAVAILABLE'
  source: string | null
}

export type FinancialTelemetry = {
  totalLiquidEstimate: SourceBackedMetric
  projected30DayIncome: SourceBackedMetric
  reinvestmentTriggerProgress: SourceBackedMetric
  debtFreedomProgress: SourceBackedMetric
  weeklyTrend: SourceBackedMetric
  monthlyTrend: SourceBackedMetric
}

export type RuntimeGraphInputs = {
  canonical: CanonicalRuntimeStatus
  missions: Mission[]
  outcomes: OutcomeSnapshot
  revenue: RevenueEngineSnapshot
  signals: SignalSnapshot
  approvals: Array<{ id: string; type: string; status: string; title: string | null; created_at: string }>
}

export type RuntimeGraphSnapshot = {
  generatedAt: string
  missions: Mission[]
  nodes: RuntimeGraphNode[]
  edges: RuntimeGraphEdge[]
  derived: RuntimeGraphDerivedState
  financialTelemetry: FinancialTelemetry
  providers: CanonicalProviderFamilyStatus[]
  subsystems: CanonicalSubsystemStatus[]
  sourceSnapshots: {
    canonicalGeneratedAt: string
    outcomesGeneratedAt: string
    revenueGeneratedAt: string
    signalsGeneratedAt: string
  }
  guardrails: {
    noFakeTelemetry: true
    sourceBackedFinancialClaimsOnly: true
    noAutonomousExecution: true
    approvalAuthorityPreserved: true
  }
}

export const MISSION_CATEGORY_HINTS: Record<MissionId, readonly string[]> = {
  'phase-0-cashflow-base': ['freight', 'sprinter', 'delivery', 'cashflow', 'income'],
  'content-automation': ['content', 'automation', 'media', 'calendar'],
  'automation-services': ['automation', 'SMB', 'customer', 'service', 'intake'],
  'real-estate-monitor': ['real estate', 'property', 'Ohio', 'Akron'],
  'debt-freedom-trigger': ['debt', 'freedom', 'revenue', 'cashflow'],
}
