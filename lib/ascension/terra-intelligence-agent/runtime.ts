/**
 * #22 Phase 6 — Bounded TERRA_INTELLIGENCE_AGENT runtime.
 * World-state analysis only. No action authority. Ascension autonomy OFF.
 */
import { randomUUID } from 'node:crypto'
import { buildGovernedAuditMetadata, insertGovernedAuditLog } from '@/lib/war-room/governedAudit'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import type { TerraCouncilHandoffPayload } from '@/lib/terra/councilHandoff'
import type { TerraLiveGeoObject } from '@/lib/terra/liveGeoIntelligence'
import {
  createTerraIntelligenceAgentIdentity,
  isTerraIntelligenceAgentRuntimeAvailable,
  TERRA_INTELLIGENCE_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
} from './identity'
import {
  assertTerraIntelligenceCannotSelfApprove,
  denyTerraIntelligenceAgentAction,
} from './profile'
import { createTerraIntelligenceScope, isTerraIntelligenceScopeExpired, type TerraIntelligenceScope } from './scope'
import {
  classifyTerraIntelligenceStatus,
  TERRA_INTELLIGENCE_BOUNDARY_NOTES,
  type TerraIntelligenceDenial,
  type TerraIntelligenceResult,
  type TerraWorldStateFinding,
  type TerraWorldStateObject,
} from './result'
import { assertBabyTerraSessionDenied, assertTerraIntelligenceOwnerScopeMatch } from './ownership'
import { analyzeTerraWorldState, makeDigitrafficFixtureVessel } from './analyze'
import { ascensionAutonomyIsOff } from '@/lib/ascension/operationalRegistry'

export type RunBoundedTerraIntelligenceInput = {
  worldStateQuestion: string
  ownerUserId: string
  requestedBy: string
  invokedBy: 'commander' | 'council' | 'astra'
  geographicScope?: string | null
  timeScope?: string | null
  providerScope?: string[] | null
  objects?: TerraLiveGeoObject[]
  terraHandoff?: TerraCouncilHandoffPayload | null
  useDigitrafficFixture?: boolean
  liveOnly?: boolean
  includeCached?: boolean
  includeHistorical?: boolean
  includeInferred?: boolean
  missionId?: string | null
  conversationId?: string | null
  conversationOwnerUserId?: string | null
  enforceOwnership?: boolean
  babyContextAttempt?: boolean
  attemptedAction?: string | null
  councilConcludeAsAuthorization?: boolean
  astraElevateAuthority?: boolean
  researchHandoff?: { summary?: string } | null
  securityHandoff?: { summary?: string } | null
  operationsHandoff?: { summary?: string } | null
  recommendEngineering?: boolean
  simulateProviderFailure?: boolean
  simulateNoCoverage?: boolean
  supabase?: WarRoomSupabase | null
  nowIso?: string
}

