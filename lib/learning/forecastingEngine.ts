export type ForecastConfidence = 'low' | 'medium' | 'high'

export type StrategicForecast = {
  id: string
  scenario: string
  probability: number
  impact: number
  risk: number
  confidence: ForecastConfidence
  assumptions: string[]
  uncertaintyGaps: string[]
  recommendedObservation: string
}

export const STRATEGIC_FORECASTS: StrategicForecast[] = [
  {
    id: 'forecast-source-freshness',
    scenario: 'Source freshness degradation creates stale local intelligence.',
    probability: 0.38,
    impact: 0.72,
    risk: 0.52,
    confidence: 'medium',
    assumptions: ['External source update cadence varies', 'Fallback planner remains read-only'],
    uncertaintyGaps: ['Exact overnight refresh timing by source'],
    recommendedObservation: 'Monitor source age and alert Commander when critical feeds cross freshness thresholds.',
  },
  {
    id: 'forecast-provider-drift',
    scenario: 'Provider answer quality drifts under high queue pressure.',
    probability: 0.31,
    impact: 0.68,
    risk: 0.43,
    confidence: 'medium',
    assumptions: ['Queue pressure increases latency', 'Scorecards are reviewed before routing changes'],
    uncertaintyGaps: ['Provider-side outage telemetry'],
    recommendedObservation: 'Compare hallucination and contradiction misses against latency bands.',
  },
  {
    id: 'forecast-repair-bottleneck',
    scenario: 'Repair throughput bottlenecks around validation and approval waits.',
    probability: 0.46,
    impact: 0.64,
    risk: 0.5,
    confidence: 'high',
    assumptions: ['Build validation remains mandatory', 'Approval gates are preserved'],
    uncertaintyGaps: ['Future test suite duration'],
    recommendedObservation: 'Track elapsed time from diagnosis to validation and Commander decision.',
  },
]

export function compareForecastScenarios(forecasts: StrategicForecast[] = STRATEGIC_FORECASTS): StrategicForecast[] {
  return [...forecasts].sort((a, b) => b.risk - a.risk)
}

export function getForecastSummary() {
  const ranked = compareForecastScenarios()
  return {
    highestRisk: ranked[0],
    forecastCount: ranked.length,
    averageRisk: ranked.reduce((sum, forecast) => sum + forecast.risk, 0) / ranked.length,
    boundary: 'Forecasts estimate and recommend observations only; they do not trigger external execution.',
  }
}
