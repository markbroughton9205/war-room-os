/**
 * #22 Phase 7 — Bounded COUNCIL_VALIDATOR runtime.
 * Validation only. No action authority. Ascension autonomy OFF.
 */
import { randomUUID } from 'node:crypto'
import { buildGovernedAuditMetadata, insertGovernedAuditLog } from '@/lib/war-room/governedAudit'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import {
  createCouncilValidatorIdentity,
  isCouncilValidatorRuntimeAvailable,
  COUNCIL_VALIDATOR_AUTONOMOUS_EXECUTION_ENABLED,
} from './identity'
import {
  assertCouncilValidatorCannotSelfApprove,
  denyCouncilValidatorAction,
} from './profile'
import {
  createCouncilValidatorScope,
  isCouncilValidatorScopeExpired,
  type CouncilValidatorScope,
} from './scope'
import {
  COUNCIL_VALIDATOR_BOUNDARY_NOTES,
  type CouncilValidatorDenial,
  type CouncilValidatorResult,
  type ValidatedClaim,
  type CouncilCorrectionRecommendation,
} from './result'
import {
  assertBabyCouncilValidatorDenied,
  assertCouncilValidatorOwnerScopeMatch,
} from './ownership'
import {
  makeCouncilValidatorFixtureClaims,
  validateCouncilClaims,
  type CouncilClaimInput,
} from './validateClaims'
import { ascensionAutonomyIsOff } from '@/lib/ascension/operationalRegistry'

export type RunBoundedCouncilValidatorInput = {
  conversationId: string
  ownerUserId: string
  requestedBy: string
  invokedBy: 'commander' | 'council' | 'astra'
  roundId?: string | null
  claims?: CouncilClaimInput[]
  useFixtureClaims?: boolean
  evidenceRefs?: string[]
  agentResultRefs?: string[]
  policyRefs?: string[] | null
  runtimeTruthRefs?: string[] | null
  missionId?: string | null
  conversationOwnerUserId?: string | null
  enforceOwnership?: boolean
  babyContextAttempt?: boolean
  attemptedAction?: string | null
  requestRevision?: boolean
  autoRewriteCouncilOutput?: boolean
  sessionIntelligencePresent?: boolean
  mutateSessionIntelligence?: boolean
  replaceDeliberationPipeline?: boolean
  supabase?: WarRoomSupabase | null
  nowIso?: string
}

