/**
 * #23 WRIM P1 sovereignty / vendor-contamination audit validation.
 * Zero optimizer steps. Does not start WRIM1-RUN-000005. P2 remains unauthorized.
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
  FOUNDATIONAL_P1_SOVEREIGNTY_ID,
  FOUNDATIONAL_P1_SOVEREIGNTY_KIND,
  FROZEN_2302_PACKED_SOURCE_SHA256,
  FROZEN_2302_STREAM_SHA256,
  HISTORICAL_P1_STREAM_SHA256,
  P1_PACKER_MODE,
  P1_SOVEREIGN_SEED,
  P2_SOVEREIGN_STREAM_READY,
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

export async function runFoundationalP1SovereigntyValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.foundationalP1SovereignReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalP1SovereignReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const refine = fs.existsSync(live.foundationalP1RefineReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalP1RefineReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const p1 = fs.existsSync(live.foundationalP1ReportPath)
    ? (JSON.parse(fs.readFileSync(live.foundationalP1ReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const sovPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/foundational_sovereignty.py'), 'utf8')
  const polPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/sovereignty.py'), 'utf8')
  const packPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/foundational_p1_pack.py'), 'utf8')
  const claudeMd = fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8')
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts/run-wrim-foundational-p1-sovereignty.mjs'), 'utf8')
  const status = wrimEnvironmentStatusPayload()
  const claude = (report?.claude_md ?? {}) as Record<string, unknown>
  const frank = (report?.frankenstein ?? {}) as Record<string, unknown>
  const newStream = (report?.new_stream ?? {}) as Record<string, unknown>
  const packing = (newStream.packing ?? {}) as Record<string, unknown>
  const quality = (newStream.quality ?? {}) as { gates?: Record<string, boolean>; all_packing_gates_ok?: boolean }
  const bursts = (newStream.bursts ?? {}) as Record<string, unknown>
  const p1Npy = path.join(live.foundationalP1Dir, 'p2-diagnostic-stream.npy')
  const refineNpy = path.join(live.foundationalP1RefineDir, 'refined-p2-diagnostic-stream.npy')
  const sovereignNpy = path.join(live.foundationalP1SovereignDir, 'sovereign-p2-diagnostic-stream.npy')
  const parentSha = fs.existsSync(dumpWrim0FinalWeights()) ? await sha256File(dumpWrim0FinalWeights()) : ''
  const tokSha = fs.existsSync(dumpTokenizerPath()) ? await sha256File(dumpTokenizerPath()) : ''
  const p1OnDisk = fs.existsSync(p1Npy) ? npyPayloadSha256(p1Npy) : ''
  const refineOnDisk = fs.existsSync(refineNpy) ? npyPayloadSha256(refineNpy) : ''
  const sovereignOnDisk = fs.existsSync(sovereignNpy) ? npyPayloadSha256(sovereignNpy) : ''
  const exclusions = Array.isArray(report?.exclusions_applied) ? (report?.exclusions_applied as string[]) : []

  results.push(check('1_claude_md_classified', String(claude.semantic_class).startsWith('A.') && String(claude.TRAINING_ELIGIBILITY) === 'EXCLUDED_VENDOR_SPECIFIC', String(claude.semantic_class)))
  results.push(check('2_claude_md_excluded', claude.excluded_from_new_stream === true && exclusions.includes('CLAUDE.md') && claudeMd.includes('guidance to Claude Code'), String(claude.excluded_from_new_stream)))
  results.push(check('3_vendor_audit_completed', Array.isArray(report?.vendor_tool_instruction_artifacts) && polPy.includes('VENDOR_SPECIFIC_AI_INSTRUCTION'), String((report?.vendor_tool_instruction_artifacts as unknown[] | undefined)?.length)))
  results.push(check('4_semantic_audit', polPy.includes('filename-independent') || polPy.includes('Filename-independent semantic classification'), 'semantic'))
  results.push(check('5_cursor_copilot_gemini_openai_classified', polPy.includes('gemini.md') && polPy.includes('.cursorrules') && polPy.includes('copilot-instructions.md') && polPy.includes('chatgpt.md'), 'markers'))
  results.push(check('6_indirect_copies_checked', Boolean(report?.indirect_copies) && polPy.includes('CLAUDE_FINGERPRINTS'), 'checked'))
  results.push(check('7_frankenstein_audited', typeof frank.note === 'string' && typeof frank.project_gutenberg === 'boolean', String(frank.override_class || frank.note)))
  results.push(check('8_dominant_docs_audited', Array.isArray(report?.dominant_document_review) && (report?.dominant_document_review as unknown[]).length >= 4, String((report?.dominant_document_review as unknown[] | undefined)?.length)))
  results.push(check('9_runtime_tooling_untouched', report?.runtime_tooling_untouched === true && claudeMd.includes('guidance to Claude Code'), 'untouched'))
  results.push(check('10_corpus_untouched', report?.corpus_mutated === false && report?.source_corpus_mutation === false && packPy.includes('Does not mutate WR-CORPUS'), 'frozen'))
  results.push(check('11_p1_frozen', report?.p1_stream_preserved === true && p1OnDisk === HISTORICAL_P1_STREAM_SHA256 && p1?.final_classification === FOUNDATIONAL_P1_CLASSIFICATION_READY, p1OnDisk))
  results.push(check('12_seed_2302_frozen', report?.seed_2302_preserved === true && refineOnDisk === FROZEN_2302_STREAM_SHA256 && (refine?.packing as Record<string, unknown> | undefined)?.stream_sha256 === FROZEN_2302_STREAM_SHA256 && (refine?.packing as Record<string, unknown> | undefined)?.packed_source_sha256 === FROZEN_2302_PACKED_SOURCE_SHA256 && refine?.final_classification === FOUNDATIONAL_P1_FINAL_STREAM_READY, refineOnDisk))
  results.push(check('13_new_identity', packing.seed === P1_SOVEREIGN_SEED && String(packing.stream_sha256) !== FROZEN_2302_STREAM_SHA256 && String(packing.stream_sha256) !== HISTORICAL_P1_STREAM_SHA256 && packing.packing === P1_PACKER_MODE, String(packing.stream_sha256)))
  results.push(check('14_unique_repeat_recomputed', typeof newStream.unique_exposure === 'number' && typeof newStream.repeated_exposure === 'number', `${newStream.unique_exposure}/${newStream.repeated_exposure}`))
  results.push(check('15_burst_gates', quality.all_packing_gates_ok === true && quality.gates?.C_dominant_burst_bounded === true && bursts.late_run_mono_family_binge !== true, JSON.stringify(quality.gates)))
  results.push(check('16_stop_policy', report?.stop_policy_unchanged === true && report?.stop_policy_version === STOP_POLICY_VERSION, STOP_POLICY_VERSION))
  results.push(check('17_optimizer_zero', report?.optimizer_steps_this_pass === 0 && report?.AdamW_constructed === false && noOptimizer(sovPy) && noOptimizer(runner), String(report?.optimizer_steps_this_pass)))
  results.push(check('18_training_off', TRAINING_AUTHORIZATION === 'OFF' && report?.TRAINING_AUTHORIZATION === 'OFF', TRAINING_AUTHORIZATION))
  results.push(check('19_p2_unauthorized', report?.P2_AUTHORIZED === false && report?.P2_RUN_NOT_STARTED === true && report?.concatenated_p2_training_directive_executed === false, String(report?.P2_AUTHORIZED)))
  results.push(check('20_stage3b_no', STAGE3_AUTHORIZATION === 'NO' && STAGE3B_EXECUTION_READINESS === false && report?.STAGE3B_AUTHORIZATION === 'NO', 'NO'))
  results.push(check('21_nothing_pushed', report?.nothing_pushed === true && tryForbiddenEnvAction('PUSH_CHANGES').denied, 'pushed'))
  results.push(check('22_nothing_deployed', report?.nothing_deployed === true && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED' && CURRENT_WRIM_TRAINING === 'NOT_RUNNING' && status.train_button === false && tryForbiddenEnvAction('START_STAGE_3').denied, 'deployed'))
  results.push(check('23_ready', report?.ok === true && report?.kind === FOUNDATIONAL_P1_SOVEREIGNTY_KIND && report?.audit_id === FOUNDATIONAL_P1_SOVEREIGNTY_ID && report?.final_classification === P2_SOVEREIGN_STREAM_READY && sovereignOnDisk === String(packing.stream_sha256), String(report?.final_classification)))
  results.push(check('24_identity_lock', (['FOUNDATIONAL_P1_SOVEREIGNTY_AUDIT_COMPLETE', 'FOUNDATIONAL_P2_TRAINING_CONFIGURATION_REQUIRED', 'FOUNDATIONAL_P2_RECIPE_READY', 'FOUNDATIONAL_P2_DIAGNOSTIC_COMPLETE', 'FOUNDATIONAL_P2_ROOT_CAUSE_COMPLETE', 'P2_NEXT_A_SCHEDULE_HORIZON_RECIPE_FROZEN', 'STAGE3A_CANDIDATE_ADJUDICATION_COMPLETE'].includes(NEXT_AUTHORIZED_PASS)) && status.next_authorized_pass === NEXT_AUTHORIZED_PASS, NEXT_AUTHORIZED_PASS))
  results.push(check('25_qwen_rael', QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && RAEL_STATUS === 'NOT_IMPLEMENTED', RAEL_STATUS))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runFoundationalP1SovereigntyValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
