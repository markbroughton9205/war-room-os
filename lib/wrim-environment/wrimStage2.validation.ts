/**
 * #23 Stage 2 stability validation. Does not train. Does not start Stage 3.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSovereignRuntimeTruth } from '@/lib/sovereign-runtime/runtimeTruth'
import { ascensionAutonomyIsOff } from '@/lib/ascension/operationalRegistry'
import {
  CURRENT_PRODUCTION_WRIM as CORPUS_PRODUCTION,
  RAEL_STATUS as CORPUS_RAEL,
  ROADMAP_22_STATUS as CORPUS_22,
  ROADMAP_23_STATUS as CORPUS_23,
  WRIM_STAGE1,
} from '@/lib/wr-corpus/identity'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  FORBIDDEN_ENV_ACTIONS,
  NEXT_AUTHORIZED_PASS,
  PARENT_SHA256,
  RAEL_STATUS,
  READY_FOR_STAGE3_TRAINING_AUTHORIZATION,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  STAGE1_RUN_ID,
  STAGE1_STATUS,
  STAGE2_RUN_ID,
  STAGE2_STATUS,
  TOKENIZER_SHA256,
  TRAINING_AUTHORIZATION,
} from './identity'
import { resolveWrimEnvironmentPaths } from './paths'
import { tryForbiddenEnvAction } from './redTeam'
import { STAGE2_CORPUS_GRANT } from './stage2CorpusGrant'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export async function runWrimStage2Validation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.stage2ReportPath)
    ? (JSON.parse(fs.readFileSync(live.stage2ReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const stage1 = fs.existsSync(live.stage1ReportPath)
    ? (JSON.parse(fs.readFileSync(live.stage1ReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const packing = (report?.packing ?? {}) as Record<string, unknown>
  const optimizer = (report?.optimizer ?? {}) as Record<string, unknown>
  const architecture = (report?.architecture ?? {}) as Record<string, unknown>
  const checkpoint = (report?.checkpoint ?? {}) as Record<string, unknown>
  const reload = (checkpoint.reload ?? {}) as Record<string, unknown>
  const steps = Array.isArray(report?.steps) ? (report!.steps as Array<Record<string, unknown>>) : []
  const evals = Array.isArray(report?.evals) ? (report!.evals as Array<Record<string, unknown>>) : []
  const evalSteps = new Set(evals.map(e => Number(e.step)))
  const lrByStep = Array.isArray(report?.lr_by_step) ? (report!.lr_by_step as number[]) : []
  const pyStage2 = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage2.py'), 'utf8')
  const pyPack = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage2_pack.py'), 'utf8')
  const pyEval = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage2_eval.py'), 'utf8')
  const pyModel = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/wrim_g20m.py'), 'utf8')
  const ckptDir = String(checkpoint.dir ?? live.stage2CheckpointDir)
  const sentinelFired = Array.isArray(report?.sentinel_events) && (report!.sentinel_events as unknown[]).length > 0
  const nSteps = Number(report?.n_steps ?? -1)
  const nTokens = Number(report?.tokens ?? -1)
  const rehearsalDev = Number(packing.rehearsal_deviation_pp ?? 99)
  const requiredStepFields = [
    'step',
    'tokens_seen',
    'lr',
    'train_loss',
    'grad_norm_pre_clip',
    'grad_norm_after_clip',
    'bounded_update_norm',
    'elapsed_s',
    'tokens_per_sec',
    'vram_allocated',
    'vram_reserved',
  ]

  results.push(check(
    '1_stage1_historical_test_only',
    WRIM_STAGE1 === 'STAGE1_VERIFIED'
      && STAGE1_STATUS === 'STAGE1_VERIFIED'
      && stage1?.run_id === STAGE1_RUN_ID
      && stage1?.kind === 'TEST_ONLY'
      && stage1?.stage2_started === false
      && stage1?.promotion_candidate !== true,
    String(stage1?.run_id),
  ))
  results.push(check('2_stage2_run_id', report?.run_id === STAGE2_RUN_ID && STAGE2_RUN_ID === 'WRIM1-NEBULA-STAB-000001' && report?.run_id !== 'WRIM1-RUN-000003', String(report?.run_id)))
  results.push(check('3_stage2_test_only', report?.kind === 'TEST_ONLY' && report?.classification === 'STABILITY' && report?.promotion_candidate === false, String(report?.kind)))
  results.push(check('4_parent_sha', report?.parent_sha === PARENT_SHA256, String(report?.parent_sha)))
  results.push(check('5_tokenizer_sha', report?.tokenizer_sha === TOKENIZER_SHA256, String(report?.tokenizer_sha)))
  results.push(check(
    '6_architecture_unchanged',
    architecture.id === 'WRIM-G-20M-v1-option-A'
      && architecture.layers === 18
      && architecture.moe === false
      && architecture.sparse === false
      && pyModel.includes('WRIM-G-20M-v1-option-A')
      && !pyStage2.toLowerCase().includes('mixture of experts'),
    String(architecture.id),
  ))
  results.push(check(
    '7_wrim0_parent',
    report?.starting_checkpoint === 'WRIM-0'
      && String(report?.starting_reason ?? '').includes('Fresh Stage 2 from WRIM-0')
      && optimizer.resumed_stage1 === false,
    String(report?.starting_checkpoint),
  ))
  results.push(check(
    '8_no_collapsed_parent',
    !String(report?.starting_checkpoint ?? '').includes('WRIM-1')
      && pyStage2.includes('not collapsed WRIM-1')
      && tryForbiddenEnvAction('USE_COLLAPSED_WRIM1').denied,
    String(report?.starting_checkpoint),
  ))
  results.push(check('9_rehearsal_target_30', packing.rehearsal_pct != null && Number((packing.target_mix as { wr_corpus_0_rehearsal?: number } | undefined)?.wr_corpus_0_rehearsal) === 30, String((packing.target_mix as { wr_corpus_0_rehearsal?: number } | undefined)?.wr_corpus_0_rehearsal)))
  results.push(check('10_actual_mix_within_5pp', packing.ratio_ok === true && rehearsalDev <= 5, `dev=${rehearsalDev}pp actual=${packing.rehearsal_pct}`))
  results.push(check('11_contiguous_packing', packing.contiguous_concat === true && packing.unit_token_order_preserved === true && packing.packer_version === 'contiguous-bounded-excerpt-v1', String(packing.packer_version)))
  results.push(check('12_no_token_shuffle', packing.historical_shuffle === 'FORBIDDEN' && pyPack.includes('Never permutes the 1-D token stream') && !pyPack.includes('np.random.permutation'), String(packing.historical_shuffle)))
  results.push(check('13_bos_eos', packing.bos_id === 1 && packing.eos_id === 2 && Number(packing.bos_count) > 0 && packing.bos_count === packing.eos_count && (report?.causal as { bos_present?: boolean; eos_present?: boolean } | undefined)?.bos_present === true, `bos=${packing.bos_count} eos=${packing.eos_count}`))
  results.push(check('14_tool_use_zero', packing.tool_use === 'EXCLUDED' && packing.tool_use_pct === 0, String(packing.tool_use_pct)))
  results.push(check('15_test_excluded', pyPack.includes('Eval-only / leakage') && Array.isArray(STAGE2_CORPUS_GRANT.notAuthorized) && STAGE2_CORPUS_GRANT.notAuthorized.includes('test shard'), 'test shard not authorized'))
  results.push(check('16_eval_only_excluded', STAGE2_CORPUS_GRANT.notAuthorized.includes('eval-only suites') && pyPack.toLowerCase().includes('eval-only'), 'eval-only excluded'))
  results.push(check('17_leakage_clean', Array.isArray(packing.leak_scan_hits) && (packing.leak_scan_hits as unknown[]).length === 0 && packing.packing_ok === true, `hits=${JSON.stringify(packing.leak_scan_hits)}`))
  results.push(check('18_fresh_adamw', optimizer.algorithm === 'AdamW' && optimizer.fresh === true && optimizer.resumed_mlx === false && optimizer.resumed_stage1 === false, String(optimizer.algorithm)))
  results.push(check('19_lr_cap', Number(report?.lr_peak) <= 3e-5 && lrByStep.length === nSteps && lrByStep.every(v => v <= 3e-5 + 1e-12) && !pyStage2.includes('3e-3') && !pyStage2.includes('3e-4'), String(report?.lr_peak)))
  results.push(check('20_fp32', report?.precision === 'FP32', String(report?.precision)))
  results.push(check('21_tf32_off', report?.tf32_enabled === false, String(report?.tf32_enabled)))
  results.push(check('22_seq_512', report?.sequence === 512, String(report?.sequence)))
  results.push(check('23_microbatch_8', report?.batch === 8, String(report?.batch)))
  results.push(check('24_accum_1', report?.accumulation === 1, String(report?.accumulation)))
  results.push(check('25_max_50_steps', nSteps <= 50 && Number(report?.max_authorized_steps) === 50 && pyStage2.includes('exactly 50 AdamW steps maximum') && nSteps === steps.length, String(nSteps)))
  results.push(check('26_max_204800_tokens', nTokens <= 204800 && Number(report?.max_authorized_tokens) === 204800, String(nTokens)))
  results.push(check(
    '27_metrics_each_step',
    steps.length === nSteps && steps.every((s, i) => s.step === i + 1 && requiredStepFields.every(k => s[k] != null) && s.loss_finite === true && s.grads_finite === true),
    String(steps.length),
  ))
  results.push(check('28_eval_step_0', evalSteps.has(0), [...evalSteps].join(',')))
  results.push(check('29_eval_step_10', evalSteps.has(10), [...evalSteps].join(',')))
  results.push(check('30_eval_step_20', evalSteps.has(20), [...evalSteps].join(',')))
  results.push(check('31_eval_step_30', evalSteps.has(30), [...evalSteps].join(',')))
  results.push(check('32_eval_step_40_or_earlier_sentinel', evalSteps.has(40) || (sentinelFired && nSteps < 40), sentinelFired ? `sentinel@${nSteps}` : [...evalSteps].join(',')))
  results.push(check('33_eval_step_50_or_earlier_sentinel', evalSteps.has(50) || sentinelFired, String(report?.stop_reason)))
  results.push(check('34_collapse_sentinel', pyEval.includes('DIAGNOSTIC-0 collapsed') && pyEval.includes('period/punctuation dominance'), 'enabled'))
  results.push(check('35_diversity_gate', pyEval.includes('two consecutive evals') && pyEval.includes('50% of WRIM-0'), 'enabled'))
  results.push(check('36_retention_gate', pyEval.includes('dropped by >=1 vs step-0'), String(report?.stop_reason)))
  results.push(check(
    '37_checkpoint_test_only',
    ckptDir.replaceAll('/', '\\').includes('\\wrim-checkpoints\\test-only\\WRIM1-NEBULA-STAB-000001')
      && !ckptDir.toLowerCase().includes('official')
      && !ckptDir.toLowerCase().includes('promoted')
      && fs.existsSync(path.join(ckptDir, 'model.safetensors')),
    ckptDir,
  ))
  results.push(check(
    '38_checkpoint_hash',
    typeof checkpoint.model_sha256 === 'string'
      && String(checkpoint.model_sha256).length === 64
      && checkpoint.hash_match === true
      && checkpoint.save_hash === reload.reload_hash,
    String(checkpoint.save_hash),
  ))
  results.push(check('39_reload_successful', checkpoint.fresh_process_ok === true && reload.n_tensors === 164 && reload.architecture === 'WRIM-G-20M-v1-option-A' && reload.tokenizer_bound === true, String(checkpoint.fresh_process_ok)))
  results.push(check('40_finite_post_reload', reload.finite_logits === true && reload.finite_entropy === true && Number.isFinite(Number(reload.entropy)), String(reload.entropy)))
  results.push(check('41_no_promotion', report?.promotion_candidate === false && tryForbiddenEnvAction('PROMOTE_STAGE_2').denied && STAGE2_STATUS === 'STAGE2_STOPPED_BY_SENTINEL', STAGE2_STATUS))
  results.push(check('42_no_stage3', report?.stage3_started === false && report?.READY_FOR_STAGE3_TRAINING_AUTHORIZATION === 'NO' && READY_FOR_STAGE3_TRAINING_AUTHORIZATION === false && tryForbiddenEnvAction('START_STAGE_3').denied, String(report?.READY_FOR_STAGE3_TRAINING_AUTHORIZATION)))
  results.push(check('43_qwen_unchanged', report?.QWEN === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && getSovereignRuntimeTruth().NATIVE_WRIM === 'NOT_IMPLEMENTED' && CORPUS_PRODUCTION === 'NOT_IMPLEMENTED', String(report?.QWEN)))
  results.push(check('44_no_sparse_experts', architecture.sparse === false && architecture.moe === false && !pyModel.toLowerCase().includes('sparse expert'), 'dense'))
  results.push(check('45_no_rael', RAEL_STATUS === 'NOT_IMPLEMENTED' && CORPUS_RAEL === 'NOT_IMPLEMENTED' && report?.RAEL === 'NOT_IMPLEMENTED', RAEL_STATUS))
  results.push(check('46_autonomy_off', ascensionAutonomyIsOff(), 'OFF'))
  results.push(check('47_22_closed', ROADMAP_22_STATUS === 'CLOSED' && CORPUS_22 === 'CLOSED', ROADMAP_22_STATUS))
  results.push(check('48_23_active', ROADMAP_23_STATUS === 'ACTIVE' && CORPUS_23 === 'ACTIVE', ROADMAP_23_STATUS))
  results.push(check('49_nothing_pushed', tryForbiddenEnvAction('PUSH_CHANGES').denied && CURRENT_WRIM_TRAINING === 'NOT_RUNNING', 'no push'))
  results.push(check('50_nothing_deployed', (NEXT_AUTHORIZED_PASS === 'PHASE2_PRIMARY_GRID' || NEXT_AUTHORIZED_PASS === 'PHASE2_GRID_REVIEW' || NEXT_AUTHORIZED_PASS === 'PHASE3A_INTERPOLATION' || NEXT_AUTHORIZED_PASS === 'PHASE3A_REVIEW') && FORBIDDEN_ENV_ACTIONS.includes('START_STAGE_3'), 'no deploy; Stage 3 denied'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  console.log('=== #23 WRIM-1 NEBULA STAGE 2 STABILITY VALIDATION ===')
  const { passed, failed, results } = await runWrimStage2Validation()
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} — ${r.detail}`)
  console.log(`\nResult: ${passed} passed, ${failed} failed (total ${results.length})`)
  if (failed > 0) process.exitCode = 1
}

const isDirect =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('wrimStage2.validation') || process.argv[1].includes('wrim-stage2'))

if (isDirect) {
  void main()
}
