import type { AgentPerformanceMetrics, FoundryAgent } from './agentBlueprints'

export type AgentPerformanceScorecard = {
  agentId: string
  name: string
  reliabilityScore: number
  accuracy: number
  usefulness: number
  contradictionRate: number
  hallucinationIndicators: number
  successfulForecasts: number
  operationalContribution: number
  latencyMs: number
  retrievalQuality: number
  approvalSuccessRate: number
  warning: 'none' | 'watch' | 'degrade'
}

const EMPTY_METRICS: AgentPerformanceMetrics = {
  accuracy: 0,
  usefulness: 0,
  contradictionRate: 0,
  hallucinationIndicators: 0,
  successfulForecasts: 0,
  operationalContribution: 0,
  latencyMs: 0,
  retrievalQuality: 0,
  approvalSuccessRate: 0,
}

function averageMetrics(history: AgentPerformanceMetrics[]): AgentPerformanceMetrics {
  if (!history.length) return EMPTY_METRICS
  const totals = history.reduce((acc, item) => ({
    accuracy: acc.accuracy + item.accuracy,
    usefulness: acc.usefulness + item.usefulness,
    contradictionRate: acc.contradictionRate + item.contradictionRate,
    hallucinationIndicators: acc.hallucinationIndicators + item.hallucinationIndicators,
    successfulForecasts: acc.successfulForecasts + item.successfulForecasts,
    operationalContribution: acc.operationalContribution + item.operationalContribution,
    latencyMs: acc.latencyMs + item.latencyMs,
    retrievalQuality: acc.retrievalQuality + item.retrievalQuality,
    approvalSuccessRate: acc.approvalSuccessRate + item.approvalSuccessRate,
  }), EMPTY_METRICS)
  const divisor = history.length
  return {
    accuracy: totals.accuracy / divisor,
    usefulness: totals.usefulness / divisor,
    contradictionRate: totals.contradictionRate / divisor,
    hallucinationIndicators: totals.hallucinationIndicators / divisor,
    successfulForecasts: totals.successfulForecasts / divisor,
    operationalContribution: totals.operationalContribution / divisor,
    latencyMs: totals.latencyMs / divisor,
    retrievalQuality: totals.retrievalQuality / divisor,
    approvalSuccessRate: totals.approvalSuccessRate / divisor,
  }
}

export function buildAgentScorecard(agent: FoundryAgent): AgentPerformanceScorecard {
  const metrics = averageMetrics(agent.performanceHistory)
  const latencyPenalty = metrics.latencyMs > 0 ? Math.min(metrics.latencyMs / 10_000, 0.15) : 0
  const reliabilityScore = Math.max(0, Math.min(1,
    (metrics.accuracy * 0.24)
    + (metrics.usefulness * 0.18)
    + (metrics.retrievalQuality * 0.16)
    + (metrics.approvalSuccessRate * 0.14)
    + (metrics.operationalContribution * 0.14)
    + (Math.min(metrics.successfulForecasts / 10, 1) * 0.08)
    - (metrics.contradictionRate * 0.18)
    - (metrics.hallucinationIndicators * 0.2)
    - latencyPenalty,
  ))
  const warning = reliabilityScore < 0.45 || metrics.hallucinationIndicators > 0.2
    ? 'degrade'
    : reliabilityScore < 0.65 || metrics.contradictionRate > 0.25
      ? 'watch'
      : 'none'
  return {
    agentId: agent.id,
    name: agent.name,
    reliabilityScore,
    warning,
    ...metrics,
  }
}

export function rankAgentReliability(agents: FoundryAgent[]): AgentPerformanceScorecard[] {
  return agents.map(buildAgentScorecard).sort((a, b) => b.reliabilityScore - a.reliabilityScore)
}

export function getPerformanceBehavior() {
  return 'Scorecards combine accuracy, usefulness, contradictions, hallucination indicators, forecast success, contribution, latency, retrieval quality, and approval success; warnings do not execute changes automatically.'
}
