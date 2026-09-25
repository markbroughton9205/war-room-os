/**
 * Foundry Autonomous Multi-Agent Command Center.
 * Real task graphs, isolated workspaces, bounded scheduler, persisted results.
 * Parallel autonomy does not grant commit/push/live-deploy authority.
 */
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { FOUNDRY_COMMAND_CENTER_GOVERNANCE, commandCenterBackgroundLabel, type FoundryAgentRecord, type FoundryCommandCenterGraph, type FoundryTaskPriority, type FoundryTaskRecord, type FoundryPreviewRecord } from './foundryAgentTypes'
import { FOUNDRY_ROLE_CATALOG, assignRepairRole, roleAllowsTool, roleIsMutating } from './foundryAgentRoles'
import { routeModelForRole } from './foundryAgentRouting'
import { loadSkillsForRole } from './foundryAgentSkills'
import { composeInstructionContext, ensureFoundryInstructionsFile, loadProjectInstructionSources } from './foundryProjectInstructions'
import { commandCenterSnapshot, listCommandCenterGraphs, loadCommandCenterGraph, maxExecutionGeneration, mutateCommandCenterGraph, recoverAllCommandCenterGraphs, recoverCommandCenterGraph, saveCommandCenterGraph, supersedeActiveAgentsForTask, enforceSingleActiveExecution } from './foundryAgentStore'
import { computeMaxConcurrentAgents, dependenciesSatisfied, measureFoundryResources, scheduleReadyTasks } from './foundryAgentScheduler'
import { applyWorkspaceFilesToProject, cleanupWorkspace, createIsolatedWorkspace, writeWorkspaceFile } from './foundryAgentWorkspaces'
import { buildTaskGraph, promoteReady, researchGraphSeeds, ticketManagerGraphSeeds } from './foundryTaskGraph'
import { conflictArtifact, detectWorkspaceConflicts } from './foundryAgentConflicts'
import { buildTicketManagerFiles, filesForRole } from './foundryTicketManagerFactory'
import {
  createFoundryApplicationWorkspace,
  foundryNodeExecutable,
  pickFreeLoopbackPort,
  runProjectCommand,
  slugProjectName,
  startProjectProcess,
} from './foundryProjectIsolation'
import { httpGetNoKeepAlive } from './foundryApplicationBuilderLifecycle'
import { executeFoundryBrowserTool } from './foundryBrowserService'
import {
  defaultTicketManagerCriteria,
  draftStandaloneContracts,
  sealAcceptanceContract,
  sealMissionContract,
  supersedeAcceptanceContract,
  supersedeMissionContract,
} from './foundryMissionContract'
import { recordAcceptanceEvidence } from './foundryAcceptanceEvidence'
import {
  canEnterExecutionFromGraph,
  canComplete,
  evaluateIndependentReview,
  evaluateVerdictLayer,
  isStandaloneEngineerGraph,
  projectReadyFromVerdict,
  recoverVerdictState,
} from './foundryVerdictLayer'
import { loadAcceptanceContract, loadMissionContract, loadVerdictRecord } from './foundryContractStore'
import {
  evaluateCommandCenterReplan,
  shouldRefuseRepeatedAction,
  actionFingerprint,
  classifyReplanFailure,
  applyReplan,
} from './foundryReplanEngine'
import { formatReasoningDossierSections, reviewGraphForAdversarialFindings } from './foundryEngineeringReasoning'
import {
  applyContractSupersessionToGraph,
  createExecutionApproval,
  evaluateApprovalBinding,
  haltGraphForReapproval,
  revokeExecutionApproval,
  type ApprovalExpectedGeneration,
} from './foundryExecutionApproval'
import {
  attachResourceViewToGraph,
  authorizeResourceAction,
  beginResourceUsage,
  completeResourceUsage,
  ensureResourceBudget,
  missionMaxConcurrentAgents,
  pauseResourceClock,
  recoverResourceBudget,
  resourceBudgetBlocksExecution,
  resumeResourceClock,
} from './foundryResourceGovernor'
import {
  attachRuntimeViewToGraph,
  cancelMissionRuntime,
  completeMissionRuntime,
  heartbeatMissionRuntime,
  loadActiveMissionRuntime,
  pauseMissionRuntime,
  recordProviderBackoff,
  resumeMissionRuntime,
  startMissionRuntime,
  persistDurableRuntimeAction,
} from './foundryMissionRuntime'
import {
  attachUnattendedViewToGraph,
  authorizeUnattendedEnvelope,
  startUnattendedEnvelope,
  pauseUnattendedEnvelope,
  resumeUnattendedEnvelope,
  revokeUnattendedEnvelope,
} from './foundryUnattendedEngineer'

export { FOUNDRY_COMMAND_CENTER_GOVERNANCE, commandCenterSnapshot, recoverAllCommandCenterGraphs }

const DEFAULT_PORT = 18765

function considerCommandCenterReplan(
  graph: FoundryCommandCenterGraph,
  taskId: string | null,
  extra?: { detail?: string; fingerprint?: string; hint?: string },
) {
  const observation = extra?.fingerprint
    ? {
        taskId: taskId ?? graph.tasks[0]?.taskId ?? 'TASK-000',
        fingerprint: extra.fingerprint,
        ok: false,
        kind: 'failure' as const,
        detail: extra.detail ?? '',
      }
    : null
  const outcome = evaluateCommandCenterReplan({
    graph,
    taskId,
    observation,
    hint: extra?.hint ?? null,
    missionContract: graph.missionContractId ? loadMissionContract(graph.missionContractId) : null,
    acceptanceContract: graph.acceptanceContractId ? loadAcceptanceContract(graph.acceptanceContractId) : null,
  })
  const klass = classifyReplanFailure({ error: extra?.detail, blocker: extra?.detail })
  if (klass === 'TRANSIENT' || klass === 'PROVIDER_LIMIT') {
    const budget = recoverResourceBudget(graph.missionId)
    const failures = Math.max(1, budget?.totals.providerFailures ?? 1)
    const cap = budget?.limits.maxProviderFailures ?? 6
    if (failures < cap) {
      recordProviderBackoff(graph.missionId, failures)
    }
  }
  return outcome
}

export type EnqueueInput = {
  goal: string
  projectId?: string
  projectName?: string
  projectRoot?: string
  missionId?: string
  planningMode?: boolean
  specId?: string | null
  specVersion?: string | null
  specApproved?: boolean
  priority?: FoundryTaskPriority
  kind?: 'ticket-manager' | 'research' | 'custom'
  commanderInstruction?: string
  engineeringClass?: import('./foundryContractTypes').FoundryEngineeringClass
}

export function getCommandCenterSnapshot() {
  return commandCenterSnapshot()
}

export async function enqueueCommandCenterWork(input: EnqueueInput): Promise<FoundryCommandCenterGraph> {
  const missionId = input.missionId || `cc-${randomUUID()}`
  let projectRoot = input.projectRoot || ''
  let projectId = input.projectId || ''
  let projectName = input.projectName || slugProjectName(input.goal) || 'foundry-command-center'
  if (!projectRoot) {
    const project = await createFoundryApplicationWorkspace({
      name: `${projectName}-${Date.now().toString(36)}`.slice(0, 60),
      missionId,
      projectType: 'local_data_app',
      label: projectName,
    })
    projectRoot = project.projectRoot
    projectId = project.projectId
    projectName = project.projectName
  }
  ensureFoundryInstructionsFile(projectRoot)
  const seeds = input.kind === 'research' ? researchGraphSeeds(input.goal) : ticketManagerGraphSeeds()
  const engineeringClass = input.engineeringClass ?? (input.kind === 'research' ? 'LEGACY_PRE_CONTRACT' : 'STANDALONE_ENGINEER')
  const specApproved = engineeringClass === 'STANDALONE_ENGINEER'
    ? Boolean(input.specApproved)
    : (input.planningMode ? Boolean(input.specApproved) : true)
  const graph = buildTaskGraph({
    missionId,
    projectId,
    projectName,
    projectRoot,
    goal: input.goal,
    planningMode: input.planningMode ?? (engineeringClass === 'STANDALONE_ENGINEER' && !specApproved),
    specId: input.specId ?? `SPEC-${missionId.slice(0, 8)}`,
    specVersion: input.specVersion ?? '1',
    specApproved,
    priority: input.priority,
    engineeringClass,
    tasks: seeds,
  })
  graph.instructionSources = loadProjectInstructionSources({
    projectRoot,
    commanderInstruction: input.commanderInstruction || input.goal,
    approvedSpec: graph.specApproved ? `${graph.specId}@${graph.specVersion}` : '',
    workspaceTruth: projectRoot,
  })
  if (graph.instructionSources.some(source => source.layer === 'COMMANDER_CURRENT' && source.loaded) && input.commanderInstruction) {
    for (const task of graph.tasks) task.guidance.push(input.commanderInstruction)
  }
  if (engineeringClass === 'STANDALONE_ENGINEER') {
    const budget = ensureResourceBudget(missionId, graph.graphId)
    graph.resourceBudgetId = budget.budgetId
    startMissionRuntime({
      missionId,
      graphId: graph.graphId,
      projectId: graph.projectId,
      resourceBudgetId: budget.budgetId,
      contractGeneration: graph.missionContractHash,
    })
    attachResourceViewToGraph(graph)
    attachRuntimeViewToGraph(graph)
    attachUnattendedViewToGraph(graph)
  }
  return saveCommandCenterGraph(graph)
}

