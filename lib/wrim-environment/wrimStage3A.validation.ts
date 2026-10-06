/**
 * #23 WRIM1-RUN-000003 STAGE3A controlled confirmation validation.
 * Asserts 50-step completion, auth OFF, no STAGE3B, no promotion.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  FORBIDDEN_ENV_ACTIONS,
  NEXT_AUTHORIZED_PASS,
  PARENT_SHA256,
  QWEN_INTELLIGENCE_CLASS,
  RAEL_STATUS,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  STAGE3_AUTHORIZATION,
  STAGE3A_CANDIDATE_STATE,
  STAGE3A_CLASSIFICATION,
  STAGE3A_EXECUTION_READINESS,
  STAGE3A_STATUS,
  STAGE3B_EXECUTION_READINESS,
  STAGE3_TRAINER_STATUS,
  TOKENIZER_SHA256,
  TRAINING_AUTHORIZATION,
} from './identity'
import { STAGE3_EVAL_SUITE_SHA256, STAGE3_WRIM0_BASELINE_SHA256 } from './stage3Design'
import { resolveWrimEnvironmentPaths } from './paths'
import { dumpWrim0FinalWeights } from '../wrim-reconciliation/paths'
import { tryForbiddenEnvAction } from './redTeam'
import { wrimEnvironmentStatusPayload } from './status'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function sha256File(filePath: string): string {
  const h = createHash('sha256')
  h.update(fs.readFileSync(filePath))
  return h.digest('hex')
}

export async function runStage3AValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.stage3aReportPath)
    ? (JSON.parse(fs.readFileSync(live.stage3aReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const abortPresent = fs.existsSync(path.join(live.stage3aCheckpointDir, 'ABORT.json'))
  const step51 = fs.existsSync(path.join(live.stage3aCheckpointDir, 'step-51'))
  const stage3b = fs.existsSync(path.join(path.dirname(live.stage3aCheckpointDir), 'STAGE3B', 'metrics.jsonl'))
  const metricsPath = path.join(live.stage3aCheckpointDir, 'metrics.jsonl')
  const metrics = fs.existsSync(metricsPath)
    ? fs.readFileSync(metricsPath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as { global_step?: number })
    : []
  // The report's own weights_path is whatever this machine's recovery dump was mounted at when the pass ran (a Windows path in this
  // historical report); the portable resolver every other stage's validator uses is dumpWrim0FinalWeights(), not that embedded string.
  const parentPath = dumpWrim0FinalWeights()
  const parentSha = fs.existsSync(parentPath) ? sha256File(parentPath) : ''
  const step50Model = path.join(live.stage3aCheckpointDir, 'step-50', 'model.safetensors')
  const status = wrimEnvironmentStatusPayload()
  const runtimePy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage3_runtime.py'), 'utf8')
  const trainPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage3_train.py'), 'utf8')

  results.push(check('1_run_id', report?.run_id === 'WRIM1-RUN-000003' && report?.segment === 'STAGE3A', String(report?.run_id)))
  results.push(check('2_steps_50', report?.optimizer_steps === 50 && report?.parameter_update_count === 50 && metrics.length === 50 && metrics.at(-1)?.global_step === 50, String(report?.optimizer_steps)))
  results.push(check('3_tokens', report?.tokens_seen === 204800, String(report?.tokens_seen)))
  results.push(check('4_no_step_51', report?.step_51_exists === false && step51 === false && !metrics.some(m => m.global_step === 51), 'no step 51'))
  results.push(check('5_auth_off', TRAINING_AUTHORIZATION === 'OFF' && (['NO', 'NO_PENDING_REVIEW'].includes(STAGE3_AUTHORIZATION)) && runtimePy.includes('TRAINING_AUTHORIZATION = "OFF"') && (runtimePy.includes('STAGE3_AUTHORIZATION = "NO"') || runtimePy.includes('STAGE3_AUTHORIZATION = "NO_PENDING_REVIEW"')), STAGE3_AUTHORIZATION))
  results.push(check('6_stage3b_no', STAGE3B_EXECUTION_READINESS === false && report?.STAGE3B_started === false && report?.STAGE3B_AUTHORIZATION === 'NO' && stage3b === false, 'STAGE3B NO'))
  results.push(check('7_parent_unmodified', report?.parent_unmodified === true && parentSha === PARENT_SHA256 && report?.parent_sha256 === PARENT_SHA256, parentSha || String(report?.parent_sha256)))
  results.push(check('8_candidate_separate', fs.existsSync(step50Model) && parentPath !== step50Model, step50Model))
  results.push(check('9_shas', report?.tokenizer_sha256 === TOKENIZER_SHA256 && report?.suite_sha256 === STAGE3_EVAL_SUITE_SHA256 && report?.baseline_sha256 === STAGE3_WRIM0_BASELINE_SHA256 && report?.seed === 3003, String(report?.seed)))
  results.push(check('10_abort', abortPresent === false && (report?.abort as { present?: boolean } | undefined)?.present === false, String(abortPresent)))
  results.push(check('11_classification', STAGE3A_CLASSIFICATION === 'B. REVIEW_REQUIRED_CONTINUOUS_DRIFT' && report?.final_classification === STAGE3A_CLASSIFICATION, STAGE3A_CLASSIFICATION))
  results.push(check('12_candidate', STAGE3A_CANDIDATE_STATE === 'EVALUATION_CANDIDATE' && report?.candidate_state === 'EVALUATION_CANDIDATE' && report?.promotion_candidate === false, STAGE3A_CANDIDATE_STATE))
  results.push(check('13_status', (['COMPLETE_PENDING_REVIEW', 'REVIEWED'].includes(STAGE3A_STATUS)) && (['STAGE3A_COMPLETE_PENDING_REVIEW', 'STAGE3A_REVIEWED'].includes(STAGE3_TRAINER_STATUS)) && STAGE3A_EXECUTION_READINESS === false && (['STAGE3A_COMMANDER_REVIEW', 'STAGE3A_REVIEW_COMPLETE', 'STAGE3A_CANDIDATE_SELECTION_COMPLETE', 'STAGE3A_CANDIDATE_ADJUDICATION_COMPLETE', 'CORRECTIVE_STAGE3A_COMMANDER_AUTHORIZATION', 'CORRECTIVE_STAGE3A_PILOT_COMPLETE', 'FOUNDATIONAL_ROOT_CAUSE_REVIEW_COMPLETE', 'FOUNDATIONAL_REMEDIATION_DESIGN_COMPLETE', 'FOUNDATIONAL_P1_READINESS_COMPLETE', 'FOUNDATIONAL_P1_STREAM_REFINEMENT_COMPLETE', 'FOUNDATIONAL_P1_SOVEREIGNTY_AUDIT_COMPLETE', 'FOUNDATIONAL_P2_TRAINING_CONFIGURATION_REQUIRED', 'FOUNDATIONAL_P2_RECIPE_READY', 'FOUNDATIONAL_P2_DIAGNOSTIC_COMPLETE', 'FOUNDATIONAL_P2_ROOT_CAUSE_COMPLETE', 'P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN'].includes(NEXT_AUTHORIZED_PASS)), STAGE3A_STATUS))
  results.push(check('14_generic_train_denied', trainPy.includes('TRAINING_DENIED') && tryForbiddenEnvAction('START_STAGE_3').denied && status.train_button === false && CURRENT_WRIM_TRAINING === 'NOT_RUNNING', 'HTTP/CLI generic train denied'))
  results.push(check('15_qwen', QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', QWEN_INTELLIGENCE_CLASS))
  results.push(check('16_rael', RAEL_STATUS === 'NOT_IMPLEMENTED', RAEL_STATUS))
  results.push(check('17_22_closed', ROADMAP_22_STATUS === 'CLOSED', ROADMAP_22_STATUS))
  results.push(check('18_23_active', ROADMAP_23_STATUS === 'ACTIVE', ROADMAP_23_STATUS))
  results.push(check('19_no_push', tryForbiddenEnvAction('PUSH_CHANGES').denied && FORBIDDEN_ENV_ACTIONS.includes('START_STAGE_3'), 'no push'))
  results.push(check('20_evals_present', fs.existsSync(path.join(live.stage3aCheckpointDir, 'evals', 'step-0.json')) && fs.existsSync(path.join(live.stage3aCheckpointDir, 'evals', 'step-25.json')) && fs.existsSync(path.join(live.stage3aCheckpointDir, 'evals', 'step-50.json')), 'evals 0/25/50'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runStage3AValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