export async function runBoundedCouncilValidator(
  input: RunBoundedCouncilValidatorInput,
): Promise<CouncilValidatorResult> {
  const startedAt = input.nowIso ?? new Date().toISOString()
  const requestId = randomUUID()
  const denials: CouncilValidatorDenial[] = []
  const limitations: string[] = []
  let auditId: string | null = null
  let claims_checked: ValidatedClaim[] = []
  let conflicts: string[] = []
  let policy_conflicts: string[] = []
  let runtime_truth_conflicts: string[] = []
  let recommended_corrections: CouncilCorrectionRecommendation[] = []
  let requires_council_revision = false
  let requires_commander_review = false
  let validation_pass = false
  let evidence_summary = ''
  let freshness_summary = ''
  let revision_requests = 0
  let ownership_state = 'PENDING'

  const emptyScope = (): CouncilValidatorScope =>
    createCouncilValidatorScope({
      conversationId: input.conversationId || '00000000-0000-4000-8000-000000000000',
      ownerUserId: input.ownerUserId,
      requestedBy: input.requestedBy,
      roundId: input.roundId,
      nowIso: startedAt,
    })

  const finish = async (
    status: CouncilValidatorResult['status'],
    scope: CouncilValidatorScope,
    summary: string,
  ): Promise<CouncilValidatorResult> => {
    const identity = createCouncilValidatorIdentity({
      requestId,
      ownerUserId: input.ownerUserId,
      requestedBy: input.requestedBy,
      evidenceRefs: scope.evidence_refs,
      missionId: input.missionId,
      conversationId: input.conversationId,
      roundId: input.roundId,
      expiresAt: scope.expires_at,
      nowIso: startedAt,
    })

    const result: CouncilValidatorResult = {
      agent_id: identity.agent_id,
      agent_role: 'COUNCIL_VALIDATOR',
      status,
      conversation_id: scope.conversation_id,
      round_id: scope.round_id,
      validation_summary: summary,
      claims_checked,
      evidence_summary,
      freshness_summary,
      conflicts,
      policy_conflicts,
      runtime_truth_conflicts,
      ownership_state,
      limitations: [
        ...limitations,
        'NO ACTION AUTHORITY',
        'INVOCATION_DRIVEN',
        'VALIDATION_ONLY',
        'VALIDATED != AUTHORIZED',
        'execution_authorized=false',
      ],
      recommended_corrections,
      requires_council_revision,
      requires_commander_review,
      validation_pass,
      execution_authorized: false,
      denials,
      audit_id: auditId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      scope,
      identity,
      boundary_notes: COUNCIL_VALIDATOR_BOUNDARY_NOTES,
      plan_summary: 'READ → COMPARE → VALIDATE → FLAG → RETURN (NO AUTHORIZE / NO AUTO-REWRITE)',
      session_intelligence_mutated: false,
      deliberation_pipeline_replaced: false,
      revision_requests,
      max_revision_requests: scope.max_revision_requests,
    }

    try {
      const decision: PolicyDecision =
        status === 'DENIED'
          ? {
              outcome: 'DENY',
              reasonCode: 'POLICY_DENIED',
              reason: denials[0]?.reason ?? 'Council validator denied.',
              actionKind: 'council_validation',
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
              reason: 'Bounded Council output validation.',
              actionKind: 'council_validation',
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
        actorAgent: 'COUNCIL_VALIDATOR',
        missionId: input.missionId ?? null,
        councilRound: input.roundId ?? null,
        tool: 'ascension.council_validator.runBoundedCouncilValidator',
        target: scope.conversation_id,
        ownerUserId: input.ownerUserId,
        evidenceRefs: scope.evidence_refs.slice(0, 20),
        executionResult:
          status === 'DENIED' ? 'denied' : status === 'FAILED' ? 'failed' : 'executed',
      })

      await insertGovernedAuditLog(input.supabase ?? null, {
        actor: input.invokedBy === 'commander' ? 'user' : 'system',
        category: 'runtime',
        message: `COUNCIL_VALIDATOR ${status}: conversation=${scope.conversation_id}`,
        actionId: requestId,
        metadata: meta,
        extra: {
          invocation: input.invokedBy,
          status,
          claims_checked: claims_checked.map(c => ({
            claim_id: c.claim_id,
            validation_result: c.validation_result,
            evidence_refs: c.evidence_refs,
            policy_state: c.policy_state,
            runtime_truth_state: c.runtime_truth_state,
          })),
          evidence_refs: scope.evidence_refs.slice(0, 40),
          agent_result_refs: scope.agent_result_refs.slice(0, 20),
          policy_conflicts,
          runtime_truth_conflicts,
          ownership_state,
          validation_pass,
          execution_authorized: false,
          chain_of_thought: undefined,
          secrets: undefined,
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

  if (!isCouncilValidatorRuntimeAvailable()) {
    denials.push({
      capability_or_action: 'RUNTIME',
      reason_code: 'UNAVAILABLE',
      reason: 'COUNCIL_VALIDATOR disabled via ASCENSION_COUNCIL_VALIDATOR_ENABLED=false.',
    })
    ownership_state = 'N/A'
    return finish('DENIED', emptyScope(), 'Runtime disabled.')
  }

  if (!ascensionAutonomyIsOff() || COUNCIL_VALIDATOR_AUTONOMOUS_EXECUTION_ENABLED) {
    denials.push({
      capability_or_action: 'ASCENSION_AUTONOMY',
      reason_code: 'POLICY_DENIED',
      reason: 'Ascension autonomy must remain OFF.',
    })
    ownership_state = 'N/A'
    return finish('DENIED', emptyScope(), 'Autonomy guard failed.')
  }

  if (!input.conversationId?.trim()) {
    denials.push({
      capability_or_action: 'SCOPE',
      reason_code: 'TARGET_OUT_OF_SCOPE',
      reason: 'conversation_id is required — no unbounded global validation scope.',
    })
    ownership_state = 'N/A'
    return finish('DENIED', emptyScope(), 'Missing conversation_id.')
  }

  if (input.attemptedAction) {
    const d = denyCouncilValidatorAction(input.attemptedAction)
    denials.push({
      capability_or_action: input.attemptedAction,
      reason_code: d.reasonCode,
      reason: d.reason,
    })
  }

  const self = assertCouncilValidatorCannotSelfApprove()
  if (input.attemptedAction === 'self_approve' || input.attemptedAction === 'APPROVAL_CHANGE') {
    denials.push({
      capability_or_action: 'APPROVAL_CHANGE',
      reason_code: self.reasonCode,
      reason: self.reason,
    })
  }

  if (input.babyContextAttempt) {
    const baby = assertBabyCouncilValidatorDenied()
    denials.push({
      capability_or_action: 'BABY_COUNCIL_CONTEXT',
      reason_code: 'POLICY_DENIED',
      reason: baby.reason,
    })
  }

  if (input.autoRewriteCouncilOutput) {
    denials.push({
      capability_or_action: 'AUTO_REWRITE_COUNCIL',
      reason_code: 'POLICY_DENIED',
      reason: 'Default correction boundary is FLAG + RETURN — no auto-rewrite.',
    })
    limitations.push('Correction remains recommendation by default.')
  }

  if (input.mutateSessionIntelligence) {
    denials.push({
      capability_or_action: 'SESSION_INTELLIGENCE_MUTATION',
      reason_code: 'POLICY_DENIED',
      reason: '#17 session intelligence must not be mutated by COUNCIL_VALIDATOR.',
    })
  }

  if (input.replaceDeliberationPipeline) {
    denials.push({
      capability_or_action: 'DELIBERATION_REPLACE',
      reason_code: 'POLICY_DENIED',
      reason: '#16 deliberation pipeline must not be replaced by COUNCIL_VALIDATOR.',
    })
  }

  const serviceRole = evaluateGovernedAction({
    mode: 'commander',
    safetyLock: true,
    actionKind: 'MISSION_EXECUTION',
    body: {},
    commanderSessionOk: false,
    requestingActorId: 'service_role',
    approvingActorId: 'service_role',
  })
  denials.push({
    capability_or_action: 'SERVICE_ROLE_PROBE',
    reason_code: serviceRole.reasonCode,
    reason: 'SERVICE_ROLE_TECHNICAL_REACH != POLICY_PERMISSION / ownership authority.',
  })

  if (
    input.conversationOwnerUserId &&
    input.conversationOwnerUserId !== input.ownerUserId
  ) {
    ownership_state = 'OWNERSHIP_DENIED'
    denials.push({
      capability_or_action: 'OWNER_SCOPE',
      reason_code: 'OWNER_SCOPE_DENIED',
      reason: 'Cross-user Council session denied.',
    })
    return finish('DENIED', emptyScope(), 'Owner scope denied.')
  }

  if (input.enforceOwnership) {
    const match = assertCouncilValidatorOwnerScopeMatch(
      input.ownerUserId,
      input.conversationOwnerUserId ?? input.ownerUserId,
    )
    if (!match.ok) {
      ownership_state = 'OWNERSHIP_DENIED'
      denials.push({
        capability_or_action: 'OWNER_SCOPE',
        reason_code: 'OWNER_SCOPE_DENIED',
        reason: match.reason,
      })
      return finish('DENIED', emptyScope(), 'Owner scope denied.')
    }
  }

  ownership_state = 'OWNER_MATCH'

  const claimsIn =
    input.claims?.length
      ? input.claims
      : input.useFixtureClaims !== false
        ? makeCouncilValidatorFixtureClaims()
        : []

  const evidenceRefs = [
    ...(input.evidenceRefs ?? []),
    ...claimsIn.flatMap(c => c.evidence_refs ?? []),
  ].filter((v, i, a) => a.indexOf(v) === i)

  const agentResultRefs = [
    ...(input.agentResultRefs ?? []),
    ...claimsIn.map(c => c.agent_result_ref).filter((v): v is string => Boolean(v)),
  ].filter((v, i, a) => a.indexOf(v) === i)

  const scope = createCouncilValidatorScope({
    conversationId: input.conversationId,
    ownerUserId: input.ownerUserId,
    requestedBy: input.requestedBy,
    roundId: input.roundId,
    claimSet: claimsIn.map(c => c.claim_text),
    evidenceRefs,
    agentResultRefs,
    policyRefs: input.policyRefs,
    runtimeTruthRefs: input.runtimeTruthRefs,
    nowIso: startedAt,
  })

  if (isCouncilValidatorScopeExpired(scope)) {
    denials.push({
      capability_or_action: 'SCOPE',
      reason_code: 'APPROVAL_EXPIRED',
      reason: 'Council validator scope expired.',
    })
    return finish('DENIED', scope, 'Scope expired.')
  }

  if (claimsIn.length === 0) {
    limitations.push('No claims provided — INSUFFICIENT_EVIDENCE.')
    validation_pass = false
    evidence_summary = 'claims=0'
    freshness_summary = 'n/a'
    return finish('FAILED', scope, 'No claims to validate.')
  }

  const analyzed = validateCouncilClaims({
    scope,
    claims: claimsIn,
    sessionIntelligencePresent: input.sessionIntelligencePresent !== false,
  })

  claims_checked = analyzed.claims_checked
  conflicts = analyzed.conflicts
  policy_conflicts = analyzed.policy_conflicts
  runtime_truth_conflicts = analyzed.runtime_truth_conflicts
  recommended_corrections = analyzed.recommended_corrections
  requires_council_revision = analyzed.requires_council_revision
  requires_commander_review = analyzed.requires_commander_review
  validation_pass = analyzed.validation_pass
  evidence_summary = analyzed.evidence_summary
  freshness_summary = analyzed.freshness_summary
  limitations.push(...analyzed.limitations)

  // Bounded revision request (FLAG only — does not invent recursive loops)
  if (input.requestRevision && requires_council_revision) {
    if (revision_requests < scope.max_revision_requests) {
      revision_requests = 1
      limitations.push('Revision REQUESTED once within max_revision_requests=1 hard cap.')
    }
  }

  // Never fabricate PASS when insufficient evidence present
  if (claims_checked.some(c => c.validation_result === 'INSUFFICIENT_EVIDENCE')) {
    validation_pass = false
  }

  // Conflicts must remain visible
  if (claims_checked.some(c => c.validation_result === 'CONFLICTING_EVIDENCE') && conflicts.length === 0) {
    conflicts.push('Conflicting evidence preserved.')
  }

  let status: CouncilValidatorResult['status'] = 'COMPLETE'
  if (claims_checked.length === 0) status = 'FAILED'
  else if (policy_conflicts.length > 0 || runtime_truth_conflicts.length > 0) status = 'PARTIAL'
  else if (!validation_pass) status = 'PARTIAL'

  const summary = `validation_pass=${validation_pass}; execution_authorized=false; claims=${claims_checked.length}; conflicts=${conflicts.length}; policy_conflicts=${policy_conflicts.length}`

  return finish(status, scope, summary)
}

export function councilValidatorResultForCouncil(result: CouncilValidatorResult) {
  return {
    agent_role: result.agent_role,
    status: result.status,
    validation_summary: result.validation_summary,
    claims_checked: result.claims_checked,
    conflicts: result.conflicts,
    policy_conflicts: result.policy_conflicts,
    runtime_truth_conflicts: result.runtime_truth_conflicts,
    recommended_corrections: result.recommended_corrections,
    requires_council_revision: result.requires_council_revision,
    validation_pass: result.validation_pass,
    execution_authorized: false as const,
    boundary_notes: result.boundary_notes,
  }
}

export function councilValidatorResultForAstra(result: CouncilValidatorResult) {
  return {
    ...councilValidatorResultForCouncil(result),
    requires_commander_review: result.requires_commander_review,
    audit_id: result.audit_id,
    ownership_state: result.ownership_state,
    /** ASTRA may use PASS/FAIL in planning only — never as execution permission. */
    may_use_for_planning: true as const,
    may_use_as_execution_permission: false as const,
  }
}
