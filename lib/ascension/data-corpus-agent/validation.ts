/**
 * #22 Phase 8 — DATA_CORPUS_AGENT deterministic validation + live-safe proof.
 */
import {
  DATA_CORPUS_AGENT_ROLE,
  DATA_CORPUS_AGENT_RUNTIME_VERSION,
  DATA_CORPUS_AGENT_POLICY_PROFILE,
  DATA_CORPUS_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
  ROADMAP_23_STATUS,
  createDataCorpusAgentIdentity,
  isDataCorpusAgentRuntimeAvailable,
} from '@/lib/ascension/data-corpus-agent/identity'
import {
  DATA_CORPUS_ALLOWED_OPERATIONS,
  DATA_CORPUS_DENIED_ALIASES,
  denyDataCorpusAgentAction,
  assertDataCorpusAgentCannotSelfApprove,
  isAllowedDataCorpusOperation,
} from '@/lib/ascension/data-corpus-agent/profile'
import {
  createDataCorpusScope,
  DATA_CORPUS_DEFAULT_BOUNDS,
} from '@/lib/ascension/data-corpus-agent/scope'
import { DATA_CORPUS_BOUNDARY_NOTES } from '@/lib/ascension/data-corpus-agent/result'
import { runBoundedDataCorpusAgent } from '@/lib/ascension/data-corpus-agent/runtime'
import {
  assertBabyDataCorpusDenied,
  assertDataCorpusOwnerScopeMatch,
  assertPrivateNotPromotedToShared,
} from '@/lib/ascension/data-corpus-agent/ownership'
import { makeDataCorpusFixtures } from '@/lib/ascension/data-corpus-agent/analyze'
import {
  OPERATIONAL_ASCENSION_AGENTS,
  operationalAscensionAgentCount,
  ascensionAutonomyIsOff,
  TARGET_ASCENSION_AGENTS_UNIMPLEMENTED,
} from '@/lib/ascension/operationalRegistry'
import { ACTOR_INVENTORY } from '@/lib/agent-capability-matrix/actors'
import { matrixForAgent } from '@/lib/agent-capability-matrix/matrix'
import { isResearchAgentRuntimeAvailable } from '@/lib/ascension/research-agent/identity'
import { isEngineeringAgentRuntimeAvailable } from '@/lib/ascension/engineering-agent/identity'
import { isSecurityRedTeamAgentRuntimeAvailable } from '@/lib/ascension/security-red-team-agent/identity'
import { isOperationsAgentRuntimeAvailable } from '@/lib/ascension/operations-agent/identity'
import { isTerraIntelligenceAgentRuntimeAvailable } from '@/lib/ascension/terra-intelligence-agent/identity'
import { isCouncilValidatorRuntimeAvailable } from '@/lib/ascension/council-validator/identity'
import { CHUNKING_VERSION, LOCAL_EMBEDDING_MODEL_ID } from '@/lib/war-room-search/hybrid/types'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

