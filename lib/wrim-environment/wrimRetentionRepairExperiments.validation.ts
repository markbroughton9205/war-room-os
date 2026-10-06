/**
 * #23 WRIM retention-repair experiment freeze validation.
 * Design only. Zero optimizer steps. No P3/STAGE3B. No promotion.
 */
import fs from 'node:fs'
import path from 'node:path'
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
import { P2_SOVEREIGN_STREAM_SHA256 } from './foundationalP2'
import { P2_AUTHORIZED_RECIPE_SHA256 } from './foundationalP2Train'
import { STOP_POLICY_VERSION } from './stopPolicy'
import {
  PER_STEP_METRIC_KEYS,
} from './observabilityEvents'
import {
  RB_EXP_A_ID,
  RB_EXP_A_MAX_TOKENS,
  RB_EXP_A_RECIPE_SHA256,
  RB_EXP_B_COSINE_DECAY_STEPS,
  RB_EXP_B_HORIZON,
  RB_EXP_B_ID,
  RB_EXP_B_MAX_TOKENS,
  RB_EXP_B_OLD_RECIPE_SHA256,
  RB_EXP_B_RECIPE_SHA256,
  RB_EXP_B_WARMUP,
  RB_EXP_C_ID,
  RB_EXP_C_MAX_TOKENS,
  RB_EXP_C_MIN_LR,
  RB_EXP_C_PEAK_LR,
  RB_EXP_C_RECIPE_SHA256,
  RB_EXP_ORDER,
  RB_FIRST_LAMBDA,
  RB_LAMBDA_CANDIDATES,
  RB_TRAINING_AUTHORIZED,
  RETENTION_REPAIR_BASELINE_RECIPE_SHA256,
  RETENTION_REPAIR_CLASSIFICATIONS,
  RETENTION_REPAIR_KIND,
} from './retentionRepairExperiments'
import { resolveWrimEnvironmentPaths } from './paths'
import { tryForbiddenEnvAction } from './redTeam'
import { wrimEnvironmentStatusPayload } from './status'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function noOptimizer(src: string): boolean {
  return !src.includes('optimizer.step(') && !src.includes('AdamW(') && !src.includes('torch.optim')
}

export async function runRetentionRepairExperimentsValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.retentionRepairExperimentsReportPath)
    ? (JSON.parse(fs.readFileSync(live.retentionRepairExperimentsReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const py = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/retention_repair_experiments.py'), 'utf8')
  const schedPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/retention_repair_schedule.py'), 'utf8')
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts/run-wrim-retention-repair-experiments.mjs'), 'utf8')
  const status = wrimEnvironmentStatusPayload()
  const cls = String(report?.final_classification ?? '')
  const experiments = (report?.experiments ?? {}) as Record<string, Record<string, unknown>>
  const hashes = (report?.recipe_hashes ?? {}) as Record<string, string>
  const a = experiments[RB_EXP_A_ID] || {}
  const b = experiments[RB_EXP_B_ID] || {}
  const c = experiments[RB_EXP_C_ID] || {}
  const sweep = (report?.lambda_sweep ?? {}) as Record<string, unknown>
  const order = Array.isArray(report?.execution_order) ? (report.execution_order as string[]) : []
  const obs = (report?.observability ?? {}) as Record<string, unknown>
  const required = (obs.per_optimizer_step_required ?? []) as string[]
  const gates = (report?.stop_gates ?? {}) as Record<string, unknown>
  const extra = (gates.additional_hard_gates_not_in_stop_policy_json ?? {}) as Record<string, unknown>
  const oneVar = (report?.one_variable_changes ?? {}) as Record<string, Record<string, unknown>>
  const revised = (report?.revised_schedule ?? {}) as Record<string, unknown>
  const superseded = ((report?.superseded_unexecuted ?? {}) as Record<string, Record<string, unknown>>)[RB_EXP_B_ID] || {}
  const hashStatus = (report?.recipe_hash_status ?? {}) as Record<string, string>
  const cumRev = (revised.cumulative_lr ?? {}) as Record<string, number>
  const cum005 = (revised.comparison_RUN_000005 ?? {}) as Record<string, number>

  results.push(check('1_kind', report?.kind === RETENTION_REPAIR_KIND, String(report?.kind)))
  results.push(check('2_identity', report?.parent_sha256 === PARENT_SHA256 && report?.tokenizer_sha256 === TOKENIZER_SHA256 && report?.stream_sha256 === P2_SOVEREIGN_STREAM_SHA256 && report?.baseline_recipe_sha256 === RETENTION_REPAIR_BASELINE_RECIPE_SHA256 && RETENTION_REPAIR_BASELINE_RECIPE_SHA256 === P2_AUTHORIZED_RECIPE_SHA256, String(report?.stream_sha256)))
  results.push(check('3_no_train', report?.optimizer_steps_this_pass === 0 && report?.optimizer_steps === 0 && report?.AdamW_constructed === false && report?.tokens_trained === 0 && report?.experiments_executed === false && noOptimizer(py) && noOptimizer(schedPy) && noOptimizer(runner), 'zero'))
  results.push(check('4_exp_a_objective', a.experiment_id === RB_EXP_A_ID && a.principal_variable === 'training_objective' && Number(a.lambda) === RB_FIRST_LAMBDA && Number(a.peak_lr) === 1e-5 && Number(a.scheduler_total_steps) === 1000 && Number(a.max_authorized_tokens) === RB_EXP_A_MAX_TOKENS && hashes[RB_EXP_A_ID] === RB_EXP_A_RECIPE_SHA256, String(a.lambda)))
  results.push(check('5_exp_b_schedule', b.experiment_id === RB_EXP_B_ID && Number(b.warmup_steps) === RB_EXP_B_WARMUP && Number(b.total_steps) === RB_EXP_B_HORIZON && Number(b.scheduler_total_steps) === 50 && Number(b.cosine_decay_steps) === RB_EXP_B_COSINE_DECAY_STEPS && Number(b.peak_lr) === 1e-5 && Number(b.min_lr) === 1e-6 && Number(b.lambda) === 0 && Number(b.max_authorized_tokens) === RB_EXP_B_MAX_TOKENS && String((b.objective as Record<string, unknown> | undefined)?.combine) === 'L = CE_stream', String(b.scheduler_total_steps)))
  results.push(check('6_exp_c_peak', c.experiment_id === RB_EXP_C_ID && Number(c.peak_lr) === RB_EXP_C_PEAK_LR && Number(c.min_lr) === RB_EXP_C_MIN_LR && Number(c.scheduler_total_steps) === 1000 && Number(c.lambda) === 0 && Number(c.max_authorized_tokens) === RB_EXP_C_MAX_TOKENS && hashes[RB_EXP_C_ID] === RB_EXP_C_RECIPE_SHA256, String(c.peak_lr)))
  results.push(check('7_one_variable', Boolean(oneVar[RB_EXP_A_ID]) && Boolean(oneVar[RB_EXP_B_ID]) && Boolean(oneVar[RB_EXP_C_ID]) && String(((oneVar[RB_EXP_B_ID] || {}).changed as string[] | undefined)?.[0] || '').includes('1000->50'), 'one-var'))
  results.push(check('8_lambda_sweep_not_run', sweep.executed === false && Number(sweep.first_run_lambda) === RB_FIRST_LAMBDA && JSON.stringify(sweep.candidates) === JSON.stringify([...RB_LAMBDA_CANDIDATES]) && typeof hashes[`${RB_EXP_A_ID}__lambda_0.05`] === 'string', String(sweep.first_run_lambda)))
  results.push(check('9_hashes', hashes[RB_EXP_A_ID] === RB_EXP_A_RECIPE_SHA256 && hashes[RB_EXP_B_ID] === RB_EXP_B_RECIPE_SHA256 && String(hashes[RB_EXP_B_ID]) !== RB_EXP_B_OLD_RECIPE_SHA256 && hashes[RB_EXP_C_ID] === RB_EXP_C_RECIPE_SHA256 && a.recipe_sha256 === hashes[RB_EXP_A_ID], String(hashes[RB_EXP_B_ID])))
  results.push(check('10_order', JSON.stringify(order) === JSON.stringify([...RB_EXP_ORDER]) && report?.recommended_first_experiment === RB_EXP_B_ID && report?.do_not_automatically_proceed === true, JSON.stringify(order)))
  results.push(check('11_stop_gates', Boolean(report?.stop_gates) && gates.stop_policy_version === STOP_POLICY_VERSION && gates.stop_policy_unchanged === true && gates.no_weaker_retention_gates === true && Number(extra.item_max_dnll_gt) === 0.105 && gates.continuation_ce_cannot_override_retention_failure === true, STOP_POLICY_VERSION))
  results.push(check('12_observability', required.includes('post_clip_gradient_norm') && required.includes('cumulative_lr_exposure') && required.includes('parameter_norm') && required.includes('update_weight_ratio') && required.includes('stream_position') && obs.direct_tensorboard_mlflow_aim_from_trainer === false && PER_STEP_METRIC_KEYS.includes('post_clip_gradient_norm') && PER_STEP_METRIC_KEYS.includes('ce_stream_loss'), 'bus'))
  results.push(check('13_classification', (RETENTION_REPAIR_CLASSIFICATIONS as readonly string[]).includes(cls) && cls === 'WRIM_RETENTION_REPAIR_EXPERIMENTS_CORRECTED_AND_FROZEN' && RB_TRAINING_AUTHORIZED === false, cls))
  results.push(check('14_auth_off', TRAINING_AUTHORIZATION === 'OFF' && report?.TRAINING_AUTHORIZATION === 'OFF' && report?.training_authorized === false && CURRENT_WRIM_TRAINING === 'NOT_RUNNING' && status.train_button === false, TRAINING_AUTHORIZATION))
  results.push(check('15_no_p3_stage3b', report?.P3_AUTHORIZED === false && report?.STAGE3B_AUTHORIZATION === 'NO' && STAGE3_AUTHORIZATION === 'NO' && STAGE3B_EXECUTION_READINESS === false && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED' && report?.no_capacity_expansion === true, 'blocked'))
  results.push(check('16_nothing_pushed_deployed_installed', report?.nothing_pushed === true && report?.nothing_deployed === true && report?.nothing_installed === true && report?.weights_mutated === false && report?.corpus_mutated === false && report?.tokenizer_mutated === false && tryForbiddenEnvAction('PUSH_CHANGES').denied && QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && RAEL_STATUS === 'NOT_IMPLEMENTED', 'denied'))
  results.push(check('17_identity_lock', (['FOUNDATIONAL_P2_ROOT_CAUSE_COMPLETE', 'P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN', 'STAGE3A_CANDIDATE_ADJUDICATION_COMPLETE'].includes(NEXT_AUTHORIZED_PASS)) && status.next_authorized_pass === NEXT_AUTHORIZED_PASS, NEXT_AUTHORIZED_PASS))
  results.push(check('18_warmup_lt_total_for_decay', Number(b.warmup_steps) < Number(b.total_steps) && Number(b.warmup_steps) < Number(b.scheduler_total_steps) && Number(c.warmup_steps) < Number(c.scheduler_total_steps), `warmup=${String(b.warmup_steps)} total=${String(b.total_steps)}`))
  results.push(check('18b_reject_warmup_ge_total', py.includes('warmup_steps >= total_steps') && schedPy.includes('WARMUP_STEPS < HORIZON_B') && Number(revised.cosine_decay_steps) === 25, 'reject-warmup-ge-total'))
  results.push(check('19_old_hash_superseded', superseded.status === 'SUPERSEDED_UNEXECUTED' && superseded.old_recipe_sha256 === RB_EXP_B_OLD_RECIPE_SHA256 && hashStatus[RB_EXP_B_ID] === 'REGENERATED' && hashStatus[RB_EXP_A_ID] === 'PRESERVED' && hashStatus[RB_EXP_C_ID] === 'PRESERVED', String(superseded.old_recipe_sha256)))
  results.push(check('20_revised_lr_shape', Number(revised.step_26) < 1e-5 && Number(revised.step_50) <= 1e-6 + 1e-12 && Number(revised.peak_lr) === 1e-5 && Number(revised.min_lr) === 1e-6 && Number(cumRev['26_50']) < 0.60 * Number(cum005['26_50']), `s26=${String(revised.step_26)} s50=${String(revised.step_50)}`))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runRetentionRepairExperimentsValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
