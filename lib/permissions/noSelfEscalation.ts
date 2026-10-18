/**
 * #22 Phase 1 — No-self-escalation + child inheritance ceilings.
 */
import type { PolicyAuthorityLevel, TechnicalReachLevel } from '@/lib/agent-capability-matrix/types'
import { NO_SELF_ESCALATION_INVARIANTS } from '@/lib/agent-capability-matrix/governance'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'

const AUTHORITY_RANK: Record<PolicyAuthorityLevel, number> = {
  DENIED: 0,
  NOT_APPLICABLE: 0,
  SYSTEM_INTERNAL: 1,
  READ_ALLOWED: 2,
  BOUNDED_ALLOWED: 3,
  APPROVAL_REQUIRED: 4,
  COMMANDER_ONLY: 5,
}

const REACH_RANK: Record<TechnicalReachLevel, number> = {
  NO_REACH: 0,
  UNKNOWN: 0,
  DISCOVER_ONLY: 1,
  READ_ONLY: 2,
  WRITE_BOUNDED: 3,
  EXECUTE_SANDBOXED: 4,
  EXECUTE_CONTROLLED: 5,
  FULL_TECHNICAL_REACH: 6,
}

export function assertNoSelfApproval(requestingActorId: string, approvingActorId: string): PolicyDecision | null {
  if (requestingActorId === approvingActorId && requestingActorId !== 'commander') {
    return {
      outcome: 'DENY',
      reasonCode: 'SELF_ESCALATION_DENIED',
      reason: 'Agent self-approval is forbidden.',
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
  return null
}

export function assertChildDoesNotExceedParent(input: {
  parentReach: TechnicalReachLevel
  childReach: TechnicalReachLevel
  parentAuthority: PolicyAuthorityLevel
  childAuthority: PolicyAuthorityLevel
}): PolicyDecision | null {
  if (REACH_RANK[input.childReach] > REACH_RANK[input.parentReach]) {
    return {
      outcome: 'DENY',
      reasonCode: 'CHILD_AUTHORITY_EXCEEDS_PARENT',
      reason: 'Child technical reach cannot exceed parent technical reach.',
      actionKind: 'agent_spawn',
      canonicalKind: 'agent_spawn',
      riskTier: 'TIER_3_EXTERNAL_REMOTE_MUTATION',
      technicalReach: input.childReach,
      policyAuthority: 'DENIED',
      requiresApproval: true,
      approvalSatisfied: false,
      httpStatus: 403,
    }
  }
  if (AUTHORITY_RANK[input.childAuthority] > AUTHORITY_RANK[input.parentAuthority]) {
    return {
      outcome: 'DENY',
      reasonCode: 'CHILD_AUTHORITY_EXCEEDS_PARENT',
      reason: 'Child policy authority cannot exceed parent policy authority.',
      actionKind: 'agent_spawn',
      canonicalKind: 'agent_spawn',
      riskTier: 'TIER_3_EXTERNAL_REMOTE_MUTATION',
      technicalReach: input.childReach,
      policyAuthority: 'DENIED',
      requiresApproval: true,
      approvalSatisfied: false,
      httpStatus: 403,
    }
  }
  return null
}

export function assertCouncilCannotAuthorizeExecution(): PolicyDecision {
  return {
    outcome: 'DENY',
    reasonCode: 'COUNCIL_CANNOT_AUTHORIZE',
    reason: 'Council recommendation is not execution authorization.',
    actionKind: 'council_authorization',
    canonicalKind: null,
    riskTier: 'TIER_3_EXTERNAL_REMOTE_MUTATION',
    technicalReach: null,
    policyAuthority: 'DENIED',
    requiresApproval: true,
    approvalSatisfied: false,
    httpStatus: 403,
  }
}

export function assertTerraCannotAuthorizeAction(): PolicyDecision {
  return {
    outcome: 'DENY',
    reasonCode: 'TERRA_CANNOT_AUTHORIZE',
    reason: 'Terra evidence informs decisions but cannot create authority.',
    actionKind: 'terra_authorization',
    canonicalKind: null,
    riskTier: 'TIER_2_PERSISTENT_INTERNAL_MUTATION',
    technicalReach: 'READ_ONLY',
    policyAuthority: 'DENIED',
    requiresApproval: true,
    approvalSatisfied: false,
    httpStatus: 403,
  }
}

export function assertAstraMissionNotExecutionAuthority(): PolicyDecision {
  return {
    outcome: 'DENY',
    reasonCode: 'ASTRA_MISSION_NOT_EXECUTION_AUTHORITY',
    reason: 'MISSION CREATED != ACTION AUTHORIZED. PLANNED != RUNNING.',
    actionKind: 'astra_mission',
    canonicalKind: null,
    riskTier: 'TIER_2_PERSISTENT_INTERNAL_MUTATION',
    technicalReach: 'WRITE_BOUNDED',
    policyAuthority: 'COMMANDER_ONLY',
    requiresApproval: true,
    approvalSatisfied: false,
    httpStatus: 403,
  }
}

export function assertServiceRoleNotPolicyPermission(): PolicyDecision {
  return {
    outcome: 'DENY',
    reasonCode: 'SERVICE_ROLE_NOT_POLICY_PERMISSION',
    reason: 'Service-role technical reach does not imply ownership or policy permission.',
    actionKind: 'supabase_service_role',
    canonicalKind: null,
    riskTier: 'TIER_2_PERSISTENT_INTERNAL_MUTATION',
    technicalReach: 'FULL_TECHNICAL_REACH',
    policyAuthority: 'SYSTEM_INTERNAL',
    requiresApproval: true,
    approvalSatisfied: false,
    httpStatus: 403,
  }
}

export function noSelfEscalationInvariantsPresent(): boolean {
  return NO_SELF_ESCALATION_INVARIANTS.length >= 6
}
