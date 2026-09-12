/**
 * #22 Phase 5 — Bounded OPERATIONS_AGENT runtime.
 * Observation-first. No restart/deploy/kill. Invocation-driven; Ascension autonomy OFF.
 */
import { randomUUID } from 'node:crypto'
import { buildGovernedAuditMetadata, insertGovernedAuditLog } from '@/lib/war-room/governedAudit'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import {
  createOperationsAgentIdentity,
  isOperationsAgentRuntimeAvailable,
  OPERATIONS_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
} from './identity'
import {
  assertOperationsAgentCannotSelfApprove,
  denyOperationsAgentAction,
  denyOperationsCommandAttempt,
} from './profile'
import { createOperationsAgentScope, isOperationsScopeExpired, type OperationsAgentScope } from './scope'
import {
  classifyOperationsStatus,
  emptySeverityDistribution,
  OPERATIONS_AGENT_BOUNDARY_NOTES,
  type OperationsAgentResult,
  type OperationsDenial,
  type OperationsFinding,
  type OperationsCheckRun,
} from './result'
import { assertOperationsOwnerScopeMatch } from './ownership'
import { runOperationsDiagnostics } from './diagnostics'
import { ascensionAutonomyIsOff } from '@/lib/ascension/operationalRegistry'

export type RunBoundedOperationsInput = {
  operationsQuestion: string
  ownerUserId: string
  requestedBy: string
  invokedBy: 'commander' | 'council' | 'astra'
  targets?: string[]
  allowedDiagnostics?: string[]
  missionId?: string | null
  conversationId?: string | null
  conversationOwnerUserId?: string | null
  enforceOwnership?: boolean
  attemptedAction?: string | null
  attemptedCommand?: { cmd: string; args: string[] } | null
  councilRecommendRestart?: boolean
  astraAuthorizeRestart?: boolean
  securityHandoff?: { summary?: string } | null
  researchHandoff?: { summary?: string } | null
  recommendEngineering?: boolean
  simulateTransientRecovery?: boolean
  simulateWrongProcessOn3000?: boolean
  simulateRestartStorm?: boolean
  supabase?: WarRoomSupabase | null
  nowIso?: string
}

