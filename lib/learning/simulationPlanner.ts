import { STRATEGIC_FORECASTS, type StrategicForecast } from './forecastingEngine'

export type SimulationScenario = {
  id: string
  title: string
  comparedForecastIds: string[]
  expectedBenefit: number
  residualRisk: number
  assumptions: string[]
  recommendedDecision: string
  approvalBoundary: string
}

export const SIMULATION_SCENARIOS: SimulationScenario[] = [
  {
    id: 'simulation-source-fallback',
    title: 'Increase source fallback review before synthesis',
    comparedForecastIds: ['forecast-source-freshness'],
    expectedBenefit: 0.72,
    residualRisk: 0.24,
    assumptions: ['Fallback sources are already configured', 'No paid source is added automatically'],
    recommendedDecision: 'Prefer analyst output with two-source overlap during stale-source windows.',
    approvalBoundary: 'Adding new paid or external data sources requires Commander approval.',
  },
  {
    id: 'simulation-repair-validation-window',
    title: 'Reserve validation window before repair execution',
    comparedForecastIds: ['forecast-repair-bottleneck'],
    expectedBenefit: 0.64,
    residualRisk: 0.31,
    assumptions: ['Validation remains mandatory', 'Repair execution waits for approval'],
    recommendedDecision: 'Estimate test/build duration before presenting repair plans for approval.',
    approvalBoundary: 'No patch, deploy, or rollback may execute without approval.',
  },
]

export function getSimulationScenarios(): SimulationScenario[] {
  const forecastIds = new Set(STRATEGIC_FORECASTS.map(forecast => forecast.id))
  return SIMULATION_SCENARIOS.filter(scenario => (
    scenario.comparedForecastIds.every(id => forecastIds.has(id))
  ))
}

export function compareSimulationToForecast(scenario: SimulationScenario): { scenario: SimulationScenario; forecasts: StrategicForecast[]; riskDelta: number } {
  const forecasts = STRATEGIC_FORECASTS.filter(forecast => scenario.comparedForecastIds.includes(forecast.id))
  const forecastRisk = forecasts.length ? forecasts.reduce((sum, forecast) => sum + forecast.risk, 0) / forecasts.length : scenario.residualRisk

  return {
    scenario,
    forecasts,
    riskDelta: Math.max(0, forecastRisk - scenario.residualRisk),
  }
}
