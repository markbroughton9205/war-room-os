/**
 * WRIM1-RUN-000007 pre-training gate validation.
 * Zero optimizer steps. Does not start WRIM1-RUN-000007 training.
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
  RUN_000007_ID,
  RUN_000007_TRAINING_AUTHORIZATION,
  STAGE3B_EXECUTION_READINESS,
  TOKENIZER_SHA256,
  TRAINING_AUTHORIZATION,
} from './identity'
import {
  INSTRUCTION_ADDENDUM_SHA256,
  RUN_000007_AUTHORIZE_FLAG,
  RUN_000007_CONFIG_KIND,
  RUN_000007_FULL_EVAL_STEPS,
  RUN_000007_KIND,
  RUN_000007_MAX_TOKENS,
  RUN_000007_PEAK_LR,
  RUN_000007_REHEARSAL,
  RUN_000007_SEED,
  RUN_000007_STEPS,
  RUN_000007_TOKENS_PER_STEP,
  RUN_000007_WARMUP,
  STAGE3_SUITE_SHA256,
} from './run000007Pretraining'
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

export async function runRun000007PretrainingValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.run000007PreflightReportPath)
    ? (JSON.parse(fs.readFileSync(live.run000007PreflightReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const cfg = fs.existsSync(live.run000007ConfigPath)
    ? (JSON.parse(fs.readFileSync(live.run000007ConfigPath, 'utf8')) as Record<string, unknown>)
    : null
  const unsigned = fs.existsSync(live.run000007UnsignedConfigPath)
    ? fs.readFileSync(live.run000007UnsignedConfigPath)
    : null
  const unsignedSha = unsigned ? createHash('sha256').update(unsigned).digest('hex') : ''
  const dry = (report?.dry_run ?? {}) as Record<string, unknown>
  const packing = (report?.packing ?? {}) as Record<string, unknown>
  const decision = (packing.decision ?? {}) as Record<string, unknown>
  const pyPre = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/run000007_preflight.py'), 'utf8')
  const pyCtrl = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/run000007_controller.py'), 'utf8')
  const pyGates = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/run000007_gates.py'), 'utf8')
  const pySched = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/run000007_schedule.py'), 'utf8')
  const pyColl = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/run000007_collision.py'), 'utf8')
  const pyFilt = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/run000007_filter.py'), 'utf8')
  const pyTrain = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/run000007_train.py'), 'utf8')
  const pyPack = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/run000007_pack.py'), 'utf8')
  const pyLoad = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/wrim_proven_load.py'), 'utf8')
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts/run-wrim-run000007-pretraining.mjs'), 'utf8')
  const status = wrimEnvironmentStatusPayload()
  const ckptExists = fs.existsSync(live.run000007CheckpointDir)
  const ckptHasWeights = ckptExists && fs.existsSync(path.join(live.run000007CheckpointDir, 'model.safetensors')) === true

  results.push(check('1_kind', report?.kind === RUN_000007_KIND && report?.run_id === RUN_000007_ID && RUN_000007_ID === 'WRIM1-RUN-000007', String(report?.kind)))
  results.push(check('2_unused', report?.RUN_ID_UNUSED === true && report?.READY_FOR_TRAINING_AUTHORIZATION === 'YES', String(report?.RUN_ID_UNUSED)))
  results.push(check('3_parent', report?.PARENT_HASH_VERIFIED === true && String(report?.PARENT_HASH) === PARENT_SHA256, String(report?.PARENT_HASH)))
  results.push(check('4_tokenizer', report?.TOKENIZER_HASH_VERIFIED === true && String(report?.TOKENIZER_HASH) === TOKENIZER_SHA256, String(report?.TOKENIZER_HASH)))
  results.push(check('5_suite', report?.STAGE3_SUITE_HASH_VERIFIED === true && String(report?.STAGE3_SUITE_HASH) === STAGE3_SUITE_SHA256, String(report?.STAGE3_SUITE_HASH)))
  results.push(check('6_addendum', report?.INSTRUCTION_ADDENDUM_HASH_VERIFIED === true && String(report?.INSTRUCTION_ADDENDUM_HASH) === INSTRUCTION_ADDENDUM_SHA256, String(report?.INSTRUCTION_ADDENDUM_HASH)))
  results.push(
    check(
      '7_packing',
      report?.PACKING_PREFLIGHT === 'PASS' &&
        decision.ok === true &&
        Array.isArray(packing.STARVED_DOC_IDS) &&
        (packing.STARVED_DOC_IDS as unknown[]).length === 0 &&
        Number(packing.MAX_REHEARSAL_DOC_SHARE) < 0.5 &&
        String(packing.strategy) === RUN_000007_REHEARSAL &&
        packing.EVAL_DUMP_LEAKAGE === 'NONE' &&
        packing.INSTRUCTION_ADDENDUM_LEAKAGE === 'NONE',
      String(packing.MAX_REHEARSAL_DOC_SHARE),
    ),
  )
  results.push(check('8_filter', pyFilt.includes('wrim0_eval_results.json') && pyFilt.includes('PRODUCTION_DATABASE_PRIVILEGE_REPAIR.md') && !pyFilt.includes('ban the word tokenizer') && pyPack.includes('encode_corpus1_filtered'), 'provenance filter'))
  results.push(check('9_greedy_256', report?.FULL_GREEDY_256_PATH === 'VERIFIED' && pyGates.includes('greedy_256_required') && Boolean(JSON.stringify(RUN_000007_FULL_EVAL_STEPS)) && cfg?.REQUIRE_GREEDY_256 === true && cfg?.COMPACT_EVAL_FORBIDDEN_FOR_GATES === true, 'full 256'))
  results.push(check('10_new_failure', report?.NEW_FAILURE_GATE === 'VERIFIED' && pyGates.includes('NEW_FAILURES_VS_PARENT') && pyCtrl.includes('CASE_5_substitution_same_aggregate') && pyCtrl.includes('CASE_6_new_failures_vs_parent'), 'new-failure'))
  results.push(check('11_dry_run', dry.ok === true && Number(dry.passed) >= 20 && Number(dry.optimizer_steps) === 0 && dry.AdamW_constructed === false, String(dry.passed)))
  results.push(check('12_collision_guard', report?.RUN_COLLISION_GUARD === 'VERIFIED' && pyColl.includes('PRETRAIN_ABORT') && pyCtrl.includes('CASE_18_run_id_collision'), 'collision'))
  results.push(check('13_no_train_this_pass', report?.optimizer_steps === 0 && report?.AdamW_constructed === false && report?.training_executed === false && report?.checkpoints_modified === false && noOptimizer(pyPre) && noOptimizer(pyCtrl) && noOptimizer(pyGates) && noOptimizer(pySched) && noOptimizer(pyColl) && noOptimizer(pyFilt) && noOptimizer(pyPack) && noOptimizer(runner), 'zero'))
  results.push(check('14_train_gated', pyTrain.includes(RUN_000007_AUTHORIZE_FLAG) && pyTrain.includes('ON_FOR_WRIM1_RUN_000007_ONLY') && pyTrain.includes('denial_payload') && pyLoad.includes('load_parent_into_model') && TRAINING_AUTHORIZATION === 'OFF' && RUN_000007_TRAINING_AUTHORIZATION === 'OFF' && status.train_button === false && CURRENT_WRIM_TRAINING === 'NOT_RUNNING', 'gated'))
  results.push(check('15_config', cfg?.kind === RUN_000007_CONFIG_KIND && cfg?.RUN_ID === RUN_000007_ID && Number(cfg?.STEPS) === RUN_000007_STEPS && Number(cfg?.TOKENS_PER_STEP) === RUN_000007_TOKENS_PER_STEP && Number(cfg?.MAX_TOKENS) === RUN_000007_MAX_TOKENS && Number(cfg?.PEAK_LR) === RUN_000007_PEAK_LR && Number(cfg?.WARMUP_STEPS) === RUN_000007_WARMUP && Number(cfg?.SEED) === RUN_000007_SEED && cfg?.REHEARSAL_MODE === RUN_000007_REHEARSAL && cfg?.TRAINING_AUTHORIZATION === 'OFF' && String(report?.TRAINING_CONFIG_SHA) === unsignedSha && unsignedSha.length === 64, String(report?.TRAINING_CONFIG_SHA)))
  results.push(check('16_no_ckpt', report?.checkpoints_modified === false && ckptHasWeights === false, String(live.run000007CheckpointDir)))
  results.push(check('17_no_promote', STAGE3B_EXECUTION_READINESS === false && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED' && RAEL_STATUS === 'NOT_IMPLEMENTED' && tryForbiddenEnvAction('PUSH_CHANGES').denied && report?.nothing_pushed === true && report?.STAGE3B_executed === false, 'blocked'))
  results.push(check('18_ready', report?.READY_FOR_TRAINING_AUTHORIZATION === 'YES' && Array.isArray(report?.BLOCKERS_REMAINING) && (report.BLOCKERS_REMAINING as unknown[]).length === 0, String(report?.READY_FOR_TRAINING_AUTHORIZATION)))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runRun000007PretrainingValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
