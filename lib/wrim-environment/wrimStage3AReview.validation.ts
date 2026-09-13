/**
 * #23 WRIM1-RUN-000003 STAGE3A Commander review validation.
 * Zero optimizer steps. No STAGE3B. No promotion.
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
  STAGE3A_CLASSIFICATION,
  STAGE3A_HEALTHY_FOR_CONTINUATION,
  STAGE3A_REVIEW_STATUS,
  STAGE3A_STATUS,
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

export async function runStage3AReviewValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const review = fs.existsSync(live.stage3aReviewReportPath)
    ? (JSON.parse(fs.readFileSync(live.stage3aReviewReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const reviewPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage3a_review.py'), 'utf8')
  const step25Full = path.join(live.stage3aCheckpointDir, 'review', 'step-25-full.json')
  const pareto = (review?.pareto ?? {}) as { best_balanced_pareto?: { alpha?: number }; promotion_candidate?: boolean }
  const sha = (review?.sha ?? {}) as Record<string, { ok?: boolean }>
  const provenance = (review?.metric_provenance ?? {}) as { ok?: boolean; n_rows?: number; step_51_present?: boolean }

  results.push(check('1_review_ok', review?.ok === true && review?.kind === 'STAGE3A_COMMANDER_REVIEW', String(review?.kind)))
  results.push(check('2_zero_steps', review?.optimizer_steps_this_pass === 0 && review?.parameter_update_count_this_pass === 0 && !reviewPy.includes('optimizer.step(') && !reviewPy.includes('AdamW('), String(review?.optimizer_steps_this_pass)))
  results.push(check('3_auth_off', TRAINING_AUTHORIZATION === 'OFF' && STAGE3_AUTHORIZATION === 'NO' && review?.TRAINING_AUTHORIZATION === 'OFF', TRAINING_AUTHORIZATION))
  results.push(check('4_no_stage3b', STAGE3B_EXECUTION_READINESS === false && review?.STAGE3B_EXECUTION_READINESS === false && review?.STAGE3B_AUTHORIZATION === 'NO', 'NO'))
  results.push(check('5_sha', Boolean(sha.parent?.ok && sha.tokenizer?.ok && sha.suite?.ok && sha.baseline?.ok && sha.historical_nll_anchor?.ok && sha.step25_model?.ok && sha.step50_model?.ok), 'all sha ok'))
  results.push(check('6_provenance', provenance.ok === true && provenance.n_rows === 50 && provenance.step_51_present === false, String(provenance.n_rows)))
  results.push(check('7_step25_full', fs.existsSync(step25Full), step25Full))
  results.push(check('8_interpolation', review?.interpolation_executed === true && review?.interpolation_auto_promoted === false && Array.isArray(review?.interpolation) && (review.interpolation as unknown[]).length === 7, '7 alphas'))
  results.push(check('9_endpoint', Boolean((review?.endpoint as { lerp0_matches_candidate?: boolean; lerp1_matches_parent?: boolean } | undefined)?.lerp0_matches_candidate && (review?.endpoint as { lerp1_matches_parent?: boolean } | undefined)?.lerp1_matches_parent), 'lerp endpoints'))
  results.push(check('10_classification', STAGE3A_CLASSIFICATION === 'B. REVIEW_REQUIRED_CONTINUOUS_DRIFT' && review?.final_classification === STAGE3A_CLASSIFICATION && STAGE3A_HEALTHY_FOR_CONTINUATION === false && review?.HEALTHY_FOR_CONTINUATION === false, STAGE3A_CLASSIFICATION))
  results.push(check('11_status', STAGE3A_STATUS === 'REVIEWED' && STAGE3A_REVIEW_STATUS === 'COMPLETE' && (NEXT_AUTHORIZED_PASS === 'STAGE3A_REVIEW_COMPLETE' || NEXT_AUTHORIZED_PASS === 'STAGE3A_CANDIDATE_SELECTION_COMPLETE'), STAGE3A_STATUS))
  results.push(check('12_no_promote', review?.promotion_candidate === false && pareto.promotion_candidate === false && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', 'not promoted'))
  results.push(check('13_qwen_rael', QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && RAEL_STATUS === 'NOT_IMPLEMENTED', RAEL_STATUS))
  results.push(check('14_roadmap', ROADMAP_22_STATUS === 'CLOSED' && ROADMAP_23_STATUS === 'ACTIVE', ROADMAP_23_STATUS))
  results.push(check('15_http_denied', tryForbiddenEnvAction('START_STAGE_3').denied && CURRENT_WRIM_TRAINING === 'NOT_RUNNING', 'denied'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runStage3AReviewValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
