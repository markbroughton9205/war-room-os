/**
 * Resource-aware scheduler for Nebula Genesis. Bounded parallelism; never blind max-agent.
 */
import { cpus, freemem, totalmem } from 'node:os'
import { spawnSync } from 'node:child_process'
import { FOUNDRY_TASK_PRIORITY_RANK, type FoundryCommandCenterGraph, type FoundryTaskRecord } from './foundryAgentTypes'

export type FoundryResourceSnapshot = {
  cpuCount: number
  cpuLoadHint: number
  ramUsedRatio: number
  ramFreeMb: number
  vramUsedMb: number | null
  vramTotalMb: number | null
  activeBrowsers: number
  activeBuilds: number
  activeModelSlots: number
  activePtys: number
  measuredAt: string
}

export type FoundrySchedulerDecision = {
  maxConcurrentAgents: number
  allowed: FoundryTaskRecord[]
  deferred: { taskId: string; reason: string }[]
  snapshot: FoundryResourceSnapshot
}

export function measureFoundryResources(hints?: Partial<FoundryResourceSnapshot>): FoundryResourceSnapshot {
  const cpuCount = Math.max(1, cpus().length)
  const total = totalmem()
  const free = freemem()
  const vram = readNvidiaVram()
  return {
    cpuCount,
    cpuLoadHint: hints?.cpuLoadHint ?? estimateLoad(cpuCount),
    ramUsedRatio: total > 0 ? 1 - free / total : 1,
    ramFreeMb: Math.round(free / 1024 / 1024),
    vramUsedMb: vram?.used ?? null,
    vramTotalMb: vram?.total ?? null,
    activeBrowsers: hints?.activeBrowsers ?? 0,
    activeBuilds: hints?.activeBuilds ?? 0,
    activeModelSlots: hints?.activeModelSlots ?? 0,
    activePtys: hints?.activePtys ?? 0,
    measuredAt: new Date().toISOString(),
  }
}

export function computeMaxConcurrentAgents(snapshot: FoundryResourceSnapshot): number {
  let max = Math.min(4, Math.max(2, Math.floor(snapshot.cpuCount / 4) || 2))
  if (snapshot.ramFreeMb < 1024 || snapshot.ramUsedRatio > 0.88) max = Math.min(max, 1)
  else if (snapshot.ramFreeMb < 2048 || snapshot.ramUsedRatio > 0.8) max = Math.min(max, 2)
  if (snapshot.cpuLoadHint > snapshot.cpuCount * 0.85) max = Math.min(max, 2)
  if (snapshot.activeBrowsers >= 2) max = Math.min(max, Math.max(1, max - 1))
  if (snapshot.activeBuilds >= 1) max = Math.min(max, 2)
  if (snapshot.activeModelSlots >= 2) max = Math.min(max, 2)
  if (snapshot.activePtys >= 6) max = Math.min(max, 2)
  if (snapshot.vramTotalMb && snapshot.vramUsedMb != null && snapshot.vramUsedMb / snapshot.vramTotalMb > 0.9) {
    max = Math.min(max, 1)
  }
  return Math.max(1, max)
}

export function scheduleReadyTasks(input: {
  graph: FoundryCommandCenterGraph
  snapshot?: FoundryResourceSnapshot
  runningElsewhere?: number
  missionMaxConcurrentAgents?: number | null
}): FoundrySchedulerDecision {
  const snapshot = input.snapshot ?? measureFoundryResources()
  const hostMax = computeMaxConcurrentAgents(snapshot)
  const max = Math.max(1, Math.min(hostMax, input.missionMaxConcurrentAgents ?? hostMax))
  const runningHere = input.graph.tasks.filter(task => task.status === 'RUNNING').length
  const slots = Math.max(0, max - runningHere - (input.runningElsewhere ?? 0))
  const ready = input.graph.tasks
    .filter(task => task.status === 'READY' && !input.graph.paused && !input.graph.cancelRequested)
    .filter(task => dependenciesSatisfied(input.graph, task))
    .sort((a, b) => FOUNDRY_TASK_PRIORITY_RANK[a.priority] - FOUNDRY_TASK_PRIORITY_RANK[b.priority] || a.taskId.localeCompare(b.taskId))

  const allowed: FoundryTaskRecord[] = []
  const deferred: { taskId: string; reason: string }[] = []
  const claimedWrite = new Set(
    input.graph.tasks.filter(task => task.status === 'RUNNING' && task.mutating).flatMap(task => writeKeys(task)),
  )

  for (const task of ready) {
    if (allowed.length >= slots) {
      deferred.push({ taskId: task.taskId, reason: `bounded concurrency ${max}` })
      continue
    }
    if (task.mutating && writeKeys(task).some(key => claimedWrite.has(key))) {
      deferred.push({ taskId: task.taskId, reason: 'repo/write conflict — waiting for exclusive workspace' })
      continue
    }
    allowed.push(task)
    if (task.mutating) for (const key of writeKeys(task)) claimedWrite.add(key)
  }
  return { maxConcurrentAgents: max, allowed, deferred, snapshot }
}

export function dependenciesSatisfied(graph: FoundryCommandCenterGraph, task: FoundryTaskRecord): boolean {
  return task.dependsOn.every(id => graph.tasks.find(item => item.taskId === id)?.status === 'COMPLETE')
}

function writeKeys(task: FoundryTaskRecord): string[] {
  if (!task.mutating) return []
  const files = task.writeSet.length ? task.writeSet : ['*']
  return files.map(file => `${task.projectId}::${file}`)
}

function estimateLoad(cpuCount: number): number {
  try {
    const raw = spawnSync('sh', ['-c', 'cut -d " " -f1 /proc/loadavg'], { encoding: 'utf8', timeout: 500 })
    const value = Number(raw.stdout.trim())
    if (Number.isFinite(value)) return value
  } catch {
    /* ignore */
  }
  return cpuCount * 0.3
}

function readNvidiaVram(): { used: number; total: number } | null {
  try {
    const raw = spawnSync('nvidia-smi', ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'], {
      encoding: 'utf8',
      timeout: 800,
    })
    if (raw.status !== 0) return null
    const line = raw.stdout.trim().split(/\n/)[0]
    const [used, total] = (line || '').split(',').map(part => Number(part.trim()))
    if (!Number.isFinite(used) || !Number.isFinite(total)) return null
    return { used, total }
  } catch {
    return null
  }
}
