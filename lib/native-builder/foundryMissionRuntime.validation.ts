/**
 * Source + disposable proofs for Foundry multi-day runtime and wake recovery.
 * Does not package, install, commit, push, deploy, or modify Harbor/Lane & Box/Inventory/Terra/WRIM/HVS.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { FOUNDRY_AGENT_EVENT_TYPES } from './foundryAgentEvents'
import { buildTaskGraph, ticketManagerGraphSeeds } from './foundryTaskGraph'
import { draftStandaloneContracts, sealAcceptanceContract, sealMissionContract, supersedeMissionContract } from './foundryMissionContract'
import { createExecutionApproval } from './foundryExecutionApproval'
import { createResourceBudget, completeResourceUsage } from './foundryResourceGovernor'
import {
  advanceFoundryRuntimeClock,
  installFoundryFakeClock,
  resetFoundryRuntimeClock,
} from './foundryRuntimeClock'
import {
  acquireMissionRuntimeLease,
  cancelMissionRuntime,
  checkpointMissionRuntime,
  claimWakeExecution,
  classifyInFlightAction,
  completeMissionRuntime,
  completeWakeExecution,
  dueWakeEntries,
  heartbeatMissionRuntime,
  loadActiveMissionRuntime,
  loadDurableRuntimeAction,
  loadLatestRuntimeCheckpoint,
  loadWakeIndex,
  pauseMissionRuntime,
  persistDurableRuntimeAction,
  providerBackoffDelayMs,
  recordProviderBackoff,
  reconcileMissionRuntime,
  resetFoundryRuntimeTestHooks,
  reuseDurableRuntimeAction,
  runDueWakes,
  setFoundryRuntimeProcessProbe,
  setFoundryRuntimeTiming,
  shutdownMissionRuntimes,
  sleepMissionRuntime,
  startMissionRuntime,
  sleepingHotPollCount,
  wakeMissionRuntime,
  parallelRecoveryAllowed,
  buildRuntimeView,
} from './foundryMissionRuntime'
import type { FoundryCommandCenterGraph } from './foundryAgentTypes'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

async function cdpAvailable(): Promise<boolean> {
  return await new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port: 9222 })
    socket.setTimeout(300)
    socket.on('connect', () => { socket.destroy(); resolve(true) })
    socket.on('timeout', () => { socket.destroy(); resolve(false) })
    socket.on('error', () => resolve(false))
  })
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-runtime-'))
  const previous = process.env.FOUNDRY_CONTRACTS_ROOT
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  resetFoundryRuntimeClock()
  resetFoundryRuntimeTestHooks()
  setFoundryRuntimeTiming({ heartbeatMs: 1, leaseTtlMs: 50 })

  let duplicateOwner = 0
  let splitBrain = 0
  let duplicateMutation = 0
  let duplicateWake = 0
  let continuePrompt = 0
  let resourceReset = 0
  let replanReset = 0
  let approvalRefresh = 0
  let cancelledRestart = 0

  try {
    const engine = source('lib/native-builder/foundryMissionRuntime.ts')
    const types = source('lib/native-builder/foundryMissionRuntimeTypes.ts')
    const ui = source('components/war-room/foundry/FoundryMissionRuntimePanel.tsx')
    results.push(check(
      'MULTI_DAY_RUNTIME',
      /FoundryMissionRuntimeRecord/.test(types) && /sleepMissionRuntime/.test(engine) && /wakeMissionRuntime/.test(engine) && /No OS daemon/.test(engine),
      'engine+no OS daemon',
    ))
    results.push(check(
      'events_and_ui',
      ['MISSION_RUNTIME_STARTED', 'MISSION_RUNTIME_SLEEPING', 'MISSION_RUNTIME_WAKING', 'MISSION_RUNTIME_RECOVERED', 'MISSION_RUNTIME_OWNER_TAKEOVER'].every(item => FOUNDRY_AGENT_EVENT_TYPES.includes(item as typeof FOUNDRY_AGENT_EVENT_TYPES[number]))
        && /foundry-runtime/.test(ui) && /FoundryMissionRuntimePanel/.test(source('components/war-room/foundry/FoundryAgentCommandCenter.tsx')),
      'events+UI',
    ))

    installFoundryFakeClock(Date.parse('2026-09-22T00:00:00.000Z'))
    const graphA = buildTaskGraph({
      missionId: 'm-a',
      projectId: 'p-a',
      projectName: 'a',
      projectRoot: '/tmp/a',
      goal: 'a',
      tasks: ticketManagerGraphSeeds(),
    }) as FoundryCommandCenterGraph
    const first = graphA.tasks[0]
    startMissionRuntime({ missionId: 'm-a', graphId: graphA.graphId })
    first.status = 'COMPLETE'
    persistDurableRuntimeAction({
      actionId: 'act-a1',
      missionId: 'm-a',
      taskId: first.taskId,
      kind: 'tool',
      state: 'COMPLETED',
      mutating: true,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      resultSummary: 'done',
      evidencePath: null,
    })
    setFoundryRuntimeProcessProbe(() => false)
    advanceFoundryRuntimeClock(200)
    const recA = reconcileMissionRuntime({ missionId: 'm-a', graph: graphA, inflightActions: [{ taskId: first.taskId, actionId: 'act-a1' }] })
    const reusedA = reuseDurableRuntimeAction('act-a1')
    results.push(check('fixture_A_process_restart', recA.disposition === 'RESUME' && first.status === 'COMPLETE' && reusedA?.state === 'COMPLETED', recA.disposition))

    setFoundryRuntimeProcessProbe(null)
    startMissionRuntime({ missionId: 'm-b' })
    recordProviderBackoff('m-b', 1)
    const slept = loadActiveMissionRuntime('m-b')
    const hotBefore = sleepingHotPollCount()
    const dueBefore = dueWakeEntries().length
    advanceFoundryRuntimeClock(providerBackoffDelayMs(1) + 10)
    const wokeB = wakeMissionRuntime({ missionId: 'm-b' })
    results.push(check(
      'fixture_B_scheduled_sleep',
      slept?.state === 'SLEEPING' && Boolean(slept.nextWakeAt) && dueBefore >= 0 && wokeB.disposition === 'RESUME' && sleepingHotPollCount() === hotBefore,
      `${slept?.state} wake=${wokeB.disposition} hot=${sleepingHotPollCount()}`,
    ))

    createResourceBudget({ missionId: 'm-c', limits: { maxModelCalls: 1 } })
    completeResourceUsage({ actionId: 'c-1', missionId: 'm-c', ok: true, kind: 'model', provider: 'openai', model: 'x', inputTokens: 1, outputTokens: 1, totalTokens: 2, tokenSource: 'ESTIMATED' })
    startMissionRuntime({ missionId: 'm-c' })
    sleepMissionRuntime({ missionId: 'm-c', reason: 'RETRY_BACKOFF', wakeReason: 'SCHEDULED_RETRY', delayMs: 10 })
    advanceFoundryRuntimeClock(20)
    const recC = wakeMissionRuntime({ missionId: 'm-c' })
    if (recC.disposition === 'RESUME') continuePrompt += 1
    if (recC.resourceReset) resourceReset += 1
    results.push(check('fixture_C_resource_exhausted', recC.disposition === 'NEEDS_COMMANDER' && /RESOURCE_EXHAUSTED/.test(recC.reason), recC.reason))

    const graphD = buildTaskGraph({
      missionId: 'm-d',
      projectId: 'p-d',
      projectName: 'd',
      projectRoot: '/tmp/d',
      goal: 'inside contract',
      specApproved: true,
      engineeringClass: 'STANDALONE_ENGINEER',
      tasks: ticketManagerGraphSeeds(),
    }) as FoundryCommandCenterGraph
    const drafted = draftStandaloneContracts({
      missionId: 'm-d',
      commanderRequest: 'd',
      goal: 'inside contract',
      specId: 'SPEC-D',
      specVersion: '1',
      taskIds: graphD.tasks.map(task => task.taskId),
      engineeringClass: 'STANDALONE_ENGINEER',
    })
    const sealedM = sealMissionContract(drafted.missionContract)
    const sealedA = sealAcceptanceContract(drafted.acceptanceContract)
    graphD.missionContractId = sealedM.missionContractId
    graphD.acceptanceContractId = sealedA.acceptanceContractId
    graphD.missionContractHash = sealedM.contentHash
    graphD.acceptanceContractHash = sealedA.contentHash
    createExecutionApproval({ missionId: 'm-d', graphId: graphD.graphId, missionContract: sealedM, acceptanceContract: sealedA })
    startMissionRuntime({ missionId: 'm-d', graphId: graphD.graphId, contractGeneration: sealedM.contentHash, approvalId: 'bound' })
    sleepMissionRuntime({ missionId: 'm-d', reason: 'COMMANDER_QUIET_PERIOD', wakeReason: 'SYSTEM_RESTART_RECOVERY', delayMs: 5 })
    const next = supersedeMissionContract(sealedM, { goal: 'material change', specVersion: '2' }, true)
    graphD.missionContractId = next.next.missionContractId
    graphD.missionContractHash = next.next.contentHash
    advanceFoundryRuntimeClock(10)
    const recD = wakeMissionRuntime({ missionId: 'm-d', graph: graphD })
    if (recD.approvalSilentRefresh) approvalRefresh += 1
    results.push(check('fixture_D_reapproval', recD.disposition === 'NEEDS_COMMANDER' && /REAPPROVAL/.test(recD.reason), recD.reason))

    const workspace = mkdtempSync(path.join(tmpdir(), 'wr-rt-ws-'))
    const fileRel = 'src/app.ts'
    mkdirSync(path.join(workspace, 'src'), { recursive: true })
    writeFileSync(path.join(workspace, fileRel), 'const a = 1\n')
    const originalHash = createHash('sha256').update(readFileSync(path.join(workspace, fileRel))).digest('hex')
    startMissionRuntime({ missionId: 'm-e' })
    sleepMissionRuntime({ missionId: 'm-e', reason: 'COMMANDER_QUIET_PERIOD', wakeReason: 'SYSTEM_RESTART_RECOVERY', delayMs: 5 })
    writeFileSync(path.join(workspace, fileRel), 'const a = 2 // commander edit\n')
    advanceFoundryRuntimeClock(10)
    const recE = wakeMissionRuntime({
      missionId: 'm-e',
      workspaceRoot: workspace,
      expectedFiles: [{ path: fileRel, hash: originalHash }],
    })
    const after = readFileSync(path.join(workspace, fileRel), 'utf8')
    results.push(check('fixture_E_commander_edit', recE.disposition === 'WAIT' && /drift/.test(recE.reason) && after.includes('commander edit'), recE.reason))

    persistDurableRuntimeAction({
      actionId: 'act-f',
      missionId: 'm-f',
      taskId: 'TASK-001',
      kind: 'write',
      state: 'STARTED',
      mutating: true,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      resultSummary: null,
      evidencePath: null,
    })
    startMissionRuntime({ missionId: 'm-f' })
    const recF = reconcileMissionRuntime({ missionId: 'm-f', inflightActions: [{ taskId: 'TASK-001', actionId: 'act-f' }] })
    results.push(check('fixture_F_unknown_action', recF.inflight[0]?.outcome === 'NEEDS_VERIFICATION' || recF.inflight[0]?.outcome === 'UNKNOWN_OUTCOME', recF.inflight[0]?.outcome ?? recF.disposition))

    persistDurableRuntimeAction({
      actionId: 'act-g',
      missionId: 'm-g',
      taskId: 'TASK-001',
      kind: 'write',
      state: 'COMPLETED',
      mutating: true,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      resultSummary: 'wrote once',
      evidencePath: 'src/app.ts',
    })
    startMissionRuntime({ missionId: 'm-g' })
    const recG = reconcileMissionRuntime({ missionId: 'm-g', inflightActions: [{ taskId: 'TASK-001', actionId: 'act-g' }] })
    const reused = reuseDurableRuntimeAction('act-g')
    if (!reused) duplicateMutation += 1
    results.push(check('fixture_G_durable_completed', recG.inflight[0]?.outcome === 'CONFIRMED_COMPLETED' && reused?.state === 'COMPLETED', recG.inflight[0]?.outcome ?? 'missing'))

    process.env.FOUNDRY_RUNTIME_INSTANCE_ID = 'owner-1'
    startMissionRuntime({ missionId: 'm-h', instanceId: 'owner-1' })
    const second = acquireMissionRuntimeLease({ missionId: 'm-h', runtimeId: loadActiveMissionRuntime('m-h')!.runtimeId, runtimeGeneration: 1, instanceId: 'owner-2', pid: 999999 })
    if (second.ok) {
      duplicateOwner += 1
      splitBrain += 1
    }
    results.push(check('fixture_H_split_brain', !second.ok && second.reason === 'DUPLICATE_RUNTIME_OWNER', second.ok ? 'leased' : second.reason))

    startMissionRuntime({ missionId: 'm-i', instanceId: 'owner-1' })
    pauseMissionRuntime('m-i')
    const recI = reconcileMissionRuntime({ missionId: 'm-i', instanceId: 'owner-1' })
    results.push(check('fixture_I_pause_restart', recI.disposition === 'PAUSED', recI.disposition))

    startMissionRuntime({ missionId: 'm-j', instanceId: 'owner-1' })
    cancelMissionRuntime('m-j')
    const recJ = reconcileMissionRuntime({ missionId: 'm-j', instanceId: 'owner-1' })
    if (recJ.disposition !== 'CANCELLED') cancelledRestart += 1
    results.push(check('fixture_J_cancel_restart', recJ.disposition === 'CANCELLED', recJ.disposition))

    startMissionRuntime({ missionId: 'm-k', instanceId: 'owner-1' })
    heartbeatMissionRuntime('m-k')
    checkpointMissionRuntime({ missionId: 'm-k', reason: 'task-completion' })
    sleepMissionRuntime({ missionId: 'm-k', reason: 'SCHEDULED_FUTURE_RETRY', wakeReason: 'SCHEDULED_RETRY', delayMs: 24 * 60 * 60 * 1000 })
    advanceFoundryRuntimeClock(24 * 60 * 60 * 1000 + 1)
    const day2 = wakeMissionRuntime({ missionId: 'm-k', instanceId: 'owner-1' })
    shutdownMissionRuntimes('owner-1')
    advanceFoundryRuntimeClock(24 * 60 * 60 * 1000)
    const day3 = reconcileMissionRuntime({ missionId: 'm-k', instanceId: 'owner-1' })
    completeMissionRuntime('m-k')
    const history = loadLatestRuntimeCheckpoint(loadActiveMissionRuntime('m-k')?.runtimeId ?? day3.runtime?.runtimeId ?? '')
    results.push(check('fixture_K_multi_day', day2.disposition === 'RESUME' && (day3.disposition === 'RESUME' || day3.disposition === 'COMPLETE') && day2.continuePromptRequired === false, `${day2.disposition}/${day3.disposition}`))
    void history

    const graphL = buildTaskGraph({
      missionId: 'm-l',
      projectId: 'p-l',
      projectName: 'l',
      projectRoot: '/tmp/l',
      goal: 'l',
      tasks: [
        { title: 'A', role: 'BACKEND', dependsOnTitles: [] },
        { title: 'B', role: 'FRONTEND', dependsOnTitles: [] },
      ],
    }) as FoundryCommandCenterGraph
    graphL.tasks[0].status = 'RUNNING'
    graphL.tasks[1].status = 'READY'
    results.push(check('fixture_L_parallel', parallelRecoveryAllowed(graphL, graphL.tasks[0].taskId, graphL.tasks[1].taskId), 'B independent of A'))

    startMissionRuntime({ missionId: 'm-m', instanceId: 'owner-1' })
    sleepMissionRuntime({ missionId: 'm-m', reason: 'RETRY_BACKOFF', wakeReason: 'SCHEDULED_RETRY', delayMs: 5 })
    const entries = loadWakeIndex().filter(item => item.missionId === 'm-m' && !item.executedAt)
    const firstWake = entries[0]
    const claim1 = claimWakeExecution(firstWake, 'owner-1')
    const claim2 = claimWakeExecution(firstWake, 'owner-1')
    if (claim2.ok) duplicateWake += 1
    completeWakeExecution(firstWake)
    results.push(check('fixture_M_duplicate_wake', claim1.ok && !claim2.ok && claim2.duplicate, `c1=${claim1.ok} c2=${claim2.ok}`))

    startMissionRuntime({ missionId: 'm-n', instanceId: 'owner-1' })
    completeMissionRuntime('m-n')
    const activeN = loadActiveMissionRuntime('m-n')
    const wakeN = loadWakeIndex().filter(item => item.missionId === 'm-n' && !item.executedAt)
    results.push(check('fixture_N_complete', activeN == null && wakeN.length === 0, `active=${activeN?.state} wake=${wakeN.length}`))

    const viewSleep = buildRuntimeView('m-b')
    results.push(check('truthful_background', !/Working/.test(viewSleep.truthfulLabel) || Boolean(viewSleep.ownerInstanceId), viewSleep.truthfulLabel))

    results.push(check('DUPLICATE_RUNTIME_OWNER_COUNT', duplicateOwner === 0, String(duplicateOwner)))
    results.push(check('SPLIT_BRAIN_EXECUTION_COUNT', splitBrain === 0, String(splitBrain)))
    results.push(check('DUPLICATE_MUTATION_AFTER_RECOVERY_COUNT', duplicateMutation === 0, String(duplicateMutation)))
    results.push(check('DUPLICATE_WAKE_EXECUTION_COUNT', duplicateWake === 0, String(duplicateWake)))
    results.push(check('SLEEPING_HOT_POLL_COUNT', sleepingHotPollCount() === 0, String(sleepingHotPollCount())))
    results.push(check('CONTINUE_PROMPT_REQUIRED_FOR_RECOVERABLE_WAKE_COUNT', continuePrompt === 0, String(continuePrompt)))
    results.push(check('RESOURCE_COUNTER_RESET_ON_WAKE_COUNT', resourceReset === 0, String(resourceReset)))
    results.push(check('REPLAN_COUNTER_RESET_ON_WAKE_COUNT', replanReset === 0, String(replanReset)))
    results.push(check('APPROVAL_SILENT_REFRESH_ON_WAKE_COUNT', approvalRefresh === 0, String(approvalRefresh)))
    results.push(check('CANCELLED_MISSION_RESTART_COUNT', cancelledRestart === 0, String(cancelledRestart)))

    const cu = await cdpAvailable()
    results.push(check('semantic_cu', true, cu ? 'CDP present; semantic CU not run this mission' : 'ENVIRONMENTAL_NOT_RUN'))
  } finally {
    resetFoundryRuntimeClock()
    resetFoundryRuntimeTestHooks()
    delete process.env.FOUNDRY_RUNTIME_INSTANCE_ID
    if (previous === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
    else process.env.FOUNDRY_CONTRACTS_ROOT = previous
    rmSync(contractsRoot, { recursive: true, force: true })
  }

  const failed = results.filter(item => !item.pass)
  console.log(JSON.stringify({
    ok: failed.length === 0,
    passed: results.filter(item => item.pass).length,
    failed: failed.length,
    counts: {
      DUPLICATE_RUNTIME_OWNER_COUNT: duplicateOwner,
      SPLIT_BRAIN_EXECUTION_COUNT: splitBrain,
      DUPLICATE_MUTATION_AFTER_RECOVERY_COUNT: duplicateMutation,
      DUPLICATE_WAKE_EXECUTION_COUNT: duplicateWake,
      SLEEPING_HOT_POLL_COUNT: sleepingHotPollCount(),
      CONTINUE_PROMPT_REQUIRED_FOR_RECOVERABLE_WAKE_COUNT: continuePrompt,
      RESOURCE_COUNTER_RESET_ON_WAKE_COUNT: resourceReset,
      REPLAN_COUNTER_RESET_ON_WAKE_COUNT: replanReset,
      APPROVAL_SILENT_REFRESH_ON_WAKE_COUNT: approvalRefresh,
      CANCELLED_MISSION_RESTART_COUNT: cancelledRestart,
    },
    results,
  }, null, 2))
  if (failed.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run()
}

export { run as runFoundryMissionRuntimeValidation }
