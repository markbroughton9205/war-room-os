/**
 * #22 Phase 7 — COUNCIL_VALIDATOR capability profile.
 * VALIDATED != AUTHORIZED. Not a Council member. Not an executor.
 */
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import { assertNoSelfApproval, assertChildDoesNotExceedParent } from '@/lib/permissions/noSelfEscalation'

export const COUNCIL_VALIDATOR_ALLOWED_READ_CLASSES = [
  'COUNCIL_OUTPUT_READ',
  'SESSION_INTELLIGENCE_READ',
  'RESEARCH_RESULT_READ',
  'TERRA_RESULT_READ',
  'SECURITY_RESULT_READ',
  'OPERATIONS_RESULT_READ',
  'ENGINEERING_RESULT_READ',
  'ASTRA_STATUS_READ',
  'EVIDENCE_CONSISTENCY_CHECK',
  'POLICY_BOUNDARY_CHECK',
  'RUNTIME_TRUTH_CHECK',
  'OWNERSHIP_CHECK',
  'RETURN_VALIDATION_RESULT',
  'INTERNAL_AUDIT_WRITE',
] as const

export type CouncilValidatorAllowedReadClass = (typeof COUNCIL_VALIDATOR_ALLOWED_READ_CLASSES)[number]

export const COUNCIL_VALIDATOR_DENIED_ALIASES = [
  'AUTHORIZE_ACTION',
  'APPROVE_ACTION',
  'GRANT_PERMISSION',
  'CHANGE_POLICY',
  'CHANGE_APPROVAL',
  'POLICY_CHANGE',
  'APPROVAL_CHANGE',
  'AGENT_SPAWN',
  'GIT_COMMIT',
  'GIT_PUSH',
  'PRODUCTION_DEPLOY',
  'PRODUCTION_RESTART',
  'PROCESS_TERMINATE',
  'SHELL_EXECUTE',
  'POWERSHELL_EXECUTE',
  'ARBITRARY_SHELL',
  'ARBITRARY_POWERSHELL',
  'SQL_EXECUTE',
  'DATABASE_SCHEMA_CHANGE',
  'MESSAGE_SEND',
  'PHONE_OUTBOUND',
  'FINANCIAL_SPEND',
  'FINANCIAL_TRANSFER',
  'TRADE',
  'WAGER',
  'SETTLEMENT_SUBMIT',
  'CRAWL_EXPANSION',
  'SOURCE_APPROVAL',
  'DEVICE_CONTROL',
  'MISSION_EXECUTION',
] as const

const ROLE = 'COUNCIL_VALIDATOR'

export function denyCouncilValidatorAction(
  actionKindOrAlias: string,
  requestingActorId = ROLE,
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
      reason: `COUNCIL_VALIDATOR cannot perform ${actionKindOrAlias}.`,
      httpStatus: 403,
      approvalSatisfied: false,
    }
  }
  return decision
}

export function assertCouncilValidatorCannotSelfApprove(): PolicyDecision {
  return (
    assertNoSelfApproval('COUNCIL_VALIDATOR', 'COUNCIL_VALIDATOR') ?? {
      outcome: 'DENY',
      reasonCode: 'SELF_ESCALATION_DENIED',
      reason: 'COUNCIL_VALIDATOR cannot approve itself.',
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

export function assertCouncilValidatorChildDoesNotExceedParent(): PolicyDecision {
  return (
    assertChildDoesNotExceedParent({
      parentReach: 'READ_ONLY',
      childReach: 'FULL_TECHNICAL_REACH',
      parentAuthority: 'READ_ALLOWED',
      childAuthority: 'COMMANDER_ONLY',
    }) ?? {
      outcome: 'DENY',
      reasonCode: 'CHILD_AUTHORITY_EXCEEDS_PARENT',
      reason: 'COUNCIL_VALIDATOR privilege amplification denied.',
      actionKind: 'agent_spawn',
      canonicalKind: 'agent_spawn',
      riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
      technicalReach: 'DISCOVER_ONLY',
      policyAuthority: 'DENIED',
      requiresApproval: true,
      approvalSatisfied: false,
      httpStatus: 403,
    }
  )
}

export function isAllowedCouncilValidatorReadClass(c: string): boolean {
  return (COUNCIL_VALIDATOR_ALLOWED_READ_CLASSES as readonly string[]).includes(c)
}
