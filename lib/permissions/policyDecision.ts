/**
 * #22 Phase 1 — Canonical machine-readable policy decision.
 * Do not confuse technical failure with policy denial.
 */
import { assertAutoOrApproval, type StandingBody } from '@/lib/permissions/policy'
import type { StandingPermissionMode } from '@/lib/permissions/standingPermissions'
import {
  getDangerousActionRule,
  isCanonicalDangerousKind,
  resolveCanonicalDangerousKind,
  type CanonicalDangerousKind,
} from '@/lib/permissions/dangerousActionRegistry'
import type { PolicyAuthorityLevel, RiskTier, TechnicalReachLevel } from '@/lib/agent-capability-matrix/types'

export const POLICY_DECISION_OUTCOMES = ['ALLOW', 'DENY', 'REQUIRE_APPROVAL'] as const
export type PolicyDecisionOutcome = (typeof POLICY_DECISION_OUTCOMES)[number]

export const POLICY_REASON_CODES = [
  'ALLOWED',
  'ALLOWED_VIA_STANDING_POLICY',
  'ALLOWED_VIA_APPROVAL',
  'ALLOWED_VIA_COMMANDER_SESSION',
  'ALLOWED_BOUNDED_READ',
  'TECHNICAL_REACH_MISSING',
  'POLICY_DENIED',
  'COMMANDER_APPROVAL_REQUIRED',
  'APPROVAL_MISSING',
  'APPROVAL_EXPIRED',
  'APPROVAL_SCOPE_MISMATCH',
  'APPROVAL_ACTOR_MISMATCH',
  'APPROVAL_REPLAY',
  'OWNER_SCOPE_DENIED',
  'TARGET_OUT_OF_SCOPE',
  'ACTION_KIND_UNCLASSIFIED',
  'NOT_IMPLEMENTED',
  'UNAVAILABLE',
  'SELF_ESCALATION_DENIED',
  'CHILD_AUTHORITY_EXCEEDS_PARENT',
  'EQUIVALENT_ACTION_BYPASS_DENIED',
  'COUNCIL_CANNOT_AUTHORIZE',
  'TERRA_CANNOT_AUTHORIZE',
  'ASTRA_MISSION_NOT_EXECUTION_AUTHORITY',
  'SERVICE_ROLE_NOT_POLICY_PERMISSION',
] as const
export type PolicyReasonCode = (typeof POLICY_REASON_CODES)[number]

export type PolicyDecision = {
  outcome: PolicyDecisionOutcome
  reasonCode: PolicyReasonCode
  reason: string
  actionKind: string
  canonicalKind: CanonicalDangerousKind | null
  riskTier: RiskTier | null
  technicalReach: TechnicalReachLevel | null
  policyAuthority: PolicyAuthorityLevel | null
  requiresApproval: boolean
  approvalSatisfied: boolean
  httpStatus: number
}

export type EvaluateGovernedActionInput = {
  mode: StandingPermissionMode
  safetyLock: boolean
  actionKind: string
  body: StandingBody
  /** When true, an authenticated Commander session satisfies approval for COMMANDER_ONLY kinds. */
  commanderSessionOk?: boolean
  /** Actor id requesting the action (for self-approval checks). */
  requestingActorId?: string | null
  /** Approver id if an approval is claimed. */
  approvingActorId?: string | null
  /** High-impact mutation that is not in the dangerous catalog — must fail closed. */
  unclassifiedHighImpact?: boolean
  technicalReach?: TechnicalReachLevel
}

