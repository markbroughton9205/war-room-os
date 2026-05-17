import type { AutomationModeDefinition } from './automationModeRegistry'
import type { ExecutionDomainDefinition } from './executionDomainRegistry'
import type { ExecutionRiskScore } from './executionRiskScoring'

export type ExecutionConstraintValidation = {
  status: 'valid' | 'blocked' | 'needs_review'
  checks: {
    doctrineValidation: boolean
    queueValidation: boolean
    memoryScopeCheck: boolean
    permissionValidation: boolean
    financialBoundaryValidation: boolean
    contradictionScan: boolean
    redTeamScan: boolean
    rollbackPlanPresent: boolean
  }
  blockers: string[]
  warnings: string[]
}

export function validateExecutionConstraints(
  domain: ExecutionDomainDefinition,
  mode: AutomationModeDefinition,
  risk: ExecutionRiskScore,
): ExecutionConstraintValidation {
  const checks = {
    doctrineValidation: domain.memoryScope.includes('doctrine'),
    queueValidation: domain.queueScope.length > 0,
    memoryScopeCheck: domain.memoryScope.length > 0 && !domain.memoryScope.includes('unrestricted'),
    permissionValidation: mode.commanderApprovalRequired && !domain.restrictions.some(rule => rule.toLowerCase().includes('approval bypass')),
    financialBoundaryValidation:
      domain.financialLimits.spendCeilingUsd >= 0 &&
      domain.financialLimits.recurringLimitUsd <= domain.financialLimits.domainBudgetUsd &&
      domain.financialLimits.executionFrequencyPerHour <= 12,
    contradictionScan: domain.escalationRules.some(rule => rule.toLowerCase().includes('contradiction')) || domain.riskThreshold !== 'low',
    redTeamScan: domain.riskThreshold === 'elevated' || domain.riskThreshold === 'high' || mode.id !== 'manual',
    rollbackPlanPresent: !mode.rollbackPlanRequired || domain.rollbackBehavior.length > 0,
  }
  const blockers = [
    !checks.doctrineValidation ? 'Doctrine scope is missing.' : null,
    !checks.queueValidation ? 'Queue scope is missing.' : null,
    !checks.memoryScopeCheck ? 'Memory scope is invalid or unrestricted.' : null,
    !checks.permissionValidation ? 'Commander approval authority is not preserved.' : null,
    !checks.financialBoundaryValidation ? 'Financial guardrails are invalid.' : null,
    !checks.rollbackPlanPresent ? 'Rollback behavior is required for this mode.' : null,
    ...risk.blockers,
  ].filter((item): item is string => Boolean(item))
  const warnings = [
    !checks.contradictionScan ? 'Contradiction scan should be attached before execution.' : null,
    !checks.redTeamScan ? 'Red Team scan not required for manual mode but recommended for escalation.' : null,
    ...risk.warnings,
  ].filter((item): item is string => Boolean(item))

  return {
    status: blockers.length ? 'blocked' : warnings.length ? 'needs_review' : 'valid',
    checks,
    blockers,
    warnings,
  }
}
