/**
 * #23 Phase 0 controlled-stability validation. Does not train. Does not start Stage 3.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSovereignRuntimeTruth } from '@/lib/sovereign-runtime/runtimeTruth'
import { ascensionAutonomyIsOff } from '@/lib/ascension/operationalRegistry'
import {
  CURRENT_PRODUCTION_WRIM as CORPUS_PRODUCTION,
  RAEL_STATUS as CORPUS_RAEL,
  ROADMAP_22_STATUS as CORPUS_22,
  ROADMAP_23_STATUS as CORPUS_23,
} from '@/lib/wr-corpus/identity'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  FORBIDDEN_ENV_ACTIONS,
  NEXT_AUTHORIZED_PASS,
  PARENT_SHA256,
  PHASE3A_STATUS,
  RAEL_STATUS,
  READY_FOR_STAGE3_TRAINING_AUTHORIZATION,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  TOKENIZER_SHA256,
  TRAINING_AUTHORIZATION,
} from './identity'
import { resolveWrimEnvironmentPaths } from './paths'
import { tryForbiddenEnvAction } from './redTeam'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export async function runControlledStabilityValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.phase0ReportPath)
    ? (JSON.parse(fs.readFileSync(live.phase0ReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const pyGrid = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/experiment_grid.py'), 'utf8')
  const pyPhase0 = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/phase0_audit.py'), 'utf8')
  const pyModel = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/wrim_g20m.py'), 'utf8')
  const hashes = (report?.artifact_sha_verification ?? {}) as Record<string, unknown>
  const cap02 = (report?.cap0_ret_02 ?? {}) as Record<string, unknown>
  const leak = (report?.leakage_audit ?? {}) as Record<string, unknown>
  const nll = (report?.reference_nll ?? {}) as Record<string, unknown>
  const valTruth = (report?.validation_set_truth ?? {}) as Record<string, unknown>
  const scorer = (report?.historical_scorer_truth ?? {}) as Record<string, unknown>
  const stabScorer = (scorer.stab000001_scorer ?? {}) as Record<string, unknown>

  results.push(check('1_phase0', report?.phase === 0, String(report?.phase)))
  results.push(check('2_no_clear_to_run', report?.CLEAR_TO_RUN === false, String(report?.CLEAR_TO_RUN)))
  results.push(check('3_optimizer_zero', report?.optimizer_steps === 0 && pyPhase0.includes('ZERO optimizer'), String(report?.optimizer_steps)))
  results.push(check('4_training_phase2_only', (TRAINING_AUTHORIZATION === 'PHASE2_GRID_ONLY' || TRAINING_AUTHORIZATION === 'OFF') && CURRENT_WRIM_TRAINING === 'NOT_RUNNING', TRAINING_AUTHORIZATION))
  results.push(check('5_parent_hash', hashes.parent_match === true && hashes.parent_sha256 === PARENT_SHA256, String(hashes.parent_sha256)))
  results.push(check('6_tokenizer_hash', hashes.tokenizer_match === true && hashes.tokenizer_sha256 === TOKENIZER_SHA256, String(hashes.tokenizer_sha256)))
  results.push(check('7_grid_aborted', pyGrid.includes('SUPERSEDED') && pyGrid.includes('TRAINING_AUTHORIZATION=OFF') && pyGrid.includes('return 3'), 'grid hard-abort'))
  results.push(check('8_accum_comparability', pyPhase0.includes('HISTORICAL_GEN_TOKENS = 32') && fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/PREREGISTRATION.md'), 'utf8').includes('gradient_accumulation = 1'), 'accum 1 preregistered'))
  results.push(check('9_cap02_mapped', cap02.evalId === 'cap0-ret-02' && (cap02.mapping_status === 'UNMAPPED_NO_STEM_OVERLAP' || typeof cap02.mapped_source_document === 'string'), String(cap02.mapping_status || cap02.mapped_source_document)))
  results.push(check('10_leakage_field', typeof leak.blocking_failure === 'boolean', String(leak.blocking_failure)))
  results.push(check('11_nll_frozen', nll.frozen === true && typeof nll.sha256 === 'string' && String(nll.sha256).length === 64, String(nll.sha256)))
  results.push(check('12_val_truth_mixed', valTruth.val_loss_definition === 'SINGLE_MIXED_SCALAR' && valTruth.separated_val_loss_corpus0 === false, String(valTruth.val_loss_definition)))
  results.push(check('13_scorer_greedy_32', stabScorer.decoding_mode === 'greedy_argmax' && stabScorer.continuation_length_tokens === 32, String(stabScorer.continuation_length_tokens)))
  results.push(check('14_no_stage3', report?.stage3_started === false && READY_FOR_STAGE3_TRAINING_AUTHORIZATION === false && tryForbiddenEnvAction('START_STAGE_3').denied, 'NO'))
  results.push(check('15_no_rael', RAEL_STATUS === 'NOT_IMPLEMENTED' && CORPUS_RAEL === 'NOT_IMPLEMENTED' && report?.RAEL === 'NOT_IMPLEMENTED', RAEL_STATUS))
  results.push(check('16_qwen', report?.QWEN === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && getSovereignRuntimeTruth().NATIVE_WRIM === 'NOT_IMPLEMENTED' && CORPUS_PRODUCTION === 'NOT_IMPLEMENTED', String(report?.QWEN)))
  results.push(check('17_dense', pyModel.includes('reference_attention') && !pyModel.toLowerCase().includes('sparse expert'), 'dense'))
  results.push(check('18_22_closed', ROADMAP_22_STATUS === 'CLOSED' && CORPUS_22 === 'CLOSED', ROADMAP_22_STATUS))
  results.push(check('19_23_active', ROADMAP_23_STATUS === 'ACTIVE' && CORPUS_23 === 'ACTIVE', ROADMAP_23_STATUS))
  results.push(check('20_next_pass', NEXT_AUTHORIZED_PASS === 'PHASE2_PRIMARY_GRID' || NEXT_AUTHORIZED_PASS === 'PHASE2_GRID_REVIEW' || NEXT_AUTHORIZED_PASS === 'PHASE3A_INTERPOLATION' || NEXT_AUTHORIZED_PASS === 'PHASE3A_REVIEW' || NEXT_AUTHORIZED_PASS === 'STAGE3_COMMANDER_REVIEW' || NEXT_AUTHORIZED_PASS === 'STAGE3_EXECUTION_REVIEW' || NEXT_AUTHORIZED_PASS === 'STAGE3A_COMMANDER_AUTHORIZATION_REVIEW' || NEXT_AUTHORIZED_PASS === 'STAGE3A_COMMANDER_REVIEW' || NEXT_AUTHORIZED_PASS === 'STAGE3A_REVIEW_COMPLETE' || NEXT_AUTHORIZED_PASS === 'STAGE3A_CANDIDATE_SELECTION_COMPLETE', NEXT_AUTHORIZED_PASS))
  results.push(check('21_no_push', tryForbiddenEnvAction('PUSH_CHANGES').denied && FORBIDDEN_ENV_ACTIONS.includes('START_STAGE_3'), 'no push'))
  results.push(check('22_autonomy_off', ascensionAutonomyIsOff(), 'OFF'))
  results.push(check('23_validate_experiment', pyPhase0.includes('def validate_experiment') && (report?.validate_experiment as { passed?: boolean } | undefined)?.passed === true, 'hard assertions'))
  results.push(check('24_parent_unmodified', report?.parent_unmodified === true, String(report?.parent_unmodified)))
  results.push(check('25_no_interpolation', report?.interpolation_executed === false, 'interpolation not executed'))
  results.push(check('26_production', CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', CURRENT_PRODUCTION_WRIM))

  const harness = fs.existsSync(live.phase1HarnessPath)
    ? (JSON.parse(fs.readFileSync(live.phase1HarnessPath, 'utf8')) as Record<string, unknown>)
    : null
  const pyPhase1 = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/phase1_harness.py'), 'utf8')
  results.push(check('27_phase1_verdict', harness?.verdict === 'PHASE1_GREEDY_DETERMINISM_PASS', String(harness?.verdict)))
  results.push(check('28_phase1_no_opt', harness?.optimizer_steps === 0 && pyPhase1.includes('ZERO optimizer') && !pyPhase1.includes('AdamW('), String(harness?.optimizer_steps)))
  results.push(check('29_phase1_no_train', harness?.training_authorization === 'OFF' && harness?.CLEAR_TO_RUN === false && harness?.grid_executed === false, String(harness?.training_authorization)))
  results.push(check('30_phase1_mapping', harness?.retention_item_to_genesis_source_mapping === 'UNMAPPED_NO_STEM_OVERLAP', String(harness?.retention_item_to_genesis_source_mapping)))
  results.push(check('31_phase1_anchor_name', pyPhase1.includes('wrim0_anchor_nll') && pyPhase1.includes('not gold-label'), 'WRIM0_ANCHOR_NLL'))
  results.push(check('32_phase1_frozen_preserved', (harness?.frozen_reference as { rewritten?: boolean } | undefined)?.rewritten === false, 'frozen NLL not rewritten'))

  const pyPhase2 = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/phase2_grid.py'), 'utf8')
  const pyPack = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/experiment_pack.py'), 'utf8')
  results.push(check('33_phase2_accum1', pyPack.includes('GRAD_ACCUM = 1') && pyPhase2.includes('gradient_accumulation') && pyPhase2.includes('NATURAL_BASELINE'), 'accum=1 NATURAL_BASELINE'))
  results.push(check('34_phase2_no_interp', pyPhase2.includes('interpolation_executed": False') || pyPhase2.includes('"interpolation_executed": False'), 'no interpolation'))
  results.push(check('35_phase2_abort_grid', pyPhase2.includes('ABORT.json') && pyPhase2.includes('def abort_grid'), 'hard-stop aborts grid'))
  results.push(check('36_phase2_seeds', pyPhase2.includes('range(1001, 1011)') && pyPhase2.includes('STRATEGIES = ["NATURAL_BASELINE", "BALANCED_GENESIS"]'), '40-run factors'))
  results.push(check('37_no_skewed_name', !pyPhase2.includes('STRATEGIES = ["SKEWED_BASELINE"') && pyPack.includes('SKEWED_BASELINE is SUPERSEDED'), 'NATURAL_BASELINE only'))

  const pyPhase3a = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/phase3a_interpolation.py'), 'utf8')
  results.push(check('38_phase3a_no_adamw', !pyPhase3a.includes('AdamW') && pyPhase3a.includes('ZERO optimizer'), 'no optimizer'))
  results.push(check('39_phase3a_alphas', pyPhase3a.includes('0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 1.0') && pyPhase3a.includes('TEST_ONLY_MERGE'), 'alpha sweep'))
  results.push(check('40_phase3a_no_logit_ensemble', pyPhase3a.includes('logit_ensembling_executed": False') || pyPhase3a.includes('"logit_ensembling_executed": False'), 'no logit ensemble'))
  results.push(check('41_phase3a_auth', pyPhase3a.includes('PHASE3A_INTERPOLATION_ONLY') && TRAINING_AUTHORIZATION === 'OFF', 'training OFF'))
  results.push(check('42_phase3a_complete', PHASE3A_STATUS === 'PHASE3A_COMPLETE' && (NEXT_AUTHORIZED_PASS === 'PHASE3A_REVIEW' || NEXT_AUTHORIZED_PASS === 'STAGE3_COMMANDER_REVIEW' || NEXT_AUTHORIZED_PASS === 'STAGE3_EXECUTION_REVIEW' || NEXT_AUTHORIZED_PASS === 'STAGE3A_COMMANDER_AUTHORIZATION_REVIEW' || NEXT_AUTHORIZED_PASS === 'STAGE3A_COMMANDER_REVIEW' || NEXT_AUTHORIZED_PASS === 'STAGE3A_REVIEW_COMPLETE' || NEXT_AUTHORIZED_PASS === 'STAGE3A_CANDIDATE_SELECTION_COMPLETE') && TRAINING_AUTHORIZATION === 'OFF', PHASE3A_STATUS))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runControlledStabilityValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
