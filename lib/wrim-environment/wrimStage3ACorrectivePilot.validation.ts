/**
 * #23 WRIM1-RUN-000004 STAGE3A corrective 25-step pilot validation.
 * Auth OFF after the run. No step 26. No STAGE3B. No promotion.
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
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  STAGE3_AUTHORIZATION,
  STAGE3_RUN_ID,
  STAGE3B_EXECUTION_READINESS,
  TOKENIZER_SHA256,
  TRAINING_AUTHORIZATION,
} from './identity'
import {
  CORRECTIVE_STAGE3A_CONTINUATION_RECOMMENDATION,
  CORRECTIVE_STAGE3A_EXECUTION_READINESS,
  CORRECTIVE_STAGE3A_PARENT,
  CORRECTIVE_STAGE3A_PILOT_CLASSIFICATION,
  CORRECTIVE_STAGE3A_PILOT_STATUS,
  CORRECTIVE_STAGE3A_RUN_ID,
  CORRECTIVE_STAGE3A_STEPS,
  CORRECTIVE_STAGE3A_STEPS_EXECUTED,
  CORRECTIVE_STAGE3A_TOKENS_TRAINED,
  HISTORICAL_STAGE3_RUN_ID,
} from './stage3aCorrectiveDesign'
import { resolveWrimEnvironmentPaths } from './paths'
import { tryForbiddenEnvAction } from './redTeam'
import { wrimEnvironmentStatusPayload } from './status'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export async function runStage3ACorrectivePilotValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.stage3aCorrectiveReportPath)
    ? (JSON.parse(fs.readFileSync(live.stage3aCorrectiveReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const trainPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage3a_corrective_train.py'), 'utf8')
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts/run-wrim-stage3a-corrective.mjs'), 'utf8')
  const status = wrimEnvironmentStatusPayload()
  const ckpt = live.stage3aCorrectiveCheckpointDir
  const historical = live.stage3aCheckpointDir
  const step26 = fs.existsSync(path.join(ckpt, 'step-26'))
  const abortPresent = fs.existsSync(path.join(ckpt, 'ABORT.json'))
  const step0Pointer = fs.existsSync(path.join(ckpt, 'parent-pointer.json'))
  const step25 = fs.existsSync(path.join(ckpt, 'step-25', 'model.safetensors'))
  const hashes = (report?.checkpoint_hashes ?? {}) as Record<string, { kind?: string; model_sha256?: string; step?: number; tokens?: number }>
  const axesImproved = (report?.generation_axes_improved ?? []) as unknown[]

  results.push(check('1_report_ok', report?.ok === true && report?.kind === 'STAGE3A_CORRECTIVE_PILOT' && report?.final_classification === 'CORRECTIVE_STAGE3A_PILOT_FAILED', String(report?.final_classification)))
  results.push(check('2_run_id', report?.run_id === 'WRIM1-RUN-000004' && CORRECTIVE_STAGE3A_RUN_ID === 'WRIM1-RUN-000004' && STAGE3_RUN_ID === 'WRIM1-RUN-000003' && HISTORICAL_STAGE3_RUN_ID === 'WRIM1-RUN-000003' && report?.historical_run_id_unmodified === 'WRIM1-RUN-000003', String(report?.run_id)))
  results.push(check('3_steps', report?.optimizer_steps_executed === 25 && CORRECTIVE_STAGE3A_STEPS === 25 && CORRECTIVE_STAGE3A_STEPS_EXECUTED === 25 && report?.tokens_trained === 102400 && CORRECTIVE_STAGE3A_TOKENS_TRAINED === 102400 && step26 === false && trainPy.includes('MAX_STEPS = 25') && trainPy.includes('next_unauthorized_step": 26'), String(report?.optimizer_steps_executed)))
  results.push(check('4_parent', report?.parent === 'WRIM-0' && CORRECTIVE_STAGE3A_PARENT === 'WRIM-0' && report?.parent_sha256 === PARENT_SHA256 && report?.tokenizer_sha256 === TOKENIZER_SHA256 && hashes['0']?.kind === 'PARENT_POINTER_ONLY' && step0Pointer, String(report?.parent_sha256)))
  results.push(check('5_stream', report?.packed_source_ids_sha256 === '14f5b55e452fa2b25ec49b2d52411a113d0c7f3303a518fded14abef32fb41fe' && ckpt.includes('WRIM1-RUN-000004') && !ckpt.includes('WRIM1-RUN-000003') && runner.includes('--authorize-wrim1-run-000004'), String(report?.packed_source_ids_sha256)))
  results.push(check('6_auth_off', TRAINING_AUTHORIZATION === 'OFF' && STAGE3_AUTHORIZATION === 'NO' && report?.TRAINING_AUTHORIZATION === 'OFF' && CORRECTIVE_STAGE3A_EXECUTION_READINESS === false && CURRENT_WRIM_TRAINING === 'NOT_RUNNING' && status.train_button === false, TRAINING_AUTHORIZATION))
  results.push(check('7_no_stage3b', STAGE3B_EXECUTION_READINESS === false && report?.STAGE3B_AUTHORIZATION === 'NO' && report?.STAGE3B_EXECUTION_READINESS === false && CORRECTIVE_STAGE3A_CONTINUATION_RECOMMENDATION === 'NO' && report?.continuation_recommendation === 'NO', 'NO'))
  results.push(check('8_completed_no_abort', report?.abort_occurred === false && abortPresent === false && step25 === true && hashes['25']?.step === 25 && hashes['25']?.tokens === 102400, String(report?.abort_occurred)))
  results.push(check('9_classification', CORRECTIVE_STAGE3A_PILOT_STATUS === 'COMPLETE' && CORRECTIVE_STAGE3A_PILOT_CLASSIFICATION === 'CORRECTIVE_STAGE3A_PILOT_FAILED' && report?.success_criteria_met === false && axesImproved.length === 0, CORRECTIVE_STAGE3A_PILOT_CLASSIFICATION))
  results.push(check('10_retention_without_generation_win', report?.retention_ok === true && report?.success_criteria_met === false, 'val improved is not a generation win'))
  results.push(check('11_optimizer', trainPy.includes('fused=False') && trainPy.includes('resume_stage3a_moments') && trainPy.includes('"fresh": True') && runner.includes('stage3aCorrectiveCheckpointDir'), 'fresh AdamW'))
  results.push(check('12_status', (['CORRECTIVE_STAGE3A_PILOT_COMPLETE', 'FOUNDATIONAL_ROOT_CAUSE_REVIEW_COMPLETE', 'FOUNDATIONAL_REMEDIATION_DESIGN_COMPLETE', 'FOUNDATIONAL_P1_READINESS_COMPLETE', 'FOUNDATIONAL_P1_STREAM_REFINEMENT_COMPLETE', 'FOUNDATIONAL_P1_SOVEREIGNTY_AUDIT_COMPLETE', 'FOUNDATIONAL_P2_TRAINING_CONFIGURATION_REQUIRED', 'FOUNDATIONAL_P2_RECIPE_READY', 'FOUNDATIONAL_P2_DIAGNOSTIC_COMPLETE', 'FOUNDATIONAL_P2_ROOT_CAUSE_COMPLETE', 'P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN', 'STAGE3A_CANDIDATE_ADJUDICATION_COMPLETE'].includes(NEXT_AUTHORIZED_PASS)) && status.next_authorized_pass === NEXT_AUTHORIZED_PASS && status.train_button === false, NEXT_AUTHORIZED_PASS))
  results.push(check('13_historical_untouched', report?.WRIM1_RUN_000003_unchanged === true && fs.existsSync(historical) && !ckpt.includes('WRIM1-RUN-000003'), historical))
  results.push(check('14_no_promote', report?.promotion_candidate === false && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED' && tryForbiddenEnvAction('START_STAGE_3').denied, 'not promoted'))
  results.push(check('15_qwen_rael', QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && RAEL_STATUS === 'NOT_IMPLEMENTED' && report?.RAEL_STATUS === 'NOT_IMPLEMENTED' && report?.QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY', RAEL_STATUS))
  results.push(check('16_roadmap', ROADMAP_22_STATUS === 'CLOSED' && ROADMAP_23_STATUS === 'ACTIVE', ROADMAP_23_STATUS))
  results.push(check('17_no_push', tryForbiddenEnvAction('PUSH_CHANGES').denied && report?.nothing_pushed === true && report?.nothing_deployed === true, 'no push'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runStage3ACorrectivePilotValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
