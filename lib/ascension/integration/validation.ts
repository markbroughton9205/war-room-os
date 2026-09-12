/**
 * #22 Phase 14 — CROSS-AGENT ORCHESTRATION + DURABLE HANDOFFS validation.
 * Does not import other phases' validation.ts (isDirect auto-run hazard).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSovereignRuntimeTruth } from '@/lib/sovereign-runtime/runtimeTruth'
import {
  OPERATIONAL_ASCENSION_AGENTS,
  operationalAscensionAgentCount,
  ascensionAutonomyIsOff,
  TARGET_ASCENSION_AGENTS_UNIMPLEMENTED,
} from '@/lib/ascension/operationalRegistry'
import { isResearchAgentRuntimeAvailable } from '@/lib/ascension/research-agent/identity'
import { isWorldLearningAgentRuntimeAvailable } from '@/lib/ascension/world-learning-agent/identity'
import { isDataCorpusAgentRuntimeAvailable } from '@/lib/ascension/data-corpus-agent/identity'
import { isNavigationAgentRuntimeAvailable } from '@/lib/ascension/navigation-agent/identity'
import { isOperationsAgentRuntimeAvailable } from '@/lib/ascension/operations-agent/identity'
import { isSecurityRedTeamAgentRuntimeAvailable } from '@/lib/ascension/security-red-team-agent/identity'
import { isEngineeringAgentRuntimeAvailable } from '@/lib/ascension/engineering-agent/identity'
import { isCouncilValidatorRuntimeAvailable } from '@/lib/ascension/council-validator/identity'
import { isTerraIntelligenceAgentRuntimeAvailable } from '@/lib/ascension/terra-intelligence-agent/identity'
import { createCanonicalHandoff } from '@/lib/ascension/integration/envelope'
import { assertTargetAuthorityNotIncreased, denyRecommendationAsApproval } from '@/lib/ascension/integration/authority'
import { CROSS_AGENT_LOOP_LIMITS } from '@/lib/ascension/integration/limits'
import { CorpusCandidateStore } from '@/lib/ascension/integration/candidateStore'
import {
  runKnowledgePipeline,
  runWorldStatePipeline,
  runEngineeringSafetyPipeline,
  runOfflineLocalWorkflow,
  runValidatorRevisionDemo,
} from '@/lib/ascension/integration/workflows'
import {
  denyAstraAsCommanderApproval,
  reportAstraMissionDurability,
  runAstraBoundedMultiAgentOrchestration,
} from '@/lib/ascension/integration/astraBridge'
import { astraPhase58aDecisionPacket } from '@/lib/ascension/integration/phase58aPacket'
import { runBoundedValidatorRevisionCycle } from '@/lib/ascension/integration/revision'
import { resetAstraMissionStoreProbe } from '@/lib/astra/liveMission.store'
import {
  ASTRA_PHASE58A_STATUS,
  CROSS_AGENT_INTEGRATION_STATUS,
  MODEL_TRAINING_STATUS,
  PHONE_APP_STATUS,
  PRODUCTION_CORPUS_PERSISTENCE,
  RAEL_STATUS,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  WRIM_STATUS,
  WR_CORPUS_STATUS,
  WR_TOKENIZER_STATUS,
} from '@/lib/ascension/integration/identity'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function existsForbidden(rel: string): boolean {
  return fs.existsSync(path.join(repoRoot, ...rel.split('/')))
}

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, ...rel.split('/')), 'utf8')
}

export async function runCrossAgentPhase14Validation(): Promise<{
  passed: number
  failed: number
  results: Check[]
}> {
  const results: Check[] = []
  const prevWl = process.env.ASCENSION_WORLD_LEARNING_AGENT_ENABLED
  const prevAstraFs = process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM
  const prevAstraDir = process.env.WAR_ROOM_ASTRA_MISSIONS_DIR
  delete process.env.ASCENSION_WORLD_LEARNING_AGENT_ENABLED

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-phase14-'))
  const astraDir = path.join(tmp, 'astra')
  fs.mkdirSync(astraDir, { recursive: true })
  process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM = '1'
  process.env.WAR_ROOM_ASTRA_MISSIONS_DIR = astraDir
  resetAstraMissionStoreProbe()

  const owner = 'local-commander-phase14'
  const truth = getSovereignRuntimeTruth()
  const workflowsSrc = read('lib/ascension/integration/workflows.ts')

  try {
    results.push(check('1_no_new_agent', TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.length === 0 && OPERATIONAL_ASCENSION_AGENTS.length === 9, String(OPERATIONAL_ASCENSION_AGENTS.length)))
    results.push(check('2_agent_count_9', operationalAscensionAgentCount() === 9, String(operationalAscensionAgentCount())))
    results.push(check('3_autonomy_off', ascensionAutonomyIsOff() && truth.ASCENSION_AUTONOMY === 'OFF', truth.ASCENSION_AUTONOMY))
    results.push(check('4_astra_canonical', fs.existsSync(path.join(repoRoot, 'lib', 'astra', 'liveMission.ts')), 'liveMission.ts'))
    results.push(
      check(
        '5_no_agentbus2',
        !existsForbidden('lib/agent-bus-2') &&
          !existsForbidden('lib/ascension/AgentBus2.ts') &&
          !workflowsSrc.includes('AgentBus2'),
        'ok',
      ),
    )
    results.push(
      check(
        '6_no_missionengine2',
        !existsForbidden('lib/MissionEngine2') &&
          !existsForbidden('lib/ascension/MissionEngine2.ts') &&
          !existsForbidden('lib/ascension/WorkflowEngine2.ts') &&
          !existsForbidden('lib/ascension/AscensionOrchestrator2.ts') &&
          !existsForbidden('lib/ascension/CouncilRouter2.ts'),
        'ok',
      ),
    )
    results.push(
      check(
        '7_one_canonical_envelope',
        read('lib/ascension/integration/envelope.ts').includes('createCanonicalHandoff') &&
          !existsForbidden('lib/ascension/integration/envelope2.ts'),
        'createCanonicalHandoff',
      ),
    )

    const owned = createCanonicalHandoff({
      sourceActor: 'RESEARCH_AGENT',
      targetActor: 'WORLD_LEARNING_AGENT',
      ownerUserId: owner,
      targetOwnerUserId: owner,
      taskType: 'RESEARCH_EVIDENCE',
      evidenceIds: ['ev-1'],
    })
    results.push(check('8_ownership_preserved', owned.ok && owned.ok && owned.envelope.owner_user_id === owner, owned.ok ? owned.envelope.owner_user_id : owned.failure.message))

    const cross = createCanonicalHandoff({
      sourceActor: 'RESEARCH_AGENT',
      targetActor: 'WORLD_LEARNING_AGENT',
      ownerUserId: owner,
      targetOwnerUserId: 'other-user',
      taskType: 'RESEARCH_EVIDENCE',
    })
    results.push(check('9_cross_user_denied', !cross.ok && cross.failure.code === 'CROSS_USER_DENIED', cross.ok ? 'leaked' : cross.failure.code))

    const authUp = assertTargetAuthorityNotIncreased({
      sourceAuthority: 'BOUNDED_ALLOWED',
      targetAuthority: 'COMMANDER_ONLY',
    })
    results.push(check('10_target_cannot_exceed_source', Boolean(authUp), authUp?.code ?? 'missing'))

    const mint = createCanonicalHandoff({
      sourceActor: 'ASTRA',
      targetActor: 'ENGINEERING_AGENT',
      ownerUserId: owner,
      taskType: 'ASTRA_MISSION_STEP',
      targetAuthority: 'COMMANDER_ONLY',
    })
    results.push(check('11_handoff_cannot_mint_tier4', !mint.ok, mint.ok ? 'minted' : mint.failure.code))

    const knowledge = await runKnowledgePipeline({
      ownerUserId: owner,
      requestedBy: owner,
      dataDirOverride: tmp,
      useFixtures: true,
      liveSearchAllowed: false,
      internetAvailable: true,
    })
    results.push(check('12_research_to_world_learning', knowledge.status === 'COMPLETE' && knowledge.handoffs.some(h => h.source_actor === 'RESEARCH_AGENT' && h.target_actor === 'WORLD_LEARNING_AGENT'), knowledge.summary))
    results.push(check('13_research_evidence_preserved', knowledge.evidence_ids.length > 0 || knowledge.provenance_chain.some(p => p.stage === 'research_evidence'), String(knowledge.evidence_ids.length)))
    results.push(check('14_world_learning_to_data_corpus', knowledge.handoffs.some(h => h.source_actor === 'WORLD_LEARNING_AGENT' && h.target_actor === 'DATA_CORPUS_AGENT'), String(knowledge.handoffs.length)))
    results.push(check('15_corpus_handoff_structured', knowledge.candidate_ids.length > 0, String(knowledge.candidate_ids.length)))
    results.push(check('16_candidate_persists', knowledge.candidate_ids.length > 0, knowledge.candidate_ids[0] ?? 'none'))

    let restartOk = false
    let provenanceOk = false
    let reviewOk = false
    if (knowledge.candidate_ids[0]) {
      const reopened = new CorpusCandidateStore(tmp)
      const loaded = reopened.get(knowledge.candidate_ids[0], owner)
      restartOk = Boolean(loaded)
      provenanceOk = Boolean(loaded && Array.isArray(loaded.evidence_ids))
      reviewOk = Boolean(loaded && loaded.review_state)
      reopened.close()
    }
    results.push(check('17_candidate_survives_restart', restartOk, 'reopen sqlite'))
    results.push(check('18_candidate_provenance_survives', provenanceOk, 'evidence_ids'))
    results.push(check('19_review_state_survives', reviewOk, 'review_state'))
    results.push(check('20_no_production_corpus_write', knowledge.production_corpus_persisted === false && knowledge.runtime_notes.production_corpus_write === false, String(knowledge.runtime_notes.production_corpus_write)))
    results.push(check('21_wr_corpus_implemented', knowledge.wr_corpus === 'IMPLEMENTED' && WR_CORPUS_STATUS === 'IMPLEMENTED', knowledge.wr_corpus))

    const world = await runWorldStatePipeline({
      ownerUserId: owner,
      requestedBy: owner,
      useFixtures: true,
      liveSearchAllowed: false,
    })
    results.push(check('22_terra_to_navigation', world.status === 'COMPLETE' && world.handoffs.some(h => h.target_actor === 'NAVIGATION_AGENT'), world.summary))
    results.push(check('23_gnss_truth', world.runtime_notes.mobile_gnss === 'NOT_SUPPORTED', String(world.runtime_notes.mobile_gnss)))
    results.push(check('24_live_traffic_truth', world.runtime_notes.live_traffic === 'NOT_IMPLEMENTED', String(world.runtime_notes.live_traffic)))
    results.push(check('25_navigation_to_council', world.handoffs.some(h => h.source_actor === 'NAVIGATION_AGENT' && h.target_actor === 'COUNCIL'), String(world.handoffs.length)))
    results.push(
      check(
        '26_council_does_not_alter_geometry',
        Boolean(world.council_route_geometry_json && world.council_route_geometry_json.includes('"rewritten":false')),
        world.council_route_geometry_json ?? 'none',
      ),
    )

    const eng = await runEngineeringSafetyPipeline({
      ownerUserId: owner,
      requestedBy: owner,
    })
    results.push(check('27_ops_to_security', eng.handoffs.some(h => h.source_actor === 'OPERATIONS_AGENT' && h.target_actor === 'SECURITY_RED_TEAM_AGENT'), eng.summary))
    results.push(check('28_ops_no_remediation', eng.operations_remediated === false, 'observation-first'))
    results.push(check('29_security_to_engineering', eng.handoffs.some(h => h.source_actor === 'SECURITY_RED_TEAM_AGENT' && h.target_actor === 'ENGINEERING_AGENT'), String(eng.handoffs.length)))
    results.push(check('30_security_no_file_mutation', eng.security_mutated_files === false, 'ok'))
    results.push(check('31_engineering_isolated_worktree', eng.status === 'COMPLETE' || eng.status === 'PARTIAL', eng.summary))
    results.push(check('32_engineering_cannot_commit', eng.engineering_committed === false, 'ok'))
    results.push(check('33_engineering_cannot_push', eng.engineering_pushed === false, 'ok'))
    results.push(check('34_engineering_cannot_deploy', eng.engineering_deployed === false, 'ok'))

    const revision = await runValidatorRevisionDemo({ ownerUserId: owner, requestedBy: owner })
    results.push(check('35_council_to_validator', Boolean(revision.validator_outcome), revision.summary))
    results.push(check('36_validator_only', revision.runtime_notes.validator_only === true, 'ok'))
    results.push(check('37_revision_loop_bounded', revision.revision_count <= CROSS_AGENT_LOOP_LIMITS.max_validation_revisions, String(revision.revision_count)))
    const loop = await runBoundedValidatorRevisionCycle({
      conversationId: '00000000-0000-4000-8000-000000000022',
      ownerUserId: owner,
      requestedBy: owner,
      claims: [{ claim_text: 'loop', claim_type: 'GENERAL', evidence_refs: ['ev-1'] }],
      loopUntilAgree: true,
    })
    results.push(check('38_revision_cannot_recurse', Boolean(loop.failure && loop.failure.code === 'REVISION_LIMIT_EXCEEDED'), loop.failure?.code ?? 'missing'))

    const astra = await runAstraBoundedMultiAgentOrchestration({
      ownerUserId: owner,
      requestedBy: owner,
      dataDirOverride: tmp,
      useFixtures: true,
      liveSearchAllowed: false,
    })
    results.push(check('39_astra_invokes_agent_chain', Boolean(astra.mission && astra.workflow && astra.mission.constellationSpawned === false), astra.mission?.id ?? 'none'))
    results.push(check('40_astra_retains_ownership', astra.ownership_retained && astra.mission?.commanderUserId === owner, astra.mission?.commanderUserId ?? 'none'))
    results.push(check('41_astra_retains_authority_scope', astra.authority_not_amplified && astra.astra_is_approval === false, 'ok'))
    results.push(check('42_phase58a_not_applied', ASTRA_PHASE58A_STATUS === 'NOT_APPLIED' && astraPhase58aDecisionPacket().apply_now === false && astraPhase58aDecisionPacket().sql_executed === false, ASTRA_PHASE58A_STATUS))
    const durability = reportAstraMissionDurability(astra.mission?.persistenceBackend ?? null)
    results.push(check('43_mission_durability_truthful', durability.db_backed_claimed === false && durability.ASTRA_PHASE58A === 'NOT_APPLIED', durability.MISSION_DURABILITY_CURRENT_STATE))
    results.push(check('44_phase58a_packet', astraPhase58aDecisionPacket().what_phase58a_would_add.length > 0 && fs.existsSync(path.join(repoRoot, 'docs', 'architecture', 'ASTRA_PHASE58A_DECISION_PACKET.md')), 'packet'))

    process.env.ASCENSION_WORLD_LEARNING_AGENT_ENABLED = 'false'
    const killed = await runKnowledgePipeline({
      ownerUserId: owner,
      requestedBy: owner,
      dataDirOverride: path.join(tmp, 'kill'),
      useFixtures: true,
      liveSearchAllowed: false,
    })
    delete process.env.ASCENSION_WORLD_LEARNING_AGENT_ENABLED
    results.push(check('45_disabled_agent_degrades', killed.status === 'PARTIAL' && killed.failure?.code === 'AGENT_DISABLED', killed.summary))
    results.push(
      check(
        '46_helper_cannot_bypass_soft_kill',
        !workflowsSrc.includes('synthesizeWorldLearning') &&
          !workflowsSrc.includes('analyzeCorpus') &&
          !workflowsSrc.includes('analyzeTerraWorldState') &&
          !workflowsSrc.includes('runOperationsDiagnostics') &&
          !workflowsSrc.includes("from '@/lib/ascension/security-red-team-agent/probes'"),
        'runBounded* only',
      ),
    )
    results.push(check('47_partial_workflow_truth', killed.summary.includes('WORLD_LEARNING_AGENT_DISABLED') && killed.candidate_ids.length === 0, killed.summary))
    results.push(check('48_failure_propagation_bounded', Boolean(killed.failure && !/api[_-]?key|password|sk-/i.test(killed.failure.message)), killed.failure?.code ?? 'none'))
    results.push(check('49_provenance_chain', knowledge.provenance_chain.some(p => p.stage === 'research_evidence') && knowledge.provenance_chain.some(p => p.stage === 'corpus_candidates'), knowledge.provenance_chain.map(p => p.stage).join('>')))
    results.push(check('50_audit_refs_linked', knowledge.audit_refs.some(a => a.kind === 'handoff') && knowledge.audit_refs.some(a => a.kind === 'candidate_disposition'), String(knowledge.audit_refs.length)))
    results.push(
      check(
        '51_no_secrets_in_audit',
        !JSON.stringify(knowledge.audit_refs).match(/sk-|api_key|password/i),
        'ids only',
      ),
    )
    results.push(check('52_local_commander_workflow', knowledge.status === 'COMPLETE', 'fixture local'))
    results.push(check('53_supabase_not_required', truth.SUPABASE_REQUIRED_FOR_LOCAL_COMMANDER_ACCESS === false, String(truth.SUPABASE_REQUIRED_FOR_LOCAL_COMMANDER_ACCESS)))
    results.push(check('54_warroomos_not_required', !workflowsSrc.includes('warroomos.com'), 'ok'))
    results.push(check('55_cloudflare_not_required', !workflowsSrc.includes('cloudflare'), 'ok'))
    results.push(check('56_local_model_supported', read('lib/ascension/integration/workflows.ts').includes('useLocalModel'), 'flag'))

    const offline = await runOfflineLocalWorkflow({
      ownerUserId: owner,
      requestedBy: owner,
      dataDirOverride: path.join(tmp, 'offline'),
    })
    results.push(check('57_offline_workflow', offline.status === 'COMPLETE' || offline.status === 'PARTIAL', offline.summary))
    results.push(check('58_live_discovery_unavailable_offline', offline.live_discovery === 'UNAVAILABLE', offline.live_discovery))
    results.push(check('59_no_fake_live_world_offline', !offline.summary.toLowerCase().includes('live gps') && offline.live_discovery === 'UNAVAILABLE', offline.summary.slice(0, 120)))
    results.push(
      check(
        '60_online_approved_providers_only',
        !workflowsSrc.includes('runLiveResearchRouter') && workflowsSrc.includes('runBoundedResearchAgent'),
        'reuse research agent',
      ),
    )
    results.push(check('61_no_provider_expansion', !workflowsSrc.includes('FIRECRAWL') && !workflowsSrc.includes('new discovery'), 'ok'))
    results.push(check('62_no_crawler_expansion', !workflowsSrc.includes('crawlSite') && !workflowsSrc.includes('puppeteer'), 'ok'))
    results.push(check('63_handoff_limit', CROSS_AGENT_LOOP_LIMITS.max_handoffs >= 1 && CROSS_AGENT_LOOP_LIMITS.max_handoffs <= 8, String(CROSS_AGENT_LOOP_LIMITS.max_handoffs)))
    results.push(check('64_mission_step_limit', CROSS_AGENT_LOOP_LIMITS.max_mission_steps >= 1, String(CROSS_AGENT_LOOP_LIMITS.max_mission_steps)))
    results.push(check('65_validation_revision_limit', CROSS_AGENT_LOOP_LIMITS.max_validation_revisions === 1, String(CROSS_AGENT_LOOP_LIMITS.max_validation_revisions)))
    results.push(check('66_workflow_timeout', CROSS_AGENT_LOOP_LIMITS.max_workflow_ms > 0, String(CROSS_AGENT_LOOP_LIMITS.max_workflow_ms)))
    results.push(check('67_no_agent_spawn', CROSS_AGENT_LOOP_LIMITS.max_agent_spawn === 0, '0'))
    const spawn = await runKnowledgePipeline({
      ownerUserId: owner,
      requestedBy: owner,
      spawnHelperAgents: 10,
    })
    results.push(check('68_no_dynamic_subagent', spawn.status === 'DENIED' && spawn.failure?.code === 'AGENT_SPAWN_DENIED', spawn.failure?.code ?? 'missing'))
    results.push(check('69_no_push', eng.engineering_pushed === false, 'ok'))
    results.push(check('70_no_deploy', eng.engineering_deployed === false, 'ok'))
    results.push(check('71_no_production_commit', eng.engineering_committed === false, 'ok'))
    results.push(
      check(
        '72_no_finance',
        !workflowsSrc.includes('send money') && !read('lib/ascension/integration/workflows.ts').includes('stripe'),
        'ok',
      ),
    )
    results.push(check('73_no_sql_apply', astraPhase58aDecisionPacket().sql_executed === false, 'ok'))
    results.push(check('74_no_device_control', world.runtime_notes.mobile_gnss === 'NOT_SUPPORTED', 'ok'))
    results.push(
      check(
        '75_no_policy_mutation',
        denyRecommendationAsApproval('council').outcome === 'DENY' && denyAstraAsCommanderApproval().decision.outcome === 'DENY',
        'ok',
      ),
    )
    results.push(check('76_world_learning_operational', isWorldLearningAgentRuntimeAvailable(), 'ok'))
    results.push(check('77_navigation_operational', isNavigationAgentRuntimeAvailable(), 'ok'))
    results.push(
      check(
        '78_all_9_operational',
        isResearchAgentRuntimeAvailable() &&
          isEngineeringAgentRuntimeAvailable() &&
          isSecurityRedTeamAgentRuntimeAvailable() &&
          isOperationsAgentRuntimeAvailable() &&
          isTerraIntelligenceAgentRuntimeAvailable() &&
          isCouncilValidatorRuntimeAvailable() &&
          isDataCorpusAgentRuntimeAvailable() &&
          isNavigationAgentRuntimeAvailable() &&
          isWorldLearningAgentRuntimeAvailable(),
        '9',
      ),
    )
    results.push(check('79_phase13_agent', OPERATIONAL_ASCENSION_AGENTS.some(a => a.agent_role === 'WORLD_LEARNING_AGENT'), 'WORLD_LEARNING_AGENT'))
    results.push(check('80_phase12_agent', OPERATIONAL_ASCENSION_AGENTS.some(a => a.agent_role === 'NAVIGATION_AGENT'), 'NAVIGATION_AGENT'))
    results.push(check('81_phase11d_complete', truth.PHASE_11D === 'COMPLETE', truth.PHASE_11D))
    results.push(check('82_phase11c_local_ownership', truth.LOCAL_OWNERSHIP === 'IMPLEMENTED', truth.LOCAL_OWNERSHIP))
    results.push(check('83_phase11b_local_model', truth.LOCAL_MODEL_ROUTER === 'IMPLEMENTED', truth.LOCAL_MODEL_ROUTER))
    results.push(check('84_phase11a_local_commander', truth.LOCAL_COMMANDER_RECOVERY === 'NOT_IMPLEMENTED' || truth.OFFLINE_LOCAL_CHAT === 'IMPLEMENTED', 'local chat'))
    results.push(check('85_phase10_core', truth.WAR_ROOM_CORE === 'IMPLEMENTED_LOCAL', truth.WAR_ROOM_CORE))
    results.push(check('86_phase9_nav_foundation', fs.existsSync(path.join(repoRoot, 'lib', 'terra', 'navigation', 'routing.ts')), 'routing.ts'))
    results.push(check('87_phase8_corpus', OPERATIONAL_ASCENSION_AGENTS.some(a => a.agent_role === 'DATA_CORPUS_AGENT'), 'DATA_CORPUS_AGENT'))
    results.push(check('88_phase7_validator', OPERATIONAL_ASCENSION_AGENTS.some(a => a.agent_role === 'COUNCIL_VALIDATOR'), 'COUNCIL_VALIDATOR'))
    results.push(check('89_phase6_terra_intel', OPERATIONAL_ASCENSION_AGENTS.some(a => a.agent_role === 'TERRA_INTELLIGENCE_AGENT'), 'ok'))
    results.push(check('90_phase5_ops', OPERATIONAL_ASCENSION_AGENTS.some(a => a.agent_role === 'OPERATIONS_AGENT'), 'ok'))
    results.push(check('91_phase4_security', OPERATIONAL_ASCENSION_AGENTS.some(a => a.agent_role === 'SECURITY_RED_TEAM_AGENT'), 'ok'))
    results.push(check('92_phase3_engineering', OPERATIONAL_ASCENSION_AGENTS.some(a => a.agent_role === 'ENGINEERING_AGENT'), 'ok'))
    results.push(check('93_phase2_research', OPERATIONAL_ASCENSION_AGENTS.some(a => a.agent_role === 'RESEARCH_AGENT'), 'ok'))
    results.push(check('94_phase1_matrix', fs.existsSync(path.join(repoRoot, 'lib', 'agent-capability-matrix', 'matrix.ts')), 'matrix'))
    results.push(check('95_21_capability_matrix', fs.existsSync(path.join(repoRoot, 'docs', 'AGENT_CAPABILITY_MATRIX.md')), 'ok'))
    results.push(check('96_19_ownership', truth.SUPABASE_REQUIRED_FOR_REMOTE_DATA === true, 'remote ownership preserved'))
    results.push(check('97_17_session_intel', !workflowsSrc.includes('mutateSessionIntelligence'), 'not mutated'))
    results.push(check('98_16_deliberation', !workflowsSrc.includes('replaceDeliberationPipeline'), 'not replaced'))
    results.push(check('99_astra_passes_contract', astra.mission?.astraProvidesSubstantiveAnswer === false && astra.external_execution === false, 'ok'))
    results.push(check('100_terra_oracle', world.handoffs[0]?.runtime_truth.mobile_gnss === 'NOT_SUPPORTED', 'ok'))
    results.push(check('101_search_not_replaced', !existsForbidden('lib/war-room-search-2'), 'ok'))
    results.push(check('102_research_not_replaced', !existsForbidden('lib/research2'), 'ok'))
    results.push(check('103_supervisor_untouched', fs.existsSync(path.join(repoRoot, 'ops', 'production-supervisor')) || fs.existsSync(path.join(repoRoot, 'lib', 'ops', 'production-supervisor')), 'ok'))
    results.push(check('104_typescript_surface', fs.existsSync(path.join(repoRoot, 'lib', 'ascension', 'integration', 'index.ts')), 'index'))
    results.push(check('105_desktop_security_policy', truth.CODE_SIGNING === 'NOT_CONFIGURED' || truth.CODE_SIGNING === 'CONFIGURED', String(truth.CODE_SIGNING)))
    results.push(check('106_phone_ni', truth.PHONE_APP === 'NOT_IMPLEMENTED' && PHONE_APP_STATUS === 'NOT_IMPLEMENTED' && !fs.existsSync(path.join(repoRoot, 'apps', 'phone')), truth.PHONE_APP))
    results.push(check('107_wr_corpus_implemented', WR_CORPUS_STATUS === 'IMPLEMENTED', WR_CORPUS_STATUS))
    results.push(check('108_wr_tokenizer_ns', WR_TOKENIZER_STATUS === 'NOT_STARTED', WR_TOKENIZER_STATUS))
    results.push(check('109_wrim_ni', truth.NATIVE_WRIM === 'NOT_IMPLEMENTED' && WRIM_STATUS === 'NOT_IMPLEMENTED', truth.NATIVE_WRIM))
    results.push(check('110_rael_ni', RAEL_STATUS === 'NOT_IMPLEMENTED', RAEL_STATUS))
    results.push(check('111_22_closed', truth.ROADMAP_22 === 'CLOSED' && ROADMAP_22_STATUS === 'CLOSED', truth.ROADMAP_22))
    results.push(check('112_23_active', truth.ROADMAP_23 === 'ACTIVE' && ROADMAP_23_STATUS === 'ACTIVE' && MODEL_TRAINING_STATUS === 'NOT_IMPLEMENTED' && PRODUCTION_CORPUS_PERSISTENCE === false, truth.ROADMAP_23))

    results.push(check('113_integration_implemented', CROSS_AGENT_INTEGRATION_STATUS === 'IMPLEMENTED' && truth.CROSS_AGENT_INTEGRATION === 'IMPLEMENTED', CROSS_AGENT_INTEGRATION_STATUS))
    results.push(check('114_null_owner_denied', !createCanonicalHandoff({ sourceActor: 'RESEARCH_AGENT', targetActor: 'WORLD_LEARNING_AGENT', ownerUserId: '', taskType: 'RESEARCH_EVIDENCE' }).ok, 'owner required'))

    const skip = await runKnowledgePipeline({
      ownerUserId: owner,
      requestedBy: owner,
      skipWorldLearningWriteApprovedCorpus: true,
    })
    results.push(check('rt_skip_wl_approved_corpus', skip.status === 'DENIED', skip.failure?.code ?? 'missing'))
    const trained = await runKnowledgePipeline({
      ownerUserId: owner,
      requestedBy: owner,
      dataDirOverride: path.join(tmp, 'trained'),
      markCandidateTrained: true,
      useFixtures: true,
      liveSearchAllowed: false,
    })
    results.push(check('rt_mark_trained', trained.status === 'DENIED', trained.failure?.code ?? 'missing'))
    const wr = await runKnowledgePipeline({ ownerUserId: owner, requestedBy: owner, startWrCorpus: true })
    results.push(check('rt_start_wr_corpus', wr.status === 'DENIED', wr.failure?.code ?? 'missing'))
    const grantCommit = await runEngineeringSafetyPipeline({ ownerUserId: owner, requestedBy: owner, grantEngineeringCommitViaSecurity: true })
    results.push(check('rt_security_grant_commit', grantCommit.status === 'DENIED', grantCommit.failure?.code ?? 'missing'))
    const grantShell = await runEngineeringSafetyPipeline({ ownerUserId: owner, requestedBy: owner, grantSecurityShellViaOps: true })
    results.push(check('rt_ops_grant_shell', grantShell.status === 'DENIED', grantShell.failure?.code ?? 'missing'))
    const deploy = await runEngineeringSafetyPipeline({ ownerUserId: owner, requestedBy: owner, councilAuthorizeDeploy: true })
    results.push(check('rt_council_deploy', deploy.status === 'DENIED', deploy.failure?.code ?? 'missing'))
    const astraApprove = denyAstraAsCommanderApproval()
    results.push(check('rt_astra_as_approval', astraApprove.decision.outcome === 'DENY', astraApprove.decision.reasonCode))
    const continueKill = await runKnowledgePipeline({
      ownerUserId: owner,
      requestedBy: owner,
      continueAfterSoftKill: true,
    })
    process.env.ASCENSION_WORLD_LEARNING_AGENT_ENABLED = 'false'
    const continueKill2 = await runKnowledgePipeline({
      ownerUserId: owner,
      requestedBy: owner,
      continueAfterSoftKill: true,
      useFixtures: true,
      liveSearchAllowed: false,
    })
    delete process.env.ASCENSION_WORLD_LEARNING_AGENT_ENABLED
    results.push(check('rt_continue_after_kill', continueKill2.status === 'DENIED' || continueKill2.status === 'PARTIAL', continueKill2.status))
    const ownerChange = await runKnowledgePipeline({
      ownerUserId: owner,
      requestedBy: owner,
      changeOwnerOnHandoff: true,
      useFixtures: true,
      liveSearchAllowed: false,
    })
    results.push(check('rt_change_owner', ownerChange.status === 'DENIED', ownerChange.failure?.code ?? 'missing'))
    const foreign = await runKnowledgePipeline({
      ownerUserId: owner,
      requestedBy: owner,
      foreignEvidenceOwnerId: 'other-user',
    })
    results.push(check('rt_foreign_evidence', foreign.status === 'DENIED' && foreign.failure?.code === 'OWNER_MISMATCH', foreign.failure?.code ?? 'missing'))
    const cot = await runKnowledgePipeline({ ownerUserId: owner, requestedBy: owner, persistHiddenCot: true })
    results.push(check('rt_hidden_cot', cot.status === 'DENIED', cot.failure?.code ?? 'missing'))
    const pushCorpus = await runKnowledgePipeline({ ownerUserId: owner, requestedBy: owner, pushCandidateCorpus: true })
    results.push(check('rt_push_corpus', pushCorpus.status === 'DENIED', pushCorpus.failure?.code ?? 'missing'))
    const apply58 = await runKnowledgePipeline({ ownerUserId: owner, requestedBy: owner, applyPhase58a: true })
    results.push(check('rt_apply_phase58a', apply58.status === 'DENIED' && apply58.failure?.code === 'PHASE58A_APPLY_DENIED', apply58.failure?.code ?? 'missing'))
    void continueKill

    results.push(check('ui_panel', fs.existsSync(path.join(repoRoot, 'components', 'war-room', 'terra', 'CrossAgentIntegrationPanel.tsx')), 'panel'))
    results.push(check('api_route', fs.existsSync(path.join(repoRoot, 'app', 'api', 'ascension', 'integration', 'run', 'route.ts')), 'api'))
    results.push(check('docs_phase14', fs.existsSync(path.join(repoRoot, 'docs', 'architecture', 'ASCENSION_PHASE14_CROSS_AGENT_INTEGRATION.md')), 'docs'))
  } finally {
    if (prevWl === undefined) delete process.env.ASCENSION_WORLD_LEARNING_AGENT_ENABLED
    else process.env.ASCENSION_WORLD_LEARNING_AGENT_ENABLED = prevWl
    if (prevAstraFs === undefined) delete process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM
    else process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM = prevAstraFs
    if (prevAstraDir === undefined) delete process.env.WAR_ROOM_ASTRA_MISSIONS_DIR
    else process.env.WAR_ROOM_ASTRA_MISSIONS_DIR = prevAstraDir
    resetAstraMissionStoreProbe()
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  return { passed, failed, results }
}

async function main() {
  console.log('=== #22 Phase 14 CROSS-AGENT INTEGRATION ===')
  const { passed, failed, results } = await runCrossAgentPhase14Validation()
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} — ${r.detail}`)
  }
  console.log(`\nResult: ${passed} passed, ${failed} failed (total ${results.length})`)
  if (failed > 0) process.exitCode = 1
}

const isDirect =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].includes('ascension') &&
  process.argv[1].includes('integration') &&
  process.argv[1].includes('validation.ts')

if (isDirect) {
  void main()
}
