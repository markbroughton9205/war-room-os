import type { BabyDailyBriefing } from '@/lib/baby-ai/operationalIntelligence'
import type { GrowthCalendarSnapshot } from '@/lib/growth-calendar/model'
import type { OutcomeEntry, OutcomeSnapshot } from '@/lib/outcomes/model'
import type { RevenueEngineSnapshot, RevenueOpportunity } from '@/lib/revenue-engine/model'
import type { SignalSnapshot } from '@/lib/signals/model'
import type {
  CommanderHighestLeverageMove,
  CommanderLifePositioning,
  CommanderMetrics,
  CommanderMomentum,
  CommanderPattern,
  CommanderProfile,
  CommanderRealityCorrectionAlert,
  CommanderReview,
  CommanderReviewPeriod,
  CommanderTrajectoryPoint,
  CommanderDirection,
} from './model'

type SourceSnapshots = {
  generatedAt: string
  profile: CommanderProfile | null
  outcomes: OutcomeSnapshot
  revenue: RevenueEngineSnapshot
  signals: SignalSnapshot
  calendar: GrowthCalendarSnapshot
  briefing: BabyDailyBriefing
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function average(values: number[]): number {
  const finite = values.filter(Number.isFinite)
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0
}

function daysBetween(now: Date, then: string): number {
  const parsed = new Date(then).getTime()
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.floor((now.getTime() - parsed) / 86_400_000))
}

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/-/g, ' ')
}

function activeRevenueOpportunities(revenue: RevenueEngineSnapshot): RevenueOpportunity[] {
  return revenue.opportunities.filter(item => !['won', 'lost', 'archived'].includes(item.status))
}

function directionFromScores(input: {
  leverageScore: number
  executionScore: number
  momentumScore: number
  burnoutRisk: number
  focusStability: number
}): CommanderDirection {
  if (input.burnoutRisk >= 80) return 'overloaded'
  if (input.momentumScore >= 65 && input.executionScore >= 55 && input.leverageScore >= 55) return 'advancing'
  if (input.focusStability < 40 || input.momentumScore < 35) return 'drifting'
  return 'holding'
}

function recentOutcomes(outcomes: OutcomeEntry[], maxDays: number): OutcomeEntry[] {
  const now = new Date()
  return outcomes.filter(item => daysBetween(now, item.createdAt) <= maxDays)
}

