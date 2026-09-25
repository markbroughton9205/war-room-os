/**
 * Persistent command-center store. Mission/task graphs survive page switches and War Room restarts.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { foundryDataHierarchy } from './foundryPaths'
import { recoverVerdictState } from './foundryVerdictLayer'
import { evaluateApprovalBinding, recoverApprovalBinding, haltGraphForReapproval } from './foundryExecutionApproval'
import { loadAcceptanceContract, loadMissionContract, listReplanRecords } from './foundryContractStore'
import { recoverReplanCounters } from './foundryReplanEngine'
import { attachResourceViewToGraph, recoverResourceBudget } from './foundryResourceGovernor'
import { attachRuntimeViewToGraph, loadActiveMissionRuntime, reconcileMissionRuntime, runDueWakes, recoverFoundryMissionRuntimes, installFoundryRuntimeShutdownHooks } from './foundryMissionRuntime'
import { recoverUnattendedEnvelopes, recoverUnattendedRunningTasks, attachUnattendedViewToGraph } from './foundryUnattendedEngineer'
import { loadActiveUnattendedEnvelope } from './foundryUnattendedStore'
import { FOUNDRY_UNATTENDED_TERMINAL_STATES } from './foundryUnattendedTypes'
import { ensureAcceptedEngineeringEvidenceHydrated, overlayInstalledProductionProofs } from './foundryAcceptedCapabilityEvidence'
import { buildEngineeringCapabilitiesView } from './foundryEngineeringGraduationStore'
import {
  commandCenterBackgroundLabel,
  FOUNDRY_COMMAND_CENTER_GOVERNANCE,
  isActiveExecutionStatus,
  isTerminalTaskStatus,
  type FoundryAgentRecord,
  type FoundryCommandCenterGraph,
  type FoundryCommandCenterSnapshot,
} from './foundryAgentTypes'

function rootDir(): string {
  const dir = process.env.FOUNDRY_COMMAND_CENTER_ROOT?.trim() || foundryDataHierarchy().commandCenter
  mkdirSync(path.join(dir, 'graphs'), { recursive: true })
  return dir
}

function graphPath(graphId: string): string {
  return path.join(rootDir(), 'graphs', `${graphId}.json`)
}

function recoverIfNewProcess(): void {
  const stamp = path.join(rootDir(), 'boot.json')
  let previous: number | null = null
  try {
    previous = JSON.parse(readFileSync(stamp, 'utf8')).pid as number
  } catch {
    previous = null
  }
  if (previous === process.pid) return
  recoverAllCommandCenterGraphs()
  recoverFoundryMissionRuntimes()
  runDueWakes()
  recoverUnattendedEnvelopes()
  installFoundryRuntimeShutdownHooks()
  writeFileSync(stamp, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), 'utf8')
}

const graphLocks = new Map<string, Promise<void>>()

export async function withCommandCenterLock<T>(graphId: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = graphLocks.get(graphId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  graphLocks.set(graphId, previous.then(() => gate))
  await previous
  try {
    return await fn()
  } finally {
    release()
    if (graphLocks.get(graphId) === gate) graphLocks.delete(graphId)
  }
}

export async function mutateCommandCenterGraph(graphId: string, mutator: (graph: FoundryCommandCenterGraph) => void): Promise<FoundryCommandCenterGraph> {
  return withCommandCenterLock(graphId, () => {
    const graph = loadCommandCenterGraph(graphId)
    if (!graph) throw new Error(`Unknown command-center graph ${graphId}`)
    mutator(graph)
    return saveCommandCenterGraph(graph)
  })
}

export function saveCommandCenterGraph(graph: FoundryCommandCenterGraph): FoundryCommandCenterGraph {
  graph.updatedAt = new Date().toISOString()
  const dest = graphPath(graph.graphId)
  const tmp = `${dest}.tmp`
  writeFileSync(tmp, JSON.stringify(graph, null, 2), 'utf8')
  renameSync(tmp, dest)
  return graph
}

export function loadCommandCenterGraph(graphId: string): FoundryCommandCenterGraph | null {
  const dest = graphPath(graphId)
  if (!existsSync(dest)) return null
  try {
    return JSON.parse(readFileSync(dest, 'utf8')) as FoundryCommandCenterGraph
  } catch {
    return null
  }
}

export function listCommandCenterGraphs(): FoundryCommandCenterGraph[] {
  const dir = path.join(rootDir(), 'graphs')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => {
      try {
        return JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as FoundryCommandCenterGraph
      } catch {
        return null
      }
    })
    .filter((graph): graph is FoundryCommandCenterGraph => Boolean(graph))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function commandCenterSnapshot(): FoundryCommandCenterSnapshot {
  recoverIfNewProcess()
  ensureAcceptedEngineeringEvidenceHydrated()
  const graphs = listCommandCenterGraphs().map(graph => attachUnattendedViewToGraph(attachRuntimeViewToGraph(attachResourceViewToGraph({ ...graph }))))
  const running = graphs.flatMap(graph => graph.tasks).filter(task => task.status === 'RUNNING' || task.status === 'WAITING').length
  const queued = graphs.flatMap(graph => graph.tasks).filter(task => task.status === 'QUEUED' || task.status === 'READY' || task.status === 'PLANNING').length
  return {
    graphs,
    runningTaskCount: running,
    queuedTaskCount: queued,
    backgroundLabel: commandCenterBackgroundLabel(running),
    governance: FOUNDRY_COMMAND_CENTER_GOVERNANCE,
    engineeringCapabilities: overlayInstalledProductionProofs(buildEngineeringCapabilitiesView()),
  }
}

export function maxExecutionGeneration(graph: FoundryCommandCenterGraph, taskId: string): number {
  return graph.agents
    .filter(agent => agent.taskId === taskId)
    .reduce((max, agent) => Math.max(max, agent.executionGeneration || 0), 0)
}

export function duplicateActiveAgentsPerTask(graph: FoundryCommandCenterGraph): number {
  const counts = new Map<string, number>()
  for (const agent of graph.agents) {
    if (!isActiveExecutionStatus(agent.status)) continue
    counts.set(agent.taskId, (counts.get(agent.taskId) ?? 0) + 1)
  }
  let duplicates = 0
  for (const count of counts.values()) {
    if (count > 1) duplicates += count - 1
  }
  return duplicates
}

export function supersedeActiveAgentsForTask(
  graph: FoundryCommandCenterGraph,
  taskId: string,
  reason: string,
  keepAgentId?: string,
): boolean {
  const now = new Date().toISOString()
  let changed = false
  for (const agent of graph.agents) {
    if (agent.taskId !== taskId) continue
    if (keepAgentId && agent.agentId === keepAgentId) continue
    if (!isActiveExecutionStatus(agent.status)) continue
    agent.status = 'SUPERSEDED'
    agent.finishedAt = agent.finishedAt ?? now
    agent.latestAction = reason
    changed = true
  }
  return changed
}

export function enforceSingleActiveExecution(graph: FoundryCommandCenterGraph): boolean {
  const now = new Date().toISOString()
  let changed = false
  const terminalTaskIds = new Set(
    graph.tasks.filter(task => isTerminalTaskStatus(task.status)).map(task => task.taskId),
  )
  for (const agent of graph.agents) {
    if (!terminalTaskIds.has(agent.taskId)) continue
    if (!isActiveExecutionStatus(agent.status)) continue
    agent.status = 'SUPERSEDED'
    agent.finishedAt = agent.finishedAt ?? now
    agent.latestAction = 'Superseded: owning task is already terminal; leftover execution is historical and non-runnable.'
    changed = true
  }
  const activeByTask = new Map<string, FoundryAgentRecord[]>()
  for (const agent of graph.agents) {
    if (!isActiveExecutionStatus(agent.status)) continue
    const bucket = activeByTask.get(agent.taskId) ?? []
    bucket.push(agent)
    activeByTask.set(agent.taskId, bucket)
  }
  for (const agents of activeByTask.values()) {
    if (agents.length <= 1) continue
    agents.sort((a, b) => b.executionGeneration - a.executionGeneration)
    for (const extra of agents.slice(1)) {
      extra.status = 'SUPERSEDED'
      extra.finishedAt = extra.finishedAt ?? now
      extra.latestAction = `Superseded by execution generation ${agents[0].executionGeneration}.`
      changed = true
    }
  }
  return changed
}

export function recoverCommandCenterGraph(graph: FoundryCommandCenterGraph): FoundryCommandCenterGraph {
  const seenAgents = new Set<string>()
  const agents: FoundryAgentRecord[] = []
  let changed = false
  const now = new Date().toISOString()
  for (const agent of graph.agents) {
    if (seenAgents.has(agent.agentId) || seenAgents.has(`${agent.taskId}:${agent.executionGeneration}:${agent.agentId}`)) continue
    seenAgents.add(agent.agentId)
    seenAgents.add(`${agent.taskId}:${agent.executionGeneration}:${agent.agentId}`)
    if (agent.status === 'RUNNING') {
      agents.push({
        ...agent,
        status: 'SUPERSEDED',
        finishedAt: agent.finishedAt ?? now,
        latestAction: 'Superseded after restart; a later execution generation owns legal resume (no duplicate WAITING owner).',
      })
      changed = true
    } else {
      agents.push(agent)
    }
  }
  const tasks = graph.tasks.map(task => {
    if (isTerminalTaskStatus(task.status)) return task
    if (task.status === 'RUNNING') {
      const envelope = graph.missionId ? loadActiveUnattendedEnvelope(graph.missionId) : null
      const unattendedLive = Boolean(envelope && !envelope.revokedAt && !FOUNDRY_UNATTENDED_TERMINAL_STATES.includes(envelope.status))
      if (unattendedLive && task.mutating) {
        return task
      }
      changed = true
      return {
        ...task,
        status: 'READY' as const,
        currentPhase: task.currentPhase,
        latestAction: 'Restart recovery: resumable work re-queued. Completed agents remain complete. Prior running agent superseded.',
      }
    }
    return task
  })
  graph.agents = agents
  graph.tasks = tasks
  if (enforceSingleActiveExecution(graph)) changed = true
  const runtime = graph.missionId ? loadActiveMissionRuntime(graph.missionId) : null
  const keepPaused = graph.paused || runtime?.state === 'PAUSED'
  const keepCancelled = graph.cancelRequested || graph.status === 'CANCELLED' || runtime?.state === 'CANCELLED' || runtime?.cancelRequested
  if (changed) {
    if (!keepPaused) graph.paused = false
    graph.recoveryCount += 1
    graph.lastRecoveryAt = now
  }
  if (keepPaused) {
    graph.paused = true
    graph.status = 'PAUSED'
  }
  if (keepCancelled) {
    graph.cancelRequested = true
    graph.status = 'CANCELLED'
  }
  if (graph.engineeringClass === 'STANDALONE_ENGINEER' && graph.missionId) {
    recoverVerdictState(graph.missionId)
    const binding = recoverApprovalBinding({
      engineeringClass: graph.engineeringClass,
      missionId: graph.missionId,
      graphId: graph.graphId,
      missionContract: graph.missionContractId ? loadMissionContract(graph.missionContractId) : null,
      acceptanceContract: graph.acceptanceContractId ? loadAcceptanceContract(graph.acceptanceContractId) : null,
    })
    if (binding.reapprovalRequired) haltGraphForReapproval(graph, binding.reason ?? 'REAPPROVAL_REQUIRED')
  }
  recoverReplanCounters(graph, listReplanRecords(graph.graphId))
  recoverResourceBudget(graph.missionId)
  if (graph.missionId) reconcileMissionRuntime({ missionId: graph.missionId, graph })
  recoverUnattendedRunningTasks(graph)
  attachResourceViewToGraph(graph)
  attachRuntimeViewToGraph(graph)
  attachUnattendedViewToGraph(graph)
  return saveCommandCenterGraph(graph)
}

export function recoverAllCommandCenterGraphs(): FoundryCommandCenterGraph[] {
  return listCommandCenterGraphs().map(graph => {
    const leftover = graph.agents.some(agent => {
      const task = graph.tasks.find(item => item.taskId === agent.taskId)
      return isActiveExecutionStatus(agent.status) && (!task || isTerminalTaskStatus(task.status))
    })
    const approvalMismatch = graph.engineeringClass === 'STANDALONE_ENGINEER' && Boolean(graph.missionId) && evaluateApprovalBinding({
      engineeringClass: graph.engineeringClass,
      missionId: graph.missionId,
      graphId: graph.graphId,
      missionContract: graph.missionContractId ? loadMissionContract(graph.missionContractId) : null,
      acceptanceContract: graph.acceptanceContractId ? loadAcceptanceContract(graph.acceptanceContractId) : null,
    }).reapprovalRequired
    const needs = graph.tasks.some(task => task.status === 'RUNNING')
      || graph.agents.some(agent => agent.status === 'RUNNING')
      || leftover
      || duplicateActiveAgentsPerTask(graph) > 0
      || approvalMismatch
    return needs ? recoverCommandCenterGraph(graph) : graph
  })
}
