import type { AutomationModeDefinition } from './automationModeRegistry'
import type { ExecutionCheckpoint } from './executionCheckpointEngine'
import type { ExecutionDomainDefinition } from './executionDomainRegistry'

export type AutomationPolicyDecision = {
  domainId: ExecutionDomainDefinition['id']
  modeId: AutomationModeDefinition['id']
  status: 'allowed_for_planning' | 'blocked' | 'commander_review_required'
  rationale: string
  hardStops: string[]
  safeguards: string[]
  actualExecutionAllowed: false
}

export function decideAutomationPolicy(
  domain: ExecutionDomainDefinition,
  mode: AutomationModeDefinition,
  checkpoint: ExecutionCheckpoint,
): AutomationPolicyDecision {
  const hardStops = [
    domain.restrictions.some(rule => rule.toLowerCase().includes('no payment')) && domain.financialLimits.spendCeilingUsd > 0
      ? 'Financial domain cannot initiate payments or carry spend ceilings.'
      : null,
    mode.id === 'full_auto_domain' && !domain.allowedModes.includes('full_auto_domain')
      ? 'Full auto mode is not approved for this domain.'
      : null,
    checkpoint.decision === 'blocked' ? 'Checkpoint blocked the request.' : null,
    checkpoint.decision === 'rollback_required' ? 'Rollback is required before any retry.' : null,
  ].filter((item): item is string => Boolean(item))
  const status = hardStops.length
    ? 'blocked'
    : checkpoint.decision === 'approved' && mode.id !== 'manual'
      ? 'commander_review_required'
      : 'allowed_for_planning'

  return {
    domainId: domain.id,
    modeId: mode.id,
    status,
    rationale: status === 'blocked'
      ? hardStops[0]
      : status === 'commander_review_required'
        ? 'Planning is ready, but real execution remains gated by explicit Commander approval and persistence.'
        : 'Planning and readiness display are allowed; no execution path is exposed.',
    hardStops,
    safeguards: [
      ...mode.safeguards,
      'Audit reconstruction required',
      'Commander revocation remains available',
      'Read-only API surface only',
    ],
    actualExecutionAllowed: false,
  }
}
