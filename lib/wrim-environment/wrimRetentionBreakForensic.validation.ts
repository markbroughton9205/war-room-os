/**
 * #23 WRIM1-RUN-000005 retention-break forensic audit validation.
 * Analysis only. Zero optimizer steps. No P3/STAGE3B. No promotion.
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
  STAGE3_AUTHORIZATION,
  STAGE3B_EXECUTION_READINESS,
  TOKENIZER_SHA256,
  TRAINING_AUTHORIZATION,
} from './identity'
import { P2_AUTHORIZED_RECIPE_SHA256 } from './foundationalP2Train'
import { P2_RUN_ID, P2_SOVEREIGN_STREAM_SHA256 } from './foundationalP2'
import {
  RETENTION_BREAK_FORENSIC_CLASSIFICATIONS,
  RETENTION_BREAK_FORENSIC_KIND,
  RETENTION_BREAK_HARD_ABORT_DNLL,
} from './retentionBreakForensic'
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

export async function runRetentionBreakForensicValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.retentionBreakForensicReportPath)
    ? (JSON.parse(fs.readFileSync(live.retentionBreakForensicReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const py = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/retention_break_forensic.py'), 'utf8')
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts/run-wrim-retention-break-forensic.mjs'), 'utf8')
  const status = wrimEnvironmentStatusPayload()
  const cls = String(report?.final_classification ?? '')
  const inventory = Array.isArray(report?.artifact_inventory) ? (report?.artifact_inventory as unknown[]) : []
  const drift = (report?.layerwise_drift ?? {}) as Record<string, Record<string, unknown>>
  const interp = (report?.interpolation ?? {}) as Record<string, unknown>
  const experiments = Array.isArray(report?.proposed_experiments) ? (report.proposed_experiments as unknown[]) : []
  const retention = (report?.retention ?? {}) as Record<string, unknown>
  const dyn = (report?.update_dynamics ?? {}) as Record<string, unknown>
  const clip = (dyn.clipping ?? {}) as Record<string, unknown>
  const post = ((clip.postclip_norm ?? {}) as Record<string, unknown>).epistemic
  const top20 = ((drift['step-50'] ?? {}).top_20_most_drifted ?? []) as unknown[]
  const families = (((retention['step-50'] ?? {}) as Record<string, unknown>).families ?? []) as unknown[]
  const stream = (report?.stream_forensics ?? {}) as Record<string, unknown>
  const windows = (stream.windows ?? {}) as Record<string, unknown>

  results.push(check('1_kind', report?.kind === RETENTION_BREAK_FORENSIC_KIND && report?.run_id === P2_RUN_ID, String(report?.kind)))
  results.push(check('2_identity', report?.parent_sha256 === PARENT_SHA256 && report?.tokenizer_sha256 === TOKENIZER_SHA256 && report?.stream_sha256 === P2_SOVEREIGN_STREAM_SHA256 && report?.recipe_sha256 === P2_AUTHORIZED_RECIPE_SHA256, String(report?.stream_sha256)))
  results.push(check('3_no_train', report?.optimizer_steps_this_pass === 0 && report?.AdamW_constructed === false && noOptimizer(py) && noOptimizer(runner) && !py.includes('save_file('), 'zero'))
  results.push(check('4_inventory', inventory.length >= 4 && Boolean(drift['step-10']) && Boolean(drift['step-25']) && Boolean(drift['step-50']) && top20.length === 20, `inv=${inventory.length} top20=${top20.length}`))
  results.push(check('5_retention_families', Boolean(retention['WRIM-0']) && Boolean(retention['step-10']) && families.length === 7, `families=${families.length}`))
  results.push(check('6_stream_windows', Boolean(windows['1-5']) && Boolean(windows['6-10']) && Boolean(windows['11-25']) && Boolean(windows['26-50']) && Number(stream.tokens_inspected) === 204800, String(stream.tokens_inspected)))
  results.push(check('7_clip_not_fabricated', post === 'UNKNOWN' && Number(clip.clipped_n) === 40, `post=${String(post)} clipped=${String(clip.clipped_n)}`))
  results.push(check('8_interp_eval_only', (['RAN', 'SKIPPED'].includes(String(interp.status))) && String(interp.kind || '').includes('NOT_SAVED') && py.includes('lerp_from_parent') && !py.includes('save_file('), String(interp.status)))
  results.push(check('9_experiments', experiments.length === 3 && experiments.length <= 3, String(experiments.length)))
  results.push(check('10_classification', (RETENTION_BREAK_FORENSIC_CLASSIFICATIONS as readonly string[]).includes(cls) && report?.promotion_candidate === false && report?.ready_for_another_training_run === false, cls))
  results.push(check('11_auth_off', TRAINING_AUTHORIZATION === 'OFF' && report?.TRAINING_AUTHORIZATION === 'OFF' && CURRENT_WRIM_TRAINING === 'NOT_RUNNING' && status.train_button === false, TRAINING_AUTHORIZATION))
  results.push(check('12_no_p3_stage3b', report?.P3_AUTHORIZED === false && report?.STAGE3B_AUTHORIZATION === 'NO' && STAGE3_AUTHORIZATION === 'NO' && STAGE3B_EXECUTION_READINESS === false && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', 'blocked'))
  results.push(check('13_nothing_pushed_deployed_installed', report?.nothing_pushed === true && report?.nothing_deployed === true && report?.nothing_installed === true && report?.weights_mutated === false && report?.corpus_mutated === false && report?.tokenizer_mutated === false && tryForbiddenEnvAction('PUSH_CHANGES').denied && QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && RAEL_STATUS === 'NOT_IMPLEMENTED', 'denied'))
  results.push(check('14_identity_lock', (['FOUNDATIONAL_P2_ROOT_CAUSE_COMPLETE', 'P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN', 'STAGE3A_CANDIDATE_ADJUDICATION_COMPLETE'].includes(NEXT_AUTHORIZED_PASS)) && status.next_authorized_pass === NEXT_AUTHORIZED_PASS && RETENTION_BREAK_HARD_ABORT_DNLL === 0.105, NEXT_AUTHORIZED_PASS))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runRetentionBreakForensicValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
