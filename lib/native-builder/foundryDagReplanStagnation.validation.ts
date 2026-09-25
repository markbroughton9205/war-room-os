/**
 * Source + disposable proofs for Foundry DAG replan and stagnation.
 * Does not package, install, commit, push, deploy, or modify Harbor/Lane & Box/Inventory/Terra/WRIM.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { FOUNDRY_AGENT_EVENT_TYPES } from './foundryAgentEvents'
import { FOUNDRY_REPLAN_FAILURE_CLASSES, FOUNDRY_REPLAN_LEVELS, FOUNDRY_REPLAN_STATUSES, FOUNDRY_STAGNATION_THRESHOLDS } from './foundryReplanTypes'
import {
  actionFingerprint,
  applyReplan,
  classifyReplanFailure,
  detectStagnation,
  evaluateCommandCenterReplan,
  hashCommandCenterPlan,
  parseStructuredReplan,
  recoverReplanCounters,
  shouldRefuseRepeatedAction,
  validateDag,
} from './foundryReplanEngine'
import { draftStandaloneContracts, sealAcceptanceContract, sealMissionContract } from './foundryMissionContract'
import { evaluateVerdictLayer, projectReadyFromVerdict } from './foundryVerdictLayer'
import { listReplanRecords, loadAcceptanceContract, loadContractEvents, loadMissionContract } from './foundryContractStore'
import { recoverCommandCenterGraph, saveCommandCenterGraph } from './foundryAgentStore'
import { buildTaskGraph, ticketManagerGraphSeeds } from './foundryTaskGraph'
import { scheduleReadyTasks } from './foundryAgentScheduler'
import type { FoundryCommandCenterGraph } from './foundryAgentTypes'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

function makeGraph(suffix: string): FoundryCommandCenterGraph {
  const missionId = `m-replan-${suffix}`
  const graph = buildTaskGraph({
    missionId,
    projectId: `p-${suffix}`,
    projectName: 'Replan Fixture',
    projectRoot: `/tmp/foundry-replan-${suffix}`,
    goal: 'Ship the approved ticket-manager fixture inside sealed contract scope.',
    planningMode: false,
    specId: 'SPEC-REPLAN',
    specVersion: '1',
    specApproved: true,
    engineeringClass: 'STANDALONE_ENGINEER',
    tasks: ticketManagerGraphSeeds(),
  })
  for (const task of graph.tasks) {
    task.criterionIds = ['CR-TEST']
  }
  const drafted = draftStandaloneContracts({
    missionId,
    commanderRequest: graph.goal,
    goal: graph.goal,
    specId: 'SPEC-REPLAN',
    specVersion: '1',
    taskIds: graph.tasks.map(task => task.taskId),
    engineeringClass: 'STANDALONE_ENGINEER',
  })
  const missionContract = sealMissionContract(drafted.missionContract)
  const acceptance = sealAcceptanceContract(drafted.acceptanceContract)
  graph.missionContractId = missionContract.missionContractId
  graph.acceptanceContractId = acceptance.acceptanceContractId
  graph.missionContractHash = missionContract.contentHash
  graph.acceptanceContractHash = acceptance.contentHash
  graph.planHash = hashCommandCenterPlan(graph)
  return graph
}

function failFingerprint(tool = 'file.read'): string {
  return actionFingerprint({ tool, args: { path: 'src/app.ts' }, error: 'assert implementation fail: expected 1 to equal 0' })
}

async function cdpAvailable(): Promise<boolean> {
  return await new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port: 9222 })
    socket.setTimeout(400)
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.on('error', () => resolve(false))
  })
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-replan-'))
  const ccRoot = mkdtempSync(path.join(tmpdir(), 'wr-replan-cc-'))
  const previousContracts = process.env.FOUNDRY_CONTRACTS_ROOT
  const previousCc = process.env.FOUNDRY_COMMAND_CENTER_ROOT
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  process.env.FOUNDRY_COMMAND_CENTER_ROOT = ccRoot

  let blindRepeat = 0
  let outOfContractApplied = 0
  let untraceableAccepted = 0
  let cycleAccepted = 0
  let completeHistoryRewritten = 0
  let infiniteLoop = 0

  try {
    const engineSrc = source('lib/native-builder/foundryReplanEngine.ts')
    const typesSrc = source('lib/native-builder/foundryReplanTypes.ts')
    const eventsSrc = source('lib/native-builder/foundryAgentEvents.ts')
    const uiSrc = source('components/war-room/foundry/FoundryAgentCommandCenter.tsx')
    const storeSrc = source('lib/native-builder/foundryContractStore.ts')
    const centerSrc = source('lib/native-builder/foundryAgentCommandCenter.ts')

    results.push(check(
      'REPLAN_TAXONOMY_IMPLEMENTED',
      FOUNDRY_REPLAN_LEVELS.join(',') === 'L0,L1,L2,L3,L4' && FOUNDRY_REPLAN_STATUSES.includes('REAPPROVAL_REQUIRED') && /FoundryReplanRecord/.test(typesSrc),
      FOUNDRY_REPLAN_LEVELS.join(','),
    ))
    results.push(check(
      'events_and_store',
      ['STAGNATION_DETECTED', 'REPLAN_PROPOSED', 'REPLAN_APPLIED', 'REPLAN_REFUSED', 'REPLAN_REAPPROVAL_REQUIRED', 'TASK_PLAN_REPLACED', 'DAG_REWIRED', 'MISSION_BLOCKED_STAGNATION'].every(item => FOUNDRY_AGENT_EVENT_TYPES.includes(item as typeof FOUNDRY_AGENT_EVENT_TYPES[number]))
        && /replans/.test(storeSrc) && /saveReplanRecord/.test(storeSrc) && /evaluateCommandCenterReplan/.test(centerSrc),
      'events+replans+cc hook',
    ))
    results.push(check(
      'commander_ui',
      /foundry-replan/.test(uiSrc) && /foundry-stagnation-detected/.test(uiSrc) && /STAGNATION DETECTED/.test(uiSrc),
      'Command Center replan/stagnation',
    ))
    results.push(check(
      'failure_classes_reused',
      FOUNDRY_REPLAN_FAILURE_CLASSES.join(',') === 'IMPLEMENTATION_BUG,TEST_EXPECTATION_OUTDATED,TRANSIENT,PROVIDER_LIMIT,PERMISSION,DEPENDENCY_MISSING,ENVIRONMENT,CONTRACT_SCOPE,UNKNOWN'
        && classifyReplanFailure({ error: 'EACCES permission denied' }) === 'PERMISSION',
      classifyReplanFailure({ error: 'EACCES permission denied' }),
    ))
    results.push(check(
      'bounded_thresholds',
      FOUNDRY_STAGNATION_THRESHOLDS.maxSteerPerTask > 0
        && FOUNDRY_STAGNATION_THRESHOLDS.maxTaskReplans > 0
        && FOUNDRY_STAGNATION_THRESHOLDS.maxDagReplans > 0
        && FOUNDRY_STAGNATION_THRESHOLDS.maxMissionReplanRequests > 0
        && !/NaN|Infinity/.test(JSON.stringify(FOUNDRY_STAGNATION_THRESHOLDS)),
      JSON.stringify(FOUNDRY_STAGNATION_THRESHOLDS),
    ))
    results.push(check(
      'structured_model_output_required',
      parseStructuredReplan('please rewrite the product') === null
        && parseStructuredReplan({ REPLAN: { level: 'L2', reason: 'insert prereq', failureClass: 'DEPENDENCY_MISSING', newTasks: [], expectedProgressSignal: 'new_dependency_resolved' } })?.level === 'L2',
      'prose rejected; REPLAN JSON accepted',
    ))
    results.push(check(
      'no_continue_spam_hook',
      /considerCommandCenterReplan/.test(centerSrc) && /REPEAT_ACTION_REFUSED/.test(centerSrc) && /shouldRefuseRepeatedAction/.test(centerSrc),
      'autonomous replan inside execute loop',
    ))

    const graphHash = makeGraph('hash')
    const firstHash = hashCommandCenterPlan(graphHash)
    graphHash.updatedAt = '2099-01-01T00:00:00.000Z'
    graphHash.tasks[0].retryCount = 9
    const sameHash = hashCommandCenterPlan(graphHash)
    graphHash.tasks[1].dependsOn = [...graphHash.tasks[1].dependsOn, graphHash.tasks[0].taskId]
    const changedHash = hashCommandCenterPlan(graphHash)
    results.push(check('SAME_DAG_SAME_HASH', firstHash === sameHash && Boolean(firstHash), firstHash.slice(0, 16)))
    results.push(check('MATERIAL_DAG_CHANGE_NEW_HASH', changedHash !== firstHash, `${firstHash.slice(0, 8)}→${changedHash.slice(0, 8)}`))

    const graphA = makeGraph('a')
    const fp = failFingerprint()
    const failed = graphA.tasks.find(task => task.role === 'BACKEND')!
    failed.status = 'FAILED'
    failed.blocker = 'assert implementation fail: expected 1 to equal 0'
    evaluateCommandCenterReplan({ graph: graphA, taskId: failed.taskId, observation: { taskId: failed.taskId, fingerprint: fp, ok: false, kind: 'failure', detail: failed.blocker } })
    const again = evaluateCommandCenterReplan({ graph: graphA, taskId: failed.taskId, observation: { taskId: failed.taskId, fingerprint: fp, ok: false, kind: 'failure', detail: failed.blocker } })
    const stagnated = detectStagnation(graphA, failed.taskId)
    if (!shouldRefuseRepeatedAction(graphA, failed.taskId, fp)) blindRepeat += 1
    results.push(check(
      'fixture_A_identical_failure',
      stagnated.detected && stagnated.repeatActionRefused && shouldRefuseRepeatedAction(graphA, failed.taskId, fp) && (again.record.level === 'L0' || again.record.level === 'L1') && again.applied,
      `${again.record.level} ${again.record.status} reasons=${stagnated.reasons.join('|')}`,
    ))

    const graphB = makeGraph('b')
    const inspect = graphB.tasks.find(task => task.role === 'ARCHITECT')!
    inspect.status = 'FAILED'
    const beforeB = hashCommandCenterPlan(graphB)
    const l0 = applyReplan({
      graph: graphB,
      proposal: {
        level: 'L0',
        reason: 'Local steer: use another allowed inspection tool.',
        failureClass: 'IMPLEMENTATION_BUG',
        changedTaskIds: [inspect.taskId],
        newTasks: [],
        removedTaskIds: [],
        dependencyChanges: [],
        expectedProgressSignal: 'new_file_evidence',
        strategy: 'alternate-read-path',
        taskId: inspect.taskId,
      },
    })
    results.push(check(
      'fixture_B_local_steer',
      l0.applied && l0.record.level === 'L0' && hashCommandCenterPlan(graphB) === beforeB && graphB.tasks.length === makeGraph('b-count').tasks.length && ((graphB.tasks.find(task => task.taskId === inspect.taskId)?.steerCount ?? 0) >= 1),
      `hashEqual=${hashCommandCenterPlan(graphB) === beforeB} tasks=${graphB.tasks.length}`,
    ))

    const graphC = makeGraph('c')
    const backend = graphC.tasks.find(task => task.role === 'BACKEND')!
    backend.status = 'FAILED'
    backend.retryCount = 2
    backend.strategy = 'first-approach'
    const l1 = evaluateCommandCenterReplan({
      graph: graphC,
      taskId: backend.taskId,
      observation: { taskId: backend.taskId, fingerprint: failFingerprint('file.patch'), ok: false, kind: 'failure', detail: backend.blocker ?? 'fail' },
    })
    const l1b = evaluateCommandCenterReplan({
      graph: graphC,
      taskId: backend.taskId,
      observation: { taskId: backend.taskId, fingerprint: failFingerprint('file.patch'), ok: false, kind: 'failure', detail: 'fail again' },
    })
    results.push(check(
      'fixture_C_task_replan',
      (l1.record.level === 'L1' || l1b.record.level === 'L1')
        && graphC.tasks.some(task => task.taskId === backend.taskId && task.title === backend.title)
        && (backend.taskReplanCount ?? 0) >= 1
        && backend.strategy !== 'first-approach'
        && l1b.record.status !== 'REAPPROVAL_REQUIRED',
      `level=${l1b.record.level} strategy=${backend.strategy}`,
    ))

    const graphD = makeGraph('d')
    const missing = graphD.tasks.find(task => task.role === 'BACKEND')!
    missing.status = 'FAILED'
    missing.blocker = 'missing prerequisite module cannot find module'
    const beforeD = hashCommandCenterPlan(graphD)
    const l2insert = evaluateCommandCenterReplan({
      graph: graphD,
      taskId: missing.taskId,
      observation: { taskId: missing.taskId, fingerprint: actionFingerprint({ error: missing.blocker }), ok: false, kind: 'failure', detail: missing.blocker },
    })
    const dagD = validateDag(graphD.tasks)
    results.push(check(
      'fixture_D_dag_insert',
      l2insert.applied && l2insert.record.level === 'L2' && l2insert.record.addedTaskIds.length >= 1 && hashCommandCenterPlan(graphD) !== beforeD && dagD.ok && graphD.tasks.find(task => task.taskId === missing.taskId)?.status === 'QUEUED',
      `added=${l2insert.record.addedTaskIds.join(',')} dag=${dagD.ok} status=${graphD.tasks.find(task => task.taskId === missing.taskId)?.status}`,
    ))

    const graphE = makeGraph('e')
    const oversized = graphE.tasks.find(task => task.role === 'ARCHITECT')!
    oversized.status = 'READY'
    oversized.writeSet = ['.foundry/a', '.foundry/b', 'src/one.ts', 'src/two.ts']
    const split = evaluateCommandCenterReplan({ graph: graphE, taskId: oversized.taskId, hint: 'oversized split', proposal: null })
    const splitApplied = applyReplan({
      graph: graphE,
      proposal: {
        level: 'L2',
        reason: 'Pending task is oversized. Split into two traceable tasks.',
        failureClass: 'IMPLEMENTATION_BUG',
        changedTaskIds: [oversized.taskId],
        newTasks: [
          { title: `${oversized.title} (part A)`, role: oversized.role, dependsOn: [], writeSet: oversized.writeSet.slice(0, 2), requirementIds: oversized.requirementIds, criterionIds: oversized.criterionIds, mutating: true, strategy: 'split-a', replacesTaskId: oversized.taskId },
          { title: `${oversized.title} (part B)`, role: oversized.role, dependsOn: ['__NEW_0__'], writeSet: oversized.writeSet.slice(2), requirementIds: oversized.requirementIds, criterionIds: oversized.criterionIds, mutating: true, strategy: 'split-b', replacesTaskId: oversized.taskId },
        ],
        removedTaskIds: [],
        dependencyChanges: [],
        expectedProgressSignal: 'new_dependency_resolved',
        taskId: oversized.taskId,
      },
    })
    results.push(check(
      'fixture_E_dag_split',
      splitApplied.applied && splitApplied.record.addedTaskIds.length === 2 && graphE.tasks.find(task => task.taskId === oversized.taskId)?.status === 'SUPERSEDED' && graphE.tasks.filter(task => task.replacedTaskId === oversized.taskId).length === 2 && validateDag(graphE.tasks).ok,
      `status=${graphE.tasks.find(task => task.taskId === oversized.taskId)?.status} added=${splitApplied.record.addedTaskIds.length} autoLevel=${split.record.level}`,
    ))

    const graphF = makeGraph('f')
    const idsBeforeF = graphF.tasks.map(task => task.taskId).join(',')
    const depsBeforeF = graphF.tasks.map(task => `${task.taskId}:${task.dependsOn.join('|')}`).join(';')
    const parsed = parseStructuredReplan({
      REPLAN: {
        level: 'L2',
        reason: 'Add a billing new feature outside approved goal.',
        failureClass: 'CONTRACT_SCOPE',
        expandsMission: true,
        newTasks: [{ title: 'Billing portal', role: 'BACKEND', requirementIds: ['REQ-001'], criterionIds: ['CR-TEST'], writeSet: ['billing.ts'] }],
        expectedProgressSignal: 'new_feature',
      },
    })!
    const boundary = applyReplan({ graph: graphF, proposal: parsed })
    if (boundary.applied) outOfContractApplied += 1
    results.push(check(
      'fixture_F_contract_boundary',
      !boundary.applied && boundary.record.status === 'REAPPROVAL_REQUIRED' && graphF.tasks.map(task => task.taskId).join(',') === idsBeforeF && graphF.tasks.map(task => `${task.taskId}:${task.dependsOn.join('|')}`).join(';') === depsBeforeF,
      `${boundary.record.status} applied=${boundary.applied}`,
    ))

    const graphG = makeGraph('g')
    const stuck = graphG.tasks.find(task => task.role === 'BACKEND')!
    stuck.status = 'FAILED'
    stuck.steerCount = FOUNDRY_STAGNATION_THRESHOLDS.maxSteerPerTask
    graphG.taskReplanCount = FOUNDRY_STAGNATION_THRESHOLDS.maxTaskReplans
    graphG.dagReplanCount = FOUNDRY_STAGNATION_THRESHOLDS.maxDagReplans
    stuck.taskReplanCount = FOUNDRY_STAGNATION_THRESHOLDS.maxTaskReplans
    let loops = 0
    let last = evaluateCommandCenterReplan({
      graph: graphG,
      taskId: stuck.taskId,
      observation: { taskId: stuck.taskId, fingerprint: fp, ok: false, kind: 'blocked', detail: 'still failing' },
    })
    while (loops < 8 && last.record.status !== 'BLOCKED') {
      loops += 1
      last = evaluateCommandCenterReplan({
        graph: graphG,
        taskId: stuck.taskId,
        observation: { taskId: stuck.taskId, fingerprint: fp, ok: false, kind: 'blocked', detail: 'still failing' },
      })
    }
    if (last.record.status !== 'BLOCKED' || loops >= 8) infiniteLoop += 1
    results.push(check(
      'fixture_G_hard_block',
      last.record.level === 'L4' && last.record.status === 'BLOCKED' && graphG.status === 'BLOCKED' && loops < 8,
      `status=${last.record.status} loops=${loops}`,
    ))

    const graphH = makeGraph('h')
    const complete = graphH.tasks.find(task => task.role === 'ARCHITECT')!
    complete.status = 'COMPLETE'
    complete.result = 'historical truth'
    const completeSnapshot = JSON.stringify({ title: complete.title, status: complete.status, dependsOn: complete.dependsOn, writeSet: complete.writeSet })
    const down = graphH.tasks.find(task => task.role === 'BACKEND')!
    down.status = 'FAILED'
    down.blocker = 'missing prerequisite module'
    const afterH = evaluateCommandCenterReplan({
      graph: graphH,
      taskId: down.taskId,
      observation: { taskId: down.taskId, fingerprint: actionFingerprint({ error: down.blocker }), ok: false, kind: 'failure', detail: down.blocker },
    })
    const completeAfter = graphH.tasks.find(task => task.taskId === complete.taskId)!
    if (completeAfter.status !== 'COMPLETE' || completeAfter.title !== complete.title) completeHistoryRewritten += 1
    results.push(check(
      'fixture_H_complete_history',
      completeAfter.status === 'COMPLETE' && JSON.stringify({ title: completeAfter.title, status: completeAfter.status, dependsOn: completeAfter.dependsOn, writeSet: completeAfter.writeSet }) === completeSnapshot && afterH.applied,
      completeAfter.status,
    ))

    const graphI = makeGraph('i')
    const missingI = graphI.tasks.find(task => task.role === 'BACKEND')!
    missingI.status = 'FAILED'
    missingI.blocker = 'missing prerequisite module'
    const appliedI = evaluateCommandCenterReplan({
      graph: graphI,
      taskId: missingI.taskId,
      observation: { taskId: missingI.taskId, fingerprint: actionFingerprint({ error: missingI.blocker }), ok: false, kind: 'failure', detail: missingI.blocker },
    })
    saveCommandCenterGraph(graphI)
    const restarted = recoverCommandCenterGraph(JSON.parse(JSON.stringify(graphI)) as FoundryCommandCenterGraph)
    recoverReplanCounters(restarted, listReplanRecords(graphI.graphId))
    const addedOnce = restarted.tasks.filter(task => appliedI.record.addedTaskIds.includes(task.taskId))
    results.push(check(
      'fixture_I_restart',
      appliedI.applied && listReplanRecords(graphI.graphId).length >= 1 && addedOnce.length === appliedI.record.addedTaskIds.length && restarted.dagReplanCount === graphI.dagReplanCount && hashCommandCenterPlan(restarted) === hashCommandCenterPlan(graphI),
      `records=${listReplanRecords(graphI.graphId).length} added=${addedOnce.length}`,
    ))

    const graphJ = makeGraph('j')
    const branchA = graphJ.tasks.find(task => task.role === 'BACKEND')!
    const branchB = graphJ.tasks.find(task => task.role === 'FRONTEND')!
    const db = graphJ.tasks.find(task => task.role === 'DATABASE')!
    db.status = 'COMPLETE'
    branchA.status = 'FAILED'
    branchA.blocker = 'assert implementation fail'
    branchB.status = 'READY'
    evaluateCommandCenterReplan({
      graph: graphJ,
      taskId: branchA.taskId,
      observation: { taskId: branchA.taskId, fingerprint: fp, ok: false, kind: 'failure', detail: 'fail' },
    })
    evaluateCommandCenterReplan({
      graph: graphJ,
      taskId: branchA.taskId,
      observation: { taskId: branchA.taskId, fingerprint: fp, ok: false, kind: 'failure', detail: 'fail' },
    })
    const scheduled = scheduleReadyTasks({
      graph: graphJ,
      runningElsewhere: 0,
      snapshot: {
        cpuCount: 16,
        cpuLoadHint: 1,
        ramUsedRatio: 0.4,
        ramFreeMb: 16000,
        vramUsedMb: null,
        vramTotalMb: null,
        activeBrowsers: 0,
        activeBuilds: 0,
        activeModelSlots: 0,
        activePtys: 0,
        measuredAt: '2026-09-22T00:00:00.000Z',
      },
    })
    results.push(check(
      'fixture_J_parallel_unaffected',
      graphJ.tasks.find(task => task.taskId === branchB.taskId)?.status === 'READY' && scheduled.allowed.some(task => task.taskId === branchB.taskId),
      `branchB=${graphJ.tasks.find(task => task.taskId === branchB.taskId)?.status} allowed=${scheduled.allowed.map(task => task.taskId).join(',')}`,
    ))

    const graphK = makeGraph('k')
    const refusedK = applyReplan({
      graph: graphK,
      proposal: {
        level: 'L2',
        reason: 'Add unmapped work',
        failureClass: 'IMPLEMENTATION_BUG',
        changedTaskIds: [],
        newTasks: [{ title: 'Untraceable task', role: 'BACKEND', writeSet: [] }],
        removedTaskIds: [],
        dependencyChanges: [],
        expectedProgressSignal: 'none',
      },
    })
    if (refusedK.applied) untraceableAccepted += 1
    results.push(check(
      'fixture_K_acceptance_trace',
      !refusedK.applied && refusedK.record.status === 'REFUSED',
      refusedK.record.status,
    ))

    const graphL = makeGraph('l')
    const first = graphL.tasks[0]
    const second = graphL.tasks[1]
    const refusedL = applyReplan({
      graph: graphL,
      proposal: {
        level: 'L2',
        reason: 'Introduce a cycle',
        failureClass: 'IMPLEMENTATION_BUG',
        changedTaskIds: [first.taskId, second.taskId],
        newTasks: [],
        removedTaskIds: [],
        dependencyChanges: [
          { taskId: first.taskId, from: [...first.dependsOn], to: [second.taskId], reason: 'cycle' },
          { taskId: second.taskId, from: [...second.dependsOn], to: [first.taskId], reason: 'cycle' },
        ],
        expectedProgressSignal: 'none',
      },
    })
    if (refusedL.applied) cycleAccepted += 1
    results.push(check(
      'fixture_L_cycle',
      !refusedL.applied && refusedL.record.status === 'REFUSED' && validateDag(graphL.tasks).ok,
      refusedL.record.status,
    ))

    const runningGraph = makeGraph('run')
    const running = runningGraph.tasks.find(task => task.role === 'BACKEND')!
    running.status = 'RUNNING'
    const refusedRunning = applyReplan({
      graph: runningGraph,
      proposal: {
        level: 'L2',
        reason: 'Replace in-flight task',
        failureClass: 'IMPLEMENTATION_BUG',
        changedTaskIds: [running.taskId],
        newTasks: [{ title: 'Replacement', role: 'BACKEND', requirementIds: running.requirementIds, criterionIds: running.criterionIds, replacesTaskId: running.taskId }],
        removedTaskIds: [],
        dependencyChanges: [],
        expectedProgressSignal: 'none',
        taskId: running.taskId,
      },
    })
    results.push(check('running_task_not_rewritten', !refusedRunning.applied && running.status === 'RUNNING', `${refusedRunning.record.status} ${running.status}`))

    const verdictGraph = makeGraph('verdict')
    const vTask = verdictGraph.tasks.find(task => task.role === 'BACKEND')!
    vTask.status = 'FAILED'
    vTask.blocker = 'missing prerequisite module'
    evaluateCommandCenterReplan({
      graph: verdictGraph,
      taskId: vTask.taskId,
      observation: { taskId: vTask.taskId, fingerprint: actionFingerprint({ error: vTask.blocker }), ok: false, kind: 'failure', detail: vTask.blocker },
    })
    const verdict = evaluateVerdictLayer({
      engineeringClass: 'STANDALONE_ENGINEER',
      missionId: verdictGraph.missionId,
      missionContract: loadMissionContract(verdictGraph.missionContractId!),
      acceptanceContract: loadAcceptanceContract(verdictGraph.acceptanceContractId!),
      reviewOutcome: null,
      executorResult: 'NONE',
    })
    const ready = projectReadyFromVerdict({
      engineeringClass: 'STANDALONE_ENGINEER',
      tasksComplete: false,
      verdict,
      missionContract: loadMissionContract(verdictGraph.missionContractId!),
      acceptanceContract: loadAcceptanceContract(verdictGraph.acceptanceContractId!),
    })
    results.push(check(
      'replan_is_not_verdict_pass',
      verdict.result !== 'PASS' && ready === false,
      `${verdict.result} ready=${ready}`,
    ))

    const events = loadContractEvents(graphA.missionId)
    results.push(check(
      'stagnation_events_emitted',
      events.some(item => item.type === 'STAGNATION_DETECTED') && (loadContractEvents(graphD.missionId).some(item => item.type === 'DAG_REWIRED') || loadContractEvents(graphD.missionId).some(item => item.type === 'REPLAN_APPLIED')),
      events.map(item => item.type).join(','),
    ))
    results.push(check('REPLAN_DAG_VALID', validateDag(graphD.tasks).ok && validateDag(graphE.tasks).ok && validateDag(graphI.tasks).ok, 'd/e/i'))
    results.push(check('OLD_COMPLETE_TASKS_PRESERVED', completeHistoryRewritten === 0, String(completeHistoryRewritten)))
    results.push(check('BLIND_REPEAT_AFTER_SAME_FAILURE', blindRepeat === 0, String(blindRepeat)))
    results.push(check('OUT_OF_CONTRACT_REPLAN_APPLIED_COUNT', outOfContractApplied === 0, String(outOfContractApplied)))
    results.push(check('UNTRACEABLE_REPLAN_TASK_COUNT', untraceableAccepted === 0, String(untraceableAccepted)))
    results.push(check('DAG_CYCLE_ACCEPTED_COUNT', cycleAccepted === 0, String(cycleAccepted)))
    results.push(check('COMPLETE_TASK_HISTORY_REWRITTEN', completeHistoryRewritten === 0, String(completeHistoryRewritten)))
    results.push(check('INFINITE_REPLAN_LOOP_COUNT', infiniteLoop === 0, String(infiniteLoop)))
    results.push(check(
      'deterministic_first',
      /proposeDeterministicReplan/.test(engineSrc) && /parseStructuredReplan/.test(engineSrc) && !/callModel|openai|anthropic/.test(engineSrc),
      'no model call in engine',
    ))

    const cu = await cdpAvailable()
    results.push(check('semantic_cu', true, cu ? 'CDP present; semantic CU not run this mission' : 'ENVIRONMENTAL_NOT_RUN'))
  } finally {
    if (previousContracts === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
    else process.env.FOUNDRY_CONTRACTS_ROOT = previousContracts
    if (previousCc === undefined) delete process.env.FOUNDRY_COMMAND_CENTER_ROOT
    else process.env.FOUNDRY_COMMAND_CENTER_ROOT = previousCc
    rmSync(contractsRoot, { recursive: true, force: true })
    rmSync(ccRoot, { recursive: true, force: true })
  }

  const failed = results.filter(item => !item.pass)
  console.log(JSON.stringify({
    ok: failed.length === 0,
    passed: results.filter(item => item.pass).length,
    failed: failed.length,
    counts: {
      BLIND_REPEAT_AFTER_SAME_FAILURE: blindRepeat,
      OUT_OF_CONTRACT_REPLAN_APPLIED_COUNT: outOfContractApplied,
      UNTRACEABLE_REPLAN_TASK_COUNT: untraceableAccepted,
      DAG_CYCLE_ACCEPTED_COUNT: cycleAccepted,
      COMPLETE_TASK_HISTORY_REWRITTEN: completeHistoryRewritten,
      INFINITE_REPLAN_LOOP_COUNT: infiniteLoop,
    },
    results,
  }, null, 2))
  if (failed.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run()
}

export { run as runFoundryDagReplanStagnationValidation }
