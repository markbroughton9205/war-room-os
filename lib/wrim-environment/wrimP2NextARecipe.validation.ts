/**
 * #23 P2-NEXT-A_SCHEDULE_HORIZON recipe freeze validation.
 * Zero optimizer steps. Isolates cosine horizon 1000 -> 50. No KL term. No training.
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
import { P2_SOVEREIGN_PACKED_SOURCE_SHA256, P2_SOVEREIGN_STREAM_SHA256 } from './foundationalP2'
import { P2_AUTHORIZED_RECIPE_SHA256 } from './foundationalP2Train'
import {
  P2_NEXT_A_CLASSIFICATIONS,
  P2_NEXT_A_EXPERIMENT_ID,
  P2_NEXT_A_GRAD_CLIP,
  P2_NEXT_A_KIND,
  P2_NEXT_A_KL_IN_LOSS,
  P2_NEXT_A_MAX_TOKENS,
  P2_NEXT_A_MIN_LR,
  P2_NEXT_A_PEAK_LR,
  P2_NEXT_A_RECIPE_ID,
  P2_NEXT_A_RECIPE_SHA256,
  P2_NEXT_A_TOTAL_STEPS,
  P2_NEXT_A_TRAINING_AUTHORIZED,
  P2_NEXT_A_WARMUP_STEPS,
  P2_NEXT_A_WEIGHT_DECAY,
} from './p2NextARecipe'
import { PER_STEP_METRIC_KEYS } from './observabilityEvents'
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

export async function runP2NextARecipeValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.p2NextARecipeReportPath)
    ? (JSON.parse(fs.readFileSync(live.p2NextARecipeReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const recipe = (report?.recipe ?? {}) as Record<string, unknown>
  const objective = (recipe.objective ?? {}) as Record<string, unknown>
  const lrTable = (report?.lr_table ?? {}) as Record<string, number>
  const cum = (report?.cumulative_lr ?? {}) as Record<string, number>
  const obs = (report?.observability ?? {}) as Record<string, unknown>
  const required = (obs.per_optimizer_step_required ?? []) as string[]
  const gates = (report?.stop_gates ?? {}) as Record<string, unknown>
  const hard = (gates.hard_abort_canonical ?? {}) as Record<string, number>
  const success = (report?.success_criteria ?? {}) as Record<string, unknown>
  const matrix = (report?.interpretation_matrix ?? {}) as Record<string, unknown>
  const py = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/p2_next_a_recipe.py'), 'utf8')
  const schedPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/p2_next_a_schedule.py'), 'utf8')
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts/run-wrim-p2-next-a-recipe.mjs'), 'utf8')
  const status = wrimEnvironmentStatusPayload()
  const cls = String(report?.final_classification ?? '')
  const sovereignNpy = path.join(live.foundationalP1SovereignDir, 'sovereign-p2-diagnostic-stream.npy')
  const parentSha = fs.existsSync(dumpWrim0FinalWeights()) ? await sha256File(dumpWrim0FinalWeights()) : ''
  const tokSha = fs.existsSync(dumpTokenizerPath()) ? await sha256File(dumpTokenizerPath()) : ''
  const sovereignOnDisk = fs.existsSync(sovereignNpy) ? npyPayloadSha256(sovereignNpy) : ''

  results.push(check('1_kind', report?.kind === P2_NEXT_A_KIND && report?.recipe_id === P2_NEXT_A_RECIPE_ID && report?.experiment_id === P2_NEXT_A_EXPERIMENT_ID, String(report?.kind)))
  results.push(check('2_identity', report?.parent_sha256 === PARENT_SHA256 && parentSha === PARENT_SHA256 && report?.tokenizer_sha256 === TOKENIZER_SHA256 && tokSha === TOKENIZER_SHA256 && report?.stream_sha256 === P2_SOVEREIGN_STREAM_SHA256 && sovereignOnDisk === P2_SOVEREIGN_STREAM_SHA256 && report?.packed_source_sha256 === P2_SOVEREIGN_PACKED_SOURCE_SHA256 && recipe.baseline_recipe_sha256 === P2_AUTHORIZED_RECIPE_SHA256, String(report?.stream_sha256)))
  results.push(check('3_no_train', report?.optimizer_steps_this_pass === 0 && report?.optimizer_steps === 0 && report?.AdamW_constructed === false && report?.tokens_trained === 0 && report?.recipe_executed === false && noOptimizer(py) && noOptimizer(schedPy) && noOptimizer(runner), 'zero'))
  results.push(check('4_warmup_peak_min', Number(recipe.warmup_steps) === P2_NEXT_A_WARMUP_STEPS && Number(recipe.peak_lr) === P2_NEXT_A_PEAK_LR && Number(recipe.min_lr) === P2_NEXT_A_MIN_LR && Number(lrTable['25']) === P2_NEXT_A_PEAK_LR, String(recipe.warmup_steps)))
  results.push(check('5_horizon_50', Number(recipe.scheduler_total_steps) === P2_NEXT_A_TOTAL_STEPS && Number(recipe.total_steps) === 50 && Number(recipe.max_authorized_optimizer_steps) === 50 && recipe.no_step_51 === true && Number(recipe.next_unauthorized_step) === 51 && Number(recipe.max_authorized_tokens) === P2_NEXT_A_MAX_TOKENS, String(recipe.scheduler_total_steps)))
  results.push(check('6_decay_after_25', Number(lrTable['26']) < P2_NEXT_A_PEAK_LR && Math.abs(Number(lrTable['50']) - P2_NEXT_A_MIN_LR) < 1e-15 && schedPy.includes('progress=(step-25)/(50-25)') && !schedPy.includes('1000-25'), String(lrTable['26'])))
  results.push(check('7_cum_lr_reduced', Math.abs(Number(cum.next_a_1_25) - Number(cum.run_000005_1_25)) < 1e-18 && Number(cum.next_a_26_50) < Number(cum.run_000005_26_50) && Number(cum.next_a_1_50) < Number(cum.run_000005_1_50), String(cum.next_a_26_50)))
  results.push(check('8_optimizer_clip_wd', recipe.optimizer === 'AdamW' && Number(recipe.beta1) === 0.9 && Number(recipe.beta2) === 0.95 && Number(recipe.eps) === 1e-8 && Number(recipe.weight_decay) === P2_NEXT_A_WEIGHT_DECAY && Number(recipe.grad_clip) === P2_NEXT_A_GRAD_CLIP, String(recipe.optimizer)))
  results.push(check('9_ce_no_kl', objective.ordinary_continuation_ce === true && objective.kl_in_loss === P2_NEXT_A_KL_IN_LOSS && Number(objective.lambda) === 0 && objective.retention_loss === null && py.includes('KL_anchor_term'), 'ce-only'))
  results.push(check('10_stop_success', Number(hard.dnll_gt) === 0.105 && Number(hard.kl_gt) === 0.018 && report?.stop_policy_version === STOP_POLICY_VERSION && report?.stop_policy_unchanged === true && Boolean((success.step_50_schedule_success_requires_all as Record<string, unknown> | undefined)?.['6_validation_ce_alone_is_not_pass']), STOP_POLICY_VERSION))
  results.push(check('11_observability', required.includes('post_clip_gradient_norm') && required.includes('cumulative_lr_exposure') && required.includes('parameter_norm') && required.includes('update_weight_ratio') && required.includes('stream_position') && obs.direct_tensorboard_mlflow_aim_prometheus_from_trainer === false && PER_STEP_METRIC_KEYS.includes('post_clip_gradient_norm'), 'bus'))
  results.push(check('12_matrix_and_class', Boolean(matrix.CASE_A) && Boolean(matrix.CASE_B) && Boolean(matrix.CASE_C) && Boolean(matrix.CASE_D) && (P2_NEXT_A_CLASSIFICATIONS as readonly string[]).includes(cls) && cls === 'P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN' && report?.recipe_sha256 === P2_NEXT_A_RECIPE_SHA256, cls))
  results.push(check('13_auth_off', TRAINING_AUTHORIZATION === 'OFF' && report?.TRAINING_AUTHORIZATION === 'OFF' && P2_NEXT_A_TRAINING_AUTHORIZED === false && CURRENT_WRIM_TRAINING === 'NOT_RUNNING' && status.train_button === false && status.p2_authorized === false, TRAINING_AUTHORIZATION))
  results.push(check('14_no_p3_stage3b', report?.P3_AUTHORIZED === false && report?.STAGE3B_AUTHORIZATION === 'NO' && STAGE3_AUTHORIZATION === 'NO' && STAGE3B_EXECUTION_READINESS === false && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', 'blocked'))
  results.push(check('15_nothing_pushed_deployed_installed', report?.nothing_pushed === true && report?.nothing_deployed === true && report?.nothing_installed === true && report?.weights_unchanged === true && report?.corpus_unchanged === true && report?.tokenizer_unchanged === true && tryForbiddenEnvAction('PUSH_CHANGES').denied && QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && RAEL_STATUS === 'NOT_IMPLEMENTED', 'denied'))
  // The identity lock names the pass this report froze at, or any later pass the program has since legitimately reached (the same
  // "at least this far" convention every sibling stage validator in this file family uses for NEXT_AUTHORIZED_PASS).
  results.push(check('16_identity_lock', (['P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN', 'STAGE3A_CANDIDATE_ADJUDICATION_COMPLETE'].includes(NEXT_AUTHORIZED_PASS)) && status.next_authorized_pass === NEXT_AUTHORIZED_PASS, NEXT_AUTHORIZED_PASS))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runP2NextARecipeValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