export function buildCommanderMetrics(input: SourceSnapshots): CommanderMetrics {
  const activeOpps = activeRevenueOpportunities(input.revenue)
  const outcomes = input.outcomes.outcomes
  const recent = recentOutcomes(outcomes, 30)
  const executed = outcomes.filter(item => ['profitable', 'break_even', 'shipped', 'compounded', 'failed', 'loss'].includes(item.resultStatus))
  const shippedOrFinished = executed.filter(item => !['not_shipped', 'abandoned'].includes(item.resultStatus))
  const wastedHours = input.outcomes.roiTrends.timeWastedHours
  const totalHours = input.outcomes.roiTrends.totalTimeInvestedHours
  const distractionRatio = totalHours > 0 ? wastedHours / totalHours : 0
  const calendarOverload = input.calendar.stats.overloadWarnings + input.calendar.stats.recoveryAlerts
  const profileStress = input.profile?.stressLoadScore ?? input.outcomes.roiTrends.averageStressLoad
  const avgRevenueLeverage = input.revenue.stats.averageLeverageScore
  const avgOutcomeLeverage = input.outcomes.roiTrends.averageLeverageScore
  const sourceLeverage = average([
    avgRevenueLeverage,
    avgOutcomeLeverage,
    input.signals.strongestSignal?.scores.highestLeverage ?? 0,
    input.calendar.todayHighestLeverageBlock?.score.leverageScore ?? 0,
  ])
  const compoundingCount = input.outcomes.compoundingPatterns.length + input.revenue.stats.compoundingOpportunities
  const profitableRecent = recent.filter(item => (item.actualRevenue ?? 0) > 0 || item.resultStatus === 'profitable' || item.resultStatus === 'compounded')
  const focusStability = clampScore(100 - distractionRatio * 100 - input.outcomes.realityCorrectionAlerts.length * 8 - Math.max(0, (input.profile?.distractionPatterns.length ?? 0) - 1) * 7)
  const executionScore = clampScore(
    (executed.length ? shippedOrFinished.length / executed.length * 58 : 24)
    + (profitableRecent.length * 7)
    + (input.calendar.stats.approvedEvents * 3)
    - (input.outcomes.roiTrends.failedOutcomeCount * 5),
  )
  const momentumScore = clampScore(
    (recent.length * 12)
    + (profitableRecent.length * 9)
    + (input.calendar.events.filter(item => item.status === 'completed').length * 6)
    - (input.profile?.unfinishedInitiatives.length ?? 0) * 3
    - input.outcomes.timeWastePatterns.length * 8,
  )
  const burnoutRisk = clampScore(
    average([profileStress, input.outcomes.roiTrends.averageStressLoad, 100 - (input.profile?.familyImpactScore ?? 70)])
    + calendarOverload * 10
    + input.calendar.recommendations.filter(item => item.score.energyCost >= 75).length * 2,
  )
  const leverageScore = clampScore(sourceLeverage + compoundingCount * 4 - input.outcomes.timeWastePatterns.length * 8)
  const compoundingScore = clampScore(compoundingCount * 18 + input.outcomes.executionResults.filter(item => item.compounded).length * 8)
  const strategicAlignment = clampScore(average([
    avgRevenueLeverage,
    input.calendar.todayHighestLeverageBlock?.score.compoundingValue ?? 0,
    input.signals.strongestSignal?.scores.strategicAlignment ?? 0,
    input.profile?.strongestLeverageZones.length ? 70 : 45,
  ]))
  const opportunityResponsiveness = clampScore(
    activeOpps.filter(item => ['ready_for_review', 'approved_to_execute', 'in_progress'].includes(item.status)).length * 14
    + input.signals.results.filter(item => item.approvalStatus === 'pending_review').length * 5
    + input.calendar.recommendations.filter(item => item.source === 'signal_radar' || item.source === 'revenue_engine').length * 3,
  )
  const firstActionDates = activeOpps
    .map(item => item.updatedAt ?? item.createdAt)
    .filter((value): value is string => Boolean(value))
    .map(value => daysBetween(new Date(), value) * 24)
  const timeToActionHours = firstActionDates.length ? Math.min(...firstActionDates) : null
  const incomePerHourEstimate = input.outcomes.roiTrends.valuePerHour
  const roiTrend = input.outcomes.roiTrends.actualVsEstimatedPerformance === 'outperforming'
    ? 'up'
    : input.outcomes.roiTrends.actualVsEstimatedPerformance === 'underperforming'
      ? 'down'
      : input.outcomes.roiTrends.actualVsEstimatedPerformance === 'on_track'
        ? 'flat'
        : 'unknown'
  const trajectoryDirection = directionFromScores({ leverageScore, executionScore, momentumScore, burnoutRisk, focusStability })

  return {
    id: `commander-metrics-${input.generatedAt.slice(0, 10)}`,
    leverageScore,
    executionScore,
    focusStability,
    momentumScore,
    compoundingScore,
    burnoutRisk,
    strategicAlignment,
    opportunityResponsiveness,
    timeToActionHours,
    incomePerHourEstimate,
    roiTrend,
    trajectoryDirection,
    sourceSummary: {
      outcomeCount: outcomes.length,
      activeOpportunityCount: activeOpps.length,
      signalCount: input.signals.results.length,
      calendarRecommendationCount: input.calendar.recommendations.length,
      explicitProfileAvailable: Boolean(input.profile),
    },
    evidence: {
      outcomeIds: outcomes.slice(0, 12).map(item => item.id),
      revenueOpportunityIds: activeOpps.slice(0, 12).map(item => item.id),
      signalIds: input.signals.results.slice(0, 12).map(item => item.id),
      operationalLoadOnly: true,
    },
    generatedAt: input.generatedAt,
  }
}

