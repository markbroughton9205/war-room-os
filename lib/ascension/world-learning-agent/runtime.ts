/**
 * #22 Phase 13 — Bounded WORLD_LEARNING_AGENT runtime.
 * Reuses RESEARCH_AGENT, Stage 5 Search freshness, Terra context, Council Validator,
 * and DATA_CORPUS_AGENT handoff. No training, no production corpus persist, no #23.
 */
import { randomUUID } from 'node:crypto'
import { buildGovernedAuditMetadata, insertGovernedAuditLog } from '@/lib/war-room/governedAudit'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import { runBoundedResearchAgent } from '@/lib/ascension/research-agent'
import { runBoundedDataCorpusAgent } from '@/lib/ascension/data-corpus-agent'
import { validateCouncilClaims } from '@/lib/ascension/council-validator'
import { createCouncilValidatorScope } from '@/lib/ascension/council-validator/scope'
import { runLocalModelInference } from '@/lib/sovereign-runtime/local-model'
import { ascensionAutonomyIsOff } from '@/lib/ascension/operationalRegistry'
import {
  AUTONOMOUS_CORPUS_PERSISTENCE,
  createWorldLearningAgentIdentity,
  isWorldLearningAgentRuntimeAvailable,
  MODEL_TRAINING_STATUS,
  RAEL_STATUS,
  ROADMAP_23_STATUS,
  WORLD_LEARNING_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
  WR_CORPUS_STATUS,
  WR_TOKENIZER_STATUS,
  WRIM_STATUS,
} from './identity'
import {
  assertWorldLearningAgentCannotSelfApprove,
  denyWorldLearningAgentAction,
  isAllowedWorldLearningAgentTaskType,
  type WorldLearningAgentTaskType,
} from './profile'
import {
  createWorldLearningAgentScope,
  isWorldLearningAgentScopeExpired,
  type WorldLearningAgentScope,
} from './scope'
import {
  WORLD_LEARNING_AGENT_BOUNDARY_NOTES,
  type LiveDiscoveryState,
  type WorldLearningAgentDenial,
  type WorldLearningAgentResult,
  type WorldLearningAgentStatus,
  type WorldMemoryClass,
} from './result'
import {
  assertBabyWorldLearningAgentDenied,
  assertPrivateNotPromotedToWorldKnowledge,
  assertWorldLearningAgentOwnerScopeMatch,
} from './ownership'
import {
  detectCredentialMaterial,
  makeExistingCorpusCandidates,
  makeWorldLearningFixtures,
  sanitizeLocalModelLearningText,
  synthesizeWorldLearning,
  WORLD_LEARNING_FIXTURE_TOPIC,
  type ExistingCorpusCandidate,
  type WorldLearningEvidenceItem,
} from './learn'

export type RunBoundedWorldLearningAgentInput = {
  taskType?: string
  topic?: string
  question?: string
  domain?: string | null
  ownerUserId: string
  requestedBy: string
  invokedBy: 'commander' | 'council' | 'astra' | 'desktop_core'
  geographicScope?: string | null
  timeHorizon?: string | null
  knownEvidence?: WorldLearningEvidenceItem[] | null
  existingCorpusCandidates?: ExistingCorpusCandidate[] | null
  terraContext?: { summary?: string; freshness?: 'LIVE' | 'CACHED' | 'STALE' | 'UNKNOWN' } | null
  internetAvailable?: boolean
  useFixtures?: boolean
  invokeResearchAgent?: boolean
  invokeDataCorpusAgent?: boolean
  invokeCouncilValidator?: boolean
  useLocalModel?: boolean
  liveSearchAllowed?: boolean
  storedResearchAllowed?: boolean
  terraAllowed?: boolean
  missionId?: string | null
  conversationId?: string | null
  conversationOwnerUserId?: string | null
  enforceOwnership?: boolean
  babyContextAttempt?: boolean
  attemptedAction?: string | null
  memoryClass?: WorldMemoryClass
  promotePrivateToWorld?: boolean
  promoteSessionToWorld?: boolean
  ingestCredentials?: boolean
  omitSources?: boolean
  markModelSpeculationAsFact?: boolean
  ignoreContradictions?: boolean
  pretendStaleIsLive?: boolean
  expandCrawler?: boolean
  downloadUnauthorizedDatasets?: boolean
  executeHarmfulAction?: boolean
  applyCorpusWithoutReview?: boolean
  persistProductionCorpus?: boolean
  startWrCorpus?: boolean
  startWrTokenizer?: boolean
  trainWrim?: boolean
  createRael?: boolean
  spawnLearningAgent?: boolean
  attemptPush?: boolean
  attemptDeploy?: boolean
  attemptSql?: boolean
  attemptFinance?: boolean
  autoLaunchFollowUps?: boolean
  recursiveMission?: boolean
  startRoadmap23?: boolean
  supabase?: WarRoomSupabase | null
  nowIso?: string
}

