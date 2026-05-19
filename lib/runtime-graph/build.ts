import type { OutcomeEntry } from '@/lib/outcomes/model'
import type { Mission } from '@/lib/missions/types'
import type {
  FinancialTelemetry,
  RuntimeGraphDerivedState,
  RuntimeGraphEdge,
  RuntimeGraphInputs,
  RuntimeGraphNode,
  RuntimeGraphSnapshot,
  SourceBackedMetric,
} from './types'

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function unavailable(label: string): SourceBackedMetric {
  return { label, value: null, classification: 'UNAVAILABLE', source: null }
}

function sourceBacked(label: string, value: string, source: string): SourceBackedMetric {
  return { label, value, classification: 'SOURCE_BACKED', source }
}

function money(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function daysAgo(iso: string, now = Date.now()): number {
  const timestamp = new Date(iso).getTime()
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor((now - timestamp) / 86_400_000))
}

function isRecentOutcome(outcome: OutcomeEntry, days: number): boolean {
  return daysAgo(outcome.createdAt) <= days || (outcome.updatedAt ? daysAgo(outcome.updatedAt) <= days : false)
}

function buildFinancialTelemetry(outcomes: OutcomeEntry[]): FinancialTelemetry {
  const sourceBackedRevenueOutcomes = outcomes.filter(
    outcome => outcome.sourceBacked && typeof outcome.actualRevenue === 'number' && outcome.actualRevenue >= 0,
  )
  const weeklyRevenue = sourceBackedRevenueOutcomes
    .filter(outcome => isRecentOutcome(outcome, 7))
    .reduce((sum, outcome) => sum + (outcome.actualRevenue ?? 0), 0)
  const monthlyRevenue = sourceBackedRevenueOutcomes
    .filter(outcome => isRecentOutcome(outcome, 30))
    .reduce((sum, outcome) => sum + (outcome.actualRevenue ?? 0), 0)

  return {
    totalLiquidEstimate: unavailable('Total liquid estimate'),
    projected30DayIncome: unavailable('Projected 30 day income'),
    reinvestmentTriggerProgress: unavailable('Reinvestment trigger progress'),
    debtFreedomProgress: unavailable('Debt freedom progress'),
    weeklyTrend: weeklyRevenue > 0
      ? sourceBacked('Weekly trend', money(weeklyRevenue), 'source-backed Outcome Ledger actual revenue within 7 days')
      : unavailable('Weekly trend'),
    monthlyTrend: monthlyRevenue > 0
      ? sourceBacked('Monthly trend', money(monthlyRevenue), 'source-backed Outcome Ledger actual revenue within 30 days')
      : unavailable('Monthly trend'),
  }
}

function missionNode(mission: Mission): RuntimeGraphNode {
  const pressure = mission.blocker_score + mission.priority_score + mission.revenue_score - mission.momentum_score
  return {
    id: `mission:${mission.id}`,
    label: mission.title,
    kind: 'mission',
    status: mission.status,
    health: mission.status === 'BLOCKED' ? 'degraded' : mission.status === 'COMPLETE' ? 'healthy' : 'unknown',
    score: clampScore(pressure / 2),
    evidence: [
      `priority=${mission.priority_score}`,
      `momentum=${mission.momentum_score}`,
      `blocker=${mission.blocker_score}`,
      `revenue=${mission.revenue_score}`,
    ],
  }
}

function strongestMission(missions: Mission[]): Mission | null {
  return [...missions]
    .filter(mission => mission.status !== 'COMPLETE' && mission.status !== 'PAUSED')
    .sort((a, b) => {
      const aScore = a.priority_score + a.revenue_score + a.compounding_score - a.blocker_score + a.momentum_score
      const bScore = b.priority_score + b.revenue_score + b.compounding_score - b.blocker_score + b.momentum_score
      return bScore - aScore
    })[0] ?? null
}

function derivedState(input: RuntimeGraphInputs): RuntimeGraphDerivedState {
  const degradedProviders = input.canonical.providers
    .filter(provider => provider.health !== 'healthy')
    .map(provider => provider.label)
  const blockedSystems = input.canonical.subsystems
    .filter(subsystem => subsystem.health === 'degraded' || subsystem.health === 'unavailable')
    .map(subsystem => subsystem.label)
  const stalledOutcomes = input.outcomes.outcomes
    .filter(outcome => ['failed', 'time_wasted', 'abandoned', 'needs_review'].includes(outcome.resultStatus))
    .slice(0, 6)
    .map(outcome => outcome.title)
  const unfinishedLoops = [
    ...input.approvals.filter(action => action.status === 'requested' || action.status === 'pending').map(action => action.title ?? action.type),
    ...input.revenue.opportunities.filter(item => ['watching', 'researching', 'ready_for_review', 'in_progress'].includes(item.status)).slice(0, 6).map(item => item.title),
  ].slice(0, 8)
  const compoundingWins = [
    ...input.outcomes.compoundingPatterns.map(pattern => pattern.title),
    ...input.outcomes.outcomes.filter(outcome => outcome.resultStatus === 'compounded').map(outcome => outcome.title),
  ].slice(0, 6)
  const approvalBottlenecks = input.approvals
    .filter(action => action.status === 'requested' || action.status === 'pending')
    .map(action => action.title ?? action.type)
  const executionDrift = input.outcomes.timeWastePatterns.map(pattern => pattern.title).slice(0, 6)
  const activeMissionCount = input.missions.filter(mission => mission.status === 'ACTIVE' || mission.status === 'AT_TRIGGER').length
  const missionDecay = clampScore(input.missions.reduce((sum, mission) => sum + Math.max(0, 50 - mission.momentum_score) + mission.blocker_score, 0) / Math.max(1, input.missions.length))
  const operationalPressure = clampScore(blockedSystems.length * 12 + approvalBottlenecks.length * 14 + stalledOutcomes.length * 8 + missionDecay / 2)
  const focusFragmentation = clampScore(activeMissionCount * 15 + unfinishedLoops.length * 5)
  const overloadRisk = clampScore((operationalPressure + focusFragmentation + approvalBottlenecks.length * 10) / 2)
  const momentumAverage = input.missions.reduce((sum, mission) => sum + mission.momentum_score, 0) / Math.max(1, input.missions.length)
  const momentumTrend = momentumAverage >= 65 ? 'rising' : momentumAverage >= 38 ? 'stable' : 'decaying'
  const mission = strongestMission(input.missions)

  return {
    highestLeverageMove: mission ? `Advance ${mission.title}: ${mission.current_stage}` : null,
    operationalPressure,
    focusFragmentation,
    missionDecay,
    overloadRisk,
    momentumTrend,
    blockedSystems,
    degradedProviders,
    stalledOutcomes,
    unfinishedLoops,
    compoundingWins,
    approvalBottlenecks,
    executionDrift,
  }
}

