/**
 * #23 WRIM1-RUN-000003 Stage 3 execution-review validation.
 * Asserts trainer/runtime zero-step dry-run. Does not execute STAGE3A/STAGE3B.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  FORBIDDEN_ENV_ACTIONS,
  NEXT_AUTHORIZED_PASS,
  PARENT_SHA256,
  QWEN_INTELLIGENCE_CLASS,
  RAEL_STATUS,
  READY_FOR_STAGE3_TRAINING_AUTHORIZATION,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  STAGE3_AUTHORIZATION,
  STAGE3_EXECUTION_REVIEW,
  STAGE3_TRAINER_STATUS,
  STAGE3B_EXECUTION_READINESS,
  TOKENIZER_SHA256,
  TRAINING_AUTHORIZATION,
} from './identity'
import {
  STAGE3_EVAL_SUITE_SHA256,
  STAGE3_EVAL_SUITE_STATUS,
  STAGE3_WRIM0_BASELINE_SHA256,
  STAGE3B_LR_FORMULA,
  STAGE3B_MIN_LR,
  STAGE3B_START_LR,
} from './stage3Design'
import { resolveWrimEnvironmentPaths } from './paths'
import { tryForbiddenEnvAction } from './redTeam'
import { wrimEnvironmentStatusPayload } from './status'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export async function runStage3ExecutionValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const trainPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage3_train.py'), 'utf8')
  const schedPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage3_schedule.py'), 'utf8')
  const runtimePy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage3_runtime.py'), 'utf8')
  const designMd = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/STAGE3_DESIGN.md'), 'utf8')
  const suite = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/evals/WRIM-EVAL-S3-000001.json'), 'utf8')) as {
    suite_id?: string
    n_items?: number
    n_categories?: number
    items_per_category?: number
    suite_hash?: string
    status?: string
    items?: Array<{ category?: string }>
  }
  const dry = fs.existsSync(live.stage3DryRunReportPath)
    ? (JSON.parse(fs.readFileSync(live.stage3DryRunReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const denied = fs.existsSync(live.stage3TrainDeniedPath)
    ? (JSON.parse(fs.readFileSync(live.stage3TrainDeniedPath, 'utf8')) as Record<string, unknown>)
    : null
  const cats: Record<string, number> = {}
  for (const it of suite.items ?? []) cats[String(it.category ?? '')] = (cats[String(it.category ?? '')] ?? 0) + 1
  const status = wrimEnvironmentStatusPayload()
  const trainedCkpt = fs.existsSync(path.join(live.stage3DryRunCheckpointDir, 'model.safetensors'))
    || fs.existsSync(path.join(live.stage3DryRunCheckpointDir, 'optimizer.safetensors'))
  const schedule = (dry?.schedule_tests ?? {}) as { ok?: boolean; stage3a?: { step_25?: number; step_50?: number }; stage3b?: { conceptual_step_50?: number; step_250?: number } }
  const selfKl = ((dry?.baseline_load as { self_kl?: { pass?: boolean } } | undefined)?.self_kl) ?? {}

  results.push(check('1_parent_sha', PARENT_SHA256 === 'd1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015' && dry?.parent_sha_pre === PARENT_SHA256 && dry?.parent_sha_post === PARENT_SHA256, PARENT_SHA256))
  results.push(check('2_tokenizer_sha', TOKENIZER_SHA256 === '47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7' && dry?.tokenizer_sha === TOKENIZER_SHA256, TOKENIZER_SHA256))
  results.push(check('3_suite_sha', STAGE3_EVAL_SUITE_SHA256 === '934ff60bcd179ec643257fbfaa30f2a3a7621b175fc7d3c3d0efc30d946d5ac4' && suite.suite_hash === STAGE3_EVAL_SUITE_SHA256 && dry?.suite_sha === STAGE3_EVAL_SUITE_SHA256, STAGE3_EVAL_SUITE_SHA256))
  results.push(check('4_baseline_sha', STAGE3_WRIM0_BASELINE_SHA256 === '7c1cc9fe7d4208d93cd3cdb6b25783daea8947ae26622e706d4a0032f934ed5f' && dry?.baseline_sha === STAGE3_WRIM0_BASELINE_SHA256, STAGE3_WRIM0_BASELINE_SHA256))
  results.push(check('5_35_items', suite.n_items === 35 && (suite.items ?? []).length === 35, String(suite.n_items)))
  results.push(check('6_7_categories', suite.n_categories === 7 && suite.items_per_category === 5 && Object.keys(cats).length === 7 && Object.values(cats).every(n => n === 5), JSON.stringify(cats)))
  results.push(check('7_self_kl', Boolean((selfKl as { pass?: boolean }).pass) && suite.status === 'AUTHORED_FROZEN' && STAGE3_EVAL_SUITE_STATUS === 'AUTHORED_FROZEN', 'self-kl + frozen suite'))
  results.push(check('8_stage3a_schedule', schedPy.includes('PEAK_LR * step / STAGE3A_WARMUP_STEPS') && schedule.ok === true && Math.abs(Number(schedule.stage3a?.step_25) - 2e-5) < 1e-18 && Math.abs(Number(schedule.stage3a?.step_50) - 2e-6) < 1e-18, 'STAGE3A exact'))
  results.push(check('9_stage3b_schedule', STAGE3B_LR_FORMULA === 'FROZEN_FOR_REVIEW' && STAGE3B_START_LR === 2e-6 && STAGE3B_MIN_LR === 2e-7 && Math.abs(Number(schedule.stage3b?.conceptual_step_50) - 2e-6) < 1e-18 && Math.abs(Number(schedule.stage3b?.step_250) - 2e-7) < 1e-18, STAGE3B_LR_FORMULA))
  results.push(check('10_auth_gate', trainPy.includes('TRAINING_DENIED') && (runtimePy.includes('STAGE3_AUTHORIZATION = "NO"') || runtimePy.includes('STAGE3_AUTHORIZATION = "NO_PENDING_REVIEW"')) && denied?.error === 'TRAINING_DENIED' && denied?.optimizer_steps === 0, 'TRAINING_DENIED'))
  results.push(check('11_auth_off', (STAGE3_AUTHORIZATION === 'NO' || STAGE3_AUTHORIZATION === 'NO_PENDING_REVIEW') && TRAINING_AUTHORIZATION === 'OFF' && READY_FOR_STAGE3_TRAINING_AUTHORIZATION === false && CURRENT_WRIM_TRAINING === 'NOT_RUNNING', STAGE3_AUTHORIZATION))
  results.push(check('12_dry_run_zero', dry?.ok === true && dry?.optimizer_steps === 0 && dry?.parameter_update_count === 0, String(dry?.optimizer_steps)))
  results.push(check('13_weight_immutable', dry?.weight_immutability === true && dry?.parent_sha_pre === dry?.parent_sha_post, String(dry?.weight_immutability)))
  results.push(check('14_checkpoint_scheme', runtimePy.includes('parent_pointer_only') && fs.existsSync(path.join(live.stage3DryRunCheckpointDir, 'parent-pointer.json')) && trainedCkpt === false, 'pointer only'))
  results.push(check('15_review_bands', runtimePy.includes('REVIEW_TRIGGER_ONLY') && designMd.includes('≈ **0.105**') && designMd.includes('COMPATIBILITY_ONLY'), 'review only'))
  results.push(check('16_qwen', QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', QWEN_INTELLIGENCE_CLASS))
  results.push(check('17_rael', RAEL_STATUS === 'NOT_IMPLEMENTED', RAEL_STATUS))
  results.push(check('18_22_closed', ROADMAP_22_STATUS === 'CLOSED', ROADMAP_22_STATUS))
  results.push(check('19_23_active', ROADMAP_23_STATUS === 'ACTIVE', ROADMAP_23_STATUS))
  results.push(check('20_status_truth', STAGE3_EXECUTION_REVIEW === 'PASS' && (STAGE3_TRAINER_STATUS === 'IMPLEMENTED_VALIDATED_ZERO_STEP' || STAGE3_TRAINER_STATUS === 'STAGE3A_COMPLETE_PENDING_REVIEW' || STAGE3_TRAINER_STATUS === 'STAGE3A_REVIEWED') && STAGE3B_EXECUTION_READINESS === false && (NEXT_AUTHORIZED_PASS === 'STAGE3A_COMMANDER_AUTHORIZATION_REVIEW' || NEXT_AUTHORIZED_PASS === 'STAGE3A_COMMANDER_REVIEW' || NEXT_AUTHORIZED_PASS === 'STAGE3A_REVIEW_COMPLETE' || NEXT_AUTHORIZED_PASS === 'STAGE3A_CANDIDATE_SELECTION_COMPLETE') && status.train_button === false, NEXT_AUTHORIZED_PASS))
  results.push(check('21_no_http_train', tryForbiddenEnvAction('START_STAGE_3').denied && FORBIDDEN_ENV_ACTIONS.includes('START_STAGE_3'), 'HTTP denied'))
  results.push(check('22_disk_guard', Boolean((dry?.disk as { ok?: boolean } | undefined)?.ok) && runtimePy.includes('DISK_STOP_GB = 32') && runtimePy.includes('DISK_WARN_GB = 64'), 'disk guard'))
  results.push(check('23_no_trained_artifact', trainedCkpt === false && dry?.trained_checkpoint_written === false, 'no masquerading ckpt'))
  results.push(check('24_interpolation_not_run', ((dry?.interpolation_wiring as { executed?: boolean } | undefined)?.executed === false), 'interpolation wiring only'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runStage3ExecutionValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
