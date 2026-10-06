/**
 * #23 WRIM foundational generation root-cause audit validation.
 * Zero optimizer steps. No STAGE3B. No promotion. Training remains OFF.
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
  TOKENIZER_SHA256,
  TRAINING_AUTHORIZATION,
  STAGE3_AUTHORIZATION,
  STAGE3B_EXECUTION_READINESS,
} from './identity'
import {
  FOUNDATIONAL_AUDIT_ID,
  FOUNDATIONAL_CLASSIFICATION,
  FOUNDATIONAL_PROPOSED_F1_TOKENS,
  FOUNDATIONAL_READINESS_CLASS,
  WRIM0_BASE_STEPS,
  WRIM0_BASE_TOKENS,
  WRIM0_PARAM_COUNT,
} from './foundationalRootCause'
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

export async function runFoundationalRootCauseValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.foundationalRootCauseReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalRootCauseReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const auditPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/foundational_root_cause_audit.py'), 'utf8')
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts/run-wrim-foundational-audit.mjs'), 'utf8')
  const status = wrimEnvironmentStatusPayload()
  const scale = (report?.scale ?? {}) as Record<string, unknown>
  const oracle = (report?.scorer_oracle ?? {}) as Record<string, unknown>
  const soft = (report?.soft_stop ?? {}) as Record<string, unknown>
  const data = (report?.data_format ?? {}) as Record<string, unknown>
  const jsonData = (data.json ?? {}) as Record<string, unknown>
  const packing = (report?.packing ?? {}) as Record<string, unknown>
  const readiness = (report?.readiness ?? {}) as Record<string, unknown>
  const strategy = (report?.strategy ?? {}) as Record<string, unknown>

  results.push(check('1_report_ok', report?.ok === true && report?.kind === 'WRIM_FOUNDATIONAL_GENERATION_ROOT_CAUSE_AUDIT' && report?.final_classification === FOUNDATIONAL_CLASSIFICATION && report?.audit_id === FOUNDATIONAL_AUDIT_ID, String(report?.final_classification)))
  results.push(check('2_hashes', report?.sha_ok === true && report?.parent_sha256 === PARENT_SHA256 && report?.tokenizer_sha256 === TOKENIZER_SHA256, String(report?.parent_sha256)))
  results.push(check('3_zero_steps', report?.optimizer_steps_this_pass === 0 && report?.parameter_update_count_this_pass === 0 && report?.AdamW_constructed === false && noOptimizer(auditPy) && noOptimizer(runner), String(report?.optimizer_steps_this_pass)))
  results.push(check('4_no_mutation', report?.corpus_mutated === false && report?.tokenizer_mutated === false, 'frozen'))
  results.push(check('5_scorer_oracle', oracle.ok === true && Number(oracle.n_pass) === Number(oracle.n_cases), String(oracle.n_pass)))
  results.push(check('6_soft_stop_audited', soft.implementation_class === 'CODED_RULE_FOLLOWED_SPEC_GAP' && soft.runner_defect === false && soft.validator_coverage_failed === true && soft.step20_coded_would_stop === false && soft.step20_spirit_would_stop === true, String(soft.implementation_class)))
  results.push(check('7_step10', (report?.step10 as { promotion?: boolean } | undefined)?.promotion === false && packing.pack_matches_frozen_design === true && packing.stream_sha_match_persisted === true, 'not promoted'))
  results.push(check('8_scale', scale.parameter_count === WRIM0_PARAM_COUNT && scale.wrim0_optimizer_steps === WRIM0_BASE_STEPS && scale.wrim0_training_tokens === WRIM0_BASE_TOKENS && typeof scale.tokens_per_parameter === 'number', String(scale.tokens_per_parameter)))
  results.push(check('9_data_format', data.predominant_objective === 'DOCUMENT_CONTINUATION' && jsonData.instruction_conditioned_json_records === 0, String(data.predominant_objective)))
  results.push(check('10_readiness', readiness.readiness_class === FOUNDATIONAL_READINESS_CLASS && readiness.evidence_backed === true && strategy.direction === 'STAGED_COMBINATION', String(readiness.readiness_class)))
  results.push(check('11_auth_off', TRAINING_AUTHORIZATION === 'OFF' && STAGE3_AUTHORIZATION === 'NO' && report?.TRAINING_AUTHORIZATION === 'OFF' && CURRENT_WRIM_TRAINING === 'NOT_RUNNING' && status.train_button === false, TRAINING_AUTHORIZATION))
  results.push(check('12_no_stage3b', STAGE3B_EXECUTION_READINESS === false && report?.STAGE3B_AUTHORIZATION === 'NO' && report?.promotion_candidate === false && report?.step10_promoted === false && report?.step25_promoted === false, 'NO'))
  results.push(check('13_status', (['FOUNDATIONAL_ROOT_CAUSE_REVIEW_COMPLETE', 'FOUNDATIONAL_REMEDIATION_DESIGN_COMPLETE', 'FOUNDATIONAL_P1_READINESS_COMPLETE', 'FOUNDATIONAL_P1_STREAM_REFINEMENT_COMPLETE', 'FOUNDATIONAL_P1_SOVEREIGNTY_AUDIT_COMPLETE', 'FOUNDATIONAL_P2_TRAINING_CONFIGURATION_REQUIRED', 'FOUNDATIONAL_P2_RECIPE_READY', 'FOUNDATIONAL_P2_DIAGNOSTIC_COMPLETE', 'FOUNDATIONAL_P2_ROOT_CAUSE_COMPLETE', 'P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN', 'STAGE3A_CANDIDATE_ADJUDICATION_COMPLETE'].includes(NEXT_AUTHORIZED_PASS)) && status.next_authorized_pass === NEXT_AUTHORIZED_PASS, NEXT_AUTHORIZED_PASS))
  results.push(check('14_f1_tokens', FOUNDATIONAL_PROPOSED_F1_TOKENS === 16384000 && (strategy.proposed_token_scale_headline === 16384000), String(strategy.proposed_token_scale_headline)))
  results.push(check('15_qwen_rael', QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && RAEL_STATUS === 'NOT_IMPLEMENTED' && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', RAEL_STATUS))
  results.push(check('16_http_denied', tryForbiddenEnvAction('START_STAGE_3').denied && tryForbiddenEnvAction('PUSH_CHANGES').denied && report?.nothing_pushed === true && report?.nothing_deployed === true, 'denied'))
  results.push(check('17_no_opt_in_ckpt0003', !String(live.foundationalRootCauseReportPath).includes('WRIM1-RUN-000003') && runner.includes('foundationalRootCauseReportPath'), 'audit writes its own report'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runFoundationalRootCauseValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
