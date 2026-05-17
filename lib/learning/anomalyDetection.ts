import { OUTCOME_LEDGER_ENTRIES } from './outcomeLedger'
import { STRATEGIC_FORECASTS } from './forecastingEngine'

export type LearningAnomaly = {
  id: string
  severity: 'info' | 'watch' | 'warning' | 'critical'
  signal: string
  source: string
  confidence: number
  recommendedResponse: string
  requiresApprovalBeforeAction: boolean
}

export function detectLearningAnomalies(): LearningAnomaly[] {
  const anomalies: LearningAnomaly[] = OUTCOME_LEDGER_ENTRIES.flatMap(entry => (
    entry.anomalyIndicators.map((indicator, index) => ({
      id: `${entry.id}-anomaly-${index + 1}`,
      severity: entry.status === 'failed' ? 'critical' : 'watch',
      signal: indicator,
      source: entry.title,
      confidence: Math.max(0.5, entry.confidence - 0.08),
      recommendedResponse: 'Escalate for Commander review if the pattern recurs or touches external action.',
      requiresApprovalBeforeAction: true,
    }))
  ))

  const highRiskForecasts = STRATEGIC_FORECASTS.filter(forecast => forecast.risk >= 0.5)
  highRiskForecasts.forEach(forecast => {
    anomalies.push({
      id: `${forecast.id}-risk-watch`,
      severity: 'warning',
      signal: forecast.scenario,
      source: 'forecastingEngine',
      confidence: forecast.confidence === 'high' ? 0.86 : 0.72,
      recommendedResponse: forecast.recommendedObservation,
      requiresApprovalBeforeAction: true,
    })
  })

  return anomalies
}

export function getAnomalySummary() {
  const anomalies = detectLearningAnomalies()
  return {
    total: anomalies.length,
    critical: anomalies.filter(anomaly => anomaly.severity === 'critical').length,
    warnings: anomalies.filter(anomaly => anomaly.severity === 'warning').length,
    commanderControlled: anomalies.every(anomaly => anomaly.requiresApprovalBeforeAction),
  }
}
