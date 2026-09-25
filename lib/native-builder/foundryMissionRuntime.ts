/**
 * Durable multi-day Foundry mission runtime: lease, heartbeat, checkpoint,
 * sleep/wake, reconcile, split-brain prevention. Extends existing Command Center
 * recovery. Does not rebuild contracts, verdict, governor, replan, or scheduler.
 * No OS daemon / systemd / cron. Recovery starts when Foundry runs.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { appendContractEvent, loadAcceptanceContract, loadMissionContract, listReplanRecords, loadVerdictRecord } from './foundryContractStore'
import { evaluateApprovalBinding } from './foundryExecutionApproval'
import { recoverReplanCounters } from './foundryReplanEngine'
import { recoverResourceBudget, resourceBudgetBlocksExecution } from './foundryResourceGovernor'
import { recoverVerdictState } from './foundryVerdictLayer'
import { foundryRuntimeNowIso, foundryRuntimeNowMs } from './foundryRuntimeClock'
import {
  FOUNDRY_RUNTIME_BASE_BACKOFF_MS,
  FOUNDRY_RUNTIME_HEARTBEAT_MS,
  FOUNDRY_RUNTIME_LEASE_TTL_MS,
  FOUNDRY_RUNTIME_MAX_BACKOFF_MS,
  FOUNDRY_RUNTIME_SCHEMA_VERSION,
  FOUNDRY_RUNTIME_TERMINAL_STATES,
  type FoundryDurableRuntimeAction,
  type FoundryInflightOutcome,
  type FoundryMissionRuntimeRecord,
  type FoundryRuntimeCheckpoint,
  type FoundryRuntimeDisposition,
  type FoundryRuntimeLease,
  type FoundryRuntimeState,
  type FoundryRuntimeView,
  type FoundrySleepReason,
  type FoundryWakeEntry,
  type FoundryWakeReason,
} from './foundryMissionRuntimeTypes'
import {
  listActiveMissionRuntimes,
  listMissionRuntimes,
  loadActiveMissionRuntime,
  loadDurableRuntimeAction,
  listDurableRuntimeActions,
  loadLatestRuntimeCheckpoint,
  loadMissionRuntime,
  loadRuntimeLease,
  loadWakeIndex,
  releaseRuntimeLease,
  saveDurableRuntimeAction,
  saveMissionRuntime,
  saveRuntimeCheckpoint,
  saveRuntimeLease,
  saveWakeIndex,
  tryCreateRuntimeLease,
} from './foundryMissionRuntimeStore'
import type { FoundryCommandCenterGraph, FoundryTaskRecord } from './foundryAgentTypes'

export type FoundryRuntimeOwnerProbe = (pid: number) => boolean

let processAlive: FoundryRuntimeOwnerProbe = defaultProcessAlive
let heartbeatMs = FOUNDRY_RUNTIME_HEARTBEAT_MS
let leaseTtlMs = FOUNDRY_RUNTIME_LEASE_TTL_MS
const wakeLocks = new Set<string>()
let hotPollCount = 0

function defaultProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

export function setFoundryRuntimeProcessProbe(probe: FoundryRuntimeOwnerProbe | null): void {
  processAlive = probe ?? defaultProcessAlive
}

export function setFoundryRuntimeTiming(input?: { heartbeatMs?: number; leaseTtlMs?: number }): void {
  heartbeatMs = input?.heartbeatMs ?? FOUNDRY_RUNTIME_HEARTBEAT_MS
  leaseTtlMs = input?.leaseTtlMs ?? FOUNDRY_RUNTIME_LEASE_TTL_MS
}

export function resetFoundryRuntimeTestHooks(): void {
  processAlive = defaultProcessAlive
  heartbeatMs = FOUNDRY_RUNTIME_HEARTBEAT_MS
  leaseTtlMs = FOUNDRY_RUNTIME_LEASE_TTL_MS
  wakeLocks.clear()
  hotPollCount = 0
}

export function foundryRuntimeInstanceId(): string {
  return process.env.FOUNDRY_RUNTIME_INSTANCE_ID?.trim() || `foundry-${process.pid}`
}

function emit(missionId: string, type: Parameters<typeof appendContractEvent>[1], text: string, metadata?: Record<string, string | number | boolean | null>) {
  appendContractEvent(missionId, type, text, null, metadata)
}

function isLeaseStale(lease: FoundryRuntimeLease): boolean {
  const expired = foundryRuntimeNowMs() > Date.parse(lease.expiresAt)
  const dead = !processAlive(lease.pid)
  return expired && dead
}

export function acquireMissionRuntimeLease(input: {
  missionId: string
  runtimeId: string
  runtimeGeneration: number
  instanceId?: string
  pid?: number
}): { ok: true; lease: FoundryRuntimeLease; takeover: boolean } | { ok: false; reason: string; lease: FoundryRuntimeLease | null } {
  const instanceId = input.instanceId ?? foundryRuntimeInstanceId()
  const existing = loadRuntimeLease(input.missionId)
  if (existing && existing.ownerInstanceId === instanceId && existing.runtimeId === input.runtimeId) {
    return { ok: true, lease: heartbeatMissionRuntimeLease(input.missionId, instanceId) ?? existing, takeover: false }
  }
  if (existing && !isLeaseStale(existing)) {
    return { ok: false, reason: 'DUPLICATE_RUNTIME_OWNER', lease: existing }
  }
  if (existing && isLeaseStale(existing)) {
    releaseRuntimeLease(input.missionId, existing.leaseId)
  }
  const now = foundryRuntimeNowIso()
  const lease: FoundryRuntimeLease = {
    leaseId: `RL-${randomUUID()}`,
    missionId: input.missionId,
    runtimeId: input.runtimeId,
    runtimeGeneration: input.runtimeGeneration,
    ownerInstanceId: instanceId,
    pid: input.pid ?? process.pid,
    acquiredAt: now,
    heartbeatAt: now,
    expiresAt: new Date(foundryRuntimeNowMs() + leaseTtlMs).toISOString(),
  }
  const created = tryCreateRuntimeLease(lease)
  if (!created.ok) {
    const holder = created.existing
    if (holder && !isLeaseStale(holder)) return { ok: false, reason: 'DUPLICATE_RUNTIME_OWNER', lease: holder }
    if (holder && isLeaseStale(holder)) {
      releaseRuntimeLease(input.missionId, holder.leaseId)
      const retry = tryCreateRuntimeLease(lease)
      if (!retry.ok) return { ok: false, reason: 'DUPLICATE_RUNTIME_OWNER', lease: retry.existing }
      emit(input.missionId, 'MISSION_RUNTIME_OWNER_TAKEOVER', `Stale owner ${holder.ownerInstanceId} replaced by ${instanceId}`, { leaseId: lease.leaseId, generation: input.runtimeGeneration })
      return { ok: true, lease, takeover: true }
    }
    return { ok: false, reason: 'DUPLICATE_RUNTIME_OWNER', lease: holder }
  }
  if (existing) emit(input.missionId, 'MISSION_RUNTIME_OWNER_TAKEOVER', `Stale owner replaced by ${instanceId}`, { leaseId: lease.leaseId, generation: input.runtimeGeneration })
  return { ok: true, lease, takeover: Boolean(existing) }
}

export function heartbeatMissionRuntimeLease(missionId: string, instanceId = foundryRuntimeInstanceId()): FoundryRuntimeLease | null {
  const lease = loadRuntimeLease(missionId)
  if (!lease || lease.ownerInstanceId !== instanceId) return null
  lease.heartbeatAt = foundryRuntimeNowIso()
  lease.expiresAt = new Date(foundryRuntimeNowMs() + leaseTtlMs).toISOString()
  saveRuntimeLease(lease)
  return lease
}

export function startMissionRuntime(input: {
  missionId: string
  graphId?: string | null
  projectId?: string | null
  workspaceId?: string | null
  approvalId?: string | null
  resourceBudgetId?: string | null
  contractGeneration?: string | null
  instanceId?: string
}): FoundryMissionRuntimeRecord {
  const existing = loadActiveMissionRuntime(input.missionId)
  if (existing && !FOUNDRY_RUNTIME_TERMINAL_STATES.includes(existing.state)) {
    const lease = acquireMissionRuntimeLease({
      missionId: input.missionId,
      runtimeId: existing.runtimeId,
      runtimeGeneration: existing.runtimeGeneration,
      instanceId: input.instanceId,
    })
    if (lease.ok) {
      existing.ownerInstanceId = lease.lease.ownerInstanceId
      existing.leaseId = lease.lease.leaseId
      if (lease.takeover) {
        existing.runtimeGeneration += 1
        existing.recoveryCount += 1
      }
      saveMissionRuntime(existing)
    }
    return existing
  }
  const now = foundryRuntimeNowIso()
  const record: FoundryMissionRuntimeRecord = {
    schemaVersion: FOUNDRY_RUNTIME_SCHEMA_VERSION,
    runtimeId: `RT-${randomUUID()}`,
    missionId: input.missionId,
    graphId: input.graphId ?? null,
    projectId: input.projectId ?? null,
    workspaceId: input.workspaceId ?? null,
    runtimeGeneration: 1,
    state: 'STARTING',
    startedAt: now,
    lastActiveAt: now,
    lastHeartbeatAt: null,
    lastCheckpointAt: null,
    nextWakeAt: null,
    sleepReason: null,
    wakeReason: null,
    ownerInstanceId: null,
    leaseId: null,
    activeTaskIds: [],
    waitingTaskIds: [],
    blockedTaskIds: [],
    approvalId: input.approvalId ?? null,
    resourceBudgetId: input.resourceBudgetId ?? null,
    contractGeneration: input.contractGeneration ?? null,
    recoveryCount: 0,
    wakeCount: 0,
    cancelRequested: false,
    paused: false,
    lastProgressAt: now,
    lastCheckpointId: null,
    workspaceMissing: false,
    diskDrift: false,
    continuePromptRequired: false,
    hotPollCount: 0,
  }
  const lease = acquireMissionRuntimeLease({
    missionId: record.missionId,
    runtimeId: record.runtimeId,
    runtimeGeneration: record.runtimeGeneration,
    instanceId: input.instanceId,
  })
  if (lease.ok) {
    record.ownerInstanceId = lease.lease.ownerInstanceId
    record.leaseId = lease.lease.leaseId
    record.state = 'ACTIVE'
  } else {
    record.state = 'WAITING'
  }
  saveMissionRuntime(record)
  emit(record.missionId, 'MISSION_RUNTIME_STARTED', `Runtime ${record.runtimeId} ${record.state}`, { runtimeId: record.runtimeId, generation: record.runtimeGeneration })
  return record
}

export function heartbeatMissionRuntime(missionId: string, graph?: FoundryCommandCenterGraph | null): FoundryMissionRuntimeRecord | null {
  const runtime = loadActiveMissionRuntime(missionId)
  if (!runtime || runtime.state === 'SLEEPING' || runtime.state === 'PAUSED') return runtime
  const last = runtime.lastHeartbeatAt ? Date.parse(runtime.lastHeartbeatAt) : 0
  if (foundryRuntimeNowMs() - last < heartbeatMs) return runtime
  heartbeatMissionRuntimeLease(missionId, runtime.ownerInstanceId ?? foundryRuntimeInstanceId())
  runtime.lastHeartbeatAt = foundryRuntimeNowIso()
  runtime.lastActiveAt = runtime.lastHeartbeatAt
  if (graph) {
    runtime.activeTaskIds = graph.tasks.filter(task => task.status === 'RUNNING').map(task => task.taskId)
    runtime.waitingTaskIds = graph.tasks.filter(task => task.status === 'WAITING' || task.status === 'QUEUED').map(task => task.taskId)
    runtime.blockedTaskIds = graph.tasks.filter(task => task.status === 'BLOCKED' || task.status === 'FAILED').map(task => task.taskId)
  }
  saveMissionRuntime(runtime)
  emit(missionId, 'MISSION_RUNTIME_HEARTBEAT', `Heartbeat gen=${runtime.runtimeGeneration} state=${runtime.state}`, {
    runtimeId: runtime.runtimeId,
    generation: runtime.runtimeGeneration,
    state: runtime.state,
    active: runtime.activeTaskIds.length,
  })
  return runtime
}

export function checkpointMissionRuntime(input: {
  missionId: string
  reason: string
  graph?: FoundryCommandCenterGraph | null
}): FoundryRuntimeCheckpoint | null {
  const runtime = loadActiveMissionRuntime(input.missionId) ?? listMissionRuntimes(input.missionId).at(-1)
  if (!runtime) return null
  const checkpoint: FoundryRuntimeCheckpoint = {
    checkpointId: `CP-${randomUUID()}`,
    runtimeId: runtime.runtimeId,
    missionId: runtime.missionId,
    graphId: runtime.graphId,
    at: foundryRuntimeNowIso(),
    reason: input.reason,
    state: runtime.state,
    approvalId: runtime.approvalId,
    resourceBudgetId: runtime.resourceBudgetId,
    contractGeneration: runtime.contractGeneration,
    taskFrontier: (input.graph?.tasks ?? []).filter(task => task.status === 'READY' || task.status === 'RUNNING').map(task => task.taskId),
    workspaceId: runtime.workspaceId,
    verdictId: loadVerdictRecord(runtime.missionId)?.verdictId ?? null,
  }
  saveRuntimeCheckpoint(checkpoint)
  runtime.lastCheckpointAt = checkpoint.at
  runtime.lastCheckpointId = checkpoint.checkpointId
  saveMissionRuntime(runtime)
  emit(runtime.missionId, 'MISSION_RUNTIME_CHECKPOINTED', `${input.reason} ${checkpoint.checkpointId}`, { checkpointId: checkpoint.checkpointId, reason: input.reason })
  return checkpoint
}

export function sleepMissionRuntime(input: {
  missionId: string
  reason: FoundrySleepReason
  wakeReason: FoundryWakeReason
  delayMs: number
}): FoundryMissionRuntimeRecord | null {
  const runtime = loadActiveMissionRuntime(input.missionId)
  if (!runtime) return null
  if (runtime.state === 'NEEDS_COMMANDER' || runtime.state === 'BLOCKED' || runtime.state === 'PAUSED' || FOUNDRY_RUNTIME_TERMINAL_STATES.includes(runtime.state)) {
    return runtime
  }
  const delay = Math.min(FOUNDRY_RUNTIME_MAX_BACKOFF_MS, Math.max(1, input.delayMs))
  runtime.state = 'SLEEPING'
  runtime.sleepReason = input.reason
  runtime.wakeReason = input.wakeReason
  runtime.nextWakeAt = new Date(foundryRuntimeNowMs() + delay).toISOString()
  runtime.hotPollCount = 0
  saveMissionRuntime(runtime)
  scheduleMissionWake({
    missionId: runtime.missionId,
    runtimeId: runtime.runtimeId,
    runtimeGeneration: runtime.runtimeGeneration,
    nextWakeAt: runtime.nextWakeAt,
    reason: input.wakeReason,
  })
  checkpointMissionRuntime({ missionId: runtime.missionId, reason: 'before-sleep' })
  emit(runtime.missionId, 'MISSION_RUNTIME_SLEEPING', `SLEEPING until ${runtime.nextWakeAt} (${input.reason})`, { nextWakeAt: runtime.nextWakeAt, reason: input.reason })
  return runtime
}

export function waitMissionRuntime(missionId: string, detail = 'awaiting bounded condition'): FoundryMissionRuntimeRecord | null {
  const runtime = loadActiveMissionRuntime(missionId)
  if (!runtime) return null
  runtime.state = 'WAITING'
  saveMissionRuntime(runtime)
  emit(missionId, 'MISSION_RUNTIME_WAITING', detail)
  return runtime
}

export function scheduleMissionWake(entry: Omit<FoundryWakeEntry, 'wakeId' | 'claimedBy' | 'claimedAt' | 'executedAt'>): FoundryWakeEntry {
  const index = loadWakeIndex()
  const duplicate = index.find(item =>
    item.runtimeId === entry.runtimeId
    && item.runtimeGeneration === entry.runtimeGeneration
    && item.reason === entry.reason
    && !item.executedAt
    && item.nextWakeAt === entry.nextWakeAt
  )
  if (duplicate) return duplicate
  const next: FoundryWakeEntry = {
    ...entry,
    wakeId: `WK-${randomUUID()}`,
    claimedBy: null,
    claimedAt: null,
    executedAt: null,
  }
  saveWakeIndex([...index.filter(item => !(item.runtimeId === entry.runtimeId && !item.executedAt)), next])
  emit(entry.missionId, 'MISSION_RUNTIME_WAKE_SCHEDULED', `Wake ${next.wakeId} at ${entry.nextWakeAt}`, { wakeId: next.wakeId, reason: entry.reason })
  return next
}

export function dueWakeEntries(nowMs = foundryRuntimeNowMs()): FoundryWakeEntry[] {
  return loadWakeIndex().filter(item => !item.executedAt && Date.parse(item.nextWakeAt) <= nowMs)
}

export function sleepingHotPollTick(missionId: string): number {
  const runtime = loadActiveMissionRuntime(missionId)
  if (runtime?.state === 'SLEEPING') {
    runtime.hotPollCount += 1
    hotPollCount += 1
    saveMissionRuntime(runtime)
  }
  return hotPollCount
}

export function sleepingHotPollCount(): number {
  return hotPollCount
}

export function claimWakeExecution(entry: FoundryWakeEntry, instanceId = foundryRuntimeInstanceId()): { ok: boolean; duplicate: boolean } {
  const key = `${entry.runtimeId}:${entry.runtimeGeneration}`
  if (wakeLocks.has(key)) return { ok: false, duplicate: true }
  const index = loadWakeIndex()
  const current = index.find(item => item.wakeId === entry.wakeId)
  if (!current || current.executedAt || current.claimedBy) return { ok: false, duplicate: true }
  wakeLocks.add(key)
  current.claimedBy = instanceId
  current.claimedAt = foundryRuntimeNowIso()
  saveWakeIndex(index)
  return { ok: true, duplicate: false }
}

export function completeWakeExecution(entry: FoundryWakeEntry): void {
  const index = loadWakeIndex()
  const current = index.find(item => item.wakeId === entry.wakeId)
  if (current) {
    current.executedAt = foundryRuntimeNowIso()
    saveWakeIndex(index)
  }
  wakeLocks.delete(`${entry.runtimeId}:${entry.runtimeGeneration}`)
}

export function persistDurableRuntimeAction(action: FoundryDurableRuntimeAction): FoundryDurableRuntimeAction {
  return saveDurableRuntimeAction(action)
}

export function classifyInFlightAction(actionId: string): FoundryInflightOutcome {
  const action = loadDurableRuntimeAction(actionId)
  if (!action) return 'UNKNOWN_OUTCOME'
  if (action.status === 'COMPLETED' || action.state === 'COMPLETED') return 'CONFIRMED_COMPLETED'
  if (action.status === 'UNKNOWN_OUTCOME') return 'UNKNOWN_OUTCOME'
  if (action.status === 'FAILED' && action.mutating) return 'NEEDS_VERIFICATION'
  if ((action.status === 'STARTED' || action.state === 'STARTED') && !action.mutating) return 'SAFE_TO_RETRY'
  if ((action.status === 'STARTED' || action.state === 'STARTED') && action.mutating) return 'NEEDS_VERIFICATION'
  return 'UNKNOWN_OUTCOME'
}

export function reuseDurableRuntimeAction(actionId: string): FoundryDurableRuntimeAction | null {
  const action = loadDurableRuntimeAction(actionId)
  if (action?.state === 'COMPLETED') return action
  return null
}

export function providerBackoffDelayMs(failureCount: number): number {
  const delay = FOUNDRY_RUNTIME_BASE_BACKOFF_MS * Math.pow(2, Math.max(0, failureCount - 1))
  return Math.min(FOUNDRY_RUNTIME_MAX_BACKOFF_MS, delay)
}

export function recordProviderBackoff(missionId: string, failureCount: number): FoundryMissionRuntimeRecord | null {
  const delay = providerBackoffDelayMs(failureCount)
  return sleepMissionRuntime({
    missionId,
    reason: 'PROVIDER_RATE_LIMIT',
    wakeReason: 'PROVIDER_RETRY_WINDOW',
    delayMs: delay,
  })
}

export type FoundryRuntimeReconcile = {
  runtime: FoundryMissionRuntimeRecord | null
  disposition: FoundryRuntimeDisposition
  reason: string
  inflight: Array<{ taskId: string; actionId: string | null; outcome: FoundryInflightOutcome }>
  continuePromptRequired: boolean
  resourceReset: boolean
  replanReset: boolean
  approvalSilentRefresh: boolean
}

function hashFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

export function reconcileWorkspaceDisk(input: {
  expected: Array<{ path: string; hash?: string | null }>
  root?: string
}): { drift: string[]; missing: string[] } {
  const drift: string[] = []
  const missing: string[] = []
  for (const item of input.expected) {
    const full = input.root ? path.join(input.root, item.path) : item.path
    if (!existsSync(full)) {
      missing.push(item.path)
      continue
    }
    if (item.hash) {
      const actual = hashFile(full)
      if (actual && actual !== item.hash) drift.push(item.path)
    }
  }
  return { drift, missing }
}

export function reconcileMissionRuntime(input: {
  missionId: string
  graph?: FoundryCommandCenterGraph | null
  instanceId?: string
  expectedFiles?: Array<{ path: string; hash?: string | null }>
  workspaceRoot?: string
  inflightActions?: Array<{ taskId: string; actionId: string }>
}): FoundryRuntimeReconcile {
  const runtime = loadActiveMissionRuntime(input.missionId) ?? listMissionRuntimes(input.missionId).at(-1) ?? null
  if (!runtime) return { runtime: null, disposition: 'BLOCKED', reason: 'No durable runtime.', inflight: [], continuePromptRequired: false, resourceReset: false, replanReset: false, approvalSilentRefresh: false }
  if (runtime.state === 'CANCELLED' || runtime.cancelRequested) {
    runtime.state = 'CANCELLED'
    saveMissionRuntime(runtime)
    return { runtime, disposition: 'CANCELLED', reason: 'Cancel intent persisted. Do not resurrect.', inflight: [], continuePromptRequired: false, resourceReset: false, replanReset: false, approvalSilentRefresh: false }
  }
  if (runtime.state === 'COMPLETE') {
    return { runtime, disposition: 'COMPLETE', reason: 'Terminal COMPLETE preserved.', inflight: [], continuePromptRequired: false, resourceReset: false, replanReset: false, approvalSilentRefresh: false }
  }
  if (runtime.paused || runtime.state === 'PAUSED') {
    runtime.paused = true
    runtime.state = 'PAUSED'
    saveMissionRuntime(runtime)
    emit(runtime.missionId, 'MISSION_RUNTIME_PAUSED', 'Pause survives restart.')
    return { runtime, disposition: 'PAUSED', reason: 'Commander pause survives restart. No auto-resume.', inflight: [], continuePromptRequired: false, resourceReset: false, replanReset: false, approvalSilentRefresh: false }
  }

  runtime.state = 'RECOVERING'
  runtime.recoveryCount += 1
  saveMissionRuntime(runtime)
  emit(runtime.missionId, 'MISSION_RUNTIME_RECOVERING', `Recovering generation ${runtime.runtimeGeneration}`)

  const beforeBudget = recoverResourceBudget(input.missionId)
  const budgetTokens = beforeBudget?.totals.totalTokens ?? 0
  const resourceBlock = resourceBudgetBlocksExecution(input.missionId)
  const afterBudget = recoverResourceBudget(input.missionId)
  const resourceReset = Boolean(afterBudget && budgetTokens > 0 && afterBudget.totals.totalTokens === 0)

  let replanReset = false
  if (input.graph) {
    const beforeReplan = { task: input.graph.taskReplanCount ?? 0, dag: input.graph.dagReplanCount ?? 0 }
    recoverReplanCounters(input.graph, listReplanRecords(input.graph.graphId))
    replanReset = (input.graph.taskReplanCount ?? 0) < beforeReplan.task || (input.graph.dagReplanCount ?? 0) < beforeReplan.dag
  }

  recoverVerdictState(input.missionId)

  const approvalSilentRefresh = false
  if (input.graph?.missionContractId || input.graph?.acceptanceContractId) {
    const missionContract = input.graph.missionContractId ? loadMissionContract(input.graph.missionContractId) : null
    const acceptanceContract = input.graph.acceptanceContractId ? loadAcceptanceContract(input.graph.acceptanceContractId) : null
    const binding = evaluateApprovalBinding({
      engineeringClass: input.graph.engineeringClass ?? 'STANDALONE_ENGINEER',
      missionId: input.missionId,
      graphId: input.graph.graphId,
      missionContract,
      acceptanceContract,
    })
    if (binding.reapprovalRequired) {
      runtime.state = 'NEEDS_COMMANDER'
      runtime.continuePromptRequired = true
      saveMissionRuntime(runtime)
      emit(runtime.missionId, 'MISSION_RUNTIME_BLOCKED', binding.reason ?? 'REAPPROVAL_REQUIRED')
      return { runtime, disposition: 'NEEDS_COMMANDER', reason: binding.reason ?? 'REAPPROVAL_REQUIRED', inflight: [], continuePromptRequired: true, resourceReset, replanReset, approvalSilentRefresh }
    }
  }

  if (resourceBlock && !resourceBlock.ok && resourceBlock.code !== 'PAUSED') {
    runtime.state = 'NEEDS_COMMANDER'
    runtime.continuePromptRequired = true
    saveMissionRuntime(runtime)
    emit(runtime.missionId, 'MISSION_RUNTIME_BLOCKED', 'RESOURCE_EXHAUSTED')
    return { runtime, disposition: 'NEEDS_COMMANDER', reason: 'RESOURCE_EXHAUSTED', inflight: [], continuePromptRequired: true, resourceReset, replanReset, approvalSilentRefresh }
  }

  if (runtime.workspaceId && input.workspaceRoot && !existsSync(input.workspaceRoot)) {
    runtime.workspaceMissing = true
    runtime.state = 'BLOCKED'
    saveMissionRuntime(runtime)
    return { runtime, disposition: 'BLOCKED', reason: 'WORKSPACE_MISSING', inflight: [], continuePromptRequired: true, resourceReset, replanReset, approvalSilentRefresh }
  }

  if (input.expectedFiles?.length) {
    const disk = reconcileWorkspaceDisk({ expected: input.expectedFiles, root: input.workspaceRoot })
    if (disk.drift.length) {
      runtime.diskDrift = true
      runtime.state = 'WAITING'
      saveMissionRuntime(runtime)
      return { runtime, disposition: 'WAIT', reason: `Commander/manual disk drift on ${disk.drift.join(',')}. No clobber. Re-inspect/replan.`, inflight: [], continuePromptRequired: false, resourceReset, replanReset, approvalSilentRefresh }
    }
  }

  const inflight = (input.inflightActions ?? []).map(item => ({
    taskId: item.taskId,
    actionId: item.actionId,
    outcome: classifyInFlightAction(item.actionId),
  }))
  if (inflight.some(item => item.outcome === 'UNKNOWN_OUTCOME' || item.outcome === 'NEEDS_VERIFICATION')) {
    runtime.state = 'WAITING'
    saveMissionRuntime(runtime)
    return { runtime, disposition: 'WAIT', reason: 'UNKNOWN_OUTCOME — verification before retry.', inflight, continuePromptRequired: false, resourceReset, replanReset, approvalSilentRefresh }
  }

  if (runtime.nextWakeAt && Date.parse(runtime.nextWakeAt) > foundryRuntimeNowMs()) {
    runtime.state = 'SLEEPING'
    saveMissionRuntime(runtime)
    return { runtime, disposition: 'SLEEP', reason: `Sleep until ${runtime.nextWakeAt}`, inflight, continuePromptRequired: false, resourceReset, replanReset, approvalSilentRefresh }
  }

  const lease = acquireMissionRuntimeLease({
    missionId: runtime.missionId,
    runtimeId: runtime.runtimeId,
    runtimeGeneration: runtime.runtimeGeneration + 1,
    instanceId: input.instanceId,
  })
  if (!lease.ok) {
    runtime.state = 'WAITING'
    saveMissionRuntime(runtime)
    return { runtime, disposition: 'WAIT', reason: 'Non-owner remains read-only.', inflight, continuePromptRequired: false, resourceReset, replanReset, approvalSilentRefresh }
  }
  if (lease.takeover) {
    runtime.runtimeGeneration += 1
    runtime.recoveryCount += 1
    runtime.ownerInstanceId = lease.lease.ownerInstanceId
    runtime.leaseId = lease.lease.leaseId
  }
  runtime.state = 'ACTIVE'
  runtime.wakeCount += 1
  runtime.wakeReason = 'SYSTEM_RESTART_RECOVERY'
  runtime.nextWakeAt = null
  runtime.sleepReason = null
  runtime.continuePromptRequired = false
  runtime.lastActiveAt = foundryRuntimeNowIso()
  saveMissionRuntime(runtime)
  checkpointMissionRuntime({ missionId: runtime.missionId, reason: 'after-wake-reconciliation', graph: input.graph })
  emit(runtime.missionId, 'MISSION_RUNTIME_RECOVERED', `Disposition RESUME generation=${runtime.runtimeGeneration}`)
  emit(runtime.missionId, 'MISSION_RUNTIME_WAKING', 'Recoverable wake; no continue prompt.')
  return { runtime, disposition: 'RESUME', reason: 'Authorized work remains. Auto-resume.', inflight, continuePromptRequired: false, resourceReset, replanReset, approvalSilentRefresh }
}

export function wakeMissionRuntime(input: {
  missionId: string
  graph?: FoundryCommandCenterGraph | null
  instanceId?: string
  expectedFiles?: Array<{ path: string; hash?: string | null }>
  workspaceRoot?: string
  inflightActions?: Array<{ taskId: string; actionId: string }>
}): FoundryRuntimeReconcile {
  const runtime = loadActiveMissionRuntime(input.missionId)
  if (runtime) {
    runtime.state = 'WAKING'
    saveMissionRuntime(runtime)
    emit(input.missionId, 'MISSION_RUNTIME_WAKING', runtime.wakeReason ?? 'wake')
  }
  return reconcileMissionRuntime(input)
}

export function pauseMissionRuntime(missionId: string): FoundryMissionRuntimeRecord | null {
  const runtime = loadActiveMissionRuntime(missionId)
  if (!runtime) return null
  runtime.paused = true
  runtime.state = 'PAUSED'
  checkpointMissionRuntime({ missionId, reason: 'commander-pause' })
  saveMissionRuntime(runtime)
  emit(missionId, 'MISSION_RUNTIME_PAUSED', 'Commander paused runtime.')
  return runtime
}

export function resumeMissionRuntime(input: {
  missionId: string
  graph?: FoundryCommandCenterGraph | null
  instanceId?: string
}): FoundryRuntimeReconcile {
  const runtime = loadActiveMissionRuntime(input.missionId)
  if (runtime) {
    runtime.paused = false
    saveMissionRuntime(runtime)
    emit(input.missionId, 'MISSION_RUNTIME_RESUMED', 'Commander resume requested; revalidating.')
  }
  return reconcileMissionRuntime({ ...input, instanceId: input.instanceId, graph: input.graph })
}

export function cancelMissionRuntime(missionId: string): FoundryMissionRuntimeRecord | null {
  const runtime = loadActiveMissionRuntime(missionId) ?? listMissionRuntimes(missionId).at(-1)
  if (!runtime) return null
  runtime.cancelRequested = true
  runtime.state = 'CANCELLED'
  checkpointMissionRuntime({ missionId, reason: 'commander-cancel' })
  saveMissionRuntime(runtime)
  gcTerminalRuntime(runtime)
  emit(missionId, 'MISSION_RUNTIME_TERMINATED', 'CANCELLED')
  return runtime
}

export function shutdownMissionRuntimes(instanceId = foundryRuntimeInstanceId()): number {
  let count = 0
  for (const runtime of listActiveMissionRuntimes()) {
    if (runtime.ownerInstanceId !== instanceId) continue
    checkpointMissionRuntime({ missionId: runtime.missionId, reason: 'controlled-shutdown' })
    if (runtime.state === 'ACTIVE' || runtime.state === 'WAITING') {
      runtime.state = 'SLEEPING'
      runtime.sleepReason = 'SCHEDULED_FUTURE_RETRY'
      runtime.wakeReason = 'SYSTEM_RESTART_RECOVERY'
      runtime.nextWakeAt = foundryRuntimeNowIso()
      scheduleMissionWake({
        missionId: runtime.missionId,
        runtimeId: runtime.runtimeId,
        runtimeGeneration: runtime.runtimeGeneration,
        nextWakeAt: runtime.nextWakeAt,
        reason: 'SYSTEM_RESTART_RECOVERY',
      })
    }
    releaseRuntimeLease(runtime.missionId, runtime.leaseId ?? undefined)
    runtime.ownerInstanceId = null
    runtime.leaseId = null
    saveMissionRuntime(runtime)
    count += 1
  }
  return count
}

let shutdownHookInstalled = false

export function installFoundryRuntimeShutdownHooks(): void {
  if (shutdownHookInstalled || process.env.FOUNDRY_SKIP_RUNTIME_SHUTDOWN_HOOK === '1') return
  shutdownHookInstalled = true
  const run = () => {
    try { shutdownMissionRuntimes() } catch { /* best-effort checkpoint */ }
  }
  process.once('SIGINT', run)
  process.once('SIGTERM', run)
  process.once('beforeExit', run)
}

