/**
 * #22 Phase 2 — Bounded RESEARCH_AGENT runtime.
 * Reuses runLiveResearchRouter + buildLiveResearchEvidencePacket.
 * Does not create a second research engine. Invocation-driven only.
 */
import { randomUUID } from 'node:crypto'
import { runLiveResearchRouter } from '@/lib/research/researchRouter'
import {
  buildLiveResearchEvidencePacket,
  buildLiveResearchFailureEvidencePacket,
} from '@/lib/research/researchEvidence'
import { emptyLiveResearchEvidencePacket } from '@/lib/runtime/liveResearchEvidencePacket'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import { buildGovernedAuditMetadata, insertGovernedAuditLog } from '@/lib/war-room/governedAudit'
import { requireOwnedConversation } from '@/lib/war-room/conversationOwnership'
import {
  assertResearchAgentDiscoveryAllowed,
  denyResearchAgentAction,
} from './profile'
import { createResearchAgentIdentity } from './identity'
import { createResearchAgentScope, isScopeExpired, type ResearchAgentScope } from './scope'
import {
  classifyResultStatus,
  RESEARCH_AGENT_BOUNDARY_NOTES,
  type ResearchAgentDenial,
  type ResearchAgentFinding,
  type ResearchAgentResult,
} from './result'
import { isResearchAgentRuntimeAvailable, RESEARCH_AGENT_AUTONOMOUS_EXECUTION_ENABLED } from './identity'
import { ascensionAutonomyIsOff } from './registry'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import type { TerraCouncilHandoffPayload } from '@/lib/terra/councilHandoff'

export type RunBoundedResearchInput = {
  researchQuestion: string
  ownerUserId: string
  requestedBy: string
  /** Invocation path — all converge on the same runtime. */
  invokedBy: 'commander' | 'council' | 'astra'
  missionId?: string | null
  conversationId?: string | null
  councilRound?: string | number | null
  terraAllowed?: boolean
  liveSearchAllowed?: boolean
  storedResearchAllowed?: boolean
  /** Optional Terra evidence already selected by Commander — read-only context. */
  terraHandoff?: TerraCouncilHandoffPayload | null
  supabase?: WarRoomSupabase | null
  /** When true, enforce conversation ownership if conversationId present. */
  enforceOwnership?: boolean
  timeBudgetMs?: number
  nowIso?: string
  /** Escape-hatch attempts for red-team / policy tests — always denied. */
  attemptedAction?: string | null
}

function denialFromDecision(capability: string, decision: PolicyDecision): ResearchAgentDenial {
  return {
    capability_or_action: capability,
    reason_code: decision.reasonCode,
    reason: decision.reason,
  }
}

