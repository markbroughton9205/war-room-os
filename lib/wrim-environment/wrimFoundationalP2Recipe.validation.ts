/**
 * #23 WRIM1-RUN-000005 P2 training-recipe freeze validation.
 * Zero optimizer steps. Does not train. Does not start P3/STAGE3B.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  NEXT_AUTHORIZED_PASS,
  PARENT_SHA256,
  QWEN_INTELLIGENCE_CLASS,
  RAEL_STATUS,
  STAGE3_AUTHORIZATION,
  STAGE3B_EXECUTION_READINESS,
  TOKENIZER_SHA256,
  TRAINING_AUTHORIZATION,
} from './identity'
import { P1_SOVEREIGN_SEED } from './foundationalP1'
import {
  P2_COMPACT_CADENCE,
  P2_EXCLUDED_DOCUMENTS,
  P2_FULL_CADENCE,
  P2_MAX_STEPS,
  P2_MAX_TOKENS,
  P2_RUN_ID,
  P2_SOVEREIGN_PACKED_SOURCE_SHA256,
  P2_SOVEREIGN_STREAM_SHA256,
} from './foundationalP2'
import {
  P2_BETAS,
  P2_EPS,
  P2_EVAL_SEED,
  P2_GRAD_ACCUM,
  P2_GRAD_CLIP,
  P2_MICRO_BATCH,
  P2_MIN_LR,
  P2_OOM_POLICY,
  P2_PEAK_LR,
  P2_PRECISION,
  P2_RECIPE_CLASSIFICATION,
  P2_RECIPE_ID,
  P2_RECIPE_KIND,
  P2_RESUME_POLICY,
  P2_RUNTIME_SEED,
  P2_SCHEDULER,
  P2_SEQ_LEN,
  P2_TF32,
  P2_TOKENS_PER_STEP,
  P2_TOTAL_STEPS,
  P2_TRAINING_AUTHORIZED,
  P2_WARMUP_STEPS,
  P2_WEIGHT_DECAY,
} from './foundationalP2Recipe'
import { resolveWrimEnvironmentPaths } from './paths'
import { tryForbiddenEnvAction } from './redTeam'
import { wrimEnvironmentStatusPayload } from './status'
import { STOP_POLICY_VERSION } from './stopPolicy'
import { dumpTokenizerPath } from '../wr-tokenizer/inspect'
import { dumpWrim0FinalWeights } from '../wrim-reconciliation/paths'
import { sha256File } from '../wr-corpus/hashes'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function npyPayloadSha256(filePath: string): string {
  const buf = fs.readFileSync(filePath)
  if (buf.subarray(0, 6).toString('latin1') !== '\x93NUMPY') throw new Error(`not npy: ${filePath}`)
  const major = buf[6]
  const offset = major === 1 ? 10 + buf.readUInt16LE(8) : 12 + buf.readUInt32LE(8)
  return createHash('sha256').update(buf.subarray(offset)).digest('hex')
}

function noOptimizer(src: string): boolean {
  return !src.includes('optimizer.step(') && !src.includes('AdamW(') && !src.includes('torch.optim')
}

export async function runFoundationalP2RecipeValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.foundationalP2RecipeReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalP2RecipeReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const recipe = (report?.recipe ?? {}) as Record<string, unknown>
  const history = (report?.historical_configs_audited ?? {}) as Record<string, unknown>
  const arith = (report?.tokens_per_step_arithmetic ?? {}) as Record<string, unknown>
  const ckpt = (recipe.checkpoint_policy ?? {}) as Record<string, unknown>
  const rng = (recipe.rng_policy ?? {}) as Record<string, unknown>
  const sched = (report?.schedule_self_test ?? {}) as Record<string, unknown>
  const recipePy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/p2_recipe.py'), 'utf8')
  const schedPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/p2_schedule.py'), 'utf8')
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts/run-wrim-foundational-p2-recipe.mjs'), 'utf8')
  const packPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage1_pack.py'), 'utf8')
  const stopPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stop_policy.py'), 'utf8')
  const status = wrimEnvironmentStatusPayload()
  const sovereignNpy = path.join(live.foundationalP1SovereignDir, 'sovereign-p2-diagnostic-stream.npy')
  const parentSha = fs.existsSync(dumpWrim0FinalWeights()) ? await sha256File(dumpWrim0FinalWeights()) : ''
  const tokSha = fs.existsSync(dumpTokenizerPath()) ? await sha256File(dumpTokenizerPath()) : ''
  const sovereignOnDisk = fs.existsSync(sovereignNpy) ? npyPayloadSha256(sovereignNpy) : ''
  const claudeMd = fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8')
  const grid = history['Stage2_grid_WRIM1-NEBULA-STABILITY-GRID-000001'] as Record<string, unknown> | undefined
  const run3 = history['RUN-000003_STAGE3A'] as Record<string, unknown> | undefined
  const run4 = history['RUN-000004_STAGE3A_corrective'] as Record<string, unknown> | undefined

  results.push(check('1_optimizer_zero', report?.optimizer_steps === 0 && report?.optimizer_steps_this_pass === 0 && report?.AdamW_constructed === false && noOptimizer(recipePy) && noOptimizer(schedPy) && noOptimizer(runner), String(report?.optimizer_steps)))
  results.push(check('2_tokens_zero', report?.tokens_trained === 0, String(report?.tokens_trained)))
  results.push(check('3_seed_2303', report?.seed === P1_SOVEREIGN_SEED && recipe.seed === P1_SOVEREIGN_SEED, String(report?.seed)))
  results.push(check('4_stream_sha', report?.stream_sha256 === P2_SOVEREIGN_STREAM_SHA256 && sovereignOnDisk === P2_SOVEREIGN_STREAM_SHA256 && recipe.stream_sha === P2_SOVEREIGN_STREAM_SHA256, String(report?.stream_sha256)))
  results.push(check('5_packed_source_sha', report?.packed_source_sha256 === P2_SOVEREIGN_PACKED_SOURCE_SHA256 && recipe.packed_source_sha256 === P2_SOVEREIGN_PACKED_SOURCE_SHA256, String(report?.packed_source_sha256)))
  results.push(check('6_parent', report?.parent_sha256 === PARENT_SHA256 && parentSha === PARENT_SHA256 && recipe.parent === 'WRIM-0', String(report?.parent_sha256)))
  results.push(check('7_tokenizer', report?.tokenizer_sha256 === TOKENIZER_SHA256 && tokSha === TOKENIZER_SHA256, String(report?.tokenizer_sha256)))
  results.push(check('8_sovereignty', report?.sovereignty_exclusions_unchanged === true && report?.claude_md_on_disk_untouched === true && claudeMd.includes('guidance to Claude Code') && JSON.stringify(P2_EXCLUDED_DOCUMENTS).includes('CLAUDE.md'), 'excluded'))
  results.push(check('9_historical_audited', Boolean(history['WRIM-0_mac_genesis']) && Boolean(history['Stage1_WRIM1-NEBULA-DIAG-000001']) && Boolean(history['Stage2_WRIM1-NEBULA-STAB-000001']), 'history'))
  results.push(check('10_stage2_grid', Number(grid?.n_healthy) === 40 && Number(grid?.n_aborted) === 0 && Array.isArray(grid?.peak_lrs), String(grid?.n_healthy)))
  results.push(check('11_run_000003', Number(run3?.peak_lr) === 2e-5 && Number(run3?.warmup) === 25, String(run3?.peak_lr)))
  results.push(check('12_run_000004', Number(run4?.peak_lr) === 1e-5 && Number(run4?.warmup) === 8, String(run4?.peak_lr)))
  results.push(check('13_peak_lr', recipe.peak_lr === P2_PEAK_LR && P2_PEAK_LR === 1e-5 && schedPy.includes('PEAK_LR = 1e-5'), String(recipe.peak_lr)))
  results.push(check('14_min_lr', recipe.min_lr === P2_MIN_LR && P2_MIN_LR === 1e-6, String(recipe.min_lr)))
  results.push(check('15_scheduler', recipe.scheduler === P2_SCHEDULER && sched.ok === true && typeof recipe.scheduler_formula === 'string', String(recipe.scheduler)))
  results.push(check('16_warmup', recipe.warmup_steps === P2_WARMUP_STEPS && recipe.total_steps === P2_TOTAL_STEPS && P2_WARMUP_STEPS === 25, String(recipe.warmup_steps)))
  results.push(check('17_beta1', recipe.beta1 === P2_BETAS[0] && (recipe.betas as number[])[0] === 0.9, String(recipe.beta1)))
  results.push(check('18_beta2', recipe.beta2 === P2_BETAS[1] && (recipe.betas as number[])[1] === 0.95, String(recipe.beta2)))
  results.push(check('19_eps', recipe.eps === P2_EPS && P2_EPS === 1e-8, String(recipe.eps)))
  results.push(check('20_weight_decay', recipe.weight_decay === P2_WEIGHT_DECAY && P2_WEIGHT_DECAY === 0.1, String(recipe.weight_decay)))
  results.push(check('21_grad_clip', recipe.grad_clip === P2_GRAD_CLIP && recipe.grad_clip_type === 'global_l2_norm' && recipe.grad_scaler === false, String(recipe.grad_clip)))
  results.push(check('22_precision', recipe.precision === P2_PRECISION && P2_PRECISION === 'FP32', String(recipe.precision)))
  results.push(check('23_tf32', recipe.tf32 === P2_TF32 && P2_TF32 === false, String(recipe.tf32)))
  results.push(check('24_microbatch', recipe.micro_batch === P2_MICRO_BATCH && recipe.sequence_length === P2_SEQ_LEN, String(recipe.micro_batch)))
  results.push(check('25_grad_accum', recipe.grad_accum === P2_GRAD_ACCUM && P2_GRAD_ACCUM === 1, String(recipe.grad_accum)))
  results.push(check('26_tokens_arithmetic', recipe.effective_tokens_per_step === P2_TOKENS_PER_STEP && arith.product === 4096 && P2_SEQ_LEN * P2_MICRO_BATCH * P2_GRAD_ACCUM === P2_MAX_TOKENS / P2_MAX_STEPS && packPy.includes('def slice_contiguous_batches') && P2_TOKENS_PER_STEP === 4096, String(arith.product)))
  results.push(check('27_checkpoint', Array.isArray(ckpt.save_weights_steps) && ckpt.always_save_weights_on_stop_policy_halt === true && ckpt.never_lose_terminal_state === true && JSON.stringify(ckpt.compact_eval_steps) === JSON.stringify([...P2_COMPACT_CADENCE]) && JSON.stringify(ckpt.full_eval_steps) === JSON.stringify([...P2_FULL_CADENCE]), 'ckpt'))
  results.push(check('28_resume', recipe.resume_policy === P2_RESUME_POLICY && P2_RESUME_POLICY === 'RESTART_REQUIRED_NOT_RESUMABLE', String(recipe.resume_policy)))
  results.push(check('29_rng', rng.python_seed === P2_RUNTIME_SEED && rng.eval_seed === P2_EVAL_SEED && rng.reproducibility_class === 'STATISTICALLY_REPRODUCIBLE' && rng.bitwise_reproducible === false, String(rng.python_seed)))
  results.push(check('30_oom', recipe.oom_policy === P2_OOM_POLICY && recipe.oom_no_dynamic_recipe_change === true, String(recipe.oom_policy)))
  results.push(check('31_stop_policy', report?.stop_policy_version === STOP_POLICY_VERSION && report?.stop_policy_unchanged === true && String(recipe.stop_policy_enforcement).includes('next_optimizer_step_allowed') && stopPy.includes('def decide('), STOP_POLICY_VERSION))
  results.push(check('32_no_training', report?.training_authorized === false && report?.P2_TRAINING_AUTHORIZED === false && P2_TRAINING_AUTHORIZED === false && TRAINING_AUTHORIZATION === 'OFF' && CURRENT_WRIM_TRAINING === 'NOT_RUNNING' && status.train_button === false, 'off'))
  results.push(check('33_no_p3', report?.P3_AUTHORIZED === false, String(report?.P3_AUTHORIZED)))
  results.push(check('34_no_stage3b', report?.STAGE3B_AUTHORIZATION === 'NO' && STAGE3_AUTHORIZATION === 'NO' && STAGE3B_EXECUTION_READINESS === false, 'NO'))
  results.push(check('35_nothing_pushed_deployed', report?.nothing_pushed === true && report?.nothing_deployed === true && tryForbiddenEnvAction('PUSH_CHANGES').denied && tryForbiddenEnvAction('START_STAGE_3').denied && QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && RAEL_STATUS === 'NOT_IMPLEMENTED' && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', 'denied'))
  results.push(check('36_ready', report?.ok === true && report?.kind === P2_RECIPE_KIND && report?.recipe_id === P2_RECIPE_ID && report?.final_classification === P2_RECIPE_CLASSIFICATION && typeof report?.recipe_sha256 === 'string' && (report.recipe_sha256 as string).length === 64 && recipe.run_id === P2_RUN_ID, String(report?.recipe_sha256)))
  results.push(check('37_identity_lock', ['FOUNDATIONAL_P2_RECIPE_READY', 'FOUNDATIONAL_P2_DIAGNOSTIC_COMPLETE', 'FOUNDATIONAL_P2_ROOT_CAUSE_COMPLETE', 'P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN', 'STAGE3A_CANDIDATE_ADJUDICATION_COMPLETE'].includes(NEXT_AUTHORIZED_PASS) && status.next_authorized_pass === NEXT_AUTHORIZED_PASS, NEXT_AUTHORIZED_PASS))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runFoundationalP2RecipeValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