function gcTerminalRuntime(runtime: FoundryMissionRuntimeRecord): void {
  const index = loadWakeIndex().filter(item => item.runtimeId !== runtime.runtimeId || Boolean(item.executedAt))
  saveWakeIndex(index.filter(item => item.runtimeId !== runtime.runtimeId))
}

export function completeMissionRuntime(missionId: string): FoundryMissionRuntimeRecord | null {
  const runtime = loadActiveMissionRuntime(missionId) ?? listMissionRuntimes(missionId).at(-1)
  if (!runtime) return null
  runtime.state = 'COMPLETE'
  checkpointMissionRuntime({ missionId, reason: 'complete' })
  saveMissionRuntime(runtime)
  gcTerminalRuntime(runtime)
  emit(missionId, 'MISSION_RUNTIME_TERMINATED', 'COMPLETE')
  return runtime
}

export function recoverFoundryMissionRuntimes(instanceId?: string): FoundryRuntimeReconcile[] {
  return listActiveMissionRuntimes().map(runtime => reconcileMissionRuntime({ missionId: runtime.missionId, instanceId }))
}

export function runDueWakes(instanceId?: string): FoundryRuntimeReconcile[] {
  const due = dueWakeEntries()
  const out: FoundryRuntimeReconcile[] = []
  for (const entry of due) {
    const claim = claimWakeExecution(entry, instanceId)
    if (!claim.ok) continue
    try {
      out.push(wakeMissionRuntime({ missionId: entry.missionId, instanceId }))
    } finally {
      completeWakeExecution(entry)
    }
  }
  return out
}

