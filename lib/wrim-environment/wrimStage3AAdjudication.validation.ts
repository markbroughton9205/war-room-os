/**
 * #23 WRIM1-RUN-000003 STAGE3A candidate adjudication validation.
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
  STAGE3A_CANDIDATE_ADJUDICATION_STATUS,
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

export async function runStage3AAdjudicationValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.stage3aAdjudicationReportPath)
    ? (JSON.parse(fs.readFileSync(live.stage3aAdjudicationReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const adjPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage3a_adjudication.py'), 'utf8')
  const suitePath = path.join(repoRoot, 'scripts/wrim-environment/evals/WRIM-EVAL-S3A-ADJ-000001.json')
  const retPath = path.join(repoRoot, 'scripts/wrim-environment/evals/WRIM-EVAL-S3A-RET-000001.json')
  const selection = (report?.selection ?? {}) as Record<string, unknown>
  const sha = (report?.sha ?? {}) as Record<string, { ok?: boolean }>
  const freeze = (report?.freeze ?? {}) as { n_items?: number; training_use?: string; replaces_cap_eval_0?: boolean; sha256?: string }
  const candidates = (report?.candidates_evaluated ?? []) as string[]

  results.push(check('1_report_ok', report?.ok === true && report?.kind === 'STAGE3A_CANDIDATE_ADJUDICATION', String(report?.kind)))
  results.push(check('2_zero_steps', report?.optimizer_steps_this_pass === 0 && report?.parameter_update_count_this_pass === 0 && !adjPy.includes('optimizer.step(') && !adjPy.includes('AdamW('), String(report?.optimizer_steps_this_pass)))
  results.push(check('3_auth_off', TRAINING_AUTHORIZATION === 'OFF' && STAGE3_AUTHORIZATION === 'NO' && report?.TRAINING_AUTHORIZATION === 'OFF', TRAINING_AUTHORIZATION))
  results.push(check('4_no_stage3b', STAGE3B_EXECUTION_READINESS === false && report?.STAGE3B_AUTHORIZATION === 'NO' && selection.STAGE3B_AUTHORIZATION === 'NO', 'NO'))
  results.push(check('5_sha', Boolean(sha.parent?.ok && sha.tokenizer?.ok && sha.suite?.ok && sha.baseline?.ok && sha.historical_nll_anchor?.ok && sha.step25_model?.ok && sha.step50_model?.ok && sha.adjudication_suite?.ok), 'all sha ok'))
  results.push(check('6_suite_frozen', fs.existsSync(suitePath) && freeze.n_items === 80 && freeze.training_use === 'FORBIDDEN' && freeze.replaces_cap_eval_0 === false && freeze.sha256 === 'b283487a8bb0219ed19e889cb1215209f7bcfe6326d23a17a5162c97ea1668af', '80 frozen'))
  results.push(check('7_retention_unmodified', fs.existsSync(retPath), 'S3A-RET preserved'))
  results.push(check('8_candidates', JSON.stringify(candidates) === JSON.stringify(['WRIM-0', 'STEP25_A0.2', 'STEP25_A0.4', 'STEP50_A0.5']) && report?.raw_step50_re_admitted === false, String(candidates)))
  results.push(check('9_recommendation', selection.STAGE3B_RECOMMENDATION === 'E. NO_CLEAR_WINNER_MORE_EVALUATION_REQUIRED' && PREFERRED_STAGE3A_EVALUATION_CANDIDATE === 'NO_CLEAR_WINNER' && STAGE3A_PREFERRED_KIND === 'UNRESOLVED_PARETO', String(selection.STAGE3B_RECOMMENDATION)))
  results.push(check('10_raw50', STAGE3A_CLASSIFICATION === 'B. REVIEW_REQUIRED_CONTINUOUS_DRIFT' && STAGE3A_HEALTHY_FOR_CONTINUATION === false, 'raw step50 unsuitable'))
  results.push(check('11_status', STAGE3A_CANDIDATE_ADJUDICATION_STATUS === 'COMPLETE' && NEXT_AUTHORIZED_PASS === 'STAGE3A_CANDIDATE_ADJUDICATION_COMPLETE', NEXT_AUTHORIZED_PASS))
  results.push(check('12_no_promote', report?.promotion_candidate === false && report?.interpolation_auto_promoted === false && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', 'not promoted'))
  results.push(check('13_qwen_rael', QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && RAEL_STATUS === 'NOT_IMPLEMENTED', RAEL_STATUS))
  results.push(check('14_roadmap', ROADMAP_22_STATUS === 'CLOSED' && ROADMAP_23_STATUS === 'ACTIVE', ROADMAP_23_STATUS))
  results.push(check('15_http_denied', tryForbiddenEnvAction('START_STAGE_3').denied && CURRENT_WRIM_TRAINING === 'NOT_RUNNING', 'denied'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runStage3AAdjudicationValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