export function buildCommanderPatterns(input: SourceSnapshots): CommanderPattern[] {
  const generatedAt = input.generatedAt
  const patterns: CommanderPattern[] = []

  input.outcomes.highestLeverageCategories.slice(0, 4).forEach(item => {
    patterns.push({
      id: `commander-leverage-${item.category}`,
      kind: 'leverage_zone',
      title: `Strong leverage zone: ${label(item.category)}`,
      summary: `${item.outcomeCount} explicit outcome(s), ${item.valuePerHour == null ? 'unknown value/hour' : `$${Math.round(item.valuePerHour)}/h`}, average stress ${Math.round(item.averageStress)}.`,
      score: clampScore(item.averageLeverage),
      severity: item.averageLeverage >= 75 ? 'important' : 'info',
      source: 'outcome_ledger',
      approvalRequired: true,
      canExecute: false,
      evidence: [`actual revenue ${Math.round(item.actualRevenue)}`, `${item.outcomeCount} outcome rows`],
      generatedAt,
    })
  })

  input.outcomes.timeWastePatterns.forEach(pattern => {
    patterns.push({
      id: `commander-distraction-${pattern.id}`,
      kind: 'distraction',
      title: pattern.title,
      summary: pattern.summary,
      score: pattern.distractionScore,
      severity: pattern.distractionScore >= 80 ? 'critical' : 'watch',
      source: 'outcome_ledger',
      approvalRequired: true,
      canExecute: false,
      evidence: [`${pattern.recurrenceCount} repeated signal(s)`, `${Math.round(pattern.timeLostHours)}h low-value work`],
      generatedAt,
    })
  })

  input.outcomes.failurePatterns.forEach(pattern => {
    patterns.push({
      id: `commander-failure-${pattern.id}`,
      kind: 'repeated_failure',
      title: pattern.title,
      summary: pattern.summary,
      score: clampScore(pattern.confidence * 100),
      severity: pattern.recurrenceCount >= 3 ? 'critical' : 'important',
      source: 'outcome_ledger',
      approvalRequired: true,
      canExecute: false,
      evidence: [`${pattern.recurrenceCount} repeated failure(s)`, `${Math.round(pattern.timeLostHours)}h logged`],
      generatedAt,
    })
  })

  input.outcomes.compoundingPatterns.forEach(pattern => {
    patterns.push({
      id: `commander-compound-${pattern.id}`,
      kind: 'compounding_win',
      title: pattern.title,
      summary: pattern.summary,
      score: clampScore(pattern.confidence * 100 + pattern.recurrenceCount * 10),
      severity: pattern.recommendation === 'repeat' ? 'important' : 'info',
      source: 'outcome_ledger',
      approvalRequired: true,
      canExecute: false,
      evidence: [`${pattern.recurrenceCount} repeatable outcome(s)`, `average revenue ${Math.round(pattern.averageActualRevenue)}`],
      generatedAt,
    })
  })

  input.revenue.executionPatterns.slice(0, 4).forEach(pattern => {
    patterns.push({
      id: `commander-revenue-pattern-${pattern.id}`,
      kind: pattern.patternType === 'profitable_repeat' || pattern.patternType === 'compounding_asset' ? 'compounding_win' : 'bottleneck',
      title: pattern.title,
      summary: pattern.summary,
      score: clampScore(pattern.confidence * 100),
      severity: pattern.patternType === 'low_roi' || pattern.patternType === 'bottleneck' ? 'watch' : 'info',
      source: 'revenue_engine',
      approvalRequired: true,
      canExecute: false,
      evidence: [label(pattern.category), pattern.patternType],
      generatedAt,
    })
  })

  input.profile?.bestExecutionWindows.forEach((window, index) => {
    patterns.push({
      id: `commander-window-${index}`,
      kind: 'best_execution_window',
      title: `Best execution window: ${window}`,
      summary: 'Commander-profiled window. Treat as explicit self-log until backed by outcomes.',
      score: 60,
      severity: 'info',
      source: 'commander_profile',
      approvalRequired: true,
      canExecute: false,
      evidence: ['explicit Commander profile'],
      generatedAt,
    })
  })

  input.profile?.bestWorkflows.forEach((workflow, index) => {
    patterns.push({
      id: `commander-workflow-${index}`,
      kind: 'best_workflow',
      title: workflow,
      summary: 'Commander-profiled workflow. Outcome Ledger can later confirm or reject this pattern.',
      score: 60,
      severity: 'info',
      source: 'commander_profile',
      approvalRequired: true,
      canExecute: false,
      evidence: ['explicit Commander profile'],
      generatedAt,
    })
  })

  return patterns.sort((a, b) => b.score - a.score).slice(0, 24)
}

