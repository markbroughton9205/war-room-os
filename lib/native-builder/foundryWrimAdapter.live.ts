/**
 * Live Foundry WRIM adapter proof.
 * Invokes STEP_400 through dispatchReasoningWorker with pin wrim/STEP_400.
 * Does not train. Does not activate a runtime. Does not require useful reasoning.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { configuredFoundryModels } from './foundryModelProviders'
import {
  getCapabilityAwareRoutingMode,
  QWEN_REMOVED,
  recommendFoundryWorker,
  STORED_DEFAULT_POLICY,
  type FoundryWorkerRoutingNeed,
} from './foundryWorkerRouting'
import { startUnifiedStandaloneMission, type UnifiedLoopHost } from './foundryFrkStandaloneUnification'
import type { FoundryModelContext } from './foundryModelTypes'
import { buildWorkerRequest, dispatchReasoningWorker } from './reasoning-kernel/worker'
import {
  applyWrimTransportToSession,
  probeWrimAdapterHealth,
  sha256File,
  sovereignOnlyEnabled,
  WRIM_AUTOMATIC_ROUTING_ENABLED,
  WRIM_CHECKPOINT_PATH,
  WRIM_EXPECTED_CHECKPOINT_HASH,
  WRIM_EXPECTED_TOKENIZER_HASH,
  WRIM_INFERENCE_NETWORK_REQUIRED,
  WRIM_MODEL,
  WRIM_PROVIDER,
  WRIM_TOKENIZER_PATH,
  WRIM_TOOL_ACTION_COUNT,
  wrimCorpusHashes,
} from './reasoning-kernel/wrim-worker'
import { runFoundryWrimAdapterFixtures } from './foundryWrimAdapter.validation'
import { runEnabledRoutingFixtures } from './foundryCapabilityAwareRoutingEnabled.validation'
import { ACCEPTED_WORKER_CAPABILITY_EVIDENCE } from './foundryWorkerRoutingEvidence'

const PROMPT = '2 + 2 ='

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function context(missionId: string): FoundryModelContext {
  return {
    missionId,
    missionKind: 'fixture',
    userRequest: PROMPT,
    goal: 'Tiny WRIM pin smoke. Do not invent structured reasoning.',
    successCriteria: ['Invoke STEP_400 through Foundry. Record the actual continuation.'],
    constraints: ['Do not commit, push, deploy, train, or fall back to another provider.'],
    permissions: {
      filesystem: false, terminal: false, browser: false, computerUse: false,
      tests: false, lint: false, typecheck: false, build: false, package: false,
      installProduction: false, activateInstall: false, installedRuntimeControl: false,
      process: false, commit: false, push: false, liveDeploy: false, internetResearch: false,
    },
    phase: 'PLANNING',
    plan: [],
    hypotheses: [],
    changedFiles: [],
    importantFindings: [],
    relevantExcerpts: [],
    visualEvidence: [],
    recentToolResults: [],
    recentErrors: [],
    unresolvedQuestions: [],
    completionGate: { complete: false, missing: ['wrim adapter'], detail: 'mission 18 pin' },
    tools: [],
  }
}

function routingNeed(patch: Partial<FoundryWorkerRoutingNeed> = {}): FoundryWorkerRoutingNeed {
  const local = ACCEPTED_WORKER_CAPABILITY_EVIDENCE.find(item => item.historicalReliability === 'RELIABLE')!
  const remote = ACCEPTED_WORKER_CAPABILITY_EVIDENCE.find(item => !item.local && item.rootCauseStatus === 'SUPPORTED')!
  return {
    missionId: patch.missionId ?? 'm18-regress',
    taskFamily: patch.taskFamily ?? 'FEATURE_EXTENSION',
    capabilityFamilies: patch.capabilityFamilies ?? ['PLAN_TO_CODE_FIDELITY'],
    difficultyClass: patch.difficultyClass ?? 'localized',
    reasoningDepth: patch.reasoningDepth ?? 'R0',
    ambiguity: patch.ambiguity ?? 'low',
    risk: patch.risk ?? 'low',
    privacyRequirement: patch.privacyRequirement ?? 'any',
    localOnlyRequirement: patch.localOnlyRequirement ?? false,
    remotePermitted: patch.remotePermitted ?? true,
    commanderPolicy: patch.commanderPolicy ?? 'LOCAL',
    pin: patch.pin ?? null,
    candidates: patch.candidates ?? [
      { provider: local.provider, model: local.model, local: true, callable: true, listedOnly: false },
      { provider: remote.provider, model: remote.model, local: false, callable: true, listedOnly: false },
    ],
    callBudgetRemaining: 4,
    callBudgetCeiling: 6,
    wallTimeBudgetMs: 120000,
    missionContractHash: 'x',
    acceptanceContractHash: 'y',
    toolAuthority: 'tool-broker',
    deployAuthority: false,
    now: new Date().toISOString(),
    ...patch,
  }
}

async function main() {
  const results: CaseResult[] = []
  const before = {
    checkpoint: sha256File(WRIM_CHECKPOINT_PATH),
    tokenizer: sha256File(WRIM_TOKENIZER_PATH),
    corpus: wrimCorpusHashes(),
  }
  results.push(...runFoundryWrimAdapterFixtures())
  results.push(check('CHECKPOINT_HASH_BEFORE', before.checkpoint === WRIM_EXPECTED_CHECKPOINT_HASH, before.checkpoint ?? 'missing'))
  results.push(check('TOKENIZER_HASH_BEFORE', before.tokenizer === WRIM_EXPECTED_TOKENIZER_HASH, before.tokenizer ?? 'missing'))

  const health = await probeWrimAdapterHealth()
  results.push(check('HEALTH_GATE_LIVE', health.ok === true, health.error?.message ?? health.device))

  const configured = await configuredFoundryModels()
  results.push(check('NOT_IN_UNPINNED_CATALOG', !configured.some(item => item.provider === 'wrim'), `wrimCount=${configured.filter(item => item.provider === 'wrim').length}`))

  const dispatched = await dispatchReasoningWorker({
    request: buildWorkerRequest({
      requestId: 'm18-wrim-pin',
      missionId: 'm18-wrim-pin',
      task: 'understand',
      problem: PROMPT,
      constraints: ['Do not fall back to another provider.'],
      evidenceSummaries: [],
    }),
    context: context('m18-wrim-pin'),
    pin: { provider: WRIM_PROVIDER, model: WRIM_MODEL },
  })
  const diagnostics = dispatched.ok ? dispatched.workerDiagnostics : dispatched.workerDiagnostics
  results.push(check('PINNED_WRIM_PROVIDER_CALL', dispatched.ok && dispatched.provider === WRIM_PROVIDER && dispatched.model === WRIM_MODEL, dispatched.ok ? `${dispatched.provider}/${dispatched.model}` : dispatched.error))
  results.push(check('NO_FALLBACK_LIVE', dispatched.ok ? dispatched.fallbackUsed === false && dispatched.provider === 'wrim' : !/qwen|composer/i.test(dispatched.error), dispatched.ok ? dispatched.provider : dispatched.error))
  results.push(check('ATTRIBUTION', Boolean(diagnostics?.checkpointHash === WRIM_EXPECTED_CHECKPOINT_HASH && diagnostics?.tokenizerHash === WRIM_EXPECTED_TOKENIZER_HASH && diagnostics?.pythonBridge && diagnostics?.device), JSON.stringify({
    checkpointId: diagnostics?.checkpointId,
    checkpointHash: diagnostics?.checkpointHash,
    tokenizerId: diagnostics?.tokenizerId,
    device: diagnostics?.device,
    pythonBridge: diagnostics?.pythonBridge,
  })))
  results.push(check('REAL_TOKEN_PROOF', Boolean(diagnostics?.generatedTokenIds && diagnostics.generatedTokenIds.length > 0 && diagnostics.mock === false), `count=${diagnostics?.generatedTokenCount ?? 0}`))
  results.push(check('TRANSPORT_SUCCESS', diagnostics?.transportSuccess === true, `collapsed=${diagnostics?.collapsed}`))
  results.push(check('REASONING_NOT_FABRICATED', dispatched.ok && dispatched.hypotheses.length === 0 && dispatched.declaredDone === false, `hypotheses=${dispatched.ok ? dispatched.hypotheses.length : 'n/a'}`))
  results.push(check('INVALID_OUTPUT_REPORTED', diagnostics?.reasoningUsable === false && (diagnostics?.capabilityStatus === 'INVALID_OUTPUT' || diagnostics?.capabilityStatus === 'INSUFFICIENT_CAPABILITY' || diagnostics?.collapsed === true), `${diagnostics?.capabilityStatus}`))

  const workspace = mkdtempSync(path.join(tmpdir(), 'wr-m18-wrim-'))
  const prevC = process.env.FOUNDRY_CONTRACTS_ROOT
  const prevR = process.env.FRK_REASONING_ROOT
  process.env.FOUNDRY_CONTRACTS_ROOT = path.join(workspace, 'contracts')
  process.env.FRK_REASONING_ROOT = path.join(workspace, 'frk')
  mkdirSync(process.env.FOUNDRY_CONTRACTS_ROOT, { recursive: true })
  mkdirSync(process.env.FRK_REASONING_ROOT, { recursive: true })
  let frk: Record<string, unknown> = {}
  try {
    const host: UnifiedLoopHost = {
      missionId: `m18-wrim-frk-${Date.now()}`,
      goal: 'Pinned WRIM adapter transport. No file mutation.',
      userRequest: PROMPT,
      createdAt: new Date().toISOString(),
      observations: [],
    }
    const loop = await startUnifiedStandaloneMission({
      mission: host,
      workspaceRoot: workspace,
      writeSet: [],
      goal: host.goal,
      acceptance: ['wrim pinned, no fallback'],
      routing: {
        remotePermitted: false,
        pin: { provider: WRIM_PROVIDER, model: WRIM_MODEL },
        forceDepth: 'R0',
        forceAmbiguity: 'low',
        taskFamily: 'FEATURE_EXTENSION',
      },
    })
    const envelope = {
      requestId: 'm18-frk',
      ok: dispatched.ok,
      provider: WRIM_PROVIDER,
      model: WRIM_MODEL,
      checkpointId: diagnostics?.checkpointId ?? 'WRIM1-CPT-000001/step-400',
      checkpointHash: diagnostics?.checkpointHash ?? '',
      tokenizerId: diagnostics?.tokenizerId ?? 'WR-TOKENIZER-0',
      tokenizerHash: diagnostics?.tokenizerHash ?? '',
      device: diagnostics?.device ?? 'unknown',
      rawText: dispatched.ok ? dispatched.rawText : '',
      generatedTokenIds: diagnostics?.generatedTokenIds ?? [],
      generatedTokenCount: diagnostics?.generatedTokenCount ?? 0,
      finishReason: diagnostics?.finishReason ?? 'unknown',
      collapsed: diagnostics?.collapsed === true,
      latencyMs: 0,
      transportSuccess: diagnostics?.transportSuccess === true,
      reasoningUsable: diagnostics?.reasoningUsable === true,
      capabilityStatus: (diagnostics?.capabilityStatus ?? 'INVALID_OUTPUT') as 'INVALID_OUTPUT',
      pythonBridge: diagnostics?.pythonBridge ?? 'wrim_foundry_infer.py',
      runtime: diagnostics?.runtime ?? 'wrim-pytorch-linux',
      networkRequired: false as const,
      mock: false as const,
    }
    const recorded = applyWrimTransportToSession(loop.session, envelope)
    frk = {
      sessionId: loop.session.sessionId,
      strategy: loop.session.selectedStrategy,
      depth: loop.session.selectedDepth,
      recommended: `${loop.routingDecision?.selectedProvider}/${loop.routingDecision?.selectedModel}`,
      actual: `${loop.actualWorker.provider}/${loop.actualWorker.model}`,
      actualSource: loop.actualWorker.source,
      outcome: loop.routingDecision?.outcome,
      reason: loop.routingDecision?.reason,
      fallback: loop.routingDecision?.fallbackExplicit === true,
      sessionStatus: loop.session.status,
      workerStatus: loop.session.workerStatus,
      classification: recorded.classification,
      sovereignPolicy: loop.session.sovereignPolicy,
    }
    results.push(check('FRK_ATTACH', Boolean(loop.session.sessionId), String(loop.session.sessionId)))
    results.push(check('FRK_PIN_RESOLVES_WRIM', loop.routingDecision?.outcome === 'SELECTED' && loop.actualWorker.provider === 'wrim' && loop.actualWorker.model === 'STEP_400', `${loop.routingDecision?.outcome} ${loop.actualWorker.provider}/${loop.actualWorker.model}`))
    results.push(check('FRK_NOT_BLOCKED_PROVIDER', loop.routingDecision?.outcome !== 'BLOCKED_PROVIDER' && loop.session.status !== 'BLOCKED_PROVIDER' && recorded.classification !== 'BLOCKED_PROVIDER', `${loop.session.status}/${recorded.classification}`))
    results.push(check('FRK_INVALID_OUTPUT', recorded.classification === 'INVALID_OUTPUT' || recorded.classification === 'INSUFFICIENT_CAPABILITY', recorded.classification))
    results.push(check('FRK_NO_FALLBACK', loop.routingDecision?.fallbackExplicit !== true, String(loop.routingDecision?.fallbackExplicit)))
  } finally {
    if (prevC === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
    else process.env.FOUNDRY_CONTRACTS_ROOT = prevC
    if (prevR === undefined) delete process.env.FRK_REASONING_ROOT
    else process.env.FRK_REASONING_ROOT = prevR
  }

  const r0 = recommendFoundryWorker(routingNeed({ reasoningDepth: 'R0', ambiguity: 'low', capabilityFamilies: ['PLAN_TO_CODE_FIDELITY'] }))
  const r3 = recommendFoundryWorker(routingNeed({
    reasoningDepth: 'R3',
    ambiguity: 'high',
    capabilityFamilies: ['AMBIGUITY_RESOLUTION', 'ROOT_CAUSE_DIAGNOSIS'],
  }))
  results.push(check('ROUTING_MODE_ENABLED', getCapabilityAwareRoutingMode() === 'ENABLED', getCapabilityAwareRoutingMode()))
  results.push(check('STORED_POLICY_LOCAL', STORED_DEFAULT_POLICY === 'LOCAL', STORED_DEFAULT_POLICY))
  results.push(check('QWEN_ROUTINE', r0.selectedProvider === 'ollama' && (r0.selectedModel ?? '').includes('qwen'), `${r0.selectedProvider}/${r0.selectedModel}`))
  results.push(check('COMPOSER_HARD', r3.selectedProvider === 'cursor-agent' && (r3.selectedModel ?? '').includes('composer'), `${r3.selectedProvider}/${r3.selectedModel}`))
  results.push(check('WRIM_NOT_AUTO_SELECTED', r0.selectedProvider !== 'wrim' && r3.selectedProvider !== 'wrim' && WRIM_AUTOMATIC_ROUTING_ENABLED === false, `${r0.selectedProvider}/${r3.selectedProvider}`))
  results.push(check('QWEN_REMOVED_NO', QWEN_REMOVED === false, String(QWEN_REMOVED)))
  results.push(check('SOVEREIGN_ONLY_DISABLED', sovereignOnlyEnabled({ sovereignPolicy: 'DISABLED' } as never) === false, 'DISABLED'))
  results.push(check('TOOL_ACTION_ZERO', WRIM_TOOL_ACTION_COUNT === 0, '0'))
  results.push(check('NETWORK_NOT_REQUIRED', WRIM_INFERENCE_NETWORK_REQUIRED === false, 'NO'))

  const enabled = await runEnabledRoutingFixtures()
  const enabledFailed = enabled.filter(item => !item.pass)
  results.push(check('ROUTING_REGRESSION', enabledFailed.length === 0, `${enabled.filter(item => item.pass).length}/${enabled.length}`))

  const after = {
    checkpoint: sha256File(WRIM_CHECKPOINT_PATH),
    tokenizer: sha256File(WRIM_TOKENIZER_PATH),
    corpus: wrimCorpusHashes(),
  }
  results.push(check('WEIGHT_MUTATION_ZERO', before.checkpoint === after.checkpoint && after.checkpoint === WRIM_EXPECTED_CHECKPOINT_HASH, after.checkpoint ?? 'missing'))
  results.push(check('TOKENIZER_MUTATION_ZERO', before.tokenizer === after.tokenizer && after.tokenizer === WRIM_EXPECTED_TOKENIZER_HASH, after.tokenizer ?? 'missing'))
  results.push(check('CORPUS_MUTATION_ZERO', JSON.stringify(before.corpus) === JSON.stringify(after.corpus), JSON.stringify(after.corpus)))

  const failed = results.filter(item => !item.pass)
  const payload = {
    ok: failed.length === 0,
    passed: results.filter(item => item.pass).length,
    total: results.length,
    failed,
    prompt: PROMPT,
    dispatchedOk: dispatched.ok,
    rawText: dispatched.ok ? dispatched.rawText : null,
    summary: dispatched.ok ? dispatched.summary : dispatched.error,
    diagnostics,
    frk,
    hashes: { before, after },
    routingMode: getCapabilityAwareRoutingMode(),
    storedPolicy: STORED_DEFAULT_POLICY,
  }
  const out = path.join(resolveRepoRoot(), 'tmp/foundry-wrim-adapter/live.json')
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(payload, null, 2) + '\n')
  console.log(JSON.stringify(payload, null, 2))
  if (failed.length) process.exit(1)
}

const isDirect = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isDirect) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