export function buildRuntimeView(missionId: string): FoundryRuntimeView {
  const runtime = loadActiveMissionRuntime(missionId) ?? listMissionRuntimes(missionId).at(-1) ?? null
  if (!runtime) {
    return {
      runtimeId: null,
      state: 'NONE',
      lastActiveAt: null,
      lastHeartbeatAt: null,
      nextWakeAt: null,
      wakeReason: null,
      sleepReason: null,
      recoveryCount: 0,
      ownerInstanceId: null,
      runtimeGeneration: null,
      lastCheckpointId: null,
      leaseId: null,
      activeTaskCount: 0,
      truthfulLabel: 'No runtime owner',
      detail: 'Foundry is not working this mission until a runtime starts.',
    }
  }
  const hasOwner = Boolean(runtime.ownerInstanceId && runtime.leaseId && loadRuntimeLease(runtime.missionId))
  const hasWake = Boolean(runtime.nextWakeAt && loadWakeIndex().some(item => item.runtimeId === runtime.runtimeId && !item.executedAt))
  let truthfulLabel = runtime.state
  let detail = `Last active ${runtime.lastActiveAt}`
  if (runtime.state === 'ACTIVE') {
    truthfulLabel = hasOwner ? `ACTIVE · Running ${runtime.activeTaskIds.length} tasks` : 'No runtime owner'
    if (!hasOwner) detail = 'Do not show Working without an owner.'
  } else if (runtime.state === 'SLEEPING') {
    truthfulLabel = hasWake ? `SLEEPING · ${runtime.sleepReason ?? 'scheduled'}` : 'No durable wake schedule'
    detail = hasWake ? `Retry scheduled at ${runtime.nextWakeAt}` : 'Will resume is not claimed without a wake entry.'
  } else if (runtime.state === 'RECOVERING' || runtime.state === 'WAKING') {
    truthfulLabel = 'RECOVERING · Reconciling workspace and task state'
  }
  return {
    runtimeId: runtime.runtimeId,
    state: runtime.state,
    lastActiveAt: runtime.lastActiveAt,
    lastHeartbeatAt: runtime.lastHeartbeatAt,
    nextWakeAt: runtime.nextWakeAt,
    wakeReason: runtime.wakeReason,
    sleepReason: runtime.sleepReason,
    recoveryCount: runtime.recoveryCount,
    ownerInstanceId: runtime.ownerInstanceId,
    runtimeGeneration: runtime.runtimeGeneration,
    lastCheckpointId: runtime.lastCheckpointId,
    leaseId: runtime.leaseId,
    activeTaskCount: runtime.activeTaskIds.length,
    truthfulLabel,
    detail,
  }
}