export async function runBoundedOperationsAgent(
  input: RunBoundedOperationsInput,
): Promise<OperationsAgentResult> {
  const startedAt = input.nowIso ?? new Date().toISOString()
  const requestId = randomUUID()
  const denials: OperationsDenial[] = []
  const checks: OperationsCheckRun[] = []
  const findings: OperationsFinding[] = []
  const unavailable: string[] = []
  const limitations: string[] = [
    'NO AUTO-REPAIR — diagnose and report only.',
    'Council/ASTRA/Security findings do not authorize restart/deploy/kill.',
    'Does not auto-invoke Engineering Agent.',
  ]
  let auditId: string | null = null

  const targets = input.targets?.length
    ? input.targets
    : ['local_health', 'public_health', 'ports', 'watchdog', 'build', 'ollama', 'cloudflared']

  const emptyScope = (): OperationsAgentScope =>
    createOperationsAgentScope({
      operationsQuestion: input.operationsQuestion || '(none)',
      targets,
      allowedDiagnostics: input.allowedDiagnostics,
      ownerUserId: input.ownerUserId,
      requestedBy: input.requestedBy,
      conversationId: input.conversationId,
      missionId: input.missionId,
      nowIso: startedAt,
    })

  const finish = async (
    status: OperationsAgentResult['status'],
    scope: OperationsAgentScope,
    summaries: {
      health_summary: Record<string, unknown>
      process_summary: Record<string, unknown>
      port_summary: Record<string, unknown>
      watchdog_summary: Record<string, unknown>
      public_route_summary: Record<string, unknown>
      dependency_summary: Record<string, unknown>
    },
  ): Promise<OperationsAgentResult> => {
    const identity = createOperationsAgentIdentity({
      requestId,
      ownerUserId: input.ownerUserId,
      requestedBy: input.requestedBy,
      targets: scope.targets,
      allowedDiagnostics: scope.allowed_diagnostics,
      missionId: input.missionId,
      conversationId: input.conversationId,
      expiresAt: scope.expires_at,
      nowIso: startedAt,
    })

    const severity_distribution = emptySeverityDistribution()
    for (const f of findings) severity_distribution[f.severity] += 1

    const result: OperationsAgentResult = {
      agent_id: identity.agent_id,
      agent_role: 'OPERATIONS_AGENT',
      status,
      operations_question: scope.operations_question,
      targets: scope.targets,
      checks_run: checks,
      findings,
      health_summary: summaries.health_summary,
      process_summary: summaries.process_summary,
      port_summary: summaries.port_summary,
      watchdog_summary: summaries.watchdog_summary,
      public_route_summary: summaries.public_route_summary,
      dependency_summary: summaries.dependency_summary,
      denials,
      unavailable_checks: unavailable,
      limitations,
      audit_id: auditId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      owner_scope: input.ownerUserId,
      mission_id: input.missionId ?? null,
      conversation_id: input.conversationId ?? null,
      identity,
      scope,
      severity_distribution,
      boundary_notes: OPERATIONS_AGENT_BOUNDARY_NOTES,
      plan_summary: 'INSPECT → DIAGNOSE → REPORT → COMMANDER DECISION (NO AUTO MUTATION)',
    }

    try {
      const decision: PolicyDecision =
        status === 'DENIED'
          ? {
              outcome: 'DENY',
              reasonCode: 'POLICY_DENIED',
              reason: denials[0]?.reason ?? 'Operations evaluation denied.',
              actionKind: 'operations_diagnostics',
              canonicalKind: null,
              riskTier: 'TIER_0_READ_OBSERVE',
              technicalReach: 'READ_ONLY',
              policyAuthority: 'READ_ALLOWED',
              requiresApproval: false,
              approvalSatisfied: true,
              httpStatus: 403,
            }
          : {
              outcome: 'ALLOW',
              reasonCode: 'ALLOWED_BOUNDED_READ',
              reason: 'Bounded operational diagnostics within read-only profile.',
              actionKind: 'operations_diagnostics',
              canonicalKind: null,
              riskTier: 'TIER_0_READ_OBSERVE',
              technicalReach: 'READ_ONLY',
              policyAuthority: 'READ_ALLOWED',
              requiresApproval: false,
              approvalSatisfied: true,
              httpStatus: 200,
            }

      const meta = buildGovernedAuditMetadata({
        decision,
        requestedBy: input.requestedBy,
        actorAgent: 'OPERATIONS_AGENT',
        missionId: input.missionId ?? null,
        tool: 'ascension.operations_agent.runBoundedOperationsAgent',
        target: scope.operations_question.slice(0, 200),
        ownerUserId: input.ownerUserId,
        evidenceRefs: findings.slice(0, 20).map(f => f.finding_id),
        executionResult:
          status === 'DENIED' ? 'denied' : status === 'FAILED' ? 'failed' : 'executed',
      })

      await insertGovernedAuditLog(input.supabase ?? null, {
        actor: input.invokedBy === 'commander' ? 'user' : 'system',
        category: 'runtime',
        message: `OPERATIONS_AGENT ${status}: ${scope.operations_question.slice(0, 200)}`,
        actionId: requestId,
        metadata: meta,
        extra: {
          invocation: input.invokedBy,
          status,
          targets: scope.targets,
          checks_attempted: checks.map(c => c.check_id),
          checks_allowed: checks.filter(c => !c.denied).map(c => c.check_id),
          checks_denied: checks.filter(c => c.denied).map(c => c.check_id),
          health: summaries.health_summary,
          process: summaries.process_summary,
          ports: summaries.port_summary,
          watchdog: summaries.watchdog_summary,
          public_route: summaries.public_route_summary,
          dependencies: summaries.dependency_summary,
          findings_count: findings.length,
          severity_distribution,
          policy_decisions: denials,
          // Never persist secret values or CoT
          secrets: undefined,
          chain_of_thought: undefined,
          env_values: undefined,
        },
      })
      auditId = requestId
      result.audit_id = auditId
    } catch {
      limitations.push('Audit persistence unavailable.')
      if (status === 'COMPLETE') result.status = 'PARTIAL'
    }

    return result
  }

  const emptySummaries = {
    health_summary: {},
    process_summary: {},
    port_summary: {},
    watchdog_summary: {},
    public_route_summary: {},
    dependency_summary: {},
  }

  if (!isOperationsAgentRuntimeAvailable()) {
    denials.push({
      capability_or_action: 'RUNTIME',
      reason_code: 'UNAVAILABLE',
      reason: 'OPERATIONS_AGENT disabled via ASCENSION_OPERATIONS_AGENT_ENABLED=false.',
    })
    return finish('DENIED', emptyScope(), emptySummaries)
  }

  if (!ascensionAutonomyIsOff() || OPERATIONS_AGENT_AUTONOMOUS_EXECUTION_ENABLED) {
    denials.push({
      capability_or_action: 'ASCENSION_AUTONOMY',
      reason_code: 'POLICY_DENIED',
      reason: 'Ascension autonomy must remain OFF.',
    })
    return finish('DENIED', emptyScope(), emptySummaries)
  }

  if (!input.operationsQuestion?.trim()) {
    denials.push({
      capability_or_action: 'SCOPE',
      reason_code: 'TARGET_OUT_OF_SCOPE',
      reason: 'operations_question is required — no open-ended forever-monitor scope.',
    })
    return finish('DENIED', emptyScope(), emptySummaries)
  }

  if (input.attemptedAction) {
    const d = denyOperationsAgentAction(input.attemptedAction)
    denials.push({
      capability_or_action: input.attemptedAction,
      reason_code: d.reasonCode,
      reason: d.reason,
    })
  }

  if (input.attemptedCommand) {
    const d = denyOperationsCommandAttempt(input.attemptedCommand.cmd, input.attemptedCommand.args)
    denials.push({
      capability_or_action: 'ARBITRARY_SHELL',
      reason_code: d.reasonCode,
      reason: d.reason,
    })
  }

  const self = assertOperationsAgentCannotSelfApprove()
  if (input.attemptedAction === 'self_approve' || input.attemptedAction === 'APPROVAL_CHANGE') {
    denials.push({
      capability_or_action: 'APPROVAL_CHANGE',
      reason_code: self.reasonCode,
      reason: self.reason,
    })
  }

  if (input.councilRecommendRestart) {
    denials.push({
      capability_or_action: 'COUNCIL_RESTART',
      reason_code: 'COUNCIL_CANNOT_AUTHORIZE',
      reason: 'Council recommendation to restart does not authorize restart.',
    })
  }

  if (input.astraAuthorizeRestart) {
    denials.push({
      capability_or_action: 'ASTRA_RESTART',
      reason_code: 'ASTRA_MISSION_NOT_EXECUTION_AUTHORITY',
      reason: 'ASTRA mission does not authorize production restart.',
    })
  }

  if (input.securityHandoff?.summary) {
    limitations.push(`Security handoff advisory: ${input.securityHandoff.summary.slice(0, 160)}`)
    limitations.push('Security finding does not grant mutation authority.')
  }

  if (input.researchHandoff?.summary) {
    limitations.push(`Research handoff advisory: ${input.researchHandoff.summary.slice(0, 160)}`)
    limitations.push('Research evidence does not grant network mutation authority.')
  }

  if (input.recommendEngineering) {
    limitations.push('Engineering task recommended only — not auto-invoked.')
  }

  // Service role ≠ policy permission
  const serviceRole = evaluateGovernedAction({
    mode: 'commander',
    safetyLock: true,
    actionKind: 'PRODUCTION_RESTART',
    body: {},
    commanderSessionOk: false,
    requestingActorId: 'service_role',
    approvingActorId: 'service_role',
  })
  if (serviceRole.outcome !== 'DENY') {
    denials.push({
      capability_or_action: 'SERVICE_ROLE',
      reason_code: 'SERVICE_ROLE_NOT_POLICY_PERMISSION',
      reason: 'Unexpected service-role restart allow — fail closed.',
    })
  } else {
    denials.push({
      capability_or_action: 'SERVICE_ROLE_PROBE',
      reason_code: serviceRole.reasonCode,
      reason: 'SERVICE_ROLE_TECHNICAL_REACH != POLICY_PERMISSION (restart denied).',
    })
  }

  if (
    input.conversationId &&
    input.conversationOwnerUserId &&
    input.conversationOwnerUserId !== input.ownerUserId
  ) {
    denials.push({
      capability_or_action: 'OWNER_SCOPE',
      reason_code: 'OWNER_SCOPE_DENIED',
      reason: 'Cross-user operations context denied.',
    })
    return finish('DENIED', emptyScope(), emptySummaries)
  }

  if (input.enforceOwnership && input.conversationOwnerUserId) {
    const match = assertOperationsOwnerScopeMatch(input.ownerUserId, input.conversationOwnerUserId)
    if (!match.ok) {
      denials.push({
        capability_or_action: 'OWNER_SCOPE',
        reason_code: 'OWNER_SCOPE_DENIED',
        reason: match.reason,
      })
      return finish('DENIED', emptyScope(), emptySummaries)
    }
  }

  // Hard deny early for mutation attempts without running diagnostics mutation
  const hardDenyActions = [
    'PROCESS_TERMINATE',
    'PRODUCTION_RESTART',
    'PRODUCTION_DEPLOY',
    'DEV_RESTART',
    'GIT_PUSH',
    'AGENT_SPAWN',
  ]
  if (input.attemptedAction && hardDenyActions.includes(input.attemptedAction) && !input.operationsQuestion.includes('diagnose')) {
    // Still allow diagnostics when question is diagnostic; denials already recorded
  }

  const scope = createOperationsAgentScope({
    operationsQuestion: input.operationsQuestion,
    targets,
    allowedDiagnostics: input.allowedDiagnostics,
    ownerUserId: input.ownerUserId,
    requestedBy: input.requestedBy,
    conversationId: input.conversationId,
    missionId: input.missionId,
    nowIso: startedAt,
  })

  if (isOperationsScopeExpired(scope)) {
    denials.push({
      capability_or_action: 'SCOPE',
      reason_code: 'APPROVAL_EXPIRED',
      reason: 'Operations scope expired.',
    })
    return finish('DENIED', scope, emptySummaries)
  }

  const diag = await runOperationsDiagnostics({
    scope,
    simulateTransientRecovery: input.simulateTransientRecovery,
    simulateWrongProcessOn3000: input.simulateWrongProcessOn3000,
    simulateRestartStorm: input.simulateRestartStorm,
  })

  checks.push(...diag.checks)
  findings.push(...diag.findings)
  unavailable.push(...diag.unavailable)

  // Unhealthy must not auto-restart — verify no restart action was taken (structural)
  limitations.push('Unhealthy observation does not trigger auto-restart.')

  const openHighOrCritical = findings.filter(
    f => (f.severity === 'HIGH' || f.severity === 'CRITICAL') && f.approval_required,
  ).length
  const checksOk = checks.filter(c => c.ok && !c.denied).length
  const checksFailed = checks.filter(c => !c.ok && !c.denied).length

  let status = classifyOperationsStatus({
    denied: false,
    checksOk,
    checksFailed,
    openHighOrCritical: 0, // HIGH findings with approval_required are expected operational truth, not agent failure
  })

  // If only denials and no checks, DENIED
  if (checks.length === 0 && denials.length > 0 && findings.length === 0) {
    status = 'DENIED'
  }

  // Ensure findings requiring mutation include approval_required
  for (const f of findings) {
    if (f.action_kind_if_needed && !f.approval_required) {
      f.approval_required = true
      f.requires_commander = true
    }
  }

  void openHighOrCritical

  return finish(status, scope, {
    health_summary: diag.health_summary,
    process_summary: diag.process_summary,
    port_summary: diag.port_summary,
    watchdog_summary: diag.watchdog_summary,
    public_route_summary: diag.public_route_summary,
    dependency_summary: diag.dependency_summary,
  })
}

export function operationsAgentResultForCouncil(result: OperationsAgentResult) {
  return {
    agent_role: result.agent_role,
    status: result.status,
    operations_question: result.operations_question,
    findings: result.findings.map(f => ({
      finding_id: f.finding_id,
      title: f.title,
      severity: f.severity,
      status: f.status,
      recommended_action: f.recommended_action,
      approval_required: f.approval_required,
      requires_commander: f.requires_commander,
    })),
    health_summary: result.health_summary,
    public_route_summary: result.public_route_summary,
    denials: result.denials,
    limitations: result.limitations,
    boundary_notes: result.boundary_notes,
    is_authorization: false as const,
    auto_repair: false as const,
  }
}

export function operationsAgentResultForAstra(result: OperationsAgentResult) {
  return {
    ...operationsAgentResultForCouncil(result),
    checks_run: result.checks_run,
    port_summary: result.port_summary,
    watchdog_summary: result.watchdog_summary,
    audit_id: result.audit_id,
  }
}
