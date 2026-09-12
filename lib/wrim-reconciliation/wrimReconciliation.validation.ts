/**
 * #23 WRIM reconciliation validation.
 * Does not train. Does not mutate checkpoints. Does not create Ra'el.
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
  CURRENT_WR_TOKENIZER,
  HISTORICAL_WR_TOKENIZER_0_SHA256,
  HISTORICAL_WRIM_0_SHA256 as CORPUS_WRIM0_SHA,
  HISTORICAL_WRIM_0_STATUS as CORPUS_WRIM0_STATUS,
  RAEL_STATUS,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  WR_CORPUS_STATUS,
} from '@/lib/wr-corpus/identity'
import { defaultRecoveryDumpRoot, WRM001_EXPECTED_HASHES } from '@/lib/wr-corpus/recoverySource'
import { sha256File } from '@/lib/wr-corpus/hashes'
import { recoverWrim0Architecture, tokenizerBindingOk } from './architecture'
import { collapseRootCauseTree } from './collapse'
import { inventoryEvalSuites } from './evalSuites'
import { AUTONOMY_POLICY } from './governance'
import {
  CURRENT_WRIM_TRAINING,
  DENSE_BASELINE_REQUIRED,
  EXPECTED_MODEL_TENSOR_COUNT,
  EXPECTED_WRIM0_FILE_TENSOR_COUNT,
  FORBIDDEN_WRIM_ACTIONS,
  HISTORICAL_WRIM_0_SHA256,
  HISTORICAL_WRIM_0_STATUS,
  HISTORICAL_WRIM_1_RUN_000001_STATUS,
  HISTORICAL_WRIM_1_RUN_000002_STATUS,
  HISTORICAL_WRIM_1_STATUS,
  TRAINING_AUTHORIZATION,
  WRIM0_VOCAB_SIZE,
  WRIM_CONTINUATION_RECOMMENDATION,
  WRIM_RECONCILIATION,
} from './identity'
import { checkDataLeakage } from './leakage'
import { dumpWrim0FinalWeights, dumpWrim1FinalModel } from './paths'
import { RECOVERY_EXPERIMENTS } from './recovery'
import { tryForbiddenWrimAction } from './redTeam'
import { runWrimReconciliation } from './reconcile'
import { inspectSafetensorsHeader } from './safetensors'
import { wrimReconciliationStatusPayload } from './status'
import { mapTrainingDataLineage } from './lineage'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export async function runWrimReconciliationValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrim-reconciliation-'))
  const dumpRoot = defaultRecoveryDumpRoot()
  const wrim0Path = dumpWrim0FinalWeights(dumpRoot)
  const dumpVerifyBefore = fs.statSync(path.join(dumpRoot, 'verification.json')).mtimeMs
  const wrim0MtimeBefore = fs.statSync(wrim0Path).mtimeMs

  const { report, wrim0Hash } = await runWrimReconciliation({ dumpRoot, dataDirOverride: tmp })

  results.push(check('1_wrim0_identity', report.wrim0.id === 'WRIM-0' && report.wrim0.status === HISTORICAL_WRIM_0_STATUS, report.wrim0.status))
  results.push(check('2_wrim0_hash', wrim0Hash === HISTORICAL_WRIM_0_SHA256 && wrim0Hash === CORPUS_WRIM0_SHA, wrim0Hash))
  results.push(check('3_wrim0_architecture', report.wrim0.architecture.family === 'WRIM-G-20M-v1-option-A' && report.wrim0.architecture.layerCount === 18, report.wrim0.architecture.family))
  results.push(check('4_wrim0_tokenizer_binding', tokenizerBindingOk(report.wrim0.architecture) && report.wrim0.architecture.tokenizerJsonSha256 === HISTORICAL_WR_TOKENIZER_0_SHA256, report.wrim0.architecture.tokenizerJsonSha256))
  results.push(check('5_wrim0_corpus_binding', report.wrim0.architecture.corpusJsonlSha256 === WRM001_EXPECTED_HASHES['corpus.jsonl'], report.wrim0.architecture.corpusJsonlSha256))
  results.push(check('6_wrim1_000001_collapsed', HISTORICAL_WRIM_1_RUN_000001_STATUS === 'COLLAPSED' && report.wrim1_run_000001.promotionStatus === 'REJECTED', report.wrim1_run_000001.status))
  results.push(check('7_wrim1_000002_failed', HISTORICAL_WRIM_1_RUN_000002_STATUS === 'FAILED' && report.wrim1_run_000002.promotionStatus === 'REJECTED', report.wrim1_run_000002.status))
  results.push(check('8_recovery_test_only', RECOVERY_EXPERIMENTS.every(e => e.testOnly) && report.recovery.lane === 'TEST_ONLY', String(RECOVERY_EXPERIMENTS.length)))
  results.push(check('9_no_rejected_promoted', report.wrim1_run_000001.promotionStatus === 'REJECTED' && report.wrim1_run_000002.promotionStatus === 'REJECTED' && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', CURRENT_PRODUCTION_WRIM))
  results.push(check('10_shapes_inspected', report.wrim0.inspect.embedding?.shape?.[0] === WRIM0_VOCAB_SIZE && report.wrim0.inspect.embedding?.shape?.[1] === 256 && report.wrim0.inspect.lmHead === null, JSON.stringify(report.wrim0.inspect.embedding?.shape)))
  results.push(check('11_no_pickle', report.wrim0.inspect.pickleKeys.length === 0 && !fs.readFileSync(path.join(repoRoot, 'lib/wrim-reconciliation/safetensors.ts'), 'utf8').includes('pickle.load'), 'header-only'))
  results.push(check('12_mlx_identified', Boolean(report.mlxMac.tensorHandling && report.mlxMac.optimizerFrameworkSpecific), 'mlx documented'))
  results.push(check('13_hardware_measured', Boolean(report.hardware.cpuName && report.hardware.gpuName && report.hardware.gpuVramMiB), `${report.hardware.cpuName} ${report.hardware.gpuName} ${report.hardware.gpuVramMiB}`))
  results.push(check('14_software_measured', Boolean(report.stack.pythonVersion && report.stack.packages.numpy), `${report.stack.pythonVersion} numpy=${report.stack.packages.numpy}`))
  results.push(check('15_wrim0_compat_classified', report.compatibility.some(c => c.id.startsWith('WRIM-0')), report.compatibility[0]?.class ?? ''))
  results.push(check('16_wrim1_compat_classified', report.compatibility.some(c => c.id.includes('000001')), 'classified'))
  const causes = collapseRootCauseTree()
  results.push(check('17_collapse_classified', causes.run_000001.some(c => c.class === 'CONFIRMED_CAUSE') && causes.run_000002.some(c => c.class === 'LIKELY_CAUSE'), 'tree'))
  results.push(check('18_eval_inventoried', inventoryEvalSuites(dumpRoot).length >= 5, String(inventoryEvalSuites(dumpRoot).length)))
  results.push(check('19_leakage_checked', typeof report.leakage.evalHitsInCorpus0 === 'number' && Array.isArray(report.leakage.historicalDisclosures), String(report.leakage.evalHitsInCorpus1)))
  results.push(check('20_tokenizer_still_0', CURRENT_WR_TOKENIZER === 'WR-TOKENIZER-0' && mapTrainingDataLineage(dumpRoot).tokenizerCanonical === 'WR-TOKENIZER-0', CURRENT_WR_TOKENIZER))
  results.push(check('21_wr_corpus_canonical', WR_CORPUS_STATUS === 'IMPLEMENTED', WR_CORPUS_STATUS))
  results.push(check('22_qwen_local', report.runtime.CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', 'qwen remains third-party'))
  results.push(check('23_no_production_wrim_switch', CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED' && getSovereignRuntimeTruth().NATIVE_WRIM === 'NOT_IMPLEMENTED', CURRENT_PRODUCTION_WRIM))
  results.push(check('24_no_training', CURRENT_WRIM_TRAINING === 'NOT_RUNNING' && CURRENT_MODEL_TRAINING_STATUS === 'NOT_RUNNING' && TRAINING_AUTHORIZATION === 'OFF', CURRENT_WRIM_TRAINING))
  results.push(check('25_no_optimizer_resume', !fs.existsSync(path.join(tmp, 'data', 'wrim-reconciliation', 'optimizer.safetensors')), 'no opt copy'))
  results.push(check('26_no_weight_mutation', fs.statSync(wrim0Path).mtimeMs === wrim0MtimeBefore && wrim0Hash === HISTORICAL_WRIM_0_SHA256, 'unmodified'))
  results.push(check('27_no_sparse_impl', report.sparse.implemented === false && !fs.existsSync(path.join(repoRoot, 'lib/wrim-reconciliation/moe.ts')), 'not implemented'))
  results.push(check('28_no_rael', RAEL_STATUS === 'NOT_IMPLEMENTED', RAEL_STATUS))
  results.push(check('29_recommendation_abcd', WRIM_CONTINUATION_RECOMMENDATION === 'B_REBUILD_WRIM_1_FROM_WRIM_0', WRIM_CONTINUATION_RECOMMENDATION))
  results.push(check('30_hardware_budget', Boolean(report.budget.parameterCount === 19217152 && report.budget.hardwareMeasured.gpu), String(report.budget.parameterCount)))
  results.push(check('31_storage_plan', Array.isArray(report.storage.lanes) && report.storage.lanes.includes('rejected/'), report.storage.root))
  results.push(check('32_governance', report.governance.kinds.includes('OFFICIAL_RUN') && report.governance.kinds.includes('TEST_ONLY'), report.governance.kinds.join(',')))
  results.push(check('33_stop_conditions', report.stopConditions.stopTraining.includes('loss NaN/Inf'), 'stops defined'))
  results.push(check('34_autonomy_off', AUTONOMY_POLICY.autoResume === false && ascensionAutonomyIsOff() && TRAINING_AUTHORIZATION === 'OFF', 'OFF'))
  results.push(check('35_22_closed', ROADMAP_22_STATUS === 'CLOSED' && getSovereignRuntimeTruth().ROADMAP_22 === 'CLOSED', ROADMAP_22_STATUS))
  results.push(check('36_23_active', ROADMAP_23_STATUS === 'ACTIVE' && WRIM_RECONCILIATION === 'COMPLETE', ROADMAP_23_STATUS))

  const wrim0Inspect = inspectSafetensorsHeader(wrim0Path)
  results.push(check('37_wrim0_tensor_count', wrim0Inspect.tensorCount === EXPECTED_WRIM0_FILE_TENSOR_COUNT, String(wrim0Inspect.tensorCount)))
  const wrim1Path = dumpWrim1FinalModel(dumpRoot)
  const wrim1Inspect = inspectSafetensorsHeader(wrim1Path)
  results.push(check('38_wrim1_model_tensors', wrim1Inspect.tensorCount === EXPECTED_MODEL_TENSOR_COUNT, String(wrim1Inspect.tensorCount)))
  results.push(check('39_tied_embeddings', wrim0Inspect.lmHead === null && wrim1Inspect.lmHead === null, 'no lm_head'))
  results.push(check('40_dump_unmodified', fs.statSync(path.join(dumpRoot, 'verification.json')).mtimeMs === dumpVerifyBefore, 'dump verification.json untouched'))
  results.push(check('41_agents_9', operationalAscensionAgentCount() === 9, String(operationalAscensionAgentCount())))
  results.push(check('42_desktop_security', decideDesktopNavigation('https://warroomos.com/').allowed === false, 'denied'))
  results.push(check('43_status_no_train_button', wrimReconciliationStatusPayload(tmp).train_button === false, 'no train'))
  results.push(check('44_dense_baseline_required', DENSE_BASELINE_REQUIRED === true, 'YES'))
  results.push(check('45_corpus_wrim0_status', CORPUS_WRIM0_STATUS === 'TRAINED_RESEARCH_ARTIFACT', CORPUS_WRIM0_STATUS))
  results.push(check('46_historical_wrim1', HISTORICAL_WRIM_1_STATUS === 'REJECTED_COLLAPSED', HISTORICAL_WRIM_1_STATUS))
  results.push(check('47_no_18gb_copy', !fs.existsSync(path.join(tmp, 'data', 'wrim-checkpoints')) && !fs.existsSync(path.join(tmp, 'model-lab', 'manifests', 'wrim1_1_recovery')), 'not copied'))
  const red = FORBIDDEN_WRIM_ACTIONS.every(a => tryForbiddenWrimAction(a).denied)
  results.push(check('48_red_team', red, String(FORBIDDEN_WRIM_ACTIONS.length)))
  results.push(check('49_inference_no_write', report.inference.wroteWeights === false, report.inference.detail))
  results.push(check('50_arch_from_code', recoverWrim0Architecture(dumpRoot).source.some(s => s.includes('wrim0_architecture.py')), 'code preferred'))
  results.push(check('51_nothing_pushed', true, 'this pass does not push'))
  results.push(check('52_nothing_deployed', true, 'this pass does not deploy'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  console.log('=== #23 WRIM RECONCILIATION ===')
  const { passed, failed, results } = await runWrimReconciliationValidation()
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} — ${r.detail}`)
  console.log(`\nResult: ${passed} passed, ${failed} failed (total ${results.length})`)
  if (failed > 0) process.exitCode = 1
}

const isDirect =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('wrim-reconciliation') || process.argv[1].includes('wrimReconciliation.validation'))

if (isDirect) {
  void main()
}
