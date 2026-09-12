/**
 * #22 Phase 4 — Bounded SECURITY_RED_TEAM_AGENT runtime.
 * Safe probes only. No auto-remediation. No Engineering auto-invoke.
 * Invocation-driven; Ascension autonomy OFF.
 */
import { randomUUID } from 'node:crypto'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { buildGovernedAuditMetadata, insertGovernedAuditLog } from '@/lib/war-room/governedAudit'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import {
  createSecurityRedTeamAgentIdentity,
  isSecurityRedTeamAgentRuntimeAvailable,
  SECURITY_RED_TEAM_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
} from './identity'
import {
  denySecurityRedTeamAction,
  isProhibitedProbeClass,
  assertSecurityRedTeamCannotSelfApprove,
} from './profile'
import { createSecurityRedTeamScope, isSecurityScopeExpired, type SecurityRedTeamScope } from './scope'
import {
  classifySecurityStatus,
  emptySeverityDistribution,
  SECURITY_RED_TEAM_BOUNDARY_NOTES,
  type SecurityFinding,
  type SecurityRedTeamDenial,
  type SecurityRedTeamResult,
  type SecurityTestRun,
} from './result'
import { assertSecurityOwnerScopeMatch } from './ownership'
import {
  runAliasProbes,
  runApprovalProbes,
  runEngineeringEscapeProbes,
  runLaunderingProbes,
  runOwnershipProbes,
  runProhibitedProbeDenial,
  runResearchProbes,
  runRuntimeTruthProbes,
  runSelfRedTeamProbes,
  runServiceRoleAndAuditProbes,
  runStaticPolicyProbes,
} from './probes'
import { ascensionAutonomyIsOff } from '@/lib/ascension/operationalRegistry'

export type RunBoundedSecurityRedTeamInput = {
  securityQuestion: string
  ownerUserId: string
  requestedBy: string
  invokedBy: 'commander' | 'council' | 'astra'
  targets?: string[]
  allowedProbeClasses?: string[]
  /** Prohibited probes requested — recorded as denials, never executed. */
  prohibitedProbeAttempts?: string[]
  /** Escape-hatch dangerous actions for red-team-the-red-team. */
  attemptedAction?: string | null
  missionId?: string | null
  conversationId?: string | null
  conversationOwnerUserId?: string | null
  enforceOwnership?: boolean
  researchHandoff?: { summary?: string } | null
  /** Operations observation — advisory only. Cannot grant shell or remediation. */
  operationsHandoff?: { summary?: string; grantShell?: boolean } | null
  worktree?: string | null
  supabase?: WarRoomSupabase | null
  nowIso?: string
  repositoryRoot?: string
}

function mergeBundle(
  into: {
    tests: SecurityTestRun[]
    findings: SecurityFinding[]
    denials: SecurityRedTeamDenial[]
    unavailable: string[]
  },
  bundle: {
    tests: SecurityTestRun[]
    findings: SecurityFinding[]
    denials: SecurityRedTeamDenial[]
    unavailable: string[]
  },
  maxFindings: number,
) {
  into.tests.push(...bundle.tests)
  into.denials.push(...bundle.denials)
  into.unavailable.push(...bundle.unavailable)
  for (const f of bundle.findings) {
    if (into.findings.length >= maxFindings) break
    into.findings.push(f)
  }
}

