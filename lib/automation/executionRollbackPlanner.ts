import type { AutomationModeDefinition } from './automationModeRegistry'
import type { ExecutionDomainDefinition } from './executionDomainRegistry'

export type ExecutionRollbackPlan = {
  domainId: ExecutionDomainDefinition['id']
  modeId: AutomationModeDefinition['id']
  required: boolean
  complexity: 'none' | 'low' | 'moderate' | 'high'
  estimatedCostUsd: number
  steps: string[]
  commanderReviewRequired: true
  rollbackReady: boolean
}

export function planExecutionRollback(
  domain: ExecutionDomainDefinition,
  mode: AutomationModeDefinition,
): ExecutionRollbackPlan {
  const required = mode.rollbackPlanRequired || domain.financialLimits.maximumRollbackCostUsd > 0
  const estimatedCostUsd = domain.financialLimits.maximumRollbackCostUsd
  const complexity = !required
    ? 'none'
    : estimatedCostUsd > 50 || domain.riskThreshold === 'high'
      ? 'high'
      : estimatedCostUsd > 10 || domain.riskThreshold === 'elevated'
        ? 'moderate'
        : 'low'

  return {
    domainId: domain.id,
    modeId: mode.id,
    required,
    complexity,
    estimatedCostUsd,
    steps: required
      ? [
          'Pause domain queue and prevent retries.',
          domain.rollbackBehavior,
          'Attach audit record and simulation snapshot.',
          'Require Commander review before retry or mode escalation.',
        ]
      : ['No external mutation exists; discard prepared recommendation packet.'],
    commanderReviewRequired: true,
    rollbackReady: !required || domain.rollbackBehavior.length > 0,
  }
}
