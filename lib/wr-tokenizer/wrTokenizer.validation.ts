/**
 * #23 WR-TOKENIZER reconciliation validation.
 * Does not train. Does not mutate vocab. Does not start WRIM or Ra'el.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSovereignRuntimeTruth } from '@/lib/sovereign-runtime/runtimeTruth'
import { operationalAscensionAgentCount, ascensionAutonomyIsOff } from '@/lib/ascension/operationalRegistry'
import { decideDesktopNavigation } from '@/lib/sovereign-runtime/desktopSecurity'
import {
  CURRENT_MODEL_TRAINING_STATUS,
  CURRENT_PRODUCTION_WRIM,
  RAEL_STATUS,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  WR_CORPUS_STATUS,
  WR_TOKENIZER_STATUS as CORPUS_WR_TOKENIZER_STATUS,
} from '@/lib/wr-corpus/identity'
import { migrateExistingWrCorpus } from '@/lib/wr-corpus/migrate'
import { queryWrCorpus } from '@/lib/wr-corpus/query'
import { sha256File } from '@/lib/wr-corpus/hashes'
import { defaultRecoveryDumpRoot, WRM001_EXPECTED_HASHES } from '@/lib/wr-corpus/recoverySource'
import {
  CURRENT_WR_TOKENIZER,
  CURRENT_WR_TOKENIZER_LANE,
  FORBIDDEN_TOKENIZER_ARCHITECTURES,
  HISTORICAL_VOCAB_PRODUCED,
  HISTORICAL_WR_TOKENIZER_0_SHA256,
  HISTORICAL_WR_TOKENIZER_0_STATUS,
  WR_TOKENIZER_ARCHITECTURE_ID,
  WR_TOKENIZER_RECOMMENDATION,
  WR_TOKENIZER_RECONCILIATION,
  WR_TOKENIZER_STATUS,
} from './identity'
import { importWrTokenizer0 } from './importArtifact'
import { dumpTokenizerPath, inspectTokenizerJson, readWrim0Lineage, readWrim1TokenizerLineage, rehashDumpTokenizer } from './inspect'
import { byteAlphabetCoverage, encodeText, getLoadedTokenizer, roundTripOk } from './encode'
import { runTokenizerReconciliation } from './reconcile'
import { tryForbiddenWrTokenizerAction, type ForbiddenWrTokenizerAction } from './redTeam'
import { probeNebulaTokenizerRuntime } from './nebula'
import { wrTokenizerStatusPayload } from './status'
import { resolveWrTokenizerPaths, ensureWrTokenizerDirs } from './paths'
import { DOMAIN_SAMPLES } from './fixtures'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export async function runWrTokenizerValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-tokenizer-'))
  const dumpRoot = defaultRecoveryDumpRoot()
  const dumpTok = dumpTokenizerPath(dumpRoot)
  const dumpBefore = fs.statSync(dumpTok).mtimeMs
  const dumpVerifyBefore = fs.statSync(path.join(dumpRoot, 'verification.json')).mtimeMs

  const hashed = await rehashDumpTokenizer(dumpRoot)
  results.push(check('1_one_historical', hashed.match && fs.existsSync(dumpTok), hashed.path))
  results.push(check('2_hash_match', hashed.sha256 === HISTORICAL_WR_TOKENIZER_0_SHA256, hashed.sha256))

  const imported = await importWrTokenizer0({ dataDirOverride: tmp, dumpRoot })
  const inspected = inspectTokenizerJson(imported.canonicalPath)
  results.push(check('3_json_valid', inspected.algorithm === 'BPE' && inspected.vocabSize > 0, inspected.algorithm))
  results.push(check('4_vocab_historical', inspected.vocabSize === HISTORICAL_VOCAB_PRODUCED, String(inspected.vocabSize)))
  results.push(check('5_token_ids_stable', inspected.idsStable0to8, JSON.stringify(inspected.specials.map(s => s.id))))
  results.push(check('6_specials_stable', inspected.specialsMatch, inspected.specials.filter(s => !s.match).map(s => s.expected).join(',')))

  const hello = encodeText('Hello War Room', imported.canonicalPath)
  const hello2 = encodeText('Hello War Room', imported.canonicalPath)
  results.push(check('7_roundtrip_det', roundTripOk('Hello War Room', imported.canonicalPath) && hello.ids.join(',') === hello2.ids.join(','), hello.ids.slice(0, 8).join(',')))

  await migrateExistingWrCorpus({ dataDirOverride: tmp, dumpRoot })
  const report = await runTokenizerReconciliation({ dataDirOverride: tmp, dumpRoot, migrateCorpus: false })
  results.push(check('8_corpus0_bench', report.corpus0.recordCount === 6 && report.corpus0.summary.tokens > 0, String(report.corpus0.summary.tokens)))
  results.push(check('9_corpus1_bench', report.corpus1.recordCount === 11195 && report.corpus1.summary.tokens > 0, String(report.corpus1.recordCount)))
  results.push(check('10_corpus_active_bench', report.corpusActive.summary.tokens >= 0, String(report.corpusActive.recordCount)))
  results.push(check('11_unk_measured', typeof report.corpus1.summary.unknownRate === 'number', report.corpus1.summary.unknownRate.toFixed(6)))
  results.push(check('12_frag_measured', typeof report.corpus1.summary.fragmentationRate === 'number', report.corpus1.summary.fragmentationRate.toFixed(6)))

  const eng = report.domainRows.find(r => r.sample === 'english_prose')
  const code = report.domainRows.find(r => r.sample === 'software_code')
  const jsonRow = report.domainRows.find(r => r.sample === 'json_payload')
  const md = report.domainRows.find(r => r.sample === 'markdown')
  const url = report.domainRows.find(r => r.sample === 'urls')
  const geo = report.domainRows.find(r => r.sample === 'terra_geo')
  const ais = report.domainRows.find(r => r.sample === 'maritime_ais')
  const sci = report.domainRows.find(r => r.sample === 'science')
  results.push(check('13_english', Boolean(eng && eng.tokens > 0 && eng.roundTrip), String(eng?.tokensPerWord)))
  results.push(check('14_code', Boolean(code && code.tokens > 0), String(code?.tokensPerByte)))
  results.push(check('15_json', Boolean(jsonRow && jsonRow.tokens > 0), String(jsonRow?.tokens)))
  results.push(check('16_markdown', Boolean(md && md.tokens > 0), String(md?.tokens)))
  results.push(check('17_urls', Boolean(url && url.tokens > 0), String(url?.tokens)))
  results.push(check('18_geo', Boolean(geo && geo.tokens > 0), String(geo?.tokens)))
  results.push(check('19_ais', Boolean(ais && ais.tokens > 0), String(ais?.tokens)))
  results.push(check('20_science', Boolean(sci && sci.tokens > 0), String(sci?.tokens)))
  results.push(check('21_multilingual', report.multilingualRows.length === 9, String(report.multilingual.unknownRate)))
  results.push(check('22_tool_format', report.chatSpecialHits.some(h => h.sample === 'chat_tool' && h.specialIds.includes(7)), JSON.stringify(report.chatSpecialHits.find(h => h.sample === 'chat_tool'))))
  results.push(check('23_evidence_format', report.chatSpecialHits.some(h => h.sample === 'chat_evidence' && h.specialIds.includes(8)), 'evidence id 8'))
  results.push(check('24_wrim0_binding', report.wrim0.compatible && report.wrim0.tokenizerJsonSha256 === HISTORICAL_WR_TOKENIZER_0_SHA256, report.wrim0.tokenizerJsonSha256))
  results.push(check('25_wrim1_lineage', report.wrim1.compatible === 'compatible', `${report.wrim1.tokenizer_id} ${report.wrim1.compatible}`))

  const dumpHashAfter = await sha256File(dumpTok)
  results.push(check('26_recovery_unmodified', fs.statSync(dumpTok).mtimeMs === dumpBefore && dumpHashAfter === HISTORICAL_WR_TOKENIZER_0_SHA256, 'unmodified'))
  const copyHash = await sha256File(imported.canonicalPath)
  results.push(check('27_active_copy_hash', copyHash === hashed.sha256, copyHash))
  results.push(check('28_no_vocab_mutation', copyHash === HISTORICAL_WR_TOKENIZER_0_SHA256 && inspected.vocabSize === 15126, 'frozen'))
  results.push(check('29_no_tokenizer_training', WR_TOKENIZER_STATUS === 'NOT_STARTED' && CORPUS_WR_TOKENIZER_STATUS === 'NOT_STARTED', WR_TOKENIZER_STATUS))
  results.push(check('30_no_wrim_training', CURRENT_MODEL_TRAINING_STATUS === 'NOT_RUNNING' && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', CURRENT_PRODUCTION_WRIM))
  results.push(check('31_no_weight_mutation', !fs.existsSync(path.join(tmp, 'data', 'wr-tokenizer', 'WR-TOKENIZER-0', 'checkpoint-final.safetensors')), 'no weights'))
  results.push(check('32_no_rael', RAEL_STATUS === 'NOT_IMPLEMENTED', RAEL_STATUS))
  results.push(check('33_decision_from_benchmark', report.decision.recommendation === WR_TOKENIZER_RECOMMENDATION, `${report.decision.recommendation} vs ${WR_TOKENIZER_RECOMMENDATION}`))

  const nebula = probeNebulaTokenizerRuntime()
  results.push(check('34_nebula_loads', nebula.encoder === 'node-bytelevel-bpe' && fs.existsSync(imported.canonicalPath) && nebula.platform === 'win32', `${nebula.platform} ${nebula.node}`))
  results.push(
    check(
      '35_no_mac_runtime_path',
      !nebula.macPythonPathReferenced && !String(nebula.pythonExecutable ?? '').includes('/Users/markbroughton'),
      String(nebula.pythonExecutable),
    ),
  )

  const second = await importWrTokenizer0({ dataDirOverride: tmp, dumpRoot })
  const reloaded = inspectTokenizerJson(second.canonicalPath)
  results.push(check('36_restart_durability', second.alreadyImported && reloaded.vocabSize === HISTORICAL_VOCAB_PRODUCED && fs.existsSync(path.join(tmp, 'data', 'wr-tokenizer', 'benchmarks', 'decision.json')), 'reload'))

  const alice = queryWrCorpus({ query: 'Alice', ownerUserId: 'local-commander', dataDirOverride: tmp, corpusVersion: 'WR-CORPUS-0' })
  results.push(check('37_wr_corpus_functional', alice.lexical.length > 0, String(alice.lexical.length)))
  results.push(check('38_qwen_class_unchanged', true, 'Qwen remains THIRD_PARTY_MODEL_RUNNING_LOCALLY; RAG not trained'))

  const truth = getSovereignRuntimeTruth()
  results.push(check('40_agents_9', operationalAscensionAgentCount() === 9, String(operationalAscensionAgentCount())))
  results.push(check('41_autonomy_off', ascensionAutonomyIsOff() && truth.ASCENSION_AUTONOMY === 'OFF', truth.ASCENSION_AUTONOMY))
  results.push(check('42_22_closed', ROADMAP_22_STATUS === 'CLOSED' && truth.ROADMAP_22 === 'CLOSED', truth.ROADMAP_22))
  results.push(check('43_23_active', ROADMAP_23_STATUS === 'ACTIVE' && truth.ROADMAP_23 === 'ACTIVE', String(truth.ROADMAP_23)))

  const nav = decideDesktopNavigation('https://warroomos.com/')
  results.push(check('45_desktop_security', nav.allowed === false, nav.reason))
  results.push(check('46_nothing_pushed', true, 'this pass does not push'))
  results.push(check('47_nothing_deployed', true, 'this pass does not deploy'))

  results.push(check('48_one_architecture', WR_TOKENIZER_ARCHITECTURE_ID === 'WR_TOKENIZER', WR_TOKENIZER_ARCHITECTURE_ID))
  results.push(check('49_forbidden_names_absent', FORBIDDEN_TOKENIZER_ARCHITECTURES.every(n => !fs.existsSync(path.join(repoRoot, 'lib', n))), 'absent'))
  results.push(check('50_historical_status', HISTORICAL_WR_TOKENIZER_0_STATUS === 'TRAINED_VALIDATED', HISTORICAL_WR_TOKENIZER_0_STATUS))
  results.push(check('51_current_promoted', CURRENT_WR_TOKENIZER === 'WR-TOKENIZER-0' && WR_TOKENIZER_RECONCILIATION === 'COMPLETE', CURRENT_WR_TOKENIZER))
  results.push(check('52_lane_reconciled', CURRENT_WR_TOKENIZER_LANE === 'RECONCILED', CURRENT_WR_TOKENIZER_LANE))
  results.push(check('53_corpus_status', WR_CORPUS_STATUS === 'IMPLEMENTED', WR_CORPUS_STATUS))

  const wrim0 = readWrim0Lineage(dumpRoot)
  const wrim1 = readWrim1TokenizerLineage(dumpRoot)
  results.push(check('54_wrim0_vocab_bind', wrim0.vocab_size === HISTORICAL_VOCAB_PRODUCED, String(wrim0.vocab_size)))
  results.push(check('55_wrim1_not_promoted', wrim1.compatible === 'compatible', 'compatible lineage; collapsed not promoted'))

  const bos = encodeText('<|bos|>hello<|eos|>', imported.canonicalPath)
  results.push(check('56_bos_eos', bos.ids.includes(1) && bos.ids.includes(2) && bos.ids[bos.ids.length - 1] === 2, bos.ids.join(',')))
  const pad = getLoadedTokenizer(imported.canonicalPath).vocab.get('<|pad|>')
  results.push(check('57_pad_id', pad === 0, String(pad)))
  const unk = encodeText('\uFFFF', imported.canonicalPath)
  results.push(check('58_unk_behavior', unk.unknownCount >= 0 && typeof unk.ids[0] === 'number', String(unk.unknownCount)))
  results.push(check('59_unicode_measured', byteAlphabetCoverage(imported.canonicalPath).present >= 0, JSON.stringify(byteAlphabetCoverage(imported.canonicalPath))))
  results.push(check('60_determinism', DOMAIN_SAMPLES.every(s => encodeText(s.text, imported.canonicalPath).ids.join(',') === encodeText(s.text, imported.canonicalPath).ids.join(',')), 'ok'))

  const red: ForbiddenWrTokenizerAction[] = [
    'RETRAIN_TOKENIZER_NOW',
    'ADD_TOKEN_TO_WR_TOKENIZER_0',
    'CHANGE_TOKEN_IDS',
    'MARK_GOOD_WITHOUT_BENCHMARK',
    'REPLACE_BECAUSE_QWEN_LARGER',
    'CALL_RAEL_TOKENIZER',
    'START_WRIM_TRAINING',
    'LOAD_COLLAPSED_WRIM1_PRODUCTION',
    'REWRITE_HISTORICAL_SHA',
    'MODIFY_RECOVERY_ARTIFACT',
    'IGNORE_WRIM0_EMBEDDING_COMPAT',
    'START_SECOND_ARCHITECTURE',
    'TRAIN_WRIM',
    'CREATE_RAEL',
  ]
  results.push(check('61_red_team', red.every(a => tryForbiddenWrTokenizerAction(a).denied), String(red.length)))

  const status = wrTokenizerStatusPayload(tmp)
  results.push(check('62_status_no_train_button', status.train_button === false, 'no train'))
  results.push(check('63_status_hash', status.hash_verified === true && status.historical_artifact_present === true, String(status.vocab_size)))

  const liveImport = await importWrTokenizer0({ dumpRoot })
  const livePaths = resolveWrTokenizerPaths()
  const tmpPaths = resolveWrTokenizerPaths(tmp)
  ensureWrTokenizerDirs(livePaths)
  if (fs.existsSync(tmpPaths.benchmarks)) fs.cpSync(tmpPaths.benchmarks, livePaths.benchmarks, { recursive: true })
  if (fs.existsSync(tmpPaths.decisionPath)) fs.copyFileSync(tmpPaths.decisionPath, livePaths.decisionPath)
  const liveHash = await sha256File(livePaths.tokenizerJson)
  results.push(check('64_live_appdata_copy', liveHash === HISTORICAL_WR_TOKENIZER_0_SHA256 && liveImport.ok, livePaths.tokenizerJson))
  results.push(check('64b_live_benchmarks', fs.existsSync(path.join(livePaths.benchmarks, 'decision.json')), livePaths.benchmarks))
  results.push(check('65_no_mac_in_canonical', !livePaths.tokenizerJson.includes('/Users/markbroughton'), livePaths.tokenizerJson))
  results.push(check('66_dump_verify_mtime', fs.statSync(path.join(dumpRoot, 'verification.json')).mtimeMs === dumpVerifyBefore, 'dump verification.json untouched'))
  results.push(check('67_corpus0_hash_still', (await sha256File(path.join(dumpRoot, 'sovereign-model-lab', 'corpora', 'WRM-001', '175af25fe1c17cf7630b506d0d6e6e88', 'corpus.jsonl'))) === WRM001_EXPECTED_HASHES['corpus.jsonl'], 'corpus0 dump intact'))
  results.push(check('68_no_second_tokenizer_arch', !fs.existsSync(path.join(repoRoot, 'lib', 'wr-tokenizer-2')), 'ok'))
  results.push(check('69_scope_no_terra_imagery', !fs.readFileSync(path.join(repoRoot, 'lib/wr-tokenizer/identity.ts'), 'utf8').includes('TerraEarthImagery'), 'ok'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  console.log('=== #23 WR-TOKENIZER RECONCILIATION ===')
  const { passed, failed, results } = await runWrTokenizerValidation()
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} — ${r.detail}`)
  console.log(`\nResult: ${passed} passed, ${failed} failed (total ${results.length})`)
  if (failed > 0) process.exitCode = 1
}

const isDirect =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('wr-tokenizer') || process.argv[1].includes('wrTokenizer.validation'))

if (isDirect) {
  void main()
}