export function buildHighestLeverageMove(input: SourceSnapshots, metrics: CommanderMetrics): CommanderHighestLeverageMove {
  const redTeamBlocker = input.outcomes.realityCorrectionAlerts.find(alert => alert.severity === 'critical' || alert.priorityAdjustment === 'pause_until_evidence')
  if (redTeamBlocker && metrics.focusStability < 50) {
    return {
      title: `Reality check before more ${redTeamBlocker.category ? label(redTeamBlocker.category) : 'new work'}`,
      summary: redTeamBlocker.summary,
      score: clampScore(80 + redTeamBlocker.leverageDecay / 2),
      whyNow: 'Repeated failure or low-ROI evidence is strong enough that more building could compound waste.',
      nextManualAction: 'Commander should either log corrective evidence or approve a smaller source-backed validation step before similar work continues.',
      sourceBlend: ['Outcome Ledger', 'Red Team Baby', 'Growth Calendar'],
      approvalRequired: true,
      canExecute: false,
      evidence: redTeamBlocker.evidence,
    }
  }

  const compounding = input.outcomes.compoundingPatterns[0]
  const revenueMove = input.revenue.highestLeverageMove
  const calendarBlock = input.calendar.todayHighestLeverageBlock
  const strongestSignal = input.signals.strongestSignal

  if (compounding && compounding.averageActualRevenue > 0) {
    return {
      title: `Repeat the proven ${label(compounding.category)} loop`,
      summary: compounding.summary,
      score: clampScore(82 + compounding.recurrenceCount * 4 - compounding.averageStressLoad / 6),
      whyNow: 'Outcome Ledger has explicit repeated wins; repeating winners beats starting unsupported work.',
      nextManualAction: 'Approve one constrained block that repeats the same source-backed workflow and logs the outcome afterward.',
      sourceBlend: ['Outcome Ledger', 'Revenue Engine', 'Growth Calendar'],
      approvalRequired: true,
      canExecute: false,
      evidence: [`${compounding.recurrenceCount} repeated outcome(s)`, `average revenue ${Math.round(compounding.averageActualRevenue)}`],
    }
  }

  if (revenueMove.score >= (strongestSignal?.scores.highestLeverage ?? 0)) {
    return {
      title: revenueMove.title,
      summary: revenueMove.summary,
      score: clampScore(revenueMove.score),
      whyNow: revenueMove.whyNow,
      nextManualAction: revenueMove.nextManualAction,
      sourceBlend: ['Revenue Engine', 'Signal Radar', 'Baby AI'],
      approvalRequired: true,
      canExecute: false,
      evidence: [revenueMove.opportunityId ?? 'no opportunity id', 'Revenue Engine recommendation only'],
    }
  }

  if (strongestSignal) {
    return {
      title: strongestSignal.title,
      summary: strongestSignal.summary,
      score: strongestSignal.scores.highestLeverage,
      whyNow: `Signal urgency ${strongestSignal.scores.urgency}, income potential ${strongestSignal.scores.incomePotential}, confidence ${strongestSignal.scores.confidence}.`,
      nextManualAction: strongestSignal.recommendedNextAction,
      sourceBlend: ['Signal Radar', 'Revenue Engine', 'Baby AI'],
      approvalRequired: true,
      canExecute: false,
      evidence: [strongestSignal.url, strongestSignal.source],
    }
  }

  if (calendarBlock) {
    return {
      title: calendarBlock.title,
      summary: calendarBlock.description,
      score: calendarBlock.score.leverageScore,
      whyNow: calendarBlock.reason,
      nextManualAction: `Review and approve an internal ${calendarBlock.recommendedDurationMinutes} minute block if it still fits Commander energy and family load.`,
      sourceBlend: ['Growth Calendar', 'Baby AI'],
      approvalRequired: true,
      canExecute: false,
      evidence: [calendarBlock.source, calendarBlock.id],
    }
  }

  return {
    title: 'Log one real outcome before optimizing',
    summary: 'Commander OS has insufficient explicit/source-backed data to pick a profitable move without guessing.',
    score: 35,
    whyNow: 'Truthful empty state: no outcome or signal is strong enough to claim highest leverage.',
    nextManualAction: 'Record the latest completed initiative with revenue, hours, stress, family impact, and repeat/avoid judgment.',
    sourceBlend: ['Outcome Ledger'],
    approvalRequired: true,
    canExecute: false,
    evidence: ['No fabricated revenue or psychology claims'],
  }
}

