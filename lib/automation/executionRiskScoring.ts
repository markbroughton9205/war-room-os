import type { AutomationModeDefinition } from './automationModeRegistry'
import type { ExecutionDomainDefinition, RiskThreshold } from './executionDomainRegistry'

export type ExecutionRiskScore = {
  score: number
  threshold: RiskThreshold
  band: 'low' | 'moderate' | 'elevated' | 'high'
  blockers: string[]
  warnings: string[]
  factors: {
    financialExposure: number
    rollbackExposure: number
    modeExposure: number
    domainExposure: number
    confidencePenalty: number
  }
}

const thresholdScore: Record<RiskThreshold, number> = {
  low: 35,
  moderate: 55,
  elevated: 70,
  high: 85,
}

const modeExposure: Record<AutomationModeDefinition['id'], number> = {
  manual: 0,
  assisted: 8,
  approval_checkpoint: 18,
  bounded_auto: 30,
  full_auto_domain: 45,
}

function band(score: number): ExecutionRiskScore['band'] {
  if (score >= 75) return 'high'
  if (score >= 55) return 'elevated'
  if (score >= 30) return 'moderate'
  return 'low'
}

export function scoreExecutionRisk(
  domain: ExecutionDomainDefinition,
  mode: AutomationModeDefinition,
): ExecutionRiskScore {
  const financialExposure = Math.min(25, Math.ceil(domain.financialLimits.spendCeilingUsd / 10))
  const rollbackExposure = Math.min(20, Math.ceil(domain.financialLimits.maximumRollbackCostUsd / 5))
  const confidencePenalty = Math.max(0, Math.round((0.9 - domain.financialLimits.minimumConfidenceScore) * 40))
  const domainExposure = thresholdScore[domain.riskThreshold] / 4
  const score = Math.min(100, Math.round(financialExposure + rollbackExposure + confidencePenalty + domainExposure + modeExposure[mode.id]))
  const allowed = score <= thresholdScore[domain.riskThreshold]

  return {
    score,
    threshold: domain.riskThreshold,
    band: band(score),
    blockers: [
      !domain.allowedModes.includes(mode.id) ? `${mode.label} is not allowed in ${domain.label}.` : null,
      !allowed ? `Risk score ${score} exceeds ${domain.riskThreshold} threshold.` : null,
      mode.id === 'full_auto_domain' && domain.riskThreshold === 'high' ? 'High-risk domains cannot enter full auto without additional isolation review.' : null,
    ].filter((item): item is string => Boolean(item)),
    warnings: [
      domain.financialLimits.spendCeilingUsd > 0 ? `Spend exposure capped at $${domain.financialLimits.spendCeilingUsd}.` : null,
      domain.financialLimits.minimumConfidenceScore >= 0.82 ? 'High confidence threshold required before routing.' : null,
    ].filter((item): item is string => Boolean(item)),
    factors: {
      financialExposure,
      rollbackExposure,
      modeExposure: modeExposure[mode.id],
      domainExposure,
      confidencePenalty,
    },
  }
}