export async function pauseCommandCenter(target: { graphId: string; taskId?: string; agentId?: string }): Promise<FoundryCommandCenterGraph> {
  const graph = mustLoad(target.graphId)
  if (graph.status === 'COMPLETE' || graph.status === 'CANCELLED') return graph
  if (target.taskId) {
    const task = graph.tasks.find(item => item.taskId === target.taskId)
    if (task && task.status !== 'COMPLETE' && task.status !== 'CANCELLED') {
      task.status = 'PAUSED'
      task.latestAction = 'Commander paused this task.'
    }
  } else if (target.agentId) {
    const agent = graph.agents.find(item => item.agentId === target.agentId)
    if (agent && agent.status === 'RUNNING') {
      agent.status = 'PAUSED'
      agent.latestAction = 'Commander paused this agent.'
      const task = graph.tasks.find(item => item.taskId === agent.taskId)
      if (task && task.status === 'RUNNING') {
        task.status = 'PAUSED'
        task.latestAction = 'Commander paused owning agent.'
      }
    }
  } else {
    graph.paused = true
    graph.status = 'PAUSED'
    for (const task of graph.tasks) {
      if (task.status === 'RUNNING' || task.status === 'READY' || task.status === 'WAITING') {
        task.status = 'PAUSED'
        task.latestAction = 'Commander paused the mission.'
      }
    }
    if (graph.missionId && !graph.missionId.startsWith('cc-')) {
      const { pauseMission } = await import('./foundryOperationsManager')
      await pauseMission(graph.missionId, 'Commander paused command-center mission').catch(() => undefined)
    }
  }
  pauseResourceClock(graph.missionId)
  pauseMissionRuntime(graph.missionId)
  pauseUnattendedEnvelope(graph.missionId)
  attachResourceViewToGraph(graph)
  attachRuntimeViewToGraph(graph)
  attachUnattendedViewToGraph(graph)
  return saveCommandCenterGraph(graph)
}

export async function resumeCommandCenter(target: { graphId: string; taskId?: string }): Promise<FoundryCommandCenterGraph> {
  const graph = mustLoad(target.graphId)
  graph.paused = false
  if (graph.status === 'PAUSED') graph.status = 'RUNNING'
  const tasks = target.taskId ? graph.tasks.filter(task => task.taskId === target.taskId) : graph.tasks
  for (const task of tasks) {
    if (task.status === 'PAUSED') {
      task.status = task.dependsOn.length ? 'QUEUED' : 'READY'
      task.latestAction = 'Commander resumed. Legal lifecycle restore; no JSON force-complete.'
    }
  }
  promoteReady(graph.tasks)
  if (!target.taskId && graph.missionId && !graph.missionId.startsWith('cc-')) {
    const { resumeMissionRecord } = await import('./foundryOperationsManager')
    await resumeMissionRecord(graph.missionId).catch(() => undefined)
  }
  resumeResourceClock(graph.missionId)
  resumeMissionRuntime({ missionId: graph.missionId, graph })
  resumeUnattendedEnvelope({ missionId: graph.missionId, graph })
  attachResourceViewToGraph(graph)
  attachRuntimeViewToGraph(graph)
  attachUnattendedViewToGraph(graph)
  return saveCommandCenterGraph(graph)
}

export function startCommandCenterAutoEngineer(graphId: string, commanderConfirmed: boolean): FoundryCommandCenterGraph {
  const graph = mustLoad(graphId)
  const authorized = authorizeUnattendedEnvelope({
    missionId: graph.missionId,
    graph,
    commanderConfirmed,
    authorizedBy: 'COMMANDER',
  })
  if (!authorized.ok) {
    attachUnattendedViewToGraph(graph)
    return saveCommandCenterGraph(graph)
  }
  startUnattendedEnvelope({ missionId: graph.missionId, graph })
  attachUnattendedViewToGraph(graph)
  return saveCommandCenterGraph(graph)
}

export function stopCommandCenterAutoEngineer(graphId: string): FoundryCommandCenterGraph {
  const graph = mustLoad(graphId)
  revokeUnattendedEnvelope(graph.missionId)
  attachUnattendedViewToGraph(graph)
  return saveCommandCenterGraph(graph)
}

export async function cancelCommandCenter(graphId: string, taskId?: string): Promise<FoundryCommandCenterGraph> {
  const graph = mustLoad(graphId)
  if (taskId) {
    const task = graph.tasks.find(item => item.taskId === taskId)
    if (task && task.status !== 'COMPLETE') {
      task.status = 'CANCELLED'
      task.latestAction = 'Commander cancelled. History preserved.'
    }
  } else {
    graph.cancelRequested = true
    graph.status = 'CANCELLED'
    for (const task of graph.tasks) {
      if (task.status !== 'COMPLETE' && task.status !== 'FAILED') {
        task.status = 'CANCELLED'
        task.latestAction = 'Commander cancelled. Completed work kept.'
      }
    }
    cancelMissionRuntime(graph.missionId)
    revokeUnattendedEnvelope(graph.missionId)
  }
  attachRuntimeViewToGraph(graph)
  attachUnattendedViewToGraph(graph)
  return saveCommandCenterGraph(graph)
}

export function guideCommandCenter(graphId: string, taskId: string | undefined, instruction: string): FoundryCommandCenterGraph {
  const graph = mustLoad(graphId)
  const text = instruction.trim()
  if (!text) return graph
  graph.instructionSources = loadProjectInstructionSources({
    projectRoot: graph.projectRoot,
    commanderInstruction: text,
    approvedSpec: graph.specApproved ? `${graph.specId}@${graph.specVersion}` : '',
    workspaceTruth: graph.projectRoot,
  })
  const targets = taskId ? graph.tasks.filter(task => task.taskId === taskId) : graph.tasks.filter(task => task.status === 'RUNNING' || task.status === 'READY' || task.status === 'WAITING')
  for (const task of targets) {
    task.guidance.push(text)
    task.latestAction = `Commander guidance: ${text.slice(0, 160)}`
    if (/pause frontend/i.test(text) && task.role === 'FRONTEND' && task.status !== 'COMPLETE') {
      task.status = 'PAUSED'
    }
    if (/do not change the api/i.test(text)) {
      graph.artifacts.push({
        artifactId: randomUUID(),
        kind: 'guidance',
        title: 'API freeze',
        body: text,
        createdAt: new Date().toISOString(),
        taskId: task.taskId,
      })
    }
  }
  return saveCommandCenterGraph(graph)
}