export function buildRealityCorrections(input: SourceSnapshots, metrics: CommanderMetrics): CommanderRealityCorrectionAlert[] {
  const alerts: CommanderRealityCorrectionAlert[] = input.outcomes.realityCorrectionAlerts.map(alert => ({
    id: `commander-${alert.id}`,
    severity: alert.severity,
    title: alert.title,
    summary: alert.summary,
    leverageDecay: alert.leverageDecay,
    distractionIncrease: alert.distractionIncrease,
    growthCalendarAdjustment: alert.priorityAdjustment === 'repeat_winners'
      ? 'repeat_source_backed_winners'
      : alert.priorityAdjustment === 'pause_until_evidence'
        ? 'pause_until_evidence'
        : alert.priorityAdjustment === 'deprioritize_similar'
          ? 'deprioritize_low_value_work'
          : 'none',
    redTeamBabyWarning: alert.redTeamBabyWarning,
    approvalRequired: true,
    canExecute: false,
    evidence: alert.evidence,
  }))

  if (metrics.burnoutRisk >= 75) {
    alerts.push({
      id: 'commander-operational-load',
      severity: metrics.burnoutRisk >= 90 ? 'critical' : 'important',
      title: 'Operational load is high',
      summary: 'Burnout risk is an operational load signal only. Reduce stacked high-energy work before approving another deep block.',
      leverageDecay: Math.max(0, metrics.burnoutRisk - 60),
      distractionIncrease: Math.max(0, metrics.burnoutRisk - metrics.focusStability),
      growthCalendarAdjustment: 'pause_until_evidence',
      redTeamBabyWarning: true,
      approvalRequired: true,
      canExecute: false,
      evidence: [`burnout risk ${metrics.burnoutRisk}`, `focus stability ${metrics.focusStability}`, 'not a medical or mental health diagnosis'],
    })
  }

  const overbuilding = input.outcomes.outcomes.filter(item => item.category === 'overbuilding' || item.resultStatus === 'not_shipped' || item.resultStatus === 'abandoned')
  if (overbuilding.length >= 2) {
    alerts.push({
      id: 'commander-overbuilding',
      severity: overbuilding.length >= 4 ? 'critical' : 'important',
      title: 'Overbuilding or abandonment pattern detected',
      summary: `${overbuilding.length} outcome(s) show overbuilding, not shipping, or abandonment. Similar build work should lose priority until tied to a source-backed revenue or learning outcome.`,
      leverageDecay: Math.min(45, overbuilding.length * 10),
      distractionIncrease: Math.min(50, overbuilding.reduce((sum, item) => sum + (item.timeInvestedHours ?? 0), 0)),
      growthCalendarAdjustment: 'deprioritize_low_value_work',
      redTeamBabyWarning: true,
      approvalRequired: true,
      canExecute: false,
      evidence: overbuilding.slice(0, 5).map(item => item.title),
    })
  }

  return alerts.slice(0, 12)
}

