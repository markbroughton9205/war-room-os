import { getAutomationMode } from './automationModeRegistry'
import type { AutomationEscalationPlan } from './automationEscalationPlanner'
import type { AutomationPolicyDecision } from './automationPolicyEngine'
import type { AutomationThrottleState } from './automationThrottleController'
import type { ExecutionCheckpoint } from './executionCheckpointEngine'
import type { ExecutionDomainDefinition } from './executionDomainRegistry'
import type { ExecutionRollbackPlan } from './executionRollbackPlanner'
import type { ExecutionRiskScore } from './executionRiskScoring'
import type { ExecutionSimulationResult } from './executionSimulation'

export type BoundedExecutionPlan = {
  id: string
  domainId: ExecutionDomainDefinition['id']
  modeId: ExecutionDomainDefinition['defaultMode']
  label: string
  summary: string
  queueScope: string[]
  policy: AutomationPolicyDecision
  checkpoint: ExecutionCheckpoint
  risk: ExecutionRiskScore
  simulation: ExecutionSimulationResult
  throttle: AutomationThrottleState
  rollback: ExecutionRollbackPlan
  escalation: AutomationEscalationPlan
  actualExecutionAllowed: false
}

export function buildBoundedExecutionPlan(input: {
  domain: ExecutionDomainDefinition
  policy: AutomationPolicyDecision
  checkpoint: ExecutionCheckpoint
  risk: ExecutionRiskScore
  simulation: ExecutionSimulationResult
  throttle: AutomationThrottleState
  rollback: ExecutionRollbackPlan
  escalation: AutomationEscalationPlan
}): BoundedExecutionPlan {
  const mode = getAutomationMode(input.domain.defaultMode)
  return {
    id: `${input.domain.id}:${input.domain.defaultMode}`,
    domainId: input.domain.id,
    modeId: input.domain.defaultMode,
    label: `${input.domain.label} / ${mode?.label ?? input.domain.defaultMode}`,
    summary: `${input.domain.purpose} Policy: ${input.policy.status}.`,
    queueScope: input.domain.queueScope,
    policy: input.policy,
    checkpoint: input.checkpoint,
    risk: input.risk,
    simulation: input.simulation,
    throttle: input.throttle,
    rollback: input.rollback,
    escalation: input.escalation,
    actualExecutionAllowed: false,
  }
}
