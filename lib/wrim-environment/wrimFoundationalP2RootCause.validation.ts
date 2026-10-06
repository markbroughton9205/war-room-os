/**
 * #23 WRIM1-RUN-000005 P2 root-cause audit validation.
 * Zero optimizer steps. No P3/STAGE3B. No promotion.
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
import { P2_AUTHORIZED_RECIPE_SHA256 } from './foundationalP2Train'
import { P2_ROOT_CAUSE_CLASSIFICATIONS, P2_ROOT_CAUSE_KIND } from './foundationalP2RootCause'
import { P2_RUN_ID, P2_SOVEREIGN_STREAM_SHA256 } from './foundationalP2'
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

export async function runFoundationalP2RootCauseValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.foundationalP2RootCauseReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalP2RootCauseReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const train = fs.existsSync(live.foundationalP2TrainReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalP2TrainReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const py = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/p2_root_cause.py'), 'utf8')
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts/run-wrim-foundational-p2-root-cause.mjs'), 'utf8')
  const status = wrimEnvironmentStatusPayload()
  const cls = String(report?.final_classification ?? '')
  const causes = (report?.cause_classes ?? {}) as Record<string, string>
  const exps = Array.isArray(report?.candidate_experiments) ? (report.candidate_experiments as unknown[]) : []
  const drift = (report?.layerwise_drift ?? {}) as Record<string, unknown>
  const interp = (report?.interpolation ?? {}) as Record<string, unknown>

  results.push(check('1_kind', report?.kind === P2_ROOT_CAUSE_KIND && report?.run_id === P2_RUN_ID, String(report?.kind)))
  results.push(check('2_identity', report?.parent_sha256 === PARENT_SHA256 && report?.tokenizer_sha256 === TOKENIZER_SHA256 && report?.stream_sha256 === P2_SOVEREIGN_STREAM_SHA256 && report?.recipe_sha256 === P2_AUTHORIZED_RECIPE_SHA256 && train?.optimizer_steps === 50, String(report?.stream_sha256)))
  results.push(check('3_no_train', report?.optimizer_steps_this_pass === 0 && report?.AdamW_constructed === false && noOptimizer(py) && noOptimizer(runner) && !py.includes('optimizer.step'), 'zero'))
  results.push(check('4_checkpoints', JSON.stringify(report?.checkpoints_analyzed) === JSON.stringify(['WRIM-0', 'step-5', 'step-10', 'step-25', 'step-50']) && Boolean(drift['50']), 'ckpts'))
  results.push(check('5_causes', typeof causes.learning_rate_schedule_plateau === 'string' && typeof causes.weight_decay === 'string' && typeof causes.clm_objective_mismatch === 'string', 'causes'))
  results.push(check('6_experiments', exps.length === 3 && typeof report?.recommended_next_experiment === 'string', String(exps.length)))
  results.push(check('7_interp_eval_only', String(interp.kind || '').includes('NOT_SAVED') && py.includes('interpolate_state') && !py.includes('save_file('), String(interp.kind)))
  results.push(check('8_classification', (P2_ROOT_CAUSE_CLASSIFICATIONS as readonly string[]).includes(cls) && report?.promotion_candidate === false, cls))
  results.push(check('9_auth_off', TRAINING_AUTHORIZATION === 'OFF' && report?.TRAINING_AUTHORIZATION === 'OFF' && CURRENT_WRIM_TRAINING === 'NOT_RUNNING' && status.train_button === false, TRAINING_AUTHORIZATION))
  results.push(check('10_no_p3_stage3b', report?.P3_AUTHORIZED === false && report?.STAGE3B_AUTHORIZATION === 'NO' && STAGE3_AUTHORIZATION === 'NO' && STAGE3B_EXECUTION_READINESS === false && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', 'blocked'))
  results.push(check('11_nothing_pushed_deployed', report?.nothing_pushed === true && report?.nothing_deployed === true && tryForbiddenEnvAction('PUSH_CHANGES').denied && QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && RAEL_STATUS === 'NOT_IMPLEMENTED', 'denied'))
  results.push(check('12_identity_lock', (['FOUNDATIONAL_P2_ROOT_CAUSE_COMPLETE', 'P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN', 'STAGE3A_CANDIDATE_ADJUDICATION_COMPLETE'].includes(NEXT_AUTHORIZED_PASS)) && status.next_authorized_pass === NEXT_AUTHORIZED_PASS, NEXT_AUTHORIZED_PASS))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runFoundationalP2RootCauseValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
