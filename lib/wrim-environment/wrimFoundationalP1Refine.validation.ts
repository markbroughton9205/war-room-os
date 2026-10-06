/**
 * #23 WRIM P1 final stream reuse / diversity refinement validation.
 * Zero optimizer steps. Does not rewrite P1. P2 remains unauthorized.
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
import {
  FOUNDATIONAL_P1_CLASSIFICATION_READY,
  FOUNDATIONAL_P1_FINAL_STREAM_READY,
  FOUNDATIONAL_P1_ID,
  FOUNDATIONAL_P1_REFINE_ID,
  FOUNDATIONAL_P1_REFINE_KIND,
  HISTORICAL_000004_STREAM_SHA256,
  HISTORICAL_P1_PACKED_SOURCE_SHA256,
  HISTORICAL_P1_STREAM_SHA256,
  P1_PACKER_MODE,
  P1_PACKER_VERSION,
  P1_REFINE_DOC_CAP,
  P1_REFINE_SEED,
  P2_RUN_ID_PROPOSAL,
} from './foundationalP1'
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

function noOptimizer(src: string): boolean {
  return !src.includes('optimizer.step(') && !src.includes('AdamW(') && !src.includes('torch.optim')
}

export async function runFoundationalP1RefineValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.foundationalP1RefineReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalP1RefineReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const p1 = fs.existsSync(live.foundationalP1ReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalP1ReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const refinePy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/foundational_p1_refine.py'), 'utf8')
  const packPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/foundational_p1_pack.py'), 'utf8')
  const stopJson = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stop_policy.json'), 'utf8')
  const stopPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stop_policy.py'), 'utf8')
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts/run-wrim-foundational-p1-refine.mjs'), 'utf8')
  const status = wrimEnvironmentStatusPayload()
  const packing = (report?.packing ?? {}) as Record<string, unknown>
  const quality = (report?.quality ?? {}) as { gates?: Record<string, boolean>; all_packing_gates_ok?: boolean }
  const gates = quality.gates ?? {}
  const p2 = (report?.p2_artifact ?? {}) as Record<string, unknown>
  const exposure = (report?.exposure ?? {}) as Record<string, number>
  const reuse = (report?.reuse_by_family ?? {}) as Record<string, { repeat_class?: string; reuse_epochs_est?: number }>
  const classes = (report?.repeat_risk_classifications ?? {}) as Record<string, string>
  const p1Packing = (p1?.packing ?? {}) as Record<string, unknown>
  const p1Npy = path.join(live.foundationalP1Dir, 'p2-diagnostic-stream.npy')
  const refinedNpy = path.join(live.foundationalP1RefineDir, 'refined-p2-diagnostic-stream.npy')
  const historicalNpy = path.join(live.stage3aCorrectiveCheckpointDir, 'corrective-stream.npy')
  const parentSha = fs.existsSync(dumpWrim0FinalWeights()) ? await sha256File(dumpWrim0FinalWeights()) : ''
  const tokSha = fs.existsSync(dumpTokenizerPath()) ? await sha256File(dumpTokenizerPath()) : ''
  const p1OnDisk = fs.existsSync(p1Npy) ? npyPayloadSha256(p1Npy) : ''
  const refinedOnDisk = fs.existsSync(refinedNpy) ? npyPayloadSha256(refinedNpy) : ''
  const historicalSha = fs.existsSync(historicalNpy) ? npyPayloadSha256(historicalNpy) : ''

  results.push(check('1_model_hash_unchanged', parentSha === PARENT_SHA256 && report?.parent_sha256 === PARENT_SHA256 && p1?.parent_sha256 === PARENT_SHA256, parentSha))
  results.push(check('2_tokenizer_hash_unchanged', tokSha === TOKENIZER_SHA256 && report?.tokenizer_sha256 === TOKENIZER_SHA256 && report?.tokenizer_mutated === false, tokSha))
  results.push(check('3_corpus_unchanged', report?.corpus_mutated === false && refinePy.includes('Does not mutate WR-CORPUS') && packPy.includes('Does not mutate WR-CORPUS'), 'frozen'))
  results.push(check('4_optimizer_steps_zero', report?.optimizer_steps_this_pass === 0 && report?.AdamW_constructed === false && noOptimizer(refinePy) && noOptimizer(runner), String(report?.optimizer_steps_this_pass)))
  results.push(check('5_old_p1_stream_preserved', report?.p1_report_rewritten === false && p1?.final_classification === FOUNDATIONAL_P1_CLASSIFICATION_READY && p1?.p1_id === FOUNDATIONAL_P1_ID && String(p1Packing.stream_sha256) === HISTORICAL_P1_STREAM_SHA256 && p1OnDisk === HISTORICAL_P1_STREAM_SHA256 && String(p1Packing.packed_source_sha256) === HISTORICAL_P1_PACKED_SOURCE_SHA256 && historicalSha === HISTORICAL_000004_STREAM_SHA256, p1OnDisk))
  results.push(check('6_refined_stream_deterministic', packing.deterministic === true && packing.stream_sha256 === packing.second_pass_sha256 && refinedOnDisk === String(packing.stream_sha256) && String(packing.stream_sha256) !== HISTORICAL_P1_STREAM_SHA256 && packing.seed === P1_REFINE_SEED && packing.packing === P1_PACKER_MODE && packing.packer_version === P1_PACKER_VERSION, String(packing.stream_sha256)))
  results.push(check('7_unique_exposure_recomputed', typeof exposure.refined_unique_exposure === 'number' && typeof exposure.previous_unique_exposure === 'number' && exposure.refined_unique_exposure > exposure.previous_unique_exposure, String(exposure.refined_unique_exposure)))
  results.push(check('8_repeat_exposure_recomputed', typeof exposure.refined_repeated_exposure === 'number' && typeof exposure.previous_repeated_exposure === 'number' && exposure.refined_repeated_exposure < exposure.previous_repeated_exposure, String(exposure.refined_repeated_exposure)))
  results.push(check('9_behavior_repeat_classified', report?.behavior_decision === 'C. CONTROLLED_MAXIMUM_REPEAT_EPOCHS' && (['CONTROLLED_REUSE', 'LOW_REUSE'].includes(classes.behavior)) && classes.behavior !== 'EXCESSIVE_REUSE' && Number(reuse.behavior?.reuse_epochs_est ?? 99) <= 2.0 + 1e-6, String(classes.behavior)))
  results.push(check('10_document_dominance_classified', report?.document_dominance_decision === 'HARD_CAP_5_PERCENT' && Number(report?.max_document_share) <= P1_REFINE_DOC_CAP + 1e-9 && packing.max_single_doc_frac === P1_REFINE_DOC_CAP, String(report?.max_document_share)))
  results.push(check('11_no_eval_contamination', gates.F_eval_records_excluded === true && gates.G_provenance_complete === true, 'excluded'))
  results.push(check('12_burst_gates', gates.A_no_100pct_json_unless_unavoidable === true && gates.B_no_100pct_c0_unless_unavoidable === true && gates.C_dominant_burst_bounded === true && quality.all_packing_gates_ok === true, JSON.stringify(gates)))
  results.push(check('13_stop_policy_unchanged', report?.stop_policy_unchanged === true && report?.stop_policy_version === STOP_POLICY_VERSION && STOP_POLICY_VERSION === 'wrim-stop-policy-v1' && stopJson.includes('"version": "wrim-stop-policy-v1"') && stopPy.includes('UNCHANGED_AT_FLOOR') && refinePy.includes('from stop_policy import STOP_POLICY_VERSION') && !refinePy.includes('STOP_POLICY_VERSION = str'), STOP_POLICY_VERSION))
  results.push(check('14_early_eval_cadence', JSON.stringify(report?.compact_generation_check_cadence) === JSON.stringify([0, 5, 10, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]) && JSON.stringify(report?.full_evaluation_cadence) === JSON.stringify([0, 100, 500, 1000]), 'compact+full'))
  results.push(check('15_p2_unauthorized', p2.AUTHORIZED === false && report?.P2_AUTHORIZED === false && p2.status !== 'AUTHORIZED' && p2.P2_RUN_ID_PROPOSAL === P2_RUN_ID_PROPOSAL, String(p2.status)))
  results.push(check('16_training_off', TRAINING_AUTHORIZATION === 'OFF' && report?.TRAINING_AUTHORIZATION === 'OFF' && STAGE3_AUTHORIZATION === 'NO' && STAGE3B_EXECUTION_READINESS === false && CURRENT_WRIM_TRAINING === 'NOT_RUNNING' && status.train_button === false && tryForbiddenEnvAction('START_STAGE_3').denied, TRAINING_AUTHORIZATION))
  results.push(check('17_ready', report?.ok === true && report?.kind === FOUNDATIONAL_P1_REFINE_KIND && report?.refine_id === FOUNDATIONAL_P1_REFINE_ID && report?.final_classification === FOUNDATIONAL_P1_FINAL_STREAM_READY && (String(report?.data_readiness_class).startsWith('A.') || String(report?.data_readiness_class).startsWith('B.')), String(report?.data_readiness_class)))
  results.push(check('18_identity_lock', (['FOUNDATIONAL_P1_STREAM_REFINEMENT_COMPLETE', 'FOUNDATIONAL_P1_SOVEREIGNTY_AUDIT_COMPLETE', 'FOUNDATIONAL_P2_TRAINING_CONFIGURATION_REQUIRED', 'FOUNDATIONAL_P2_RECIPE_READY', 'FOUNDATIONAL_P2_DIAGNOSTIC_COMPLETE', 'FOUNDATIONAL_P2_ROOT_CAUSE_COMPLETE', 'P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN', 'STAGE3A_CANDIDATE_ADJUDICATION_COMPLETE'].includes(NEXT_AUTHORIZED_PASS)) && status.next_authorized_pass === NEXT_AUTHORIZED_PASS, NEXT_AUTHORIZED_PASS))
  results.push(check('19_qwen_rael', QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && RAEL_STATUS === 'NOT_IMPLEMENTED' && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED' && report?.nothing_pushed === true && report?.nothing_deployed === true, RAEL_STATUS))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runFoundationalP1RefineValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
