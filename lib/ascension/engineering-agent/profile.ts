/**
 * #22 Phase 3 — ENGINEERING_AGENT capability profile + Phase 1 deny enforcement.
 */
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import { assertNoSelfApproval, assertChildDoesNotExceedParent } from '@/lib/permissions/noSelfEscalation'

export const ENGINEERING_AGENT_ALLOWED_CAPABILITIES = [
  'REPOSITORY_READ',
  'GIT_METADATA_READ',
  'APPROVED_WORKTREE_READ',
  'APPROVED_WORKTREE_BOUNDED_WRITE',
  'SOURCE_BOUNDED_MODIFY',
  'PATCH_CREATE_APPLY_SCOPED',
  'DIFF_READ_GENERATE',
  'VALIDATION_RUN_APPROVED',
  'TEST_RUN_APPROVED',
  'BUILD_RUN_APPROVED_NON_PROD',
  'STATIC_ANALYSIS_APPROVED',
  'COUNCIL_RETURN_ENGINEERING_FINDINGS',
  'ASTRA_RECEIVE_BOUNDED_TASK',
  'ASTRA_RETURN_RESULT',
  'INTERNAL_AUDIT_WRITE',
] as const
export type EngineeringAgentAllowedCapability = (typeof ENGINEERING_AGENT_ALLOWED_CAPABILITIES)[number]

export const ENGINEERING_AGENT_DENIED_ALIASES = [
  'GIT_COMMIT',
  'GIT_PUSH',
  'GIT_FORCE_PUSH',
  'GIT_REBASE',
  'GIT_RESET_HARD',
  'GIT_CLEAN',
  'PRODUCTION_DEPLOY',
  'PRODUCTION_RESTART',
  'PROCESS_TERMINATE',
  'ARBITRARY_SHELL',
  'ARBITRARY_POWERSHELL',
  'SHELL_EXECUTE',
  'POWERSHELL_EXECUTE',
  'SQL_EXECUTE',
  'DATABASE_WRITE',
  'DATABASE_SCHEMA_CHANGE',
  'DATABASE_ARBITRARY_WRITE',
  'SECRET_CHANGE',
  'ENVIRONMENT_CHANGE',
  'POLICY_CHANGE',
  'APPROVAL_CHANGE',
  'AGENT_SPAWN',
  'EXTERNAL_MUTATION',
  'MESSAGE_SEND',
  'PHONE_OUTBOUND',
  'FINANCIAL_SPEND',
  'FINANCIAL_TRANSFER',
  'TRADE',
  'WAGER',
  'SETTLEMENT_SUBMIT',
  'CRAWL_EXPANSION',
] as const

const ENGINEERING_AGENT_ROLE_CONST = 'ENGINEERING_AGENT'

export function denyEngineeringAgentAction(
  actionKindOrAlias: string,
  requestingActorId = ENGINEERING_AGENT_ROLE_CONST,
): PolicyDecision {
  const decision = evaluateGovernedAction({
    mode: 'commander',
    safetyLock: true,
    actionKind: actionKindOrAlias,
    body: {},
    commanderSessionOk: false,
    requestingActorId,
    approvingActorId: requestingActorId,
  })
  if (decision.outcome === 'ALLOW') {
    return {
      ...decision,
      outcome: 'DENY',
      reasonCode: 'POLICY_DENIED',
      reason: `ENGINEERING_AGENT cannot perform ${actionKindOrAlias}.`,
      httpStatus: 403,
      approvalSatisfied: false,
    }
  }
  return decision
}

export function assertEngineeringAgentCannotSelfApprove(): PolicyDecision {
  return (
    assertNoSelfApproval('ENGINEERING_AGENT', 'ENGINEERING_AGENT') ?? {
      outcome: 'DENY',
      reasonCode: 'SELF_ESCALATION_DENIED',
      reason: 'ENGINEERING_AGENT cannot approve itself.',
      actionKind: 'approval',
      canonicalKind: null,
      riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
      technicalReach: 'DISCOVER_ONLY',
      policyAuthority: 'DENIED',
      requiresApproval: true,
      approvalSatisfied: false,
      httpStatus: 403,
    }
  )
}

export function assertEngineeringChildDoesNotExceedParent(
  parentAuthority: 'BOUNDED_ALLOWED' | 'COMMANDER_ONLY' | string,
  childAuthority: 'BOUNDED_ALLOWED' | 'COMMANDER_ONLY' | string,
): PolicyDecision {
  return (
    assertChildDoesNotExceedParent({
      parentReach: 'WRITE_BOUNDED',
      childReach: 'FULL_TECHNICAL_REACH',
      parentAuthority: (parentAuthority as 'BOUNDED_ALLOWED') || 'BOUNDED_ALLOWED',
      childAuthority: (childAuthority as 'COMMANDER_ONLY') || 'COMMANDER_ONLY',
    }) ?? {
      outcome: 'DENY',
      reasonCode: 'CHILD_AUTHORITY_EXCEEDS_PARENT',
      reason: 'ENGINEERING_AGENT privilege amplification denied.',
      actionKind: 'policy_change',
      canonicalKind: 'policy_change',
      riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
      technicalReach: 'DISCOVER_ONLY',
      policyAuthority: 'DENIED',
      requiresApproval: true,
      approvalSatisfied: false,
      httpStatus: 403,
    }
  )
}

export function assertEngineeringAgentCapabilityAllowed(
  capability: EngineeringAgentAllowedCapability | string,
): boolean {
  return (ENGINEERING_AGENT_ALLOWED_CAPABILITIES as readonly string[]).includes(capability)
}