export function attachRuntimeViewToGraph(graph: FoundryCommandCenterGraph): FoundryCommandCenterGraph {
  graph.runtimeView = buildRuntimeView(graph.missionId)
  graph.runtimeId = graph.runtimeView.runtimeId
  return graph
}

export function classifyTaskRecovery(task: FoundryTaskRecord, actionId?: string | null): FoundryInflightOutcome {
  if (task.status === 'COMPLETE') return 'CONFIRMED_COMPLETED'
  if (actionId) return classifyInFlightAction(actionId)
  if (task.status === 'RUNNING') return 'UNKNOWN_OUTCOME'
  return 'SAFE_TO_RETRY'
}

export function parallelRecoveryAllowed(graph: FoundryCommandCenterGraph, unknownTaskId: string, candidateTaskId: string): boolean {
  const candidate = graph.tasks.find(task => task.taskId === candidateTaskId)
  const unknown = graph.tasks.find(task => task.taskId === unknownTaskId)
  if (!candidate || !unknown) return false
  if (candidate.dependsOn.includes(unknownTaskId)) return false
  return candidate.status === 'READY' || candidate.dependsOn.every(id => graph.tasks.find(task => task.taskId === id)?.status === 'COMPLETE')
}

export { loadActiveMissionRuntime, loadMissionRuntime, listMissionRuntimes, loadLatestRuntimeCheckpoint, loadWakeIndex, loadDurableRuntimeAction, listDurableRuntimeActions, loadRuntimeLease }
