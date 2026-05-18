import type {
  CompoundingPattern,
  ExecutionResult,
  FailurePattern,
  OutcomeCategory,
  OutcomeEntry,
  OutcomeSnapshot,
  RealityCorrectionAlert,
  RoiReview,
  TimeWastePattern,
} from './model'

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function average(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function valuePerHour(outcome: OutcomeEntry): number | null {
  if (typeof outcome.actualRevenue !== 'number' || typeof outcome.timeInvestedHours !== 'number') return null
  if (outcome.timeInvestedHours <= 0) return null
  return outcome.actualRevenue / outcome.timeInvestedHours
}

function stressAdjustedRoi(outcome: OutcomeEntry): number | null {
  const hourly = valuePerHour(outcome)
  if (hourly == null) return null
  return hourly * (1 - Math.min(90, outcome.stressLoad) / 140)
}

export function buildExecutionResult(outcome: OutcomeEntry): ExecutionResult {
  const madeMoney = (outcome.actualRevenue ?? 0) > 0
  const wastedTime = outcome.resultStatus === 'time_wasted' || outcome.recommendedRepeatAvoid === 'avoid'
  return {
    id: `execution-${outcome.id}`,
    outcomeId: outcome.id,
    category: outcome.category,
    shipped: ['shipped', 'profitable', 'compounded'].includes(outcome.resultStatus),
    madeMoney,
    wastedTime,
    createdLeverage: outcome.leverageScore >= 70 && !wastedTime,
    compounded: outcome.resultStatus === 'compounded' || (outcome.repeatabilityScore >= 75 && outcome.scalabilityScore >= 70 && madeMoney),
    shouldRepeat: outcome.recommendedRepeatAvoid === 'repeat',
    shouldAvoid: outcome.recommendedRepeatAvoid === 'avoid',
    timeToMoneyHours: madeMoney ? outcome.timeInvestedHours : null,
    valuePerHour: valuePerHour(outcome),
    stressAdjustedRoi: stressAdjustedRoi(outcome),
    sourceBacked: outcome.sourceBacked,
    createdAt: outcome.createdAt,
  }
}

export function buildRoiReview(outcome: OutcomeEntry): RoiReview {
  const estimated = outcome.estimatedRevenue ?? 0
  const actual = outcome.actualRevenue ?? 0
  const estimateAccuracy = estimated > 0 ? clampScore(100 - Math.min(100, Math.abs(estimated - actual) / estimated * 100)) : null
  const hourly = valuePerHour(outcome)
  const distractionScore = clampScore(
    (outcome.category === 'distraction' || outcome.category === 'overbuilding' ? 35 : 0)
    + (outcome.resultStatus === 'time_wasted' ? 35 : 0)
    + (outcome.stressLoad > 70 ? 15 : 0)
    + (actual <= 0 && (outcome.timeInvestedHours ?? 0) >= 3 ? 15 : 0),
  )
  const timeValueScore = hourly == null ? null : clampScore(hourly)
  const actualResultScore = clampScore(
    (actual > 0 ? 35 : 0)
    + (outcome.resultStatus === 'profitable' || outcome.resultStatus === 'compounded' ? 25 : 0)
    + (outcome.leverageScore * 0.2)
    + (outcome.repeatabilityScore * 0.1)
    - (outcome.stressLoad * 0.15),
  )
  const leverageAdjustment = outcome.recommendedRepeatAvoid === 'avoid'
    ? -Math.max(10, distractionScore / 2)
    : outcome.recommendedRepeatAvoid === 'repeat'
      ? Math.max(5, outcome.leverageScore / 5)
      : 0
  const recommendedPriorityChange = leverageAdjustment <= -30
    ? 'deprioritize'
    : leverageAdjustment < 0
      ? 'decrease'
      : leverageAdjustment > 10
        ? 'increase'
        : 'hold'

  return {
    id: `roi-${outcome.id}`,
    outcomeId: outcome.id,
    reviewer: 'system',
    reviewSummary: `Reality check from explicit outcome: estimated ${estimated}, actual ${actual}, time ${outcome.timeInvestedHours ?? 'unknown'}h, recommendation ${outcome.recommendedRepeatAvoid}.`,
    confidenceBefore: null,
    actualResultScore,
    estimateAccuracy,
    timeValueScore,
    distractionScore,
    leverageAdjustment: Math.round(leverageAdjustment),
    recommendedPriorityChange,
    approvalRequired: true,
    canExecute: false,
    evidence: {
      explicitCommanderLog: outcome.explicitCommanderLog,
      sourceBacked: outcome.sourceBacked,
      outcomeId: outcome.id,
    },
    createdAt: new Date().toISOString(),
  }
}

function categoryGroups(outcomes: OutcomeEntry[]): Map<OutcomeCategory, OutcomeEntry[]> {
  const groups = new Map<OutcomeCategory, OutcomeEntry[]>()
  outcomes.forEach(outcome => {
    groups.set(outcome.category, [...(groups.get(outcome.category) ?? []), outcome])
  })
  return groups
}

export function detectCompoundingPatterns(outcomes: OutcomeEntry[]): CompoundingPattern[] {
  const patterns: CompoundingPattern[] = []
  categoryGroups(outcomes).forEach((items, category) => {
    const winners = items.filter(item => (
      item.recommendedRepeatAvoid === 'repeat'
      || item.resultStatus === 'profitable'
      || item.resultStatus === 'compounded'
      || (item.actualRevenue ?? 0) > 0
    ))
    if (winners.length < 2) return
    const values = winners.map(valuePerHour).filter((value): value is number => value != null)
    const averageActualRevenue = average(winners.map(item => item.actualRevenue ?? 0))
    patterns.push({
      id: `compound-${category}`,
      category,
      title: `Repeatable ${category.replace(/_/g, ' ')} wins`,
      summary: `${winners.length} explicit outcomes show money, leverage, or repeatability. Repeat only with the same evidence and approval boundaries.`,
      recurrenceCount: winners.length,
      averageActualRevenue,
      averageValuePerHour: values.length ? average(values) : null,
      averageStressLoad: average(winners.map(item => item.stressLoad)),
      confidence: clamp01(winners.length / Math.max(4, items.length)),
      recommendation: winners.length >= 3 && averageActualRevenue > 0 ? 'repeat' : 'study_more',
      approvalRequired: true,
      canExecute: false,
      evidence: { outcomeIds: winners.map(item => item.id), explicitOutcomesOnly: true },
      createdAt: new Date().toISOString(),
      updatedAt: null,
    })
  })
  return patterns
}

export function detectFailurePatterns(outcomes: OutcomeEntry[]): FailurePattern[] {
  const patterns: FailurePattern[] = []
  categoryGroups(outcomes).forEach((items, category) => {
    const failures = items.filter(item => (
      item.recommendedRepeatAvoid === 'avoid'
      || ['failed', 'loss', 'time_wasted', 'abandoned', 'not_shipped'].includes(item.resultStatus)
    ))
    if (failures.length < 2) return
    patterns.push({
      id: `failure-${category}`,
      category,
      title: `Repeated ${category.replace(/_/g, ' ')} failure pattern`,
      summary: `${failures.length} explicit outcomes failed, wasted time, or should be avoided. Red Team Baby should challenge similar future work before it receives priority.`,
      recurrenceCount: failures.length,
      estimatedRevenueMiss: failures.reduce((sum, item) => sum + Math.max(0, (item.estimatedRevenue ?? 0) - (item.actualRevenue ?? 0)), 0),
      timeLostHours: failures.reduce((sum, item) => sum + (item.timeInvestedHours ?? 0), 0),
      confidence: clamp01(failures.length / Math.max(3, items.length)),
      recommendedAvoidance: 'Require source-backed demand, a shipping path, and time-boxed proof before repeating similar work.',
      approvalRequired: true,
      canExecute: false,
      evidence: { outcomeIds: failures.map(item => item.id), explicitOutcomesOnly: true },
      createdAt: new Date().toISOString(),
      updatedAt: null,
    })
  })
  return patterns
}

export function detectTimeWastePatterns(outcomes: OutcomeEntry[]): TimeWastePattern[] {
  const patterns: TimeWastePattern[] = []
  categoryGroups(outcomes).forEach((items, category) => {
    const waste = items.filter(item => (
      item.resultStatus === 'time_wasted'
      || item.category === 'distraction'
      || item.category === 'overbuilding'
      || (item.actualRevenue ?? 0) <= 0 && (item.timeInvestedHours ?? 0) >= 4
    ))
    if (waste.length < 2) return
    const timeLostHours = waste.reduce((sum, item) => sum + (item.timeInvestedHours ?? 0), 0)
    patterns.push({
      id: `time-waste-${category}`,
      category,
      title: `${category.replace(/_/g, ' ')} time sink`,
      summary: `${Math.round(timeLostHours)} hours were logged against low or zero value outcomes in this category.`,
      recurrenceCount: waste.length,
      timeLostHours,
      distractionScore: clampScore(40 + waste.length * 12 + timeLostHours),
      priorityDecay: clampScore(15 + waste.length * 10),
      approvalRequired: true,
      canExecute: false,
      evidence: { outcomeIds: waste.map(item => item.id), explicitOutcomesOnly: true },
      createdAt: new Date().toISOString(),
      updatedAt: null,
    })
  })
  return patterns
}

export function buildRealityCorrectionAlerts(input: {
  outcomes: OutcomeEntry[]
  failurePatterns: FailurePattern[]
  timeWastePatterns: TimeWastePattern[]
  compoundingPatterns: CompoundingPattern[]
}): RealityCorrectionAlert[] {
  const alerts: RealityCorrectionAlert[] = []
  input.failurePatterns.forEach(pattern => {
    alerts.push({
      id: `reality-${pattern.id}`,
      severity: pattern.recurrenceCount >= 3 ? 'critical' : 'important',
      title: `Red Team warning: ${pattern.category.replace(/_/g, ' ')} is failing repeatedly`,
      summary: `${pattern.summary} Similar priorities should decay until a real source-backed correction is logged.`,
      category: pattern.category,
      redTeamBabyWarning: true,
      leverageDecay: Math.min(45, 15 + pattern.recurrenceCount * 10),
      distractionIncrease: Math.min(50, pattern.timeLostHours),
      priorityAdjustment: 'pause_until_evidence',
      approvalRequired: true,
      canExecute: false,
      evidence: [`${pattern.recurrenceCount} failed/avoid outcomes`, `${Math.round(pattern.timeLostHours)}h logged`],
    })
  })
  input.timeWastePatterns.forEach(pattern => {
    alerts.push({
      id: `reality-${pattern.id}`,
      severity: pattern.distractionScore >= 80 ? 'critical' : 'watch',
      title: `Distraction alert: ${pattern.category.replace(/_/g, ' ')} time waste`,
      summary: `${pattern.summary} Priority Engine should deprioritize similar work until an explicit outcome proves value.`,
      category: pattern.category,
      redTeamBabyWarning: true,
      leverageDecay: pattern.priorityDecay,
      distractionIncrease: pattern.distractionScore,
      priorityAdjustment: 'deprioritize_similar',
      approvalRequired: true,
      canExecute: false,
      evidence: [`${pattern.recurrenceCount} waste signals`, `${Math.round(pattern.timeLostHours)}h low-value work`],
    })
  })
  input.compoundingPatterns.slice(0, 3).forEach(pattern => {
    alerts.push({
      id: `reality-${pattern.id}`,
      severity: 'info',
      title: `Compounding loop detected: ${pattern.category.replace(/_/g, ' ')}`,
      summary: `${pattern.summary} Repeat winning behavior, not abstract scoring.`,
      category: pattern.category,
      redTeamBabyWarning: false,
      leverageDecay: 0,
      distractionIncrease: 0,
      priorityAdjustment: 'repeat_winners',
      approvalRequired: true,
      canExecute: false,
      evidence: [`${pattern.recurrenceCount} repeatable outcomes`, `average revenue ${Math.round(pattern.averageActualRevenue)}`],
    })
  })
  if (!input.outcomes.length) {
    alerts.push({
      id: 'reality-no-outcomes',
      severity: 'watch',
      title: 'No real outcomes logged yet',
      summary: 'Outcome Ledger is empty. War Room should not claim ROI, success, revenue, or learning until Commander logs outcomes or source-backed results exist.',
      category: null,
      redTeamBabyWarning: true,
      leverageDecay: 0,
      distractionIncrease: 0,
      priorityAdjustment: 'none',
      approvalRequired: true,
      canExecute: false,
      evidence: ['0 explicit outcome rows'],
    })
  }
  return alerts
}

export function buildRoiTrends(outcomes: OutcomeEntry[]): OutcomeSnapshot['roiTrends'] {
  const totalEstimatedRevenue = outcomes.reduce((sum, item) => sum + (item.estimatedRevenue ?? 0), 0)
  const totalActualRevenue = outcomes.reduce((sum, item) => sum + (item.actualRevenue ?? 0), 0)
  const totalTimeInvestedHours = outcomes.reduce((sum, item) => sum + (item.timeInvestedHours ?? 0), 0)
  const timeWastedHours = outcomes
    .filter(item => ['time_wasted', 'failed', 'abandoned', 'not_shipped', 'loss'].includes(item.resultStatus) || item.recommendedRepeatAvoid === 'avoid')
    .reduce((sum, item) => sum + (item.timeInvestedHours ?? 0), 0)
  const value = totalTimeInvestedHours > 0 ? totalActualRevenue / totalTimeInvestedHours : null
  const distractionRatio = totalTimeInvestedHours > 0 ? timeWastedHours / totalTimeInvestedHours : 0

  return {
    loggedOutcomeCount: outcomes.length,
    profitableOutcomeCount: outcomes.filter(item => (item.actualRevenue ?? 0) > 0 || item.resultStatus === 'profitable').length,
    failedOutcomeCount: outcomes.filter(item => ['failed', 'loss', 'time_wasted', 'abandoned', 'not_shipped'].includes(item.resultStatus)).length,
    totalEstimatedRevenue,
    totalActualRevenue,
    estimateDelta: totalActualRevenue - totalEstimatedRevenue,
    totalTimeInvestedHours,
    valuePerHour: value,
    timeWastedHours,
    averageStressLoad: average(outcomes.map(item => item.stressLoad)),
    averageLeverageScore: average(outcomes.map(item => item.leverageScore)),
    distractionTrend: !outcomes.length ? 'unknown' : distractionRatio >= 0.5 ? 'high' : distractionRatio >= 0.25 ? 'rising' : 'low',
    actualVsEstimatedPerformance: !outcomes.length || totalEstimatedRevenue <= 0
      ? 'unknown'
      : totalActualRevenue >= totalEstimatedRevenue * 1.1
        ? 'outperforming'
        : totalActualRevenue >= totalEstimatedRevenue * 0.8
          ? 'on_track'
          : 'underperforming',
  }
}

export function highestLeverageCategories(outcomes: OutcomeEntry[]): OutcomeSnapshot['highestLeverageCategories'] {
  return [...categoryGroups(outcomes).entries()]
    .map(([category, items]) => {
      const hours = items.reduce((sum, item) => sum + (item.timeInvestedHours ?? 0), 0)
      const actualRevenue = items.reduce((sum, item) => sum + (item.actualRevenue ?? 0), 0)
      return {
        category,
        outcomeCount: items.length,
        actualRevenue,
        valuePerHour: hours > 0 ? actualRevenue / hours : null,
        averageLeverage: average(items.map(item => item.leverageScore)),
        averageStress: average(items.map(item => item.stressLoad)),
      }
    })
    .sort((a, b) => (b.valuePerHour ?? b.actualRevenue) - (a.valuePerHour ?? a.actualRevenue))
    .slice(0, 6)
}
