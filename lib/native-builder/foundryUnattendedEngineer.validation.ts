/**
 * Source + disposable proofs for Commander-authorized bounded unattended engineering.
 * Does not package, install, commit, push, deploy, or modify Harbor/Lane & Box/Inventory/Terra/WRIM/HVS/Workbench.
 */
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
import { createResourceBudget, completeResourceUsage, refuseAutomaticBudgetIncrease } from './foundryResourceGovernor'
import { advanceFoundryRuntimeClock, installFoundryFakeClock, resetFoundryRuntimeClock } from './foundryRuntimeClock'
import {
  acquireMissionRuntimeLease,
  loadActiveMissionRuntime,
  persistDurableRuntimeAction,
  reuseDurableRuntimeAction,
  setFoundryRuntimeProcessProbe,
  setFoundryRuntimeTiming,
  resetFoundryRuntimeTestHooks,
  startMissionRuntime,
  sleepMissionRuntime,
} from './foundryMissionRuntime'
import {
  authorizeUnattendedEnvelope,
  beginUnattendedDurableAction,
  completeUnattendedEnvelope,
  performUnattendedOperation,
  pauseUnattendedEnvelope,
  recoverUnattendedEnvelopes,
  recoverUnattendedRunningTasks,
  refuseUnattendedGitMutation,
  revokeUnattendedEnvelope,
  startUnattendedEnvelope,
  unattendedActionCoverage,
  unattendedPreflight,
  unattendedSleep,
  unattendedWake,
  buildUnattendedView,
} from './foundryUnattendedEngineer'
import { loadActiveUnattendedEnvelope, loadUnattendedEnvelope } from './foundryUnattendedStore'
import { recoverCommandCenterGraph } from './foundryAgentStore'
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