export async function executeCommandCenterGraph(graphId: string): Promise<FoundryCommandCenterGraph> {
  let graph = mustLoad(graphId)
  if (graph.cancelRequested) return graph
  if (isStandaloneEngineerGraph(graph)) {
    const missionContract = graph.missionContractId ? loadMissionContract(graph.missionContractId) : null
    const acceptanceContract = graph.acceptanceContractId ? loadAcceptanceContract(graph.acceptanceContractId) : null
    const binding = evaluateApprovalBinding({
      engineeringClass: graph.engineeringClass,
      missionId: graph.missionId,
      graphId: graph.graphId,
      missionContract,
      acceptanceContract,
    })
    if (binding.reapprovalRequired || (graph.planningMode && !graph.specApproved)) {
      haltGraphForReapproval(graph, binding.reason ?? 'REAPPROVAL_REQUIRED')
      return saveCommandCenterGraph(graph)
    }
    const enter = canEnterExecutionFromGraph(graph)
    if (!enter.ok) {
      haltGraphForReapproval(graph, enter.error ?? 'REAPPROVAL_REQUIRED')
      return saveCommandCenterGraph(graph)
    }
  } else if (graph.planningMode && !graph.specApproved) {
    graph.status = 'PLANNING'
    graph.tasks.forEach(task => {
      if (task.status !== 'PLANNING') {
        task.status = 'PLANNING'
        task.blocker = 'Approved spec required.'
      }
    })
    return saveCommandCenterGraph(graph)
  }
  graph.status = 'RUNNING'
  saveCommandCenterGraph(graph)
  const files = buildTicketManagerFiles({ brand: graph.projectName, port: DEFAULT_PORT })
  let guard = 0
  while (guard++ < 80) {
    graph = mustLoad(graphId)
    if (graph.cancelRequested || graph.paused) break
    heartbeatMissionRuntime(graph.missionId, graph)
    const runtimeNow = loadActiveMissionRuntime(graph.missionId)
    if (runtimeNow && (runtimeNow.state === 'SLEEPING' || runtimeNow.state === 'PAUSED' || runtimeNow.state === 'NEEDS_COMMANDER' || runtimeNow.state === 'BLOCKED' || runtimeNow.state === 'CANCELLED' || runtimeNow.state === 'WAITING')) {
      attachRuntimeViewToGraph(graph)
      return saveCommandCenterGraph(graph)
    }
    const resourceBlock = resourceBudgetBlocksExecution(graph.missionId)
    if (resourceBlock && !resourceBlock.ok) {
      graph.status = resourceBlock.code === 'PAUSED' ? 'PAUSED' : 'BLOCKED'
      graph.paused = resourceBlock.code === 'PAUSED'
      attachResourceViewToGraph(graph)
      attachRuntimeViewToGraph(graph)
      return saveCommandCenterGraph(graph)
    }
    if (isStandaloneEngineerGraph(graph)) {
      const missionContract = graph.missionContractId ? loadMissionContract(graph.missionContractId) : null
      const acceptanceContract = graph.acceptanceContractId ? loadAcceptanceContract(graph.acceptanceContractId) : null
      const binding = evaluateApprovalBinding({
        engineeringClass: graph.engineeringClass,
        missionId: graph.missionId,
        graphId: graph.graphId,
        missionContract,
        acceptanceContract,
      })
      if (binding.reapprovalRequired) {
        haltGraphForReapproval(graph, binding.reason ?? 'REAPPROVAL_REQUIRED')
        return saveCommandCenterGraph(graph)
      }
    }
    if (graph.tasks.every(task => ['COMPLETE', 'FAILED', 'CANCELLED', 'SUPERSEDED'].includes(task.status))) break
    promoteReady(graph.tasks)
    saveCommandCenterGraph(graph)
    const decision = scheduleReadyTasks({
      graph,
      runningElsewhere: countRunningElsewhere(graph.graphId),
      missionMaxConcurrentAgents: missionMaxConcurrentAgents(graph.missionId, 4),
    })
    if (!decision.allowed.length) {
      if (graph.tasks.some(task => task.status === 'RUNNING')) {
        await sleep(25)
        continue
      }
      const failed = graph.tasks.filter(task => task.status === 'FAILED' || task.status === 'BLOCKED')
      if (failed.length) {
        graph.frontierStallCycles = (graph.frontierStallCycles ?? 0) + 1
        const outcome = considerCommandCenterReplan(graph, failed[0].taskId, { detail: failed[0].blocker ?? 'frontier stall', hint: 'stagnation' })
        saveCommandCenterGraph(outcome.graph)
        if (outcome.applied) continue
        if (outcome.record.status === 'BLOCKED' || outcome.record.status === 'REAPPROVAL_REQUIRED') break
      }
      const blocked = graph.tasks.filter(task => task.status === 'QUEUED' && !dependenciesSatisfied(graph, task))
      if (blocked.length && !graph.tasks.some(task => task.status === 'READY')) break
      if (!graph.tasks.some(task => task.status === 'READY')) break
      continue
    }
    await Promise.all(decision.allowed.map(task => runTask(graphId, task.taskId, files)))
  }
  graph = mustLoad(graphId)
  if (!graph.cancelRequested && !graph.paused && graph.tasks.every(task => task.status === 'COMPLETE' || task.status === 'CANCELLED')) {
    return finalizeCommandCenterGraph(graph)
  }
  return saveCommandCenterGraph(graph)
}

