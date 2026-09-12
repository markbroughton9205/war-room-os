/**
 * #22 Phase 14 — Bounded cross-agent workflows.
 * Invokes existing runBounded* agents after soft-kill checks.
 * Not a second orchestrator: ASTRA remains the executive control plane.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isResearchAgentRuntimeAvailable } from '@/lib/ascension/research-agent/identity'
import { runBoundedResearchAgent } from '@/lib/ascension/research-agent'
import { isWorldLearningAgentRuntimeAvailable } from '@/lib/ascension/world-learning-agent/identity'
import { runBoundedWorldLearningAgent } from '@/lib/ascension/world-learning-agent'
import type { WorldLearningEvidenceItem } from '@/lib/ascension/world-learning-agent/learn'
import { isDataCorpusAgentRuntimeAvailable } from '@/lib/ascension/data-corpus-agent/identity'
import { runBoundedDataCorpusAgent } from '@/lib/ascension/data-corpus-agent'
import { isTerraIntelligenceAgentRuntimeAvailable } from '@/lib/ascension/terra-intelligence-agent/identity'
import { runBoundedTerraIntelligenceAgent } from '@/lib/ascension/terra-intelligence-agent'
import { isNavigationAgentRuntimeAvailable } from '@/lib/ascension/navigation-agent/identity'
import {
  navigationAgentResultForCouncil,
  runBoundedNavigationAgent,
} from '@/lib/ascension/navigation-agent'
import { isOperationsAgentRuntimeAvailable } from '@/lib/ascension/operations-agent/identity'
import { runBoundedOperationsAgent } from '@/lib/ascension/operations-agent'
import { isSecurityRedTeamAgentRuntimeAvailable } from '@/lib/ascension/security-red-team-agent/identity'
import { runBoundedSecurityRedTeamAgent } from '@/lib/ascension/security-red-team-agent'
import { isEngineeringAgentRuntimeAvailable } from '@/lib/ascension/engineering-agent/identity'
import { runBoundedEngineeringAgent } from '@/lib/ascension/engineering-agent'
import type { CouncilClaimInput } from '@/lib/ascension/council-validator'
import { createCanonicalHandoff } from './envelope'
import { assertEvidenceOwnerMatch } from './ownership'
import {
  CROSS_AGENT_LOOP_LIMITS,
  assertWithinHandoffLimit,
  assertWithinMissionStepLimit,
  assertWithinWorkflowDuration,
} from './limits'
import { integrationFailure, type IntegrationFailure } from './failures'
import {
  CorpusCandidateStore,
  dispositionToReviewState,
} from './candidateStore'
import { runBoundedValidatorRevisionCycle } from './revision'
import type {
  AuditRef,
  CanonicalHandoffEnvelope,
  IntegrationWorkflowKind,
  ProvenanceStage,
} from './types'
import {
  ASTRA_PHASE58A_STATUS,
  WR_CORPUS_STATUS,
} from './identity'

export type IntegrationWorkflowInput = {
  ownerUserId: string
  requestedBy: string
  invokedBy?: 'commander' | 'council' | 'astra' | 'desktop_core'
  missionId?: string | null
  sessionId?: string | null
  conversationId?: string | null
  dataDirOverride?: string | null
  internetAvailable?: boolean
  liveSearchAllowed?: boolean
  useFixtures?: boolean
  useLocalModel?: boolean
  topic?: string
  foreignEvidenceOwnerId?: string | null
  skipWorldLearningWriteApprovedCorpus?: boolean
  markCandidateTrained?: boolean
  startWrCorpus?: boolean
  grantEngineeringCommitViaSecurity?: boolean
  grantSecurityShellViaOps?: boolean
  councilAuthorizeDeploy?: boolean
  astraTreatAsCommanderApproval?: boolean
  spawnHelperAgents?: number
  persistHiddenCot?: boolean
  pushCandidateCorpus?: boolean
  applyPhase58a?: boolean
  changeOwnerOnHandoff?: boolean
  continueAfterSoftKill?: boolean
}

export type IntegrationWorkflowResult = {
  workflow_kind: IntegrationWorkflowKind
  status: 'COMPLETE' | 'PARTIAL' | 'DENIED' | 'FAILED' | 'TIMEOUT'
  failure: IntegrationFailure | null
  owner_user_id: string
  mission_id: string | null
  handoffs: CanonicalHandoffEnvelope[]
  evidence_ids: string[]
  candidate_ids: string[]
  audit_refs: AuditRef[]
  provenance_chain: ProvenanceStage[]
  summary: string
  live_discovery: 'AVAILABLE' | 'UNAVAILABLE'
  production_corpus_persisted: false
  wr_corpus: typeof WR_CORPUS_STATUS
  model_training: 'NOT_IMPLEMENTED'
  astra_phase58a: 'NOT_APPLIED'
  autonomy: 'OFF'
  runtime_notes: Record<string, string | boolean | number | null>
  route_geometry_json: string | null
  council_route_geometry_json: string | null
  validator_outcome: string | null
  revision_count: number
  engineering_committed: false
  engineering_pushed: false
  engineering_deployed: false
  operations_remediated: false
  security_mutated_files: false
}

type Ctx = {
  ownerUserId: string
  requestedBy: string
  invokedBy: 'commander' | 'council' | 'astra' | 'desktop_core'
  missionId: string | null
  sessionId: string | null
  conversationId: string | null
  dataDirOverride: string | null
  internetAvailable: boolean
  liveSearchAllowed: boolean
  useFixtures: boolean
  useLocalModel: boolean
  startedMs: number
  steps: number
  handoffs: CanonicalHandoffEnvelope[]
  auditRefs: AuditRef[]
  provenance: ProvenanceStage[]
  evidenceIds: string[]
}

const DEFAULT_TOPIC =
  'Public Helsinki harbor vessel-traffic information systems (Digitraffic marine API)'

function emptyResult(
  kind: IntegrationWorkflowKind,
  input: IntegrationWorkflowInput,
  extra?: Partial<IntegrationWorkflowResult>,
): IntegrationWorkflowResult {
  return {
    workflow_kind: kind,
    status: 'FAILED',
    failure: null,
    owner_user_id: input.ownerUserId,
    mission_id: input.missionId ?? null,
    handoffs: [],
    evidence_ids: [],
    candidate_ids: [],
    audit_refs: [],
    provenance_chain: [],
    summary: '',
    live_discovery: input.internetAvailable === false || input.liveSearchAllowed === false ? 'UNAVAILABLE' : 'UNAVAILABLE',
    production_corpus_persisted: false,
    wr_corpus: WR_CORPUS_STATUS,
    model_training: 'NOT_IMPLEMENTED',
    astra_phase58a: ASTRA_PHASE58A_STATUS,
    autonomy: 'OFF',
    runtime_notes: {},
    route_geometry_json: null,
    council_route_geometry_json: null,
    validator_outcome: null,
    revision_count: 0,
    engineering_committed: false,
    engineering_pushed: false,
    engineering_deployed: false,
    operations_remediated: false,
    security_mutated_files: false,
    ...extra,
  }
}

function makeCtx(input: IntegrationWorkflowInput): Ctx {
  return {
    ownerUserId: input.ownerUserId,
    requestedBy: input.requestedBy,
    invokedBy: input.invokedBy ?? 'commander',
    missionId: input.missionId ?? null,
    sessionId: input.sessionId ?? null,
    conversationId: input.conversationId ?? null,
    dataDirOverride: input.dataDirOverride ?? null,
    internetAvailable: input.internetAvailable !== false,
    liveSearchAllowed: input.liveSearchAllowed === true,
    useFixtures: input.useFixtures !== false,
    useLocalModel: input.useLocalModel === true,
    startedMs: Date.now(),
    steps: 0,
    handoffs: [],
    auditRefs: [],
    provenance: [],
    evidenceIds: [],
  }
}

function agentInvokeBy(ctx: Ctx): 'commander' | 'council' | 'astra' {
  if (ctx.invokedBy === 'council' || ctx.invokedBy === 'astra') return ctx.invokedBy
  return 'commander'
}

function bumpStep(ctx: Ctx): IntegrationFailure | null {
  ctx.steps += 1
  const step = assertWithinMissionStepLimit(ctx.steps)
  if (!step.ok) return integrationFailure('STEP_LIMIT_EXCEEDED', step.reason)
  const dur = assertWithinWorkflowDuration(ctx.startedMs)
  if (!dur.ok) return integrationFailure('TIMEOUT', dur.reason)
  return null
}

function addHandoff(
  ctx: Ctx,
  args: Parameters<typeof createCanonicalHandoff>[0],
): IntegrationFailure | null {
  const created = createCanonicalHandoff(args)
  if (!created.ok) return created.failure
  ctx.handoffs.push(created.envelope)
  const cap = assertWithinHandoffLimit(ctx.handoffs.length)
  if (!cap.ok) return integrationFailure('HANDOFF_LIMIT_EXCEEDED', cap.reason)
  ctx.auditRefs.push({ kind: 'handoff', id: created.envelope.handoff_id })
  return null
}

function disabled(role: string): IntegrationFailure {
  return integrationFailure('AGENT_DISABLED', `${role} runtime disabled.`, role)
}

function researchToEvidence(
  findings: Array<{ statement: string; support: string; evidence_refs: string[] }>,
  evidenceRefs: string[],
  sources: Array<{ kind: string; ok: boolean; urls?: string[] }>,
  nowIso: string,
): WorldLearningEvidenceItem[] {
  return findings.slice(0, 8).map((finding, index) => ({
    id: evidenceRefs[index] ?? finding.evidence_refs[0] ?? `research-finding-${index}`,
    provider: 'research_agent',
    providerRecordId: evidenceRefs[index] ?? null,
    title: finding.statement.slice(0, 120),
    summary: finding.statement,
    contentSnippet: finding.statement,
    canonicalUrl: sources[index]?.urls?.[0] ?? null,
    sourceUrl: sources[index]?.urls?.[0] ?? null,
    sourceName: sources[index]?.kind ?? 'research',
    contentType: 'text',
    organization: null,
    language: 'en',
    license: null,
    retrievedAt: nowIso,
    provenance: {
      sourceUrl: sources[index]?.urls?.[0] ?? 'research_agent',
      retrievedAt: nowIso,
      isHistorical: finding.support === 'STALE',
    },
    sourceClass: finding.support === 'STALE' ? 'CACHED' : 'SECONDARY',
    official: false,
    primary: finding.support === 'SUPPORTED',
    publishedAt: nowIso,
    contentHash: `research-${index}`,
  }))
}

export async function runKnowledgePipeline(
  input: IntegrationWorkflowInput,
): Promise<IntegrationWorkflowResult> {
  const ctx = makeCtx(input)
  const topic = input.topic ?? DEFAULT_TOPIC
  const nowIso = new Date().toISOString()

  if (input.skipWorldLearningWriteApprovedCorpus) {
    return emptyResult('KNOWLEDGE_PIPELINE', input, {
      status: 'DENIED',
      failure: integrationFailure(
        'FORBIDDEN_ACTION',
        'Cannot skip World Learning and write Research directly as approved corpus.',
      ),
    })
  }
  if (input.startWrCorpus) {
    return emptyResult('KNOWLEDGE_PIPELINE', input, {
      status: 'DENIED',
      failure: integrationFailure(
        'FORBIDDEN_ACTION',
        'WR_CORPUS already implemented. Cannot start a second corpus architecture.',
      ),
    })
  }
  if (input.applyPhase58a) {
    return emptyResult('KNOWLEDGE_PIPELINE', input, {
      status: 'DENIED',
      failure: integrationFailure('PHASE58A_APPLY_DENIED', 'phase58a SQL apply is not authorized in this phase.'),
    })
  }
  if (input.persistHiddenCot) {
    return emptyResult('KNOWLEDGE_PIPELINE', input, {
      status: 'DENIED',
      failure: integrationFailure('FORBIDDEN_ACTION', 'Hidden chain-of-thought cannot be persisted.'),
    })
  }
  if (input.pushCandidateCorpus) {
    return emptyResult('KNOWLEDGE_PIPELINE', input, {
      status: 'DENIED',
      failure: integrationFailure('FORBIDDEN_ACTION', 'Candidate corpus cannot be pushed.'),
    })
  }
  if ((input.spawnHelperAgents ?? 0) > 0) {
    return emptyResult('KNOWLEDGE_PIPELINE', input, {
      status: 'DENIED',
      failure: integrationFailure('AGENT_SPAWN_DENIED', `max_agent_spawn=${CROSS_AGENT_LOOP_LIMITS.max_agent_spawn}`),
    })
  }

  const ownerFail = assertEvidenceOwnerMatch(input.ownerUserId, input.foreignEvidenceOwnerId ?? input.ownerUserId)
  if (ownerFail) {
    return emptyResult('KNOWLEDGE_PIPELINE', input, { status: 'DENIED', failure: ownerFail })
  }

  if (!isResearchAgentRuntimeAvailable()) {
    return emptyResult('KNOWLEDGE_PIPELINE', input, { status: 'PARTIAL', failure: disabled('RESEARCH_AGENT') })
  }

  const step0 = bumpStep(ctx)
  if (step0) return emptyResult('KNOWLEDGE_PIPELINE', input, { status: 'DENIED', failure: step0, handoffs: ctx.handoffs })

  const research = await runBoundedResearchAgent({
    researchQuestion: topic,
    ownerUserId: ctx.ownerUserId,
    requestedBy: ctx.requestedBy,
    invokedBy: agentInvokeBy(ctx),
    missionId: ctx.missionId,
    conversationId: ctx.conversationId,
    liveSearchAllowed: ctx.liveSearchAllowed,
    storedResearchAllowed: true,
    terraAllowed: true,
    timeBudgetMs: 8_000,
    nowIso,
  })
  ctx.evidenceIds.push(...research.evidence_refs)
  ctx.provenance.push({ stage: 'research_evidence', refs: [...research.evidence_refs] })
  ctx.auditRefs.push({ kind: 'agent_invocation', id: research.audit_id })
  ctx.auditRefs.push({ kind: 'result', id: research.agent_id })

  const researchOwner = input.changeOwnerOnHandoff ? `${ctx.ownerUserId}-other` : ctx.ownerUserId
  const h1 = addHandoff(ctx, {
    missionId: ctx.missionId,
    sourceActor: 'RESEARCH_AGENT',
    targetActor: 'WORLD_LEARNING_AGENT',
    ownerUserId: ctx.ownerUserId,
    targetOwnerUserId: researchOwner,
    sessionId: ctx.sessionId,
    conversationId: ctx.conversationId,
    taskType: 'RESEARCH_EVIDENCE',
    inputReference: research.agent_id,
    evidenceIds: research.evidence_refs,
    sourceUrls: research.sources.flatMap(s => s.urls ?? []),
    sourceAgents: ['RESEARCH_AGENT'],
    runtimeTruth: { research_status: research.status, live_search: ctx.liveSearchAllowed },
  })
  if (h1) {
    return emptyResult('KNOWLEDGE_PIPELINE', input, { status: 'DENIED', failure: h1, handoffs: ctx.handoffs, evidence_ids: ctx.evidenceIds })
  }

  if (!isWorldLearningAgentRuntimeAvailable()) {
    if (input.continueAfterSoftKill) {
      return emptyResult('KNOWLEDGE_PIPELINE', input, {
        status: 'DENIED',
        failure: integrationFailure('AGENT_DISABLED', 'Required World Learning Agent is disabled; cannot continue.', 'WORLD_LEARNING_AGENT'),
        handoffs: ctx.handoffs,
        evidence_ids: ctx.evidenceIds,
        audit_refs: ctx.auditRefs,
        provenance_chain: ctx.provenance,
        summary: 'PARTIAL: WORLD_LEARNING_AGENT_DISABLED',
      })
    }
    return emptyResult('KNOWLEDGE_PIPELINE', input, {
      status: 'PARTIAL',
      failure: disabled('WORLD_LEARNING_AGENT'),
      handoffs: ctx.handoffs,
      evidence_ids: ctx.evidenceIds,
      audit_refs: ctx.auditRefs,
      provenance_chain: ctx.provenance,
      summary: 'PARTIAL WORLD_LEARNING_AGENT_DISABLED — Research completed; downstream not fabricated.',
    })
  }

  const step1 = bumpStep(ctx)
  if (step1) return emptyResult('KNOWLEDGE_PIPELINE', input, { status: 'DENIED', failure: step1, handoffs: ctx.handoffs })

  const knownEvidence = researchToEvidence(research.findings, research.evidence_refs, research.sources, nowIso)
  const learning = await runBoundedWorldLearningAgent({
    taskType: 'LEARN_TOPIC',
    topic,
    ownerUserId: ctx.ownerUserId,
    requestedBy: ctx.requestedBy,
    invokedBy: ctx.invokedBy === 'desktop_core' ? 'desktop_core' : agentInvokeBy(ctx),
    missionId: ctx.missionId,
    conversationId: ctx.conversationId,
    knownEvidence: knownEvidence.length ? knownEvidence : undefined,
    invokeResearchAgent: false,
    invokeDataCorpusAgent: false,
    useFixtures: ctx.useFixtures,
    internetAvailable: ctx.internetAvailable,
    liveSearchAllowed: ctx.liveSearchAllowed,
    useLocalModel: ctx.useLocalModel,
  })
  ctx.provenance.push({
    stage: 'world_learning_claims',
    refs: learning.claims.map(c => c.claim_id),
  })
  ctx.auditRefs.push({ kind: 'agent_invocation', id: learning.audit_id })
  const learningEvidence = learning.corpus_handoff.flatMap(c => c.evidence_ids)
  ctx.evidenceIds.push(...learningEvidence)

  const h2 = addHandoff(ctx, {
    missionId: ctx.missionId,
    sourceActor: 'WORLD_LEARNING_AGENT',
    targetActor: 'DATA_CORPUS_AGENT',
    ownerUserId: ctx.ownerUserId,
    sessionId: ctx.sessionId,
    conversationId: ctx.conversationId,
    taskType: 'CORPUS_CANDIDATE',
    inputReference: learning.agent_id,
    evidenceIds: learningEvidence,
    parentHandoffId: ctx.handoffs[0]?.handoff_id ?? null,
    sourceAgents: ['RESEARCH_AGENT', 'WORLD_LEARNING_AGENT'],
    runtimeTruth: {
      production_corpus_persisted: false,
      wr_corpus: WR_CORPUS_STATUS,
    },
  })
  if (h2) {
    return emptyResult('KNOWLEDGE_PIPELINE', input, { status: 'DENIED', failure: h2, handoffs: ctx.handoffs })
  }

  if (!isDataCorpusAgentRuntimeAvailable()) {
    return emptyResult('KNOWLEDGE_PIPELINE', input, {
      status: 'PARTIAL',
      failure: disabled('DATA_CORPUS_AGENT'),
      handoffs: ctx.handoffs,
      evidence_ids: ctx.evidenceIds,
      audit_refs: ctx.auditRefs,
      provenance_chain: ctx.provenance,
      summary: 'PARTIAL DATA_CORPUS_AGENT_DISABLED',
      live_discovery: learning.live_discovery,
    })
  }

  const step2 = bumpStep(ctx)
  if (step2) return emptyResult('KNOWLEDGE_PIPELINE', input, { status: 'DENIED', failure: step2, handoffs: ctx.handoffs })

  const corpus = await runBoundedDataCorpusAgent({
    corpusQuestion: topic,
    ownerUserId: ctx.ownerUserId,
    requestedBy: ctx.requestedBy,
    invokedBy: agentInvokeBy(ctx),
    missionId: ctx.missionId,
    conversationId: ctx.conversationId,
    useFixtures: ctx.useFixtures,
    allowMetadataWrite: false,
    records: learning.corpus_handoff.map(c => ({
      document_id: c.candidate_id,
      title: c.claim_or_topic,
      content_preview: c.normalized_content.slice(0, 400),
      from_research_handoff: true,
      freshness: c.freshness === 'FRESH' || c.freshness === 'DUE' || c.freshness === 'STALE' || c.freshness === 'UNKNOWN' ? c.freshness : 'UNKNOWN',
    })),
    researchHandoff: { summary: learning.summary },
    startRoadmap23: false,
  })
  ctx.auditRefs.push({ kind: 'agent_invocation', id: corpus.audit_id })

  const store = new CorpusCandidateStore(ctx.dataDirOverride)
  const candidateIds: string[] = []
  try {
    for (const candidate of learning.corpus_handoff) {
      if (input.markCandidateTrained) {
        store.close()
        return emptyResult('KNOWLEDGE_PIPELINE', input, {
          status: 'DENIED',
          failure: integrationFailure('FORBIDDEN_ACTION', 'Cannot mark a candidate TRAINED. APPROVED_FOR_FUTURE_CORPUS != TRAINED.'),
          handoffs: ctx.handoffs,
          evidence_ids: ctx.evidenceIds,
        })
      }
      const persisted = store.upsert({
        candidate_id: candidate.candidate_id,
        owner_user_id: ctx.ownerUserId,
        scope_class: 'LOCAL',
        source_agent: 'WORLD_LEARNING_AGENT',
        evidence_ids: candidate.evidence_ids,
        provenance: {
          ...candidate.provenance,
          research_evidence_ids: research.evidence_refs,
          world_learning_claim: candidate.claim_or_topic,
          data_corpus_status: corpus.status,
        },
        normalized_content: candidate.normalized_content,
        content_reference: candidate.candidate_id,
        confidence: candidate.confidence,
        freshness: candidate.freshness,
        novelty_classification: candidate.novelty_state,
        conflict_state: candidate.conflict_state,
        recommended_disposition: candidate.recommended_disposition,
        review_state: dispositionToReviewState(candidate.recommended_disposition),
        mission_id: ctx.missionId,
        handoff_id: ctx.handoffs[ctx.handoffs.length - 1]?.handoff_id ?? null,
        expires_at: null,
      })
      if (!persisted.ok) {
        store.close()
        return emptyResult('KNOWLEDGE_PIPELINE', input, {
          status: 'DENIED',
          failure: persisted.failure,
          handoffs: ctx.handoffs,
        })
      }
      candidateIds.push(persisted.candidate.candidate_id)
      ctx.auditRefs.push({ kind: 'candidate_disposition', id: persisted.candidate.candidate_id })
    }
  } finally {
    store.close()
  }

  ctx.provenance.push({ stage: 'corpus_candidates', refs: candidateIds })

  const productionWrite = corpus.writes_performed.some(w => w.persisted_to_production_corpus)
  return emptyResult('KNOWLEDGE_PIPELINE', input, {
    status: learning.status === 'DENIED' || corpus.status === 'DENIED' ? 'DENIED' : 'COMPLETE',
    failure: null,
    handoffs: ctx.handoffs,
    evidence_ids: [...new Set(ctx.evidenceIds)],
    candidate_ids: candidateIds,
    audit_refs: ctx.auditRefs,
    provenance_chain: ctx.provenance,
    summary: `Research→World Learning→Data Corpus. candidates=${candidateIds.length}; production_write=${productionWrite}; live_discovery=${learning.live_discovery}`,
    live_discovery: learning.live_discovery,
    runtime_notes: {
      research_status: research.status,
      world_learning_status: learning.status,
      data_corpus_status: corpus.status,
      production_corpus_write: productionWrite,
      research_evidence_preserved: research.evidence_refs.every(id =>
        learning.corpus_handoff.some(c => c.evidence_ids.includes(id)) || ctx.evidenceIds.includes(id),
      ),
    },
  })
}

export async function runWorldStatePipeline(
  input: IntegrationWorkflowInput,
): Promise<IntegrationWorkflowResult> {
  const ctx = makeCtx(input)
  if (!isTerraIntelligenceAgentRuntimeAvailable()) {
    return emptyResult('WORLD_STATE_PIPELINE', input, { status: 'PARTIAL', failure: disabled('TERRA_INTELLIGENCE_AGENT') })
  }
  const s0 = bumpStep(ctx)
  if (s0) return emptyResult('WORLD_STATE_PIPELINE', input, { status: 'DENIED', failure: s0 })

  const terra = await runBoundedTerraIntelligenceAgent({
    worldStateQuestion: 'Fixture Helsinki harbor vessel context for navigation (not live GPS).',
    ownerUserId: ctx.ownerUserId,
    requestedBy: ctx.requestedBy,
    invokedBy: agentInvokeBy(ctx),
    missionId: ctx.missionId,
    useDigitrafficFixture: true,
    includeCached: true,
  })
  ctx.auditRefs.push({ kind: 'agent_invocation', id: terra.audit_id })
  ctx.provenance.push({ stage: 'terra_world_state', refs: terra.evidence_refs })

  const h1 = addHandoff(ctx, {
    missionId: ctx.missionId,
    sourceActor: 'TERRA_INTELLIGENCE_AGENT',
    targetActor: 'NAVIGATION_AGENT',
    ownerUserId: ctx.ownerUserId,
    sessionId: ctx.sessionId,
    taskType: 'TERRA_WORLD_STATE',
    inputReference: terra.agent_id,
    evidenceIds: terra.evidence_refs,
    sourceAgents: ['TERRA', 'TERRA_INTELLIGENCE_AGENT'],
    runtimeTruth: { mobile_gnss: 'NOT_SUPPORTED', live_traffic: 'NOT_IMPLEMENTED' },
  })
  if (h1) return emptyResult('WORLD_STATE_PIPELINE', input, { status: 'DENIED', failure: h1, handoffs: ctx.handoffs })

  if (!isNavigationAgentRuntimeAvailable()) {
    return emptyResult('WORLD_STATE_PIPELINE', input, {
      status: 'PARTIAL',
      failure: disabled('NAVIGATION_AGENT'),
      handoffs: ctx.handoffs,
    })
  }
  const s1 = bumpStep(ctx)
  if (s1) return emptyResult('WORLD_STATE_PIPELINE', input, { status: 'DENIED', failure: s1 })

  const nav = await runBoundedNavigationAgent({
    taskType: 'PLAN_ROUTE',
    ownerUserId: ctx.ownerUserId,
    requestedBy: ctx.requestedBy,
    invokedBy: ctx.invokedBy === 'desktop_core' ? 'desktop_core' : agentInvokeBy(ctx),
    missionId: ctx.missionId,
    locationSource: 'terra',
    useFixtureGraph: true,
    internetAvailable: ctx.internetAvailable,
    terraContext: { summary: terra.summary },
    claimLiveDeviceGps: false,
    pretendFixtureTrafficLive: false,
    pretendLocationIsGps: false,
  })
  ctx.auditRefs.push({ kind: 'agent_invocation', id: nav.audit_id })
  const geometry = nav.route ? JSON.stringify(nav.route) : 'null'
  ctx.provenance.push({ stage: 'navigation_route', refs: nav.route?.route_id ? [nav.route.route_id] : [] })

  const councilPacket = navigationAgentResultForCouncil(nav)
  const h2 = addHandoff(ctx, {
    missionId: ctx.missionId,
    sourceActor: 'NAVIGATION_AGENT',
    targetActor: 'COUNCIL',
    ownerUserId: ctx.ownerUserId,
    sessionId: ctx.sessionId,
    taskType: 'NAVIGATION_COUNCIL_PACKET',
    inputReference: nav.agent_id,
    evidenceIds: nav.route?.route_id ? [nav.route.route_id] : [],
    sourceAgents: ['TERRA_INTELLIGENCE_AGENT', 'NAVIGATION_AGENT'],
    parentHandoffId: ctx.handoffs[0]?.handoff_id ?? null,
    runtimeTruth: {
      mobile_gnss: nav.mobile_gnss,
      live_traffic: nav.live_traffic,
      is_authorization: false,
      council_rewrites_route: false,
    },
  })
  if (h2) return emptyResult('WORLD_STATE_PIPELINE', input, { status: 'DENIED', failure: h2, handoffs: ctx.handoffs })

  const claims: CouncilClaimInput[] = [
    {
      claim_text: `Navigation Agent computed a fixture route. GNSS is NOT_SUPPORTED. Live traffic is NOT_IMPLEMENTED. ${nav.summary}`,
      claim_type: 'TERRA',
      evidence_refs: nav.route?.route_id ? [nav.route.route_id] : ['nav-fixture'],
      evidence_support: 'SUPPORTED',
      freshness: 'CACHED',
      asserts_live_from_cached: false,
    },
  ]
  const revision = await runBoundedValidatorRevisionCycle({
    conversationId: ctx.conversationId ?? '00000000-0000-4000-8000-000000000022',
    ownerUserId: ctx.ownerUserId,
    requestedBy: ctx.requestedBy,
    missionId: ctx.missionId,
    claims,
  })
  ctx.auditRefs.push({ kind: 'validation', id: revision.final?.audit_id ?? null })

  return emptyResult('WORLD_STATE_PIPELINE', input, {
    status: revision.failure ? 'PARTIAL' : 'COMPLETE',
    failure: revision.failure,
    handoffs: ctx.handoffs,
    evidence_ids: terra.evidence_refs,
    audit_refs: ctx.auditRefs,
    provenance_chain: ctx.provenance,
    summary: `Terra→Navigation→Council→Validator. gnss=${nav.mobile_gnss}; traffic=${nav.live_traffic}; validator=${revision.outcome}`,
    route_geometry_json: geometry,
    council_route_geometry_json: JSON.stringify({
      route_id: councilPacket.route_id,
      route_status: councilPacket.route_status,
      rewritten: false,
    }),
    validator_outcome: revision.outcome,
    revision_count: revision.revision_count,
    runtime_notes: {
      mobile_gnss: nav.mobile_gnss,
      live_traffic: nav.live_traffic,
      navigation_status: nav.status,
      council_is_authorization: false,
      council_is_conclusion: false,
    },
  })
}

export async function runEngineeringSafetyPipeline(
  input: IntegrationWorkflowInput,
): Promise<IntegrationWorkflowResult> {
  const ctx = makeCtx(input)
  if (input.grantSecurityShellViaOps) {
    return emptyResult('ENGINEERING_SAFETY_PIPELINE', input, {
      status: 'DENIED',
      failure: integrationFailure('AUTHORITY_DENIED', 'Operations handoff cannot grant Security a shell.'),
    })
  }
  if (input.grantEngineeringCommitViaSecurity) {
    return emptyResult('ENGINEERING_SAFETY_PIPELINE', input, {
      status: 'DENIED',
      failure: integrationFailure('AUTHORITY_DENIED', 'Security handoff cannot grant Engineering commit permission.'),
    })
  }
  if (input.councilAuthorizeDeploy) {
    return emptyResult('ENGINEERING_SAFETY_PIPELINE', input, {
      status: 'DENIED',
      failure: integrationFailure('AUTHORITY_DENIED', 'Council cannot authorize deployment.'),
    })
  }

  if (!isOperationsAgentRuntimeAvailable()) {
    return emptyResult('ENGINEERING_SAFETY_PIPELINE', input, { status: 'PARTIAL', failure: disabled('OPERATIONS_AGENT') })
  }
  const s0 = bumpStep(ctx)
  if (s0) return emptyResult('ENGINEERING_SAFETY_PIPELINE', input, { status: 'DENIED', failure: s0 })

  const ops = await runBoundedOperationsAgent({
    operationsQuestion: 'Harmless local health observation for integration proof. No remediation.',
    ownerUserId: ctx.ownerUserId,
    requestedBy: ctx.requestedBy,
    invokedBy: agentInvokeBy(ctx),
    missionId: ctx.missionId,
    attemptedAction: null,
  })
  ctx.auditRefs.push({ kind: 'agent_invocation', id: ops.audit_id })

  const h1 = addHandoff(ctx, {
    missionId: ctx.missionId,
    sourceActor: 'OPERATIONS_AGENT',
    targetActor: 'SECURITY_RED_TEAM_AGENT',
    ownerUserId: ctx.ownerUserId,
    taskType: 'OPERATIONS_OBSERVATION',
    inputReference: ops.agent_id,
    runtimeTruth: { remediation: false, observation_first: true },
  })
  if (h1) return emptyResult('ENGINEERING_SAFETY_PIPELINE', input, { status: 'DENIED', failure: h1, handoffs: ctx.handoffs })

  if (!isSecurityRedTeamAgentRuntimeAvailable()) {
    return emptyResult('ENGINEERING_SAFETY_PIPELINE', input, {
      status: 'PARTIAL',
      failure: disabled('SECURITY_RED_TEAM_AGENT'),
      handoffs: ctx.handoffs,
    })
  }
  const s1 = bumpStep(ctx)
  if (s1) return emptyResult('ENGINEERING_SAFETY_PIPELINE', input, { status: 'DENIED', failure: s1 })

  const security = await runBoundedSecurityRedTeamAgent({
    securityQuestion: 'Classify the operations observation. Evaluation only. No remediation. No shell.',
    ownerUserId: ctx.ownerUserId,
    requestedBy: ctx.requestedBy,
    invokedBy: agentInvokeBy(ctx),
    missionId: ctx.missionId,
    operationsHandoff: { summary: ops.plan_summary, grantShell: false },
    attemptedAction: null,
  })
  ctx.auditRefs.push({ kind: 'agent_invocation', id: security.audit_id })

  const h2 = addHandoff(ctx, {
    missionId: ctx.missionId,
    sourceActor: 'SECURITY_RED_TEAM_AGENT',
    targetActor: 'ENGINEERING_AGENT',
    ownerUserId: ctx.ownerUserId,
    taskType: 'ENGINEERING_RECOMMENDATION',
    inputReference: security.agent_id,
    parentHandoffId: ctx.handoffs[0]?.handoff_id ?? null,
    runtimeTruth: { commit: false, push: false, deploy: false },
  })
  if (h2) return emptyResult('ENGINEERING_SAFETY_PIPELINE', input, { status: 'DENIED', failure: h2, handoffs: ctx.handoffs })

  if (!isEngineeringAgentRuntimeAvailable()) {
    return emptyResult('ENGINEERING_SAFETY_PIPELINE', input, {
      status: 'PARTIAL',
      failure: disabled('ENGINEERING_AGENT'),
      handoffs: ctx.handoffs,
    })
  }
  const s2 = bumpStep(ctx)
  if (s2) return emptyResult('ENGINEERING_SAFETY_PIPELINE', input, { status: 'DENIED', failure: s2 })

  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'wr-int-eng-'))
  const worktree = path.join(fixtureRoot, 'wt')
  mkdirSync(path.join(worktree, 'fixtures'), { recursive: true })
  try {
    const engineering = await runBoundedEngineeringAgent({
      taskDescription: security.findings[0]?.recommended_fix ?? 'Bounded recommendation only; no production mutation.',
      ownerUserId: ctx.ownerUserId,
      requestedBy: ctx.requestedBy,
      invokedBy: agentInvokeBy(ctx),
      missionId: ctx.missionId,
      approvedWorktree: worktree,
      allowedPaths: ['fixtures'],
      mutations: [],
      allowCreateEmptyWorktree: true,
      securityHandoff: {
        summary: security.plan_summary,
        finding_refs: security.findings.map(f => f.finding_id),
        grantCommit: false,
        grantPush: false,
        grantDeploy: false,
      },
      attemptedAction: 'GIT_COMMIT',
    })
    ctx.auditRefs.push({ kind: 'agent_invocation', id: engineering.audit_id })
    return emptyResult('ENGINEERING_SAFETY_PIPELINE', input, {
      status: engineering.status === 'DENIED' ? 'COMPLETE' : 'COMPLETE',
      handoffs: ctx.handoffs,
      audit_refs: ctx.auditRefs,
      summary: `Ops observe → Security classify → Engineering recommend. commit_denied=${engineering.denials.some(d => d.capability_or_action === 'GIT_COMMIT')}`,
      runtime_notes: {
        operations_status: ops.status,
        security_status: security.status,
        engineering_status: engineering.status,
        commit_denied: engineering.denials.some(d => d.capability_or_action.includes('GIT_COMMIT') || d.reason_code.includes('GIT_COMMIT')),
      },
      engineering_committed: false,
      engineering_pushed: false,
      engineering_deployed: false,
      operations_remediated: false,
      security_mutated_files: false,
    })
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

export async function runOfflineLocalWorkflow(
  input: IntegrationWorkflowInput,
): Promise<IntegrationWorkflowResult> {
  return runKnowledgePipeline({
    ...input,
    internetAvailable: false,
    liveSearchAllowed: false,
    useFixtures: true,
    useLocalModel: true,
  })
}

export async function runValidatorRevisionDemo(
  input: IntegrationWorkflowInput,
): Promise<IntegrationWorkflowResult> {
  const claims: CouncilClaimInput[] = [
    {
      claim_text: 'Cached Helsinki AIS is live GPS.',
      claim_type: 'TERRA',
      evidence_refs: ['ev-terra-cached'],
      evidence_support: 'SUPPORTED',
      freshness: 'CACHED',
      asserts_live_from_cached: true,
    },
  ]
  const cycle = await runBoundedValidatorRevisionCycle({
    conversationId: input.conversationId ?? '00000000-0000-4000-8000-000000000022',
    ownerUserId: input.ownerUserId,
    requestedBy: input.requestedBy,
    missionId: input.missionId,
    claims,
  })
  return emptyResult('VALIDATOR_REVISION_LOOP', input, {
    status: cycle.failure ? 'DENIED' : 'COMPLETE',
    failure: cycle.failure,
    validator_outcome: cycle.outcome,
    revision_count: cycle.revision_count,
    audit_refs: [{ kind: 'validation', id: cycle.final?.audit_id ?? null }],
    summary: `Validator revision cycle: first→${cycle.first ? 'ran' : 'none'}; revisions=${cycle.revision_count}/${cycle.max_revisions}; outcome=${cycle.outcome}`,
    runtime_notes: {
      max_revisions: cycle.max_revisions,
      validator_only: true,
    },
  })
}

export async function runIntegrationWorkflow(
  kind: IntegrationWorkflowKind,
  input: IntegrationWorkflowInput,
): Promise<IntegrationWorkflowResult> {
  if (kind === 'KNOWLEDGE_PIPELINE') return runKnowledgePipeline(input)
  if (kind === 'WORLD_STATE_PIPELINE') return runWorldStatePipeline(input)
  if (kind === 'ENGINEERING_SAFETY_PIPELINE') return runEngineeringSafetyPipeline(input)
  if (kind === 'OFFLINE_LOCAL_WORKFLOW') return runOfflineLocalWorkflow(input)
  if (kind === 'VALIDATOR_REVISION_LOOP') return runValidatorRevisionDemo(input)
  throw new Error('ASTRA_MULTI_AGENT_MISSION must be invoked via astraBridge')
}
