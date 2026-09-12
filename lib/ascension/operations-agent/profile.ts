/**
 * #22 Phase 5 — OPERATIONS_AGENT capability profile.
 * Observation ≠ mutation. Phase 1 governance enforces denials.
 */
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import { assertNoSelfApproval, assertChildDoesNotExceedParent } from '@/lib/permissions/noSelfEscalation'

export const OPERATIONS_ALLOWED_DIAGNOSTICS = [
  'LOCAL_HEALTH',
  'PUBLIC_HEALTH',
  'BUILD_METADATA',
  'PROCESS_METADATA',
  'PORT_STATE',
  'APPROVED_LOG_READ',
  'WATCHDOG_STATUS',
  'CLOUDFLARED_STATUS',
  'OLLAMA_STATUS',
  'ENV_PRESENCE',
  'RUNTIME_TRUTH',
] as const

export type OperationsAllowedDiagnostic = (typeof OPERATIONS_ALLOWED_DIAGNOSTICS)[number]

export const OPERATIONS_DENIED_ALIASES = [
  'PROCESS_TERMINATE',
  'PROCESS_RESTART',
  'SERVICE_STOP',
  'SERVICE_START',
  'SERVICE_RESTART',
  'PRODUCTION_DEPLOY',
  'PRODUCTION_ROLLBACK',
  'PRODUCTION_RESTART',
  'DEV_RESTART',
  'WATCHDOG_CHANGE',
  'TASK_SCHEDULER_CHANGE',
  'CLOUDFLARE_CHANGE',
  'DNS_CHANGE',
  'OLLAMA_CONFIG_CHANGE',
  'ENV_CHANGE',
  'SECRET_CHANGE',
  'SQL_EXECUTE',
  'DATABASE_WRITE',
  'DATABASE_SCHEMA_CHANGE',
  'GIT_COMMIT',
  'GIT_PUSH',
  'POLICY_CHANGE',
  'APPROVAL_CHANGE',
  'AGENT_SPAWN',
  'FILESYSTEM_DESTRUCTIVE_WRITE',
  'ARBITRARY_SHELL',
  'ARBITRARY_POWERSHELL',
  'MESSAGE_SEND',
  'PHONE_OUTBOUND',
  'FINANCIAL_ACTION',
  'FINANCIAL_SPEND',
  'TRADE',
  'WAGER',
  'SETTLEMENT_SUBMIT',
  'CRAWL_EXPANSION',
] as const

const ROLE = 'OPERATIONS_AGENT'

export function denyOperationsAgentAction(
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
      reason: `OPERATIONS_AGENT cannot perform ${actionKindOrAlias}.`,
      httpStatus: 403,
      approvalSatisfied: false,
    }
  }
  return decision
}

export function assertOperationsAgentCannotSelfApprove(): PolicyDecision {
  return (
    assertNoSelfApproval('OPERATIONS_AGENT', 'OPERATIONS_AGENT') ?? {
      outcome: 'DENY',
      reasonCode: 'SELF_ESCALATION_DENIED',
      reason: 'OPERATIONS_AGENT cannot approve itself.',
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

export function assertOperationsChildDoesNotExceedParent(): PolicyDecision {
  return (
    assertChildDoesNotExceedParent({
      parentReach: 'READ_ONLY',
      childReach: 'FULL_TECHNICAL_REACH',
      parentAuthority: 'READ_ALLOWED',
      childAuthority: 'COMMANDER_ONLY',
    }) ?? {
      outcome: 'DENY',
      reasonCode: 'CHILD_AUTHORITY_EXCEEDS_PARENT',
      reason: 'OPERATIONS_AGENT privilege amplification denied.',
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

export function isAllowedDiagnostic(d: string): boolean {
  return (OPERATIONS_ALLOWED_DIAGNOSTICS as readonly string[]).includes(d)
}

/** Free-form / mutating command patterns — never execute. */
export function denyOperationsCommandAttempt(
  cmd: string,
  args: readonly string[],
): { allowed: false; reason: string; reasonCode: string } {
  const joined = [cmd, ...args].join(' ').toLowerCase()
  if (/[;&|`]|\$\(|invoke-expression|iex\b/.test(joined)) {
    return { allowed: false, reason: 'Command injection pattern denied.', reasonCode: 'EQUIVALENT_ACTION_BYPASS_DENIED' }
  }
  if (/\b(stop-process|restart-service|set-service|schtasks|remove-item|rm\s+-rf|kill\s+-9|taskkill)\b/.test(joined)) {
    return { allowed: false, reason: 'Mutating process/service command denied.', reasonCode: 'POLICY_DENIED' }
  }
  if (/\b(git\s+push|git\s+commit|deploy|vercel|netlify)\b/.test(joined)) {
    return { allowed: false, reason: 'Deploy/git mutation command denied.', reasonCode: 'POLICY_DENIED' }
  }
  return {
    allowed: false,
    reason: 'Arbitrary shell/PowerShell denied — only fixed diagnostic adapters may run.',
    reasonCode: 'ARBITRARY_SHELL_DENIED',
  }
}
