import type { AutomationModeDefinition } from './automationModeRegistry'
import type { AutomationThrottleState } from './automationThrottleController'
import type { ExecutionConstraintValidation } from './executionConstraintValidator'
import type { ExecutionDomainDefinition } from './executionDomainRegistry'
import type { ExecutionRiskScore } from './executionRiskScoring'
import type { ExecutionSimulationResult } from './executionSimulation'

export type ExecutionCheckpointDecision = 'approved' | 'blocked' | 'needs_review' | 'degraded' | 'rollback_required'

export type ExecutionCheckpoint = {
  domainId: ExecutionDomainDefinition['id']
  modeId: AutomationModeDefinition['id']
  decision: ExecutionCheckpointDecision
  checks: ExecutionConstraintValidation['checks']
  riskScore: number
  confidenceScore: number
  blockers: string[]
  warnings: string[]
  commanderApprovalRequired: true
  actualExecutionAllowed: false
}

export function evaluateExecutionCheckpoint(
  domain: ExecutionDomainDefinition,
  mode: AutomationModeDefinition,
  constraints: ExecutionConstraintValidation,
  risk: ExecutionRiskScore,
  simulation: ExecutionSimulationResult,
  throttle: AutomationThrottleState,
): ExecutionCheckpoint {
  const decision: ExecutionCheckpointDecision = constraints.blockers.length
    ? 'blocked'
    : throttle.state === 'emergency_shutdown'
      ? 'rollback_required'
      : throttle.state === 'paused'
        ? 'degraded'
        : constraints.warnings.length || simulation.confidenceScore < domain.financialLimits.minimumConfidenceScore
          ? 'needs_review'
          : 'approved'

  return {
    domainId: domain.id,
    modeId: mode.id,
    decision,
    checks: constraints.checks,
    riskScore: risk.score,
    confidenceScore: simulation.confidenceScore,
    blockers: constraints.blockers,
    warnings: [...constraints.warnings, ...throttle.pauseReasons],
    commanderApprovalRequired: true,
    actualExecutionAllowed: false,
  }
}
