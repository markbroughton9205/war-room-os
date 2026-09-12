/**
 * #22 Phase 4 — SECURITY_RED_TEAM_AGENT capability profile.
 * Detect ≠ execute. Phase 1 governance enforces denials.
 */
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import { assertNoSelfApproval, assertChildDoesNotExceedParent } from '@/lib/permissions/noSelfEscalation'

export const SECURITY_RED_TEAM_ALLOWED_CAPABILITIES = [
  'STATIC_ANALYSIS',
  'POLICY_EVALUATION',
  'OWNERSHIP_BOUNDARY_TEST',
  'APPROVAL_BOUNDARY_TEST',
  'AGENT_AUTHORITY_TEST',
  'PATH_ESCAPE_TEST',
  'WORKTREE_ESCAPE_TEST',
  'ROUTE_ALIAS_TEST',
  'TOOL_ALIAS_TEST',
  'PACKAGE_SCRIPT_ALIAS_TEST',
  'HTTP_SEMANTIC_TEST',
  'SERVICE_ROLE_POLICY_TEST',
  'AUDIT_COMPLETENESS_TEST',
  'RUNTIME_TRUTH_TEST',
  'INPUT_VALIDATION_TEST',
  'STATE_MACHINE_TEST',
  'COUNCIL_RETURN_FINDINGS',
  'ASTRA_RECEIVE_ASSIGNMENT',
  'ASTRA_RETURN_RESULT',
  'INTERNAL_AUDIT_WRITE',
] as const

export type SecurityRedTeamAllowedCapability = (typeof SECURITY_RED_TEAM_ALLOWED_CAPABILITIES)[number]

export const SECURITY_RED_TEAM_SAFE_PROBE_CLASSES = SECURITY_RED_TEAM_ALLOWED_CAPABILITIES.filter(
  c =>
    ![
      'COUNCIL_RETURN_FINDINGS',
      'ASTRA_RECEIVE_ASSIGNMENT',
      'ASTRA_RETURN_RESULT',
      'INTERNAL_AUDIT_WRITE',
    ].includes(c),
) as readonly string[]

export const SECURITY_RED_TEAM_PROHIBITED_PROBE_CLASSES = [
  'REAL_EXTERNAL_EXPLOIT',
  'DESTRUCTIVE_DB_TEST',
  'PRODUCTION_KILL_TEST',
  'PRODUCTION_RESTART_TEST',
  'SECRET_EXTRACTION',
  'CREDENTIAL_DUMP',
  'MALWARE_EXECUTION',
  'PERSISTENCE_INSTALL',
  'NETWORK_LATERAL_MOVEMENT',
  'PRIVILEGE_ESCALATION',
  'DENIAL_OF_SERVICE',
  'FINANCIAL_ACTION',
  'REAL_MESSAGE_SEND',
  'REAL_PHONE_ACTION',
] as const

export const SECURITY_RED_TEAM_DENIED_ALIASES = [
  'GIT_COMMIT',
  'GIT_PUSH',
  'PRODUCTION_DEPLOY',
  'PRODUCTION_RESTART',
  'PROCESS_TERMINATE',
  'ARBITRARY_SHELL',
  'ARBITRARY_POWERSHELL',
  'SQL_MUTATION',
  'DATABASE_DESTRUCTIVE_WRITE',
  'SCHEMA_CHANGE',
  'SECRET_CHANGE',
  'CREDENTIAL_EXFILTRATION',
  'POLICY_CHANGE',
  'APPROVAL_CHANGE',
  'AGENT_SPAWN',
  'MALWARE_PERSISTENCE',
  'HOST_PRIVILEGE_ESCALATION',
  'EXTERNAL_EXPLOITATION',
  'MESSAGE_SEND',
  'PHONE_OUTBOUND',
  'FINANCIAL_SPEND',
  'FINANCIAL_TRANSFER',
  'TRADE',
  'WAGER',
  'SETTLEMENT_SUBMIT',
  'CRAWL_EXPANSION',
] as const

const ROLE = 'SECURITY_RED_TEAM_AGENT'

export function denySecurityRedTeamAction(
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
      reason: `SECURITY_RED_TEAM_AGENT cannot perform ${actionKindOrAlias}.`,
      httpStatus: 403,
      approvalSatisfied: false,
    }
  }
  return decision
}

export function assertSecurityRedTeamCannotSelfApprove(): PolicyDecision {
  return (
    assertNoSelfApproval('SECURITY_RED_TEAM_AGENT', 'SECURITY_RED_TEAM_AGENT') ?? {
      outcome: 'DENY',
      reasonCode: 'SELF_ESCALATION_DENIED',
      reason: 'SECURITY_RED_TEAM_AGENT cannot approve itself.',
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

export function assertSecurityChildDoesNotExceedParent(): PolicyDecision {
  return (
    assertChildDoesNotExceedParent({
      parentReach: 'READ_ONLY',
      childReach: 'FULL_TECHNICAL_REACH',
      parentAuthority: 'READ_ALLOWED',
      childAuthority: 'COMMANDER_ONLY',
    }) ?? {
      outcome: 'DENY',
      reasonCode: 'CHILD_AUTHORITY_EXCEEDS_PARENT',
      reason: 'SECURITY_RED_TEAM_AGENT privilege amplification denied.',
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

export function isSafeProbeClass(probeClass: string): boolean {
  return (SECURITY_RED_TEAM_SAFE_PROBE_CLASSES as readonly string[]).includes(probeClass)
}

export function isProhibitedProbeClass(probeClass: string): boolean {
  return (SECURITY_RED_TEAM_PROHIBITED_PROBE_CLASSES as readonly string[]).includes(probeClass)
}
