/**
 * #23 WRIM1-RUN-000003 STAGE3A post-review candidate selection validation.
 * Zero optimizer steps. No STAGE3B. No promotion.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  NEXT_AUTHORIZED_PASS,
  PREFERRED_STAGE3A_EVALUATION_CANDIDATE,
  QWEN_INTELLIGENCE_CLASS,
  RAEL_STATUS,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  STAGE3_AUTHORIZATION,
  STAGE3A_CANDIDATE_SELECTION_STATUS,
  STAGE3A_CLASSIFICATION,
  STAGE3A_HEALTHY_FOR_CONTINUATION,
  STAGE3A_PREFERRED_KIND,
  STAGE3B_EXECUTION_READINESS,
  TRAINING_AUTHORIZATION,
} from './identity'
import { resolveWrimEnvironmentPaths } from './paths'
import { tryForbiddenEnvAction } from './redTeam'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export async function runStage3ASelectionValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.stage3aSelectionReportPath)
    ? (JSON.parse(fs.readFileSync(live.stage3aSelectionReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const selPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage3a_candidate_selection.py'), 'utf8')
  const retPath = path.join(repoRoot, 'scripts/wrim-environment/evals/WRIM-EVAL-S3A-RET-000001.json')
  const structPath = path.join(repoRoot, 'scripts/wrim-environment/evals/WRIM-EVAL-S3A-STRUCT-000001.json')
  const step25Interp = path.join(live.stage3aCheckpointDir, 'selection', 'step25-interp-alpha-0.5.json')
  const selection = (report?.selection ?? {}) as Record<string, unknown>
  const preferred = (selection.PREFERRED_STAGE3A_EVALUATION_CANDIDATE ?? {}) as { candidate_id?: string; promotion?: boolean }
  const sha = (report?.sha ?? {}) as Record<string, { ok?: boolean }>
  const freeze = (report?.freeze ?? {}) as { retention_n?: number; structured_n?: number; training_use?: string; replaces_cap_eval_0?: boolean }

  results.push(check('1_report_ok', report?.ok === true && report?.kind === 'STAGE3A_CANDIDATE_SELECTION', String(report?.kind)))
  results.push(check('2_zero_steps', report?.optimizer_steps_this_pass === 0 && report?.parameter_update_count_this_pass === 0 && !selPy.includes('optimizer.step(') && !selPy.includes('AdamW('), String(report?.optimizer_steps_this_pass)))
  results.push(check('3_auth_off', TRAINING_AUTHORIZATION === 'OFF' && STAGE3_AUTHORIZATION === 'NO' && report?.TRAINING_AUTHORIZATION === 'OFF', TRAINING_AUTHORIZATION))
  results.push(check('4_no_stage3b', STAGE3B_EXECUTION_READINESS === false && report?.STAGE3B_AUTHORIZATION === 'NO' && selection.STAGE3B_AUTHORIZATION === 'NO', 'NO'))
  results.push(check('5_sha', Boolean(sha.parent?.ok && sha.tokenizer?.ok && sha.suite?.ok && sha.baseline?.ok && sha.historical_nll_anchor?.ok && sha.step25_model?.ok && sha.step50_model?.ok), 'all sha ok'))
  results.push(check('6_sets_frozen', fs.existsSync(retPath) && fs.existsSync(structPath) && freeze.retention_n === 24 && freeze.structured_n === 15 && freeze.training_use === 'FORBIDDEN' && freeze.replaces_cap_eval_0 === false, '24+15 frozen'))
  results.push(check('7_step25_interp', Array.isArray(report?.step25_interpolation) && (report.step25_interpolation as unknown[]).length === 7 && fs.existsSync(step25Interp), '7 alphas'))
  results.push(check('8_step50_reused', Array.isArray(report?.step50_interpolation) && (report.step50_interpolation as unknown[]).length === 7, '7 reused'))
  results.push(check('9_preferred', PREFERRED_STAGE3A_EVALUATION_CANDIDATE === 'STEP50_A0.5' && preferred.candidate_id === 'STEP50_A0.5' && preferred.promotion === false && STAGE3A_PREFERRED_KIND === 'TEST_ONLY_MERGE', PREFERRED_STAGE3A_EVALUATION_CANDIDATE))
  results.push(check('10_raw50', selection.raw_step50_remains_unsuitable === true && STAGE3A_CLASSIFICATION === 'B. REVIEW_REQUIRED_CONTINUOUS_DRIFT' && STAGE3A_HEALTHY_FOR_CONTINUATION === false && selection.healthy_enough_for_future_stage3b_review === false, 'raw step50 unsuitable'))
  results.push(check('11_status', STAGE3A_CANDIDATE_SELECTION_STATUS === 'COMPLETE' && NEXT_AUTHORIZED_PASS === 'STAGE3A_CANDIDATE_SELECTION_COMPLETE', NEXT_AUTHORIZED_PASS))
  results.push(check('12_no_promote', report?.promotion_candidate === false && report?.interpolation_auto_promoted === false && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', 'not promoted'))
  results.push(check('13_qwen_rael', QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && RAEL_STATUS === 'NOT_IMPLEMENTED', RAEL_STATUS))
  results.push(check('14_roadmap', ROADMAP_22_STATUS === 'CLOSED' && ROADMAP_23_STATUS === 'ACTIVE', ROADMAP_23_STATUS))
  results.push(check('15_http_denied', tryForbiddenEnvAction('START_STAGE_3').denied && CURRENT_WRIM_TRAINING === 'NOT_RUNNING', 'denied'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runStage3ASelectionValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