export function buildRuntimeGraph(input: RuntimeGraphInputs): RuntimeGraphSnapshot {
  const missionNodes = input.missions.map(missionNode)
  const providerNodes: RuntimeGraphNode[] = input.canonical.providers.map(provider => ({
    id: `provider:${provider.family}`,
    label: provider.label,
    kind: 'provider',
    status: provider.availability,
    health: provider.health,
    score: provider.confidence,
    evidence: provider.evidence,
  }))
  const subsystemNodes: RuntimeGraphNode[] = input.canonical.subsystems.map(subsystem => ({
    id: `subsystem:${subsystem.id}`,
    label: subsystem.label,
    kind: 'subsystem',
    status: subsystem.truthBoundary,
    health: subsystem.health,
    score: subsystem.confidence,
    evidence: subsystem.evidence,
  }))
  const signalNodes: RuntimeGraphNode[] = input.signals.results.slice(0, 12).map(signal => ({
    id: `signal:${signal.id}`,
    label: signal.title,
    kind: 'signal',
    status: signal.approvalStatus,
    health: signal.guardrails.sourceBacked ? 'healthy' : 'unknown',
    score: signal.scores.highestLeverage,
    evidence: [`source=${signal.source}`, `provider=${signal.provider}`, `url=${signal.url}`],
  }))
  const revenueNodes: RuntimeGraphNode[] = input.revenue.opportunities.slice(0, 12).map(opportunity => ({
    id: `revenue:${opportunity.id}`,
    label: opportunity.title,
    kind: 'revenue',
    status: opportunity.status,
    health: opportunity.guardrails.incomeClaimed ? 'degraded' : 'unknown',
    score: opportunity.score.leverageScore,
    evidence: [`source=${opportunity.source}`, `approvalRequired=${opportunity.guardrails.approvalRequired}`],
  }))
  const approvalNodes: RuntimeGraphNode[] = input.approvals.slice(0, 12).map(action => ({
    id: `approval:${action.id}`,
    label: action.title ?? action.type,
    kind: 'approval',
    status: action.status,
    health: action.status === 'approved' ? 'healthy' : 'unknown',
    score: action.status === 'requested' || action.status === 'pending' ? 82 : 35,
    evidence: [`type=${action.type}`, `created_at=${action.created_at}`],
  }))
  const edges: RuntimeGraphEdge[] = [
    ...input.missions.map(mission => ({ from: `mission:${mission.id}`, to: 'subsystem:approval_gate', reason: 'mission authority remains human-approved', strength: 92 })),
    ...input.signals.results.slice(0, 8).map(signal => ({ from: `signal:${signal.id}`, to: 'subsystem:revenue_engine', reason: 'source-backed signal informs revenue review', strength: signal.scores.confidence })),
    ...input.revenue.opportunities.slice(0, 8).map(opportunity => ({ from: `revenue:${opportunity.id}`, to: 'mission:phase-0-cashflow-base', reason: 'cashflow mission receives revenue candidates', strength: opportunity.score.leverageScore })),
  ]

  return {
    generatedAt: new Date().toISOString(),
    missions: input.missions,
    nodes: [...missionNodes, ...providerNodes, ...subsystemNodes, ...signalNodes, ...revenueNodes, ...approvalNodes],
    edges,
    derived: derivedState(input),
    financialTelemetry: buildFinancialTelemetry(input.outcomes.outcomes),
    providers: input.canonical.providers,
    subsystems: input.canonical.subsystems,
    sourceSnapshots: {
      canonicalGeneratedAt: input.canonical.generatedAt,
      outcomesGeneratedAt: input.outcomes.generatedAt,
      revenueGeneratedAt: input.revenue.generatedAt,
      signalsGeneratedAt: input.signals.generatedAt,
    },
    guardrails: {
      noFakeTelemetry: true,
      sourceBackedFinancialClaimsOnly: true,
      noAutonomousExecution: true,
      approvalAuthorityPreserved: true,
    },
  }
}