export async function runBoundedTerraIntelligenceAgent(
  input: RunBoundedTerraIntelligenceInput,
): Promise<TerraIntelligenceResult> {
  const startedAt = input.nowIso ?? new Date().toISOString()
  const requestId = randomUUID()
  const denials: TerraIntelligenceDenial[] = []
  const limitations: string[] = []
  const unavailable: string[] = []
  let auditId: string | null = null
  let findings: TerraWorldStateFinding[] = []
  let objects: TerraWorldStateObject[] = []
  let events: Array<Record<string, unknown>> = []
  let evidence_refs: string[] = []
  let provider_refs: string[] = []
  let sources: TerraIntelligenceResult['sources'] = []
  let freshness_summary = ''
  let coverage_summary = ''
  let confidence: TerraIntelligenceResult['confidence'] = 'UNVERIFIED'
  let conflicts: string[] = []
  let recommended_council_questions: string[] = []

  const emptyScope = (): TerraIntelligenceScope =>
    createTerraIntelligenceScope({
      worldStateQuestion: input.worldStateQuestion || '(none)',
      ownerUserId: input.ownerUserId,
      requestedBy: input.requestedBy,
      conversationId: input.conversationId,
      missionId: input.missionId,
      geographicScope: input.geographicScope,
      timeScope: input.timeScope,
      providerScope: input.providerScope,
      nowIso: startedAt,
    })

  const finish = async (
    status: TerraIntelligenceResult['status'],
    scope: TerraIntelligenceScope,
    summary: string,
  ): Promise<TerraIntelligenceResult> => {
    const identity = createTerraIntelligenceAgentIdentity({
      requestId,
      ownerUserId: input.ownerUserId,
      requestedBy: input.requestedBy,
      allowedQueryClasses: scope.allowed_query_classes,
      geographicScope: scope.geographic_scope,
      timeScope: scope.time_scope,
      providerScope: scope.provider_scope,
      missionId: input.missionId,
      conversationId: input.conversationId,
      expiresAt: scope.expires_at,
      nowIso: startedAt,
    })

    const result: TerraIntelligenceResult = {
      agent_id: identity.agent_id,
      agent_role: 'TERRA_INTELLIGENCE_AGENT',
      status,
      world_state_question: scope.world_state_question,
      scope,
      summary,
      findings,
      objects,
      events,
      evidence_refs,
      provider_refs,
      sources,
      freshness_summary,
      coverage_summary,
      confidence,
      conflicts,
      limitations: [
        ...limitations,
        'NO ACTION AUTHORITY',
        'INVOCATION_DRIVEN',
        'WORLD_STATE_ANALYSIS only',
      ],
      denials,
      unavailable_capabilities: unavailable,
      recommended_council_questions,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      owner_scope: input.ownerUserId,
      mission_id: input.missionId ?? null,
      conversation_id: input.conversationId ?? null,
      audit_id: auditId,
      identity,
      boundary_notes: TERRA_INTELLIGENCE_BOUNDARY_NOTES,
      plan_summary: 'QUERY → READ → NORMALIZE → CORRELATE → CLASSIFY → RETURN EVIDENCE (NO AUTHORIZE)',
      gps_state: 'NOT_IMPLEMENTED',
      traffic_state: 'NOT_IMPLEMENTED',
      planetary_descent_state: 'ABSENT',
    }

    try {
      const decision: PolicyDecision =
        status === 'DENIED'
          ? {
              outcome: 'DENY',
              reasonCode: 'POLICY_DENIED',
              reason: denials[0]?.reason ?? 'Terra intelligence denied.',
              actionKind: 'terra_world_state_analysis',
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
              reason: 'Bounded Terra world-state analysis.',
              actionKind: 'terra_world_state_analysis',
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
        actorAgent: 'TERRA_INTELLIGENCE_AGENT',
        missionId: input.missionId ?? null,
        tool: 'ascension.terra_intelligence_agent.runBoundedTerraIntelligenceAgent',
        target: scope.world_state_question.slice(0, 200),
        ownerUserId: input.ownerUserId,
        evidenceRefs: evidence_refs.slice(0, 20),
        executionResult:
          status === 'DENIED' ? 'denied' : status === 'FAILED' ? 'failed' : 'executed',
      })

      await insertGovernedAuditLog(input.supabase ?? null, {
        actor: input.invokedBy === 'commander' ? 'user' : 'system',
        category: 'runtime',
        message: `TERRA_INTELLIGENCE_AGENT ${status}: ${scope.world_state_question.slice(0, 200)}`,
        actionId: requestId,
        metadata: meta,
        extra: {
          invocation: input.invokedBy,
          status,
          geographic_scope: scope.geographic_scope,
          time_scope: scope.time_scope,
          provider_scope: scope.provider_scope,
          providers_used: sources.map(s => ({ id: s.provider, freshness: s.freshness, implemented: s.implemented })),
          freshness_summary,
          coverage_summary,
          findings_count: findings.length,
          evidence_refs: evidence_refs.slice(0, 40),
          policy_decisions: denials,
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

  if (!isTerraIntelligenceAgentRuntimeAvailable()) {
    denials.push({
      capability_or_action: 'RUNTIME',
      reason_code: 'UNAVAILABLE',
      reason: 'TERRA_INTELLIGENCE_AGENT disabled via ASCENSION_TERRA_INTELLIGENCE_AGENT_ENABLED=false.',
    })
    return finish('DENIED', emptyScope(), 'Runtime disabled.')
  }

  if (!ascensionAutonomyIsOff() || TERRA_INTELLIGENCE_AGENT_AUTONOMOUS_EXECUTION_ENABLED) {
    denials.push({
      capability_or_action: 'ASCENSION_AUTONOMY',
      reason_code: 'POLICY_DENIED',
      reason: 'Ascension autonomy must remain OFF.',
    })
    return finish('DENIED', emptyScope(), 'Autonomy guard failed.')
  }

  if (!input.worldStateQuestion?.trim()) {
    denials.push({
      capability_or_action: 'SCOPE',
      reason_code: 'TARGET_OUT_OF_SCOPE',
      reason: 'world_state_question is required — no unbounded planetary monitor scope.',
    })
    return finish('DENIED', emptyScope(), 'Missing question.')
  }

  if (input.attemptedAction) {
    const d = denyTerraIntelligenceAgentAction(input.attemptedAction)
    denials.push({
      capability_or_action: input.attemptedAction,
      reason_code: d.reasonCode,
      reason: d.reason,
    })
  }

  const self = assertTerraIntelligenceCannotSelfApprove()
  if (input.attemptedAction === 'self_approve' || input.attemptedAction === 'APPROVAL_CHANGE') {
    denials.push({
      capability_or_action: 'APPROVAL_CHANGE',
      reason_code: self.reasonCode,
      reason: self.reason,
    })
  }

  if (input.babyContextAttempt) {
    const baby = assertBabyTerraSessionDenied()
    denials.push({
      capability_or_action: 'BABY_TERRA_CONTEXT',
      reason_code: 'POLICY_DENIED',
      reason: baby.reason,
    })
  }

  if (input.councilConcludeAsAuthorization) {
    denials.push({
      capability_or_action: 'COUNCIL_AUTHORIZATION',
      reason_code: 'COUNCIL_CANNOT_AUTHORIZE',
      reason: 'Council conclusion is not execution authorization.',
    })
  }

  if (input.astraElevateAuthority) {
    denials.push({
      capability_or_action: 'ASTRA_AUTHORITY',
      reason_code: 'ASTRA_MISSION_NOT_EXECUTION_AUTHORITY',
      reason: 'ASTRA assignment does not elevate Terra Agent authority.',
    })
  }

  if (input.researchHandoff?.summary) {
    limitations.push(`Research handoff advisory: ${input.researchHandoff.summary.slice(0, 120)}`)
    limitations.push('Research handoff does not expand Terra Agent authority.')
  }
  if (input.securityHandoff?.summary) {
    limitations.push(`Security handoff advisory: ${input.securityHandoff.summary.slice(0, 120)}`)
    limitations.push('Security handoff does not expand Terra Agent authority.')
  }
  if (input.operationsHandoff?.summary) {
    limitations.push(`Operations handoff advisory: ${input.operationsHandoff.summary.slice(0, 120)}`)
    limitations.push('Operations (server health) is distinct from Terra world-state truth.')
  }
  if (input.recommendEngineering) {
    limitations.push('ENGINEERING_REVIEW_REQUIRED recommended only — Engineering Agent not auto-invoked.')
  }

  // Selection / authorization boundaries always recorded
  limitations.push('TERRA SELECTION != COUNCIL SEND')
  limitations.push('TERRA SELECTION != ASTRA MISSION')
  limitations.push('TERRA EVIDENCE != AUTHORIZATION')

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
    reason: 'SERVICE_ROLE_TECHNICAL_REACH != POLICY_PERMISSION.',
  })

  if (
    input.conversationId &&
    input.conversationOwnerUserId &&
    input.conversationOwnerUserId !== input.ownerUserId
  ) {
    denials.push({
      capability_or_action: 'OWNER_SCOPE',
      reason_code: 'OWNER_SCOPE_DENIED',
      reason: 'Cross-user Terra/Council context denied.',
    })
    return finish('DENIED', emptyScope(), 'Owner scope denied.')
  }

  if (input.enforceOwnership && input.conversationOwnerUserId) {
    const match = assertTerraIntelligenceOwnerScopeMatch(input.ownerUserId, input.conversationOwnerUserId)
    if (!match.ok) {
      denials.push({
        capability_or_action: 'OWNER_SCOPE',
        reason_code: 'OWNER_SCOPE_DENIED',
        reason: match.reason,
      })
      return finish('DENIED', emptyScope(), 'Owner scope denied.')
    }
  }

  const scope = createTerraIntelligenceScope({
    worldStateQuestion: input.worldStateQuestion,
    ownerUserId: input.ownerUserId,
    requestedBy: input.requestedBy,
    conversationId: input.conversationId,
    missionId: input.missionId,
    geographicScope: input.geographicScope,
    timeScope: input.timeScope,
    providerScope: input.providerScope,
    liveOnly: input.liveOnly,
    includeCached: input.includeCached,
    includeHistorical: input.includeHistorical,
    includeInferred: input.includeInferred,
    nowIso: startedAt,
  })

  if (isTerraIntelligenceScopeExpired(scope)) {
    denials.push({
      capability_or_action: 'SCOPE',
      reason_code: 'APPROVAL_EXPIRED',
      reason: 'Terra intelligence scope expired.',
    })
    return finish('DENIED', scope, 'Scope expired.')
  }

  const objectsIn: TerraLiveGeoObject[] = [...(input.objects ?? [])]
  if (input.useDigitrafficFixture !== false && objectsIn.length === 0 && !input.simulateNoCoverage) {
    objectsIn.push(makeDigitrafficFixtureVessel())
  }

  const analyzed = analyzeTerraWorldState({
    scope,
    objects: objectsIn,
    handoff: input.terraHandoff,
    simulateProviderFailure: input.simulateProviderFailure,
    simulateNoCoverage: input.simulateNoCoverage,
  })

  findings = analyzed.findings
  objects = analyzed.objects
  events = analyzed.events
  evidence_refs = analyzed.evidence_refs
  provider_refs = analyzed.provider_refs
  sources = analyzed.sources
  freshness_summary = analyzed.freshness_summary
  coverage_summary = analyzed.coverage_summary
  confidence = analyzed.confidence
  conflicts = analyzed.conflicts
  limitations.push(...analyzed.limitations)
  unavailable.push(...analyzed.unavailable)

  recommended_council_questions = [
    'What meaning should Council assign to these Terra observations?',
    'Are any conflicts material for Commander attention?',
    'What coverage gaps should be disclosed as limitations?',
  ]

  // Optional Search remains read-only — capability listed but not expanding crawl
  if (scope.allowed_query_classes.includes('OPTIONAL_BOUNDED_SEARCH_READ')) {
    limitations.push('Optional Search support remains read-only; no crawl expansion.')
  }

  const status = classifyTerraIntelligenceStatus({
    denied: false,
    queryFailed: false,
    noCoverage: analyzed.no_coverage,
    objects: objects.length,
    providerFailures: analyzed.provider_failures,
    providerOk: analyzed.provider_ok,
  })

  // COMPLETE requires evidence processing success
  let finalStatus = status
  if (finalStatus === 'COMPLETE' && findings.length === 0) finalStatus = 'PARTIAL'

  const summary =
    finalStatus === 'NO_COVERAGE'
      ? `NO_COVERAGE: ${coverage_summary}`
      : `Terra analysis ${finalStatus}: ${objects.length} object(s); ${findings.length} finding(s).`

  return finish(finalStatus, scope, summary)
}

export function terraIntelligenceResultForCouncil(result: TerraIntelligenceResult) {
  return {
    agent_role: result.agent_role,
    status: result.status,
    world_state_question: result.world_state_question,
    summary: result.summary,
    findings: result.findings,
    freshness_summary: result.freshness_summary,
    coverage_summary: result.coverage_summary,
    confidence: result.confidence,
    conflicts: result.conflicts,
    limitations: result.limitations,
    boundary_notes: result.boundary_notes,
    recommended_council_questions: result.recommended_council_questions,
    is_authorization: false as const,
    is_council_conclusion: false as const,
  }
}

export function terraIntelligenceResultForAstra(result: TerraIntelligenceResult) {
  return {
    ...terraIntelligenceResultForCouncil(result),
    objects: result.objects,
    provider_refs: result.provider_refs,
    sources: result.sources,
    audit_id: result.audit_id,
    gps_state: result.gps_state,
    traffic_state: result.traffic_state,
  }
}