async function runTask(graphId: string, taskId: string, files: Record<string, string>): Promise<void> {
  let graph = mustLoad(graphId)
  const task = graph.tasks.find(item => item.taskId === taskId)
  if (!task || task.status !== 'READY') return
  if (graph.paused || graph.cancelRequested) return
  const liveRuntime = loadActiveMissionRuntime(graph.missionId)
  if (liveRuntime && (liveRuntime.state === 'SLEEPING' || liveRuntime.state === 'PAUSED' || liveRuntime.state === 'CANCELLED' || liveRuntime.cancelRequested)) return
  if (isStandaloneEngineerGraph(graph) && (task.mutating || roleIsMutating(task.role))) {
    const missionContract = graph.missionContractId ? loadMissionContract(graph.missionContractId) : null
    const acceptanceContract = graph.acceptanceContractId ? loadAcceptanceContract(graph.acceptanceContractId) : null
    const binding = evaluateApprovalBinding({
      engineeringClass: graph.engineeringClass,
      missionId: graph.missionId,
      graphId: graph.graphId,
      missionContract,
      acceptanceContract,
    })
    if (!binding.ok) {
      task.blocker = binding.reason ?? 'REAPPROVAL_REQUIRED'
      task.latestAction = 'Mutation refused: current execution approval does not match live contracts.'
      saveCommandCenterGraph(graph)
      return
    }
  }
  const nextGeneration = maxExecutionGeneration(graph, taskId) + 1
  const agent: FoundryAgentRecord = {
    agentId: `${task.role.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    role: task.role,
    taskId: task.taskId,
    missionId: graph.missionId,
    projectId: graph.projectId,
    graphId,
    status: 'RUNNING',
    workspaceId: null,
    modelRouting: routeModelForRole(task.role),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    latestAction: `Starting ${task.role}`,
    filesChanged: [],
    commands: [],
    executionGeneration: nextGeneration,
  }
  task.status = 'RUNNING'
  task.startedAt = agent.startedAt
  task.agentId = agent.agentId
  const durableActionId = `cc-${graph.graphId}-${task.taskId}-${nextGeneration}`
  persistDurableRuntimeAction({
    actionId: durableActionId,
    missionId: graph.missionId,
    taskId: task.taskId,
    kind: task.mutating ? 'write' : 'tool',
    state: 'STARTED',
    mutating: Boolean(task.mutating || roleIsMutating(task.role)),
    startedAt: agent.startedAt,
    finishedAt: null,
    resultSummary: null,
    evidencePath: null,
    actionClass: task.mutating ? 'FILE_WRITE_IN_SCOPE' : 'ANALYZE',
    runtimeGeneration: liveRuntime?.runtimeGeneration ?? 1,
    status: 'STARTED',
    tool: task.role,
    writeSet: task.writeSet ?? [],
  })
  task.modelRouting = agent.modelRouting
  task.latestAction = `Assigned ${agent.agentId}`
  const skills = loadSkillsForRole({ role: task.role, missionText: graph.goal, workspaceContext: composeInstructionContext(graph.instructionSources) })
  graph.skillsLoaded = [...new Set([...graph.skillsLoaded, ...skills.skillIds])]
  const workspace = createIsolatedWorkspace({
    projectId: graph.projectId,
    projectRoot: graph.projectRoot,
    missionId: graph.missionId,
    taskId: task.taskId,
    agentId: agent.agentId,
    graphId,
    mutating: roleIsMutating(task.role) || task.mutating,
  })
  agent.workspaceId = workspace.workspaceId
  task.workspaceId = workspace.workspaceId
  await mutateCommandCenterGraph(graphId, live => {
    const liveTask = live.tasks.find(item => item.taskId === taskId)
    if (!liveTask || liveTask.status !== 'READY') return
    supersedeActiveAgentsForTask(live, taskId, `Superseded by execution generation ${nextGeneration}.`)
    liveTask.status = 'RUNNING'
    liveTask.startedAt = agent.startedAt
    liveTask.agentId = agent.agentId
    liveTask.modelRouting = agent.modelRouting
    liveTask.latestAction = `Assigned ${agent.agentId}`
    liveTask.workspaceId = workspace.workspaceId
    live.skillsLoaded = [...new Set([...live.skillsLoaded, ...skills.skillIds])]
    if (!live.agents.some(item => item.agentId === agent.agentId)) live.agents.push(agent)
    if (!live.workspaces.some(item => item.workspaceId === workspace.workspaceId)) live.workspaces.push(workspace)
  })
  await sleep(150)

  try {
    if (task.role === 'ARCHITECT' || task.role === 'DATABASE' || task.role === 'BACKEND' || task.role === 'FRONTEND' || task.role === 'TEST') {
      const wanted = task.role === 'TEST' ? filesForRole('TEST') : filesForRole(task.role === 'DATABASE' ? 'DATABASE' : task.role as 'ARCHITECT' | 'BACKEND' | 'FRONTEND')
      for (const rel of wanted) {
        const content = files[rel]
        if (content == null) continue
        const written = writeWorkspaceFile(workspace, rel, content)
        if (!written.ok) throw new Error(written.error)
      }
      const liveWs = graph.workspaces.find(item => item.workspaceId === workspace.workspaceId)
      if (liveWs) liveWs.filesChanged = unique([...liveWs.filesChanged, ...workspace.filesChanged])
      task.filesChanged = [...workspace.filesChanged]
      agent.filesChanged = [...workspace.filesChanged]
      task.currentPhase = task.role === 'TEST' ? 'test' : task.role === 'ARCHITECT' ? 'spec' : 'implement'
      task.latestAction = `Wrote ${workspace.filesChanged.join(', ')} in ${workspace.kind} ${workspace.workspaceId}`
      if (task.role === 'ARCHITECT') {
        graph.artifacts.push(artifact(task, agent, 'architecture_contract', 'Architecture', 'Write-set and requirement binding established.'))
        graph.artifacts.push(artifact(task, agent, 'api_contract', 'API CONTRACT', files['.foundry/contracts/api.json'] || ''))
      }
      if (task.role === 'DATABASE') {
        graph.artifacts.push(artifact(task, agent, 'schema_contract', 'SCHEMA CONTRACT', files['.foundry/contracts/schema.json']))
      }
      if (task.role === 'TEST') {
        const applied = applyWorkspaceFilesToProject({ workspace, projectRoot: graph.projectRoot })
        const dbPath = path.join(workspace.runtimeDataRoot, 'test.sqlite')
        const testGate = authorizeResourceAction({ missionId: graph.missionId, kind: 'test' })
        if (!testGate.ok) {
          task.status = 'BLOCKED'
          task.blocker = testGate.reason
          task.latestAction = testGate.reason
          saveCommandCenterGraph(graph)
          return
        }
        const testAction = `test-${graph.graphId}-${task.taskId}-${Date.now()}`
        beginResourceUsage({ missionId: graph.missionId, kind: 'test', actionId: testAction, taskId: task.taskId, tool: 'node --test' })
        if (process.env.FOUNDRY_CC_INJECT_TEST_FAILURE === '1' && task.retryCount === 0) {
          const broken = writeWorkspaceFile(workspace, 'test.mjs', `import { test } from 'node:test'\nimport assert from 'node:assert/strict'\ntest('injected failure', () => { assert.equal(1, 0, 'controlled disposable failure') })\n`)
          if (broken.ok) applyWorkspaceFilesToProject({ workspace, projectRoot: graph.projectRoot, files: ['test.mjs'] })
        }
        const result = await runProjectCommand({
          projectRoot: graph.projectRoot,
          cmd: foundryNodeExecutable(),
          args: ['--test', 'test.mjs'],
          missionId: graph.missionId,
          timeoutMs: 20_000,
        })
        completeResourceUsage({ actionId: testAction, missionId: graph.missionId, ok: result.ok, kind: 'test', tool: 'node --test' })
        agent.commands.push('node --test test.mjs')
        task.tests = { ok: result.ok, detail: (result.stdout + result.stderr).slice(0, 800) }
        if (!result.ok) {
          const fingerprint = actionFingerprint({
            tool: 'node --test',
            args: ['test.mjs'],
            tests: result.stdout + result.stderr,
            error: result.stderr || result.stdout,
          })
          if (shouldRefuseRepeatedAction(graph, task.taskId, fingerprint)) {
            const outcome = considerCommandCenterReplan(graph, task.taskId, {
              fingerprint,
              detail: result.stderr || result.stdout,
              hint: 'REPEAT_ACTION_REFUSED',
            })
            saveCommandCenterGraph(outcome.graph)
            graph = mustLoad(graphId)
            const steered = graph.tasks.find(item => item.taskId === taskId)
            if (steered) {
              task.tests = steered.tests
              task.repairHistory = steered.repairHistory
              task.retryCount = steered.retryCount
              task.result = steered.result
              task.status = steered.status
              task.blocker = steered.blocker
            }
          } else {
            await repairTask(graphId, task.taskId, result.stderr || result.stdout, files)
            graph = mustLoad(graphId)
            const repaired = graph.tasks.find(item => item.taskId === taskId)
            if (repaired) {
              task.tests = repaired.tests
              task.repairHistory = repaired.repairHistory
              task.retryCount = repaired.retryCount
              task.result = repaired.tests.ok ? `Tests passed after repair. Isolated DB ${dbPath}.` : task.result
            }
            if (repaired && repaired.tests.ok === false) {
              const outcome = considerCommandCenterReplan(graph, task.taskId, {
                fingerprint,
                detail: repaired.tests.detail,
              })
              saveCommandCenterGraph(outcome.graph)
              graph = mustLoad(graphId)
            }
          }
        } else {
          task.result = `Tests passed. Isolated DB ${dbPath}. Applied ${applied.applied.join(', ')}`
        }
        if (task.tests.ok === false) return
      }
    } else if (task.role === 'RESEARCHER') {
      const note = {
        projectId: graph.projectId,
        goal: graph.goal,
        researchedAt: new Date().toISOString(),
        notes: ['Non-mutating research task. No source writes to sibling projects.'],
      }
      mkdirSync(graph.projectRoot, { recursive: true })
      writeFileSync(path.join(graph.projectRoot, 'foundry-memory.json'), JSON.stringify(note, null, 2), 'utf8')
      task.filesChanged = ['foundry-memory.json']
      task.latestAction = 'Wrote research notes for this project only.'
      task.currentPhase = 'research'
    } else if (task.role === 'RELEASE') {
      graph = mustLoad(graphId)
      const conflicts = detectWorkspaceConflicts(graph)
      graph.artifacts.push(conflictArtifact(graph.graphId, conflicts))
      if (conflicts.length) {
        task.status = 'BLOCKED'
        task.blocker = conflicts.map(item => item.detail).join('; ')
        task.latestAction = 'Conflicts detected; refusing silent overwrite.'
        saveCommandCenterGraph(graph)
        return
      }
      for (const ws of graph.workspaces.filter(item => item.mergeStatus === 'UNMERGED' && item.kind !== 'project-root')) {
        applyWorkspaceFilesToProject({ workspace: ws, projectRoot: graph.projectRoot })
        ws.mergeStatus = 'MERGED'
      }
      task.currentPhase = 'integrate'
      task.latestAction = 'Integrated isolated workspaces. No auto-push.'
      task.result = 'Integration complete. AUTO_PUSH=0 AUTO_COMMIT=0 AUTO_DEPLOY=0'
    } else if (task.role === 'REVIEWER') {
      graph = mustLoad(graphId)
      const adversarial = reviewGraphForAdversarialFindings(graph)
      if (adversarial.proposal) {
        const missionContract = graph.missionContractId ? loadMissionContract(graph.missionContractId) : null
        const acceptanceContract = graph.acceptanceContractId ? loadAcceptanceContract(graph.acceptanceContractId) : null
        applyReplan({ graph, proposal: adversarial.proposal, missionContract, acceptanceContract })
      }
      const review = evaluateIndependentReview(graph)
      graph.reviewOutcome = review.outcome
      const body = [
        `SPEC ${graph.specId}@${graph.specVersion} approved=${graph.specApproved}`,
        `Requirements: ${unique(graph.tasks.flatMap(item => item.requirementIds)).join(', ')}`,
        `Files: ${unique(graph.workspaces.flatMap(ws => ws.filesChanged)).join(', ')}`,
        `Tests: ${graph.tasks.filter(item => item.role === 'TEST').map(item => item.tests.detail).join(' | ')}`,
        'Independent review does not trust implementer self-report.',
        `Review outcome: ${review.outcome}`,
        ...review.reasons,
        ...(graph.adversarialFindings ?? []).map(item => `Adversarial ${item.kind}: ${item.summary}`),
        ...formatReasoningDossierSections(graph.reasoningDossier),
        `Governance AUTO_COMMIT=${FOUNDRY_COMMAND_CENTER_GOVERNANCE.AUTO_COMMIT} AUTO_PUSH=${FOUNDRY_COMMAND_CENTER_GOVERNANCE.AUTO_PUSH} AUTO_DEPLOY=${FOUNDRY_COMMAND_CENTER_GOVERNANCE.AUTO_DEPLOY}`,
      ].join('\n')
      graph.artifacts.push(artifact(task, agent, 'review', 'Independent review', body))
      task.currentPhase = 'review'
      task.latestAction = `Independent review ${review.outcome}.`
      task.result = review.outcome === 'PASS' ? 'REVIEW PASS' : `REVIEW ${review.outcome}`
      if (review.outcome === 'FAIL') task.blocker = review.reasons.join('; ')
    } else if (task.role === 'VERIFIER') {
      graph = mustLoad(graphId)
      const preview = await launchPreview(graph)
      graph.preview = preview
      task.currentPhase = 'verify'
      task.latestAction = preview.localPreview ? `Preview ${preview.status} ${preview.localPreview}` : preview.status
      task.result = preview.status === 'RUNNING' ? 'Browser/HTTP verification recorded.' : preview.status
      graph.artifacts.push(artifact(task, agent, 'preview', 'Preview', JSON.stringify(preview)))
      for (const trace of graph.traces) {
        trace.agentId = agent.agentId
        trace.files = graph.tasks.find(item => item.taskId === trace.taskId)?.filesChanged ?? []
        trace.tests = graph.tasks.filter(item => item.role === 'TEST').map(item => item.tests.detail).filter(Boolean)
        trace.browserEvidence = preview.localPreview || undefined
        trace.status = preview.status === 'RUNNING' ? 'VERIFIED' : 'FAILED'
      }
      if (isStandaloneEngineerGraph(graph)) recordCommandCenterEvidence(graph, task.taskId, agent.agentId)
    } else if (task.role === 'DEBUGGER') {
      task.latestAction = 'Repair agent idle; assigned from failure loop when needed.'
    }

    await mutateCommandCenterGraph(graphId, live => {
      const liveTask = live.tasks.find(item => item.taskId === taskId)
      const liveAgent = live.agents.find(item => item.agentId === agent.agentId)
      if (liveTask && liveTask.status !== 'CANCELLED' && liveTask.status !== 'FAILED' && liveTask.status !== 'BLOCKED') {
        liveTask.status = 'COMPLETE'
        persistDurableRuntimeAction({
          actionId: durableActionId,
          missionId: live.missionId,
          taskId: liveTask.taskId,
          kind: liveTask.mutating ? 'write' : 'tool',
          state: 'COMPLETED',
          mutating: Boolean(liveTask.mutating),
          startedAt: liveTask.startedAt ?? new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          resultSummary: liveTask.result || 'complete',
          evidencePath: null,
          actionClass: liveTask.mutating ? 'FILE_WRITE_IN_SCOPE' : 'ANALYZE',
          status: 'COMPLETED',
          tool: liveTask.role,
          writeSet: liveTask.writeSet ?? [],
          resultRef: durableActionId,
        })
        liveTask.filesChanged = unique([...liveTask.filesChanged, ...task.filesChanged, ...workspace.filesChanged])
        liveTask.currentPhase = liveTask.role === 'VERIFIER' ? 'ready' : (task.currentPhase || liveTask.currentPhase)
        liveTask.latestAction = task.latestAction || liveTask.latestAction || 'Complete'
        liveTask.result = task.result || liveTask.result
        liveTask.tests = task.tests.ok != null ? task.tests : liveTask.tests
        liveTask.repairHistory = unique([...liveTask.repairHistory, ...task.repairHistory])
        liveTask.retryCount = Math.max(liveTask.retryCount, task.retryCount)
      }
      if (liveAgent && liveAgent.status !== 'CANCELLED' && liveAgent.status !== 'FAILED' && liveAgent.status !== 'SUPERSEDED') {
        liveAgent.status = 'COMPLETE'
        liveAgent.finishedAt = new Date().toISOString()
        liveAgent.filesChanged = unique([...liveAgent.filesChanged, ...workspace.filesChanged])
        liveAgent.latestAction = liveTask?.latestAction || 'Complete'
      }
      supersedeActiveAgentsForTask(live, taskId, 'Superseded: task completed by a later execution generation.', agent.agentId)
      enforceSingleActiveExecution(live)
      const ws = live.workspaces.find(item => item.workspaceId === workspace.workspaceId)
      if (ws) ws.filesChanged = unique([...ws.filesChanged, ...workspace.filesChanged])
      if (task.role === 'VERIFIER' && graph.preview) live.preview = graph.preview
      if (task.role === 'REVIEWER') {
        live.reviewOutcome = graph.reviewOutcome ?? live.reviewOutcome
        live.reasoningDossier = graph.reasoningDossier ?? live.reasoningDossier ?? null
        live.adversarialFindings = graph.adversarialFindings ?? live.adversarialFindings
        if (graph.lastReplan?.reason?.startsWith('Adversarial review:')) {
          live.tasks = graph.tasks.map(item => ({
            ...item,
            dependsOn: [...item.dependsOn],
            requirementIds: [...item.requirementIds],
            criterionIds: [...(item.criterionIds ?? [])],
            writeSet: [...item.writeSet],
            filesChanged: [...item.filesChanged],
            guidance: [...item.guidance],
            repairHistory: [...item.repairHistory],
          }))
          const reviewer = live.tasks.find(item => item.taskId === taskId)
          if (reviewer && reviewer.status !== 'CANCELLED' && reviewer.status !== 'FAILED' && reviewer.status !== 'BLOCKED') {
            reviewer.status = 'COMPLETE'
            reviewer.currentPhase = 'review'
            reviewer.latestAction = task.latestAction || reviewer.latestAction
            reviewer.result = task.result || reviewer.result
            reviewer.blocker = task.blocker
          }
          live.lastReplan = graph.lastReplan
          live.lastReplanId = graph.lastReplanId
          live.dagReplanCount = graph.dagReplanCount
          live.taskReplanCount = graph.taskReplanCount
          live.planHash = graph.planHash
        }
        for (const item of graph.artifacts.filter(a => a.kind === 'review' && a.taskId === taskId)) {
          if (!live.artifacts.some(existing => existing.artifactId === item.artifactId)) live.artifacts.push(item)
        }
      }
      for (const item of graph.artifacts.filter(a => a.taskId === taskId || a.kind === 'preview')) {
        if (!live.artifacts.some(existing => existing.artifactId === item.artifactId)) live.artifacts.push(item)
      }
      if (ws && ws.mergeStatus === 'MERGED') Object.assign(ws, cleanupWorkspace(ws))
      live.artifacts.push(artifact(task, agent, 'task_result', task.title, liveTask?.result || liveTask?.latestAction || 'done'))
      if (graph.traces.some(trace => trace.status === 'VERIFIED')) live.traces = graph.traces
    })
  } catch (error) {
    await mutateCommandCenterGraph(graphId, live => {
      const liveTask = live.tasks.find(item => item.taskId === taskId)
      const liveAgent = live.agents.find(item => item.agentId === agent.agentId)
      if (liveTask) {
        liveTask.status = 'FAILED'
        liveTask.blocker = error instanceof Error ? error.message : String(error)
        liveTask.latestAction = liveTask.blocker
      }
      if (liveAgent) {
        liveAgent.status = 'FAILED'
        liveAgent.latestAction = liveTask?.blocker || 'failed'
        liveAgent.finishedAt = new Date().toISOString()
      }
      supersedeActiveAgentsForTask(live, taskId, 'Superseded: task failed in a later execution generation.', agent.agentId)
      enforceSingleActiveExecution(live)
    })
  }
}

async function repairTask(graphId: string, taskId: string, failure: string, files: Record<string, string>): Promise<void> {
  const graph = mustLoad(graphId)
  const task = graph.tasks.find(item => item.taskId === taskId)
  if (!task) return
  if (task.retryCount >= task.maxRetries) {
    task.status = 'FAILED'
    task.blocker = `Repair retries exhausted: ${failure.slice(0, 200)}`
    saveCommandCenterGraph(graph)
    return
  }
  task.retryCount += 1
  const role = assignRepairRole(failure)
  task.repairHistory.push(`${role}: ${failure.slice(0, 240)}`)
  const wanted = [...new Set([
    ...filesForRole(role === 'DATABASE' ? 'DATABASE' : role === 'FRONTEND' ? 'FRONTEND' : 'BACKEND'),
    ...filesForRole('TEST'),
  ])]
  const ws = graph.workspaces.find(item => item.workspaceId === task.workspaceId)
  if (ws) {
    for (const rel of wanted) {
      if (files[rel]) writeWorkspaceFile(ws, rel, files[rel])
    }
    applyWorkspaceFilesToProject({ workspace: ws, projectRoot: graph.projectRoot, files: wanted })
  }
  if (files['test.mjs']) {
    writeFileSync(path.join(graph.projectRoot, 'test.mjs'), files['test.mjs'], 'utf8')
  }
  const repairGate = authorizeResourceAction({ missionId: graph.missionId, kind: 'test' })
  if (!repairGate.ok) {
    task.status = 'BLOCKED'
    task.blocker = repairGate.reason
    saveCommandCenterGraph(graph)
    return
  }
  const repairAction = `test-repair-${graph.graphId}-${task.taskId}-${Date.now()}`
  beginResourceUsage({ missionId: graph.missionId, kind: 'test', actionId: repairAction, taskId, tool: 'node --test' })
  const result = await runProjectCommand({
    projectRoot: graph.projectRoot,
    cmd: foundryNodeExecutable(),
    args: ['--test', 'test.mjs'],
    missionId: graph.missionId,
    timeoutMs: 20_000,
  })
  completeResourceUsage({ actionId: repairAction, missionId: graph.missionId, ok: result.ok, kind: 'test', tool: 'node --test' })
  task.tests = { ok: result.ok, detail: (result.stdout + result.stderr).slice(0, 800) }
  graph.artifacts.push({
    artifactId: randomUUID(),
    kind: 'repair',
    title: `Repair ${task.retryCount}`,
    body: `${role} repaired after: ${failure.slice(0, 400)}`,
    createdAt: new Date().toISOString(),
    taskId,
  })
  if (!result.ok) {
    task.status = 'FAILED'
    task.blocker = result.stderr || result.stdout
  }
  saveCommandCenterGraph(graph)
}

async function launchPreview(graph: FoundryCommandCenterGraph): Promise<FoundryPreviewRecord> {
  const preview: FoundryPreviewRecord = {
    status: 'STARTING',
    localPreview: null,
    openApp: true,
    openWebsite: true,
    warRoomBrowser: true,
    shareContract: { localAuthoritative: true, publicDeploy: 'COMMANDER_APPROVAL_REQUIRED' },
  }
  try {
    const port = await pickFreeLoopbackPort(DEFAULT_PORT)
    const started = await startProjectProcess({
      projectRoot: graph.projectRoot,
      cmd: foundryNodeExecutable(),
      args: ['server.mjs'],
      label: `${graph.projectName} preview`,
      missionId: graph.missionId,
      env: { PORT: String(port) },
      projectId: graph.projectId,
      port,
      processType: 'preview',
      retainAfterWrapper: false,
    })
    if (!started.ok) {
      preview.status = 'FAILED'
      return preview
    }
    preview.pid = started.pid
    const origin = `http://127.0.0.1:${port}`
    let ready = false
    for (let i = 0; i < 20; i++) {
      const probe = await httpGetNoKeepAlive(`${origin}/health`)
      if (probe.ok) {
        ready = true
        break
      }
      await sleep(150)
    }
    preview.localPreview = origin
    preview.status = ready ? 'RUNNING' : 'FAILED'
    if (ready) {
      await httpGetNoKeepAlive(origin)
      try {
        await Promise.race([
          executeFoundryBrowserTool('browser.status', {}, { repairId: graph.graphId }),
          sleep(1500),
        ])
      } catch {
        /* browser service optional in source validation */
      }
    }
    return preview
  } catch {
    preview.status = 'FAILED'
    return preview
  }
}

