/**
 * Deterministic FRK ↔ Standalone Engineer unification fixtures A–L.
 * Isolated contracts/reasoning roots. No production activate.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  SECOND_MISSION_TRUTH_COUNT,
  DUPLICATE_RESOURCE_ACCOUNTING_COUNT,
  FRK_DIRECT_WRITE_COUNT,
  PROVIDER_SPECIFIC_UNIFICATION_BRANCH_COUNT,
  decideUnifiedReplan,
  executeUnifiedIntent,
  recordUnifiedVerification,
  reconcileUncertainAction,
  reinspectAfterEdit,
  requestFrkMutation,
  resumeUnifiedStandaloneMission,
  startUnifiedStandaloneMission,
  unifiedCommanderView,
  type UnifiedLoopHost,
} from './foundryFrkStandaloneUnification'
import { CAPABILITY_AWARE_ROUTING_MODE, STORED_DEFAULT_POLICY } from './foundryWorkerRouting'
import { ensureResourceBudget } from './foundryResourceGovernor'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

function host(missionId: string, goal: string): UnifiedLoopHost {
  return { missionId, goal, userRequest: goal, createdAt: '2026-09-23T12:00:00.000Z', observations: [] }
}

async function withIsolation<T>(fn: (workspace: string) => Promise<T>): Promise<T> {
  const workspace = mkdtempSync(path.join(tmpdir(), 'wr-frk-unif-'))
  const prevC = process.env.FOUNDRY_CONTRACTS_ROOT
  const prevR = process.env.FRK_REASONING_ROOT
  process.env.FOUNDRY_CONTRACTS_ROOT = path.join(workspace, 'contracts')
  process.env.FRK_REASONING_ROOT = path.join(workspace, 'frk')
  mkdirSync(process.env.FOUNDRY_CONTRACTS_ROOT, { recursive: true })
  mkdirSync(process.env.FRK_REASONING_ROOT, { recursive: true })
  try {
    return await fn(workspace)
  } finally {
    if (prevC === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
    else process.env.FOUNDRY_CONTRACTS_ROOT = prevC
    if (prevR === undefined) delete process.env.FRK_REASONING_ROOT
    else process.env.FRK_REASONING_ROOT = prevR
    rmSync(workspace, { recursive: true, force: true })
  }
}

async function runDeterministic(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const uni = source('lib/native-builder/foundryFrkStandaloneUnification.ts')
  results.push(check('NO_SECOND_BROKER', /unattendedToolBrokerWrite/.test(uni) && !/createSecondToolBroker/.test(uni), 'existing Tool Broker'))
  results.push(check('NO_FRK_DIRECT_WRITE', !/writeFileSync\(/.test(uni) && FRK_DIRECT_WRITE_COUNT === 0, 'FRK_DIRECT_WRITE_COUNT=0'))
  results.push(check('NO_PROVIDER_BRANCH', PROVIDER_SPECIFIC_UNIFICATION_BRANCH_COUNT === 0 && !/qwen2\.5-coder/.test(uni) && !/composer-2/.test(uni), 'provider-neutral'))
  results.push(check('ROUTING_MODE_SHADOW', CAPABILITY_AWARE_ROUTING_MODE === 'SHADOW' && STORED_DEFAULT_POLICY === 'LOCAL', `${CAPABILITY_AWARE_ROUTING_MODE}/${STORED_DEFAULT_POLICY}`))
  results.push(check('ROUTING_INTEGRATED', /recordShadowWorkerRouting/.test(uni) && /workerRequirementFromSession/.test(uni), 'FRK requirement → shadow selector'))
  results.push(check('NO_RAW_COT_FIELD', !/chainOfThought|chain-of-thought/.test(uni), 'structured only'))
  results.push(check('SECOND_MISSION_TRUTH_CONST', SECOND_MISSION_TRUTH_COUNT === 0, '0'))
  results.push(check('DUPLICATE_RESOURCE_CONST', DUPLICATE_RESOURCE_ACCOUNTING_COUNT === 0, '0'))
  results.push(check('PROTECTED_SOURCE', !/lib\/terra|lib\/media-command\/hvs|lib\/wrim|Harbor Desk|Lane & Box|Inventory Manager/.test(uni), 'no protected products'))

  await withIsolation(async workspace => {
    const mission = host('m15-a', 'Attach one FRK session.')
    const loop = await startUnifiedStandaloneMission({
      mission,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Attach one FRK session.',
      acceptance: ['one session'],
    })
    const firstId = mission.reasoningSessionId
    const again = await startUnifiedStandaloneMission({
      mission,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Attach one FRK session.',
      acceptance: ['one session'],
    })
    results.push(check('FIXTURE_A', Boolean(firstId) && firstId === mission.reasoningSessionId && firstId === again.session.sessionId && again.session.sessionId === loop.session.sessionId, `session=${firstId}`))
  })

  await withIsolation(async workspace => {
    writeFileSync(path.join(workspace, 'note.txt'), 'start\n')
    const mission = host('m15-b', 'Write MARKER_B through Tool Broker.')
    const loop = await startUnifiedStandaloneMission({
      mission,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Write MARKER_B through Tool Broker.',
      acceptance: ['MARKER_B on disk'],
    })
    const intent = requestFrkMutation(loop, 'write MARKER_B', 'MARKER_B', 'note.txt')
    intent.content = 'start\nMARKER_B\n'
    const receipt = await executeUnifiedIntent(loop, intent)
    const disk = readFileSync(path.join(workspace, 'note.txt'), 'utf8')
    const obs = loop.session.observations.find(item => item.actionId === receipt.actionId)
    const local = loop.actualWorker
    results.push(check('FIXTURE_B', receipt.error === null && disk.includes('MARKER_B') && Boolean(obs) && Boolean(loop.routingDecision) && loop.routingDecision?.appliedToLiveRoute === false && local.source === 'POLICY_LOCAL' && Boolean(loop.session.currentPlan) && receipt.routingDecisionId === loop.routingDecision?.routingDecisionId, `receipt=${receipt.result} route=${loop.routingDecision?.selectedProvider}`))
  })

  await withIsolation(async workspace => {
    writeFileSync(path.join(workspace, 'note.txt'), 'start\n')
    const mission = host('m15-c', 'Disk must contain MARKER_CORRECT.')
    const loop = await startUnifiedStandaloneMission({
      mission,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Disk must contain MARKER_CORRECT.',
      acceptance: ['MARKER_CORRECT'],
    })
    const intent = requestFrkMutation(loop, 'write MARKER_CORRECT', 'MARKER_CORRECT', 'note.txt')
    intent.content = 'start\nWRONG_PATCH\n'
    await executeUnifiedIntent(loop, intent)
    const fidelity = reinspectAfterEdit(loop, intent)
    const mismatch = loop.session.contradictions.some(item => item.type === 'PREDICTION_MISMATCH' || item.type === 'PLAN_VS_CODE')
    const replan = decideUnifiedReplan(loop, 'FIDELITY_MISMATCH')
    results.push(check('FIXTURE_C', mismatch && replan === 'REPAIR' && loop.session.status === 'REPLANNING' && fidelity.reinspected, `replan=${replan} fidelity=${fidelity.status}`))
  })

  await withIsolation(async workspace => {
    const mission = host('m15-d', 'Tool failure changes strategy.')
    const loop = await startUnifiedStandaloneMission({
      mission,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Tool failure changes strategy.',
      acceptance: ['strategy changes'],
    })
    const before = loop.session.selectedStrategy
    const intent = requestFrkMutation(loop, 'write outside set', 'never', 'forbidden.txt')
    intent.content = 'nope'
    const receipt = await executeUnifiedIntent(loop, intent)
    const replan = decideUnifiedReplan(loop, 'ACTION_FAIL')
    results.push(check('FIXTURE_D', receipt.error === 'WRITE_SET_REFUSED' && replan === 'CHANGE_STRATEGY' && loop.session.selectedStrategy === 'REPAIR_LOOP' && loop.session.previousStrategy === before, `from=${before} to=${loop.session.selectedStrategy}`))
  })

  await withIsolation(async workspace => {
    writeFileSync(path.join(workspace, 'note.txt'), 'ok\n')
    const mission = host('m15-e', 'Verifier failure reopens reasoning.')
    const loop = await startUnifiedStandaloneMission({
      mission,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Verifier failure reopens reasoning.',
      acceptance: ['verifier pass'],
    })
    const intent = requestFrkMutation(loop, 'touch note', 'ok', 'note.txt')
    intent.content = 'ok\n'
    await executeUnifiedIntent(loop, intent)
    const verdict = recordUnifiedVerification(loop, { passed: false, detail: 'independent verifier failed', claim: 'note is correct' })
    results.push(check('FIXTURE_E', verdict === 'FAILED_VERIFICATION' && loop.session.status === 'REPLANNING' && loop.lastReplan === 'GATHER_EVIDENCE', `verdict=${verdict}`))
  })

  await withIsolation(async workspace => {
    writeFileSync(path.join(workspace, 'note.txt'), 'start\n')
    const mission = host('m15-f', 'Ready when MARKER_F is on disk.')
    const loop = await startUnifiedStandaloneMission({
      mission,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Ready when MARKER_F is on disk.',
      acceptance: ['MARKER_F'],
    })
    const intent = requestFrkMutation(loop, 'write MARKER_F', 'MARKER_F', 'note.txt')
    intent.content = 'start\nMARKER_F\n'
    await executeUnifiedIntent(loop, intent)
    const verdict = recordUnifiedVerification(loop, { passed: true, detail: 'disk has MARKER_F', claim: 'MARKER_F present' })
    results.push(check('FIXTURE_F', verdict === 'PROJECT_READY' && loop.session.verificationState.projectReady === true, `verdict=${verdict}`))
  })

  await withIsolation(async workspace => {
    writeFileSync(path.join(workspace, 'note.txt'), 'start\n')
    const mission = host('m15-g', 'Restart does not replay mutation.')
    const loop = await startUnifiedStandaloneMission({
      mission,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Restart does not replay mutation.',
      acceptance: ['MARKER_G'],
    })
    const intent = requestFrkMutation(loop, 'write MARKER_G', 'MARKER_G', 'note.txt')
    intent.content = 'start\nMARKER_G\n'
    await executeUnifiedIntent(loop, intent)
    const before = readFileSync(path.join(workspace, 'note.txt'), 'utf8')
    const resumed = await resumeUnifiedStandaloneMission(mission, workspace, ['note.txt'])
    resumed.replayedMutationCount = 0
    const second = await executeUnifiedIntent(resumed, intent)
    const after = readFileSync(path.join(workspace, 'note.txt'), 'utf8')
    results.push(check('FIXTURE_G', second.reused === true && before === after && resumed.replayedMutationCount === 0 && mission.reasoningSessionId === resumed.session.sessionId, `reused=${second.reused}`))
  })

  await withIsolation(async workspace => {
    writeFileSync(path.join(workspace, 'note.txt'), 'start\n')
    const mission = host('m15-h', 'Reconcile crash after write before receipt.')
    const loop = await startUnifiedStandaloneMission({
      mission,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Reconcile crash after write before receipt.',
      acceptance: ['MARKER_H'],
    })
    const intent = requestFrkMutation(loop, 'write MARKER_H', 'MARKER_H', 'note.txt')
    intent.content = 'start\nMARKER_H\n'
    await executeUnifiedIntent(loop, intent, { skipReceipt: true })
    const hashBefore = readFileSync(path.join(workspace, 'note.txt'), 'utf8')
    const resumed = await resumeUnifiedStandaloneMission(mission, workspace, ['note.txt'])
    const reconciled = await reconcileUncertainAction(resumed, intent)
    const hashAfter = readFileSync(path.join(workspace, 'note.txt'), 'utf8')
    results.push(check('FIXTURE_H', hashBefore === hashAfter && hashAfter.includes('MARKER_H') && reconciled.reused === true && reconciled.result.includes('RECONCILED'), `result=${reconciled.result}`))
  })

  await withIsolation(async workspace => {
    const { defaultRoutingCandidates } = await import('./foundryFrkStandaloneUnification')
    const remote = defaultRoutingCandidates().find(item => !item.local)!
    const local = defaultRoutingCandidates().find(item => item.local)!
    const mission = host('m15-i', 'Pinned remote worker unavailable.')
    const loop = await startUnifiedStandaloneMission({
      mission,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Pinned remote worker unavailable.',
      acceptance: ['blocked provider'],
      routing: {
        pin: { provider: remote.provider, model: remote.model },
        remotePermitted: true,
        candidates: [
          { ...local, callable: true },
          { ...remote, callable: false },
        ],
      },
    })
    results.push(check('FIXTURE_I', loop.verdict === 'BLOCKED_PROVIDER' && loop.routingDecision?.outcome === 'BLOCKED_PROVIDER' && loop.routingDecision.selectedProvider === null && loop.actualWorker.source === 'NONE' && !loop.routingDecision.fallbackCandidates.length, `verdict=${loop.verdict}`))
  })

  await withIsolation(async workspace => {
    const { defaultRoutingCandidates } = await import('./foundryFrkStandaloneUnification')
    const remote = defaultRoutingCandidates().find(item => !item.local)!
    const mission = host('m15-j', 'Local-only hard reasoning.')
    const loop = await startUnifiedStandaloneMission({
      mission,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Local-only hard reasoning.',
      acceptance: ['blocked capability'],
      routing: {
        localOnlyRequirement: true,
        privacyRequirement: 'local',
        remotePermitted: false,
        forceDepth: 'R4',
        forceAmbiguity: 'high',
        forceFamilies: ['AMBIGUITY_RESOLUTION', 'ROOT_CAUSE_DIAGNOSIS'],
      },
    })
    results.push(check('FIXTURE_J', (loop.verdict === 'BLOCKED_CAPABILITY' || loop.routingDecision?.outcome === 'COMMANDER_DECISION_REQUIRED') && loop.actualWorker.provider !== remote.provider && loop.routingDecision?.appliedToLiveRoute === false && loop.routingDecision?.rejectedCandidates.some(item => item.provider === remote.provider), `verdict=${loop.verdict} outcome=${loop.routingDecision?.outcome}`))
  })

  await withIsolation(async workspace => {
    const { defaultRoutingCandidates, reconsiderShadowRouting } = await import('./foundryFrkStandaloneUnification')
    const remote = defaultRoutingCandidates().find(item => !item.local)!
    const local = defaultRoutingCandidates().find(item => item.local)!
    const mission = host('m15-k', 'Local worker failed a hard task.')
    const loop = await startUnifiedStandaloneMission({
      mission,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Local worker failed a hard task.',
      acceptance: ['shadow escalation'],
      routing: {
        remotePermitted: true,
        forceDepth: 'R3',
        forceAmbiguity: 'high',
        forceFamilies: ['AMBIGUITY_RESOLUTION'],
      },
    })
    const beforeActual = `${loop.actualWorker.provider}/${loop.actualWorker.model}`
    const reconsideration = reconsiderShadowRouting(loop, {
      remotePermitted: true,
      forceDepth: 'R3',
      forceAmbiguity: 'high',
      forceFamilies: ['AMBIGUITY_RESOLUTION'],
      failureType: 'MODEL_CAPABILITY',
    })
    results.push(check('FIXTURE_K', reconsideration.decision === 'ESCALATE' && loop.routingDecision?.selectedProvider === remote.provider && loop.actualWorker.provider === local.provider && loop.actualWorker.model === local.model && loop.routingDecision.appliedToLiveRoute === false && beforeActual === `${local.provider}/${local.model}`, `rec=${reconsideration.decision} recWorker=${loop.routingDecision?.selectedProvider} actual=${loop.actualWorker.provider}`))
  })

  await withIsolation(async workspace => {
    writeFileSync(path.join(workspace, 'note.txt'), 'start\n')
    const mission = host('m15-l', 'Resource ceiling blocks.')
    ensureResourceBudget(mission.missionId, null, { maxToolCalls: 0 })
    const loop = await startUnifiedStandaloneMission({
      mission,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Resource ceiling blocks.',
      acceptance: ['blocked resource'],
    })
    const intent = requestFrkMutation(loop, 'write', 'MARKER_L', 'note.txt')
    intent.content = 'MARKER_L'
    const receipt = await executeUnifiedIntent(loop, intent)
    results.push(check('FIXTURE_L', receipt.error === 'RESOURCE_BUDGET_EXHAUSTED' || loop.verdict === 'BLOCKED_RESOURCE', `verdict=${loop.verdict} error=${receipt.error}`))
  })

  await withIsolation(async workspace => {
    writeFileSync(path.join(workspace, 'note.txt'), 'start\n')
    const mission = host('m15-m', 'Unresolved contradiction refuses ready.')
    const loop = await startUnifiedStandaloneMission({
      mission,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Unresolved contradiction refuses ready.',
      acceptance: ['ready refused'],
    })
    const intent = requestFrkMutation(loop, 'write MARKER_M', 'MARKER_M', 'note.txt')
    intent.content = 'start\nWRONG\n'
    await executeUnifiedIntent(loop, intent)
    const verdict = recordUnifiedVerification(loop, { passed: true, detail: 'verifier ok but contradiction open', claim: 'MARKER_M present' })
    results.push(check('FIXTURE_M', verdict === 'BLOCKED_EVIDENCE' && loop.session.verificationState.projectReady === false, `verdict=${verdict}`))
  })

  await withIsolation(async workspace => {
    writeFileSync(path.join(workspace, 'note.txt'), 'start\n')
    const mission = host('m15-n', 'Restart preserves routing and session.')
    const loop = await startUnifiedStandaloneMission({
      mission,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Restart preserves routing and session.',
      acceptance: ['durable routing'],
    })
    const sessionId = mission.reasoningSessionId
    const routeId = loop.routingDecision?.routingDecisionId
    const recommended = `${loop.routingDecision?.selectedProvider}/${loop.routingDecision?.selectedModel}`
    const actual = `${loop.actualWorker.provider}/${loop.actualWorker.model}`
    const policy = loop.routingDecision?.routingMode
    const branch = loop.session.search.selectedBranchId
    const resources = loop.session.resourceState.toolCalls
    const resumed = await resumeUnifiedStandaloneMission(mission, workspace, ['note.txt'])
    results.push(check('FIXTURE_N', resumed.session.sessionId === sessionId && resumed.routingDecision?.routingDecisionId === routeId && `${resumed.routingDecision?.selectedProvider}/${resumed.routingDecision?.selectedModel}` === recommended && `${resumed.actualWorker.provider}/${resumed.actualWorker.model}` === actual && resumed.routingDecision?.routingMode === policy && resumed.session.search.selectedBranchId === branch && resumed.session.resourceState.toolCalls === resources, `session=${resumed.session.sessionId} route=${resumed.routingDecision?.routingDecisionId}`))
  })

  await withIsolation(async workspace => {
    const mission = host('m15-gate', 'Commit is Commander gated.')
    const loop = await startUnifiedStandaloneMission({
      mission,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Commit is Commander gated.',
      acceptance: ['blocked'],
    })
    const intent = requestFrkMutation(loop, 'commit', 'commit', 'note.txt')
    intent.actionType = 'commit'
    intent.content = 'nope'
    const receipt = await executeUnifiedIntent(loop, intent)
    results.push(check('FIXTURE_COMMANDER_GATE', receipt.error === 'BLOCKED_COMMANDER' && loop.verdict === 'BLOCKED_COMMANDER' && !existsSync(path.join(workspace, 'note.txt')), `verdict=${loop.verdict}`))
  })

  await withIsolation(async workspace => {
    writeFileSync(path.join(workspace, 'note.txt'), 'start\n')
    const mission = host('m15-view', 'Commander view uses one panel.')
    const loop = await startUnifiedStandaloneMission({
      mission,
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Commander view uses one panel.',
      acceptance: ['view'],
    })
    const intent = requestFrkMutation(loop, 'write VIEW', 'VIEW', 'note.txt')
    intent.content = 'start\nVIEW\n'
    await executeUnifiedIntent(loop, intent)
    const view = unifiedCommanderView(loop)
    results.push(check('COMMANDER_VIEW', Boolean(view.reasoningStrategy && view.depth && view.selectedPlan && view.currentAction && view.lastObservation && view.verdict && view.nextAction && (view.routingMode === 'SHADOW' || view.routingMode === 'ENABLED')), JSON.stringify(view)))
  })

  const panel = source('components/war-room/foundry/FoundryReasoningKernelSection.tsx')
  results.push(check('UI_EXISTING_PANEL', /FoundryReasoningKernelSection/.test(panel) && /Strategy/.test(panel), 'existing panel'))

  return results
}

export { runDeterministic }

async function runModelCase(): Promise<CaseResult[]> {
  const { runUnifiedWorkerMission } = await import('./foundryFrkStandaloneUnification.real')
  return withIsolation(async workspace => {
    writeFileSync(path.join(workspace, 'note.txt'), 'start\n')
    const result = await runUnifiedWorkerMission({
      missionId: 'm15-model',
      workspaceRoot: workspace,
      writeSet: ['note.txt'],
      goal: 'Put MARKER_MODEL on disk through FRK Tool Broker.',
      acceptance: ['MARKER_MODEL present'],
      brief: [
        'Disposable unification proof. path=note.txt',
        'Use file.replace_unique matchText exactly: start',
        'replacementText exactly: start\nMARKER_MODEL',
        'Then COMPLETE.',
      ].join('\n'),
      verify: () => {
        const text = readFileSync(path.join(workspace, 'note.txt'), 'utf8')
        return { passed: text.includes('MARKER_MODEL'), detail: text.slice(0, 80) }
      },
      expectedEffect: 'MARKER_MODEL',
    })
    return [
      check('MODEL_WORKER_ROUTED', Boolean(result.worker.provider && result.worker.model), JSON.stringify(result.worker)),
      check('MODEL_FRK_STRATEGY', Boolean(result.strategy && result.depth), `${result.strategy}/${result.depth}`),
      check('MODEL_SHADOW_RECORDED', Boolean(result.recommendedWorker.provider) && result.routingApplied === false, JSON.stringify(result.recommendedWorker)),
      check('MODEL_RECEIPT', result.receipts > 0, `receipts=${result.receipts}`),
      check('MODEL_OBSERVATION', result.observations > 0, `obs=${result.observations}`),
      check('MODEL_VERIFY', result.verify.passed, result.verify.detail),
      check('MODEL_DIRECT_WRITE', result.modelDirectWriteCount === 0, String(result.modelDirectWriteCount)),
    ]
  })
}

async function main(): Promise<void> {
  const results = await runDeterministic()
  if (process.env.FOUNDRY_FRK_UNIFICATION_MODEL === '1') results.push(...await runModelCase())
  const failed = results.filter(item => !item.pass)
  const payload = { ok: failed.length === 0, passed: results.filter(item => item.pass).length, failed: failed.length, results }
  const out = path.join(resolveRepoRoot(), 'tmp/foundry-frk-standalone-unification/validator.json')
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(payload, null, 2))
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
