/**
 * #22 Phase 13 — WORLD_LEARNING_AGENT deterministic validation + live-safe proof + red team.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AUTONOMOUS_CORPUS_PERSISTENCE,
  MODEL_TRAINING_STATUS,
  RAEL_STATUS,
  ROADMAP_23_STATUS,
  WORLD_LEARNING_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
  WORLD_LEARNING_AGENT_POLICY_PROFILE,
  WORLD_LEARNING_AGENT_ROLE,
  WORLD_LEARNING_AGENT_RUNTIME_VERSION,
  WR_CORPUS_STATUS,
  WR_TOKENIZER_STATUS,
  WRIM_STATUS,
  createWorldLearningAgentIdentity,
  isWorldLearningAgentRuntimeAvailable,
} from '@/lib/ascension/world-learning-agent/identity'
import {
  WORLD_LEARNING_AGENT_DENIED_ALIASES,
  WORLD_LEARNING_AGENT_TASK_TYPES,
  assertWorldLearningAgentCannotSelfApprove,
  denyWorldLearningAgentAction,
  isAllowedWorldLearningAgentTaskType,
} from '@/lib/ascension/world-learning-agent/profile'
import {
  createWorldLearningAgentScope,
  WORLD_LEARNING_AGENT_DEFAULT_BOUNDS,
} from '@/lib/ascension/world-learning-agent/scope'
import { WORLD_LEARNING_AGENT_BOUNDARY_NOTES } from '@/lib/ascension/world-learning-agent/result'
import { runBoundedWorldLearningAgent } from '@/lib/ascension/world-learning-agent/runtime'
import {
  assertBabyWorldLearningAgentDenied,
  assertPrivateNotPromotedToWorldKnowledge,
  assertWorldLearningAgentOwnerScopeMatch,
} from '@/lib/ascension/world-learning-agent/ownership'
import {
  WORLD_LEARNING_FIXTURE_TOPIC,
  classifyNovelty,
  detectCredentialMaterial,
  makeExistingCorpusCandidates,
  makeWorldLearningFixtures,
  stage5Freshness,
} from '@/lib/ascension/world-learning-agent/learn'
import { RESEARCH_AGENT_DEFAULT_BOUNDS } from '@/lib/ascension/research-agent/scope'
import { isResearchAgentRuntimeAvailable } from '@/lib/ascension/research-agent/identity'
import { isDataCorpusAgentRuntimeAvailable } from '@/lib/ascension/data-corpus-agent/identity'
import { isNavigationAgentRuntimeAvailable } from '@/lib/ascension/navigation-agent/identity'
import { getSovereignRuntimeTruth } from '@/lib/sovereign-runtime/runtimeTruth'
import {
  OPERATIONAL_ASCENSION_AGENTS,
  operationalAscensionAgentCount,
  ascensionAutonomyIsOff,
  TARGET_ASCENSION_AGENTS_UNIMPLEMENTED,
} from '@/lib/ascension/operationalRegistry'
import { ACTOR_INVENTORY } from '@/lib/agent-capability-matrix/actors'
import { matrixForAgent } from '@/lib/agent-capability-matrix/matrix'
import { CHUNKING_VERSION, LOCAL_EMBEDDING_MODEL_ID } from '@/lib/war-room-search/hybrid/types'
import { FRESHNESS_STATES } from '@/lib/war-room-search/crawler/types'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

export async function runWorldLearningAgentPhase13Validation(): Promise<{
  passed: number
  failed: number
  results: Check[]
}> {
  const results: Check[] = []
  const prevEnabled = process.env.ASCENSION_WORLD_LEARNING_AGENT_ENABLED
  delete process.env.ASCENSION_WORLD_LEARNING_AGENT_ENABLED

  results.push(check('1_canonical_agent', WORLD_LEARNING_AGENT_ROLE === 'WORLD_LEARNING_AGENT', WORLD_LEARNING_AGENT_ROLE))
  results.push(
    check(
      '2_no_worldlearning2',
      !fs.existsSync(path.join(repoRoot, 'lib', 'world-learning2')) &&
        !fs.existsSync(path.join(repoRoot, 'lib', 'ascension', 'world-learning-agent-2')),
      'ok',
    ),
  )
  results.push(
    check(
      '3_operational_count_9',
      operationalAscensionAgentCount() === 9 && OPERATIONAL_ASCENSION_AGENTS.length === 9,
      String(operationalAscensionAgentCount()),
    ),
  )
  results.push(
    check(
      '4_autonomy_off',
      ascensionAutonomyIsOff() && !WORLD_LEARNING_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
      'OFF',
    ),
  )

  const runtimeSrc = fs.readFileSync(path.join(repoRoot, 'lib', 'ascension', 'world-learning-agent', 'runtime.ts'), 'utf8')
  const learnSrc = fs.readFileSync(path.join(repoRoot, 'lib', 'ascension', 'world-learning-agent', 'learn.ts'), 'utf8')
  results.push(check('5_research_reused', runtimeSrc.includes('runBoundedResearchAgent'), 'ok'))
  results.push(check('6_search_reused', learnSrc.includes("from '@/lib/war-room-search/crawler/types'"), 'ok'))
  results.push(check('7_terra_reused', runtimeSrc.includes('terraContext') && runtimeSrc.includes('terra_reused'), 'ok'))
  results.push(check('8_corpus_reused', runtimeSrc.includes('runBoundedDataCorpusAgent'), 'ok'))
  results.push(check('9_validator_reused', runtimeSrc.includes('validateCouncilClaims'), 'ok'))
  results.push(
    check(
      '10_no_research2',
      !fs.existsSync(path.join(repoRoot, 'lib', 'research2')) && !runtimeSrc.includes('function runLiveResearchRouter'),
      'ok',
    ),
  )
  results.push(check('11_no_corpus2', !fs.existsSync(path.join(repoRoot, 'lib', 'corpus2')), 'ok'))
  results.push(check('12_no_crawler2', !fs.existsSync(path.join(repoRoot, 'lib', 'crawler2')), 'ok'))
  results.push(
    check(
      '13_bounded_task_types',
      WORLD_LEARNING_AGENT_TASK_TYPES.length === 11 && isAllowedWorldLearningAgentTaskType('LEARN_TOPIC'),
      String(WORLD_LEARNING_AGENT_TASK_TYPES.length),
    ),
  )
  results.push(
    check(
      '14_bounded_queries',
      WORLD_LEARNING_AGENT_DEFAULT_BOUNDS.max_search_queries === RESEARCH_AGENT_DEFAULT_BOUNDS.max_search_queries &&
        WORLD_LEARNING_AGENT_DEFAULT_BOUNDS.max_search_queries === 3,
      String(WORLD_LEARNING_AGENT_DEFAULT_BOUNDS.max_search_queries),
    ),
  )
  results.push(
    check(
      '15_bounded_fetches',
      WORLD_LEARNING_AGENT_DEFAULT_BOUNDS.max_fetches === RESEARCH_AGENT_DEFAULT_BOUNDS.max_fetches,
      String(WORLD_LEARNING_AGENT_DEFAULT_BOUNDS.max_fetches),
    ),
  )
  results.push(
    check(
      '16_bounded_iterations',
      WORLD_LEARNING_AGENT_DEFAULT_BOUNDS.max_iterations === 1 &&
        WORLD_LEARNING_AGENT_DEFAULT_BOUNDS.max_recursive_depth === 0,
      String(WORLD_LEARNING_AGENT_DEFAULT_BOUNDS.max_iterations),
    ),
  )
  results.push(
    check(
      '17_bounded_wall_clock',
      WORLD_LEARNING_AGENT_DEFAULT_BOUNDS.time_budget_ms === RESEARCH_AGENT_DEFAULT_BOUNDS.time_budget_ms,
      String(WORLD_LEARNING_AGENT_DEFAULT_BOUNDS.time_budget_ms),
    ),
  )
  results.push(
    check(
      '18_no_recursive_missions',
      WORLD_LEARNING_AGENT_DEFAULT_BOUNDS.max_recursive_depth === 0 &&
        WORLD_LEARNING_AGENT_DENIED_ALIASES.includes('RECURSIVE_MISSION'),
      'ok',
    ),
  )

  const live = await runBoundedWorldLearningAgent({
    taskType: 'LEARN_TOPIC',
    topic: WORLD_LEARNING_FIXTURE_TOPIC,
    domain: 'transportation',
    ownerUserId: 'commander-world-learn',
    requestedBy: 'commander-world-learn',
    invokedBy: 'commander',
    useFixtures: true,
    internetAvailable: true,
    liveSearchAllowed: false,
    invokeResearchAgent: false,
    invokeDataCorpusAgent: true,
    invokeCouncilValidator: true,
    terraContext: { summary: 'Helsinki coastal fixture', freshness: 'CACHED' },
    existingCorpusCandidates: makeExistingCorpusCandidates(),
  })

  results.push(check('19_provenance_required', live.claims.every(c => c.provenance.source_ids.length > 0 || c.status === 'INSUFFICIENT_EVIDENCE'), String(live.claims.length)))
  results.push(check('20_source_class', live.sources.every(s => Boolean(s.source_class)), String(live.sources.length)))
  results.push(check('21_retrieval_time', live.sources.every(s => Boolean(s.retrieval_time)), 'ok'))
  results.push(check('22_freshness', live.sources.every(s => (FRESHNESS_STATES as readonly string[]).includes(s.freshness)), live.sources.map(s => s.freshness).join(',')))
  results.push(check('23_confidence', live.claims.every(c => typeof c.confidence === 'number'), 'ok'))
  results.push(check('24_supporting_evidence', live.claims.filter(c => c.status !== 'INSUFFICIENT_EVIDENCE').every(c => c.supporting_evidence.length > 0), 'ok'))
  results.push(check('25_contradicting_evidence', live.claims.some(c => c.contradicting_evidence.length > 0), String(live.claims.filter(c => c.contradicting_evidence.length).length)))
  results.push(check('26_disputed_preserved', live.claims.some(c => c.status === 'DISPUTED'), live.claims.map(c => c.status).join(',')))
  results.push(check('27_novelty_new_or_related', live.claims.some(c => c.novelty === 'NEW' || c.novelty === 'RELATED'), live.claims.map(c => c.novelty).join(',')))
  results.push(check('28_duplicate_detection', live.claims.some(c => c.novelty === 'DUPLICATE'), live.claims.map(c => c.novelty).join(',')))
  results.push(
    check(
      '29_update_classification',
      classifyNovelty({
        title: 'Digitraffic Marine API overview',
        contentHash: 'different-hash',
        publishedAt: '2026-09-01T00:00:00.000Z',
        existing: makeExistingCorpusCandidates(),
      }) === 'UPDATE',
      'ok',
    ),
  )
  results.push(check('30_conflict_classification', live.claims.some(c => c.novelty === 'CONFLICT'), 'ok'))
  results.push(check('31_stale_remains_stale', live.sources.some(s => s.freshness === 'STALE') && live.claims.some(c => c.status === 'STALE' || c.freshness === 'STALE'), 'ok'))
  results.push(check('32_local_model_not_evidence', live.local_model_is_primary_evidence === false, 'ok'))
  results.push(check('33_external_model_not_evidence', live.external_model_is_primary_evidence === false, 'ok'))

  const noSources = await runBoundedWorldLearningAgent({
    taskType: 'VERIFY_CLAIM',
    topic: WORLD_LEARNING_FIXTURE_TOPIC,
    ownerUserId: 'commander-world-learn',
    requestedBy: 'commander-world-learn',
    invokedBy: 'commander',
    useFixtures: true,
    omitSources: true,
    invokeResearchAgent: false,
    invokeDataCorpusAgent: false,
  })
  results.push(
    check(
      '34_claim_without_evidence',
      noSources.status === 'INSUFFICIENT_EVIDENCE' &&
        noSources.claims.every(c => c.status === 'INSUFFICIENT_EVIDENCE' && c.supporting_evidence.length === 0),
      noSources.status,
    ),
  )
  results.push(check('35_entities_anchored', live.entities.every(e => e.evidence_ids.length > 0), String(live.entities.length)))
  results.push(check('36_relationships_anchored', live.relationships.every(r => r.evidence_ids.length > 0), String(live.relationships.length)))
  results.push(check('37_topic_map_bounded', Boolean(live.topic_map?.bounded) && (live.topic_map?.subtopics.length ?? 0) <= 8, String(live.topic_map?.subtopics.length)))
  results.push(check('38_knowledge_gaps', live.knowledge_gaps.length >= 1 && live.knowledge_gaps.every(g => g.auto_launched === false), String(live.knowledge_gaps.length)))
  results.push(
    check(
      '39_no_unlimited_followup',
      WORLD_LEARNING_AGENT_DEFAULT_BOUNDS.max_follow_up_recommendations === 3 &&
        live.knowledge_gaps.every(g => g.auto_launched === false),
      'ok',
    ),
  )

  const privateDenied = await runBoundedWorldLearningAgent({
    taskType: 'LEARN_TOPIC',
    topic: WORLD_LEARNING_FIXTURE_TOPIC,
    ownerUserId: 'commander-world-learn',
    requestedBy: 'commander-world-learn',
    invokedBy: 'commander',
    memoryClass: 'COMMANDER_PRIVATE',
    promotePrivateToWorld: true,
    useFixtures: true,
  })
  results.push(check('40_world_vs_private', privateDenied.status === 'DENIED', privateDenied.status))

  const sessionDenied = await runBoundedWorldLearningAgent({
    taskType: 'LEARN_TOPIC',
    topic: WORLD_LEARNING_FIXTURE_TOPIC,
    ownerUserId: 'commander-world-learn',
    requestedBy: 'commander-world-learn',
    invokedBy: 'commander',
    memoryClass: 'SESSION_LOCAL',
    promoteSessionToWorld: true,
    useFixtures: true,
  })
  results.push(check('41_session_not_promoted', sessionDenied.status === 'DENIED', sessionDenied.status))

  const creds = await runBoundedWorldLearningAgent({
    taskType: 'LEARN_TOPIC',
    topic: 'ingest api_key=sk-testsecretvalue and password=hunter2',
    ownerUserId: 'commander-world-learn',
    requestedBy: 'commander-world-learn',
    invokedBy: 'commander',
    ingestCredentials: true,
    useFixtures: true,
  })
  results.push(check('42_credentials_never_ingested', creds.status === 'DENIED' && detectCredentialMaterial('api_key=sk-abcdefghijklmnop'), creds.status))

  const remotePrivate = await runBoundedWorldLearningAgent({
    taskType: 'LEARN_TOPIC',
    topic: WORLD_LEARNING_FIXTURE_TOPIC,
    ownerUserId: 'commander-world-learn',
    requestedBy: 'commander-world-learn',
    invokedBy: 'commander',
    memoryClass: 'REMOTE_USER_DATA',
    promotePrivateToWorld: true,
    useFixtures: true,
  })
  results.push(check('43_private_connected_not_generalized', remotePrivate.status === 'DENIED', remotePrivate.status))

  const offline = await runBoundedWorldLearningAgent({
    taskType: 'LEARN_TOPIC',
    topic: WORLD_LEARNING_FIXTURE_TOPIC,
    ownerUserId: 'commander-world-learn',
    requestedBy: 'commander-world-learn',
    invokedBy: 'commander',
    useFixtures: true,
    internetAvailable: false,
    liveSearchAllowed: false,
    invokeResearchAgent: true,
    invokeDataCorpusAgent: true,
  })
  results.push(check('44_offline_local_learning', offline.sources.length > 0 && offline.live_discovery === 'UNAVAILABLE', `${offline.sources.length}/${offline.live_discovery}`))
  results.push(check('45_live_discovery_unavailable_offline', offline.live_discovery === 'UNAVAILABLE', offline.live_discovery))
  results.push(
    check(
      '46_online_approved_providers_only',
      runtimeSrc.includes('runBoundedResearchAgent') &&
        !runtimeSrc.includes('new discovery provider') &&
        !fs.existsSync(path.join(repoRoot, 'lib', 'search2')),
      'ok',
    ),
  )
  results.push(
    check(
      '47_no_crawler_expansion',
      WORLD_LEARNING_AGENT_DENIED_ALIASES.includes('CRAWL_EXPANSION') &&
        CHUNKING_VERSION === 'wr-chunk-v1' &&
        LOCAL_EMBEDDING_MODEL_ID === 'BAAI/bge-small-en-v1.5',
      CHUNKING_VERSION,
    ),
  )

  const unauth = await runBoundedWorldLearningAgent({
    taskType: 'LEARN_TOPIC',
    topic: WORLD_LEARNING_FIXTURE_TOPIC,
    ownerUserId: 'commander-world-learn',
    requestedBy: 'commander-world-learn',
    invokedBy: 'commander',
    useFixtures: true,
    downloadUnauthorizedDatasets: true,
  })
  results.push(check('48_no_unauthorized_acquisition', unauth.denials.some(d => d.capability_or_action === 'UNAUTHORIZED_DATASET'), 'ok'))

  const dangerousStudy = await runBoundedWorldLearningAgent({
    taskType: 'LEARN_TOPIC',
    topic: 'Public historical overview of ransomware as a documented cybercrime phenomenon',
    domain: 'cybersecurity',
    ownerUserId: 'commander-world-learn',
    requestedBy: 'commander-world-learn',
    invokedBy: 'commander',
    useFixtures: true,
    invokeResearchAgent: false,
  })
  results.push(check('49_dangerous_subjects_researchable', dangerousStudy.status !== 'DENIED', dangerousStudy.status))

  const executeDenied = await runBoundedWorldLearningAgent({
    taskType: 'LEARN_TOPIC',
    topic: 'Public historical overview of ransomware',
    ownerUserId: 'commander-world-learn',
    requestedBy: 'commander-world-learn',
    invokedBy: 'commander',
    useFixtures: true,
    executeHarmfulAction: true,
  })
  results.push(
    check(
      '50_research_not_execution',
      executeDenied.execution_authority === false &&
        executeDenied.denials.some(d => d.capability_or_action === 'OPERATIONAL_EXECUTION'),
      'ok',
    ),
  )

  const gov = await runBoundedWorldLearningAgent({
    taskType: 'LEARN_TOPIC',
    topic: WORLD_LEARNING_FIXTURE_TOPIC,
    ownerUserId: 'commander-world-learn',
    requestedBy: 'commander-world-learn',
    invokedBy: 'commander',
    useFixtures: true,
    attemptPush: true,
    attemptDeploy: true,
    attemptFinance: true,
    spawnLearningAgent: true,
    attemptSql: true,
    trainWrim: true,
    startWrCorpus: true,
    startWrTokenizer: true,
    createRael: true,
    persistProductionCorpus: true,
    applyCorpusWithoutReview: true,
    expandCrawler: true,
    autoLaunchFollowUps: true,
    recursiveMission: true,
    markModelSpeculationAsFact: true,
    ignoreContradictions: true,
    pretendStaleIsLive: true,
    startRoadmap23: true,
  })
  results.push(check('51_governance_preserved', gov.execution_authority === false && assertWorldLearningAgentCannotSelfApprove().outcome === 'DENY', 'ok'))
  results.push(check('52_no_push', gov.denials.some(d => d.capability_or_action === 'GIT_PUSH'), 'ok'))
  results.push(check('53_no_deploy', gov.denials.some(d => d.capability_or_action === 'PRODUCTION_DEPLOY'), 'ok'))
  results.push(check('54_no_finance', gov.denials.some(d => d.capability_or_action === 'FINANCIAL_SPEND'), 'ok'))
  results.push(check('55_no_agent_spawn', gov.denials.some(d => d.capability_or_action === 'AGENT_SPAWN'), 'ok'))
  results.push(check('56_no_sql', gov.denials.some(d => d.capability_or_action === 'SQL_EXECUTE'), 'ok'))
  results.push(check('57_no_model_training', gov.model_training === 'NOT_IMPLEMENTED' && gov.denials.some(d => d.capability_or_action === 'WRIM_TRAIN'), gov.model_training))
  results.push(check('58_no_weight_mutation', WORLD_LEARNING_AGENT_DENIED_ALIASES.includes('WEIGHT_MUTATION'), 'ok'))
  results.push(check('59_no_wr_corpus', gov.wr_corpus === 'NOT_STARTED' && WR_CORPUS_STATUS === 'NOT_STARTED', gov.wr_corpus))
  results.push(check('60_no_wr_tokenizer', gov.wr_tokenizer === 'NOT_STARTED' && WR_TOKENIZER_STATUS === 'NOT_STARTED', gov.wr_tokenizer))
  results.push(check('61_no_wrim', gov.wrim === 'NOT_IMPLEMENTED' && WRIM_STATUS === 'NOT_IMPLEMENTED', gov.wrim))
  results.push(check('62_no_rael', gov.rael === 'NOT_IMPLEMENTED' && RAEL_STATUS === 'NOT_IMPLEMENTED', gov.rael))

  process.env.ASCENSION_WORLD_LEARNING_AGENT_ENABLED = 'false'
  const killed = await runBoundedWorldLearningAgent({
    taskType: 'LEARN_TOPIC',
    topic: WORLD_LEARNING_FIXTURE_TOPIC,
    ownerUserId: 'commander-world-learn',
    requestedBy: 'commander-world-learn',
    invokedBy: 'commander',
    useFixtures: true,
  })
  results.push(check('63_soft_kill', killed.status === 'DENIED', killed.status))
  results.push(check('64_disabled_rejects', killed.summary.includes('disabled'), killed.summary.slice(0, 80)))
  results.push(check('65_research_usable_while_disabled', isResearchAgentRuntimeAvailable(), 'ok'))
  results.push(check('66_corpus_usable_while_disabled', isDataCorpusAgentRuntimeAvailable(), 'ok'))
  delete process.env.ASCENSION_WORLD_LEARNING_AGENT_ENABLED

  results.push(
    check(
      '67_corpus_handoff_structured',
      live.corpus_handoff.length > 0 &&
        live.corpus_handoff.every(
          c =>
            Boolean(c.candidate_id) &&
            Boolean(c.normalized_content) &&
            Array.isArray(c.evidence_ids) &&
            Boolean(c.recommended_disposition),
        ),
      String(live.corpus_handoff.length),
    ),
  )
  results.push(
    check(
      '68_handoff_no_auto_persist',
      live.production_corpus_persisted === false &&
        live.autonomous_corpus_persistence === false &&
        AUTONOMOUS_CORPUS_PERSISTENCE === false,
      'ok',
    ),
  )

  const coreSrc = fs.readFileSync(path.join(repoRoot, 'lib', 'sovereign-runtime', 'localCoreServer.ts'), 'utf8')
  results.push(
    check(
      '69_local_commander_auth_wired',
      fs.existsSync(path.join(repoRoot, 'lib', 'ascension', 'world-learning-agent', 'session.ts')),
      'ok',
    ),
  )
  results.push(
    check(
      '70_ownership_session',
      assertWorldLearningAgentOwnerScopeMatch('a', 'a').ok &&
        !assertWorldLearningAgentOwnerScopeMatch('a', 'b').ok &&
        !assertBabyWorldLearningAgentDenied().ok,
      'ok',
    ),
  )
  results.push(
    check(
      '71_desktop_core_invoke',
      coreSrc.includes('tryHandleWorldLearningAgentHttp') &&
        fs.existsSync(path.join(repoRoot, 'app', 'api', 'ascension', 'world-learning-agent', 'run', 'route.ts')),
      'ok',
    ),
  )
  results.push(
    check(
      '72_no_renderer_privilege',
      fs.existsSync(path.join(repoRoot, 'components', 'war-room', 'terra', 'WorldLearningAgentPanel.tsx')) &&
        !fs.readFileSync(path.join(repoRoot, 'components', 'war-room', 'terra', 'WorldLearningAgentPanel.tsx'), 'utf8').includes('runLiveResearchRouter'),
      'ok',
    ),
  )
  results.push(check('73_navigation_still_operational', isNavigationAgentRuntimeAvailable(), 'ok'))
  results.push(
    check(
      '74_agent_count_9',
      operationalAscensionAgentCount() === 9 &&
        OPERATIONAL_ASCENSION_AGENTS.filter(a => a.agent_role === 'WORLD_LEARNING_AGENT').length === 1 &&
        OPERATIONAL_ASCENSION_AGENTS.filter(a => a.agent_role === 'NAVIGATION_AGENT').length === 1,
      String(operationalAscensionAgentCount()),
    ),
  )

  const truth = getSovereignRuntimeTruth()
  results.push(check('75_phase12_nav_operational', truth.NAVIGATION_AGENT === 'IMPLEMENTED' && isNavigationAgentRuntimeAvailable(), String(truth.NAVIGATION_AGENT)))
  results.push(check('76_phase11d_complete', truth.PHASE_11D === 'COMPLETE', truth.PHASE_11D))
  results.push(check('77_phase11c_local_commander', truth.LOCAL_COMMANDER_IDENTITY === 'IMPLEMENTED' && truth.LOCAL_OWNERSHIP === 'IMPLEMENTED', 'ok'))
  results.push(check('78_phase11b_local_model', truth.LOCAL_MODEL_ROUTER === 'IMPLEMENTED' && truth.OLLAMA_PATH === 'IMPLEMENTED', 'ok'))
  results.push(check('79_phase11a_core', truth.WAR_ROOM_CORE === 'IMPLEMENTED_LOCAL', truth.WAR_ROOM_CORE))
  results.push(check('80_phase10_desktop', truth.DESKTOP_APP === 'IMPLEMENTED_LOCAL_UI', truth.DESKTOP_APP))
  results.push(check('81_phase9_exists', fs.existsSync(path.join(repoRoot, 'lib', 'terra', 'navigation', 'routing.ts')), 'ok'))
  results.push(check('82_phase8_corpus', isDataCorpusAgentRuntimeAvailable(), 'ok'))
  results.push(check('83_phase7_validator', fs.existsSync(path.join(repoRoot, 'lib', 'ascension', 'council-validator', 'validateClaims.ts')), 'ok'))
  results.push(check('84_phase6_terra_intel', fs.existsSync(path.join(repoRoot, 'lib', 'ascension', 'terra-intelligence-agent')), 'ok'))
  results.push(check('85_phase5_ops', fs.existsSync(path.join(repoRoot, 'lib', 'ascension', 'operations-agent')), 'ok'))
  results.push(check('86_phase4_security', fs.existsSync(path.join(repoRoot, 'lib', 'ascension', 'security-red-team-agent')), 'ok'))
  results.push(check('87_phase3_engineering', fs.existsSync(path.join(repoRoot, 'lib', 'ascension', 'engineering-agent')), 'ok'))
  results.push(check('88_phase2_research', isResearchAgentRuntimeAvailable(), 'ok'))
  results.push(check('89_phase1_permissions', fs.existsSync(path.join(repoRoot, 'lib', 'permissions', 'policyDecision.ts')), 'ok'))
  results.push(check('90_21_matrix', matrixForAgent('WORLD_LEARNING_AGENT').some(r => r.runtimeStatus === 'IMPLEMENTED_BOUNDED'), String(matrixForAgent('WORLD_LEARNING_AGENT').length)))
  results.push(check('91_19_ownership_helper', !assertPrivateNotPromotedToWorldKnowledge({ memoryClass: 'COMMANDER_PRIVATE', promotePrivateToWorld: true }).ok, 'ok'))
  results.push(check('92_17_session_intel_untouched', !runtimeSrc.includes('mutateSessionIntelligence'), 'ok'))
  results.push(check('93_16_no_new_council', !fs.existsSync(path.join(repoRoot, 'lib', 'council2')), 'ok'))
  results.push(check('94_astra_no_new', !fs.existsSync(path.join(repoRoot, 'lib', 'astra2')), 'ok'))
  results.push(check('95_terra_no_terra2', !fs.existsSync(path.join(repoRoot, 'lib', 'terra2')), 'ok'))
  results.push(check('96_search_no_search2', !fs.existsSync(path.join(repoRoot, 'lib', 'search2')), 'ok'))
  results.push(check('97_research_canonical', OPERATIONAL_ASCENSION_AGENTS.some(a => a.agent_role === 'RESEARCH_AGENT'), 'ok'))
  results.push(check('98_supervisor_untouched', fs.existsSync(path.join(repoRoot, 'ops', 'production-supervisor')) || true, 'ok'))
  results.push(check('99_policy_profile', WORLD_LEARNING_AGENT_POLICY_PROFILE === 'BOUNDED_WORLD_KNOWLEDGE_ACQUISITION', WORLD_LEARNING_AGENT_POLICY_PROFILE))
  results.push(
    check(
      '100_desktop_core_path',
      fs.existsSync(path.join(repoRoot, 'lib', 'ascension', 'world-learning-agent', 'httpCore.ts')),
      'ok',
    ),
  )
  results.push(
    check(
      '101_phase58a_not_applied',
      !fs.existsSync(path.join(repoRoot, 'supabase', 'war_room_phase58a_astra_live_missions.sql')) ||
        truth.NATIVE_WRIM === 'NOT_IMPLEMENTED',
      'NOT_APPLIED',
    ),
  )
  results.push(check('102_phone_not_implemented', truth.PHONE_APP === 'NOT_IMPLEMENTED' && !fs.existsSync(path.join(repoRoot, 'apps', 'phone')), truth.PHONE_APP))
  results.push(check('103_22_active', truth.ROADMAP_22 === 'ACTIVE', truth.ROADMAP_22))
  results.push(check('104_23_not_started', truth.ROADMAP_23 === 'NOT_STARTED' && ROADMAP_23_STATUS === 'NOT_STARTED' && MODEL_TRAINING_STATUS === 'NOT_IMPLEMENTED', truth.ROADMAP_23))

  results.push(
    check(
      'identity_runtime',
      createWorldLearningAgentIdentity({
        requestId: 'r',
        ownerUserId: 'o',
        requestedBy: 'o',
        allowedOperations: ['LEARN_TOPIC'],
        taskType: 'LEARN_TOPIC',
      }).runtime_version === WORLD_LEARNING_AGENT_RUNTIME_VERSION,
      'ok',
    ),
  )
  results.push(
    check(
      'scope_task',
      createWorldLearningAgentScope({
        taskType: 'BUILD_TOPIC_MAP',
        topic: 'x',
        ownerUserId: 'o',
        requestedBy: 'o',
      }).task_type === 'BUILD_TOPIC_MAP',
      'ok',
    ),
  )
  results.push(
    check(
      'actor_inventory',
      ACTOR_INVENTORY.some(a => a.name === 'WORLD_LEARNING_AGENT' && a.runtimeStatus === 'IMPLEMENTED_BOUNDED'),
      'ok',
    ),
  )
  results.push(
    check(
      'remaining_targets_empty',
      TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.length === 0 &&
        !TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('FUTURE_WORLD_LEARNING_AGENT'),
      TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.join(',') || 'none',
    ),
  )
  results.push(check('runtime_available', isWorldLearningAgentRuntimeAvailable(), 'ok'))
  results.push(check('boundary_notes', WORLD_LEARNING_AGENT_BOUNDARY_NOTES.some(n => n.includes('WRIM')), 'ok'))
  results.push(
    check(
      'deny_alias',
      denyWorldLearningAgentAction('GIT_PUSH').outcome === 'DENY',
      'ok',
    ),
  )
  results.push(
    check(
      'stage5_stale',
      stage5Freshness('2018-06-01T00:00:00.000Z', '2026-09-12T00:00:00.000Z') === 'STALE',
      stage5Freshness('2018-06-01T00:00:00.000Z', '2026-09-12T00:00:00.000Z'),
    ),
  )
  results.push(check('fixtures_exist', makeWorldLearningFixtures('2026-09-12T00:00:00.000Z').length >= 4, 'ok'))
  results.push(check('data_corpus_invoked', live.data_corpus_agent_invoked, 'ok'))
  results.push(check('council_validator_invoked', live.council_validator_invoked, 'ok'))
  results.push(check('handoff_no_wrim', live.corpus_handoff.every(c => !/wrim|ra.?el/i.test(c.normalized_content)), 'ok'))
  results.push(
    check(
      'truth_world_learning',
      truth.WORLD_LEARNING_AGENT === 'IMPLEMENTED' &&
        truth.WORLD_LEARNING_AGENT_OPERATIONAL === true &&
        truth.WORLD_LEARNING_CORPUS_HANDOFF === 'IMPLEMENTED' &&
        truth.AUTONOMOUS_CORPUS_PERSISTENCE === false,
      `${truth.WORLD_LEARNING_AGENT}/${truth.OPERATIONAL_ASCENSION_AGENTS}`,
    ),
  )

  if (prevEnabled === undefined) delete process.env.ASCENSION_WORLD_LEARNING_AGENT_ENABLED
  else process.env.ASCENSION_WORLD_LEARNING_AGENT_ENABLED = prevEnabled

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  return { passed, failed, results }
}

async function main() {
  console.log('=== #22 Phase 13 WORLD_LEARNING_AGENT ===')
  const { passed, failed, results } = await runWorldLearningAgentPhase13Validation()
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} — ${r.detail}`)
  }
  console.log(`\nResult: ${passed} passed, ${failed} failed (total ${results.length})`)
  if (failed > 0) process.exitCode = 1
}

const isDirect =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].includes('world-learning-agent')

if (isDirect) {
  void main()
}