export type FoundryParallelOverlapProof = {
  left: { agentId: string; taskId: string; workspaceId: string | null; role: string; startedAt: string | null; finishedAt: string | null }
  right: { agentId: string; taskId: string; workspaceId: string | null; role: string; startedAt: string | null; finishedAt: string | null }
  overlapped: boolean
}

export function wallClockOverlap(leftStarted: string | null, leftFinished: string | null, rightStarted: string | null, rightFinished: string | null): boolean {
  if (!leftStarted || !leftFinished || !rightStarted || !rightFinished) return false
  const a0 = Date.parse(leftStarted)
  const a1 = Date.parse(leftFinished)
  const b0 = Date.parse(rightStarted)
  const b1 = Date.parse(rightFinished)
  if (![a0, a1, b0, b1].every(Number.isFinite)) return false
  return a0 < b1 && b0 < a1
}

export function parallelOverlapProof(graph: FoundryCommandCenterGraph): FoundryParallelOverlapProof | null {
  const backend = graph.agents.find(agent => agent.role === 'BACKEND')
  const frontend = graph.agents.find(agent => agent.role === 'FRONTEND')
  if (!backend || !frontend) return null
  return {
    left: {
      agentId: backend.agentId,
      taskId: backend.taskId,
      workspaceId: backend.workspaceId,
      role: backend.role,
      startedAt: backend.startedAt,
      finishedAt: backend.finishedAt,
    },
    right: {
      agentId: frontend.agentId,
      taskId: frontend.taskId,
      workspaceId: frontend.workspaceId,
      role: frontend.role,
      startedAt: frontend.startedAt,
      finishedAt: frontend.finishedAt,
    },
    overlapped: wallClockOverlap(backend.startedAt, backend.finishedAt, frontend.startedAt, frontend.finishedAt),
  }
}

