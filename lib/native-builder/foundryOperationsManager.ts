/**
 * Foundry Operations Manager — PASS 006 orchestration above the Mission Controller.
 * Does not replace PASS 004/005 controller, model, or tool broker.
 */
import { randomUUID } from 'node:crypto'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { hasActiveProcesses } from './processRegistry'
import { appendJournal, listAllMissions, listMissions, loadMission, saveMission, transitionMission } from './foundryMissionStore'
import { upsertRegistry, rebuildRegistry, sortByPriority, toRegistryEntry } from './foundryMissionRegistry'
import {
  acquireResource,
  heartbeatResourceClaim,
  listResourceClaims,
  reclaimStaleResources,
  releaseMissionResources,
} from './foundryResourceLocks'
import {
  attachDurableToolCall,
  classifyToolIdempotency,
  createDurableToolCall,
  markInFlightToolsInterrupted,
  persistDurableToolCall,
  resourcesForTool,
} from './foundryToolLifecycle'
import {
  detectWriteConflict,
  intendedWritePaths,
  recordMissionBaseline,
  reconcileWriteBaseline,
  rememberTouchedHash,
} from './foundryWriteIsolation'
import { archiveOldObservations, buildMissionCheckpoint, persistCheckpoint, shouldCheckpoint } from './foundryContextCheckpoints'
import { recordProviderFailure, recordProviderSuccess } from './foundryProviderHealth'
import { applyFoundryRuntimeConfig, persistFoundryRuntimeConfig, readFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { FOUNDRY_HOLD_STATES, FOUNDRY_TERMINAL_STATES, type FoundryMissionRecord } from './foundryMissionTypes'
import { classifyFoundryMission, isArchivedSystemMission, isResumeEligible, isTestMissionClass, archiveConfirmedSystemTestMissions } from './foundryMissionVisibility'
import {
  FOUNDRY_DEFAULT_PRIMARY_MODEL,
  FOUNDRY_LOCK_ORDER,
  isFoundryMissionPriority,
  type FoundryDurableToolCall,
  type FoundryMissionPriority,
  type FoundryOwnedArtifact,
  type FoundryPinnedModel,
  type FoundryRecoveryDisposition,
  type FoundryRegistryEntry,
  type FoundryResourceId,
} from './foundryOperationsTypes'
import type { EngineerToolName } from './engineerTools'

const HEARTBEAT_STALL_MS = 8 * 60 * 1000
const recoveredThisProcess = new Set<string>()
let recoveringBoot: Promise<void> | null = null

function now(): string {
  return new Date().toISOString()
}

function bumpVersion(mission: FoundryMissionRecord): void {
  mission.stateVersion = (mission.stateVersion ?? 1) + 1
  mission.resumeToken = `${mission.missionId}:${mission.stateVersion}`
}

export function ensureOperationsFields(mission: FoundryMissionRecord): FoundryMissionRecord {
  mission.priority ??= 'NORMAL'
  mission.owner ??= 'commander'
  mission.workspace ??= resolveBaseRepoRoot()
  mission.repoIdentity ??= resolveBaseRepoRoot()
  mission.resumeToken ??= `${mission.missionId}:1`
  mission.stateVersion ??= 1
  mission.lockClaims ??= []
  mission.runtimeClaims ??= []
  mission.durableToolCalls ??= []
  mission.ownedArtifacts ??= []
  mission.ownedCleanup ??= []
  mission.lastHeartbeat ??= mission.updatedAt
  mission.visibility ??= 'commander'
  mission.archived ??= false
  mission.superseded ??= false
  mission.resumeEligible ??= !mission.archived && !mission.superseded
  mission.testArtifact ??= false
  mission.productionRole ??= null
  mission.productionOwner ??= false
  mission.parentMissionId ??= null
  mission.helperMissionId ??= null
  mission.requestId ??= null
  return mission
}

export function pinDefaultModel(mission: FoundryMissionRecord): FoundryPinnedModel {
  const config = applyFoundryRuntimeConfig()
  const spec = config.primaryModel || FOUNDRY_DEFAULT_PRIMARY_MODEL
  const [provider, ...rest] = spec.split(':')
  const pinned: FoundryPinnedModel = {
    provider,
    modelId: rest.join(':') || spec,
    pinnedAt: now(),
  }
  mission.pinnedModel = pinned
  return pinned
}

export async function heartbeatMission(mission: FoundryMissionRecord, action?: string): Promise<void> {
  if (FOUNDRY_TERMINAL_STATES.includes(mission.status)) return
  mission.lastHeartbeat = now()
  if (action) mission.currentAction = action
  for (const claim of mission.lockClaims ?? []) {
    await heartbeatResourceClaim(claim.resource, mission.missionId)
  }
  if ((mission.lockClaims ?? []).some(claim => claim.resource === 'PRODUCTION_LEASE')) {
    const { heartbeatProductionLease } = await import('./foundryProductionLease')
    await heartbeatProductionLease(mission).catch(() => undefined)
  }
}

export async function registerMission(mission: FoundryMissionRecord): Promise<void> {
  ensureOperationsFields(mission)
  if (!mission.pinnedModel) pinDefaultModel(mission)
  bumpVersion(mission)
  await heartbeatMission(mission, 'queued')
  await upsertRegistry(mission)
}

export async function setMissionPriority(missionId: string, priority: FoundryMissionPriority): Promise<FoundryMissionRecord> {
  const mission = await loadMission(missionId)
  if (!mission) throw new Error(`Unknown mission ${missionId}`)
  if (!isFoundryMissionPriority(priority)) throw new Error(`Invalid priority ${priority}`)
  const previous = mission.priority ?? 'NORMAL'
  mission.priority = priority
  await appendJournal(mission, { kind: 'decision', text: `Priority ${previous} → ${priority}. Scheduling only; in-flight mutating tools are not cancelled.` })
  await saveMission(mission)
  await upsertRegistry(mission)
  return mission
}

export async function pauseMission(missionId: string, reason = 'Commander paused'): Promise<FoundryMissionRecord> {
  const mission = await loadMission(missionId)
  if (!mission) throw new Error(`Unknown mission ${missionId}`)
  if (FOUNDRY_TERMINAL_STATES.includes(mission.status)) return mission
  mission.pauseRequested = true
  if (mission.activeToolCallId) {
    const active = (mission.durableToolCalls ?? []).find(call => call.toolCallId === mission.activeToolCallId)
    if (active && classifyToolIdempotency(active.tool) !== 'READ_ONLY') {
      await appendJournal(mission, { kind: 'decision', text: `Pause requested while ${active.tool} is in flight. Waiting for that mutating call to finish.` })
      await saveMission(mission)
      return mission
    }
  }
  if (mission.status !== 'PAUSED') await transitionMission(mission, 'PAUSED', reason)
  await appendJournal(mission, { kind: 'decision', text: `Paused: ${reason}` })
  await saveMission(mission)
  await upsertRegistry(mission)
  return mission
}

export async function resumeMissionRecord(missionId: string): Promise<FoundryMissionRecord> {
  const mission = await loadMission(missionId)
  if (!mission) throw new Error(`Unknown mission ${missionId}`)
  if (!isResumeEligible(mission) || mission.superseded === true) {
    await appendJournal(mission, {
      kind: 'observation',
      text: `Resume refused: superseded/archived historical proof job resumeEligible=false. This mission stays inert.`,
    })
    await saveMission(mission)
    return mission
  }
  if (mission.authorization?.waiting) return mission
  mission.pauseRequested = false
  if (['PAUSED', 'WAITING_RESOURCE', 'RECOVERING', 'BLOCKED', 'QUEUED'].includes(mission.status)) {
    await transitionMission(mission, 'EXECUTING', 'Commander resumed the same mission')
  }
  await appendJournal(mission, { kind: 'decision', text: 'Resume requested for the same mission; no earlier work is replayed blindly.' })
  const { ensureLiveMissionReasoning } = await import('./reasoning-kernel/mission-lifecycle')
  await ensureLiveMissionReasoning(mission, 'RESUME')
  await saveMission(mission)
  await upsertRegistry(mission)
  return mission
}

export async function requestControlledAuthorization(
  mission: FoundryMissionRecord,
  action: string,
  reason: string,
  target = 'current mission',
  impact = 'Mission remains paused until Commander approves or denies this exact action.',
): Promise<void> {
  mission.authorization = {
    waiting: true,
    action,
    reason,
    target,
    impact,
    requestedAt: now(),
    approvalState: 'pending',
  }
  if (mission.status !== 'WAITING_AUTHORIZATION') {
    await transitionMission(mission, 'WAITING_AUTHORIZATION', reason)
  }
  await appendJournal(mission, { kind: 'auth', text: `WAITING_AUTHORIZATION ${action}: ${reason}` })
  await saveMission(mission)
  await upsertRegistry(mission)
}

export async function claimToolResources(
  mission: FoundryMissionRecord,
  tool: string,
  input: Record<string, unknown>,
  waitMs = 0,
): Promise<{ ok: true; releases: Array<() => Promise<void>>; ephemeral: FoundryResourceId[] } | { ok: false; wait: boolean; error: string; holders?: string[] }> {
  const resources = resourcesForTool(tool, input)
  if (tool === 'file.write' || tool === 'file.patch' || tool === 'file.replace_unique' || tool === 'file.move' || tool === 'file.delete') {
    const paths = intendedWritePaths(input)
    if (paths.length) {
      const { assertBrokerWriteAuthorized } = await import('./foundryMissionWriteSet')
      const writeSet = await assertBrokerWriteAuthorized(mission, tool, input)
      if (!writeSet.ok) {
        return { ok: false, wait: false, error: writeSet.error ?? 'REFUSED_OUTSIDE_WRITE_SET' }
      }
      const baselineCheck = paths.map(rel => reconcileWriteBaseline(mission, rel)).find(item => !item.ok)
      if (baselineCheck && !baselineCheck.ok) {
        return { ok: false, wait: false, error: baselineCheck.reason }
      }
      const conflict = await detectWriteConflict(mission, paths)
      if (conflict.conflict) {
        return { ok: false, wait: true, error: conflict.reason ?? 'Write conflict', holders: conflict.holders }
      }
      if (!mission.baseline) await recordMissionBaseline(mission, paths)
    }
  }
  const releases: Array<() => Promise<void>> = []
  const ephemeral: FoundryResourceId[] = []
  const alreadyHeld = (mission.lockClaims ?? []).map(claim => claim.resource)
  for (const resource of resources) {
    if (resource === 'PRODUCTION_LEASE') {
      const { acquireProductionLease } = await import('./foundryProductionLease')
      const mode = input.activationMode === 'MAINTENANCE_ROLLBACK' || input.activationMode === 'RELAUNCH_CURRENT' || input.activationMode === 'MISSION'
        ? input.activationMode
        : undefined
      const lease = await acquireProductionLease({
        mission,
        waitMs,
        installTarget: typeof input.installId === 'string' ? input.installId : mission.installState.installId,
        mode,
        commanderExplicitRollback: input.commanderExplicitRollback === true,
      })
      if (!lease.ok) {
        for (const release of releases.reverse()) await release()
        return { ok: false, wait: lease.wait, error: lease.error, holders: lease.holder ? [lease.holder] : undefined }
      }
      alreadyHeld.push(resource)
      continue
    }
    const acquired = await acquireResource({
      resource,
      missionId: mission.missionId,
      operation: tool,
      paths: intendedWritePaths(input),
      waitMs,
      alreadyHeld,
    })
    if (acquired.state === 'DEADLOCK_REFUSED') {
      for (const release of releases.reverse()) await release()
      return { ok: false, wait: false, error: acquired.error }
    }
    if (acquired.state !== 'ACQUIRED') {
      for (const release of releases.reverse()) await release()
      return {
        ok: false,
        wait: true,
        error: `${resource} busy` + (acquired.holder ? ` (holder ${acquired.holder.missionId})` : ''),
        holders: acquired.holder ? [acquired.holder.missionId] : undefined,
      }
    }
    alreadyHeld.push(resource)
    mission.lockClaims = [...(mission.lockClaims ?? []).filter(claim => claim.resource !== resource), acquired.claim]
    if (resource === 'ACTIVE_RUNTIME') {
      mission.runtimeClaims = [...new Set([...(mission.runtimeClaims ?? []), 'ACTIVE_RUNTIME'])]
    }
    if (resource === 'REPO_WRITE') {
      // Held until a terminal release unless the tool layer explicitly released it.
    } else {
      releases.push(acquired.release)
      ephemeral.push(resource)
    }
  }
  return { ok: true, releases, ephemeral }
}

export async function beginDurableTool(
  mission: FoundryMissionRecord,
  tool: EngineerToolName,
  input: Record<string, unknown>,
): Promise<FoundryDurableToolCall> {
  const call = createDurableToolCall(mission, tool, input)
  call.status = 'STARTED'
  attachDurableToolCall(mission, call)
  await persistDurableToolCall(call)
  mission.currentAction = tool
  await heartbeatMission(mission, tool)
  return call
}

export async function finishDurableTool(
  mission: FoundryMissionRecord,
  call: FoundryDurableToolCall,
  ok: boolean,
  summary: string,
  artifacts: string[] = [],
): Promise<void> {
  call.status = ok ? 'SUCCEEDED' : 'FAILED'
  call.endTime = now()
  call.resultSummary = summary.slice(0, 800)
  call.artifacts = artifacts
  mission.activeToolCallId = null
  for (const artifact of artifacts) {
    const kind: FoundryOwnedArtifact['kind'] = /screenshot/.test(artifact)
      ? 'screenshot'
      : /install/i.test(artifact) ? 'install' : 'other'
    mission.ownedArtifacts = [...(mission.ownedArtifacts ?? []), {
      artifactId: randomUUID(),
      missionId: mission.missionId,
      kind,
      path: artifact,
      createdAt: now(),
    }].slice(-80)
  }
  if (call.tool === 'file.write' || call.tool === 'file.patch' || call.tool === 'file.replace_unique') {
    for (const rel of intendedWritePaths({})) rememberTouchedHash(mission, rel)
  }
  await persistDurableToolCall(call)
}

export async function waitForResource(mission: FoundryMissionRecord, error: string): Promise<void> {
  mission.blocker = {
    blocker: 'Waiting for a shared Foundry resource',
    evidence: error,
    attempted: mission.currentAction ?? 'resource claim',
    why: 'Another mission currently owns a mutating resource this mission needs.',
    unblock: 'Wait for the owning mission to finish or release the claim, then resume.',
  }
  if (mission.status !== 'WAITING_RESOURCE') await transitionMission(mission, 'WAITING_RESOURCE', error)
  await appendJournal(mission, { kind: 'observation', text: `WAITING_RESOURCE: ${error}` })
  await saveMission(mission)
  await upsertRegistry(mission)
}

export async function recordOwnedCleanup(
  mission: FoundryMissionRecord,
  kind: 'process' | 'port' | 'workspace' | 'browser-page' | 'fixture' | 'temp',
  label: string,
  shared = false,
): Promise<void> {
  mission.ownedCleanup = [...(mission.ownedCleanup ?? []), {
    resourceId: randomUUID(),
    missionId: mission.missionId,
    kind,
    label,
    shared,
  }].slice(-80)
}

export async function cleanupOwnedResources(mission: FoundryMissionRecord): Promise<void> {
  const { isTerminalClaimMission, releaseTerminalMissionClaims } = await import('./foundryTerminalResourceRelease')
  if (isTerminalClaimMission(mission)) {
    await releaseTerminalMissionClaims(mission)
    await appendJournal(mission, { kind: 'decision', text: `Released terminal mission claims for ${mission.missionId}. Installed runtime and historical production generations were left intact.` })
    return
  }
  const { shouldHoldProductionLease, releaseProductionLease } = await import('./foundryProductionLease')
  try {
    const { executeEngineerTool } = await import('./engineerTools')
    const owned = (mission.ownedCleanup ?? []).filter(item => !item.shared)
    if (owned.some(item => item.kind === 'process') || hasActiveProcesses(mission.missionId)) {
      await executeEngineerTool({ tool: 'process.stop', input: {} }, { repairId: mission.missionId })
    }
  } finally {
    const holdLease = shouldHoldProductionLease(mission)
    if (holdLease) {
      await releaseMissionResources(mission.missionId, FOUNDRY_LOCK_ORDER.filter(resource => resource !== 'PRODUCTION_LEASE'))
      mission.lockClaims = (mission.lockClaims ?? []).filter(claim => claim.resource === 'PRODUCTION_LEASE')
    } else {
      await releaseMissionResources(mission.missionId)
      mission.lockClaims = []
      mission.runtimeClaims = []
      await releaseProductionLease(mission.missionId).catch(() => undefined)
    }
  }
  await appendJournal(mission, { kind: 'decision', text: `Cleaned resources owned by ${mission.missionId} only. Shared Foundry browser/profile and peer mission artifacts were left intact.` })
}

export function journalModelPinChange(
  mission: FoundryMissionRecord,
  nextProvider: string,
  nextModel: string,
  reason: string,
): void {
  const previous = mission.pinnedModel
  if (previous && previous.provider === nextProvider && previous.modelId === nextModel) return
  mission.pinnedModel = {
    provider: nextProvider,
    modelId: nextModel,
    pinnedAt: now(),
  }
  void appendJournal(mission, {
    kind: 'decision',
    text: `MODEL PIN CHANGE old=${previous?.provider ?? 'none'}/${previous?.modelId ?? 'none'} new=${nextProvider}/${nextModel} reason=${reason} time=${now()}`,
  })
}

export async function noteProviderOutcome(
  mission: FoundryMissionRecord,
  provider: string,
  model: string | null,
  ok: boolean,
  error?: string,
  failureClass?: string,
): Promise<void> {
  if (ok) {
    await recordProviderSuccess(provider, model)
    if (model) journalModelPinChange(mission, provider, model, 'successful reasoning call')
    return
  }
  await recordProviderFailure(provider, model, error ?? 'provider failure', failureClass ?? 'PROVIDER')
}

export async function checkpointIfNeeded(mission: FoundryMissionRecord, tool?: string): Promise<void> {
  if (!shouldCheckpoint(mission, tool)) return
  const checkpoint = buildMissionCheckpoint(mission, tool ?? mission.currentAction ?? '')
  await persistCheckpoint(mission, checkpoint)
  await archiveOldObservations(mission)
}

export function detectStall(mission: FoundryMissionRecord): string | null {
  if (FOUNDRY_TERMINAL_STATES.includes(mission.status) || mission.status === 'PAUSED') return null
  if (hasActiveProcesses(mission.missionId)) return null
  const beat = Date.parse(mission.lastHeartbeat ?? mission.updatedAt)
  if (Number.isFinite(beat) && Date.now() - beat > HEARTBEAT_STALL_MS) {
    return `No heartbeat since ${mission.lastHeartbeat} and no live owned process.`
  }
  if ((mission.modelState?.consecutiveFailures ?? 0) >= 3) return 'Repeated provider error.'
  if ((mission.modelState?.repeatedActionCount ?? 0) >= 4) return 'Repeated model loop.'
  return null
}

export async function recoverOperations(): Promise<{
  recovered: FoundryRegistryEntry[]
  reclaimedLocks: number
  notes: string[]
}> {
  applyFoundryRuntimeConfig()
  persistFoundryRuntimeConfig()
  const notes: string[] = []
  const reclaimed = await reclaimStaleResources()
  notes.push(`Reclaimed ${reclaimed.length} stale resource locks.`)
  const { reconcileTerminalMissionClaims } = await import('./foundryTerminalResourceRelease')
  const allMissions = await listAllMissions()
  const terminalReconcile = await reconcileTerminalMissionClaims(allMissions)
  for (const item of terminalReconcile) {
    const mission = allMissions.find(entry => entry.missionId === item.missionId)
    if (mission) await saveMission(mission)
  }
  notes.push(`Reconciled ${terminalReconcile.length} terminal missions with leftover claims.`)
  const { runProductionLeaseWatchdog } = await import('./foundryProductionLeaseWatchdog')
  const watchdog = await runProductionLeaseWatchdog()
  notes.push(`Production lease watchdog: ${watchdog.code} released=${watchdog.released} ${watchdog.reason}`)
  const archivedSystem = await archiveConfirmedSystemTestMissions()
  notes.push(`Archived ${archivedSystem.archived.length} confirmed system/test missions.`)
  const { recoverStaleSessionMissionPointers } = await import('./foundrySessions')
  const staleSessions = await recoverStaleSessionMissionPointers()
  notes.push(`Cleared ${staleSessions} stale session mission pointers.`)
  const missions = (await listMissions(500)).filter(mission => {
    if (FOUNDRY_TERMINAL_STATES.includes(mission.status)) return false
    if (!isResumeEligible(mission) || mission.superseded === true) return false
    if (isArchivedSystemMission(mission)) return false
    if (isTestMissionClass(classifyFoundryMission(mission).classification)) return false
    return true
  })
  const recovered: FoundryRegistryEntry[] = []
  for (const mission of missions) {
    if (isArchivedSystemMission(mission)) continue
    if (isTestMissionClass(classifyFoundryMission(mission).classification)) continue
    ensureOperationsFields(mission)
    if (mission.status !== 'RECOVERING' && !FOUNDRY_HOLD_STATES.includes(mission.status)) {
      await transitionMission(mission, 'RECOVERING', 'Operations manager startup recovery')
    }
    const interrupted = markInFlightToolsInterrupted(mission)
    for (const call of interrupted) await persistDurableToolCall(call)
    const stall = detectStall(mission)
    let disposition: FoundryRecoveryDisposition = 'READY_TO_RESUME'
    if (mission.authorization?.waiting) disposition = 'WAITING_FOR_AUTHORIZATION'
    else if (mission.status === 'WAITING_RESOURCE' || (mission.lockClaims ?? []).some(claim => claim.missionId !== mission.missionId)) {
      disposition = 'WAITING_FOR_RESOURCE'
    } else if (mission.blocker && mission.status === 'BLOCKED') disposition = 'BLOCKED'
    else if (interrupted.length) disposition = 'RECONCILING'
    if (stall && disposition === 'READY_TO_RESUME') disposition = 'RECONCILING'
    mission.recovery = {
      recoveredAt: now(),
      recovered: true,
      disposition,
      interruptedToolCalls: interrupted.map(call => call.toolCallId),
      notes: [
        `${interrupted.length} in-flight tool calls marked ${interrupted[0]?.status ?? 'none'}.`,
        stall ?? 'No stall.',
        'Interrupted mutating operations were not assumed successful and will not be replayed blindly.',
      ],
    }
    if (disposition === 'WAITING_FOR_AUTHORIZATION' && mission.status !== 'WAITING_AUTHORIZATION') {
      await transitionMission(mission, 'WAITING_AUTHORIZATION', 'Authorization request survived restart')
    } else if (disposition === 'WAITING_FOR_RESOURCE' && mission.status !== 'WAITING_RESOURCE') {
      await transitionMission(mission, 'WAITING_RESOURCE', 'Resource claim still outstanding after restart')
    } else if (disposition === 'READY_TO_RESUME' && mission.status === 'RECOVERING') {
      await transitionMission(mission, 'PAUSED', 'Recovered and ready to resume the same mission')
    }
    await appendJournal(mission, { kind: 'observation', text: `RECOVERED MISSION disposition=${disposition}` })
    await saveMission(mission)
    recovered.push(await upsertRegistry(mission))
    recoveredThisProcess.add(mission.missionId)
  }
  await rebuildRegistry()
  await logWarRoomRepoAudit('foundry-ops: recover', { recovered: recovered.length, reclaimed: reclaimed.length })
  return { recovered, reclaimedLocks: reclaimed.length, notes }
}

export async function ensureRecovered(): Promise<void> {
  if (recoveredThisProcess.has('__boot__')) return
  if (!recoveringBoot) {
    recoveringBoot = recoverOperations().then(() => {
      recoveredThisProcess.add('__boot__')
    }).finally(() => {
      recoveringBoot = null
    })
  }
  await recoveringBoot
}

export function scheduleReady(entries: FoundryRegistryEntry[]): FoundryRegistryEntry[] {
  return sortByPriority(entries.filter(entry =>
    ['QUEUED', 'WAITING_RESOURCE', 'PAUSED', 'RECOVERING'].includes(entry.status)
    && !entry.authorizationWaiting
    && !entry.archived
    && entry.superseded !== true
    && entry.resumeEligible !== false
    && entry.visibility !== 'system'
    && !entry.testArtifact
    && entry.priority !== undefined,
  ))
}

export async function inspectOperations(missionId?: string) {
  const missions = missionId
    ? [(await loadMission(missionId))].filter((mission): mission is FoundryMissionRecord => Boolean(mission))
    : await listMissions(80)
  return {
    registry: missions.map(toRegistryEntry),
    claims: await listResourceClaims(),
    runtimeConfig: readFoundryRuntimeConfig(),
    productionLease: await (await import('./foundryProductionLease')).readProductionLease(),
  }
}

export { FOUNDRY_HOLD_STATES }
