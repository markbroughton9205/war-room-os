/**
 * Deterministic Foundry WRIM adapter wiring checks.
 * Does not invoke STEP_400. Does not train. Isolated from live GPU.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { COMPOSER_GLOBAL_DEFAULT, QWEN_REMOVED, STORED_DEFAULT_POLICY } from './foundryWorkerRouting'
import { ACCEPTED_WORKER_CAPABILITY_EVIDENCE } from './foundryWorkerRoutingEvidence'
import { defaultRoutingCandidates } from './foundryFrkStandaloneUnification'
import {
  HARD_MAX_NEW_TOKENS,
  HEALTH_TIMEOUT_MS,
  INFERENCE_TIMEOUT_MS,
  MAX_NEW_TOKENS,
  MAX_STDERR_BYTES,
  MAX_STDOUT_BYTES,
  SECOND_WRIM_ROUTER_COUNT,
  WRIM_AUTOMATIC_ROUTING_ENABLED,
  WRIM_CHECKPOINT_ID,
  WRIM_CHECKPOINT_PATH,
  WRIM_EXPECTED_CHECKPOINT_HASH,
  WRIM_EXPECTED_TOKENIZER_HASH,
  WRIM_INFERENCE_NETWORK_REQUIRED,
  WRIM_MOCK_RESPONSE_COUNT,
  WRIM_MODEL,
  WRIM_PROVIDER,
  WRIM_PYTHON,
  WRIM_TOKENIZER_ID,
  WRIM_TOKENIZER_PATH,
  WRIM_TOOL_ACTION_COUNT,
  createWrimReasoningWorker,
  pinOnlyWorkerCandidate,
  sovereignOnlyEnabled,
} from './reasoning-kernel/wrim-worker'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

export function runFoundryWrimAdapterFixtures(): CaseResult[] {
  const results: CaseResult[] = []
  const worker = source('lib/native-builder/reasoning-kernel/wrim-worker.ts')
  const infer = path.join(resolveRepoRoot(), 'lib/native-builder/reasoning-kernel/wrim_foundry_infer.py')
  const router = source('lib/native-builder/foundryModelRouter.ts')
  const providers = source('lib/native-builder/foundryModelProviders.ts')
  const dispatch = source('lib/native-builder/reasoning-kernel/worker.ts')
  const unification = source('lib/native-builder/foundryFrkStandaloneUnification.ts')
  const python = existsSync(infer) ? readFileSync(infer, 'utf8') : ''

  results.push(check('ADAPTER_EXISTS', /class WrimStep400Model/.test(worker) && existsSync(infer), 'wrim-worker + python bridge'))
  results.push(check('PYTHON_REUSES_EXISTING_GENERATE', /from stage2_eval import greedy_generate/.test(python) && /from wrim_plateau_review_probe import load_model/.test(python), 'existing helpers'))
  results.push(check('NO_TRAINING_IN_BRIDGE', !/AdamW|loss\.backward|create_optimizer|torch\.optim/.test(python), 'inference only'))
  results.push(check('PROVIDER_REGISTRATION', /createWrimStep400ModelIfHealthy/.test(router) && /pinProvider === 'wrim'/.test(router), 'pin-injected after health'))
  results.push(check('NOT_DEFAULT_CATALOG', !/createWrimStep400ModelIfHealthy/.test(providers), 'configuredFoundryModels does not auto-add WRIM'))
  results.push(check('HEALTH_GATE', /probeWrimAdapterHealth/.test(worker) && /createWrimStep400ModelIfHealthy/.test(worker), 'health before callable'))
  results.push(check('CHECKPOINT_IDENTITY', WRIM_PROVIDER === 'wrim' && WRIM_MODEL === 'STEP_400' && WRIM_CHECKPOINT_ID === 'WRIM1-CPT-000001/step-400' && WRIM_EXPECTED_CHECKPOINT_HASH === 'f82f4364b16842ca3d43427251299f1ad38d5104f24013251f2ebc6af6607af8', WRIM_CHECKPOINT_PATH))
  results.push(check('TOKENIZER_IDENTITY', WRIM_TOKENIZER_ID === 'WR-TOKENIZER-0' && WRIM_EXPECTED_TOKENIZER_HASH === '47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7', WRIM_TOKENIZER_PATH))
  results.push(check('TIMEOUTS', HEALTH_TIMEOUT_MS <= 45_000 && INFERENCE_TIMEOUT_MS <= 120_000 && MAX_NEW_TOKENS <= 24 && HARD_MAX_NEW_TOKENS <= 64 && MAX_STDOUT_BYTES <= 256_000 && MAX_STDERR_BYTES <= 64_000, `${HEALTH_TIMEOUT_MS}/${INFERENCE_TIMEOUT_MS}/${MAX_NEW_TOKENS}`))
  results.push(check('STDIN_NOT_ARGV_SECRETS', /stdin\.write\(payload\)/.test(worker) && /SECRET_ENV/.test(worker), 'request on stdin, secrets stripped'))
  results.push(check('NO_FALLBACK', /fallbackUsed: false/.test(dispatch) && /provider !== 'wrim'/.test(router), 'pinned WRIM cannot switch'))
  results.push(check('NO_AUTO_ROUTING', WRIM_AUTOMATIC_ROUTING_ENABLED === false && !defaultRoutingCandidates().some(item => item.provider === 'wrim') && !ACCEPTED_WORKER_CAPABILITY_EVIDENCE.some(item => item.provider === 'wrim'), 'pin-only'))
  results.push(check('NO_FABRICATED_REASONING', /decision: 'BLOCKED'/.test(worker) && !/planChanges: \{/.test(worker) && !/hypotheses: \[/.test(worker.split('blockedDecision')[1] ?? ''), 'raw envelope, no invented plan'))
  results.push(check('ERROR_TAXONOMY', ['BLOCKED_PROVIDER', 'RUNTIME_FAILURE', 'TOKENIZER_FAILURE', 'MODEL_LOAD_FAILURE', 'INVALID_OUTPUT', 'INSUFFICIENT_CAPABILITY'].every(code => worker.includes(code) && (code === 'BLOCKED_PROVIDER' || python.includes(code) || worker.includes(code))), 'distinct codes'))
  results.push(check('ONE_ROUTER', SECOND_WRIM_ROUTER_COUNT === 0 && !/class WrimModelRouter/.test(worker) && /FoundryModelRouter/.test(dispatch), 'SECOND_WRIM_ROUTER_COUNT=0'))
  results.push(check('NO_NETWORK_REQUIREMENT', WRIM_INFERENCE_NETWORK_REQUIRED === false && /networkRequired": False/.test(python), 'offline inference'))
  results.push(check('NO_MOCK', WRIM_MOCK_RESPONSE_COUNT === 0 && /mock: false/.test(worker), 'live bridge only'))
  results.push(check('NO_TOOL_ACTION', WRIM_TOOL_ACTION_COUNT === 0 && /toolSupport: false/.test(worker), '0'))
  results.push(check('SOVEREIGN_ONLY_DISABLED', sovereignOnlyEnabled({ sovereignPolicy: 'DISABLED' } as never) === false, 'DISABLED'))
  results.push(check('QWEN_COMPOSER_INTACT', QWEN_REMOVED === false && COMPOSER_GLOBAL_DEFAULT === false && STORED_DEFAULT_POLICY === 'LOCAL', 'routine routing unchanged'))
  results.push(check('HANDSHAKE_NULL_UNCHANGED', createWrimReasoningWorker(null).kind === 'none', 'FRK-07 null port stays none'))
  results.push(check('PIN_CANDIDATE_HELPER', pinOnlyWorkerCandidate({ provider: 'wrim', model: 'STEP_400' })?.provider === 'wrim' && pinOnlyWorkerCandidate({ provider: 'ollama', model: 'qwen2.5-coder:14b' }) === null, 'pin-only candidate'))
  results.push(check('UNIFICATION_PIN_MERGE', /pinOnlyWorkerCandidate/.test(unification) && /routingCandidates/.test(unification), 'FRK pin can resolve WRIM'))
  results.push(check('PYTHON_RUNTIME_PATH', WRIM_PYTHON.includes('wrim-pytorch-linux'), WRIM_PYTHON))
  results.push(check('NO_RTX_HARDCODE', !/5060/.test(worker) && !/5060/.test(python), 'device auto, no GPU SKU'))
  return results
}

async function main() {
  const results = runFoundryWrimAdapterFixtures()
  const failed = results.filter(item => !item.pass)
  console.log(JSON.stringify({ ok: failed.length === 0, passed: results.filter(item => item.pass).length, total: results.length, failed }, null, 2))
  if (failed.length) process.exit(1)
}

const isDirect = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isDirect) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