export async function runDataCorpusAgentPhase8Validation(): Promise<{
  passed: number
  failed: number
  results: Check[]
}> {
  const results: Check[] = []

  results.push(check('1_canonical_actor', DATA_CORPUS_AGENT_ROLE === 'DATA_CORPUS_AGENT', DATA_CORPUS_AGENT_ROLE))
  results.push(
    check(
      '2_status_implemented_bounded',
      OPERATIONAL_ASCENSION_AGENTS.some(
        a => a.agent_role === 'DATA_CORPUS_AGENT' && a.runtime_status === 'IMPLEMENTED_BOUNDED',
      ),
      'IMPLEMENTED_BOUNDED',
    ),
  )
  results.push(check('3_corpus_read', isAllowedDataCorpusOperation('CORPUS_READ'), 'ok'))
  results.push(check('4_index_metadata_read', isAllowedDataCorpusOperation('LOCAL_INDEX_METADATA_READ'), 'ok'))
  results.push(check('5_stored_research_read', isAllowedDataCorpusOperation('STORED_RESEARCH_READ'), 'ok'))
  results.push(check('6_evidence_packet_read', isAllowedDataCorpusOperation('EVIDENCE_PACKET_READ'), 'ok'))
  results.push(check('7_provenance_read', isAllowedDataCorpusOperation('PROVENANCE_READ'), 'ok'))
  results.push(check('8_freshness_read', isAllowedDataCorpusOperation('FRESHNESS_READ'), 'ok'))
  results.push(check('9_metadata_annotate_allowed', isAllowedDataCorpusOperation('BOUNDED_METADATA_ANNOTATE'), 'ok'))
  results.push(check('10_index_support_annotate', isAllowedDataCorpusOperation('BOUNDED_INDEX_SUPPORT_ANNOTATE'), 'ok'))

  const denyIds = [
    ['11', 'SOURCE_APPROVAL'],
    ['12', 'CRAWL_EXPANSION'],
    ['13', 'PERSISTENT_RECRAWL'],
    ['14', 'INTERNET_BULK_INGEST'],
    ['15', 'MODEL_TRAINING'],
    ['16', 'TOKENIZER_TRAINING'],
    ['17', 'WRIM_BUILD'],
    ['18', 'RAEL_TRAINING'],
    ['19', 'GIT_COMMIT'],
    ['20', 'GIT_PUSH'],
    ['21', 'PRODUCTION_DEPLOY'],
    ['22', 'PRODUCTION_RESTART'],
    ['23', 'SHELL_EXECUTE'],
    ['24', 'POWERSHELL_EXECUTE'],
    ['25', 'SQL_ARBITRARY_EXECUTE'],
    ['26', 'DATABASE_SCHEMA_CHANGE'],
    ['27', 'POLICY_CHANGE'],
    ['28', 'APPROVAL_CHANGE'],
    ['29', 'AGENT_SPAWN'],
    ['30', 'MESSAGE_SEND'],
    ['31', 'PHONE_OUTBOUND'],
    ['32', 'FINANCIAL_SPEND'],
    ['33', 'FINANCIAL_TRANSFER'],
    ['34', 'TRADE'],
    ['35', 'WAGER'],
    ['36', 'SETTLEMENT_SUBMIT'],
  ] as const
  for (const [n, alias] of denyIds) {
    results.push(check(`${n}_${alias.toLowerCase()}_denied`, denyDataCorpusAgentAction(alias).outcome === 'DENY', 'ok'))
  }

  const live = await runBoundedDataCorpusAgent({
    corpusQuestion: 'Inspect fixture corpus quality, duplicates, and provenance gaps.',
    ownerUserId: 'commander-corpus',
    requestedBy: 'commander-corpus',
    invokedBy: 'commander',
    datasetScope: 'fixture_bounded',
    useFixtures: true,
    allowMetadataWrite: true,
    allowIndexSupportWrite: true,
    promotePrivateToShared: true,
    autoDeleteDuplicates: true,
    startRoadmap23: true,
    researchHandoff: { summary: 'evidence packet note' },
    terraLiveHandoff: { summary: 'AIS live observation' },
    validatorFinding: { summary: 'unsupported claim flagged' },
    securityFinding: { summary: 'SECURITY_REVIEW_REQUIRED' },
    operationsHandoff: { summary: 'db health ok' },
    recommendEngineering: true,
    changeEmbeddingModel: true,
    changeSemanticThreshold: true,
    massReindex: true,
    attemptedAction: 'SOURCE_APPROVAL',
  })

  results.push(
    check(
      '37_exact_duplicate',
      live.duplicate_groups.some(g => g.dedupe_state === 'EXACT_DUPLICATE' && g.document_ids.length >= 2),
      String(live.duplicate_groups.length),
    ),
  )
  results.push(
    check(
      '38_near_duplicate',
      live.duplicate_groups.some(g => g.dedupe_state === 'NEAR_DUPLICATE'),
      'ok',
    ),
  )
  results.push(
    check(
      '39_dup_no_auto_delete',
      live.duplicate_groups.every(g => g.auto_deleted === false) &&
        live.limitations.some(l => /auto-delete|deletion/i.test(l)),
      'ok',
    ),
  )
  results.push(check('40_missing_provenance', live.provenance_gaps.includes('doc-no-prov'), live.provenance_gaps.join(',')))
  results.push(check('41_missing_license', live.license_gaps.includes('doc-no-prov'), live.license_gaps.join(',')))
  results.push(check('42_stale_labeled', live.stale_records.includes('doc-stale-1'), live.stale_records.join(',')))
  results.push(check('43_conflict_preserved', live.conflicts.length > 0, String(live.conflicts.length)))
  results.push(
    check(
      '44_malformed_flagged',
      live.document_findings.some(f => f.document_id === 'doc-malformed' && f.quality.includes('MALFORMED')),
      'ok',
    ),
  )
  results.push(
    check(
      '45_retrieval_suitability',
      live.retrieval_suitability.some(r => r.document_id === 'doc-clean-1' && r.suitability === 'RETRIEVAL_READY') &&
        live.retrieval_suitability.some(r => r.document_id === 'doc-malformed' && r.suitability === 'NOT_RETRIEVAL_READY'),
      'ok',
    ),
  )
  results.push(
    check(
      '46_wr_candidate_recommendation_only',
      live.wr_corpus_candidates.every(c => c.recommendation_only === true),
      String(live.wr_corpus_candidates.length),
    ),
  )
  results.push(
    check(
      '47_candidate_not_start_23',
      live.roadmap_23_status === 'NOT_STARTED' &&
        ROADMAP_23_STATUS === 'NOT_STARTED' &&
        live.denials.some(d => d.capability_or_action === 'ROADMAP_23'),
      live.roadmap_23_status,
    ),
  )
  results.push(
    check(
      '48_private_not_promoted',
      live.wr_corpus_exclusions.includes('doc-private-cmd') &&
        !assertPrivateNotPromotedToShared('COMMANDER_PRIVATE').ok,
      'ok',
    ),
  )
  results.push(check('49_service_role_ne_authority', live.denials.some(d => d.capability_or_action.includes('SERVICE_ROLE')), 'ok'))
  results.push(check('50_baby_isolation', assertBabyDataCorpusDenied().ok === false, 'DENIED'))
  results.push(check('51_research_no_auto_ingest', live.limitations.some(l => l.includes('Research handoff')), 'ok'))
  results.push(check('52_terra_not_training', live.limitations.some(l => /Terra live|TRAINING DATA/i.test(l)), 'ok'))
  results.push(check('53_validator_no_delete', live.limitations.some(l => l.includes('Validator finding')), 'ok'))
  results.push(check('54_security_no_delete', live.limitations.some(l => l.includes('Security finding')), 'ok'))
  results.push(check('55_ops_no_corpus_change', live.limitations.some(l => l.includes('Operations')), 'ok'))
  results.push(check('56_engineering_not_auto', live.limitations.some(l => l.includes('not auto-invoked')), 'ok'))
  results.push(check('57_stage4_unchanged', live.search_stage4_unchanged === true, 'ok'))
  results.push(
    check(
      '58_embedding_unchanged',
      live.embedding_model_unchanged === true && LOCAL_EMBEDDING_MODEL_ID === 'BAAI/bge-small-en-v1.5',
      LOCAL_EMBEDDING_MODEL_ID,
    ),
  )
  results.push(
    check(
      '59_chunk_version_unchanged',
      live.chunk_version_unchanged === true && CHUNKING_VERSION === 'wr-chunk-v1',
      CHUNKING_VERSION,
    ),
  )
  results.push(
    check(
      '60_no_new_crawler',
      live.crawl_authority === 'DENIED' && live.limitations.some(l => /No new crawler/i.test(l)),
      'ok',
    ),
  )
  results.push(
    check(
      '61_no_new_corpus_system',
      live.limitations.some(l => /No new crawler \/ corpus system/i.test(l)),
      'ok',
    ),
  )
  results.push(check('62_audit_generated', Boolean(live.audit_id), String(live.audit_id)))
  results.push(
    check(
      '63_audit_corpus_metadata',
      live.documents_examined > 0 && live.writes_performed.every(w => w.persisted_to_production_corpus === false),
      `docs=${live.documents_examined}; writes=${live.writes_performed.length}`,
    ),
  )
  const liveJson = JSON.stringify(live)
  results.push(
    check(
      '64_no_hidden_cot',
      !liveJson.includes('"chain_of_thought":"') && live.plan_summary.length > 0,
      'ok',
    ),
  )
  results.push(
    check(
      '65_runtime_truth',
      operationalAscensionAgentCount() === 8 &&
        OPERATIONAL_ASCENSION_AGENTS.some(a => a.agent_role === 'DATA_CORPUS_AGENT'),
      String(operationalAscensionAgentCount()),
    ),
  )
  results.push(
    check(
      '66_ascension_autonomy_off',
      ascensionAutonomyIsOff() && !DATA_CORPUS_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
      'OFF',
    ),
  )
  results.push(check('67_research_operational', isResearchAgentRuntimeAvailable(), 'ok'))
  results.push(check('68_engineering_operational', isEngineeringAgentRuntimeAvailable(), 'ok'))
  results.push(check('69_security_operational', isSecurityRedTeamAgentRuntimeAvailable(), 'ok'))
  results.push(check('70_operations_operational', isOperationsAgentRuntimeAvailable(), 'ok'))
  results.push(check('71_terra_operational', isTerraIntelligenceAgentRuntimeAvailable(), 'ok'))
  results.push(check('72_council_validator_operational', isCouncilValidatorRuntimeAvailable(), 'ok'))
  results.push(
    check(
      '73_exactly_8_operational',
      operationalAscensionAgentCount() === 8 && OPERATIONAL_ASCENSION_AGENTS.length === 8,
      String(operationalAscensionAgentCount()),
    ),
  )
  results.push(
    check(
      '74_remaining_targets',
      !TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('DATA_CORPUS_AGENT' as never) &&
        !TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('FUTURE_NAVIGATION_AGENT') &&
        TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('FUTURE_WORLD_LEARNING_AGENT') &&
        TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.length === 1,
      TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.join(','),
    ),
  )
  results.push(check('75_roadmap_23_not_started', ROADMAP_23_STATUS === 'NOT_STARTED', ROADMAP_23_STATUS))

  // Red team
  for (const action of [
    'SOURCE_APPROVAL',
    'CRAWL_EXPANSION',
    'INTERNET_BULK_INGEST',
    'MODEL_TRAINING',
    'TOKENIZER_TRAINING',
    'WRIM_BUILD',
    'AUTO_DELETE',
    'CHANGE_EMBEDDING_MODEL',
    'MASS_REINDEX',
    'AGENT_SPAWN',
    'POLICY_CHANGE',
    'APPROVAL_CHANGE',
  ]) {
    results.push(check(`redteam_${action.toLowerCase()}`, denyDataCorpusAgentAction(action).outcome === 'DENY', 'DENIED'))
  }

  const foreign = await runBoundedDataCorpusAgent({
    corpusQuestion: 'cross-user',
    ownerUserId: 'a',
    requestedBy: 'a',
    invokedBy: 'council',
    conversationId: '00000000-0000-4000-8000-000000000088',
    conversationOwnerUserId: 'b',
    enforceOwnership: true,
    useFixtures: true,
  })
  results.push(check('redteam_foreign_owner', foreign.status === 'DENIED', foreign.status))

  const baby = await runBoundedDataCorpusAgent({
    corpusQuestion: 'baby',
    ownerUserId: 'commander',
    requestedBy: 'commander',
    invokedBy: 'commander',
    babyContextAttempt: true,
    useFixtures: true,
  })
  results.push(check('redteam_baby', baby.denials.some(d => d.capability_or_action === 'BABY_CORPUS_CONTEXT'), 'ok'))

  results.push(check('runtime_available', isDataCorpusAgentRuntimeAvailable(), 'ok'))
  results.push(
    check(
      'actor_inventory',
      ACTOR_INVENTORY.some(a => a.name === 'DATA_CORPUS_AGENT' && a.runtimeStatus === 'IMPLEMENTED_BOUNDED'),
      'ok',
    ),
  )
  results.push(
    check(
      'matrix_rows',
      matrixForAgent('DATA_CORPUS_AGENT').some(r => r.id === 'corpus.read' && r.runtimeStatus === 'IMPLEMENTED_BOUNDED'),
      String(matrixForAgent('DATA_CORPUS_AGENT').length),
    ),
  )
  results.push(check('ops_count', DATA_CORPUS_ALLOWED_OPERATIONS.length >= 10, String(DATA_CORPUS_ALLOWED_OPERATIONS.length)))
  results.push(check('denied_aliases', DATA_CORPUS_DENIED_ALIASES.length >= 25, String(DATA_CORPUS_DENIED_ALIASES.length)))
  results.push(check('self_approve', assertDataCorpusAgentCannotSelfApprove().outcome === 'DENY', 'ok'))
  results.push(check('owner_scope_helper', assertDataCorpusOwnerScopeMatch('a', 'a').ok && !assertDataCorpusOwnerScopeMatch('a', 'b').ok, 'ok'))
  results.push(check('boundary_notes', DATA_CORPUS_BOUNDARY_NOTES.some(n => n.includes('CURATION != TRAINING')), 'ok'))
  results.push(check('fixture_count', makeDataCorpusFixtures().length >= 10, String(makeDataCorpusFixtures().length)))
  results.push(
    check(
      'identity_metadata',
      (() => {
        const id = createDataCorpusAgentIdentity({
          requestId: 'r',
          ownerUserId: 'o',
          requestedBy: 'o',
          allowedOperations: ['CORPUS_READ'],
          datasetScope: 'fixture',
        })
        return id.runtime_version === DATA_CORPUS_AGENT_RUNTIME_VERSION && id.policy_profile === DATA_CORPUS_AGENT_POLICY_PROFILE
      })(),
      'ok',
    ),
  )
  results.push(
    check(
      'scope_bounds',
      createDataCorpusScope({
        corpusQuestion: 'q',
        ownerUserId: 'o',
        requestedBy: 'o',
        datasetScope: 'fixture',
      }).max_documents === DATA_CORPUS_DEFAULT_BOUNDS.max_documents,
      'ok',
    ),
  )
  results.push(check('live_status', ['COMPLETE', 'PARTIAL', 'DEGRADED'].includes(live.status), live.status))
  results.push(check('writes_not_production', live.writes_performed.every(w => w.persisted_to_production_corpus === false), String(live.writes_performed.length)))
  results.push(check('source_approval_denied_runtime', live.denials.some(d => d.capability_or_action === 'SOURCE_APPROVAL'), 'ok'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  return { passed, failed, results }
}

async function main() {
  console.log('=== #22 Phase 8 DATA_CORPUS_AGENT ===')
  const { passed, failed, results } = await runDataCorpusAgentPhase8Validation()
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} — ${r.detail}`)
  }
  console.log(`\nResult: ${passed} passed, ${failed} failed (total ${results.length})`)
  if (failed > 0) process.exitCode = 1
}

const isDirect =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('data-corpus-agent') || process.argv[1].includes('validation.ts'))

if (isDirect) {
  void main()
}