export async function runBoundedResearchAgent(
  input: RunBoundedResearchInput,
): Promise<ResearchAgentResult> {
  const startedAt = input.nowIso ?? new Date().toISOString()
  const requestId = randomUUID()
  const denials: ResearchAgentDenial[] = []
  const unavailable: string[] = []

  const deniedResult = (
    status: ResearchAgentResult['status'],
    summary: string,
    scope: ResearchAgentScope | null,
    extraDenials: ResearchAgentDenial[] = [],
  ): ResearchAgentResult => {
    const identity = createResearchAgentIdentity({
      requestId,
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
      missionId: input.missionId,
      councilRound: input.councilRound,
      scopeLabel: scope?.network_policy ?? 'DENIED',
      nowIso: startedAt,
    })
    const fallbackScope =
      scope ??
      ({
        research_question: input.researchQuestion,
        mission_id: input.missionId ?? null,
        conversation_id: input.conversationId ?? null,
        owner_user_id: input.ownerUserId,
        requested_by: input.requestedBy,
        allowed_capabilities: [],
        time_budget_ms: 0,
        result_limit: 0,
        source_evidence_limit: 0,
        max_search_queries: 0,
        max_fetches: 0,
        max_terra_queries: 0,
        max_iterations: 0,
        max_recursive_depth: 0,
        network_policy: 'SESSION_BOUNDED_READ_ONLY_DISCOVERY',
        terra_allowed: false,
        live_search_allowed: false,
        stored_research_allowed: false,
        created_at: startedAt,
        deadline_at: null,
      } satisfies ResearchAgentScope)

    return {
      agent_id: identity.agent_id,
      agent_role: 'RESEARCH_AGENT',
      status,
      research_question: input.researchQuestion,
      summary,
      findings: [],
      evidence_refs: [],
      terra_refs: [],
      sources: [],
      freshness_summary: 'unavailable',
      confidence: 0,
      limitations: [summary],
      denials: [...denials, ...extraDenials],
      unavailable_capabilities: unavailable,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      mission_id: input.missionId ?? null,
      conversation_id: input.conversationId ?? null,
      owner_user_id: input.ownerUserId,
      audit_id: null,
      identity,
      scope: fallbackScope,
      evidence_packet: emptyLiveResearchEvidencePacket(startedAt, summary),
      boundary_notes: RESEARCH_AGENT_BOUNDARY_NOTES,
    }
  }

  if (!ascensionAutonomyIsOff() || RESEARCH_AGENT_AUTONOMOUS_EXECUTION_ENABLED) {
    return deniedResult('DENIED', 'Ascension autonomous execution is OFF — refusing.', null)
  }

  if (!isResearchAgentRuntimeAvailable()) {
    return deniedResult('DENIED', 'RESEARCH_AGENT runtime is disabled (ASCENSION_RESEARCH_AGENT_ENABLED=false).', null)
  }

  if (input.attemptedAction) {
    const d = denyResearchAgentAction(input.attemptedAction)
    denials.push(denialFromDecision(input.attemptedAction, d))
    const result = deniedResult('DENIED', `Capability denied: ${input.attemptedAction}`, null, denials)
    await auditResearch(input, result, d)
    return result
  }

  const scopeOrErr = createResearchAgentScope({
    researchQuestion: input.researchQuestion,
    ownerUserId: input.ownerUserId,
    requestedBy: input.requestedBy,
    missionId: input.missionId,
    conversationId: input.conversationId,
    terraAllowed: input.terraAllowed,
    liveSearchAllowed: input.liveSearchAllowed,
    storedResearchAllowed: input.storedResearchAllowed,
    timeBudgetMs: input.timeBudgetMs,
    nowIso: startedAt,
  })
  if ('error' in scopeOrErr) {
    return deniedResult('FAILED', scopeOrErr.error, null)
  }
  const scope = scopeOrErr

  if (isScopeExpired(scope, startedAt)) {
    return deniedResult('DENIED', 'Research scope deadline has expired.', scope)
  }

  if (input.enforceOwnership !== false && input.conversationId) {
    const owned = await requireOwnedConversation(input.conversationId)
    if (!owned.ok) {
      denials.push({
        capability_or_action: 'OWNER_SCOPE',
        reason_code: 'OWNER_SCOPE_DENIED',
        reason: owned.error,
      })
      const result = deniedResult('DENIED', `Owner scope denied: ${owned.error}`, scope, denials)
      await auditResearch(input, result, {
        outcome: 'DENY',
        reasonCode: 'OWNER_SCOPE_DENIED',
        reason: owned.error,
        actionKind: 'research_agent',
        canonicalKind: null,
        riskTier: null,
        technicalReach: null,
        policyAuthority: 'DENIED',
        requiresApproval: true,
        approvalSatisfied: false,
        httpStatus: owned.status,
      })
      return result
    }
    if (owned.userId !== input.ownerUserId) {
      denials.push({
        capability_or_action: 'OWNER_SCOPE',
        reason_code: 'OWNER_SCOPE_DENIED',
        reason: 'owner_user_id does not match conversation owner.',
      })
      return deniedResult('DENIED', 'Cross-user research context fail-closed.', scope, denials)
    }
  }

  const discovery = assertResearchAgentDiscoveryAllowed(true)
  if (discovery.outcome !== 'ALLOW') {
    denials.push(denialFromDecision('SESSION_BOUNDED_READ_ONLY_DISCOVERY', discovery))
    const result = deniedResult('DENIED', discovery.reason, scope, denials)
    await auditResearch(input, result, discovery)
    return result
  }

  if (!scope.live_search_allowed) {
    unavailable.push('LIVE_SEARCH_QUERY')
  }
  if (!scope.terra_allowed) {
    unavailable.push('TERRA_QUERY')
  }
  if (!scope.stored_research_allowed) {
    unavailable.push('STORED_RESEARCH_READ')
  }

  // Recursive spawn / multi-iteration is hard-bounded to 1
  if (scope.max_iterations !== 1 || scope.max_recursive_depth !== 0) {
    denials.push({
      capability_or_action: 'AGENT_SPAWN',
      reason_code: 'POLICY_DENIED',
      reason: 'RESEARCH_AGENT forbids recursive spawn and multi-iteration loops.',
    })
  }

  const identity = createResearchAgentIdentity({
    requestId,
    ownerUserId: scope.owner_user_id,
    conversationId: scope.conversation_id,
    missionId: scope.mission_id,
    councilRound: input.councilRound,
    scopeLabel: scope.network_policy,
    nowIso: startedAt,
  })

  const terraRefs: string[] = []
  if (scope.terra_allowed && input.terraHandoff) {
    const lineage = input.terraHandoff.lineage
    terraRefs.push(String(lineage.objectId))
    if (lineage.provider) terraRefs.push(`provider:${lineage.provider}`)
  } else if (input.terraHandoff && !scope.terra_allowed) {
    denials.push({
      capability_or_action: 'TERRA_QUERY',
      reason_code: 'POLICY_DENIED',
      reason: 'Terra not allowed in this research scope.',
    })
  }

  let evidencePacket = emptyLiveResearchEvidencePacket(startedAt)
  let providerOk = 0
  let providerFailures = 0

  if (scope.live_search_allowed) {
    try {
      const router = await runLiveResearchRouter({
        decreeText: scope.research_question,
        supabase: input.supabase ?? null,
        conversationId: scope.conversation_id,
        budgetMs: scope.time_budget_ms,
        commanderSessionContext: true,
        crawlExpansion: false,
        externalMutation: false,
        financialSpend: false,
        retrievalOnly: true,
      })

      evidencePacket = await buildLiveResearchEvidencePacket({
        decreeText: scope.research_question,
        router,
        intentConfidence: 0.7,
      })

      for (const src of evidencePacket.sources) {
        if (src.ok) providerOk += 1
        else providerFailures += 1
      }
    } catch (error) {
      providerFailures += 1
      const message = error instanceof Error ? error.message : 'Live research failed.'
      evidencePacket = buildLiveResearchFailureEvidencePacket({
        decreeText: scope.research_question,
        generatedAt: startedAt,
        error: message,
      })
      denials.push({
        capability_or_action: 'LIVE_SEARCH_QUERY',
        reason_code: 'UNAVAILABLE',
        reason: message,
      })
    }
  } else {
    unavailable.push('PUBLIC_WEB_PASSIVE_FETCH')
  }

  const evidenceRefs = (evidencePacket.sources ?? [])
    .flatMap(s => s.urls ?? [])
    .filter(Boolean)
    .slice(0, scope.source_evidence_limit)

  const findings: ResearchAgentFinding[] = []
  if (evidencePacket.findings?.trim()) {
    findings.push({
      statement: evidencePacket.findings.trim().slice(0, 4_000),
      support: evidencePacket.confidence >= 0.6 ? 'SUPPORTED' : 'UNVERIFIED',
      evidence_refs: evidenceRefs.slice(0, 8),
    })
  }
  for (const q of evidencePacket.unresolvedQuestions?.slice(0, 5) ?? []) {
    findings.push({
      statement: q,
      support: 'UNVERIFIED',
      evidence_refs: [],
    })
  }
  for (const c of evidencePacket.contradictions?.slice(0, 5) ?? []) {
    findings.push({
      statement: c,
      support: 'CONFLICTING',
      evidence_refs: evidenceRefs.slice(0, 4),
    })
  }

  const status = classifyResultStatus({
    denied: false,
    usedLiveResearch: evidencePacket.usedLiveResearch,
    providerFailures,
    providerOk,
    findingsEmpty: findings.length === 0,
  })

  const summary =
    status === 'COMPLETE'
      ? evidencePacket.findings.slice(0, 1_200) || 'Research complete with evidence.'
      : status === 'PARTIAL' || status === 'DEGRADED'
        ? `Research ${status.toLowerCase()}: some providers failed or evidence is incomplete.`
        : evidencePacket.researchErrorSummary || 'Research failed.'

  const limitations: string[] = [
    ...(evidencePacket.honestyNotes ?? []),
    ...unavailable.map(u => `Unavailable: ${u}`),
  ]
  if (providerFailures > 0) limitations.push(`${providerFailures} provider leg(s) failed.`)
  if (terraRefs.length === 0 && scope.terra_allowed) {
    limitations.push('No Terra handoff provided for this invocation (Terra optional).')
  }

  const result: ResearchAgentResult = {
    agent_id: identity.agent_id,
    agent_role: 'RESEARCH_AGENT',
    status,
    research_question: scope.research_question,
    summary,
    findings: findings.slice(0, scope.result_limit),
    evidence_refs: evidenceRefs,
    terra_refs: terraRefs,
    sources: (evidencePacket.sources ?? []).map(s => ({
      kind: s.kind,
      ok: s.ok,
      urls: s.urls,
      error: s.error,
    })),
    freshness_summary: evidencePacket.freshness,
    confidence: evidencePacket.confidence,
    limitations,
    denials,
    unavailable_capabilities: unavailable,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    mission_id: scope.mission_id,
    conversation_id: scope.conversation_id,
    owner_user_id: scope.owner_user_id,
    audit_id: null,
    identity,
    scope,
    evidence_packet: evidencePacket,
    boundary_notes: RESEARCH_AGENT_BOUNDARY_NOTES,
  }

  const auditId = await auditResearch(input, result, discovery)
  result.audit_id = auditId

  return result
}

