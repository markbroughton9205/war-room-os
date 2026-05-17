import type { AutomationModeDefinition } from './automationModeRegistry'
import type { ExecutionDomainDefinition } from './executionDomainRegistry'
import type { ExecutionRiskScore } from './executionRiskScoring'
import type { ExecutionRollbackPlan } from './executionRollbackPlanner'

export type ExecutionSimulationResult = {
  domainId: ExecutionDomainDefinition['id']
  modeId: AutomationModeDefinition['id']
  expectedGain: string
  expectedRisk: string
  unknowns: string[]
  contradictions: string[]
  dependencies: string[]
  degradationPotential: 'low' | 'moderate' | 'high'
  rollbackComplexity: ExecutionRollbackPlan['complexity']
  confidenceScore: number
  realExecutionPerformed: false
}

export function simulateExecution(
  domain: ExecutionDomainDefinition,
  mode: AutomationModeDefinition,
  risk: ExecutionRiskScore,
  rollback: ExecutionRollbackPlan,
): ExecutionSimulationResult {
  const confidenceScore = Math.max(0.35, Math.min(0.95, domain.financialLimits.minimumConfidenceScore - risk.score / 300))
  const degradationPotential = risk.score >= 70 ? 'high' : risk.score >= 45 ? 'moderate' : 'low'

  return {
    domainId: domain.id,
    modeId: mode.id,
    expectedGain: mode.executionAllowed
      ? `${domain.label} can reduce recurring coordination load while staying inside ${domain.queueScope.join(', ')} queues.`
      : `${domain.label} can produce clearer recommendations without execution.`,
    expectedRisk: risk.blockers[0] ?? `${risk.band} risk with ${domain.riskThreshold} domain threshold.`,
    unknowns: [
      'Actual queue backlog at execution time',
      'Freshness of doctrine and memory bindings',
      'Commander approval state for any queued action',
    ],
    contradictions: domain.escalationRules.filter(rule => rule.toLowerCase().includes('contradiction')),
    dependencies: [
      'Doctrine validation',
      'Queue validation',
      'Permission validation',
      'Financial boundary validation',
      'Red Team scan',
      'Rollback packet',
    ],
    degradationPotential,
    rollbackComplexity: rollback.complexity,
    confidenceScore: Number(confidenceScore.toFixed(2)),
    realExecutionPerformed: false,
  }
}
