/**
 * #23 WRIM foundational remediation DESIGN validation.
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
  FOUNDATIONAL_READINESS_CLASS,
} from './foundationalRootCause'
import {
  FOUNDATIONAL_ARCHITECTURE_CLASS,
  FOUNDATIONAL_EVAL_DECODER,
  FOUNDATIONAL_MINIMUM_DIAGNOSTIC_TOKENS,
  FOUNDATIONAL_OBJECTIVE_RECOMMENDATION,
  FOUNDATIONAL_PACKING_NEXT,
  FOUNDATIONAL_PRACTICAL_DEVELOPMENT_TOKENS,
  FOUNDATIONAL_REMEDIATION_CLASSIFICATION,
  FOUNDATIONAL_REMEDIATION_DESIGN_ID,
  FOUNDATIONAL_REMEDIATION_EXECUTION_READINESS,
  FOUNDATIONAL_TARGET_FOUNDATION_TOKENS,
  FOUNDATIONAL_TOKENIZER_CLASS,
} from './foundationalRemediationDesign'
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

export async function runFoundationalRemediationDesignValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.foundationalRemediationDesignReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalRemediationDesignReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const audit = fs.existsSync(live.foundationalRootCauseReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalRootCauseReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const designPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/foundational_remediation_design.py'), 'utf8')
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts/run-wrim-foundational-remediation-design.mjs'), 'utf8')
  const status = wrimEnvironmentStatusPayload()
  const src = (report?.source_of_truth ?? {}) as Record<string, unknown>
  const ignored = (src.ignored_failed_attempts ?? []) as Array<Record<string, unknown>>
  const extracted = (report?.extracted_findings ?? {}) as Record<string, unknown>
  const ledger = (report?.blocker_ledger ?? {}) as Record<string, unknown>
  const primary = (ledger.PRIMARY ?? []) as Array<Record<string, unknown>>
  const scale = (report?.training_scale ?? {}) as Record<string, unknown>
  const practical = (scale.PRACTICAL_DEVELOPMENT_SCALE ?? {}) as Record<string, unknown>
  const objective = (report?.objective ?? {}) as Record<string, unknown>
  const packing = (report?.packing_curriculum ?? {}) as Record<string, unknown>
  const corpus = (report?.corpus_requirements ?? {}) as Record<string, unknown>
  const sft = (report?.instruction_sft ?? {}) as Record<string, unknown>
  const soft = (report?.soft_stop_governance ?? {}) as Record<string, unknown>
  const compute = (report?.compute_storage ?? {}) as Record<string, unknown>
  const primaryIds = primary.map(b => String(b.BLOCKER_ID))

  results.push(check('1_source_audit', src.audit_id === FOUNDATIONAL_AUDIT_ID && src.audit_final_classification === FOUNDATIONAL_CLASSIFICATION && src.readiness_class === FOUNDATIONAL_READINESS_CLASS && audit?.final_classification === FOUNDATIONAL_CLASSIFICATION && src.successful_attempt === 3, String(src.audit_id)))
  results.push(check('2_tooling_not_model', ignored.length === 2 && ignored.every(i => i.class === 'AUDIT_TOOLING_DEFECT' && i.not_a_model_outcome === true) && String(ignored[0]?.error ?? '').includes('cuda') && String(ignored[1]?.error ?? '').includes('key mismatch'), String(ignored.length)))
  results.push(check('3_hashes', report?.sha_ok === true && report?.parent_sha256 === PARENT_SHA256 && report?.tokenizer_sha256 === TOKENIZER_SHA256 && audit?.parent_sha256 === PARENT_SHA256, String(report?.parent_sha256)))
  results.push(check('4_tokenizer_frozen', report?.tokenizer_mutated === false && report?.tokenizer_sha256 === TOKENIZER_SHA256 && report?.tokenizer_classification === FOUNDATIONAL_TOKENIZER_CLASS, String(report?.tokenizer_classification)))
  results.push(check('5_corpus_frozen', report?.corpus_mutated === false && corpus.wr_corpus_mutation_authorized === false && sft.merged_into_wr_corpus === false && sft.dataset_generated === false, 'frozen'))
  results.push(check('6_zero_steps', report?.optimizer_steps_this_pass === 0 && report?.parameter_update_count_this_pass === 0 && report?.AdamW_constructed === false && report?.ready_to_run_optimizer === false && FOUNDATIONAL_REMEDIATION_EXECUTION_READINESS === false && noOptimizer(designPy) && noOptimizer(runner), String(report?.optimizer_steps_this_pass)))
  results.push(check('7_ledger', ledger.evidence_backed === true && primaryIds.includes('B-FND-001') && primaryIds.includes('B-OBJ-001') && primaryIds.includes('B-FMT-002') && primaryIds.includes('B-PCK-001') && primaryIds.includes('B-CTL-001') && JSON.stringify(ledger.must_fix_before_any_optimizer_step) === JSON.stringify(['B-PCK-001', 'B-CTL-001']), String(primaryIds.join(','))))
  results.push(check('8_token_scale', scale.materially_undertrained_as_base === true && practical.tokens === FOUNDATIONAL_PRACTICAL_DEVELOPMENT_TOKENS && practical.tokens === 16384000 && FOUNDATIONAL_MINIMUM_DIAGNOSTIC_TOKENS === 4096000 && FOUNDATIONAL_TARGET_FOUNDATION_TOKENS === 65536000 && scale.none_authorized === true, String(practical.tokens)))
  results.push(check('9_objective', objective.recommendation === FOUNDATIONAL_OBJECTIVE_RECOMMENDATION && objective.follows_audit_strategy_direction === true && extracted.predominant_objective === 'DOCUMENT_CONTINUATION', String(objective.recommendation)))
  results.push(check('10_curriculum', packing.next_official_packing === FOUNDATIONAL_PACKING_NEXT && packing.frozen_000004_stream_untouched === true && packing.document_major_contiguous === 'REPLACE_FOR_NEXT_OFFICIAL_RUN', String(packing.next_official_packing)))
  results.push(check('11_architecture', report?.architecture_classification === FOUNDATIONAL_ARCHITECTURE_CLASS && extracted.architecture_limited_primary === false && Boolean(report?.decoding_policy) && (report?.decoding_policy as { official_eval_decoder?: string }).official_eval_decoder === FOUNDATIONAL_EVAL_DECODER, String(report?.architecture_classification)))
  results.push(check('12_auth_off', TRAINING_AUTHORIZATION === 'OFF' && STAGE3_AUTHORIZATION === 'NO' && report?.TRAINING_AUTHORIZATION === 'OFF' && CURRENT_WRIM_TRAINING === 'NOT_RUNNING' && status.train_button === false, TRAINING_AUTHORIZATION))
  results.push(check('13_no_stage3b', STAGE3B_EXECUTION_READINESS === false && report?.STAGE3B_AUTHORIZATION === 'NO' && report?.promotion_candidate === false, 'NO'))
  results.push(check('14_status', (['FOUNDATIONAL_REMEDIATION_DESIGN_COMPLETE', 'FOUNDATIONAL_P1_READINESS_COMPLETE', 'FOUNDATIONAL_P1_STREAM_REFINEMENT_COMPLETE', 'FOUNDATIONAL_P1_SOVEREIGNTY_AUDIT_COMPLETE', 'FOUNDATIONAL_P2_TRAINING_CONFIGURATION_REQUIRED', 'FOUNDATIONAL_P2_RECIPE_READY', 'FOUNDATIONAL_P2_DIAGNOSTIC_COMPLETE', 'FOUNDATIONAL_P2_ROOT_CAUSE_COMPLETE', 'P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN', 'STAGE3A_CANDIDATE_ADJUDICATION_COMPLETE'].includes(NEXT_AUTHORIZED_PASS)) && status.next_authorized_pass === NEXT_AUTHORIZED_PASS && report?.kind === 'WRIM_FOUNDATIONAL_REMEDIATION_DESIGN' && report?.design_id === FOUNDATIONAL_REMEDIATION_DESIGN_ID && report?.final_classification === FOUNDATIONAL_REMEDIATION_CLASSIFICATION, NEXT_AUTHORIZED_PASS))
  results.push(check('15_qwen_rael', QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && RAEL_STATUS === 'NOT_IMPLEMENTED' && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', RAEL_STATUS))
  results.push(check('16_http_denied', tryForbiddenEnvAction('START_STAGE_3').denied && tryForbiddenEnvAction('PUSH_CHANGES').denied && report?.nothing_pushed === true && report?.nothing_deployed === true, 'denied'))
  results.push(check('17_soft_stop', soft.silent_continue_forbidden === true && soft.validator_must_recompute_hits === true && soft.machine_enforceable === true, 'enforceable'))
  results.push(check('18_compute_estimated', compute.estimate !== false && compute.none_authorized === true && Array.isArray(compute.scales) && (compute.scales as unknown[]).length === 3, 'estimated'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runFoundationalRemediationDesignValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
