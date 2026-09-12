/**
 * #23 Nebula WRIM-1 rebuild training DESIGN validation.
 * Does not install. Does not convert. Does not train. Does not create Ra'el.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSovereignRuntimeTruth } from '@/lib/sovereign-runtime/runtimeTruth'
import { ascensionAutonomyIsOff } from '@/lib/ascension/operationalRegistry'
import {
  CURRENT_PRODUCTION_WRIM as CORPUS_PRODUCTION_WRIM,
  HISTORICAL_WR_TOKENIZER_0_SHA256,
  HISTORICAL_WRIM_0_SHA256 as CORPUS_WRIM0_SHA,
  RAEL_STATUS as CORPUS_RAEL,
  ROADMAP_22_STATUS as CORPUS_22,
  ROADMAP_23_STATUS as CORPUS_23,
} from '@/lib/wr-corpus/identity'
import { defaultRecoveryDumpRoot } from '@/lib/wr-corpus/recoverySource'
import { dumpWrim0FinalWeights } from '@/lib/wrim-reconciliation/paths'
import { WRIM_RECONCILIATION } from '@/lib/wrim-reconciliation/identity'
import { CORPUS_MIX, EVAL_SUITE_PLAN, TRAIN_VAL_SPLIT } from './corpusMix'
import { PERIOD_COLLAPSE_SENTINEL, PROMOTION_GATES, RETENTION_GATE } from './gates'
import { runWrimRebuildDesign } from './design'
import {
  ARCHITECTURE_FAMILY,
  CONTEXT_LENGTH,
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  FORBIDDEN_OFFICIAL_RUN_IDS,
  FORBIDDEN_REBUILD_ACTIONS,
  MOE_THIS_PASS,
  NEXT_AUTHORIZED_PASS,
  PARAM_COUNT,
  PARENT_MODEL_ID,
  PARENT_SHA256,
  PEAK_LR,
  RAEL_STATUS,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  SMOKE_ARGMAX_ID,
  SPARSE_STREAMING_THIS_PASS,
  STAGE3_OFFICIAL_RUN_ID,
  TOKENIZER_ID,
  TOKENIZER_SHA256,
  TRAINING_AUTHORIZATION,
  WRIM_REBUILD_DESIGN,
  WRIM_REBUILD_DESIGN_DECISION,
} from './identity'
import { INITIALIZATION, SOFTWARE_INSTALL_PLAN } from './installPlan'
import { LR_SCHEDULE, peakLrIsConservative } from './optimizer'
import { PACKING_ALGORITHM, packingIsContiguous } from './packing'
import { NUMERICAL_EQUIVALENCE, PYTORCH_PORT } from './pytorchPort'
import { tryForbiddenRebuildAction } from './redTeam'
import { wrimRebuildDesignStatusPayload } from './status'
import { BATCH_PLAN, STAGE_PLAN } from './stages'
import { expectedModelTensorCount, lmHeadPolicy } from './weightMapping'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export async function runWrimRebuildDesignValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrim-rebuild-design-'))
  const dumpRoot = defaultRecoveryDumpRoot()
  const wrim0Path = dumpWrim0FinalWeights(dumpRoot)
  const wrim0MtimeBefore = fs.statSync(wrim0Path).mtimeMs
  const { report, parentSha, tokenizerSha } = await runWrimRebuildDesign({ dumpRoot, dataDirOverride: tmp })
  const wrim0MtimeAfter = fs.statSync(wrim0Path).mtimeMs

  results.push(check('1_parent_wrim0', PARENT_MODEL_ID === 'WRIM-0' && report.parent.id === 'WRIM-0', PARENT_MODEL_ID))
  results.push(check('2_parent_sha', parentSha === PARENT_SHA256 && parentSha === CORPUS_WRIM0_SHA && report.parent.match, parentSha))
  results.push(check('3_tokenizer_0', TOKENIZER_ID === 'WR-TOKENIZER-0', TOKENIZER_ID))
  results.push(check('4_tokenizer_sha', tokenizerSha === TOKENIZER_SHA256 && tokenizerSha === HISTORICAL_WR_TOKENIZER_0_SHA256 && report.tokenizer.match, tokenizerSha))
  results.push(check('5_dense_g20m', ARCHITECTURE_FAMILY === 'WRIM-G-20M-v1-option-A' && report.architecture.dense === true && PARAM_COUNT === 19_217_152, ARCHITECTURE_FAMILY))
  results.push(check('6_no_moe', MOE_THIS_PASS === false && report.architecture.moe === false, 'dense only'))
  results.push(check('7_no_sparse', SPARSE_STREAMING_THIS_PASS === false, 'later lane'))
  results.push(check('8_no_collapsed_parent', INITIALIZATION.collapsedWrim1 === false && INITIALIZATION.parent.includes('WRIM-0'), INITIALIZATION.parent))
  results.push(check('9_no_mlx_opt_resume', INITIALIZATION.resumeMlxOptimizer === false && report.weightMapping.optimizerKeys.resume === false, 'fresh AdamW'))
  results.push(check('10_packing_contiguous', packingIsContiguous(), PACKING_ALGORITHM.id))
  results.push(check('10b_shuffle_forbidden', PACKING_ALGORITHM.forbidden.some(f => /per-token shuffle/i.test(f)), 'shuffle forbidden'))
  results.push(check('11_eos_specified', PACKING_ALGORITHM.eosPolicy.id === 2 && PACKING_ALGORITHM.bosPolicy.id === 1, 'BOS=1 EOS=2'))
  results.push(check('12_rehearsal', CORPUS_MIX.percentages.wrCorpus0Rehearsal === 30 && CORPUS_MIX.rehearsal.fraction === 0.3, String(CORPUS_MIX.percentages.wrCorpus0Rehearsal)))
  results.push(check('13_tool_excluded', CORPUS_MIX.percentages.toolUse === 0 && CORPUS_MIX.toolUse.policy === 'EXCLUDED', CORPUS_MIX.toolUse.policy))
  results.push(check('14_eval_excluded', EVAL_SUITE_PLAN.keepOutOfTraining === true && TRAIN_VAL_SPLIT.neverTrain.some(x => x.includes('eval-only')), 'eval-only out'))
  results.push(check('15_leakage_required', TRAIN_VAL_SPLIT.leakageScanRequired === true, TRAIN_VAL_SPLIT.leakageScanWhen))
  results.push(check('16_lr_evidence', peakLrIsConservative() && LR_SCHEDULE.peakLr === PEAK_LR && LR_SCHEDULE.collapsedPeakForbidden === 3e-3, String(LR_SCHEDULE.peakLr)))
  results.push(check('17_batch_hardware', BATCH_PLAN.microBatch === 8 && BATCH_PLAN.sequenceLength === 512 && BATCH_PLAN.effectiveBatch === 8, `${BATCH_PLAN.microBatch}x${BATCH_PLAN.sequenceLength}`))
  results.push(check('18_context_512', CONTEXT_LENGTH === 512 && BATCH_PLAN.contextExpansion === false, String(CONTEXT_LENGTH)))
  results.push(check('19_stages_defined', STAGE_PLAN.stage0.trainingSteps === 0 && STAGE_PLAN.stage1.trainingSteps === 10 && STAGE_PLAN.stage2.trainingSteps === 50 && STAGE_PLAN.stage3.trainingSteps === 1500, '0/10/50/1500'))
  results.push(check('20_equivalence_gate', NUMERICAL_EQUIVALENCE.smokeBaseline.argmaxId === SMOKE_ARGMAX_ID && NUMERICAL_EQUIVALENCE.cudaFp32VsNumpy.argmax === 'exact token id required', 'argmax 126'))
  results.push(check('21_diagnostic_gate', STAGE_PLAN.stage1.promotionCandidate === false && STAGE_PLAN.stage1.tokens === 40960, String(STAGE_PLAN.stage1.tokens)))
  results.push(check('22_stability_gate', STAGE_PLAN.stage2.trainingSteps === 50 && STAGE_PLAN.stage2.kind === 'TEST_ONLY', STAGE_PLAN.stage2.id))
  results.push(check('23_official_gate', STAGE_PLAN.stage3.id === STAGE3_OFFICIAL_RUN_ID && !FORBIDDEN_OFFICIAL_RUN_IDS.includes(STAGE_PLAN.stage3.id as never), STAGE_PLAN.stage3.id))
  results.push(check('24_collapse_sentinel', PERIOD_COLLAPSE_SENTINEL.stopIfAny.length >= 3 && /STOP/.test(PERIOD_COLLAPSE_SENTINEL.rule), PERIOD_COLLAPSE_SENTINEL.id))
  results.push(check('25_retention_gate', RETENTION_GATE.baseline.includes('WRIM-0') && RETENTION_GATE.stopIf.length >= 2, 'vs WRIM-0'))
  results.push(check('26_checkpoint_policy', report.checkpoints.root.includes('wrim-checkpoints') && report.checkpoints.git === false, report.checkpoints.root))
  results.push(check('27_storage_quota', report.diskQuota.stopBelowGb === 32 && report.diskQuota.expandAutomatically === false, String(report.diskQuota.stopBelowGb)))
  results.push(check('28_manifest_defined', report.experimentManifest.includes('run ID') && report.experimentManifest.includes('parent model SHA'), String(report.experimentManifest.length)))
  results.push(check('29_reproducibility', report.reproducibility.runtimeSeed === 1337 && report.reproducibility.bitPerfectCrossGpu === false, String(report.reproducibility.runtimeSeed)))
  results.push(check('30_promotion_gates', PROMOTION_GATES.rejectIfOutperformsOnOneMetricOnly === true && PROMOTION_GATES.allRequired.length >= 8, String(PROMOTION_GATES.allRequired.length)))
  results.push(check('31_qwen_unchanged', report.security.qwen.includes('THIRD_PARTY') && getSovereignRuntimeTruth().NATIVE_WRIM === 'NOT_IMPLEMENTED', 'qwen local third-party'))
  results.push(check('32_no_installation', SOFTWARE_INSTALL_PLAN.executeNow === false && report.executed.installation === false, 'plan only'))
  results.push(check('33_no_conversion', PYTORCH_PORT.conversionThisPass === false && report.executed.conversion === false, 'no conversion'))
  results.push(check('34_no_training', CURRENT_WRIM_TRAINING === 'NOT_RUNNING' && TRAINING_AUTHORIZATION === 'OFF' && report.executed.training === false, CURRENT_WRIM_TRAINING))
  results.push(check('35_no_model_mutation', wrim0MtimeAfter === wrim0MtimeBefore && report.parent.mtimeUnchanged === true, 'parent read-only'))
  results.push(check('36_no_rael', RAEL_STATUS === 'NOT_IMPLEMENTED' && CORPUS_RAEL === 'NOT_IMPLEMENTED' && report.executed.rael === false, RAEL_STATUS))
  results.push(check('37_autonomy_off', ascensionAutonomyIsOff() && getSovereignRuntimeTruth().ASCENSION_AUTONOMY === 'OFF', 'OFF'))
  results.push(check('38_22_closed', ROADMAP_22_STATUS === 'CLOSED' && CORPUS_22 === 'CLOSED', ROADMAP_22_STATUS))
  results.push(check('39_23_active', ROADMAP_23_STATUS === 'ACTIVE' && CORPUS_23 === 'ACTIVE' && WRIM_RECONCILIATION === 'COMPLETE', ROADMAP_23_STATUS))
  results.push(check('40_nothing_pushed', report.executed.push === false, 'no push'))
  results.push(check('41_nothing_deployed', report.executed.deploy === false, 'no deploy'))

  results.push(check('42_weight_map_164', expectedModelTensorCount() === 164 && report.weightMapping.count === 164 && report.weightMapping.shapeCheck.ok, String(expectedModelTensorCount())))
  results.push(check('43_tied_no_lm_head', lmHeadPolicy().independentLmHead === false && lmHeadPolicy().createParameter === false, 'tied embeddings'))
  results.push(check('44_run_id_new', STAGE3_OFFICIAL_RUN_ID === 'WRIM1-RUN-000003', STAGE3_OFFICIAL_RUN_ID))
  results.push(check('45_decision_ready', report.decision === WRIM_REBUILD_DESIGN_DECISION && WRIM_REBUILD_DESIGN === 'COMPLETE', report.decision))
  results.push(check('46_next_pass_env_setup', NEXT_AUTHORIZED_PASS === 'NEBULA_PYTORCH_CUDA_ENVIRONMENT_SETUP', NEXT_AUTHORIZED_PASS))
  results.push(check('47_status_no_train', wrimRebuildDesignStatusPayload(tmp).train_button === false, 'no train button'))
  results.push(check('48_red_team', FORBIDDEN_REBUILD_ACTIONS.every(a => tryForbiddenRebuildAction(a).denied), String(FORBIDDEN_REBUILD_ACTIONS.length)))
  results.push(check('49_no_18gb_copy', !fs.existsSync(path.join(tmp, 'data', 'wrim-checkpoints')) && report.checkpoints.copyMacRecoveryTree === false, 'no dump copy'))
  results.push(check('50_production_unchanged', CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED' && CORPUS_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', CURRENT_PRODUCTION_WRIM))
  results.push(check('51_active_excluded', CORPUS_MIX.percentages.wrCorpusActive === 0, 'ACTIVE not auto-included'))
  results.push(check('52_no_torch_import', !fs.readFileSync(path.join(repoRoot, 'lib/wrim-rebuild-design/design.ts'), 'utf8').includes('from \'torch\'') && !fs.existsSync(path.join(repoRoot, 'lib/wrim-rebuild-design/train.ts')), 'no train module'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  console.log('=== #23 NEBULA WRIM-1 REBUILD TRAINING DESIGN ===')
  const { passed, failed, results } = await runWrimRebuildDesignValidation()
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} — ${r.detail}`)
  console.log(`\nResult: ${passed} passed, ${failed} failed (total ${results.length})`)
  if (failed > 0) process.exitCode = 1
}

const isDirect =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('wrim-rebuild-design') || process.argv[1].includes('wrimRebuildDesign.validation'))

if (isDirect) {
  void main()
}