export function buildMomentum(input: SourceSnapshots, metrics: CommanderMetrics): CommanderMomentum {
  const now = new Date()
  const outcomes = [...input.outcomes.outcomes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const latest = outcomes[0]
  const inactivityDays = latest ? daysBetween(now, latest.createdAt) : null
  const streakDays = outcomes.filter(item => daysBetween(now, item.createdAt) <= 7).length
  const unfinishedLoopCount = (input.profile?.unfinishedInitiatives.length ?? 0)
    + input.calendar.recommendations.filter(item => item.status === 'proposed').length
    + input.revenue.opportunities.filter(item => ['watching', 'researching', 'ready_for_review'].includes(item.status)).length
  const executionDrift = clampScore(100 - metrics.executionScore + input.outcomes.failurePatterns.length * 8)
  const focusFragmentation = clampScore(100 - metrics.focusStability)
  const compoundingExecutionCount = input.outcomes.executionResults.filter(item => item.compounded || item.shouldRepeat).length

  return {
    direction: metrics.trajectoryDirection,
    streakDays,
    inactivityDays,
    unfinishedLoopCount,
    executionDrift,
    focusFragmentation,
    compoundingExecutionCount,
    summary: inactivityDays == null
      ? 'No explicit outcomes yet; momentum cannot be claimed.'
      : `${streakDays} recent outcome signal(s), ${unfinishedLoopCount} unfinished loop(s), ${compoundingExecutionCount} compounding execution signal(s).`,
    evidence: [
      latest ? `latest outcome: ${latest.title}` : 'no explicit outcome rows',
      `${input.calendar.recommendations.length} calendar recommendation(s)`,
      `${input.revenue.opportunities.length} revenue opportunity row(s)`,
    ],
  }
}

export function buildLifePositioning(input: SourceSnapshots, metrics: CommanderMetrics): CommanderLifePositioning {
  const economicPositioning = clampScore(average([
    metrics.incomePerHourEstimate ? Math.min(100, metrics.incomePerHourEstimate) : 0,
    input.revenue.stats.averageLeverageScore,
    input.signals.strongestSignal?.scores.incomePotential ?? 0,
  ]))
  const skillPositioning = clampScore(average(input.briefing.learning.map(item => item.specializationGrowth * 100)))
  const infrastructurePositioning = clampScore(
    input.briefing.sections.infrastructureConcerns.length
      ? 65 - input.briefing.sections.infrastructureConcerns.filter(item => /unavailable|degraded|risk|bottleneck/i.test(`${item.title} ${item.summary}`)).length * 6
      : 55,
  )
  const operationalMaturity = clampScore(average([
    metrics.executionScore,
    metrics.focusStability,
    input.outcomes.outcomes.length ? 72 : 35,
    input.calendar.stats.proposedRecommendations ? 65 : 45,
  ]))
  const leverageGrowth = clampScore(average([metrics.leverageScore, metrics.compoundingScore, metrics.strategicAlignment]))
  const strategicOptionality = clampScore(average([
    activeRevenueOpportunities(input.revenue).length * 10,
    input.signals.results.length * 5,
    input.profile?.activeGoals.length ? 65 : 35,
  ]))

  return {
    economicPositioning,
    skillPositioning,
    infrastructurePositioning,
    operationalMaturity,
    leverageGrowth,
    strategicOptionality,
    summary: 'Life positioning is derived from explicit outcomes, opportunity surfaces, Baby AI learning rows, calendar load, and operational infrastructure signals.',
    evidence: [
      `${input.outcomes.outcomes.length} outcome(s)`,
      `${activeRevenueOpportunities(input.revenue).length} active revenue opportunity/opportunities`,
      `${input.briefing.learning.length} Baby AI learning signal(s)`,
    ],
  }
}

export function buildCommanderReview(
  input: SourceSnapshots,
  metrics: CommanderMetrics,
  highestLeverageMove: CommanderHighestLeverageMove,
  period: CommanderReviewPeriod,
): CommanderReview {
  const now = new Date(input.generatedAt)
  const maxDays = period === 'daily' ? 1 : period === 'weekly' ? 7 : 31
  const scopedOutcomes = input.outcomes.outcomes.filter(item => daysBetween(now, item.createdAt) <= maxDays)
  const advancedPosition = scopedOutcomes
    .filter(item => (item.actualRevenue ?? 0) > 0 || item.resultStatus === 'shipped' || item.resultStatus === 'compounded' || item.recommendedRepeatAvoid === 'repeat')
    .slice(0, 5)
    .map(item => `${item.title} (${label(item.resultStatus)})`)
  const wastedTime = scopedOutcomes
    .filter(item => item.resultStatus === 'time_wasted' || item.recommendedRepeatAvoid === 'avoid' || item.category === 'distraction' || item.category === 'overbuilding')
    .slice(0, 5)
    .map(item => `${item.title} (${item.timeInvestedHours ?? 'unknown'}h)`)
  const strongestOpportunities = input.revenue.opportunities.slice(0, 5).map(item => item.title)
  const highestRoiActions = input.outcomes.highestLeverageCategories.slice(0, 5).map(item => `${label(item.category)} (${item.valuePerHour == null ? 'value/hour unknown' : `$${Math.round(item.valuePerHour)}/h`})`)
  const compoundingBehaviors = input.outcomes.compoundingPatterns.slice(0, 5).map(item => item.title)
  const repeatedMistakes = [...input.outcomes.failurePatterns, ...input.outcomes.timeWastePatterns].slice(0, 5).map(item => item.title)

  return {
    id: `commander-review-${period}-${input.generatedAt.slice(0, 10)}`,
    period,
    summary: `${label(period)} Commander review: trajectory ${metrics.trajectoryDirection}, leverage ${metrics.leverageScore}, execution ${metrics.executionScore}, operational load ${metrics.burnoutRisk}.`,
    advancedPosition,
    wastedTime,
    strongestOpportunities,
    highestRoiActions,
    compoundingBehaviors,
    repeatedMistakes,
    nextStrategicFocus: highestLeverageMove.nextManualAction,
    approvalRequired: true,
    canExecute: false,
    evidence: {
      period,
      scopedOutcomeCount: scopedOutcomes.length,
      highestLeverageMove: highestLeverageMove.title,
      noExternalAction: true,
    },
    createdAt: input.generatedAt,
  }
}

export function buildTrajectoryPoint(input: SourceSnapshots, metrics: CommanderMetrics, period: CommanderReviewPeriod): CommanderTrajectoryPoint {
  return {
    id: `commander-trajectory-${period}-${input.generatedAt.slice(0, 10)}`,
    period,
    direction: metrics.trajectoryDirection,
    leverageScore: metrics.leverageScore,
    executionScore: metrics.executionScore,
    momentumScore: metrics.momentumScore,
    incomePerHourEstimate: metrics.incomePerHourEstimate,
    summary: `Commander trajectory is ${metrics.trajectoryDirection}; based on explicit/source-backed data only.`,
    approvalRequired: true,
    canExecute: false,
    evidence: {
      sourceSummary: metrics.sourceSummary,
      roiTrend: metrics.roiTrend,
      burnoutRiskOperationalOnly: metrics.burnoutRisk,
    },
    createdAt: input.generatedAt,
  }
}

export type { SourceSnapshots }
