/**
 * #22 Phase 12 — NAVIGATION_AGENT capability profile.
 * Bounded navigation reasoning. Route engine remains Phase 9. No device control.
 */
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import { assertNoSelfApproval, assertChildDoesNotExceedParent } from '@/lib/permissions/noSelfEscalation'

export const NAVIGATION_AGENT_ALLOWED_OPERATIONS = [
  'PLAN_ROUTE',
  'COMPARE_ROUTES',
  'EXPLAIN_ROUTE',
  'INTERPRET_PROGRESS',
  'RECOMMEND_REROUTE',
  'EXPLAIN_ETA',
  'SUMMARIZE_INSTRUCTIONS',
  'CONSUME_TERRA_CONTEXT',
  'PACKAGE_COUNCIL_EVIDENCE',
  'PACKAGE_ASTRA_INTENT',
  'LOCAL_MODEL_EXPLAIN',
  'INTERNAL_AUDIT_WRITE',
] as const

export type NavigationAgentAllowedOperation = (typeof NAVIGATION_AGENT_ALLOWED_OPERATIONS)[number]

export const NAVIGATION_AGENT_TASK_TYPES = [
  'PLAN_ROUTE',
  'COMPARE_ROUTES',
  'EXPLAIN_ROUTE',
  'INTERPRET_PROGRESS',
  'RECOMMEND_REROUTE',
  'EXPLAIN_ETA',
  'SUMMARIZE_INSTRUCTIONS',
] as const

export type NavigationAgentTaskType = (typeof NAVIGATION_AGENT_TASK_TYPES)[number]

export const NAVIGATION_AGENT_DENIED_ALIASES = [
  'VEHICLE_CONTROL',
  'DEVICE_CONTROL',
  'NAVIGATION_CONTROL',
  'PHONE_GPS_CONTROL',
  'BACKGROUND_TRACKING',
  'FABRICATE_GNSS',
  'FABRICATE_LIVE_TRAFFIC',
  'FABRICATE_INCIDENTS',
  'SILENT_ROAD_ADD',
  'IGNORE_BLOCKED_EDGE',
  'AUTO_EXECUTE_REROUTE',
  'UNAPPROVED_TRAFFIC_PROVIDER',
  'SHELL_EXECUTE',
  'POWERSHELL_EXECUTE',
  'ARBITRARY_SHELL',
  'GIT_PUSH',
  'PRODUCTION_DEPLOY',
  'FINANCIAL_SPEND',
  'FINANCIAL_TRANSFER',
  'TRADE',
  'WAGER',
  'AGENT_SPAWN',
  'POLICY_CHANGE',
  'APPROVAL_CHANGE',
  'WORLD_LEARNING_START',
  'PHONE_APP_BUILD',
  'WRIM_BUILD',
  'RAEL_TRAINING',
  'ROADMAP_23_START',
  'MISSION_EXECUTION',
] as const

const ROLE = 'NAVIGATION_AGENT'

export function denyNavigationAgentAction(
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
      reason: `NAVIGATION_AGENT cannot perform ${actionKindOrAlias}.`,
      httpStatus: 403,
      approvalSatisfied: false,
    }
  }
  return decision
}

export function assertNavigationAgentCannotSelfApprove(): PolicyDecision {
  return (
    assertNoSelfApproval('NAVIGATION_AGENT', 'NAVIGATION_AGENT') ?? {
      outcome: 'DENY',
      reasonCode: 'SELF_ESCALATION_DENIED',
      reason: 'NAVIGATION_AGENT cannot approve itself.',
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

export function assertNavigationAgentChildDoesNotExceedParent(): PolicyDecision {
  return (
    assertChildDoesNotExceedParent({
      parentReach: 'READ_ONLY',
      childReach: 'FULL_TECHNICAL_REACH',
      parentAuthority: 'READ_ALLOWED',
      childAuthority: 'COMMANDER_ONLY',
    }) ?? {
      outcome: 'DENY',
      reasonCode: 'CHILD_AUTHORITY_EXCEEDS_PARENT',
      reason: 'NAVIGATION_AGENT privilege amplification denied.',
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

export function isAllowedNavigationAgentOperation(c: string): boolean {
  return (NAVIGATION_AGENT_ALLOWED_OPERATIONS as readonly string[]).includes(c)
}

export function isAllowedNavigationAgentTaskType(c: string): c is NavigationAgentTaskType {
  return (NAVIGATION_AGENT_TASK_TYPES as readonly string[]).includes(c)
}
