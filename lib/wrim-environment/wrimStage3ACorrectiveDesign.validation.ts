/**
 * #23 WRIM1-RUN-000004 STAGE3A corrective training DESIGN validation.
 * Zero optimizer steps. No STAGE3B. No promotion. Training remains OFF.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  NEXT_AUTHORIZED_PASS,
  QWEN_INTELLIGENCE_CLASS,
  RAEL_STATUS,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  STAGE3_AUTHORIZATION,
  STAGE3_RUN_ID,
  STAGE3A_CANDIDATE_ADJUDICATION_STATUS,
  STAGE3B_EXECUTION_READINESS,
  TRAINING_AUTHORIZATION,
} from './identity'
import {
  CORRECTIVE_CAP_ABORT_LE,
  CORRECTIVE_DEV_SUITE_ID,
  CORRECTIVE_DNLL_ABORT_GT,
  CORRECTIVE_KL_ABORT_GT,
  CORRECTIVE_STAGE3A_AUX_LOSS,
  CORRECTIVE_STAGE3A_DESIGN_STATUS,
  CORRECTIVE_STAGE3A_EXECUTION_READINESS,
  CORRECTIVE_STAGE3A_PARENT,
  CORRECTIVE_STAGE3A_PEAK_LR,
  CORRECTIVE_STAGE3A_REP_PENALTY,
  CORRECTIVE_STAGE3A_RUN_ID,
  CORRECTIVE_STAGE3A_STEPS,
  CORRECTIVE_STAGE3A_TOKENS_PER_STEP,
  CORRECTIVE_STAGE3A_TOTAL_TOKENS,
  CORRECTIVE_STAGE3A_UNLIKELIHOOD,
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

function noOptimizer(src: string): boolean {
  return !src.includes('optimizer.step(') && !src.includes('AdamW(') && !src.includes('torch.optim')
}

export async function runStage3ACorrectiveDesignValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.stage3aCorrectiveDesignReportPath)
    ? (JSON.parse(fs.readFileSync(live.stage3aCorrectiveDesignReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const designMd = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/STAGE3A_CORRECTIVE_DESIGN.md'), 'utf8')
  const designPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage3a_corrective_design.py'), 'utf8')
  const packPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage3a_corrective_pack.py'), 'utf8')
  const schedPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage3a_corrective_schedule.py'), 'utf8')
  const auditPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage3a_corrective_audit.py'), 'utf8')
  const devPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage3a_corrective_dev_sets.py'), 'utf8')
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts/run-wrim-stage3a-corrective-design.mjs'), 'utf8')
  const devPath = path.join(repoRoot, 'scripts/wrim-environment/evals/WRIM-DEV-S3A-COR-000001.json')
  const adjPath = path.join(repoRoot, 'scripts/wrim-environment/evals/WRIM-EVAL-S3A-ADJ-000001.json')
  const retPath = path.join(repoRoot, 'scripts/wrim-environment/evals/WRIM-EVAL-S3A-RET-000001.json')
  const status = wrimEnvironmentStatusPayload()
  const sentinels = (report?.sentinels ?? {}) as Record<string, number>
  const devSuite = (report?.dev_suite ?? {}) as Record<string, unknown>
  const exclusions = (report?.eval_exclusions ?? []) as string[]

  results.push(check('1_report_ok', report?.ok === true && report?.kind === 'STAGE3A_CORRECTIVE_TRAINING_DESIGN' && report?.final_classification === 'CORRECTIVE_STAGE3A_DESIGN_READY', String(report?.kind)))
  results.push(check('2_run_id', report?.run_id === 'WRIM1-RUN-000004' && CORRECTIVE_STAGE3A_RUN_ID === 'WRIM1-RUN-000004' && STAGE3_RUN_ID === 'WRIM1-RUN-000003' && HISTORICAL_STAGE3_RUN_ID === 'WRIM1-RUN-000003' && report?.historical_run_id_unmodified === 'WRIM1-RUN-000003', String(report?.run_id)))
  results.push(check('3_zero_steps', report?.optimizer_steps_this_pass === 0 && report?.parameter_update_count_this_pass === 0 && noOptimizer(designPy) && noOptimizer(packPy) && noOptimizer(schedPy) && noOptimizer(auditPy) && noOptimizer(devPy) && noOptimizer(runner), String(report?.optimizer_steps_this_pass)))
  results.push(check('4_auth_off', TRAINING_AUTHORIZATION === 'OFF' && STAGE3_AUTHORIZATION === 'NO' && report?.TRAINING_AUTHORIZATION === 'OFF' && report?.ready_to_run_optimizer === false && CORRECTIVE_STAGE3A_EXECUTION_READINESS === false && CURRENT_WRIM_TRAINING === 'NOT_RUNNING', TRAINING_AUTHORIZATION))
  results.push(check('5_no_stage3b', STAGE3B_EXECUTION_READINESS === false && report?.STAGE3B_AUTHORIZATION === 'NO' && report?.STAGE3B_EXECUTION_READINESS === false && designMd.includes('STAGE3B: **NO**'), 'NO'))
  results.push(check('6_parent', CORRECTIVE_STAGE3A_PARENT === 'WRIM-0' && report?.parent === 'WRIM-0' && designMd.includes('Recommended parent') && designMd.includes('**WRIM-0**'), String(report?.parent)))
  results.push(check('7_lr', CORRECTIVE_STAGE3A_PEAK_LR === 1e-5 && report?.peak_lr === 1e-5 && designMd.includes('Peak **1e-5**') && schedPy.includes('PEAK_LR = 1e-5'), String(report?.peak_lr)))
  results.push(check('8_budget', CORRECTIVE_STAGE3A_STEPS === 25 && CORRECTIVE_STAGE3A_TOKENS_PER_STEP === 4096 && CORRECTIVE_STAGE3A_TOTAL_TOKENS === 102400 && report?.steps === 25 && report?.tokens_per_step === 4096 && report?.total_pilot_tokens === 102400, String(report?.total_pilot_tokens)))
  results.push(check('9_no_exotic_loss', CORRECTIVE_STAGE3A_UNLIKELIHOOD === false && CORRECTIVE_STAGE3A_REP_PENALTY === false && CORRECTIVE_STAGE3A_AUX_LOSS === false && report?.unlikelihood_loss === false && report?.repetition_penalty_training === false && report?.auxiliary_objective === false, 'data/packer first'))
  results.push(check('10_sentinels', sentinels.dnll_abort_gt === CORRECTIVE_DNLL_ABORT_GT && sentinels.kl_abort_gt === CORRECTIVE_KL_ABORT_GT && sentinels.cap_abort_le === CORRECTIVE_CAP_ABORT_LE && designMd.includes('ΔNLL > **0.105**') && designMd.includes('KL(WRIM-0 ‖ candidate) > **0.018**'), 'bands'))
  results.push(check('11_dev', fs.existsSync(devPath) && CORRECTIVE_DEV_SUITE_ID === 'WRIM-DEV-S3A-COR-000001' && devSuite.n_items === 40 && devSuite.development_only === true && devSuite.training_use === 'FORBIDDEN' && devSuite.final_eval_suite === false && designMd.includes('DEVELOPMENT_ONLY'), '40 DEV'))
  results.push(check('12_exclusions', exclusions.includes('CAP-EVAL-0') && exclusions.includes('WRIM-EVAL-S3A-ADJ-000001') && fs.existsSync(adjPath) && fs.existsSync(retPath) && designMd.includes('Forbidden for training forever'), 'evals excluded'))
  results.push(check('13_status', STAGE3A_CANDIDATE_ADJUDICATION_STATUS === 'COMPLETE' && (['CORRECTIVE_STAGE3A_COMMANDER_AUTHORIZATION', 'CORRECTIVE_STAGE3A_PILOT_COMPLETE', 'FOUNDATIONAL_ROOT_CAUSE_REVIEW_COMPLETE', 'FOUNDATIONAL_REMEDIATION_DESIGN_COMPLETE', 'FOUNDATIONAL_P1_READINESS_COMPLETE', 'FOUNDATIONAL_P1_STREAM_REFINEMENT_COMPLETE', 'FOUNDATIONAL_P1_SOVEREIGNTY_AUDIT_COMPLETE', 'FOUNDATIONAL_P2_TRAINING_CONFIGURATION_REQUIRED', 'FOUNDATIONAL_P2_RECIPE_READY', 'FOUNDATIONAL_P2_DIAGNOSTIC_COMPLETE', 'FOUNDATIONAL_P2_ROOT_CAUSE_COMPLETE', 'P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN', 'STAGE3A_CANDIDATE_ADJUDICATION_COMPLETE'].includes(NEXT_AUTHORIZED_PASS)) && CORRECTIVE_STAGE3A_DESIGN_STATUS === 'READY' && status.next_authorized_pass === NEXT_AUTHORIZED_PASS && status.train_button === false, NEXT_AUTHORIZED_PASS))
  results.push(check('14_no_promote', report?.CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED' && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED' && tryForbiddenEnvAction('START_STAGE_3').denied, 'not promoted'))
  results.push(check('15_qwen_rael', QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && RAEL_STATUS === 'NOT_IMPLEMENTED' && report?.RAEL_STATUS === 'NOT_IMPLEMENTED', RAEL_STATUS))
  results.push(check('16_roadmap', ROADMAP_22_STATUS === 'CLOSED' && ROADMAP_23_STATUS === 'ACTIVE' && report?.ROADMAP_22_STATUS === 'CLOSED' && report?.ROADMAP_23_STATUS === 'ACTIVE', ROADMAP_23_STATUS))
  results.push(check('17_no_push', tryForbiddenEnvAction('PUSH_CHANGES').denied && report?.nothing_pushed === true && report?.nothing_deployed === true, 'no push'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runStage3ACorrectiveDesignValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