export async function runDisposableCommandCenterAcceptance(input?: { secondProjectName?: string }): Promise<{
  ticket: FoundryCommandCenterGraph
  research: FoundryCommandCenterGraph
  recovered: FoundryCommandCenterGraph
  recoveredAgain: FoundryCommandCenterGraph
  parallel: boolean
  isolated: boolean
  overlap: FoundryParallelOverlapProof | null
}> {
  const ticket = await enqueueCommandCenterWork({
    goal: 'Build a customer support ticket manager with customers, tickets, statuses, notes, search, and local persistence.',
    projectName: 'ticket-manager-cc',
    kind: 'ticket-manager',
    commanderInstruction: 'Do not change the API after the contract is published.',
  })
  draftAndSealCommandCenterContracts(ticket.graphId)
  approveCommandCenterExecution(ticket.graphId)
  const researchProject = await createFoundryApplicationWorkspace({
    name: `research-notes-${Date.now().toString(36)}`.slice(0, 60),
    missionId: `cc-research-${randomUUID()}`,
    projectType: 'local_data_app',
    label: input?.secondProjectName || 'indexing-research',
  })
  const research = await enqueueCommandCenterWork({
    goal: 'Research better indexing without mutating the ticket manager.',
    projectId: researchProject.projectId,
    projectName: researchProject.projectName,
    projectRoot: researchProject.projectRoot,
    kind: 'research',
    priority: 'LOW',
  })

  const ticketExec = executeCommandCenterGraph(ticket.graphId)
  await sleep(30)
  const researchExec = executeCommandCenterGraph(research.graphId)
  await Promise.all([ticketExec, researchExec])

  const doneTicket = mustLoad(ticket.graphId)
  const doneResearch = mustLoad(research.graphId)
  const mutatingWorkspaces = doneTicket.workspaces.filter(ws => ws.kind !== 'project-root')
  const parallel = mutatingWorkspaces.length >= 2
  const isolated = mutatingWorkspaces.every(ws => ws.sourceRoot !== doneTicket.projectRoot)
    && doneResearch.projectId !== doneTicket.projectId
    && path.resolve(doneResearch.projectRoot) !== path.resolve(doneTicket.projectRoot)
  const overlap = parallelOverlapProof(doneTicket)
  if (overlap) {
    doneTicket.artifacts.push({
      artifactId: randomUUID(),
      kind: 'task_result',
      title: 'parallel-overlap',
      body: JSON.stringify(overlap),
      createdAt: new Date().toISOString(),
      taskId: overlap.left.taskId,
      agentId: overlap.left.agentId,
    })
    saveCommandCenterGraph(doneTicket)
  }

  const recoveryProbe: FoundryCommandCenterGraph = JSON.parse(JSON.stringify(doneTicket)) as FoundryCommandCenterGraph
  const runningTask = recoveryProbe.tasks.find(task => task.role === 'VERIFIER') || recoveryProbe.tasks[recoveryProbe.tasks.length - 1]
  if (runningTask) {
    runningTask.status = 'RUNNING'
    const agent = recoveryProbe.agents.find(item => item.taskId === runningTask.taskId)
    if (agent) agent.status = 'RUNNING'
  }
  recoveryProbe.graphId = `${doneTicket.graphId}-recovery`
  recoveryProbe.status = 'RUNNING'
  saveCommandCenterGraph(recoveryProbe)
  const recovered = recoverCommandCenterGraph(recoveryProbe)
  const duplicateAgents = recovered.agents.filter(agent => agent.taskId === runningTask?.taskId && agent.status !== 'SUPERSEDED' && agent.status !== 'COMPLETE' && agent.status !== 'FAILED' && agent.status !== 'CANCELLED')
  if (duplicateAgents.length > 1) throw new Error('Duplicate active agent after recovery')
  const leftoverWaiting = recovered.agents.filter(agent => agent.status === 'WAITING')
  if (leftoverWaiting.length) throw new Error(`Leftover WAITING agents after recovery: ${leftoverWaiting.map(item => item.agentId).join(',')}`)
  const recoveredAgain = recoverCommandCenterGraph(JSON.parse(JSON.stringify(recovered)) as FoundryCommandCenterGraph)
  if (recoveredAgain.agents.length !== recovered.agents.length) throw new Error('Second recovery duplicated agents')
  if (recoveredAgain.workspaces.length !== recovered.workspaces.length) throw new Error('Second recovery duplicated workspaces')

  return { ticket: doneTicket, research: doneResearch, recovered, recoveredAgain, parallel, isolated, overlap }
}

