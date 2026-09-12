/**
 * #22 Phase 14 — Authority may decrease; never silently increase.
 * TARGET <= SOURCE <= COMMANDER-AUTHORIZED_SCOPE.
 * Agent result ≠ approval. Council recommendation ≠ approval. ASTRA ≠ Tier-4.
 */
import type { PolicyAuthorityLevel, TechnicalReachLevel } from '@/lib/agent-capability-matrix/types'
import {
  assertAstraMissionNotExecutionAuthority,
  assertChildDoesNotExceedParent,
  assertCouncilCannotAuthorizeExecution,
} from '@/lib/permissions/noSelfEscalation'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import { integrationFailure, type IntegrationFailure } from './failures'

const AUTHORITY_RANK: Record<PolicyAuthorityLevel, number> = {
  DENIED: 0,
  NOT_APPLICABLE: 0,
  SYSTEM_INTERNAL: 1,
  READ_ALLOWED: 2,
  BOUNDED_ALLOWED: 3,
  APPROVAL_REQUIRED: 4,
  COMMANDER_ONLY: 5,
}

export const DEFAULT_SOURCE_AUTHORITY: PolicyAuthorityLevel = 'BOUNDED_ALLOWED'
export const DEFAULT_TARGET_AUTHORITY: PolicyAuthorityLevel = 'BOUNDED_ALLOWED'
export const COMMANDER_AUTHORIZED_SCOPE: PolicyAuthorityLevel = 'COMMANDER_ONLY'
export const DEFAULT_SOURCE_REACH: TechnicalReachLevel = 'READ_ONLY'
export const DEFAULT_TARGET_REACH: TechnicalReachLevel = 'READ_ONLY'

export function assertTargetAuthorityNotIncreased(input: {
  sourceAuthority: PolicyAuthorityLevel
  targetAuthority: PolicyAuthorityLevel
  commanderAuthorizedScope?: PolicyAuthorityLevel
  sourceReach?: TechnicalReachLevel
  targetReach?: TechnicalReachLevel
}): IntegrationFailure | null {
  const commander = input.commanderAuthorizedScope ?? COMMANDER_AUTHORIZED_SCOPE
  if (AUTHORITY_RANK[input.targetAuthority] > AUTHORITY_RANK[input.sourceAuthority]) {
    return integrationFailure('AUTHORITY_DENIED', 'TARGET_AUTHORITY cannot exceed SOURCE_AUTHORITY.')
  }
  if (AUTHORITY_RANK[input.sourceAuthority] > AUTHORITY_RANK[commander]) {
    return integrationFailure('AUTHORITY_DENIED', 'SOURCE_AUTHORITY cannot exceed COMMANDER-AUTHORIZED_SCOPE.')
  }
  if (AUTHORITY_RANK[input.targetAuthority] > AUTHORITY_RANK[commander]) {
    return integrationFailure('AUTHORITY_DENIED', 'TARGET_AUTHORITY cannot exceed COMMANDER-AUTHORIZED_SCOPE.')
  }
  if (input.targetAuthority === 'COMMANDER_ONLY') {
    return integrationFailure('AUTHORITY_DENIED', 'Handoff cannot mint Tier-4 / COMMANDER_ONLY authority.')
  }
  const child = assertChildDoesNotExceedParent({
    parentReach: input.sourceReach ?? DEFAULT_SOURCE_REACH,
    childReach: input.targetReach ?? DEFAULT_TARGET_REACH,
    parentAuthority: input.sourceAuthority,
    childAuthority: input.targetAuthority,
  })
  if (child) {
    return integrationFailure('AUTHORITY_DENIED', child.reason)
  }
  return null
}

export function denyHandoffCreatesCommanderAuthority(): IntegrationFailure {
  return integrationFailure('AUTHORITY_DENIED', 'Handoff cannot create Commander / Tier-4 authority.')
}

export function denyRecommendationAsApproval(kind: 'council' | 'astra' | 'agent'): PolicyDecision {
  if (kind === 'council') return assertCouncilCannotAuthorizeExecution()
  if (kind === 'astra') return assertAstraMissionNotExecutionAuthority()
  return {
    outcome: 'DENY',
    reasonCode: 'POLICY_DENIED',
    reason: 'Agent result is not Commander approval.',
    actionKind: 'approval',
    canonicalKind: null,
    riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
    technicalReach: null,
    policyAuthority: 'DENIED',
    requiresApproval: true,
    approvalSatisfied: false,
    httpStatus: 403,
  }
}