function emptyScope(
  input: RunBoundedWorldLearningAgentInput,
  task: WorldLearningAgentTaskType,
  topic: string,
  now: string,
): WorldLearningAgentScope {
  return createWorldLearningAgentScope({
    taskType: task,
    topic,
    domain: input.domain,
    ownerUserId: input.ownerUserId,
    requestedBy: input.requestedBy,
    conversationId: input.conversationId,
    missionId: input.missionId,
    internetAvailable: input.internetAvailable,
    liveDiscoveryAllowed: input.liveSearchAllowed === true && input.internetAvailable !== false,
    terraAllowed: input.terraAllowed,
    nowIso: now,
  })
}

export function worldLearningAgentResultForCouncil(result: WorldLearningAgentResult) {
  return {
    agent_role: result.agent_role,
    status: result.status,
    summary: result.summary,
    claims: result.claims.map(c => ({
      claim_id: c.claim_id,
      status: c.status,
      confidence: c.confidence,
      evidence_ids: c.supporting_evidence,
    })),
    conflicts: result.claims.filter(c => c.status === 'DISPUTED').length,
    corpus_handoff_count: result.corpus_handoff.length,
    execution_authority: false,
    validation_only_path: result.council_validator_invoked,
  }
}

export function worldLearningAgentResultForAstra(result: WorldLearningAgentResult) {
  return {
    intent: 'WORLD_LEARNING_CANDIDATE_PACKAGE',
    status: result.status,
    dispatch: false,
    persist: false,
    candidate_count: result.corpus_handoff.length,
  }
}