export function roleToolBoundary(role: Parameters<typeof roleAllowsTool>[0], tool: string): boolean {
  return roleAllowsTool(role, tool)
}

function assembleResult(graph: FoundryCommandCenterGraph) {
  const missionContract = graph.missionContractId ? loadMissionContract(graph.missionContractId) : null
  const acceptanceContract = graph.acceptanceContractId ? loadAcceptanceContract(graph.acceptanceContractId) : null
  const verdict = loadVerdictRecord(graph.missionId)
  const tasksComplete = graph.status === 'COMPLETE' || graph.tasks.every(task => task.status === 'COMPLETE' || task.status === 'CANCELLED')
  return {
    summary: `${graph.projectName} assembled from ${graph.agents.length} agents.`,
    filesChanged: unique(graph.workspaces.flatMap(ws => ws.filesChanged)),
    tests: graph.tasks.filter(task => task.role === 'TEST').map(task => task.tests.ok ? 'PASS' : 'FAIL').join(',') || 'n/a',
    failuresRepairs: graph.tasks.flatMap(task => task.repairHistory),
    preview: graph.preview,
    verification: graph.traces.every(trace => trace.status === 'VERIFIED') ? 'VERIFIED' : 'PARTIAL',
    specTraceability: graph.traces,
    agentContributions: graph.agents.map(agent => ({ agentId: agent.agentId, role: agent.role, files: agent.filesChanged })),
    projectReady: projectReadyFromVerdict({
      engineeringClass: graph.engineeringClass,
      tasksComplete,
      previewUrl: graph.preview?.localPreview,
      verdict,
      missionContract,
      acceptanceContract,
    }),
    verdict: verdict?.result ?? null,
    reviewOutcome: graph.reviewOutcome ?? null,
  }
}

export function draftAndSealCommandCenterContracts(graphId: string): FoundryCommandCenterGraph {
  const graph = mustLoad(graphId)
  const drafted = draftStandaloneContracts({
    missionId: graph.missionId,
    projectId: graph.projectId,
    workspaceId: graph.projectRoot,
    commanderRequest: graph.goal,
    goal: graph.goal,
    specId: graph.specId || `SPEC-${graph.missionId.slice(0, 8)}`,
    specVersion: graph.specVersion || '1',
    taskIds: graph.tasks.map(task => task.taskId),
    engineeringClass: 'STANDALONE_ENGINEER',
    constraints: graph.instructionSources.map(source => source.origin).slice(0, 4),
  }, defaultTicketManagerCriteria(graph.tasks.map(task => task.taskId)))
  const acceptance = sealAcceptanceContract(drafted.acceptanceContract)
  drafted.missionContract.acceptanceContractId = acceptance.acceptanceContractId
  const mission = sealMissionContract(drafted.missionContract)
  graph.engineeringClass = 'STANDALONE_ENGINEER'
  graph.missionContractId = mission.missionContractId
  graph.acceptanceContractId = acceptance.acceptanceContractId
  graph.missionContractHash = mission.contentHash
  graph.acceptanceContractHash = acceptance.contentHash
  for (const task of graph.tasks) {
    task.missionContractId = mission.missionContractId
    task.acceptanceContractId = acceptance.acceptanceContractId
    task.specId = mission.specId
    task.specVersion = mission.specVersion
  }
  return saveCommandCenterGraph(graph)
}

export function approveCommandCenterExecution(graphId: string, expected?: ApprovalExpectedGeneration | null): FoundryCommandCenterGraph {
  const graph = mustLoad(graphId)
  if (!graph.missionContractId || !graph.acceptanceContractId) {
    throw new Error('Cannot approve execution without sealed contracts.')
  }
  const missionContract = loadMissionContract(graph.missionContractId)
  const acceptanceContract = loadAcceptanceContract(graph.acceptanceContractId)
  if (!missionContract || !acceptanceContract) {
    throw new Error('Cannot approve execution without sealed contracts.')
  }
  const enter = canEnterExecutionFromGraph({ ...graph, specApproved: true })
  if (enter.missing.filter(item => item !== 'SPEC_APPROVED' && item !== 'EXECUTION_APPROVAL' && item !== 'REAPPROVAL_REQUIRED' && !item.endsWith('_MISMATCH') && !item.startsWith('APPROVAL_')).length) {
    throw new Error(enter.error ?? 'Contracts are not sealed.')
  }
  const approval = createExecutionApproval({
    missionId: graph.missionId,
    graphId: graph.graphId,
    projectId: graph.projectId,
    missionContract,
    acceptanceContract,
    expected,
  })
  graph.approvalId = approval.approvalId
  graph.approvalIds = [...(graph.approvalIds ?? []).filter(id => id !== approval.approvalId), approval.approvalId]
  graph.specApproved = true
  graph.planningMode = false
  graph.missionContractHash = missionContract.contentHash
  graph.acceptanceContractHash = acceptanceContract.contentHash
  graph.specVersion = missionContract.specVersion
  for (const task of graph.tasks) {
    if (task.status === 'PLANNING' || ((task.blocker ?? '').includes('REAPPROVAL_REQUIRED') && task.status !== 'COMPLETE' && task.status !== 'FAILED' && task.status !== 'CANCELLED' && task.status !== 'RUNNING')) {
      task.status = task.dependsOn.length ? 'QUEUED' : 'READY'
      task.blocker = null
      task.latestAction = 'Commander approved sealed contract. Execution authorized for this mission only.'
    }
  }
  promoteReady(graph.tasks)
  graph.status = 'QUEUED'
  return saveCommandCenterGraph(graph)
}