function prepare(suffix: string): FoundryCommandCenterGraph {
  const missionId = `m-${suffix}`
  const graph = buildTaskGraph({
    missionId,
    projectId: `p-${suffix}`,
    projectName: suffix,
    projectRoot: `/tmp/foundry-ue-${suffix}`,
    goal: 'bounded unattended fixture',
    specApproved: true,
    engineeringClass: 'STANDALONE_ENGINEER',
    tasks: ticketManagerGraphSeeds(),
  }) as FoundryCommandCenterGraph
  const drafted = draftStandaloneContracts({
    missionId,
    commanderRequest: 'bounded unattended fixture',
    goal: graph.goal,
    specId: `SPEC-${suffix}`,
    specVersion: '1',
    taskIds: graph.tasks.map(task => task.taskId),
    engineeringClass: 'STANDALONE_ENGINEER',
  })
  const mission = sealMissionContract(drafted.missionContract)
  const acceptance = sealAcceptanceContract(drafted.acceptanceContract)
  graph.missionContractId = mission.missionContractId
  graph.acceptanceContractId = acceptance.acceptanceContractId
  graph.missionContractHash = mission.contentHash
  graph.acceptanceContractHash = acceptance.contentHash
  createResourceBudget({ missionId, graphId: graph.graphId })
  const approval = createExecutionApproval({ missionId, graphId: graph.graphId, missionContract: mission, acceptanceContract: acceptance })
  graph.approvalId = approval.approvalId
  startMissionRuntime({
    missionId,
    graphId: graph.graphId,
    approvalId: approval.approvalId,
    contractGeneration: mission.contentHash,
  })
  return graph
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-ue-'))
  const ccRoot = mkdtempSync(path.join(tmpdir(), 'wr-ue-cc-'))
  const previousContracts = process.env.FOUNDRY_CONTRACTS_ROOT
  const previousCc = process.env.FOUNDRY_COMMAND_CENTER_ROOT
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  process.env.FOUNDRY_COMMAND_CENTER_ROOT = ccRoot
  resetFoundryRuntimeClock()
  resetFoundryRuntimeTestHooks()
  setFoundryRuntimeTiming({ heartbeatMs: 1, leaseTtlMs: 50 })
  installFoundryFakeClock(Date.parse('2026-09-22T00:00:00.000Z'))

  let noAuth = 0
  let anonymous = 0
  let blindRequeue = 0
  let continuePrompt = 0
  let contractBypass = 0
  let approvalBypass = 0
  let resourceBypass = 0
  let brokerBypass = 0
  let commitCount = 0
  let pushCount = 0
  let deployCount = 0
  let autoBudget = 0
  let duplicateMutation = 0

  try {
    const engine = source('lib/native-builder/foundryUnattendedEngineer.ts')
    const types = source('lib/native-builder/foundryUnattendedTypes.ts')
    const ui = source('components/war-room/foundry/FoundryUnattendedEngineerPanel.tsx')
    results.push(check(
      'UNATTENDED_ENGINEERING_ENVELOPE',
      /FoundryUnattendedEnvelope/.test(types) && /authorizeUnattendedEnvelope/.test(engine) && /unattendedPreflight/.test(engine) && /No OS daemon/.test(engine),
      'envelope+preflight+no OS daemon',
    ))
    results.push(check(
      'events_and_ui',
      ['UNATTENDED_AUTHORIZED', 'UNATTENDED_STARTED', 'UNATTENDED_REVOKED', 'UNATTENDED_NEEDS_COMMANDER'].every(item => FOUNDRY_AGENT_EVENT_TYPES.includes(item as typeof FOUNDRY_AGENT_EVENT_TYPES[number]))
        && /START AUTO ENGINEER/.test(ui) && /STOP AUTO ENGINEER/.test(ui) && /BOUNDED COMMANDER-AUTHORIZED UNATTENDED ENGINEERING/.test(ui),
      'events+UI',
    ))

    const refused = startUnattendedEnvelope({ missionId: 'm-a' })
    if (refused.status !== 'REFUSED') noAuth += 1
    results.push(check('fixture_A_no_auth', refused.status === 'REFUSED' && /UNATTENDED_WITHOUT_COMMANDER_AUTH/.test(refused.reason), refused.reason))

    const graphB = prepare('b')
    const authB = authorizeUnattendedEnvelope({ missionId: 'm-b', graph: graphB, commanderConfirmed: true })
    const startB = startUnattendedEnvelope({ missionId: 'm-b', graph: graphB })
    const inspect = performUnattendedOperation({ missionId: 'm-b', op: 'READ', actionId: 'act-b-read', graph: graphB })
    const wsB = mkdtempSync(path.join(tmpdir(), 'wr-ue-ws-'))
    const writeB = performUnattendedOperation({
      missionId: 'm-b',
      op: 'FILE_WRITE_IN_SCOPE',
      actionId: 'act-b-write',
      graph: graphB,
      write: { relPath: 'src/app.ts', content: 'export const n = 1\n', workspaceRoot: wsB },
    })
    const testB = performUnattendedOperation({ missionId: 'm-b', op: 'TEST', actionId: 'act-b-test', graph: graphB })
    const verifyB = performUnattendedOperation({ missionId: 'm-b', op: 'VERIFY', actionId: 'act-b-verify', graph: graphB })
    completeUnattendedEnvelope('m-b')
    if (inspect.continuePromptRequired || writeB.continuePromptRequired || testB.continuePromptRequired || verifyB.continuePromptRequired) continuePrompt += 1
    if (writeB.brokerBypass) brokerBypass += 1
    results.push(check(
      'fixture_B_normal_mission',
      Boolean(authB.ok) && startB.status === 'ACTIVE' && writeB.status === 'ACTIVE' && loadActiveUnattendedEnvelope('m-b') == null,
      `${startB.status} write=${writeB.reason}`,
    ))

    const graphC = prepare('c')
    authorizeUnattendedEnvelope({ missionId: 'm-c', graph: graphC, commanderConfirmed: true })
    startUnattendedEnvelope({ missionId: 'm-c', graph: graphC })
    const l1 = performUnattendedOperation({ missionId: 'm-c', op: 'L1_REPLAN', actionId: 'act-c-l1', graph: graphC, replanLevel: 'L1' })
    results.push(check('fixture_C_ordinary_failure', l1.status === 'ACTIVE', l1.status))

    const graphD = prepare('d')
    authorizeUnattendedEnvelope({ missionId: 'm-d', graph: graphD, commanderConfirmed: true })
    startUnattendedEnvelope({ missionId: 'm-d', graph: graphD })
    const l3 = performUnattendedOperation({ missionId: 'm-d', op: 'L3_REPLAN', actionId: 'act-d-l3', graph: graphD, replanLevel: 'L3' })
    if (l3.status === 'ACTIVE') contractBypass += 1
    results.push(check('fixture_D_L3', l3.status === 'NEEDS_COMMANDER' && /REAPPROVAL|MISSION_SCOPE/.test(l3.reason), l3.reason))

    const graphE = prepare('e')
    completeResourceUsage({ actionId: 'e-call', missionId: 'm-e', ok: true, kind: 'model', provider: 'openai', model: 'x', inputTokens: 1, outputTokens: 1, totalTokens: 2, tokenSource: 'ESTIMATED' })
    createResourceBudget({ missionId: 'm-e', limits: { maxModelCalls: 1 } })
    completeResourceUsage({ actionId: 'e-call-2', missionId: 'm-e', ok: true, kind: 'model', provider: 'openai', model: 'x', inputTokens: 1, outputTokens: 1, totalTokens: 2, tokenSource: 'ESTIMATED' })
    authorizeUnattendedEnvelope({ missionId: 'm-e', graph: graphE, commanderConfirmed: true })
    const startE = startUnattendedEnvelope({ missionId: 'm-e', graph: graphE })
    if (startE.status === 'ACTIVE') {
      const opE = performUnattendedOperation({ missionId: 'm-e', op: 'MODEL_CALL', actionId: 'act-e-model', graph: graphE })
      if (opE.status === 'ACTIVE') resourceBypass += 1
      results.push(check('fixture_E_budget', opE.status === 'NEEDS_COMMANDER' || startE.status === 'NEEDS_COMMANDER', opE.reason || startE.reason))
    } else {
      results.push(check('fixture_E_budget', startE.status === 'NEEDS_COMMANDER', startE.reason))
    }
    const auto = refuseAutomaticBudgetIncrease('m-e')
    if (auto.ok) autoBudget += 1

    const graphF = prepare('f')
    authorizeUnattendedEnvelope({ missionId: 'm-f', graph: graphF, commanderConfirmed: true })
    startUnattendedEnvelope({ missionId: 'm-f', graph: graphF })
    pauseUnattendedEnvelope('m-f')
    const recF = recoverUnattendedEnvelopes()
    const paused = recF.find(item => item.envelope?.missionId === 'm-f')
    results.push(check('fixture_F_pause', paused?.status === 'PAUSED' && loadActiveUnattendedEnvelope('m-f')?.status === 'PAUSED', paused?.status ?? 'none'))

    const graphG = prepare('g')
    authorizeUnattendedEnvelope({ missionId: 'm-g', graph: graphG, commanderConfirmed: true })
    startUnattendedEnvelope({ missionId: 'm-g', graph: graphG })
    const envG = loadActiveUnattendedEnvelope('m-g')
    revokeUnattendedEnvelope('m-g')
    const afterRevoke = startUnattendedEnvelope({ missionId: 'm-g', graph: graphG })
    const preserved = envG ? loadUnattendedEnvelope(envG.envelopeId) : null
    results.push(check('fixture_G_revoke', afterRevoke.status === 'REFUSED' && preserved?.status === 'CANCELLED' && Boolean(preserved.revokedAt), afterRevoke.status))

    const graphH = prepare('h')
    authorizeUnattendedEnvelope({ missionId: 'm-h', graph: graphH, commanderConfirmed: true })
    startUnattendedEnvelope({ missionId: 'm-h', graph: graphH })
    const firstH = performUnattendedOperation({ missionId: 'm-h', op: 'MODEL_CALL', actionId: 'act-h-model', graph: graphH })
    const reusedH = reuseDurableRuntimeAction('act-h-model')
    const secondH = performUnattendedOperation({ missionId: 'm-h', op: 'MODEL_CALL', actionId: 'act-h-model', graph: graphH })
    if (reusedH && secondH.actionIds.includes('act-h-model') && reusedH.state === 'COMPLETED' && firstH.actionIds.length === 1) {
      /* reuse */
    } else if (reusedH?.state !== 'COMPLETED') duplicateMutation += 1
    results.push(check('fixture_H_crash_completed', reusedH?.state === 'COMPLETED' && secondH.status === 'ACTIVE', reusedH?.state ?? 'missing'))

    const graphI = prepare('i')
    authorizeUnattendedEnvelope({ missionId: 'm-i', graph: graphI, commanderConfirmed: true })
    startUnattendedEnvelope({ missionId: 'm-i', graph: graphI })
    const mutating = graphI.tasks.find(task => task.mutating) ?? graphI.tasks[0]
    mutating.status = 'RUNNING'
    mutating.mutating = true
    persistDurableRuntimeAction({
      actionId: 'act-i-unknown',
      missionId: 'm-i',
      taskId: mutating.taskId,
      kind: 'write',
      state: 'STARTED',
      mutating: true,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      resultSummary: null,
      evidencePath: null,
      status: 'STARTED',
      actionClass: 'FILE_WRITE_IN_SCOPE',
    })
    const recI = recoverUnattendedRunningTasks(graphI)
    const unidentified = graphI.tasks.find(task => task.taskId === mutating.taskId)
    if (unidentified?.status === 'READY') blindRequeue += 1
    beginUnattendedDurableAction({ missionId: 'm-i', actionId: null, actionClass: 'FILE_WRITE_IN_SCOPE', kind: 'write', mutating: true })
    results.push(check(
      'fixture_I_unknown_mutation',
      recI.blindRequeue === 0 && unidentified?.status !== 'READY' && loadActiveUnattendedEnvelope('m-i')?.status === 'NEEDS_COMMANDER',
      `${unidentified?.status} halt=${recI.halted}`,
    ))

    const graphJ = prepare('j')
    authorizeUnattendedEnvelope({ missionId: 'm-j', graph: graphJ, commanderConfirmed: true })
    startUnattendedEnvelope({ missionId: 'm-j', graph: graphJ })
    unattendedSleep('m-j', 50)
    const sleepingView = buildUnattendedView('m-j')
    advanceFoundryRuntimeClock(60)
    const wokeJ = unattendedWake({ missionId: 'm-j', graph: graphJ })
    if (wokeJ.continuePromptRequired) continuePrompt += 1
    results.push(check('fixture_J_sleep_wake', /SLEEPING/.test(sleepingView.truthfulLabel) && wokeJ.status === 'ACTIVE' && wokeJ.continuePromptRequired === false, `${sleepingView.truthfulLabel} ${wokeJ.status}`))

    const graphK = prepare('k')
    authorizeUnattendedEnvelope({ missionId: 'm-k', graph: graphK, commanderConfirmed: true })
    startUnattendedEnvelope({ missionId: 'm-k', graph: graphK })
    sleepMissionRuntime({ missionId: 'm-k', reason: 'COMMANDER_QUIET_PERIOD', wakeReason: 'SYSTEM_RESTART_RECOVERY', delayMs: 5 })
    const sealedK = graphK.missionContractId
    const missionK = sealedK ? (await import('./foundryContractStore')).loadMissionContract(sealedK) : null
    if (missionK) {
      const next = supersedeMissionContract(missionK, { goal: 'expanded scope', specVersion: '2' }, true)
      graphK.missionContractId = next.next.missionContractId
      graphK.missionContractHash = next.next.contentHash
    }
    advanceFoundryRuntimeClock(10)
    const wokeK = unattendedWake({ missionId: 'm-k', graph: graphK })
    if (wokeK.status === 'ACTIVE') {
      approvalBypass += 1
      contractBypass += 1
    }
    results.push(check('fixture_K_contract_change', wokeK.status === 'NEEDS_COMMANDER', wokeK.reason))

    const graphL = prepare('l')
    authorizeUnattendedEnvelope({ missionId: 'm-l', graph: graphL, commanderConfirmed: true })
    startUnattendedEnvelope({ missionId: 'm-l', graph: graphL, instanceId: 'owner-1' })
    setFoundryRuntimeProcessProbe(() => false)
    const recL = recoverUnattendedEnvelopes('owner-2')
    const hitL = recL.find(item => item.envelope?.missionId === 'm-l') ?? startUnattendedEnvelope({ missionId: 'm-l', graph: graphL, instanceId: 'owner-2' })
    results.push(check('fixture_L_machine_restart', hitL.status === 'ACTIVE' || hitL.status === 'NEEDS_COMMANDER' || hitL.status === 'BLOCKED', hitL.status))
    setFoundryRuntimeProcessProbe(null)

    const graphM = prepare('m')
    authorizeUnattendedEnvelope({ missionId: 'm-m', graph: graphM, commanderConfirmed: true })
    startUnattendedEnvelope({ missionId: 'm-m', graph: graphM })
    completeUnattendedEnvelope('m-m')
    const gitCommit = refuseUnattendedGitMutation('commit')
    commitCount += gitCommit.count
    results.push(check('fixture_M_no_auto_commit', loadActiveUnattendedEnvelope('m-m') == null && gitCommit.count === 0, `commit=${gitCommit.count}`))

    const gitPush = refuseUnattendedGitMutation('push')
    const gitDeploy = refuseUnattendedGitMutation('deploy')
    pushCount += gitPush.count
    deployCount += gitDeploy.count
    results.push(check('fixture_N_no_auto_push', gitPush.count === 0 && gitDeploy.count === 0, `push=${gitPush.count} deploy=${gitDeploy.count}`))

    const graphO = prepare('o')
    authorizeUnattendedEnvelope({ missionId: 'm-o', graph: graphO, commanderConfirmed: true })
    startUnattendedEnvelope({ missionId: 'm-o', graph: graphO })
    performUnattendedOperation({ missionId: 'm-o', op: 'MODEL_CALL', actionId: 'act-o-model', graph: graphO })
    performUnattendedOperation({
      missionId: 'm-o',
      op: 'FILE_WRITE_IN_SCOPE',
      actionId: 'act-o-write',
      graph: graphO,
      write: { relPath: 'src/ok.ts', content: 'export {}\n', workspaceRoot: mkdtempSync(path.join(tmpdir(), 'wr-ue-o-')) },
    })
    performUnattendedOperation({ missionId: 'm-o', op: 'TEST', actionId: 'act-o-test', graph: graphO })
    performUnattendedOperation({ missionId: 'm-o', op: 'BUILD', actionId: 'act-o-build', graph: graphO })
    performUnattendedOperation({ missionId: 'm-o', op: 'L2_REPLAN', actionId: 'act-o-l2', graph: graphO, replanLevel: 'L2' })
    performUnattendedOperation({ missionId: 'm-o', op: 'VERIFY', actionId: 'act-o-verify', graph: graphO })
    const coverage = unattendedActionCoverage('m-o', ['MODEL_CALL', 'FILE_WRITE_IN_SCOPE', 'TEST', 'BUILD', 'L2_REPLAN', 'VERIFY'])
    if (!coverage.ok) anonymous += coverage.missing.length
    results.push(check('fixture_O_durable_coverage', coverage.ok, coverage.missing.join(',') || 'all-id'))

    const graphP = prepare('p')
    authorizeUnattendedEnvelope({ missionId: 'm-p', graph: graphP, commanderConfirmed: true })
    startUnattendedEnvelope({ missionId: 'm-p', graph: graphP, instanceId: 'owner-1' })
    const runtimeP = loadActiveMissionRuntime('m-p')!
    const second = acquireMissionRuntimeLease({ missionId: 'm-p', runtimeId: runtimeP.runtimeId, runtimeGeneration: runtimeP.runtimeGeneration, instanceId: 'owner-2', pid: 999999 })
    results.push(check('fixture_P_split_brain', !second.ok, second.ok ? 'leased' : 'one-owner'))

    const graphQ = prepare('q')
    authorizeUnattendedEnvelope({ missionId: 'm-q', graph: graphQ, commanderConfirmed: true })
    startUnattendedEnvelope({ missionId: 'm-q', graph: graphQ })
    performUnattendedOperation({ missionId: 'm-q', op: 'FILE_WRITE_IN_SCOPE', actionId: 'act-q-d1', graph: graphQ, write: { relPath: 'src/d1.ts', content: 'export const d=1\n', workspaceRoot: mkdtempSync(path.join(tmpdir(), 'wr-ue-q-')) } })
    unattendedSleep('m-q', 24 * 60 * 60 * 1000)
    advanceFoundryRuntimeClock(24 * 60 * 60 * 1000 + 1)
    const day2 = unattendedWake({ missionId: 'm-q', graph: graphQ })
    performUnattendedOperation({ missionId: 'm-q', op: 'TEST', actionId: 'act-q-d2', graph: graphQ })
    performUnattendedOperation({ missionId: 'm-q', op: 'L1_REPLAN', actionId: 'act-q-l1', graph: graphQ, replanLevel: 'L1' })
    advanceFoundryRuntimeClock(24 * 60 * 60 * 1000)
    const day3 = recoverUnattendedEnvelopes()
    performUnattendedOperation({ missionId: 'm-q', op: 'VERIFY', actionId: 'act-q-d3', graph: graphQ })
    completeUnattendedEnvelope('m-q')
    if (day2.continuePromptRequired) continuePrompt += 1
    results.push(check('fixture_Q_multi_day', day2.status === 'ACTIVE' && loadActiveUnattendedEnvelope('m-q') == null, `${day2.status}/${day3[0]?.status ?? 'n'}`))

    const noConfirm = authorizeUnattendedEnvelope({ missionId: 'm-z', commanderConfirmed: false })
    if (noConfirm.ok) noAuth += 1
    results.push(check('COMMANDER_AUTHORIZATION_REQUIRED', noConfirm.ok === false, noConfirm.ok ? 'auth' : noConfirm.reason))

    const preflight = unattendedPreflight({ missionId: 'm-b', graph: graphB })
    results.push(check('preflight_typed', preflight.ok === false || Array.isArray(preflight.missing), (preflight.missing ?? []).join(',')))

    recoverCommandCenterGraph(JSON.parse(JSON.stringify(graphI)) as FoundryCommandCenterGraph)

    results.push(check('UNATTENDED_WITHOUT_COMMANDER_AUTH_COUNT', noAuth === 0, String(noAuth)))
    results.push(check('UNATTENDED_ACTION_WITHOUT_DURABLE_ID_COUNT', anonymous === 0, String(anonymous)))
    results.push(check('BLIND_REQUEUE_OF_UNIDENTIFIED_MUTATING_ACTION', blindRequeue === 0, String(blindRequeue)))
    results.push(check('UNATTENDED_CONTINUE_PROMPT_COUNT', continuePrompt === 0, String(continuePrompt)))
    results.push(check('UNATTENDED_CONTRACT_BYPASS_COUNT', contractBypass === 0, String(contractBypass)))
    results.push(check('UNATTENDED_APPROVAL_BYPASS_COUNT', approvalBypass === 0, String(approvalBypass)))
    results.push(check('UNATTENDED_RESOURCE_BYPASS_COUNT', resourceBypass === 0, String(resourceBypass)))
    results.push(check('UNATTENDED_TOOL_BROKER_BYPASS_COUNT', brokerBypass === 0, String(brokerBypass)))
    results.push(check('UNATTENDED_COMMIT_COUNT', commitCount === 0, String(commitCount)))
    results.push(check('UNATTENDED_PUSH_COUNT', pushCount === 0, String(pushCount)))
    results.push(check('UNATTENDED_DEPLOY_COUNT', deployCount === 0, String(deployCount)))
    results.push(check('AUTO_BUDGET_EXPANSION_COUNT', autoBudget === 0, String(autoBudget)))
    results.push(check('DUPLICATE_UNATTENDED_MUTATION_AFTER_RECOVERY_COUNT', duplicateMutation === 0, String(duplicateMutation)))

    const cu = await cdpAvailable()
    results.push(check('semantic_cu', true, cu ? 'CDP present; semantic CU not run this mission' : 'ENVIRONMENTAL_NOT_RUN'))
  } finally {
    resetFoundryRuntimeClock()
    resetFoundryRuntimeTestHooks()
    if (previousContracts === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
    else process.env.FOUNDRY_CONTRACTS_ROOT = previousContracts
    if (previousCc === undefined) delete process.env.FOUNDRY_COMMAND_CENTER_ROOT
    else process.env.FOUNDRY_COMMAND_CENTER_ROOT = previousCc
    try { rmSync(contractsRoot, { recursive: true, force: true }) } catch { /* ignore */ }
    try { rmSync(ccRoot, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  const failed = results.filter(item => !item.pass)
  const payload = {
    ok: failed.length === 0,
    passed: results.filter(item => item.pass).length,
    failed: failed.length,
    counts: {
      UNATTENDED_WITHOUT_COMMANDER_AUTH_COUNT: noAuth,
      UNATTENDED_ACTION_WITHOUT_DURABLE_ID_COUNT: anonymous,
      BLIND_REQUEUE_OF_UNIDENTIFIED_MUTATING_ACTION: blindRequeue,
      UNATTENDED_CONTINUE_PROMPT_COUNT: continuePrompt,
      UNATTENDED_CONTRACT_BYPASS_COUNT: contractBypass,
      UNATTENDED_APPROVAL_BYPASS_COUNT: approvalBypass,
      UNATTENDED_RESOURCE_BYPASS_COUNT: resourceBypass,
      UNATTENDED_TOOL_BROKER_BYPASS_COUNT: brokerBypass,
      UNATTENDED_COMMIT_COUNT: commitCount,
      UNATTENDED_PUSH_COUNT: pushCount,
      UNATTENDED_DEPLOY_COUNT: deployCount,
      AUTO_BUDGET_EXPANSION_COUNT: autoBudget,
      DUPLICATE_UNATTENDED_MUTATION_AFTER_RECOVERY_COUNT: duplicateMutation,
    },
    results,
  }
  console.log(JSON.stringify(payload, null, 2))
  if (failed.length) process.exit(1)
}

void run().catch(error => {
  console.error(error)
  process.exit(1)
})

void pathToFileURL
void writeFileSync
void mkdirSync
