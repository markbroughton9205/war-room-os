/**
 * #22 Phase 2 — RESEARCH_AGENT allow / deny capability profiles.
 * Enforced via Phase 1 governance — not UI hiding.
 */
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import { assertNoSelfApproval, assertChildDoesNotExceedParent } from '@/lib/permissions/noSelfEscalation'
import { evaluateCouncilAutoResearch } from '@/lib/permissions/councilAutoResearchAuthority'

export const RESEARCH_AGENT_ALLOWED_CAPABILITIES = [
  'TERRA_QUERY',
  'TERRA_READ',
  'SOVEREIGN_SEARCH_QUERY',
  'LIVE_SEARCH_QUERY',
  'PUBLIC_WEB_DISCOVER',
  'PUBLIC_WEB_READ',
  'PUBLIC_WEB_PASSIVE_FETCH',
  'STORED_RESEARCH_READ',
  'EVIDENCE_READ',
  'EVIDENCE_SYNTHESIZE',
  'EVIDENCE_RETURN_REFERENCES',
  'COUNCIL_RETURN_FINDINGS',
  'ASTRA_RECEIVE_ASSIGNMENT',
  'ASTRA_RETURN_RESULT',
  'INTERNAL_AUDIT_WRITE',
] as const
export type ResearchAgentAllowedCapability = (typeof RESEARCH_AGENT_ALLOWED_CAPABILITIES)[number]

export const RESEARCH_AGENT_DENIED_ACTION_KINDS = [
  'commit',
  'push',
  'deploy',
  'shell_mutating',
  'delete_data',
  'policy_change',
  'agent_spawn',
  'secrets_change',
  'file_modification',
  'email_send',
  'financial',
  'payment',
  'trade',
  'wager',
  'settlement_submit',
  'external_account',
  'rollback',
  'subscription',
] as const

/** Alias vocabulary used in Phase 2 denial tests. */
export const RESEARCH_AGENT_DENIED_ALIASES = [
  'GIT_COMMIT',
  'GIT_PUSH',
  'PRODUCTION_DEPLOY',
  'PRODUCTION_RESTART',
  'PROCESS_TERMINATE',
  'SHELL_EXECUTE',
  'POWERSHELL_EXECUTE',
  'SQL_EXECUTE',
  'DATABASE_SCHEMA_CHANGE',
  'DATABASE_ARBITRARY_WRITE',
  'POLICY_CHANGE',
  'APPROVAL_CHANGE',
  'AGENT_SPAWN',
  'SECRET_CHANGE',
  'FILESYSTEM_DELETE',
  'FILESYSTEM_SENSITIVE_WRITE',
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

export function assertResearchAgentCapabilityAllowed(
  capability: ResearchAgentAllowedCapability | string,
): boolean {
  return (RESEARCH_AGENT_ALLOWED_CAPABILITIES as readonly string[]).includes(capability)
}

const RESEARCH_AGENT_ROLE_CONST = 'RESEARCH_AGENT'

export function denyResearchAgentAction(
  actionKindOrAlias: string,
  requestingActorId = RESEARCH_AGENT_ROLE_CONST,
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
      reason: `RESEARCH_AGENT cannot perform ${actionKindOrAlias}.`,
      httpStatus: 403,
      approvalSatisfied: false,
    }
  }
  return decision
}

export function assertResearchAgentCannotSelfApprove(): PolicyDecision {
  return (
    assertNoSelfApproval('RESEARCH_AGENT', 'RESEARCH_AGENT') ?? {
      outcome: 'DENY',
      reasonCode: 'SELF_ESCALATION_DENIED',
      reason: 'RESEARCH_AGENT cannot approve itself.',
      actionKind: 'approval',
      canonicalKind: null,
      riskTier: null,
      technicalReach: null,
      policyAuthority: 'DENIED',
      requiresApproval: true,
      approvalSatisfied: false,
      httpStatus: 403,
    }
  )
}

export function assertResearchAgentCannotSpawnChild(): PolicyDecision {
  return (
    assertChildDoesNotExceedParent({
      parentReach: 'READ_ONLY',
      childReach: 'EXECUTE_CONTROLLED',
      parentAuthority: 'BOUNDED_ALLOWED',
      childAuthority: 'COMMANDER_ONLY',
    }) ?? denyResearchAgentAction('agent_spawn')
  )
}

/** Discovery gate for the agent's own research path. */
export function assertResearchAgentDiscoveryAllowed(commanderSessionContext: boolean): PolicyDecision {
  return evaluateCouncilAutoResearch({
    capability: 'SEARCH',
    commanderSessionContext,
    crawlExpansion: false,
    externalMutation: false,
    financialSpend: false,
  })
}