async function auditResearch(
  input: RunBoundedResearchInput,
  result: ResearchAgentResult,
  decision: PolicyDecision,
): Promise<string | null> {
  const auditId = randomUUID()
  const meta = buildGovernedAuditMetadata({
    decision,
    requestedBy: input.requestedBy,
    actorAgent: 'RESEARCH_AGENT',
    missionId: input.missionId ?? null,
    councilRound: input.councilRound ?? null,
    tool: 'ascension.research_agent.runBoundedResearchAgent',
    target: result.research_question.slice(0, 200),
    ownerUserId: input.ownerUserId,
    evidenceRefs: result.evidence_refs.slice(0, 20),
    executionResult:
      result.status === 'DENIED' ? 'denied' : result.status === 'FAILED' ? 'failed' : 'executed',
  })

  // Never persist chain-of-thought — only structured metadata + status.
  await insertGovernedAuditLog(input.supabase ?? null, {
    actor: input.invokedBy === 'commander' ? 'user' : 'system',
    category: 'runtime',
    message: `RESEARCH_AGENT ${result.status}: ${result.summary.slice(0, 240)}`,
    actionId: auditId,
    metadata: meta,
    extra: {
      invocation: input.invokedBy,
      status: result.status,
      denials: result.denials,
      unavailable: result.unavailable_capabilities,
      sourceCount: result.sources.length,
      // Explicitly omit private reasoning traces
      chain_of_thought: undefined,
    },
  })
  return auditId
}

/** Council-facing wrapper: findings are evidence, not conclusions. */
export function researchAgentResultForCouncil(result: ResearchAgentResult): {
  evidence_packet: ResearchAgentResult['evidence_packet']
  findings: ResearchAgentFinding[]
  boundary_notes: readonly string[]
  status: ResearchAgentResult['status']
  is_authorization: false
} {
  return {
    evidence_packet: result.evidence_packet,
    findings: result.findings,
    boundary_notes: result.boundary_notes,
    status: result.status,
    is_authorization: false,
  }
}

/** ASTRA-facing wrapper: assignment result only — no authority escalation. */
export function researchAgentResultForAstra(result: ResearchAgentResult): {
  mission_id: string | null
  status: ResearchAgentResult['status']
  summary: string
  evidence_packet: ResearchAgentResult['evidence_packet']
  denials: ResearchAgentDenial[]
  authority_escalated: false
} {
  return {
    mission_id: result.mission_id,
    status: result.status,
    summary: result.summary,
    evidence_packet: result.evidence_packet,
    denials: result.denials,
    authority_escalated: false,
  }
}
