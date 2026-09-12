/**
 * #22 Phase 6 — TERRA_INTELLIGENCE_AGENT capability profile.
 * Observation/analysis ≠ authorization. Phase 1 governance enforces denials.
 */
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import { assertNoSelfApproval, assertChildDoesNotExceedParent } from '@/lib/permissions/noSelfEscalation'

export const TERRA_INTELLIGENCE_ALLOWED_QUERY_CLASSES = [
  'TERRA_QUERY',
  'TERRA_READ',
  'PROVIDER_STATUS_READ',
  'PROVENANCE_READ',
  'FRESHNESS_READ',
  'CORRELATE',
  'NORMALIZE',
  'ANALYZE',
  'COUNCIL_RETURN_FINDINGS',
  'ASTRA_RECEIVE_ASSIGNMENT',
  'ASTRA_RETURN_RESULT',
  'INTERNAL_AUDIT_WRITE',
  'OPTIONAL_BOUNDED_SEARCH_READ',
] as const

export type TerraIntelligenceAllowedQueryClass = (typeof TERRA_INTELLIGENCE_ALLOWED_QUERY_CLASSES)[number]

export const TERRA_INTELLIGENCE_DENIED_ALIASES = [
  'AUTHORIZE_ACTION',
  'CREATE_GOVERNED_APPROVAL',
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
  'SOURCE_APPROVAL',
  'DEVICE_CONTROL',
  'NAVIGATION_CONTROL',
  'VEHICLE_CONTROL',
  'MISSION_EXECUTION',
] as const

const ROLE = 'TERRA_INTELLIGENCE_AGENT'

export function denyTerraIntelligenceAgentAction(
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
      reason: `TERRA_INTELLIGENCE_AGENT cannot perform ${actionKindOrAlias}.`,
      httpStatus: 403,
      approvalSatisfied: false,
    }
  }
  return decision
}

export function assertTerraIntelligenceCannotSelfApprove(): PolicyDecision {
  return (
    assertNoSelfApproval('TERRA_INTELLIGENCE_AGENT', 'TERRA_INTELLIGENCE_AGENT') ?? {
      outcome: 'DENY',
      reasonCode: 'SELF_ESCALATION_DENIED',
      reason: 'TERRA_INTELLIGENCE_AGENT cannot approve itself.',
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

export function assertTerraIntelligenceChildDoesNotExceedParent(): PolicyDecision {
  return (
    assertChildDoesNotExceedParent({
      parentReach: 'READ_ONLY',
      childReach: 'FULL_TECHNICAL_REACH',
      parentAuthority: 'READ_ALLOWED',
      childAuthority: 'COMMANDER_ONLY',
    }) ?? {
      outcome: 'DENY',
      reasonCode: 'CHILD_AUTHORITY_EXCEEDS_PARENT',
      reason: 'TERRA_INTELLIGENCE_AGENT privilege amplification denied.',
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

export function isAllowedTerraQueryClass(c: string): boolean {
  return (TERRA_INTELLIGENCE_ALLOWED_QUERY_CLASSES as readonly string[]).includes(c)
}
