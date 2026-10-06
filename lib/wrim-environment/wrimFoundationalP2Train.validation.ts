/**
 * #23 WRIM1-RUN-000005 P2 sovereign foundational CLM training validation.
 * After terminal: TRAINING_AUTHORIZATION OFF. No P3. No STAGE3B. No promotion.
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
  FORBIDDEN_2302_STREAM_SHA256,
  FORBIDDEN_P1_STREAM_SHA256,
  P2_COMPACT_CADENCE,
  P2_EXCLUDED_DOCUMENTS,
  P2_FULL_CADENCE,
  P2_KIND,
  P2_MAX_STEPS,
  P2_MAX_TOKENS,
  P2_RUN_ID,
  P2_SOVEREIGN_PACKED_SOURCE_SHA256,
  P2_SOVEREIGN_STREAM_SHA256,
} from './foundationalP2'
import { P2_AUTHORIZED_RECIPE_SHA256, P2_CLASSIFICATIONS, P2_TRAIN_KIND } from './foundationalP2Train'
import { P2_PEAK_LR, P2_RECIPE_ID, P2_RUNTIME_SEED, P2_WARMUP_STEPS } from './foundationalP2Recipe'
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

export async function runFoundationalP2TrainValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.foundationalP2TrainReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalP2TrainReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const recipe = fs.existsSync(live.foundationalP2RecipeReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalP2RecipeReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const sovereignty = fs.existsSync(live.foundationalP1SovereignReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalP1SovereignReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const trainPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/foundational_p2_train.py'), 'utf8')
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts/run-wrim-foundational-p2-train.mjs'), 'utf8')
  const status = wrimEnvironmentStatusPayload()
  const sovereignNpy = path.join(live.foundationalP1SovereignDir, 'sovereign-p2-diagnostic-stream.npy')
  const parentSha = fs.existsSync(dumpWrim0FinalWeights()) ? await sha256File(dumpWrim0FinalWeights()) : ''
  const tokSha = fs.existsSync(dumpTokenizerPath()) ? await sha256File(dumpTokenizerPath()) : ''
  const sovereignOnDisk = fs.existsSync(sovereignNpy) ? npyPayloadSha256(sovereignNpy) : ''
  const steps = Number(report?.optimizer_steps ?? -1)
  const tokens = Number(report?.tokens_trained ?? -1)
  const cls = String(report?.final_classification ?? '')
  const sov = (report?.sovereignty_policy_proof ?? {}) as Record<string, unknown>
  const forbidden = (report?.forbidden_streams_untouched ?? {}) as Record<string, unknown>
  const compact = Array.isArray(report?.compact_eval_trajectory) ? (report?.compact_eval_trajectory as Array<Record<string, unknown>>) : []
  const compactSteps = compact.map(r => Number(r.step))
  const step1001 = fs.existsSync(path.join(live.foundationalP2TrainDir, 'step-1001'))

  results.push(check('1_authorization', report?.commander_authorization === 'AUTHORIZED' && report?.P2_AUTHORIZED === true && report?.run_id === P2_RUN_ID && report?.kind === P2_KIND && report?.kind === P2_TRAIN_KIND && runner.includes('--authorize-wrim1-run-000005'), String(report?.commander_authorization)))
  results.push(check('2_recipe_sha', report?.recipe_sha256 === P2_AUTHORIZED_RECIPE_SHA256 && recipe?.recipe_sha256 === P2_AUTHORIZED_RECIPE_SHA256 && report?.recipe_id === P2_RECIPE_ID && trainPy.includes(P2_AUTHORIZED_RECIPE_SHA256), String(report?.recipe_sha256)))
  results.push(check('3_stream_sha', report?.stream_sha256 === P2_SOVEREIGN_STREAM_SHA256 && sovereignOnDisk === P2_SOVEREIGN_STREAM_SHA256 && String(report?.stream_sha256) !== FORBIDDEN_2302_STREAM_SHA256 && String(report?.stream_sha256) !== FORBIDDEN_P1_STREAM_SHA256, String(report?.stream_sha256)))
  results.push(check('4_packed_source', report?.packed_source_sha256 === P2_SOVEREIGN_PACKED_SOURCE_SHA256, String(report?.packed_source_sha256)))
  results.push(check('5_parent', report?.parent_identity === 'WRIM-0' && report?.parent_sha256 === PARENT_SHA256 && parentSha === PARENT_SHA256, String(report?.parent_sha256)))
  results.push(check('6_tokenizer', report?.tokenizer_identity === 'WR-TOKENIZER-0' && report?.tokenizer_sha256 === TOKENIZER_SHA256 && tokSha === TOKENIZER_SHA256, String(report?.tokenizer_sha256)))
  results.push(check('7_sovereignty', report?.seed === P1_SOVEREIGN_SEED && Array.isArray(sov.exclusions_applied) && P2_EXCLUDED_DOCUMENTS.every(d => (sov.exclusions_applied as string[]).includes(d)) && sovereignty?.final_classification === 'P2_SOVEREIGN_STREAM_READY_FOR_AUTHORIZATION_REQUEST' && forbidden.seed_2302_not_trained === true, String(report?.seed)))
  results.push(check('8_recipe_fields', report?.peak_lr === P2_PEAK_LR && report?.warmup_steps === P2_WARMUP_STEPS && report?.scheduler === 'warmup_cosine_1_indexed' && report?.precision === 'FP32' && report?.tf32 === false && Number(report?.micro_batch) === 8 && Number(report?.grad_accum) === 1, String(report?.peak_lr)))
  results.push(check('9_steps_budget', steps >= 0 && steps <= P2_MAX_STEPS && tokens >= 0 && tokens <= P2_MAX_TOKENS && tokens === steps * 4096 && !step1001 && trainPy.includes('MAX_STEPS = TOTAL_STEPS') && trainPy.includes('range(1, MAX_STEPS + 1)'), `${steps}/${tokens}`))
  results.push(check('10_adamw', report?.AdamW_constructed === true && typeof report?.optimizer_created_at === 'string' && trainPy.includes('torch.optim.AdamW') && trainPy.includes('step-0 eval before AdamW'), String(report?.optimizer_created_at)))
  results.push(check('11_eval_cadence', compactSteps.includes(0) && (steps < 5 || compactSteps.includes(5)) && (steps < 10 || compactSteps.includes(10)) && JSON.stringify([...P2_COMPACT_CADENCE]).includes('5') && JSON.stringify([...P2_FULL_CADENCE]).includes('100'), compactSteps.slice(0, 8).join(',')))
  results.push(check('12_stop_policy', report?.stop_policy_version === STOP_POLICY_VERSION && report?.stop_policy_unchanged === true && trainPy.includes('decide(') && STOP_POLICY_VERSION === 'wrim-stop-policy-v1', STOP_POLICY_VERSION))
  results.push(check('13_rng', ((report?.rng_policy as Record<string, unknown> | undefined)?.python_seed) === P2_RUNTIME_SEED && ((report?.rng_policy as Record<string, unknown> | undefined)?.eval_seed) === 42, String((report?.rng_policy as Record<string, unknown> | undefined)?.python_seed)))
  results.push(check('14_resume_oom', report?.resume_policy === 'RESTART_REQUIRED_NOT_RESUMABLE' && report?.oom_policy === 'HARD_ABORT', String(report?.resume_policy)))
  results.push(check('15_classification', (P2_CLASSIFICATIONS as readonly string[]).includes(cls) && report?.promotion_candidate === false, cls))
  results.push(check('16_training_off', TRAINING_AUTHORIZATION === 'OFF' && report?.TRAINING_AUTHORIZATION === 'OFF' && CURRENT_WRIM_TRAINING === 'NOT_RUNNING' && status.train_button === false && status.p2_authorized === false, TRAINING_AUTHORIZATION))
  results.push(check('17_no_p3_stage3b', report?.P3_AUTHORIZED === false && report?.STAGE3B_AUTHORIZATION === 'NO' && STAGE3_AUTHORIZATION === 'NO' && STAGE3B_EXECUTION_READINESS === false && report?.CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED' && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', 'blocked'))
  results.push(check('18_nothing_pushed_deployed', report?.nothing_pushed === true && report?.nothing_deployed === true && tryForbiddenEnvAction('PUSH_CHANGES').denied && QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && RAEL_STATUS === 'NOT_IMPLEMENTED', 'denied'))
  results.push(check('19_no_repack', report?.stream_mutated === false && report?.corpus_mutated === false && report?.tokenizer_mutated === false && !trainPy.includes('build_corrective_stream') && runner.includes('sovereign-p2-diagnostic-stream.npy'), 'frozen stream'))
  results.push(check('20_identity_lock', (['FOUNDATIONAL_P2_DIAGNOSTIC_COMPLETE', 'FOUNDATIONAL_P2_ROOT_CAUSE_COMPLETE', 'P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN', 'STAGE3A_CANDIDATE_ADJUDICATION_COMPLETE'].includes(NEXT_AUTHORIZED_PASS)) && status.next_authorized_pass === NEXT_AUTHORIZED_PASS, NEXT_AUTHORIZED_PASS))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runFoundationalP2TrainValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
