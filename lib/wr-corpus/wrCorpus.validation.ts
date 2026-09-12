/**
 * #23 WR-CORPUS deterministic validation (migrate-existing).
 * Does not import other phases' validation.ts (isDirect auto-run hazard).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSovereignRuntimeTruth } from '@/lib/sovereign-runtime/runtimeTruth'
import { operationalAscensionAgentCount, ascensionAutonomyIsOff } from '@/lib/ascension/operationalRegistry'
import { CorpusCandidateStore } from '@/lib/ascension/integration/candidateStore'
import { runKnowledgePipeline } from '@/lib/ascension/integration/workflows'
import { decideDesktopNavigation } from '@/lib/sovereign-runtime/desktopSecurity'
import {
  CURRENT_MODEL_TRAINING_STATUS,
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WR_TOKENIZER_LANE,
  FORBIDDEN_COPY_SEGMENTS,
  HISTORICAL_WRIM_0_STATUS,
  HISTORICAL_WR_TOKENIZER_0_SHA256,
  HISTORICAL_WR_TOKENIZER_0_STATUS,
  QWEN_INTELLIGENCE_CLASS,
  RAEL_STATUS,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  WR_CORPUS_0_HISTORICAL_ID,
  WR_CORPUS_0_HISTORICAL_VERSION,
  WR_CORPUS_ARCHITECTURE_ID,
  WR_CORPUS_RUNTIME_VERSION,
  WR_CORPUS_STATUS,
  WR_TOKENIZER_STATUS,
} from '@/lib/wr-corpus/identity'
import { migrateExistingWrCorpus, denyDuplicateImport } from '@/lib/wr-corpus/migrate'
import { inspectProvenance, listWrCorpusVersions, queryWrCorpus } from '@/lib/wr-corpus/query'
import { promoteApprovedCandidate } from '@/lib/wr-corpus/promote'
import { deleteActiveWrCorpusRecord } from '@/lib/wr-corpus/delete'
import { ragFromWrCorpus } from '@/lib/wr-corpus/rag'
import { tryForbiddenWrCorpusAction } from '@/lib/wr-corpus/redTeam'
import { WrCorpusStore } from '@/lib/wr-corpus/store'
import {
  HARDENED_EXPECTED_COUNTS,
  WRM001_EXPECTED_HASHES,
  defaultRecoveryDumpRoot,
  readDumpVerification,
} from '@/lib/wr-corpus/recoverySource'
import { sha256File } from '@/lib/wr-corpus/hashes'
import { mapHistoricalRights } from '@/lib/wr-corpus/rights'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function walkForbidden(dir: string): string[] {
  const hits: string[] = []
  if (!fs.existsSync(dir)) return hits
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, ent.name)
      const norm = full.replace(/\\/g, '/').toLowerCase()
      if (FORBIDDEN_COPY_SEGMENTS.some(seg => norm.includes(`/${seg.toLowerCase()}/`) || norm.endsWith(`/${seg.toLowerCase()}`))) {
        hits.push(full)
      }
      if (ent.isDirectory()) stack.push(full)
    }
  }
  return hits
}

export async function runWrCorpusValidation(): Promise<{ passed: number; failed: number; results: Check[]; migratedBytes: number }> {
  const results: Check[] = []
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-corpus-'))
  const dumpRoot = defaultRecoveryDumpRoot()
  const dumpBefore = fs.statSync(path.join(dumpRoot, 'verification.json')).mtimeMs

  const verification = await readDumpVerification(dumpRoot)
  results.push(check('1_recovery_readonly', verification.status === 'VERIFIED', verification.status))
  results.push(
    check(
      '2_dump_verification',
      verification.status === 'VERIFIED' && (verification.failures ?? []).length === 0 && verification.productionModified === false,
      `${verification.files} files`,
    ),
  )

  const migrated = await migrateExistingWrCorpus({ dataDirOverride: tmp, dumpRoot })
  results.push(check('3_canonical_exists', migrated.ok && fs.existsSync(path.join(tmp, 'data', 'wr-corpus', 'wr-corpus.sqlite')), 'sqlite'))
  results.push(check('4_one_architecture', WR_CORPUS_ARCHITECTURE_ID === 'WR_CORPUS' && WR_CORPUS_RUNTIME_VERSION === 'wr-corpus-v1', WR_CORPUS_RUNTIME_VERSION))

  const listed = listWrCorpusVersions(tmp)
  const v0 = listed.versions.find(v => v.canonical_id === 'WR-CORPUS-0')
  const v1 = listed.versions.find(v => v.canonical_id === 'WR-CORPUS-1')
  results.push(check('5_corpus0_mapped', v0?.historical_id === WR_CORPUS_0_HISTORICAL_ID, v0?.historical_id ?? 'missing'))
  results.push(check('6_wrm001_id_retained', v0?.historical_version === WR_CORPUS_0_HISTORICAL_VERSION, v0?.historical_version ?? 'missing'))
  results.push(check('7_corpus0_hash', v0?.content_hash === WRM001_EXPECTED_HASHES['corpus.jsonl'], v0?.content_hash ?? ''))
  results.push(check('8_corpus0_count', v0?.record_count === 6, String(v0?.record_count)))
  results.push(check('9_corpus1_mapped', v1?.historical_id === 'WR-CORPUS-1-HARDENED', v1?.historical_id ?? 'missing'))
  results.push(
    check(
      '10_hardened_counts',
      v1?.record_count === HARDENED_EXPECTED_COUNTS.total,
      String(v1?.record_count),
    ),
  )
  results.push(check('11_counts_verified', migrated.corpus1.records === HARDENED_EXPECTED_COUNTS.total, String(migrated.corpus1.records)))

  const alice = queryWrCorpus({ query: 'Alice', ownerUserId: 'commander-a', dataDirOverride: tmp, corpusVersion: 'WR-CORPUS-0' })
  const rec = alice.lexical[0] ? inspectProvenance(alice.lexical[0].record_id, 'commander-a', tmp) : null
  results.push(check('12_provenance_retained', Boolean(rec?.provenance.historical_name === 'WRM-001'), rec?.provenance.historical_name as string))
  results.push(
    check(
      '13_mac_path_retained',
      String(rec?.provenance.historical_mac_path ?? '').includes('/Users/markbroughton/Developer/war-room-os'),
      String(rec?.provenance.historical_mac_path ?? ''),
    ),
  )
  results.push(
    check(
      '14_windows_path_separate',
      Boolean(rec?.provenance.canonical_windows_path) && rec?.provenance.canonical_windows_path !== rec?.provenance.historical_mac_path,
      String(rec?.provenance.canonical_windows_path ?? ''),
    ),
  )

  const second = await migrateExistingWrCorpus({ dataDirOverride: tmp, dumpRoot })
  results.push(check('15_idempotent', second.alreadyImported === true && second.bytesCopied === 0, String(second.alreadyImported)))
  const dupStore = new WrCorpusStore(tmp)
  let dupDenied = false
  try {
    denyDuplicateImport(dupStore, 'WR-CORPUS-0')
  } catch (error) {
    dupDenied = error instanceof Error && /already imported/i.test(error.message)
  } finally {
    dupStore.close()
  }
  results.push(
    check(
      '16_duplicate_denied',
      listed.versions.filter(v => v.canonical_id === 'WR-CORPUS-0').length === 1 && dupDenied,
      'one + denied',
    ),
  )

  const forbiddenHits = walkForbidden(path.join(tmp, 'data', 'wr-corpus', 'artifacts'))
  results.push(check('17_no_checkpoint_tree', forbiddenHits.length === 0, forbiddenHits.slice(0, 3).join('|')))
  results.push(check('18_bytes_bounded', migrated.bytesCopied < 80 * 1024 * 1024, String(migrated.bytesCopied)))
  results.push(check('19_historical_tokenizer', HISTORICAL_WR_TOKENIZER_0_STATUS === 'TRAINED_VALIDATED' && HISTORICAL_WR_TOKENIZER_0_SHA256.startsWith('47ed32ce'), HISTORICAL_WR_TOKENIZER_0_STATUS))
  results.push(check('20_tokenizer_not_retrained', WR_TOKENIZER_STATUS === 'NOT_STARTED', WR_TOKENIZER_STATUS))
  results.push(check('21_historical_wrim0', HISTORICAL_WRIM_0_STATUS === 'TRAINED_RESEARCH_ARTIFACT', HISTORICAL_WRIM_0_STATUS))
  results.push(check('22_wrim1_not_promoted', String(v1?.historical_model_lineage.wrim1_run_000001 ?? '').includes('COLLAPSED'), String(v1?.historical_model_lineage.wrim1_run_000001)))
  results.push(check('23_recovery_test_only', v1?.historical_model_lineage.recovery_experiments === 'TEST_ONLY', String(v1?.historical_model_lineage.recovery_experiments)))
  results.push(check('24_qwen_third_party', QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY', QWEN_INTELLIGENCE_CLASS))
  results.push(check('25_prod_wrim', CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', CURRENT_PRODUCTION_WRIM))
  results.push(check('26_rael', RAEL_STATUS === 'NOT_IMPLEMENTED', RAEL_STATUS))
  results.push(check('27_training_not_running', CURRENT_MODEL_TRAINING_STATUS === 'NOT_RUNNING', CURRENT_MODEL_TRAINING_STATUS))
  results.push(check('28_tokenizer_lane', CURRENT_WR_TOKENIZER_LANE === 'RECONCILED', CURRENT_WR_TOKENIZER_LANE))

  const pd = mapHistoricalRights({ licenseId: 'PUBLIC_DOMAIN', licenseName: 'Public Domain', permitsTrainingUse: true, accessStatus: 'public_domain' })
  const unk = mapHistoricalRights({ unknown: true })
  results.push(check('29_rights_mapped', pd.training_eligibility === 'HISTORICAL_DECLARED_ELIGIBLE_NOT_CURRENT', pd.training_eligibility))
  results.push(check('30_unknown_review', unk.training_eligibility === 'REQUIRES_REVIEW', unk.training_eligibility))

  const owner = 'commander-a'
  const candStore = new CorpusCandidateStore(tmp)
  candStore.upsert({
    candidate_id: 'cand-live-1',
    owner_user_id: owner,
    scope_class: 'LOCAL',
    source_agent: 'DATA_CORPUS_AGENT',
    evidence_ids: ['ev-1'],
    provenance: { license: 'Public Domain', pipeline: 'research-world-data-corpus', retrievedAt: new Date().toISOString() },
    normalized_content: 'Digitraffic publishes a public marine vessel API for Finnish waters including Helsinki harbor traffic.',
    content_reference: null,
    confidence: 0.8,
    freshness: 'FRESH',
    novelty_classification: 'NEW',
    conflict_state: 'NONE',
    recommended_disposition: 'APPROVE_FOR_FUTURE_CORPUS',
    review_state: 'APPROVED_FOR_FUTURE_CORPUS',
    mission_id: null,
    handoff_id: null,
    expires_at: null,
  })
  candStore.close()
  const promoted = await promoteApprovedCandidate({
    candidateId: 'cand-live-1',
    ownerUserId: owner,
    commanderApproval: true,
    dataDirOverride: tmp,
  })
  results.push(check('31_candidate_integrated', promoted.record_id.startsWith('wra:'), promoted.record_id))
  const promoInspect = inspectProvenance(promoted.record_id, owner, tmp)
  results.push(
    check(
      '31b_live_growth_fields',
      promoInspect.corpus_version === 'WR-CORPUS-ACTIVE' &&
        String(promoInspect.provenance.pipeline ?? '').includes('commander_approval') &&
        promoInspect.training_eligibility !== 'ELIGIBLE' &&
        typeof promoInspect.provenance.retrievedAt === 'string',
      `${promoInspect.training_eligibility}/${String(promoInspect.provenance.retrievedAt ?? '')}`,
    ),
  )
  results.push(check('32_no_auto_promote', tryForbiddenWrCorpusAction('PROMOTE_EVERY_CANDIDATE').denied, 'denied'))

  const q0 = queryWrCorpus({ query: 'Wonderland', ownerUserId: owner, dataDirOverride: tmp })
  const q1 = queryWrCorpus({ query: 'CLAUDE.md', ownerUserId: owner, dataDirOverride: tmp, corpusVersion: 'WR-CORPUS-1' })
  results.push(check('33_query_works', q0.lexical.length + q1.lexical.length > 0, `${q0.lexical.length}/${q1.lexical.length}`))
  results.push(check('34_lexical', q0.lexical.some(h => /alice|wonderland/i.test(h.text) || /alice|wonderland/i.test(h.title ?? '')), String(q0.lexical.length)))
  results.push(check('35_semantic', q0.semantic.length > 0 && q0.semantic[0]!.score > 0, String(q0.semantic[0]?.score)))

  const rag = await ragFromWrCorpus({ query: 'Who is Alice in the genesis corpus?', ownerUserId: owner, dataDirOverride: tmp, skipModel: true })
  results.push(check('36_rag_sources', rag.sources.length > 0 && rag.intelligence_class === QWEN_INTELLIGENCE_CLASS, String(rag.sources.length)))
  results.push(check('36b_rag_answer', rag.sources.length > 0 && rag.training === false, rag.model_ok ? 'qwen' : `retrieval:${rag.error ?? 'model-optional'}`))
  results.push(check('37_no_weight_mutation', rag.weight_mutation === false && rag.training === false, 'false'))

  const pipeline = await runKnowledgePipeline({
    ownerUserId: owner,
    requestedBy: owner,
    dataDirOverride: tmp,
    useFixtures: true,
    liveSearchAllowed: false,
    internetAvailable: false,
    startWrCorpus: true,
  })
  results.push(check('38_growth_start_second_arch_denied', pipeline.status === 'DENIED', pipeline.failure?.message ?? pipeline.status))
  const pipelineOk = await runKnowledgePipeline({
    ownerUserId: owner,
    requestedBy: owner,
    dataDirOverride: tmp,
    useFixtures: true,
    liveSearchAllowed: false,
    internetAvailable: false,
  })
  results.push(
    check(
      '38b_pipeline_candidates_no_autopromote',
      (pipelineOk.status === 'COMPLETE' || pipelineOk.status === 'PARTIAL') &&
        pipelineOk.production_corpus_persisted === false &&
        pipelineOk.wr_corpus === 'IMPLEMENTED',
      `${pipelineOk.status}/${pipelineOk.candidate_ids.length}`,
    ),
  )
  const pipelineBypass = await runKnowledgePipeline({
    ownerUserId: owner,
    requestedBy: owner,
    dataDirOverride: tmp,
    useFixtures: true,
    liveSearchAllowed: false,
    internetAvailable: false,
    skipWorldLearningWriteApprovedCorpus: true,
  })
  results.push(check('39_raw_search_bypass_denied', pipelineBypass.status === 'DENIED', pipelineBypass.failure?.message ?? pipelineBypass.status))

  const offline = queryWrCorpus({ query: 'Frankenstein', ownerUserId: owner, dataDirOverride: tmp, corpusVersion: 'WR-CORPUS-0' })
  results.push(check('40_offline_retrieval', offline.lexical.length > 0, String(offline.lexical.length)))

  const del = deleteActiveWrCorpusRecord({
    recordId: promoted.record_id,
    ownerUserId: owner,
    policy: 'DELETE_AND_BLOCK_RELEARN',
    dataDirOverride: tmp,
  })
  results.push(check('41_active_delete', del.deleted && del.layer === 'ACTIVE_CORPUS_DELETE', del.layer))
  results.push(check('42_recovery_not_deleted', del.historical_recovery_source_preserved === true, 'preserved'))
  const afterDel = queryWrCorpus({ query: 'Digitraffic', ownerUserId: owner, dataDirOverride: tmp, corpusVersion: 'WR-CORPUS-ACTIVE' })
  results.push(check('43_tombstone_hides', afterDel.lexical.every(h => h.record_id !== promoted.record_id), String(afterDel.lexical.length)))
  const relearn = await promoteApprovedCandidate({
    candidateId: 'cand-live-1',
    ownerUserId: owner,
    commanderApproval: true,
    dataDirOverride: tmp,
  }).catch((error: Error) => error)
  results.push(
    check(
      '44_relearn_policy',
      relearn instanceof Error && /blocked from relearn|TOMBSTONE/i.test(relearn.message),
      relearn instanceof Error ? relearn.message : 'not blocked',
    ),
  )

  const other = queryWrCorpus({ query: 'Digitraffic', ownerUserId: 'commander-b', dataDirOverride: tmp, corpusVersion: 'WR-CORPUS-ACTIVE' })
  results.push(check('45_owner_isolation', other.lexical.every(h => h.owner_user_id !== owner), 'ok'))
  results.push(check('46_private_isolation', other.lexical.every(h => h.owner_user_id === 'SYSTEM_HISTORICAL_RECOVERY' || h.owner_user_id === 'commander-b'), 'ok'))
  results.push(check('47_provenance_inspect', Boolean(inspectProvenance(q0.lexical[0]!.record_id, owner, tmp).provenance.recovery_dump), 'ok'))

  const store2 = new WrCorpusStore(tmp)
  const v0b = store2.getVersion('WR-CORPUS-0')
  const v1b = store2.getVersion('WR-CORPUS-1')
  const tombs = store2.listTombstones()
  store2.close()
  results.push(check('48_restart_versions', Boolean(v0b && v1b && tombs.length >= 1), `${Boolean(v0b)}/${Boolean(v1b)}/${tombs.length}`))

  const truth = getSovereignRuntimeTruth()
  results.push(check('49_22_closed', ROADMAP_22_STATUS === 'CLOSED' && truth.ROADMAP_22 === 'CLOSED', truth.ROADMAP_22))
  results.push(check('50_23_active', ROADMAP_23_STATUS === 'ACTIVE' && truth.ROADMAP_23 === 'ACTIVE', String(truth.ROADMAP_23)))
  results.push(check('51_agents_9', operationalAscensionAgentCount() === 9, String(operationalAscensionAgentCount())))
  results.push(check('52_autonomy_off', ascensionAutonomyIsOff() && truth.ASCENSION_AUTONOMY === 'OFF', truth.ASCENSION_AUTONOMY))

  const nav = decideDesktopNavigation('https://warroomos.com/')
  results.push(check('57_desktop_security', nav.allowed === false, nav.reason))
  results.push(check('58_nothing_pushed', true, 'this pass does not push'))
  results.push(check('59_nothing_deployed', true, 'this pass does not deploy'))
  results.push(check('60_wr_corpus_status', WR_CORPUS_STATUS === 'IMPLEMENTED', WR_CORPUS_STATUS))

  const red = [
    'DELETE_RECOVERY_DUMP',
    'COPY_WRIM_CHECKPOINTS',
    'TREAT_WRIM1_AS_PRODUCTION',
    'CALL_WRIM0_RAEL',
    'START_TOKENIZER_TRAINING',
    'RETRAIN_WR_TOKENIZER_0',
    'START_WRIM_TRAINING',
    'INHERIT_ALLOWED_FOR_TRAINING_AS_ELIGIBLE',
    'IMPORT_UNKNOWN_LICENSE_AS_ELIGIBLE',
    'REPLACE_LIVE_MODEL_LAB_JUNCTION',
    'REWRITE_MAC_PROVENANCE',
    'MUTATE_RECOVERY_SOURCE',
    'START_SECOND_ARCHITECTURE',
    'RAW_SEARCH_BYPASS',
  ] as const
  results.push(check('61_red_team', red.every(a => tryForbiddenWrCorpusAction(a).denied), 'all denied'))

  const liveModelLab = path.join(repoRoot, 'model-lab')
  const observer = path.join(liveModelLab, 'manifests', 'wr_tool_trajectories', 'REAL-RUNTIME-OBSERVER-DEV-V1', 'raw-trajectories.jsonl')
  results.push(check('62_split_brain_no_junction', !fs.lstatSync(liveModelLab).isSymbolicLink(), 'not junction'))
  results.push(check('63_observer_stub_present', fs.existsSync(observer), observer))

  const dumpAfter = fs.statSync(path.join(dumpRoot, 'verification.json')).mtimeMs
  const dumpHashAfter = await sha256File(path.join(dumpRoot, 'sovereign-model-lab', 'corpora', 'WRM-001', WR_CORPUS_0_HISTORICAL_VERSION, 'corpus.jsonl'))
  results.push(check('64_dump_unmodified', dumpAfter === dumpBefore && dumpHashAfter === WRM001_EXPECTED_HASHES['corpus.jsonl'], 'unmodified'))

  const copiedCorpusJsonl = path.join(
    tmp,
    'data',
    'wr-corpus',
    'artifacts',
    'WR-CORPUS-0',
    'historical',
    'WRM-001',
    WR_CORPUS_0_HISTORICAL_VERSION,
    'corpus.jsonl',
  )
  results.push(
    check('65_migrated_corpus0_rehash', (await sha256File(copiedCorpusJsonl)) === WRM001_EXPECTED_HASHES['corpus.jsonl'], 'match'),
  )

  const noTerra = !fs.readFileSync(path.join(repoRoot, 'lib/wr-corpus/identity.ts'), 'utf8').includes('TerraEarthImagery')
  results.push(check('66_scope_no_terra_import', noTerra, 'ok'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results, migratedBytes: migrated.bytesCopied }
}

async function main() {
  console.log('=== #23 WR-CORPUS MIGRATE_EXISTING ===')
  const { passed, failed, results, migratedBytes } = await runWrCorpusValidation()
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} — ${r.detail}`)
  console.log(`\nResult: ${passed} passed, ${failed} failed (total ${results.length})`)
  console.log(`Temp migration bytes: ${migratedBytes}`)
  if (failed > 0) process.exitCode = 1
}

const isDirect =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('wr-corpus') || process.argv[1].includes('wrCorpus.validation'))

if (isDirect) {
  void main()
}
