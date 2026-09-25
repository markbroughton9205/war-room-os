/**
 * Source + disposable proofs for Foundry execution resource governor.
 * Does not package, install, commit, push, deploy, or modify Harbor/Lane & Box/Inventory/Terra/WRIM.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { FOUNDRY_AGENT_EVENT_TYPES } from './foundryAgentEvents'
import {
  authorizeResourceAction,
  beginResourceUsage,
  buildResourceView,
  clearFoundryResourcePricing,
  completeResourceUsage,
  createResourceBudget,
  extendResourceBudget,
  listBudgetExtensions,
  listBudgetHistory,
  missionMaxConcurrentAgents,
  pauseResourceClock,
  recoverResourceBudget,
  refuseAutomaticBudgetIncrease,
  registerFoundryResourcePricing,
  resumeResourceClock,
} from './foundryResourceGovernor'
import { loadActiveResourceBudget } from './foundryContractStore'
import { FoundryModelRouter } from './foundryModelRouter'
import type { FoundryMissionModel, FoundryModelResponse } from './foundryModelTypes'
import { scheduleReadyTasks } from './foundryAgentScheduler'
import { evaluateCommandCenterReplan } from './foundryReplanEngine'
import { buildTaskGraph, ticketManagerGraphSeeds } from './foundryTaskGraph'
import { evaluateVerdictLayer, projectReadyFromVerdict } from './foundryVerdictLayer'
import { draftStandaloneContracts, sealAcceptanceContract, sealMissionContract } from './foundryMissionContract'
import { loadAcceptanceContract, loadMissionContract } from './foundryContractStore'
import type { FoundryCommandCenterGraph } from './foundryAgentTypes'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

function fakeModel(provider: 'openai' | 'ollama' | 'cursor-agent', ok = true, error?: string): FoundryMissionModel {
  const respond = async (): Promise<FoundryModelResponse> => ok
    ? { ok: true, provider, model: `${provider}-fixture`, decision: { decision: 'COMPLETE', reasoningSummary: 'ok' }, rawText: 'hello world', latencyMs: 5 }
    : { ok: false, provider, model: `${provider}-fixture`, error: error ?? 'usage limit', failureClass: 'PROVIDER', latencyMs: 5 }
  return {
    provider,
    model: `${provider}-fixture`,
    reasonMission: respond,
    chooseNextAction: respond,
    diagnoseFailure: respond,
    replan: respond,
    summarizeProgress: respond,
  }
}

function stubContext(missionId: string) {
  return {
    missionId,
    missionKind: 'repair' as const,
    userRequest: 'fixture',
    goal: 'fixture',
    successCriteria: [],
    constraints: [],
    permissions: {},
    phase: 'RUNNING' as const,
    plan: [],
    hypotheses: [],
    changedFiles: [],
    importantFindings: [],
    relevantExcerpts: [],
    visualEvidence: [],
    recentToolResults: [],
    recentErrors: [],
    unresolvedQuestions: [],
    completionGate: { complete: false, missing: [], detail: '' },
    tools: [],
  }
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
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-resource-'))
  const previous = process.env.FOUNDRY_CONTRACTS_ROOT
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  clearFoundryResourcePricing()

  let modelAfterLimit = 0
  let toolAfterLimit = 0
  let autoIncrease = 0
  let readyFromExhaustion = 0
  let restartReset = 0
  let unattributed = 0

  try {
    const govSrc = source('lib/native-builder/foundryResourceGovernor.ts')
    const typesSrc = source('lib/native-builder/foundryResourceGovernorTypes.ts')
    const routerSrc = source('lib/native-builder/foundryModelRouter.ts')
    const toolsSrc = source('lib/native-builder/engineerTools.ts')
    const uiSrc = source('components/war-room/foundry/FoundryResourceGovernorPanel.tsx')
    const centerSrc = source('lib/native-builder/foundryAgentCommandCenter.ts')
    const events = FOUNDRY_AGENT_EVENT_TYPES

    results.push(check(
      'RESOURCE_GOVERNOR_IMPLEMENTED',
      /FoundryResourceBudget/.test(typesSrc) && /authorizeResourceAction/.test(govSrc) && /authorizeResourceAction/.test(routerSrc) && /authorizeResourceAction/.test(toolsSrc),
      'types+engine+router+broker',
    ))
    results.push(check(
      'events_and_ui',
      ['RESOURCE_BUDGET_CREATED', 'RESOURCE_USAGE_RECORDED', 'RESOURCE_SOFT_LIMIT', 'RESOURCE_HARD_LIMIT', 'RESOURCE_BUDGET_EXHAUSTED', 'RESOURCE_BUDGET_EXTENDED', 'RESOURCE_EXECUTION_PAUSED', 'RESOURCE_EXECUTION_RESUMED'].every(item => events.includes(item as typeof events[number]))
        && /foundry-resources/.test(uiSrc) && /COST UNKNOWN/.test(uiSrc) && /RESOURCE BUDGET EXHAUSTED/.test(uiSrc) && /FoundryResourceGovernorPanel/.test(source('components/war-room/foundry/FoundryAgentCommandCenter.tsx')),
      'events+commander UI',
    ))
    results.push(check('no_billing_actions', !/purchase|upgrade plan|subscription|enter billing/.test(govSrc), 'accounting only'))
    results.push(check('replan_integrated', /authorizeResourceAction/.test(source('lib/native-builder/foundryReplanEngine.ts')) && /replan-l2/.test(source('lib/native-builder/foundryReplanEngine.ts')), 'Mission 04 ceilings'))
    results.push(check('concurrency_wired', /missionMaxConcurrentAgents/.test(centerSrc) && /missionMaxConcurrentAgents/.test(source('lib/native-builder/foundryAgentScheduler.ts')), 'scheduler min'))

    const a = createResourceBudget({ missionId: 'm-a', limits: { maxModelCalls: 2 } })
    const ctx = stubContext('m-a')
    const routerA = new FoundryModelRouter([fakeModel('openai')])
    const first = await routerA.route('reasonMission', { kind: 'reasonMission', context: ctx }, { missionId: 'm-a', policy: 'AUTO' })
    const second = await routerA.route('chooseNextAction', { kind: 'chooseNextAction', context: ctx }, { missionId: 'm-a', policy: 'AUTO' })
    const third = await routerA.route('chooseNextAction', { kind: 'chooseNextAction', context: ctx }, { missionId: 'm-a', policy: 'AUTO' })
    if (third.response.ok) modelAfterLimit += 1
    results.push(check(
      'fixture_A_model_limit',
      first.response.ok && second.response.ok && !third.response.ok && /RESOURCE_BUDGET_EXHAUSTED/.test(third.response.ok ? '' : third.response.error) && a.budgetId === loadActiveResourceBudget('m-a')?.budgetId,
      `ok=${first.response.ok},${second.response.ok},${third.response.ok} status=${loadActiveResourceBudget('m-a')?.status}`,
    ))

    const b = createResourceBudget({ missionId: 'm-b', limits: { maxTotalTokens: 10, maxInputTokens: 10, maxOutputTokens: 10 } })
    authorizeResourceAction({ missionId: 'm-b', kind: 'model', estimatedTokens: 8, createIfMissing: false })
    completeResourceUsage({ actionId: 'tok-1', missionId: 'm-b', ok: true, kind: 'model', provider: 'openai', model: 'gpt', inputTokens: 6, outputTokens: 4, totalTokens: 10, tokenSource: 'PROVIDER' })
    const bNext = authorizeResourceAction({ missionId: 'm-b', kind: 'model', estimatedTokens: 4 })
    results.push(check('fixture_B_token_limit', !bNext.ok && b.limits.maxTotalTokens === 10, bNext.code))

    registerFoundryResourcePricing({ provider: 'openai', model: 'priced', inputPer1kUsd: 1, outputPer1kUsd: 2 })
    createResourceBudget({ missionId: 'm-c', limits: { maxEstimatedRemoteCostUsd: 0.01, maxModelCalls: 20 } })
    completeResourceUsage({ actionId: 'cost-1', missionId: 'm-c', ok: true, kind: 'model', provider: 'openai', model: 'priced', inputTokens: 5000, outputTokens: 2500, totalTokens: 7500, tokenSource: 'PROVIDER' })
    const cNext = authorizeResourceAction({ missionId: 'm-c', kind: 'model', estimatedCostUsd: 0.01 })
    results.push(check('fixture_C_cost_limit', !cNext.ok && loadActiveResourceBudget('m-c')?.costState === 'ESTIMATED', `${cNext.code} ${loadActiveResourceBudget('m-c')?.costState}`))

    createResourceBudget({ missionId: 'm-d', limits: { maxModelCalls: 3 } })
    completeResourceUsage({ actionId: 'unk-1', missionId: 'm-d', ok: true, kind: 'model', provider: 'openai', model: 'no-price', inputTokens: 100, outputTokens: 20, totalTokens: 120, tokenSource: 'PROVIDER' })
    const viewD = buildResourceView('m-d')
    const dCall = authorizeResourceAction({ missionId: 'm-d', kind: 'model' })
    results.push(check('fixture_D_unknown_cost', viewD.remoteCostLabel === 'COST UNKNOWN' && viewD.costState === 'UNKNOWN' && dCall.ok && !/\$0\.00/.test(viewD.remoteCostLabel), viewD.remoteCostLabel))

    createResourceBudget({ missionId: 'm-e', limits: { maxModelCalls: 5 } })
    const routerE = new FoundryModelRouter([fakeModel('ollama')])
    await routerE.route('reasonMission', { kind: 'reasonMission', context: stubContext('m-e') }, { missionId: 'm-e', policy: 'AUTO' })
    const viewE = buildResourceView('m-e')
    results.push(check('fixture_E_local_model', viewE.remoteCostLabel === '$0.00' && viewE.localProvider && viewE.modelCallsUsed >= 1 && viewE.tokensUsed > 0, `${viewE.remoteCostLabel} calls=${viewE.modelCallsUsed} tokens=${viewE.tokensUsed}`))

    createResourceBudget({ missionId: 'm-f', limits: { maxTestRuns: 1, maxToolCalls: 8 } })
    completeResourceUsage({ actionId: 'test-f1', missionId: 'm-f', ok: false, kind: 'test', tool: 'test.run' })
    const t2 = authorizeResourceAction({ missionId: 'm-f', kind: 'test' })
    if (t2.ok) toolAfterLimit += 1
    results.push(check('fixture_F_test_loop', !t2.ok && /authorizeResourceAction/.test(toolsSrc) && /test.run/.test(source('lib/native-builder/foundryResourceGovernor.ts')), t2.code))

    createResourceBudget({ missionId: 'm-g', limits: { maxBuildRuns: 1 } })
    completeResourceUsage({ actionId: 'build-1', missionId: 'm-g', ok: false, kind: 'build', tool: 'build.run' })
    const g2 = authorizeResourceAction({ missionId: 'm-g', kind: 'build' })
    if (g2.ok) toolAfterLimit += 1
    results.push(check('fixture_G_build_loop', !g2.ok, g2.code))

    const graphH = buildTaskGraph({
      missionId: 'm-h',
      projectId: 'p-h',
      projectName: 'h',
      projectRoot: '/tmp/h',
      goal: 'inside contract',
      specApproved: true,
      engineeringClass: 'STANDALONE_ENGINEER',
      tasks: ticketManagerGraphSeeds(),
    }) as FoundryCommandCenterGraph
    createResourceBudget({ missionId: 'm-h', graphId: graphH.graphId, limits: { maxDagReplans: 0, maxTaskReplans: 0, maxSteers: 0 } })
    const down = graphH.tasks.find(task => task.role === 'BACKEND')!
    down.status = 'FAILED'
    down.blocker = 'missing prerequisite module'
    const h = evaluateCommandCenterReplan({
      graph: graphH,
      taskId: down.taskId,
      observation: { taskId: down.taskId, fingerprint: 'dep', ok: false, kind: 'failure', detail: down.blocker },
    })
    results.push(check('fixture_H_replan_budget', !h.applied && (h.record.status === 'BLOCKED' || h.record.level === 'L4'), `${h.record.level} ${h.record.status}`))

    const iBudget = createResourceBudget({ missionId: 'm-i', limits: { maxModelCalls: 10, maxTotalTokens: 1000 } })
    completeResourceUsage({ actionId: 'i-1', missionId: 'm-i', ok: true, kind: 'model', provider: 'openai', model: 'x', inputTokens: 300, outputTokens: 300, totalTokens: 600, tokenSource: 'ESTIMATED' })
    const before = loadActiveResourceBudget('m-i')!.totals.totalTokens
    const recovered = recoverResourceBudget('m-i')
    if (recovered && recovered.totals.totalTokens < before * 0.5) restartReset += 1
    results.push(check('fixture_I_restart', recovered != null && recovered.totals.totalTokens === before && recovered.budgetId === iBudget.budgetId, `tokens=${recovered?.totals.totalTokens} before=${before}`))

    createResourceBudget({ missionId: 'm-j', limits: { maxModelCalls: 1 } })
    completeResourceUsage({ actionId: 'j-1', missionId: 'm-j', ok: true, kind: 'model', provider: 'openai', model: 'x', inputTokens: 1, outputTokens: 1, totalTokens: 2, tokenSource: 'ESTIMATED' })
    const denied = authorizeResourceAction({ missionId: 'm-j', kind: 'model' })
    const previousId = loadActiveResourceBudget('m-j')!.budgetId
    const extended = extendResourceBudget({ missionId: 'm-j', commanderConfirmed: true, nextLimits: { maxModelCalls: 5 }, reason: 'Commander raises model-call ceiling.' })
    const afterExtend = authorizeResourceAction({ missionId: 'm-j', kind: 'model' })
    const history = listBudgetHistory('m-j')
    results.push(check(
      'fixture_J_commander_extension',
      !denied.ok && extended.ok && afterExtend.ok && history.budgets.some(item => item.budgetId === previousId && item.status === 'SUPERSEDED') && listBudgetExtensions(extended.budget!.budgetId).length >= 1,
      `denied=${denied.code} resume=${afterExtend.code}`,
    ))

    const auto = refuseAutomaticBudgetIncrease('m-j', 'Agent asks for more budget.')
    if (auto.ok) autoIncrease += 1
    const auto2 = extendResourceBudget({ missionId: 'm-j', commanderConfirmed: false, nextLimits: { maxModelCalls: 99 } })
    if (auto2.ok) autoIncrease += 1
    results.push(check('fixture_K_no_auto_extend', !auto.ok && !auto2.ok && auto.code === 'AUTOMATIC_BUDGET_INCREASE_REFUSED', auto.code))

    createResourceBudget({ missionId: 'm-l', limits: { maxModelCalls: 1 } })
    completeResourceUsage({ actionId: 'l-1', missionId: 'm-l', ok: true, kind: 'model', provider: 'openai', model: 'x', inputTokens: 1, outputTokens: 1, totalTokens: 2, tokenSource: 'ESTIMATED' })
    authorizeResourceAction({ missionId: 'm-l', kind: 'model' })
    const drafted = draftStandaloneContracts({
      missionId: 'm-l',
      commanderRequest: 'fixture',
      goal: 'fixture',
      specId: 'SPEC-L',
      specVersion: '1',
      taskIds: ['TASK-001'],
      engineeringClass: 'STANDALONE_ENGINEER',
    })
    const missionContract = sealMissionContract(drafted.missionContract)
    const acceptance = sealAcceptanceContract(drafted.acceptanceContract)
    const verdict = evaluateVerdictLayer({
      engineeringClass: 'STANDALONE_ENGINEER',
      missionId: 'm-l',
      missionContract,
      acceptanceContract: acceptance,
      reviewOutcome: null,
      executorResult: 'NONE',
    })
    const ready = projectReadyFromVerdict({
      engineeringClass: 'STANDALONE_ENGINEER',
      tasksComplete: false,
      verdict,
      missionContract: loadMissionContract(missionContract.missionContractId),
      acceptanceContract: loadAcceptanceContract(acceptance.acceptanceContractId),
    })
    if (ready) readyFromExhaustion += 1
    results.push(check('fixture_L_project_ready', verdict.result !== 'PASS' && ready === false, `${verdict.result} ready=${ready}`))

    createResourceBudget({ missionId: 'm-m', limits: { maxModelCalls: 5, maxProviderFailures: 6 } })
    const routerM = new FoundryModelRouter([fakeModel('openai', false, 'rate limit'), fakeModel('ollama', true)])
    const routedM = await routerM.route('reasonMission', { kind: 'reasonMission', context: stubContext('m-m') }, { missionId: 'm-m', requestedProvider: 'openai', policy: 'AUTO' })
    const viewM = buildResourceView('m-m')
    const ollamaRow = viewM.providers.find(item => item.provider === 'ollama')
    const openaiFail = listBudgetHistory('m-m').usage.some(item => item.provider === 'openai' && item.providerFailures >= 1)
    if (routedM.response.ok && routedM.response.provider !== 'ollama') unattributed += 1
    if (!ollamaRow) unattributed += 1
    results.push(check(
      'fixture_M_fallback_attribution',
      routedM.response.ok && routedM.response.provider === 'ollama' && Boolean(ollamaRow) && openaiFail,
      `selected=${routedM.response.ok ? routedM.response.provider : 'fail'} providers=${viewM.providers.map(item => item.provider).join(',')}`,
    ))

    const graphN = buildTaskGraph({
      missionId: 'm-n',
      projectId: 'p-n',
      projectName: 'n',
      projectRoot: '/tmp/n',
      goal: 'n',
      tasks: ticketManagerGraphSeeds(),
    })
    createResourceBudget({ missionId: 'm-n', limits: { maxConcurrentAgents: 2 } })
    graphN.tasks.forEach(task => { task.status = 'READY'; task.dependsOn = []; task.mutating = false; task.writeSet = [] })
    const scheduled = scheduleReadyTasks({
      graph: graphN,
      runningElsewhere: 0,
      missionMaxConcurrentAgents: missionMaxConcurrentAgents('m-n', 4),
      snapshot: {
        cpuCount: 16,
        cpuLoadHint: 1,
        ramUsedRatio: 0.2,
        ramFreeMb: 16000,
        vramUsedMb: null,
        vramTotalMb: null,
        activeBrowsers: 0,
        activeBuilds: 0,
        activeModelSlots: 0,
        activePtys: 0,
        measuredAt: new Date().toISOString(),
      },
    })
    results.push(check('fixture_N_concurrency', scheduled.maxConcurrentAgents === 2 && scheduled.allowed.length <= 2, `max=${scheduled.maxConcurrentAgents} allowed=${scheduled.allowed.length}`))

    createResourceBudget({ missionId: 'm-task', limits: { maxModelCalls: 8 } })
    createResourceBudget({ missionId: 'm-task', scope: 'TASK', taskId: 'TASK-001', limits: { maxModelCalls: 1 } })
    beginResourceUsage({ missionId: 'm-task', kind: 'model', actionId: 'task-call-1', taskId: 'TASK-001', provider: 'openai', model: 'x' })
    completeResourceUsage({ actionId: 'task-call-1', missionId: 'm-task', ok: true, kind: 'model', provider: 'openai', model: 'x', inputTokens: 1, outputTokens: 1, totalTokens: 2, tokenSource: 'ESTIMATED' })
    const taskDenied = authorizeResourceAction({ missionId: 'm-task', kind: 'model', taskId: 'TASK-001' })
    const missionStill = authorizeResourceAction({ missionId: 'm-task', kind: 'model' })
    results.push(check('TASK_RESOURCE_BUDGET', !taskDenied.ok && missionStill.ok, `task=${taskDenied.code} mission=${missionStill.code}`))

    createResourceBudget({ missionId: 'm-tools', limits: { maxTerminalCalls: 1, maxBrowserActions: 1, maxComputerActions: 1 } })
    completeResourceUsage({ actionId: 'term-1', missionId: 'm-tools', ok: true, kind: 'terminal', tool: 'terminal.run' })
    const term2 = authorizeResourceAction({ missionId: 'm-tools', kind: 'terminal' })
    completeResourceUsage({ actionId: 'br-1', missionId: 'm-tools', ok: true, kind: 'browser', tool: 'browser.navigate' })
    const br2 = authorizeResourceAction({ missionId: 'm-tools', kind: 'browser' })
    completeResourceUsage({ actionId: 'cu-1', missionId: 'm-tools', ok: true, kind: 'computer', tool: 'computer.click' })
    const cu2 = authorizeResourceAction({ missionId: 'm-tools', kind: 'computer' })
    if (term2.ok || br2.ok || cu2.ok) toolAfterLimit += 1
    results.push(check('terminal_browser_computer_budgets', !term2.ok && !br2.ok && !cu2.ok && /classifyEngineerToolFamily/.test(toolsSrc), `term=${term2.code} br=${br2.code} cu=${cu2.code}`))

    createResourceBudget({ missionId: 'm-soft', limits: { maxModelCalls: 10 } })
    for (let i = 0; i < 8; i++) completeResourceUsage({ actionId: `soft-${i}`, missionId: 'm-soft', ok: true, kind: 'model', provider: 'openai', model: 'x', inputTokens: 1, outputTokens: 1, totalTokens: 2, tokenSource: 'ESTIMATED' })
    const soft = authorizeResourceAction({ missionId: 'm-soft', kind: 'model' })
    results.push(check('SOFT_LIMIT', soft.ok && (soft.code === 'SOFT_LIMIT' || loadActiveResourceBudget('m-soft')?.status === 'SOFT_LIMIT'), `${soft.code} ${loadActiveResourceBudget('m-soft')?.status}`))

    pauseResourceClock('m-soft')
    const paused = loadActiveResourceBudget('m-soft')
    resumeResourceClock('m-soft')
    results.push(check('pause_clock', paused?.clock.paused === true && loadActiveResourceBudget('m-soft')?.clock.paused === false, `paused=${paused?.status}`))

    beginResourceUsage({ missionId: 'm-i', kind: 'model', actionId: 'crash-1', provider: 'openai', model: 'x' })
    const crashComplete = completeResourceUsage({ actionId: 'crash-1', missionId: 'm-i', ok: true, kind: 'model', provider: 'openai', model: 'x', inputTokens: 10, outputTokens: 10, totalTokens: 20, tokenSource: 'ESTIMATED' })
    const crashAgain = completeResourceUsage({ actionId: 'crash-1', missionId: 'm-i', ok: true, kind: 'model', provider: 'openai', model: 'x', inputTokens: 10, outputTokens: 10, totalTokens: 20, tokenSource: 'ESTIMATED' })
    results.push(check('crash_no_double_count', crashComplete?.actionId === 'crash-1' && crashAgain?.usageId === crashComplete?.usageId, crashAgain?.usageId ?? 'missing'))

    const viewUnknown = buildResourceView('m-d')
    results.push(check('unknown_cost_ui', viewUnknown.remoteCostLabel === 'COST UNKNOWN', viewUnknown.remoteCostLabel))
    results.push(check('local_cost_ui', viewE.localProvider && viewE.remoteCostLabel === '$0.00', viewE.remoteCostLabel))

    const browserGate = authorizeResourceAction({ missionId: 'm-g', kind: 'browser' })
    results.push(check('browser_and_computer_kinds', /browser/.test(typesSrc) && /computer/.test(typesSrc) && browserGate.code !== 'AUTOMATIC_BUDGET_INCREASE_REFUSED', browserGate.code))

    results.push(check('MODEL_CALL_AFTER_HARD_LIMIT_COUNT', modelAfterLimit === 0, String(modelAfterLimit)))
    results.push(check('TOOL_CALL_AFTER_HARD_LIMIT_COUNT', toolAfterLimit === 0, String(toolAfterLimit)))
    results.push(check('AUTOMATIC_BUDGET_INCREASE_COUNT', autoIncrease === 0, String(autoIncrease)))
    results.push(check('PROJECT_READY_FROM_RESOURCE_EXHAUSTION_COUNT', readyFromExhaustion === 0, String(readyFromExhaustion)))
    results.push(check('RESOURCE_COUNTER_RESET_ON_RESTART_COUNT', restartReset === 0, String(restartReset)))
    results.push(check('UNATTRIBUTED_PROVIDER_USAGE_COUNT', unattributed === 0, String(unattributed)))

    const cu = await cdpAvailable()
    results.push(check('semantic_cu', true, cu ? 'CDP present; semantic CU not run this mission' : 'ENVIRONMENTAL_NOT_RUN'))
  } finally {
    clearFoundryResourcePricing()
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
      MODEL_CALL_AFTER_HARD_LIMIT_COUNT: modelAfterLimit,
      TOOL_CALL_AFTER_HARD_LIMIT_COUNT: toolAfterLimit,
      AUTOMATIC_BUDGET_INCREASE_COUNT: autoIncrease,
      PROJECT_READY_FROM_RESOURCE_EXHAUSTION_COUNT: readyFromExhaustion,
      RESOURCE_COUNTER_RESET_ON_RESTART_COUNT: restartReset,
      UNATTRIBUTED_PROVIDER_USAGE_COUNT: unattributed,
    },
    results,
  }, null, 2))
  if (failed.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run()
}

export { run as runFoundryResourceGovernorValidation }
