/**
 * #23 WRIM foundational P1 data-readiness / stop-rule hardening validation.
 * Zero optimizer steps. No P2 training. No STAGE3B. Training remains OFF.
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
  FOUNDATIONAL_P1_ID,
  FOUNDATIONAL_P1_KIND,
  HISTORICAL_000004_STREAM_SHA256,
  HISTORICAL_PACKER_MODE,
  P1_PACKER_MODE,
  P1_PACKER_VERSION,
  P2_DIAGNOSTIC_STEPS,
  P2_DIAGNOSTIC_TOKENS,
  P2_RUN_ID_PROPOSAL,
} from './foundationalP1'
import { FOUNDATIONAL_REMEDIATION_CLASSIFICATION } from './foundationalRemediationDesign'
import { resolveWrimEnvironmentPaths } from './paths'
import { tryForbiddenEnvAction } from './redTeam'
import { wrimEnvironmentStatusPayload } from './status'
import {
  STOP_POLICY_VERSION,
  UNIQUE_DEGRADE_DELTA,
  UNIQUE_IMPROVE_DELTA,
  decideStop,
  floorStatus,
  snapshotFromCompact,
  type StopSnapshot,
} from './stopPolicy'
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
  if (buf.subarray(0, 6).toString('latin1') !== '\x93NUMPY') {
    throw new Error(`not npy: ${filePath}`)
  }
  const major = buf[6]
  const offset = major === 1 ? 10 + buf.readUInt16LE(8) : 12 + buf.readUInt32LE(8)
  return createHash('sha256').update(buf.subarray(offset)).digest('hex')
}

function noOptimizer(src: string): boolean {
  return !src.includes('optimizer.step(') && !src.includes('AdamW(') && !src.includes('torch.optim')
}

const PARENT_BASE: StopSnapshot = {
  looping: 0,
  collapse: 0,
  unique128: 0.5,
  unique256: 0.5,
  json_valid: 0,
  instruction: 0,
  entity: 0,
}

export async function runFoundationalP1Validation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.foundationalP1ReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalP1ReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const design = fs.existsSync(live.foundationalRemediationDesignReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalRemediationDesignReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const p1Py = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/foundational_p1.py'), 'utf8')
  const packPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/foundational_p1_pack.py'), 'utf8')
  const stopPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stop_policy.py'), 'utf8')
  const stopJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stop_policy.json'), 'utf8')) as {
    version: string
    unique_degrade_delta: number
    unique_improve_delta: number
    soft_stop_min_hits: number
  }
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts/run-wrim-foundational-p1.mjs'), 'utf8')
  const correctivePack = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage3a_corrective_pack.py'), 'utf8')
  const correctiveTrain = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage3a_corrective_train.py'), 'utf8')
  const status = wrimEnvironmentStatusPayload()
  const packing = (report?.packing ?? {}) as Record<string, unknown>
  const quality = (report?.quality ?? {}) as { gates?: Record<string, boolean>; all_packing_gates_ok?: boolean; max_drift?: number }
  const gates = quality.gates ?? {}
  const p2 = (report?.p2_artifact ?? {}) as Record<string, unknown>
  const replay = (report?.run_000004_replay ?? {}) as Record<string, unknown>
  const byStep = (replay.by_step_hits ?? {}) as Record<string, { decision?: string; hits?: string[]; hit_count?: number; next_allowed?: boolean }>
  const boundary = (report?.boundary_sim ?? {}) as { all_proofs_ok?: boolean; proofs?: Record<string, boolean> }
  const reuse = (report?.reuse ?? {}) as Record<string, unknown>

  const weightsPath = dumpWrim0FinalWeights()
  const tokPath = dumpTokenizerPath()
  const parentSha = fs.existsSync(weightsPath) ? await sha256File(weightsPath) : ''
  const tokSha = fs.existsSync(tokPath) ? await sha256File(tokPath) : ''
  const historicalNpy = path.join(live.stage3aCorrectiveCheckpointDir, 'corrective-stream.npy')
  const diagnosticNpy = path.join(live.foundationalP1Dir, 'p2-diagnostic-stream.npy')
  const historicalSha = fs.existsSync(historicalNpy) ? npyPayloadSha256(historicalNpy) : ''
  const diagnosticSha = fs.existsSync(diagnosticNpy) ? npyPayloadSha256(diagnosticNpy) : ''
  const softStopSim = path.join(live.foundationalP1Dir, 'stop-sim', 'SOFT_STOP.json')

  const parent0 = fs.existsSync(path.join(live.stage3aCorrectiveCheckpointDir, 'evals', 'step-0.compact.json'))
    ? snapshotFromCompact(JSON.parse(fs.readFileSync(path.join(live.stage3aCorrectiveCheckpointDir, 'evals', 'step-0.compact.json'), 'utf8')))
    : null
  let tsReplayOk = true
  const tsReplay: Record<string, string> = {}
  if (parent0) {
    for (const step of [5, 10, 15, 20, 25]) {
      const compactPath = path.join(live.stage3aCorrectiveCheckpointDir, 'evals', `step-${step}.compact.json`)
      if (!fs.existsSync(compactPath)) {
        tsReplayOk = false
        break
      }
      const cand = snapshotFromCompact(JSON.parse(fs.readFileSync(compactPath, 'utf8')))
      const d = decideStop(parent0, cand)
      tsReplay[String(step)] = d.decision
      const stored = byStep[String(step)]
      if (!stored || stored.decision !== d.decision || stored.hit_count !== d.hit_count || stored.next_allowed !== d.next_optimizer_step_allowed) {
        tsReplayOk = false
      }
    }
  } else {
    tsReplayOk = false
  }

  const uniqueLower = decideStop(PARENT_BASE, { ...PARENT_BASE, unique256: PARENT_BASE.unique256 - UNIQUE_DEGRADE_DELTA - 0.001, unique128: PARENT_BASE.unique128 - UNIQUE_DEGRADE_DELTA - 0.001 })
  const uniqueHigher = decideStop(PARENT_BASE, { ...PARENT_BASE, unique256: PARENT_BASE.unique256 + UNIQUE_IMPROVE_DELTA + 0.001 })
  const twoHits = decideStop(PARENT_BASE, { ...PARENT_BASE, looping: 2, unique256: PARENT_BASE.unique256 - UNIQUE_DEGRADE_DELTA - 0.001 })
  const oneHit = decideStop(PARENT_BASE, { ...PARENT_BASE, looping: 2 })
  const zeroHit = decideStop(PARENT_BASE, PARENT_BASE)
  const floorZero = floorStatus(0, 0)
  const hard = decideStop(PARENT_BASE, { ...PARENT_BASE, nan_or_inf: true })

  results.push(check('1_model_hash_unchanged', parentSha === PARENT_SHA256 && report?.parent_sha256 === PARENT_SHA256 && report?.sha_ok === true, parentSha || String(report?.parent_sha256)))
  results.push(check('2_tokenizer_hash_unchanged', tokSha === TOKENIZER_SHA256 && report?.tokenizer_sha256 === TOKENIZER_SHA256 && report?.tokenizer_mutated === false, tokSha || String(report?.tokenizer_sha256)))
  results.push(check('3_corpus_unchanged', report?.corpus_mutated === false && packing.corpus_mutated === false && packPy.includes('Does not mutate WR-CORPUS') && p1Py.includes('Does not mutate WR-CORPUS'), 'frozen'))
  results.push(check('4_optimizer_steps_zero', report?.optimizer_steps_this_pass === 0 && report?.parameter_update_count_this_pass === 0 && report?.AdamW_constructed === false && report?.ready_to_run_optimizer === false && noOptimizer(p1Py) && noOptimizer(packPy) && noOptimizer(stopPy) && noOptimizer(runner), String(report?.optimizer_steps_this_pass)))
  results.push(check('5_document_major_preserved', correctivePack.includes(`"packing": "${HISTORICAL_PACKER_MODE}"`) && !correctiveTrain.includes('from stop_policy import') && historicalSha === HISTORICAL_000004_STREAM_SHA256 && report?.historical_000004_stream_preserved === true, historicalSha))
  results.push(check('6_deficit_interleave_mode', packing.packing === P1_PACKER_MODE && packing.packer_version === P1_PACKER_VERSION && packPy.includes('PACKER_MODE = "DEFICIT_INTERLEAVE_FAMILIES"') && packPy.includes('family_ceiling'), P1_PACKER_MODE))
  results.push(check('7_packed_source_sha_reproducible', packing.deterministic === true && gates.E_seed_reproducible === true && packing.stream_sha256 === packing.second_pass_sha256 && typeof packing.packed_source_sha256 === 'string' && String(packing.packed_source_sha256).length === 64 && diagnosticSha === String(packing.stream_sha256), String(packing.packed_source_sha256)))
  results.push(check('8_eval_records_excluded', gates.F_eval_records_excluded === true && packPy.includes('WRIM-EVAL-S3A') && packPy.includes('WRIM-DEV-S3A-COR'), 'excluded'))
  results.push(check('9_family_targets_audited', gates.D_allocation_converges === true && typeof quality.max_drift === 'number' && Number(quality.max_drift) <= 0.04 && p2.target_token_count === P2_DIAGNOSTIC_TOKENS && p2.step_count === P2_DIAGNOSTIC_STEPS, String(quality.max_drift)))
  const reusePolicy = (p2.reuse_policy ?? {}) as Record<string, unknown>
  results.push(check('10_reuse_counts_reproducible', typeof reuse.max_document_take_count === 'number' && reusePolicy.unique_is_not_claimed_for_repeated_tokens === true && typeof reuse.unique_token_exposure_est === 'number' && typeof reuse.repeated_token_exposure_est === 'number' && reuse.disproportionate_single_document === false, String(reuse.max_document_take_count)))
  results.push(check('11_floor_at_zero', floorZero === 'UNCHANGED_AT_FLOOR' && boundary.proofs?.floor_zero_not_degradation === true && stopPy.includes('UNCHANGED_AT_FLOOR'), floorZero))
  results.push(check('12_uniqueness_sign', uniqueLower.generation_axis_states.unique256 === 'DEGRADED' && uniqueLower.generation_axis_states.unique128 === 'DEGRADED' && uniqueHigher.generation_axis_states.unique256 === 'IMPROVED' && UNIQUE_DEGRADE_DELTA === stopJson.unique_degrade_delta && UNIQUE_IMPROVE_DELTA === stopJson.unique_improve_delta && stopJson.version === STOP_POLICY_VERSION, `deg=${uniqueLower.generation_axis_states.unique256}`))
  results.push(check('13_two_hits_soft_stop', twoHits.decision === 'SOFT_STOP' && twoHits.hit_count >= 2 && twoHits.next_optimizer_step_allowed === false && boundary.proofs?.two_hits_soft_stop === true, twoHits.decision))
  results.push(check('14_soft_stop_blocks_next', fs.existsSync(softStopSim) && twoHits.next_optimizer_step_allowed === false && oneHit.decision === 'REVIEW_REQUIRED' && oneHit.next_optimizer_step_allowed === false && zeroHit.decision === 'CONTINUE_ELIGIBLE' && hard.decision === 'HARD_ABORT' && boundary.all_proofs_ok === true, oneHit.decision))
  results.push(check('15_run_000004_replay_deterministic', tsReplayOk && replay.history_rewritten === false && typeof replay.step15_decision === 'string' && tsReplay['15'] === replay.step15_decision && tsReplay['20'] === replay.step20_decision, JSON.stringify(tsReplay)))
  results.push(check('16_runner_validator_share_policy', STOP_POLICY_VERSION === 'wrim-stop-policy-v1' && stopJson.version === STOP_POLICY_VERSION && stopJson.soft_stop_min_hits === 2 && p1Py.includes('from stop_policy import') && stopPy.includes('def decide(') && !p1Py.includes('def decide('), STOP_POLICY_VERSION))
  results.push(check('17_p2_not_authorized', p2.AUTHORIZED === false && p2.status !== 'AUTHORIZED' && (['READY_TO_REQUEST_AUTHORIZATION', 'NOT_READY'].includes(String(p2.status))) && report?.P2_AUTHORIZED === false && p2.P2_RUN_ID_PROPOSAL === P2_RUN_ID_PROPOSAL, String(p2.status)))
  results.push(check('18_training_authorization_off', TRAINING_AUTHORIZATION === 'OFF' && report?.TRAINING_AUTHORIZATION === 'OFF' && p2.TRAINING_AUTHORIZATION === 'OFF' && STAGE3_AUTHORIZATION === 'NO' && STAGE3B_EXECUTION_READINESS === false && report?.STAGE3B_AUTHORIZATION === 'NO' && CURRENT_WRIM_TRAINING === 'NOT_RUNNING' && status.train_button === false && status.p2_authorized === false, TRAINING_AUTHORIZATION))

  results.push(check('19_p1_ready', report?.ok === true && report?.kind === FOUNDATIONAL_P1_KIND && report?.p1_id === FOUNDATIONAL_P1_ID && report?.final_classification === FOUNDATIONAL_P1_CLASSIFICATION_READY && quality.all_packing_gates_ok === true, String(report?.final_classification)))
  results.push(check('20_source_design', report?.source_remediation_classification === FOUNDATIONAL_REMEDIATION_CLASSIFICATION && design?.final_classification === FOUNDATIONAL_REMEDIATION_CLASSIFICATION, String(report?.source_remediation_design_id)))
  results.push(check('21_gates_abch', gates.A_no_100pct_json_unless_unavoidable === true && gates.B_no_100pct_c0_unless_unavoidable === true && gates.C_dominant_burst_bounded === true && gates.H_no_corpus_mutation === true && gates.G_provenance_complete === true, JSON.stringify(gates)))
  results.push(check('22_status_lock', (['FOUNDATIONAL_P1_READINESS_COMPLETE', 'FOUNDATIONAL_P1_STREAM_REFINEMENT_COMPLETE', 'FOUNDATIONAL_P1_SOVEREIGNTY_AUDIT_COMPLETE', 'FOUNDATIONAL_P2_TRAINING_CONFIGURATION_REQUIRED', 'FOUNDATIONAL_P2_RECIPE_READY', 'FOUNDATIONAL_P2_DIAGNOSTIC_COMPLETE', 'FOUNDATIONAL_P2_ROOT_CAUSE_COMPLETE', 'P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN', 'STAGE3A_CANDIDATE_ADJUDICATION_COMPLETE'].includes(NEXT_AUTHORIZED_PASS)) && status.next_authorized_pass === NEXT_AUTHORIZED_PASS, NEXT_AUTHORIZED_PASS))
  results.push(check('23_qwen_rael', QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && RAEL_STATUS === 'NOT_IMPLEMENTED' && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED' && report?.nothing_pushed === true && report?.nothing_deployed === true && tryForbiddenEnvAction('START_STAGE_3').denied && tryForbiddenEnvAction('PUSH_CHANGES').denied, RAEL_STATUS))
  results.push(check('24_corpus_check_literal', packPy.includes('Does not mutate WR-CORPUS') && p1Py.includes('Does not mutate WR-CORPUS'), 'no mutation'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runFoundationalP1Validation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
