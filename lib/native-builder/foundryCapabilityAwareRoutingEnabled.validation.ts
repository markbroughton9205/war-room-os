/**
 * Deterministic ENABLED capability-aware routing fixtures A–L.
 * Isolated contracts root. Does not call a live model.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { ACCEPTED_WORKER_CAPABILITY_EVIDENCE } from './foundryWorkerRoutingEvidence'
import {
  BUDGET_RESET_ON_WORKER_SWITCH_COUNT,
  COMPOSER_GLOBAL_DEFAULT,
  disableCapabilityAwareRouting,
  MAX_WORKER_SWITCHES_PER_MISSION,
  MODEL_ROUTING_ENABLE_COUNT,
  PROVIDER_SPECIFIC_ROUTING_BRANCH_COUNT,
  QWEN_REMOVED,
  ROUTING_FAIL_SAFE_MODE,
  STORED_DEFAULT_POLICY,
  UNBOUNDED_WORKER_SWITCH_COUNT,
  WORKER_SWITCH_AUTHORITY_EXPANSION_COUNT,
  enableCapabilityAwareRouting,
  getCapabilityAwareRoutingMode,
  persistRoutingDecision,
  recommendFoundryWorker,
  reconsiderFoundryRouting,
  resumeRoutingDecision,
  type FoundryRoutingCandidate,
  type FoundryWorkerRoutingNeed,
} from './foundryWorkerRouting'
import {
  reconsiderWorkerRouting,
  recordWorkerRouting,
  resumeUnifiedStandaloneMission,
  startUnifiedStandaloneMission,
  type UnifiedLoopHost,
} from './foundryFrkStandaloneUnification'

const evidence = ACCEPTED_WORKER_CAPABILITY_EVIDENCE
const local = evidence.find(item => item.historicalReliability === 'RELIABLE')!
const remote = evidence.find(item => !item.local && item.capabilityFamily === 'AMBIGUITY_RESOLUTION' && item.rootCauseStatus === 'SUPPORTED')!

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function candidates(extra: FoundryRoutingCandidate[] = []): FoundryRoutingCandidate[] {
  return [
    { provider: local.provider, model: local.model, local: true, callable: true, listedOnly: false },
    { provider: remote.provider, model: remote.model, local: false, callable: true, listedOnly: false },
    ...extra,
  ]
}

function need(patch: Partial<FoundryWorkerRoutingNeed>): FoundryWorkerRoutingNeed {
  return {
    missionId: patch.missionId ?? 'enabled-fixture',
    taskFamily: patch.taskFamily ?? 'BUG_FIX',
    capabilityFamilies: patch.capabilityFamilies ?? ['PLAN_TO_CODE_FIDELITY'],
    difficultyClass: patch.difficultyClass ?? 'localized',
    reasoningDepth: patch.reasoningDepth ?? 'R1',
    ambiguity: patch.ambiguity ?? 'low',
    risk: patch.risk ?? 'low',
    privacyRequirement: patch.privacyRequirement ?? 'any',
    localOnlyRequirement: patch.localOnlyRequirement ?? false,
    remotePermitted: patch.remotePermitted ?? true,
    commanderPolicy: patch.commanderPolicy ?? 'LOCAL',
    commanderRemoteApprovalRequired: patch.commanderRemoteApprovalRequired,
    pin: patch.pin ?? null,
    candidates: patch.candidates ?? candidates(),
    callBudgetRemaining: patch.callBudgetRemaining ?? 4,
    callBudgetCeiling: patch.callBudgetCeiling ?? 6,
    wallTimeBudgetMs: 120000,
    switchCount: patch.switchCount,
    previousProvider: patch.previousProvider,
    previousModel: patch.previousModel,
    missionContractHash: 'contract-hash',
    acceptanceContractHash: 'acceptance-hash',
    toolAuthority: 'tool-broker',
    deployAuthority: false,
    now: '2026-09-23T14:00:00.000Z',
  }
}

function host(missionId: string, goal: string): UnifiedLoopHost {
  return { missionId, goal, userRequest: goal, createdAt: '2026-09-23T14:00:00.000Z', observations: [] }
}

async function withEnabled<T>(fn: (workspace: string) => Promise<T>): Promise<T> {
  const workspace = mkdtempSync(path.join(tmpdir(), 'wr-route16-'))
  const prevC = process.env.FOUNDRY_CONTRACTS_ROOT
  const prevR = process.env.FRK_REASONING_ROOT
  const prevM = process.env.FOUNDRY_CAPABILITY_AWARE_ROUTING_MODE
  process.env.FOUNDRY_CONTRACTS_ROOT = path.join(workspace, 'contracts')
  process.env.FRK_REASONING_ROOT = path.join(workspace, 'frk')
  delete process.env.FOUNDRY_CAPABILITY_AWARE_ROUTING_MODE
  mkdirSync(process.env.FOUNDRY_CONTRACTS_ROOT, { recursive: true })
  mkdirSync(process.env.FRK_REASONING_ROOT, { recursive: true })
  enableCapabilityAwareRouting({ mission: 'MISSION_16_FIXTURE' })
  try {
    return await fn(workspace)
  } finally {
    if (prevC === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
    else process.env.FOUNDRY_CONTRACTS_ROOT = prevC
    if (prevR === undefined) delete process.env.FRK_REASONING_ROOT
    else process.env.FRK_REASONING_ROOT = prevR
    if (prevM === undefined) delete process.env.FOUNDRY_CAPABILITY_AWARE_ROUTING_MODE
    else process.env.FOUNDRY_CAPABILITY_AWARE_ROUTING_MODE = prevM
    rmSync(workspace, { recursive: true, force: true })
  }
}

export async function runEnabledRoutingFixtures(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const routingSrc = readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryWorkerRouting.ts'), 'utf8')
  results.push(check('SHADOW_MODE_PRESERVED', routingSrc.includes("'SHADOW'") && routingSrc.includes("'ENABLED'"), 'both modes'))
  results.push(check('COMPOSER_GLOBAL_DEFAULT', COMPOSER_GLOBAL_DEFAULT === false, 'NO'))
  results.push(check('QWEN_REMOVED', QWEN_REMOVED === false, 'NO'))
  results.push(check('STORED_POLICY_LOCAL', STORED_DEFAULT_POLICY === 'LOCAL', STORED_DEFAULT_POLICY))
  results.push(check('PROVIDER_SPECIFIC_ROUTING_BRANCH_COUNT', PROVIDER_SPECIFIC_ROUTING_BRANCH_COUNT === 0, '0'))
  results.push(check('UNBOUNDED_WORKER_SWITCH_COUNT', UNBOUNDED_WORKER_SWITCH_COUNT === 0 && MAX_WORKER_SWITCHES_PER_MISSION === 1, String(MAX_WORKER_SWITCHES_PER_MISSION)))
  results.push(check('BUDGET_RESET_ON_WORKER_SWITCH_COUNT', BUDGET_RESET_ON_WORKER_SWITCH_COUNT === 0, '0'))
  const branches = routingSrc.match(/===\s*['"](?:qwen|composer|cursor-agent|ollama)|includes\(\s*['"](?:qwen|composer|cursor)/g) ?? []
  results.push(check('NO_PROVIDER_BRANCH', branches.length === 0, String(branches.length)))

  await withEnabled(async workspace => {
    results.push(check('MODE_ENABLED', getCapabilityAwareRoutingMode() === 'ENABLED', getCapabilityAwareRoutingMode()))
    const a = recommendFoundryWorker(need({ missionId: 'A', reasoningDepth: 'R0', ambiguity: 'low', taskFamily: 'FEATURE_EXTENSION' }))
    results.push(check('FIXTURE_A', a.outcome === 'SELECTED' && a.selectedProvider === local.provider && a.workerClass === 'LOCAL_ROUTINE', `${a.selectedProvider}/${a.selectedModel}`))
    const b = recommendFoundryWorker(need({ missionId: 'B', reasoningDepth: 'R1', ambiguity: 'low', taskFamily: 'BUG_FIX' }))
    results.push(check('FIXTURE_B', b.outcome === 'SELECTED' && b.selectedProvider === local.provider && b.workerClass === 'LOCAL_ROUTINE', `${b.selectedProvider}/${b.selectedModel}`))
    const c = recommendFoundryWorker(need({
      missionId: 'C',
      reasoningDepth: 'R3',
      ambiguity: 'high',
      capabilityFamilies: ['AMBIGUITY_RESOLUTION', 'ROOT_CAUSE_DIAGNOSIS'],
    }))
    results.push(check('FIXTURE_C', c.outcome === 'SELECTED' && c.selectedProvider === remote.provider && c.workerClass === 'STRONG_REASONING', `${c.selectedProvider}/${c.selectedModel}`))
    const d = recommendFoundryWorker(need({
      missionId: 'D',
      reasoningDepth: 'R4',
      ambiguity: 'high',
      capabilityFamilies: ['AMBIGUITY_RESOLUTION'],
      pin: { provider: local.provider, model: local.model },
    }))
    results.push(check('FIXTURE_D', d.outcome === 'SELECTED' && d.selectedProvider === local.provider && d.workerClass === 'PINNED' && d.selectedProvider !== remote.provider, d.reason))
    const e = recommendFoundryWorker(need({
      missionId: 'E',
      pin: { provider: remote.provider, model: remote.model },
      candidates: [
        { provider: local.provider, model: local.model, local: true, callable: true, listedOnly: false },
        { provider: remote.provider, model: remote.model, local: false, callable: false, listedOnly: false },
      ],
    }))
    results.push(check('FIXTURE_E', e.outcome === 'BLOCKED_PROVIDER' && e.selectedProvider === null, e.outcome))
    const f = recommendFoundryWorker(need({
      missionId: 'F',
      reasoningDepth: 'R4',
      ambiguity: 'high',
      localOnlyRequirement: true,
      remotePermitted: false,
      privacyRequirement: 'local',
      capabilityFamilies: ['AMBIGUITY_RESOLUTION', 'ROOT_CAUSE_DIAGNOSIS'],
    }))
    results.push(check('FIXTURE_F', f.selectedProvider !== remote.provider && (f.outcome === 'BLOCKED_CAPABILITY' || f.outcome === 'COMMANDER_DECISION_REQUIRED'), f.outcome))
    const gNeed = need({ missionId: 'G', reasoningDepth: 'R3', ambiguity: 'high', capabilityFamilies: ['AMBIGUITY_RESOLUTION'], callBudgetCeiling: 6, callBudgetRemaining: 3 })
    const g = reconsiderFoundryRouting({ need: gNeed, previousProvider: local.provider, previousModel: local.model, failureType: 'MODEL_CAPABILITY', succeeded: false, switchCount: 0 })
    results.push(check('FIXTURE_G', g.reconsideration.decision === 'ESCALATE' && g.decision.selectedProvider === remote.provider && g.decision.callBudgetCeiling === 6 && g.decision.missionContractHash === 'contract-hash' && g.decision.switchCount === 1, `${g.reconsideration.decision} ceiling=${g.decision.callBudgetCeiling}`))
    const h = reconsiderFoundryRouting({ need: need({ missionId: 'H', reasoningDepth: 'R1' }), previousProvider: local.provider, previousModel: local.model, failureType: null, succeeded: true })
    results.push(check('FIXTURE_H', h.reconsideration.decision === 'STAY' && h.decision.selectedProvider === local.provider, h.reconsideration.decision))
    const i = recommendFoundryWorker(need({
      missionId: 'I',
      reasoningDepth: 'R3',
      ambiguity: 'high',
      capabilityFamilies: ['PERFORMANCE_REASONING'],
    }))
    results.push(check('FIXTURE_I', i.reason.includes('PARTIAL') && i.outcome === 'COMMANDER_DECISION_REQUIRED' && i.workerClass !== 'STRONG_REASONING', i.outcome))
    const stored = recommendFoundryWorker(need({
      missionId: 'J',
      reasoningDepth: 'R3',
      ambiguity: 'high',
      capabilityFamilies: ['AMBIGUITY_RESOLUTION'],
    }))
    persistRoutingDecision(stored, path.join(workspace, 'routing'))
    const proposed = recommendFoundryWorker(need({ missionId: 'J', reasoningDepth: 'R0' }))
    const resumed = resumeRoutingDecision('J', path.join(workspace, 'routing'), proposed)
    results.push(check('FIXTURE_J', Boolean(resumed && resumed.selectedProvider === stored.selectedProvider && resumed.selectedModel === stored.selectedModel && resumed.selectedProvider === remote.provider), `${resumed?.selectedProvider}/${resumed?.selectedModel}`))
    const k = reconsiderFoundryRouting({
      need: need({ missionId: 'K', reasoningDepth: 'R3', ambiguity: 'high', capabilityFamilies: ['AMBIGUITY_RESOLUTION'] }),
      previousProvider: remote.provider,
      previousModel: remote.model,
      failureType: 'MODEL_CAPABILITY',
      succeeded: false,
      switchCount: 1,
    })
    results.push(check('FIXTURE_K', k.reconsideration.decision !== 'ESCALATE' && k.decision.switchCount === 1 && (k.decision.outcome === 'BLOCKED_CAPABILITY' || k.decision.outcome === 'COMMANDER_DECISION_REQUIRED' || k.decision.outcome === 'BLOCKED_COMMANDER'), `${k.reconsideration.decision}`))
    const l = recommendFoundryWorker(need({
      missionId: 'L',
      reasoningDepth: 'R3',
      ambiguity: 'high',
      capabilityFamilies: ['AMBIGUITY_RESOLUTION'],
      callBudgetRemaining: 0,
      callBudgetCeiling: 6,
    }))
    results.push(check('FIXTURE_L', l.outcome === 'BLOCKED_RESOURCE' && l.callBudgetCeiling === 6 && l.selectedProvider === null, `${l.outcome} ceiling=${l.callBudgetCeiling}`))

    writeFileSync(path.join(workspace, 'note.txt'), 'start\n')
    const mission = host('m16-loop', 'Routine enabled routing.')
    const loop = await startUnifiedStandaloneMission({
      mission,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Routine enabled routing.',
      acceptance: ['qwen selected'],
      routing: { remotePermitted: true, forceDepth: 'R0', forceAmbiguity: 'low', taskFamily: 'FEATURE_EXTENSION' },
    })
    results.push(check('UNIFIED_ENABLED_ROUTINE', loop.actualWorker.provider === local.provider && loop.routingDecision?.appliedToLiveRoute === true && loop.routingDecision?.routingMode === 'ENABLED', `${loop.actualWorker.provider}/${loop.actualWorker.model}`))
    const hard = host('m16-hard', 'Hard ambiguity task.')
    const hardLoop = await startUnifiedStandaloneMission({
      mission: hard,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Hard ambiguity task.',
      acceptance: ['composer selected'],
      routing: {
        remotePermitted: true,
        forceDepth: 'R3',
        forceAmbiguity: 'high',
        forceFamilies: ['AMBIGUITY_RESOLUTION', 'ROOT_CAUSE_DIAGNOSIS'],
      },
    })
    results.push(check('UNIFIED_ENABLED_HARD', hardLoop.actualWorker.provider === remote.provider && hardLoop.routingDecision?.appliedToLiveRoute === true, `${hardLoop.actualWorker.provider}/${hardLoop.actualWorker.model}`))
    const before = hardLoop.actualWorker.provider
    const afterResume = await resumeUnifiedStandaloneMission(hard, workspace, ['note.txt'])
    results.push(check('UNIFIED_RESTART', afterResume.actualWorker.provider === before && afterResume.routingDecision?.selectedProvider === remote.provider, `${afterResume.actualWorker.provider}`))
    recordWorkerRouting(loop, { remotePermitted: true, forceDepth: 'R1' })
    const second = reconsiderWorkerRouting(loop, { remotePermitted: true, forceDepth: 'R3', forceAmbiguity: 'high', forceFamilies: ['AMBIGUITY_RESOLUTION'], failureType: 'MODEL_CAPABILITY' })
    const third = reconsiderWorkerRouting(loop, { remotePermitted: true, forceDepth: 'R3', forceAmbiguity: 'high', forceFamilies: ['AMBIGUITY_RESOLUTION'], failureType: 'MODEL_CAPABILITY' })
    results.push(check('UNIFIED_NO_OSCILLATION', second.decision === 'ESCALATE' && third.decision !== 'ESCALATE' && loop.workerSwitchCount <= 1, `${second.decision}->${third.decision} n=${loop.workerSwitchCount}`))
    const contractBeforeKill = loop.routingDecision?.missionContractHash
    process.env.FOUNDRY_CAPABILITY_AWARE_ROUTING_MODE = 'ENABLED'
    writeFileSync(path.join(process.env.FOUNDRY_CONTRACTS_ROOT!, 'capability-aware-routing.json'), '{not-json')
    results.push(check('FIXTURE_M', getCapabilityAwareRoutingMode() === ROUTING_FAIL_SAFE_MODE && ROUTING_FAIL_SAFE_MODE === 'SHADOW', getCapabilityAwareRoutingMode()))
    enableCapabilityAwareRouting({ mission: 'MISSION_16_FIXTURE_N' })
    const killed = disableCapabilityAwareRouting({ mission: 'FIXTURE_N_KILL_SWITCH' })
    results.push(check('FIXTURE_N', killed.mode === 'SHADOW' && getCapabilityAwareRoutingMode() === 'SHADOW' && loop.routingDecision?.missionContractHash === contractBeforeKill, `${killed.previousMode}->${killed.mode}`))
    results.push(check('ROUTING_KILL_SWITCH', killed.ok && killed.mode === 'SHADOW', killed.mode))
    results.push(check('ROUTING_FAIL_SAFE_MODE', ROUTING_FAIL_SAFE_MODE === 'SHADOW', ROUTING_FAIL_SAFE_MODE))
    results.push(check('MODEL_ROUTING_ENABLE_COUNT', MODEL_ROUTING_ENABLE_COUNT === 0, String(MODEL_ROUTING_ENABLE_COUNT)))
    results.push(check('WORKER_SWITCH_AUTHORITY_EXPANSION_COUNT', WORKER_SWITCH_AUTHORITY_EXPANSION_COUNT === 0, String(WORKER_SWITCH_AUTHORITY_EXPANSION_COUNT)))
    enableCapabilityAwareRouting({ mission: 'MISSION_16_FIXTURE' })
  })

  const kernel = readFileSync(path.join(resolveRepoRoot(), 'components/war-room/foundry/FoundryReasoningKernelSection.tsx'), 'utf8')
  results.push(check('UI_ROUTING_FIELDS', /Selected Worker/.test(kernel) && /Recommended Worker/.test(kernel) && /Previous Worker/.test(kernel) && /Routing Mode/.test(kernel) && /Worker Switch Count/.test(kernel), 'kernel panel'))
  const operations = readFileSync(path.join(resolveRepoRoot(), 'components/war-room/foundry/FoundryOperationsPanel.tsx'), 'utf8')
  results.push(check('UI_ROUTING_MODE_CONTROL', /foundry-routing-mode-control/.test(operations) && /SHADOW/.test(operations) && /ENABLED/.test(operations), 'operations control'))
  const worker = readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/reasoning-kernel/worker.ts'), 'utf8')
  const unattended = readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryUnattendedEngineer.ts'), 'utf8')
  const router = readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryModelRouter.ts'), 'utf8')
  results.push(check('MODEL_CANNOT_ENABLE', !/enableCapabilityAwareRouting/.test(worker) && !/enableCapabilityAwareRouting/.test(unattended) && !/enableCapabilityAwareRouting/.test(router), 'worker/model cannot enable routing'))
  results.push(check('NO_SECOND_ROUTER', /FoundryModelRouter remains|not a second router/i.test(routingSrc) && !/createSecondRouter/.test(routingSrc), 'existing router'))
  return results
}

async function main(): Promise<void> {
  const results = await runEnabledRoutingFixtures()
  const failed = results.filter(item => !item.pass)
  const payload = { ok: failed.length === 0, passed: results.filter(item => item.pass).length, failed: failed.length, results }
  const out = path.join(resolveRepoRoot(), 'tmp/foundry-capability-aware-routing-enabled/validator.json')
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(payload, null, 2))
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (failed.length) process.exit(1)
}

const isDirect = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isDirect) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