export async function runBoundedWorldLearningAgent(
  input: RunBoundedWorldLearningAgentInput,
): Promise<WorldLearningAgentResult> {
  const startedAt = input.nowIso ?? new Date().toISOString()
  const requestId = randomUUID()
  const denials: WorldLearningAgentDenial[] = []
  const limitations: string[] = []
  const unavailable: string[] = [
    'MODEL_TRAINING',
    'WR_CORPUS',
    'WR_TOKENIZER',
    'WRIM',
    'RAEL',
    'AUTONOMOUS_CORPUS_PERSISTENCE',
    'OPERATIONAL_EXECUTION',
  ]

  const requestedTask = input.taskType || ''
  const task: WorldLearningAgentTaskType = isAllowedWorldLearningAgentTaskType(requestedTask)
    ? requestedTask
    : 'LEARN_TOPIC'
  const topic = (input.topic || input.question || WORLD_LEARNING_FIXTURE_TOPIC).slice(0, 400)
  const memoryClass: WorldMemoryClass = input.memoryClass ?? 'WORLD_KNOWLEDGE'

  let research_agent_invoked = false
  let data_corpus_agent_invoked = false
  let council_validator_invoked = false
  let local_model_used = false
  let terra_reused = Boolean(input.terraContext) || input.terraAllowed !== false
  let live_discovery: LiveDiscoveryState =
    input.internetAvailable === false || input.liveSearchAllowed === false ? 'UNAVAILABLE' : 'AVAILABLE'
  const terra_freshness_label = input.terraContext?.freshness ?? (live_discovery === 'UNAVAILABLE' ? 'CACHED' : 'UNKNOWN')

  let sources: WorldLearningAgentResult['sources'] = []
  let claims: WorldLearningAgentResult['claims'] = []
  let entities: WorldLearningAgentResult['entities'] = []
  let relationships: WorldLearningAgentResult['relationships'] = []
  let topic_map: WorldLearningAgentResult['topic_map'] = null
  let knowledge_gaps: WorldLearningAgentResult['knowledge_gaps'] = []
  let corpus_handoff: WorldLearningAgentResult['corpus_handoff'] = []
  let auditId: string | null = null

  const finish = async (
    status: WorldLearningAgentStatus,
    scope: WorldLearningAgentScope,
    summary: string,
  ): Promise<WorldLearningAgentResult> => {
    const identity = createWorldLearningAgentIdentity({
      requestId,
      ownerUserId: input.ownerUserId,
      requestedBy: input.requestedBy,
      allowedOperations: scope.allowed_operations,
      taskType: scope.task_type,
      missionId: input.missionId,
      conversationId: input.conversationId,
      expiresAt: scope.expires_at,
      nowIso: startedAt,
    })

    const result: WorldLearningAgentResult = {
      agent_id: identity.agent_id,
      agent_role: 'WORLD_LEARNING_AGENT',
      status,
      task_type: scope.task_type,
      scope,
      summary,
      topic,
      domain: input.domain ?? null,
      sources,
      claims,
      entities,
      relationships,
      topic_map,
      knowledge_gaps,
      corpus_handoff,
      research_agent_invoked,
      search_reused: true,
      terra_reused,
      data_corpus_agent_invoked,
      council_validator_invoked,
      live_discovery,
      terra_freshness_label,
      memory_class: memoryClass,
      local_model_used,
      local_model_is_primary_evidence: false,
      external_model_is_primary_evidence: false,
      autonomous_corpus_persistence: AUTONOMOUS_CORPUS_PERSISTENCE,
      production_corpus_persisted: false,
      model_training: MODEL_TRAINING_STATUS,
      wr_corpus: WR_CORPUS_STATUS,
      wr_tokenizer: WR_TOKENIZER_STATUS,
      wrim: WRIM_STATUS,
      rael: RAEL_STATUS,
      execution_authority: false,
      denials,
      limitations: [
        ...limitations,
        'INVOCATION_DRIVEN',
        'BOUNDED_WORLD_KNOWLEDGE_ACQUISITION only',
        'RESEARCH_AGENT remains canonical discovery',
        'DATA_CORPUS_AGENT remains canonical curation',
        'NO PRODUCTION CORPUS PERSIST',
        'NO MODEL TRAINING',
        '#23 WR-CORPUS ACTIVE; tokenizer/WRIM/Rael not production',
      ],
      unavailable_capabilities: unavailable,
      audit_id: auditId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      owner_scope: input.ownerUserId,
      mission_id: input.missionId ?? null,
      conversation_id: input.conversationId ?? null,
      identity,
      boundary_notes: WORLD_LEARNING_AGENT_BOUNDARY_NOTES,
      roadmap_23_status: ROADMAP_23_STATUS,
    }

    try {
      const decision: PolicyDecision =
        status === 'DENIED'
          ? {
              outcome: 'DENY',
              reasonCode: 'POLICY_DENIED',
              reason: denials[0]?.reason ?? 'World learning agent denied.',
              actionKind: 'bounded_world_knowledge_acquisition',
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
              reason: 'Bounded world-knowledge acquisition over existing Research/Search/Terra/Corpus paths.',
              actionKind: 'bounded_world_knowledge_acquisition',
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
        actorAgent: 'WORLD_LEARNING_AGENT',
        missionId: input.missionId ?? null,
        tool: 'ascension.world_learning_agent.runBoundedWorldLearningAgent',
        target: `${scope.task_type}:${topic.slice(0, 80)}`,
        ownerUserId: input.ownerUserId,
        evidenceRefs: sources.map(s => s.evidence_id).slice(0, 12),
        executionResult:
          status === 'DENIED' ? 'denied' : status === 'FAILED' || status === 'INTERNAL_ERROR' ? 'failed' : 'executed',
      })

      await insertGovernedAuditLog(input.supabase ?? null, {
        actor: input.invokedBy === 'commander' || input.invokedBy === 'desktop_core' ? 'user' : 'system',
        category: 'runtime',
        message: `WORLD_LEARNING_AGENT ${status}: ${scope.task_type}`,
        actionId: requestId,
        metadata: meta,
        extra: {
          invocation: input.invokedBy,
          status,
          task_type: scope.task_type,
          topic_domain: input.domain ?? null,
          evidence_count: sources.length,
          source_classes: [...new Set(sources.map(s => s.source_class))],
          candidate_knowledge_count: corpus_handoff.length,
          conflict_count: claims.filter(c => c.status === 'DISPUTED').length,
          corpus_recommendation_count: corpus_handoff.length,
          live_discovery,
          timing_started_at: startedAt,
          production_corpus_persisted: false,
          roadmap_23: ROADMAP_23_STATUS,
          chain_of_thought: undefined,
          secrets: undefined,
        },
      })
      auditId = requestId
      result.audit_id = auditId
    } catch {
      limitations.push('Audit persistence unavailable.')
    }

    return result
  }

  const deny = (capability: string, reason: string) => {
    const decision = denyWorldLearningAgentAction(capability)
    denials.push({
      capability_or_action: capability,
      reason_code: decision.reasonCode,
      reason,
    })
  }

  const scope = emptyScope(input, task, topic, startedAt)

  if (!isWorldLearningAgentRuntimeAvailable()) {
    deny('WORLD_LEARNING_AGENT', 'WORLD_LEARNING_AGENT runtime disabled (soft kill).')
    return finish('DENIED', scope, 'WORLD_LEARNING_AGENT is disabled. Research and Data Corpus remain independently usable.')
  }

  if (!ascensionAutonomyIsOff() || WORLD_LEARNING_AGENT_AUTONOMOUS_EXECUTION_ENABLED) {
    deny('ASCENSION_AUTONOMY', 'WORLD_LEARNING_AGENT requires Ascension autonomy OFF.')
    return finish('DENIED', scope, 'Autonomous world learning is not authorized.')
  }

  const self = assertWorldLearningAgentCannotSelfApprove()
  if (self.outcome !== 'ALLOW') {
    denials.push({
      capability_or_action: 'SELF_APPROVAL',
      reason_code: self.reasonCode,
      reason: self.reason,
    })
  }

  if (input.babyContextAttempt) {
    const baby = assertBabyWorldLearningAgentDenied()
    deny('BABY_OBSERVER', baby.reason)
    return finish('DENIED', scope, baby.reason)
  }

  if (input.enforceOwnership) {
    const owner = assertWorldLearningAgentOwnerScopeMatch(input.ownerUserId, input.conversationOwnerUserId)
    if (!owner.ok) {
      deny('OWNER_SCOPE', owner.reason)
      return finish('DENIED', scope, owner.reason)
    }
  }

  const privateGate = assertPrivateNotPromotedToWorldKnowledge({
    memoryClass,
    promotePrivateToWorld: input.promotePrivateToWorld,
    promoteSessionToWorld: input.promoteSessionToWorld,
  })
  if (!privateGate.ok) {
    deny('PROMOTE_PRIVATE_TO_WORLD', privateGate.reason)
    return finish('DENIED', scope, privateGate.reason)
  }

  const credentialSurface = [topic, input.question ?? '', JSON.stringify(input.knownEvidence ?? [])].join('\n')
  if (input.ingestCredentials || detectCredentialMaterial(credentialSurface)) {
    deny('INGEST_CREDENTIALS', 'Passwords, API keys, session tokens, and authentication material are never ingested.')
    return finish('DENIED', scope, 'Credential material cannot enter world-learning evidence.')
  }

  const redFlags: Array<[boolean | undefined, string, string]> = [
    [input.expandCrawler, 'CRAWL_EXPANSION', 'Crawler scope cannot be expanded by WORLD_LEARNING_AGENT.'],
    [input.downloadUnauthorizedDatasets, 'UNAUTHORIZED_DATASET', 'Unauthorized private datasets cannot be acquired.'],
    [input.executeHarmfulAction, 'OPERATIONAL_EXECUTION', 'Research authority does not grant operational execution.'],
    [input.applyCorpusWithoutReview, 'APPLY_CORPUS_WITHOUT_REVIEW', 'Corpus apply remains review-gated via DATA_CORPUS_AGENT.'],
    [input.persistProductionCorpus, 'PRODUCTION_CORPUS_PERSIST', 'Autonomous production-corpus persistence is false.'],
    [input.startWrCorpus, 'WR_CORPUS_START', 'WR_CORPUS already implemented. Cannot start a second corpus architecture.'],
    [input.startWrTokenizer, 'WR_TOKENIZER_START', 'CURRENT_WR_TOKENIZER_LANE remains NOT_STARTED. Historical WR-TOKENIZER-0 is frozen lineage.'],
    [input.trainWrim, 'WRIM_TRAIN', 'WRIM training is NOT_IMPLEMENTED / #23.'],
    [input.createRael, 'RAEL_CREATE', 'Ra\'el is NOT_IMPLEMENTED / #23.'],
    [input.spawnLearningAgent, 'AGENT_SPAWN', 'WORLD_LEARNING_AGENT cannot spawn agents.'],
    [input.attemptPush, 'GIT_PUSH', 'WORLD_LEARNING_AGENT cannot push.'],
    [input.attemptDeploy, 'PRODUCTION_DEPLOY', 'WORLD_LEARNING_AGENT cannot deploy.'],
    [input.attemptSql, 'SQL_EXECUTE', 'WORLD_LEARNING_AGENT cannot apply SQL.'],
    [input.attemptFinance, 'FINANCIAL_SPEND', 'WORLD_LEARNING_AGENT has no finance authority.'],
    [input.autoLaunchFollowUps, 'UNLIMITED_FOLLOW_UP', 'Follow-up research may be recommended, never auto-launched without bound.'],
    [input.recursiveMission, 'RECURSIVE_MISSION', 'Self-assigned recursive missions are forbidden.'],
    [input.startRoadmap23, 'ROADMAP_23_START', '#23 WR-CORPUS is ACTIVE. This agent cannot start tokenizer/WRIM/Ra\'el or a second corpus architecture.'],
    [input.markModelSpeculationAsFact, 'MARK_MODEL_AS_EVIDENCE', 'Model output is reasoning, not primary evidence.'],
    [Boolean(input.attemptedAction), input.attemptedAction || 'DENIED_ACTION', `Attempted action denied: ${input.attemptedAction}`],
  ]
  for (const [flag, capability, reason] of redFlags) {
    if (flag) deny(capability, reason)
  }

  if (input.pretendStaleIsLive) {
    deny('MARK_STALE_AS_LIVE', 'Stale or cached Terra/Search material remains stale; it is never called live.')
  }
  if (input.ignoreContradictions) {
    deny('IGNORE_CONTRADICTIONS', 'Contradictory reputable evidence is preserved, not erased.')
  }

  if (isWorldLearningAgentScopeExpired(scope)) {
    deny('SCOPE_EXPIRED', 'World learning scope expired.')
    return finish('DENIED', scope, 'Scope expired before bounded execution.')
  }

  if (input.internetAvailable === false) {
    live_discovery = 'UNAVAILABLE'
    unavailable.push('LIVE_DISCOVERY')
    limitations.push('LIVE_DISCOVERY = UNAVAILABLE')
    limitations.push('Offline path uses local index / cached evidence / local model only.')
  }

  const existingCorpus = (input.existingCorpusCandidates ?? makeExistingCorpusCandidates()).slice(
    0,
    scope.max_candidate_corpus_items,
  )
  const fixtureEvidence = makeWorldLearningFixtures(startedAt)
  let evidence: WorldLearningEvidenceItem[] =
    input.knownEvidence && input.knownEvidence.length > 0
      ? input.knownEvidence
      : input.useFixtures !== false
        ? fixtureEvidence
        : []

  const shouldInvokeResearch =
    input.invokeResearchAgent === true || (input.useFixtures === false && input.internetAvailable !== false)
  if (shouldInvokeResearch) {
    try {
      const research = await runBoundedResearchAgent({
        researchQuestion: topic,
        ownerUserId: input.ownerUserId,
        requestedBy: input.requestedBy,
        invokedBy: input.invokedBy === 'desktop_core' ? 'commander' : input.invokedBy,
        missionId: input.missionId,
        conversationId: input.conversationId,
        terraAllowed: input.terraAllowed !== false,
        liveSearchAllowed: input.internetAvailable !== false && input.liveSearchAllowed !== false,
        storedResearchAllowed: input.storedResearchAllowed !== false,
        supabase: input.supabase ?? null,
        enforceOwnership: false,
        timeBudgetMs: Math.min(scope.time_budget_ms, 8_000),
        nowIso: startedAt,
      })
      research_agent_invoked = true
      terra_reused = terra_reused || research.terra_refs.length > 0 || input.terraAllowed !== false
      if (research.status === 'DENIED') {
        limitations.push(`Research Agent status ${research.status}: reused, not reimplemented.`)
      }
      if (research.findings.length && evidence.length === 0) {
        evidence = research.findings.slice(0, scope.max_documents).map((finding, index) => ({
          id: research.evidence_refs[index] ?? `research-finding-${index}`,
          provider: 'research_agent',
          providerRecordId: research.evidence_refs[index] ?? null,
          title: finding.statement.slice(0, 120),
          summary: finding.statement,
          contentSnippet: finding.statement,
          canonicalUrl: research.sources[index]?.urls?.[0] ?? null,
          sourceUrl: research.sources[index]?.urls?.[0] ?? null,
          sourceName: research.sources[index]?.kind ?? 'research',
          contentType: 'text',
          organization: null,
          language: 'en',
          license: null,
          retrievedAt: startedAt,
          provenance: {
            sourceUrl: research.sources[index]?.urls?.[0] ?? 'research_agent',
            retrievedAt: startedAt,
            isHistorical: finding.support === 'STALE',
          },
          sourceClass: finding.support === 'STALE' ? 'CACHED' : 'SECONDARY',
          official: false,
          primary: finding.support === 'SUPPORTED',
          publishedAt: startedAt,
          contentHash: `research-${index}`,
        }))
      }
    } catch (error) {
      limitations.push(
        `Research Agent invocation failed closed: ${error instanceof Error ? error.message : 'unknown'}; fixtures/local evidence retained.`,
      )
    }
    if (input.useFixtures !== false && evidence.length === 0) evidence = fixtureEvidence
  }

  if (input.omitSources) evidence = []

  const synthesized = synthesizeWorldLearning({
    taskType: task,
    topic,
    domain: input.domain,
    scope,
    nowIso: startedAt,
    evidence,
    existingCorpus,
    omitSources: input.omitSources,
    ignoreContradictions: input.ignoreContradictions,
    pretendStaleIsLive: input.pretendStaleIsLive,
  })
  sources = synthesized.sources
  claims = synthesized.claims
  entities = synthesized.entities
  relationships = synthesized.relationships
  topic_map = synthesized.topic_map
  knowledge_gaps = synthesized.knowledge_gaps
  corpus_handoff = synthesized.corpus_handoff

  if (input.terraContext?.freshness === 'CACHED' || input.terraContext?.freshness === 'STALE') {
    limitations.push(`Terra context labeled ${input.terraContext.freshness}; not treated as live.`)
  }

  const disputed = claims.filter(c => c.status === 'DISPUTED' || c.contradicting_evidence.length > 0)
  if ((input.invokeCouncilValidator !== false && disputed.length > 0) || input.invokeCouncilValidator === true) {
    const validatorScope = createCouncilValidatorScope({
      conversationId: input.conversationId ?? '00000000-0000-4000-8000-000000000013',
      ownerUserId: input.ownerUserId,
      requestedBy: input.requestedBy,
      evidenceRefs: sources.map(s => s.evidence_id),
      nowIso: startedAt,
    })
    validateCouncilClaims({
      scope: validatorScope,
      claims: claims.slice(0, 12).map(c => ({
        claim_id: c.claim_id,
        claim_text: c.normalized_statement,
        claim_type: 'RESEARCH',
        evidence_refs: c.supporting_evidence,
        evidence_support:
          c.status === 'DISPUTED' ? 'CONFLICTING' : c.status === 'SUPPORTED' ? 'SUPPORTED' : 'PARTIAL',
        freshness: c.freshness,
        conflicting_sources: c.contradicting_evidence,
      })),
    })
    council_validator_invoked = true
  }

  if (input.invokeDataCorpusAgent !== false && corpus_handoff.length > 0) {
    try {
      const corpus = await runBoundedDataCorpusAgent({
        corpusQuestion: `World-learning handoff for ${topic}`,
        ownerUserId: input.ownerUserId,
        requestedBy: input.requestedBy,
        invokedBy: input.invokedBy === 'desktop_core' ? 'commander' : input.invokedBy,
        records: corpus_handoff.map(c => ({
          document_id: c.candidate_id,
          title: c.claim_or_topic,
          content_preview: c.normalized_content,
          freshness: c.freshness,
          from_research_handoff: true,
          content_hash: c.candidate_id,
        })),
        useFixtures: false,
        allowMetadataWrite: false,
        allowIndexSupportWrite: false,
        missionId: input.missionId,
        conversationId: input.conversationId,
        supabase: input.supabase ?? null,
        nowIso: startedAt,
      })
      data_corpus_agent_invoked = true
      if (corpus.writes_performed.some(w => w.persisted_to_production_corpus)) {
        deny('PRODUCTION_CORPUS_PERSIST', 'DATA_CORPUS_AGENT must not persist production corpus from this handoff.')
      }
    } catch (error) {
      limitations.push(
        `DATA_CORPUS_AGENT handoff failed closed: ${error instanceof Error ? error.message : 'unknown'}; candidates retained in-memory.`,
      )
    }
  }

  if (input.useLocalModel) {
    try {
      const inferred = await runLocalModelInference({
        prompt: `Summarize bounded evidenced claims only. Do not invent facts. Topic: ${topic}. Claims: ${claims
          .slice(0, 4)
          .map(c => c.normalized_statement)
          .join(' | ')}`,
        system:
          'You summarize War Room world-learning claims. You are not evidence. You cannot authorize action, persist corpus, or train models.',
        ownerUserId: input.ownerUserId,
        resourceOwnerUserId: input.ownerUserId,
      })
      local_model_used = true
      const sanitized = sanitizeLocalModelLearningText(inferred.content)
      if (sanitized) limitations.push('Local-model summary attached as non-evidence reasoning only.')
    } catch {
      limitations.push('Local model unavailable; deterministic synthesis used.')
    }
  }

  let status: WorldLearningAgentStatus = 'COMPLETE'
  if (input.omitSources || (claims.length > 0 && claims.every(c => c.status === 'INSUFFICIENT_EVIDENCE'))) {
    status = 'INSUFFICIENT_EVIDENCE'
  } else if (live_discovery === 'UNAVAILABLE' && sources.length > 0) {
    status = 'PARTIAL'
  } else if (denials.length > 0) {
    status = 'PARTIAL'
  }

  const summaryParts = [
    `Task ${task} produced ${claims.length} evidenced claims and ${corpus_handoff.length} corpus candidates.`,
    `LIVE_DISCOVERY = ${live_discovery}.`,
    `Research Agent ${research_agent_invoked ? 'invoked' : 'not invoked this run'}; Search Stage 5 freshness reused.`,
    `Terra ${terra_reused ? 'consumed as Oracle' : 'not required'}; cached/stale remains labeled.`,
    `DATA_CORPUS_AGENT ${data_corpus_agent_invoked ? 'received structured handoff' : 'not invoked'}; production persist = false.`,
    `Local model is ${local_model_used ? 'assistive reasoning' : 'unused'}; never primary evidence.`,
    `Conflicts preserved: ${claims.filter(c => c.status === 'DISPUTED').length}.`,
    `Knowledge gaps: ${knowledge_gaps.length}. Follow-ups recommended, not auto-launched.`,
    `#23 WR-CORPUS ACTIVE. CURRENT_WR_TOKENIZER_LANE NOT_STARTED. WRIM/Ra'el/training remain unimplemented.`,
  ]

  return finish(status, scope, summaryParts.join(' '))
}
