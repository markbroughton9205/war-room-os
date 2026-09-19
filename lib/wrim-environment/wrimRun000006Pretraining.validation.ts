/**
 * #23 WRIM1-RUN-000006 pre-training gate validation.
 * Zero optimizer steps. Does not start WRIM1-RUN-000006 training.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  PARENT_SHA256,
  RAEL_STATUS,
  RUN_000006_ID,
  RUN_000006_TRAINING_AUTHORIZATION,
  STAGE3B_EXECUTION_READINESS,
  TOKENIZER_SHA256,
  TRAINING_AUTHORIZATION,
} from './identity'
import {
  FROZEN_GENESIS_TRAIN_IDS,
  REFERENCE_NLL_CANONICAL_LF_SHA256,
  RUN_000006_AUTHORIZE_FLAG,
  RUN_000006_CONFIG_KIND,
  RUN_000006_FULL_EVAL_STEPS,
  RUN_000006_KIND,
  RUN_000006_MAX_TOKENS,
  RUN_000006_PEAK_LR,
  RUN_000006_REHEARSAL,
  RUN_000006_SEED,
  RUN_000006_STEPS,
  RUN_000006_TOKENS_PER_STEP,
  RUN_000006_WARMUP,
} from './run000006Pretraining'
import { STAGE3_EVAL_SUITE_SHA256 } from './stage3Design'
import { resolveWrimEnvironmentPaths } from './paths'
import { tryForbiddenEnvAction } from './redTeam'
import { wrimEnvironmentStatusPayload } from './status'
import { dumpTokenizerPath } from '../wr-tokenizer/inspect'
import { dumpWrim0FinalWeights } from '../wrim-reconciliation/paths'
import { sha256File } from '../wr-corpus/hashes'
import { defaultRecoveryDumpRoot } from '../wr-corpus/recoverySource'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function noOptimizer(src: string): boolean {
  return !src.includes('optimizer.step(') && !src.includes('AdamW(') && !src.includes('torch.optim')
}

function resolveDump(): string {
  const env = process.env.WAR_ROOM_RECOVERY_DUMP?.trim()
  const seagate =
    '/run/media/chosenone/Seagate/WAR_ROOM_LINUX_MIGRATION/tree/Users/markb/Documents/Codex/2026-09-04/referenced-chatgpt-conversation-this-is-an-3/outputs/mac-model-recovery-20260904-220419'
  for (const c of [env, defaultRecoveryDumpRoot(), seagate]) {
    if (!c) continue
    const tok = path.join(c, 'model-lab', 'manifests', 'wrim0_tokenizer_v16384', 'tokenizer.json')
    if (fs.existsSync(tok)) return c
  }
  return defaultRecoveryDumpRoot()
}

export async function runRun000006PretrainingValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.run000006PreflightReportPath)
    ? (JSON.parse(fs.readFileSync(live.run000006PreflightReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const cfg = fs.existsSync(live.run000006ConfigPath)
    ? (JSON.parse(fs.readFileSync(live.run000006ConfigPath, 'utf8')) as Record<string, unknown>)
    : null
  const unsigned = fs.existsSync(live.run000006UnsignedConfigPath)
    ? fs.readFileSync(live.run000006UnsignedConfigPath)
    : null
  const unsignedSha = unsigned ? createHash('sha256').update(unsigned).digest('hex') : ''
  const dry = (report?.dry_run ?? {}) as Record<string, unknown>
  const packing = (report?.packing ?? {}) as Record<string, unknown>
  const decision = (packing.decision ?? {}) as Record<string, unknown>
  const nll = (report?.reference_nll ?? {}) as Record<string, unknown>
  const pyPre = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/run000006_preflight.py'), 'utf8')
  const pyCtrl = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/run000006_controller.py'), 'utf8')
  const pyGates = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/run000006_gates.py'), 'utf8')
  const pySched = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/run000006_schedule.py'), 'utf8')
  const pyColl = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/run000006_collision.py'), 'utf8')
  const pyInt = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/run000006_integrity.py'), 'utf8')
  const pyTrain = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/run000006_train.py'), 'utf8')
  const pyPack = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/experiment_pack.py'), 'utf8')
  const pyCoverage = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/run000006_coverage.py'), 'utf8')
  const pyRunPack = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/run000006_pack.py'), 'utf8')
  const pyStage3a = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage3a_run.py'), 'utf8')
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts/run-wrim-run000006-pretraining.mjs'), 'utf8')
  const status = wrimEnvironmentStatusPayload()
  const dump = resolveDump()
  const parentSha = fs.existsSync(dumpWrim0FinalWeights(dump)) ? await sha256File(dumpWrim0FinalWeights(dump)) : ''
  const tokSha = fs.existsSync(dumpTokenizerPath(dump)) ? await sha256File(dumpTokenizerPath(dump)) : ''
  const ckptExists = fs.existsSync(live.run000006CheckpointDir)
  const ckptHasWeights =
    ckptExists &&
    fs.existsSync(path.join(live.run000006CheckpointDir, 'model.safetensors')) === true

  results.push(check('1_kind', report?.kind === RUN_000006_KIND && report?.run_id === RUN_000006_ID && RUN_000006_ID === 'WRIM1-RUN-000006', String(report?.kind)))
  results.push(check('2_unused', report?.RUN_ID_UNUSED === true && report?.READY_FOR_TRAINING_AUTHORIZATION === 'YES', String(report?.RUN_ID_UNUSED)))
  results.push(check('3_parent', report?.PARENT_HASH_MATCH === true && parentSha === PARENT_SHA256 && String(report?.parent_sha256) === PARENT_SHA256, String(report?.parent_sha256)))
  results.push(check('4_tokenizer', report?.TOKENIZER_HASH_MATCH === true && tokSha === TOKENIZER_SHA256 && String(report?.tokenizer_sha256) === TOKENIZER_SHA256, String(report?.tokenizer_sha256)))
  results.push(check('5_suite', report?.SUITE_HASH_MATCH === true && String(report?.suite_sha256) === STAGE3_EVAL_SUITE_SHA256, String(report?.suite_sha256)))
  results.push(check('6_nll', report?.REFERENCE_NLL_INTEGRITY === 'PASS' && nll.matches_frozen_expected === true && String(nll.CANONICAL_LF_SHA256) === REFERENCE_NLL_CANONICAL_LF_SHA256 && nll.rewritten === false, String(nll.CANONICAL_LF_SHA256)))
  results.push(check('7_packing', report?.PACKING_PREFLIGHT === 'PASS' && decision.ok === true && Array.isArray(packing.STARVED_DOC_IDS) && (packing.STARVED_DOC_IDS as unknown[]).length === 0 && Number(packing.MAX_REHEARSAL_DOC_SHARE) < 0.5 && String(packing.strategy) === RUN_000006_REHEARSAL, String(packing.MAX_REHEARSAL_DOC_SHARE)))
  results.push(check('8_coverage_ids', pyCoverage.includes('FROZEN_GENESIS_TRAIN_IDS') && pyCoverage.includes(FROZEN_GENESIS_TRAIN_IDS[0]) && pyPack.includes('FROZEN_GENESIS_TRAIN_IDS') && pyStage3a.includes('all_docs = list(FROZEN_GENESIS_TRAIN_IDS)') && pyCoverage.includes('STARVED_DOC_IDS') && pyRunPack.includes('take_round_robin_docs'), 'frozen pool'))
  results.push(check('9_greedy_256', report?.FULL_GREEDY_256_GATE_PATH === 'VERIFIED' && pyGates.includes('greedy_256_required') && JSON.stringify(RUN_000006_FULL_EVAL_STEPS) && cfg?.REQUIRE_GREEDY_256 === true && cfg?.COMPACT_EVAL_FORBIDDEN_FOR_GATES === true, 'full 256'))
  results.push(check('10_gates', report?.WARNING_GATES === 'VERIFIED' && report?.REVIEW_GATES === 'VERIFIED' && report?.HARD_STOP_GATES === 'VERIFIED' && pyGates.includes('0.105') && pyGates.includes('0.022') && pyCtrl.includes('CASE_4_dnll_hard_stop') && pyCtrl.includes('CASE_8_nan_hard_stop'), 'three-tier'))
  results.push(check('11_dry_run', dry.ok === true && Number(dry.passed) >= 12 && Number(dry.optimizer_steps) === 0 && dry.AdamW_constructed === false, String(dry.passed)))
  results.push(check('12_collision_guard', report?.RUN_COLLISION_GUARD === 'VERIFIED' && pyColl.includes('PRETRAIN_ABORT') && pyCtrl.includes('CASE_11_run_id_collision'), 'collision'))
  results.push(check('13_no_train_this_pass', report?.optimizer_steps === 0 && report?.AdamW_constructed === false && report?.training_executed === false && report?.checkpoints_modified === false && noOptimizer(pyPre) && noOptimizer(pyCtrl) && noOptimizer(pyGates) && noOptimizer(pySched) && noOptimizer(pyColl) && noOptimizer(pyInt) && noOptimizer(pyCoverage) && noOptimizer(pyRunPack) && noOptimizer(runner), 'zero'))
  results.push(check('14_train_gated', pyTrain.includes(RUN_000006_AUTHORIZE_FLAG) && pyTrain.includes('ON_FOR_WRIM1_RUN_000006_ONLY') && pyTrain.includes('denial_payload') && TRAINING_AUTHORIZATION === 'OFF' && RUN_000006_TRAINING_AUTHORIZATION === 'OFF' && status.train_button === false && CURRENT_WRIM_TRAINING === 'NOT_RUNNING', 'gated'))
  results.push(check('15_config', cfg?.kind === RUN_000006_CONFIG_KIND && cfg?.RUN_ID === RUN_000006_ID && Number(cfg?.STEPS) === RUN_000006_STEPS && Number(cfg?.TOKENS_PER_STEP) === RUN_000006_TOKENS_PER_STEP && Number(cfg?.MAX_TOKENS) === RUN_000006_MAX_TOKENS && Number(cfg?.PEAK_LR) === RUN_000006_PEAK_LR && Number(cfg?.WARMUP_STEPS) === RUN_000006_WARMUP && Number(cfg?.SEED) === RUN_000006_SEED && cfg?.REHEARSAL_MODE === RUN_000006_REHEARSAL && cfg?.TRAINING_AUTHORIZATION === 'OFF' && String(report?.TRAINING_CONFIG_SHA) === unsignedSha && unsignedSha.length === 64, String(report?.TRAINING_CONFIG_SHA)))
  results.push(check('16_no_ckpt', report?.checkpoints_modified === false && ckptHasWeights === false, String(live.run000006CheckpointDir)))
  results.push(check('17_no_promote', STAGE3B_EXECUTION_READINESS === false && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED' && RAEL_STATUS === 'NOT_IMPLEMENTED' && tryForbiddenEnvAction('PUSH_CHANGES').denied && report?.nothing_pushed === true && report?.STAGE3B_executed === false, 'blocked'))
  results.push(check('18_ready', report?.READY_FOR_TRAINING_AUTHORIZATION === 'YES' && Array.isArray(report?.BLOCKERS_REMAINING) && (report.BLOCKERS_REMAINING as unknown[]).length === 0, String(report?.READY_FOR_TRAINING_AUTHORIZATION)))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runRun000006PretrainingValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