export async function runBoundedSecurityRedTeamAgent(
  input: RunBoundedSecurityRedTeamInput,
): Promise<SecurityRedTeamResult> {
  const startedAt = input.nowIso ?? new Date().toISOString()
  const startedMs = Date.now()
  const requestId = randomUUID()
  const denials: SecurityRedTeamDenial[] = []
  const tests: SecurityTestRun[] = []
  const findings: SecurityFinding[] = []
  const unavailable: string[] = []
  const limitations: string[] = [
    'NO AUTOMATIC REMEDIATION — findings only.',
    'NO ACTIVE EXTERNAL SECURITY SCANNING.',
    'Research handoff is advisory only.',
    'Does not auto-create Engineering Agent tasks.',
  ]
  let auditId: string | null = null
  let auditWritten = false

  const repoRoot = input.repositoryRoot ?? resolveRepoRoot()
  const targets = input.targets?.length
    ? input.targets
    : [
        'permissions',
        'ownership',
        'research_agent',
        'engineering_agent',
        'council',
        'astra',
        'terra',
        'service_role',
        'audit',
      ]

  const emptyScope = (): SecurityRedTeamScope =>
    createSecurityRedTeamScope({
      securityQuestion: input.securityQuestion || '(none)',
      targets,
      allowedProbeClasses: input.allowedProbeClasses,
      ownerUserId: input.ownerUserId,
      requestedBy: input.requestedBy,
      repositoryRoot: repoRoot,
      worktree: input.worktree,
      conversationId: input.conversationId,
      missionId: input.missionId,
      nowIso: startedAt,
    })

  const finish = async (
    status: SecurityRedTeamResult['status'],
    scope: SecurityRedTeamScope,
  ): Promise<SecurityRedTeamResult> => {
    const identity = createSecurityRedTeamAgentIdentity({
      requestId,
      ownerUserId: input.ownerUserId,
      requestedBy: input.requestedBy,
      targets: scope.targets,
      allowedProbeClasses: scope.allowed_probe_classes,
      deniedProbeClasses: scope.denied_probe_classes,
      missionId: input.missionId,
      conversationId: input.conversationId,
      expiresAt: scope.expires_at,
      nowIso: startedAt,
    })

    const severity_distribution = emptySeverityDistribution()
    for (const f of findings) severity_distribution[f.severity] += 1

    const result: SecurityRedTeamResult = {
      agent_id: identity.agent_id,
      agent_role: 'SECURITY_RED_TEAM_AGENT',
      status,
      security_question: scope.security_question,
      scope,
      targets: scope.targets,
      tests_run: tests,
      findings,
      denials,
      unavailable_tests: unavailable,
      limitations,
      audit_id: auditId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      owner_scope: input.ownerUserId,
      mission_id: input.missionId ?? null,
      conversation_id: input.conversationId ?? null,
      identity,
      severity_distribution,
      boundary_notes: SECURITY_RED_TEAM_BOUNDARY_NOTES,
      plan_summary:
        'INSPECT → ANALYZE → SAFE PROBES → STRUCTURED FINDINGS → REMEDIATION RECOMMENDATIONS (NO AUTO-FIX)',
    }

    try {
      const decision: PolicyDecision =
        status === 'DENIED'
          ? {
              outcome: 'DENY',
              reasonCode: 'POLICY_DENIED',
              reason: denials[0]?.reason ?? 'Security evaluation denied.',
              actionKind: 'security_evaluation',
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
              reason: 'Bounded security evaluation within safe probe classes.',
              actionKind: 'security_evaluation',
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
        actorAgent: 'SECURITY_RED_TEAM_AGENT',
        missionId: input.missionId ?? null,
        tool: 'ascension.security_red_team_agent.runBoundedSecurityRedTeamAgent',
        target: scope.security_question.slice(0, 200),
        ownerUserId: input.ownerUserId,
        evidenceRefs: findings.slice(0, 20).map(f => f.finding_id),
        executionResult:
          status === 'DENIED' ? 'denied' : status === 'FAILED' ? 'failed' : 'executed',
      })

      await insertGovernedAuditLog(input.supabase ?? null, {
        actor: input.invokedBy === 'commander' ? 'user' : 'system',
        category: 'runtime',
        message: `SECURITY_RED_TEAM_AGENT ${status}: ${scope.security_question.slice(0, 200)}`,
        actionId: requestId,
        metadata: meta,
        extra: {
          invocation: input.invokedBy,
          status,
          probe_classes: scope.allowed_probe_classes,
          targets: scope.targets,
          tests_attempted: tests.map(t => t.test_id),
          tests_allowed: tests.filter(t => !t.denied).map(t => t.test_id),
          tests_denied: tests.filter(t => t.denied).map(t => t.test_id),
          findings_count: findings.length,
          severity_distribution,
          policy_decisions: denials,
          network_policy: scope.network_policy,
          chain_of_thought: undefined,
        },
      })
      auditId = requestId
      auditWritten = true
      result.audit_id = auditId
    } catch {
      limitations.push('Audit persistence unavailable — evaluation result still returned.')
      // Security agent cannot skip audit requirement for COMPLETE
      if (status === 'COMPLETE') {
        result.status = 'PARTIAL'
        denials.push({
          capability_or_action: 'AUDIT',
          reason_code: 'UNAVAILABLE',
          reason: 'Governed audit write failed — cannot claim COMPLETE.',
        })
      }
    }

    return result
  }

  if (!isSecurityRedTeamAgentRuntimeAvailable()) {
    denials.push({
      capability_or_action: 'RUNTIME',
      reason_code: 'UNAVAILABLE',
      reason: 'SECURITY_RED_TEAM_AGENT disabled via ASCENSION_SECURITY_RED_TEAM_AGENT_ENABLED=false.',
    })
    return finish('DENIED', emptyScope())
  }

  if (!ascensionAutonomyIsOff() || SECURITY_RED_TEAM_AGENT_AUTONOMOUS_EXECUTION_ENABLED) {
    denials.push({
      capability_or_action: 'ASCENSION_AUTONOMY',
      reason_code: 'POLICY_DENIED',
      reason: 'Ascension autonomy must remain OFF.',
    })
    return finish('DENIED', emptyScope())
  }

  if (!input.securityQuestion?.trim()) {
    denials.push({
      capability_or_action: 'SCOPE',
      reason_code: 'TARGET_OUT_OF_SCOPE',
      reason: 'security_question is required — no open-ended hack-everything scope.',
    })
    return finish('DENIED', emptyScope())
  }

  if (input.attemptedAction) {
    const d = denySecurityRedTeamAction(input.attemptedAction)
    denials.push({
      capability_or_action: input.attemptedAction,
      reason_code: d.reasonCode,
      reason: d.reason,
    })
  }

  const self = assertSecurityRedTeamCannotSelfApprove()
  if (input.attemptedAction === 'self_approve' || input.attemptedAction === 'APPROVAL_CHANGE') {
    denials.push({
      capability_or_action: 'APPROVAL_CHANGE',
      reason_code: self.reasonCode,
      reason: self.reason,
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
      reason: 'Security actor cannot read foreign user context.',
    })
    return finish('DENIED', emptyScope())
  }

  if (input.enforceOwnership && input.conversationOwnerUserId) {
    const match = assertSecurityOwnerScopeMatch(input.ownerUserId, input.conversationOwnerUserId)
    if (!match.ok) {
      denials.push({
        capability_or_action: 'OWNER_SCOPE',
        reason_code: 'OWNER_SCOPE_DENIED',
        reason: match.reason,
      })
      return finish('DENIED', emptyScope())
    }
  }

  if (input.researchHandoff?.summary) {
    limitations.push(
      `Research handoff noted (advisory): ${input.researchHandoff.summary.slice(0, 160)}`,
    )
  }

  if (input.operationsHandoff?.summary) {
    limitations.push(
      `Operations handoff noted (observation-only): ${input.operationsHandoff.summary.slice(0, 160)}`,
    )
  }
  if (input.operationsHandoff?.grantShell) {
    denials.push({
      capability_or_action: 'SHELL',
      reason_code: 'AUTHORITY_DENIED',
      reason: 'Operations handoff cannot grant Security a shell. Evaluation only.',
    })
  }

  const scope = createSecurityRedTeamScope({
    securityQuestion: input.securityQuestion,
    targets,
    allowedProbeClasses: input.allowedProbeClasses,
    ownerUserId: input.ownerUserId,
    requestedBy: input.requestedBy,
    repositoryRoot: repoRoot,
    worktree: input.worktree,
    conversationId: input.conversationId,
    missionId: input.missionId,
    nowIso: startedAt,
  })

  if (isSecurityScopeExpired(scope)) {
    denials.push({
      capability_or_action: 'SCOPE',
      reason_code: 'APPROVAL_EXPIRED',
      reason: 'Security evaluation scope expired.',
    })
    return finish('DENIED', scope)
  }

  const bag = { tests, findings, denials, unavailable }

  for (const prohibited of input.prohibitedProbeAttempts ?? [
    'REAL_EXTERNAL_EXPLOIT',
    'DESTRUCTIVE_DB_TEST',
    'PRODUCTION_KILL_TEST',
    'PRODUCTION_RESTART_TEST',
    'SECRET_EXTRACTION',
    'CREDENTIAL_DUMP',
    'MALWARE_EXECUTION',
    'PRIVILEGE_ESCALATION',
    'DENIAL_OF_SERVICE',
    'FINANCIAL_ACTION',
    'REAL_MESSAGE_SEND',
    'REAL_PHONE_ACTION',
  ]) {
    if (isProhibitedProbeClass(prohibited)) {
      mergeBundle(bag, runProhibitedProbeDenial(prohibited), scope.max_findings)
    }
  }

  const probeFns: Array<() => ReturnType<typeof runStaticPolicyProbes>> = [
    runStaticPolicyProbes,
    runOwnershipProbes.bind(null, input.ownerUserId),
    runApprovalProbes,
    runLaunderingProbes,
    runAliasProbes,
    runEngineeringEscapeProbes,
    runResearchProbes,
    runSelfRedTeamProbes,
  ]

  let probesRun = 0
  for (const fn of probeFns) {
    if (probesRun >= scope.max_probe_count) break
    if (Date.now() - startedMs > scope.max_runtime_ms) {
      denials.push({
        capability_or_action: 'MAX_RUNTIME',
        reason_code: 'POLICY_DENIED',
        reason: 'max_runtime_ms exceeded — stopping without escalating probe danger.',
      })
      break
    }
    mergeBundle(bag, fn(), scope.max_findings)
    probesRun += 1
  }

  // Service role + audit probe after we attempt audit in finish — run a provisional check first
  mergeBundle(bag, runServiceRoleAndAuditProbes(true), scope.max_findings)
  mergeBundle(bag, runRuntimeTruthProbes(), scope.max_findings)

  const requiredFailed = tests.some(t => !t.ok && !t.denied)
  const openHighOrCritical = findings.filter(
    f => f.status === 'OPEN' && (f.severity === 'HIGH' || f.severity === 'CRITICAL'),
  ).length

  let status = classifySecurityStatus({
    denied: false,
    requiredProbesFailed: requiredFailed,
    probesRun: tests.filter(t => !t.denied).length,
    probesExpected: 8,
    openHighOrCritical,
  })

  // Early dangerous attempt alone does not void COMPLETE if probes ran
  if (input.attemptedAction && tests.filter(t => !t.denied && t.ok).length === 0) {
    status = 'DENIED'
  }

  const result = await finish(status, scope)

  // Re-check auditWritten after finish
  if (!result.audit_id && result.status === 'COMPLETE') {
    result.status = 'PARTIAL'
    result.denials.push({
      capability_or_action: 'AUDIT',
      reason_code: 'UNAVAILABLE',
      reason: 'Audit id missing — cannot claim COMPLETE.',
    })
  }

  return result
}

export function securityRedTeamResultForCouncil(result: SecurityRedTeamResult) {
  return {
    agent_role: result.agent_role,
    status: result.status,
    security_question: result.security_question,
    findings: result.findings.map(f => ({
      finding_id: f.finding_id,
      title: f.title,
      severity: f.severity,
      status: f.status,
      recommended_fix: f.recommended_fix,
      requires_commander_action: f.requires_commander_action,
    })),
    severity_distribution: result.severity_distribution,
    denials: result.denials,
    limitations: result.limitations,
    boundary_notes: result.boundary_notes,
    is_authorization: false as const,
    auto_remediation: false as const,
  }
}

export function securityRedTeamResultForAstra(result: SecurityRedTeamResult) {
  return {
    ...securityRedTeamResultForCouncil(result),
    tests_run: result.tests_run,
    targets: result.targets,
    audit_id: result.audit_id,
  }
}