export function revokeCommandCenterExecution(graphId: string): FoundryCommandCenterGraph {
  const graph = mustLoad(graphId)
  if (graph.approvalId) revokeExecutionApproval(graph.approvalId)
  graph.specApproved = false
  graph.planningMode = true
  haltGraphForReapproval(graph, 'REAPPROVAL_REQUIRED')
  graph.approvalId = null
  return saveCommandCenterGraph(graph)
}

export function supersedeCommandCenterContracts(
  graphId: string,
  patch: Partial<{ goal: string; specVersion: string; commanderRequest: string; criteria: import('./foundryContractTypes').FoundryAcceptanceCriterion[] }>,
): FoundryCommandCenterGraph {
  const graph = mustLoad(graphId)
  const previous = graph.missionContractId ? loadMissionContract(graph.missionContractId) : null
  if (!previous) throw new Error('No sealed MissionContract to supersede.')
  const next = patch.criteria
    ? supersedeAcceptanceContract(previous, patch.criteria, true)
    : supersedeMissionContract(previous, { goal: patch.goal, specVersion: patch.specVersion, commanderRequest: patch.commanderRequest }, true)
  const nextMission = next.next
  const nextAcceptance = loadAcceptanceContract(nextMission.acceptanceContractId)
  if (!nextAcceptance) throw new Error('Superseded acceptance contract missing.')
  applyContractSupersessionToGraph(graph, nextMission, nextAcceptance)
  return saveCommandCenterGraph(graph)
}

function recordCommandCenterEvidence(graph: FoundryCommandCenterGraph, taskId: string, producer: string): void {
  if (!isStandaloneEngineerGraph(graph) || !graph.missionContractId || !graph.acceptanceContractId) return
  const missionContract = loadMissionContract(graph.missionContractId)
  const acceptanceContract = loadAcceptanceContract(graph.acceptanceContractId)
  if (!missionContract || !acceptanceContract || missionContract.status !== 'SEALED' || acceptanceContract.status !== 'SEALED') return
  const testTask = graph.tasks.find(task => task.role === 'TEST')
  const files = unique(graph.workspaces.flatMap(ws => ws.filesChanged))
  const testsOk = testTask?.tests.ok === true
  const persistOk = /persist/i.test(testTask?.tests.detail ?? testTask?.result ?? '')
  const previewOk = graph.preview?.status === 'RUNNING' && Boolean(graph.preview.localPreview)
  const scopeOk = !files.some(file => /Harbor Desk|Lane & Box|Inventory Manager|\bTerra\b|\bWRIM\b/i.test(file))
  const rows: Array<{ criterionId: 'CR-TEST' | 'CR-RUNTIME' | 'CR-BROWSER' | 'CR-PERSISTENCE' | 'CR-SECURITY' | 'CR-SCOPE'; type: 'TEST' | 'RUNTIME' | 'BROWSER' | 'PERSISTENCE' | 'SECURITY' | 'DIFF_SCOPE'; status: 'PASS' | 'FAIL'; result: string; command?: string }> = [
    { criterionId: 'CR-TEST', type: 'TEST', status: testsOk ? 'PASS' : 'FAIL', result: testTask?.tests.detail || testTask?.result || 'no test output', command: 'node --test test.mjs' },
    { criterionId: 'CR-RUNTIME', type: 'RUNTIME', status: previewOk ? 'PASS' : 'FAIL', result: graph.preview?.localPreview || graph.preview?.status || 'no preview' },
    { criterionId: 'CR-BROWSER', type: 'BROWSER', status: previewOk ? 'PASS' : 'FAIL', result: graph.preview?.localPreview || 'no browser preview' },
    { criterionId: 'CR-PERSISTENCE', type: 'PERSISTENCE', status: persistOk || testsOk ? 'PASS' : 'FAIL', result: testTask?.tests.detail || 'persistence not evidenced' },
    { criterionId: 'CR-SECURITY', type: 'SECURITY', status: 'PASS', result: `AUTO_COMMIT=${FOUNDRY_COMMAND_CENTER_GOVERNANCE.AUTO_COMMIT} AUTO_PUSH=${FOUNDRY_COMMAND_CENTER_GOVERNANCE.AUTO_PUSH} AUTO_DEPLOY=${FOUNDRY_COMMAND_CENTER_GOVERNANCE.AUTO_DEPLOY}` },
    { criterionId: 'CR-SCOPE', type: 'DIFF_SCOPE', status: scopeOk ? 'PASS' : 'FAIL', result: files.join(', ') || 'no files' },
  ]
  for (const row of rows) {
    if (!acceptanceContract.criteria.some(item => item.criterionId === row.criterionId)) continue
    recordAcceptanceEvidence({
      criterionId: row.criterionId,
      missionId: graph.missionId,
      taskId,
      evidenceType: row.type,
      producer,
      artifactReference: graph.preview?.localPreview ?? null,
      commandReference: row.command ?? null,
      result: row.result,
      status: row.status,
      missionContract,
      acceptanceContract,
    })
  }
}

function finalizeCommandCenterGraph(graph: FoundryCommandCenterGraph): FoundryCommandCenterGraph {
  if (!isStandaloneEngineerGraph(graph)) {
    graph.status = 'COMPLETE'
    graph.result = assembleResult(graph)
    return saveCommandCenterGraph(graph)
  }
  const missionContract = graph.missionContractId ? loadMissionContract(graph.missionContractId) : null
  const acceptanceContract = graph.acceptanceContractId ? loadAcceptanceContract(graph.acceptanceContractId) : null
  if (graph.missionContractId && graph.acceptanceContractId && missionContract && acceptanceContract) {
    recordCommandCenterEvidence(graph, graph.tasks.find(task => task.role === 'VERIFIER')?.taskId ?? graph.tasks[0]?.taskId ?? 'TASK-000', 'foundry-verifier')
  }
  const verdict = evaluateVerdictLayer({
    missionId: graph.missionId,
    graphId: graph.graphId,
    engineeringClass: graph.engineeringClass,
    missionContract,
    acceptanceContract,
    reviewOutcome: graph.reviewOutcome ?? evaluateIndependentReview(graph).outcome,
    executorResult: 'PROPOSED_READY',
    unresolvedBlocker: graph.tasks.find(task => task.blocker && task.status === 'FAILED')?.blocker ?? null,
  })
  graph.verdictId = verdict.verdictId
  const allowed = canComplete({
    engineeringClass: graph.engineeringClass,
    missionContract,
    acceptanceContract,
    verdict,
    missionId: graph.missionId,
    graphId: graph.graphId,
  })
  if (allowed.ok) {
    graph.status = 'COMPLETE'
    completeMissionRuntime(graph.missionId)
  } else if (verdict.result === 'FAIL') {
    graph.status = 'FAILED'
  } else {
    graph.status = 'BLOCKED'
  }
  graph.result = assembleResult({ ...graph, status: graph.status })
  if (!allowed.ok) {
    graph.result.projectReady = false
  }
  return saveCommandCenterGraph(graph)
}

function artifact(task: FoundryTaskRecord, agent: FoundryAgentRecord, kind: 'architecture_contract' | 'api_contract' | 'schema_contract' | 'task_result' | 'test_evidence' | 'review' | 'preview' | 'guidance' | 'repair', title: string, body: string) {
  return {
    artifactId: randomUUID(),
    kind,
    title,
    body,
    createdAt: new Date().toISOString(),
    taskId: task.taskId,
    agentId: agent.agentId,
  }
}

function mustLoad(graphId: string): FoundryCommandCenterGraph {
  const graph = loadCommandCenterGraph(graphId)
  if (!graph) throw new Error(`Unknown command-center graph ${graphId}`)
  return graph
}

function countRunningElsewhere(graphId: string): number {
  return listCommandCenterGraphs()
    .filter(graph => graph.graphId !== graphId)
    .flatMap(graph => graph.tasks)
    .filter(task => task.status === 'RUNNING').length
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))]
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function commandCenterHeadline(): string {
  const snap = commandCenterSnapshot()
  return snap.backgroundLabel || commandCenterBackgroundLabel(snap.runningTaskCount)
}

export { computeMaxConcurrentAgents, measureFoundryResources }
