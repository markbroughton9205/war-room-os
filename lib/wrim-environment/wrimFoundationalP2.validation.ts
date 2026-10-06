/**
 * #23 WRIM1-RUN-000005 P2 sovereign foundational CLM diagnostic validation.
 * Proves configuration-incomplete halt: 0 optimizer steps, seed 2303 only, no 2302 training.
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
  FROZEN_2302_STREAM_SHA256,
  HISTORICAL_P1_STREAM_SHA256,
  P1_SOVEREIGN_SEED,
  P2_SOVEREIGN_STREAM_READY,
} from './foundationalP1'
import {
  FORBIDDEN_2302_PACKED_SOURCE_SHA256,
  FORBIDDEN_2302_STREAM_SHA256,
  FORBIDDEN_P1_STREAM_SHA256,
  P2_CLASSIFICATION_INCOMPLETE,
  P2_COMPACT_CADENCE,
  P2_EXCLUDED_DOCUMENTS,
  P2_FULL_CADENCE,
  P2_KIND,
  P2_MAX_STEPS,
  P2_MAX_TOKENS,
  P2_RUN_ID,
  P2_SOVEREIGN_PACKED_SOURCE_SHA256,
  P2_SOVEREIGN_STREAM_SHA256,
} from './foundationalP2'
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

export async function runFoundationalP2Validation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.foundationalP2ReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalP2ReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const sovereignty = fs.existsSync(live.foundationalP1SovereignReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalP1SovereignReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const design = fs.existsSync(live.foundationalRemediationDesignReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalRemediationDesignReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const p2Py = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/foundational_p2_run.py'), 'utf8')
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts/run-wrim-foundational-p2.mjs'), 'utf8')
  const designPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/foundational_remediation_design.py'), 'utf8')
  const status = wrimEnvironmentStatusPayload()
  const cfg = (report?.resolved_training_configuration ?? {}) as Record<string, unknown>
  const missing = Array.isArray(cfg.missing_training_critical_fields) ? (cfg.missing_training_critical_fields as string[]) : []
  const excluded = (report?.excluded_document_proof ?? {}) as Record<string, unknown>
  const forbidden = (report?.forbidden_streams_untouched ?? {}) as Record<string, unknown>
  const hardware = (report?.hardware ?? {}) as Record<string, unknown>
  const sovereignNpy = path.join(live.foundationalP1SovereignDir, 'sovereign-p2-diagnostic-stream.npy')
  const refineNpy = path.join(live.foundationalP1RefineDir, 'refined-p2-diagnostic-stream.npy')
  const p1Npy = path.join(live.foundationalP1Dir, 'p2-diagnostic-stream.npy')
  const parentSha = fs.existsSync(dumpWrim0FinalWeights()) ? await sha256File(dumpWrim0FinalWeights()) : ''
  const tokSha = fs.existsSync(dumpTokenizerPath()) ? await sha256File(dumpTokenizerPath()) : ''
  const sovereignOnDisk = fs.existsSync(sovereignNpy) ? npyPayloadSha256(sovereignNpy) : ''
  const refineOnDisk = fs.existsSync(refineNpy) ? npyPayloadSha256(refineNpy) : ''
  const p1OnDisk = fs.existsSync(p1Npy) ? npyPayloadSha256(p1Npy) : ''
  const p2Phase = ((design?.development_phases ?? []) as Array<Record<string, unknown>>).find(p => p.id === 'P2_BASE_PRETRAINING_PILOT')
  const p2PhaseText = JSON.stringify(p2Phase ?? {})
  const claudeMd = fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8')

  results.push(check('1_commander_auth', report?.commander_authorization === 'AUTHORIZED' && report?.P2_AUTHORIZED === true && report?.run_id === P2_RUN_ID && report?.kind === P2_KIND, String(report?.commander_authorization)))
  results.push(check('2_parent', report?.parent_identity === 'WRIM-0' && report?.parent_sha256 === PARENT_SHA256 && parentSha === PARENT_SHA256, String(report?.parent_sha256)))
  results.push(check('3_tokenizer', report?.tokenizer_identity === 'WR-TOKENIZER-0' && report?.tokenizer_sha256 === TOKENIZER_SHA256 && tokSha === TOKENIZER_SHA256, String(report?.tokenizer_sha256)))
  results.push(check('4_seed_2303', report?.seed === P1_SOVEREIGN_SEED && p2Py.includes('SOVEREIGN_SEED = 2303') && !p2Py.includes('SOVEREIGN_SEED = 2302'), String(report?.seed)))
  results.push(check('5_stream_sha', report?.stream_sha256 === P2_SOVEREIGN_STREAM_SHA256 && sovereignOnDisk === P2_SOVEREIGN_STREAM_SHA256 && report?.packed_source_sha256 === P2_SOVEREIGN_PACKED_SOURCE_SHA256, String(report?.stream_sha256)))
  results.push(check('6_forbidden_streams', report?.stream_sha256 !== FORBIDDEN_2302_STREAM_SHA256 && report?.stream_sha256 !== FORBIDDEN_P1_STREAM_SHA256 && report?.packed_source_sha256 !== FORBIDDEN_2302_PACKED_SOURCE_SHA256 && refineOnDisk === FROZEN_2302_STREAM_SHA256 && p1OnDisk === HISTORICAL_P1_STREAM_SHA256 && forbidden.seed_2302_not_trained === true, String(forbidden.seed_2302)))
  results.push(check('7_sovereignty', sovereignty?.final_classification === P2_SOVEREIGN_STREAM_READY && excluded.claude_md_absent_from_packed_lineage === true && JSON.stringify(excluded.required) === JSON.stringify([...P2_EXCLUDED_DOCUMENTS]) && claudeMd.includes('guidance to Claude Code'), String(excluded.claude_md_absent_from_packed_lineage)))
  results.push(check('8_config_incomplete', missing.includes('peak_lr') && missing.includes('warmup_steps') && missing.includes('scheduler_formula_for_1000_steps') && cfg.complete === false && cfg.improvised === false && !p2PhaseText.includes('peak_lr') && !designPy.includes('P2_PEAK_LR'), missing.join(',')))
  results.push(check('9_eval_cadence_recorded', JSON.stringify(cfg.compact_generation_check_cadence) === JSON.stringify([...P2_COMPACT_CADENCE]) && JSON.stringify(cfg.full_evaluation_cadence) === JSON.stringify([...P2_FULL_CADENCE]) && cfg.max_authorized_steps === P2_MAX_STEPS && cfg.max_authorized_tokens === P2_MAX_TOKENS, 'cadence'))
  results.push(check('10_optimizer_zero', report?.optimizer_steps === 0 && report?.optimizer_steps_this_pass === 0 && report?.tokens_trained === 0 && report?.AdamW_constructed === false && report?.ready_to_run_optimizer === false && report?.P2_EXECUTION_STARTED === false && noOptimizer(p2Py) && noOptimizer(runner), String(report?.optimizer_steps)))
  results.push(check('11_training_off', TRAINING_AUTHORIZATION === 'OFF' && report?.TRAINING_AUTHORIZATION === 'OFF' && CURRENT_WRIM_TRAINING === 'NOT_RUNNING' && status.train_button === false && status.p2_authorized === false, TRAINING_AUTHORIZATION))
  results.push(check('12_stop_policy', report?.stop_policy_version === STOP_POLICY_VERSION && report?.stop_policy_unchanged === true && STOP_POLICY_VERSION === 'wrim-stop-policy-v1', STOP_POLICY_VERSION))
  results.push(check('13_no_p3_stage3b', report?.P3_AUTHORIZED === false && report?.STAGE3B_AUTHORIZATION === 'NO' && STAGE3_AUTHORIZATION === 'NO' && STAGE3B_EXECUTION_READINESS === false && report?.CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED' && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', 'blocked'))
  results.push(check('14_hardware_recorded', typeof hardware.pytorch === 'string' && typeof hardware.device_selected === 'string', JSON.stringify({ gpu: hardware.gpu, torch: hardware.pytorch })))
  results.push(check('15_nothing_pushed_deployed', report?.nothing_pushed === true && report?.nothing_deployed === true && tryForbiddenEnvAction('PUSH_CHANGES').denied && tryForbiddenEnvAction('START_STAGE_3').denied && QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && RAEL_STATUS === 'NOT_IMPLEMENTED', 'denied'))
  results.push(check('16_classification', report?.ok === true && report?.final_classification === P2_CLASSIFICATION_INCOMPLETE && report?.terminal_reason === 'CONFIGURATION_INCOMPLETE' && report?.hard_abort !== true, String(report?.final_classification)))
  results.push(check('17_identity_lock', (['FOUNDATIONAL_P2_TRAINING_CONFIGURATION_REQUIRED', 'FOUNDATIONAL_P2_RECIPE_READY', 'FOUNDATIONAL_P2_DIAGNOSTIC_COMPLETE', 'FOUNDATIONAL_P2_ROOT_CAUSE_COMPLETE', 'P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN', 'STAGE3A_CANDIDATE_ADJUDICATION_COMPLETE'].includes(NEXT_AUTHORIZED_PASS)) && status.next_authorized_pass === NEXT_AUTHORIZED_PASS, NEXT_AUTHORIZED_PASS))
  results.push(check('18_no_step0_eval', report?.step0_baseline === null && Array.isArray(report?.compact_trajectory) && (report?.compact_trajectory as unknown[]).length === 0, 'no eval'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runFoundationalP2Validation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
