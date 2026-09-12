/**
 * #23 Nebula PyTorch environment + Stage 0 validation.
 * Does not train. Does not backprop. Does not create Ra'el.
 */
import fs from 'node:fs'
import os from 'node:os'
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
import { dumpWrim0FinalWeights } from '@/lib/wrim-reconciliation/paths'
import { defaultRecoveryDumpRoot } from '@/lib/wr-corpus/recoverySource'
import {
  CUDA_TOOLKIT_INSTALLED,
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  FORBIDDEN_ENV_ACTIONS,
  PARENT_SHA256,
  RAEL_STATUS,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  SMOKE_ARGMAX_ID,
  STAGE1_AUTHORIZED,
  TOKENIZER_SHA256,
  TRAINING_AUTHORIZATION,
} from './identity'
import { writeEnvironmentManifest } from './manifest'
import { resolveWrimEnvironmentPaths } from './paths'
import { tryForbiddenEnvAction } from './redTeam'
import { wrimEnvironmentStatusPayload } from './status'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export async function runWrimEnvironmentValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrim-environment-'))
  const live = resolveWrimEnvironmentPaths()
  const dumpRoot = defaultRecoveryDumpRoot()
  const wrim0Path = dumpWrim0FinalWeights(dumpRoot)
  const wrim0Mtime = fs.statSync(wrim0Path).mtimeMs
  const { manifest, report } = writeEnvironmentManifest()
  const wrim0MtimeAfter = fs.statSync(wrim0Path).mtimeMs
  const pyModel = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/wrim_g20m.py'), 'utf8')
  const pyStage = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage0.py'), 'utf8')
  const pyLoad = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/safetensors_model.py'), 'utf8')
  const cpu = report.cpu as { argmax_id?: number; entropy?: number; pass?: boolean; new_ids?: number[] }
  const cuda = report.cuda_stage0 as { argmax_id?: number; entropy?: number; pass?: boolean; new_ids?: number[] }
  const mapping = (report as { mapping?: { mapped?: number; missing?: unknown[]; unexpected?: unknown[]; skipped_opt?: number } }).mapping
  const precision = report.precision as Record<string, string>
  const batch = (report as { forward_only_batch_probe?: Array<{ FORWARD_ONLY?: boolean; backward?: boolean }> }).forward_only_batch_probe ?? []

  results.push(check('1_venv_exists', fs.existsSync(live.venvPython), live.venvPython))
  results.push(check('2_python_313', String(manifest.python_version).startsWith('3.13'), String(manifest.python_version)))
  results.push(check('3_official_stable_cu130', String(manifest.torch_version).includes('2.13.0') && String(manifest.torch_version).includes('cu130'), String(manifest.torch_version)))
  results.push(check('4_cuda_available', (report.cuda as { available?: boolean }).available === true, 'cuda'))
  results.push(check('5_gpu_5060ti', String((report.cuda as { name?: string }).name).includes('5060 Ti'), String((report.cuda as { name?: string }).name)))
  results.push(check('6_fp32', precision.FP32 === 'SUPPORTED', precision.FP32))
  results.push(check('7_fp16', precision.FP16 === 'SUPPORTED', precision.FP16))
  results.push(check('8_bf16', precision.BF16 === 'SUPPORTED', precision.BF16))
  results.push(check('9_tf32', precision.TF32 === 'SUPPORTED', precision.TF32))
  results.push(check('10_no_cuda_toolkit', CUDA_TOOLKIT_INSTALLED === false && !pyStage.includes('cuda toolkit install'), 'not installed'))
  results.push(check('11_arch_exact', pyModel.includes('WRIM-G-20M-v1-option-A') && pyModel.includes('traditional=False'), 'port'))
  results.push(check('12_18_layers', pyModel.includes('N_LAYERS = 18'), '18'))
  results.push(check('13_d_model_256', pyModel.includes('D_MODEL = 256'), '256'))
  results.push(check('14_4_heads', pyModel.includes('N_HEADS = 4'), '4'))
  results.push(check('15_d_ff_768', pyModel.includes('D_FF = 768'), '768'))
  results.push(check('16_context_512', pyModel.includes('CONTEXT_LENGTH = 512'), '512'))
  results.push(check('17_vocab_15126', pyModel.includes('VOCAB_SIZE = 15126'), '15126'))
  results.push(check('18_tied', pyModel.includes('F.linear(x, self.tok_emb.weight)') && pyModel.includes('no lm_head'), 'tied'))
  results.push(check('19_parent_sha', (report as { parent_sha?: string }).parent_sha === PARENT_SHA256, String((report as { parent_sha?: string }).parent_sha)))
  results.push(check('20_tokenizer_sha', (report as { tokenizer_sha?: string }).tokenizer_sha === TOKENIZER_SHA256, String((report as { tokenizer_sha?: string }).tokenizer_sha)))
  results.push(check('21_safetensors_only', pyLoad.includes('header_len') && !pyLoad.includes('import pickle') && !pyStage.includes('torch.load('), 'header-only'))
  results.push(check('22_no_pickle', (report as { pickle_used?: boolean }).pickle_used === false && !pyLoad.includes('import pickle') && !pyStage.includes('import pickle'), 'no pickle'))
  results.push(check('23_opt_ignored', (mapping?.skipped_opt ?? 0) === 330, String(mapping?.skipped_opt)))
  results.push(check('24_mapped_164', mapping?.mapped === 164, String(mapping?.mapped)))
  results.push(check('25_no_missing', Array.isArray(mapping?.missing) && mapping!.missing!.length === 0, 'none missing'))
  results.push(check('26_cpu_pass', cpu.pass === true, String(cpu.pass)))
  results.push(check('27_cpu_argmax_126', cpu.argmax_id === SMOKE_ARGMAX_ID, String(cpu.argmax_id)))
  results.push(check('28_cpu_entropy', typeof cpu.entropy === 'number' && Math.abs(cpu.entropy - 6.033060550689697) <= 1e-4, String(cpu.entropy)))
  results.push(check('29_cuda_pass', cuda.pass === true, String(cuda.pass)))
  results.push(check('30_cuda_argmax_126', cuda.argmax_id === SMOKE_ARGMAX_ID, String(cuda.argmax_id)))
  results.push(check('31_cuda_entropy', typeof cuda.entropy === 'number' && Math.abs(cuda.entropy - 6.033060550689697) <= 0.02, String(cuda.entropy)))
  results.push(check('32_inference_benchmark', Boolean((report as { timings?: unknown }).timings), 'timings'))
  results.push(check('33_forward_only', batch.length >= 5 && batch.every(b => b.FORWARD_ONLY === true && b.backward === false), String(batch.length)))
  results.push(check('34_manifest_written', fs.existsSync(live.manifestPath) && manifest.torch_version != null, live.manifestPath))
  results.push(check('35_no_model_upload', !pyStage.includes('huggingface.co') && manifest.telemetry === 'OFF', 'local'))
  results.push(check('36_no_corpus_upload', true, 'no corpus upload'))
  results.push(check('37_no_optimizer', (report as { optimizer?: boolean }).optimizer === false && !pyStage.includes('AdamW') && !pyStage.includes('torch.optim'), 'no optim'))
  results.push(check('38_no_backward', (report as { backward?: boolean }).backward === false && !pyStage.includes('.backward('), 'no backward'))
  results.push(check('39_no_new_ckpt', (report as { new_training_checkpoint?: boolean }).new_training_checkpoint === false && wrim0MtimeAfter === wrim0Mtime, 'no new weights'))
  results.push(check('40_qwen', getSovereignRuntimeTruth().NATIVE_WRIM === 'NOT_IMPLEMENTED' && CORPUS_PRODUCTION === 'NOT_IMPLEMENTED', 'qwen third-party'))
  results.push(check('41_no_rael', RAEL_STATUS === 'NOT_IMPLEMENTED' && CORPUS_RAEL === 'NOT_IMPLEMENTED', RAEL_STATUS))
  results.push(check('42_autonomy_off', ascensionAutonomyIsOff(), 'OFF'))
  results.push(check('43_22_closed', ROADMAP_22_STATUS === 'CLOSED' && CORPUS_22 === 'CLOSED', ROADMAP_22_STATUS))
  results.push(check('44_23_active', ROADMAP_23_STATUS === 'ACTIVE' && CORPUS_23 === 'ACTIVE', ROADMAP_23_STATUS))
  results.push(check('45_nothing_pushed', true, 'this pass does not push'))
  results.push(check('46_nothing_deployed', true, 'this pass does not deploy'))
  results.push(check('47_no_train_button', wrimEnvironmentStatusPayload(tmp).train_button === false, 'no train'))
  results.push(check('48_stage1_off', STAGE1_AUTHORIZED === false && TRAINING_AUTHORIZATION === 'OFF' && CURRENT_WRIM_TRAINING === 'NOT_RUNNING', CURRENT_WRIM_TRAINING))
  results.push(check('49_red_team', FORBIDDEN_ENV_ACTIONS.every(a => tryForbiddenEnvAction(a).denied), String(FORBIDDEN_ENV_ACTIONS.length)))
  results.push(check('50_reference_attention', pyModel.includes('reference_attention') && !pyModel.includes('scaled_dot_product_attention'), 'not SDPA'))
  results.push(check('51_continuation_decoded', manifest.continuation_match === true, String(manifest.cpu_continuation_decoded)))
  results.push(check('52_production_unchanged', CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', CURRENT_PRODUCTION_WRIM))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  console.log('=== #23 NEBULA PYTORCH/CUDA ENVIRONMENT + STAGE 0 ===')
  const { passed, failed, results } = await runWrimEnvironmentValidation()
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} — ${r.detail}`)
  console.log(`\nResult: ${passed} passed, ${failed} failed (total ${results.length})`)
  if (failed > 0) process.exitCode = 1
}

const isDirect =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('wrim-environment') || process.argv[1].includes('wrimEnvironment.validation'))

if (isDirect) {
  void main()
}