export function evaluateGovernedAction(input: EvaluateGovernedActionInput): PolicyDecision {
  if (input.unclassifiedHighImpact) {
    return {
      outcome: 'DENY',
      reasonCode: 'ACTION_KIND_UNCLASSIFIED',
      reason: 'Unclassified high-impact mutation fails closed — never auto-authorized.',
      actionKind: input.actionKind,
      canonicalKind: resolveCanonicalDangerousKind(input.actionKind),
      riskTier: 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
      technicalReach: input.technicalReach ?? 'UNKNOWN',
      policyAuthority: 'DENIED',
      requiresApproval: true,
      approvalSatisfied: false,
      httpStatus: 403,
    }
  }

  if (
    input.requestingActorId &&
    input.approvingActorId &&
    input.requestingActorId === input.approvingActorId &&
    input.requestingActorId !== 'commander'
  ) {
    return {
      outcome: 'DENY',
      reasonCode: 'SELF_ESCALATION_DENIED',
      reason: 'An agent cannot approve its own governed request.',
      actionKind: input.actionKind,
      canonicalKind: resolveCanonicalDangerousKind(input.actionKind),
      riskTier: getDangerousActionRule(input.actionKind)?.riskTier ?? null,
      technicalReach: input.technicalReach ?? null,
      policyAuthority: 'DENIED',
      requiresApproval: true,
      approvalSatisfied: false,
      httpStatus: 403,
    }
  }

  const rule = getDangerousActionRule(input.actionKind)
  const canonical = resolveCanonicalDangerousKind(input.actionKind)

  if (rule?.enforcement === 'NOT_IMPLEMENTED_FAIL_CLOSED' || rule?.enforcement === 'STRUCTURAL_NO_REACH') {
    const unreachable =
      rule.technicalReachToday === 'NO_REACH' ||
      rule.technicalReachToday === 'DISCOVER_ONLY' ||
      rule.enforcement === 'NOT_IMPLEMENTED_FAIL_CLOSED'
    if (unreachable) {
      const approvalGranted = input.body.approval_granted === true
      // Approval does not invent technical reach for structural no-reach / not-implemented kinds.
      return {
        outcome: 'DENY',
        reasonCode: rule.enforcement === 'NOT_IMPLEMENTED_FAIL_CLOSED' ? 'NOT_IMPLEMENTED' : 'TECHNICAL_REACH_MISSING',
        reason: `${rule.kind} remains structurally unreachable — approval does not create technical reach (${rule.enforcement}).`,
        actionKind: input.actionKind,
        canonicalKind: canonical,
        riskTier: rule.riskTier,
        technicalReach: rule.technicalReachToday,
        policyAuthority: rule.defaultAuthority,
        requiresApproval: true,
        approvalSatisfied: approvalGranted || Boolean(input.commanderSessionOk),
        httpStatus: 403,
      }
    }
  }

  if (rule?.commanderOnly) {
    const approvalGranted = input.body.approval_granted === true
    if (!input.commanderSessionOk && !approvalGranted) {
      return {
        outcome: 'REQUIRE_APPROVAL',
        reasonCode: 'COMMANDER_APPROVAL_REQUIRED',
        reason: `${rule.kind} requires Commander authority.`,
        actionKind: input.actionKind,
        canonicalKind: canonical,
        riskTier: rule.riskTier,
        technicalReach: rule.technicalReachToday,
        policyAuthority: 'COMMANDER_ONLY',
        requiresApproval: true,
        approvalSatisfied: false,
        httpStatus: 403,
      }
    }
    if (input.commanderSessionOk && rule.enforcement === 'COMMANDER_SESSION_PLUS_DANGEROUS') {
      return {
        outcome: 'ALLOW',
        reasonCode: 'ALLOWED_VIA_COMMANDER_SESSION',
        reason: `${rule.kind} authorized by Commander session under Phase 1 gate.`,
        actionKind: input.actionKind,
        canonicalKind: canonical,
        riskTier: rule.riskTier,
        technicalReach: rule.technicalReachToday,
        policyAuthority: 'COMMANDER_ONLY',
        requiresApproval: true,
        approvalSatisfied: true,
        httpStatus: 200,
      }
    }
  }

  // Reuse existing standing / dangerous gate for wired kinds
  const standing = assertAutoOrApproval({
    mode: input.mode,
    safetyLock: input.safetyLock,
    actionKind: isCanonicalDangerousKind(input.actionKind) && !isDangerousInLegacyCatalog(input.actionKind)
      ? mapPhase1KindToLegacyForStanding(input.actionKind)
      : input.actionKind,
    body: input.body,
  })

  // Phase-1-only kinds: never auto-allow
  if (isCanonicalDangerousKind(input.actionKind) && !isDangerousInLegacyCatalog(input.actionKind)) {
    const approvalGranted = input.body.approval_granted === true || Boolean(input.commanderSessionOk)
    if (!approvalGranted) {
      return {
        outcome: 'REQUIRE_APPROVAL',
        reasonCode: 'APPROVAL_MISSING',
        reason: `Dangerous action "${input.actionKind}" requires explicit approval.`,
        actionKind: input.actionKind,
        canonicalKind: canonical,
        riskTier: rule?.riskTier ?? 'TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL',
        technicalReach: rule?.technicalReachToday ?? input.technicalReach ?? null,
        policyAuthority: rule?.defaultAuthority ?? 'COMMANDER_ONLY',
        requiresApproval: true,
        approvalSatisfied: false,
        httpStatus: 403,
      }
    }
  }

  if (!standing.ok) {
    const approvalMissing = !input.body.approval_granted
    return {
      outcome: approvalMissing ? 'REQUIRE_APPROVAL' : 'DENY',
      reasonCode: approvalMissing ? 'APPROVAL_MISSING' : 'POLICY_DENIED',
      reason: standing.error,
      actionKind: input.actionKind,
      canonicalKind: canonical,
      riskTier: rule?.riskTier ?? null,
      technicalReach: rule?.technicalReachToday ?? input.technicalReach ?? null,
      policyAuthority: rule?.defaultAuthority ?? null,
      requiresApproval: true,
      approvalSatisfied: false,
      httpStatus: standing.status,
    }
  }

  return {
    outcome: 'ALLOW',
    reasonCode: standing.viaAutoPolicy ? 'ALLOWED_VIA_STANDING_POLICY' : 'ALLOWED_VIA_APPROVAL',
    reason: standing.viaAutoPolicy ? 'Allowed by standing policy.' : 'Allowed by explicit approval.',
    actionKind: input.actionKind,
    canonicalKind: canonical,
    riskTier: rule?.riskTier ?? null,
    technicalReach: rule?.technicalReachToday ?? input.technicalReach ?? null,
    policyAuthority: rule?.defaultAuthority ?? 'BOUNDED_ALLOWED',
    requiresApproval: Boolean(rule?.requiresApproval),
    approvalSatisfied: true,
    httpStatus: 200,
  }
}

function isDangerousInLegacyCatalog(actionKind: string): boolean {
  // Import cycle avoidance: check against known legacy list inline
  const legacy = new Set([
    'file_modification',
    'shell_mutating',
    'commit',
    'deploy',
    'rollback',
    'delete_data',
    'email_send',
    'financial',
    'payment',
    'subscription',
    'secrets_change',
    'external_account',
  ])
  return legacy.has(actionKind)
}

/** Map Phase-1-only kinds onto a legacy dangerous kind for assertAutoOrApproval reuse. */
function mapPhase1KindToLegacyForStanding(actionKind: string): string {
  switch (actionKind) {
    case 'push':
      return 'commit'
    case 'policy_change':
      return 'secrets_change'
    case 'trade':
    case 'wager':
    case 'settlement_submit':
      return 'financial'
    case 'agent_spawn':
      return 'external_account'
    default:
      return actionKind
  }
}
