/**
 * Single live production lease. One mission may hold production transition
 * (build/package/install/activate) at a time. Peers may still search/read/edit.
 *
 * Acquisition is atomic via create-only (wx) on production-lease.json and the
 * PRODUCTION_LEASE resource lock. Two concurrent acquirers cannot both succeed.
 *
 * Generation is copied from the production-owner record and is never incremented
 * by lease acquire. Only an authorized production transition bumps generation.
 */
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { foundryDataHierarchy } from './foundryPaths'
import { loadMission } from './foundryMissionStore'
import { acquireResource, heartbeatResourceClaim, listResourceClaims, releaseResource } from './foundryResourceLocks'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { classifyFoundryMission, isResumeEligible, isTestMissionClass } from './foundryMissionVisibility'
import { isLiveProductionMission, readProductionOwner, type ProductionActivationMode } from './foundryProductionOwnership'
import type { FoundryMissionRecord, FoundryMissionState } from './foundryMissionTypes'

export const REFUSED_PRODUCTION_LEASE_HELD = 'REFUSED_PRODUCTION_LEASE_HELD'
export const REFUSED_HELPER_NOT_PRODUCTION_OWNER = 'REFUSED_HELPER_NOT_PRODUCTION_OWNER'
export const PRODUCTION_LEASE_RESOURCE = 'PRODUCTION_LEASE' as const

export type FoundryProductionLease = {
  ownerMissionId: string
  ownerClass: string | null
  productionGeneration: number
  /** @deprecated alias of ownerMissionId for existing readers */
  missionId: string
  generation: number
  targetInstallId: string | null
  /** @deprecated alias of targetInstallId */
  installTarget: string | null
  acquiredAt: string
  updatedAt: string
  heartbeatAt: string
  leaseUpdatedAt: string
  phase: string
  mode: ProductionActivationMode
  pid: number
}

export type ProductionLeaseRecovery =
  | { disposition: 'RESUME_OWNER'; lease: FoundryProductionLease; reason: string }
  | { disposition: 'TERMINATE_AND_RELEASE'; lease: FoundryProductionLease | null; reason: string }
  | { disposition: 'AMBIGUOUS_HOLD'; lease: FoundryProductionLease; reason: string }

const HOLD_STATES = new Set<FoundryMissionState>([
  'EXECUTING',
  'VALIDATING',
  'BUILDING',
  'PACKAGING',
  'INSTALLING',
  'VERIFYING',
  'REPLANNING',
  'WAITING_RESOURCE',
  'WAITING_AUTHORIZATION',
  'ACTIVATION_PENDING',
  'RECOVERING',
  'PAUSED',
])

const PENDING_PRODUCTION_INTENTS = new Set([
  'BUILD',
  'PACKAGE',
  'INSTALL',
  'ACTIVATE',
  'TRANSITION',
  'IDENTITY',
  'BROWSER_VERIFY',
  'COMPUTER_VERIFY',
])

function leasePath(): string {
  return path.join(foundryDataHierarchy().operations, 'production-lease.json')
}

function nowIso(): string {
  return new Date().toISOString()
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

export function isHelperNotProductionOwner(mission: FoundryMissionRecord | null | undefined): boolean {
  if (!mission) return false
  if (mission.productionRole === 'PRODUCTION_OWNER' || mission.productionOwner === true) return false
  if (mission.productionRole === 'HELPER') return true
  if (mission.parentMissionId && mission.parentMissionId !== mission.missionId) return true
  return false
}

export function productionCriticalProcessesRunning(): boolean {
  try {
    const { execSync } = require('node:child_process') as typeof import('node:child_process')
    const raw = execSync('ps -eo pid,cmd --no-headers', { encoding: 'utf8', timeout: 2_000 })
    return raw.split('\n').some(line => {
      if (/cursorsandbox|cursor-sandbox/.test(line)) return false
      return /\belectron-builder\b|\bnext build\b|\bdpkg-deb\b|\bpnpm (?:run )?package\b|installer\.install/.test(line)
    })
  } catch {
    return false
  }
}

function installedRuntimeServing(): boolean {
  try {
    const { execSync } = require('node:child_process') as typeof import('node:child_process')
    execSync('curl -s -o /dev/null -m 1 http://127.0.0.1:3848/', { encoding: 'utf8', timeout: 2_000 })
    return true
  } catch {
    return false
  }
}

export function hasPendingProductionWork(mission: FoundryMissionRecord): boolean {
  if (mission.plan.some(step => PENDING_PRODUCTION_INTENTS.has(step.intent) && (step.status === 'pending' || step.status === 'active'))) {
    return true
  }
  if (mission.sourceState.changedFiles.length && mission.installState.ok !== true) return true
  if (mission.buildState.ok === true && mission.packageState.ok !== true) return true
  if (mission.packageState.ok === true && mission.installState.ok !== true) return true
  return false
}

function leasePhase(mission: FoundryMissionRecord): string {
  if (mission.plan.some(step => step.intent === 'BROWSER_VERIFY' && (step.status === 'pending' || step.status === 'active'))) {
    return 'BROWSER_ACCEPTANCE'
  }
  if (mission.plan.some(step => step.intent === 'COMPUTER_VERIFY' && (step.status === 'pending' || step.status === 'active'))) {
    return 'COMPUTER_ACCEPTANCE'
  }
  return mission.status
}

export function shouldHoldProductionLease(mission: FoundryMissionRecord | null | undefined): boolean {
  if (!mission) return false
  if (mission.archived === true || mission.superseded === true || mission.resumeEligible === false) return false
  if (!isResumeEligible(mission)) return false
  if (['COMPLETE', 'FAILED', 'CANCELLED'].includes(mission.status)) return false
  if (HOLD_STATES.has(mission.status)) return true
  if (mission.status === 'BLOCKED' && hasPendingProductionWork(mission)) return true
  return false
}

function asLease(parsed: Partial<FoundryProductionLease>): FoundryProductionLease | null {
  const ownerMissionId = typeof parsed.ownerMissionId === 'string' ? parsed.ownerMissionId
    : (typeof parsed.missionId === 'string' ? parsed.missionId : null)
  if (!ownerMissionId) return null
  const target = typeof parsed.targetInstallId === 'string' ? parsed.targetInstallId
    : (typeof parsed.installTarget === 'string' ? parsed.installTarget : null)
  const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt
    : (typeof parsed.leaseUpdatedAt === 'string' ? parsed.leaseUpdatedAt
      : (typeof parsed.heartbeatAt === 'string' ? parsed.heartbeatAt : nowIso()))
  const mode: ProductionActivationMode = parsed.mode === 'MAINTENANCE_ROLLBACK' || parsed.mode === 'RELAUNCH_CURRENT'
    ? parsed.mode
    : 'MISSION'
  const generation = typeof parsed.productionGeneration === 'number' && Number.isFinite(parsed.productionGeneration)
    ? parsed.productionGeneration
    : (typeof parsed.generation === 'number' && Number.isFinite(parsed.generation) ? parsed.generation : 1)
  return {
    ownerMissionId,
    ownerClass: typeof parsed.ownerClass === 'string' ? parsed.ownerClass : null,
    productionGeneration: generation,
    missionId: ownerMissionId,
    generation,
    targetInstallId: target,
    installTarget: target,
    acquiredAt: typeof parsed.acquiredAt === 'string' ? parsed.acquiredAt : nowIso(),
    updatedAt,
    heartbeatAt: typeof parsed.heartbeatAt === 'string' ? parsed.heartbeatAt : updatedAt,
    leaseUpdatedAt: typeof parsed.leaseUpdatedAt === 'string' ? parsed.leaseUpdatedAt : updatedAt,
    phase: typeof parsed.phase === 'string' ? parsed.phase : 'EXECUTING',
    mode,
    pid: typeof parsed.pid === 'number' ? parsed.pid : 0,
  }
}

function stampLease(input: {
  mission: FoundryMissionRecord
  generation: number
  mode: ProductionActivationMode
  installTarget?: string | null
  acquiredAt?: string
}): FoundryProductionLease {
  const now = nowIso()
  const target = input.installTarget ?? input.mission.installState.installId ?? null
  return {
    ownerMissionId: input.mission.missionId,
    ownerClass: classifyFoundryMission(input.mission).classification,
    productionGeneration: input.generation,
    missionId: input.mission.missionId,
    generation: input.generation,
    targetInstallId: target,
    installTarget: target,
    acquiredAt: input.acquiredAt ?? now,
    updatedAt: now,
    heartbeatAt: now,
    leaseUpdatedAt: now,
    phase: leasePhase(input.mission),
    mode: input.mode,
    pid: process.pid,
  }
}

export async function readProductionLease(pathOverride?: string): Promise<FoundryProductionLease | null> {
  const file = pathOverride ?? leasePath()
  if (!existsSync(file)) return null
  try {
    return asLease(JSON.parse(await readFile(file, 'utf8')) as Partial<FoundryProductionLease>)
  } catch {
    return null
  }
}

async function writeProductionLease(lease: FoundryProductionLease, pathOverride?: string, createOnly = false): Promise<boolean> {
  const file = pathOverride ?? leasePath()
  await mkdir(path.dirname(file), { recursive: true })
  if (createOnly) {
    try {
      const handle = await open(file, 'wx')
      try {
        await handle.writeFile(JSON.stringify(lease, null, 2), 'utf8')
      } finally {
        await handle.close()
      }
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') return false
      throw error
    }
  }
  await writeFile(file, JSON.stringify(lease, null, 2), 'utf8')
  return true
}

export async function inspectLeaseOwnerLiveness(lease: FoundryProductionLease): Promise<{
  ownerLive: boolean
  processAlive: boolean
  productionProcesses: boolean
  missionStatus: string | null
  reclaimable: boolean
  reason: string
}> {
  const ownerMissionId = lease.ownerMissionId || lease.missionId
  const processAlive = isProcessAlive(lease.pid)
  const productionProcesses = productionCriticalProcessesRunning()
  const runtimeServing = installedRuntimeServing()
  const mission = ownerMissionId ? await loadMission(ownerMissionId) : null
  const sameProcessGhost = !mission && processAlive && lease.pid === process.pid
  const missionHolds = sameProcessGhost || shouldHoldProductionLease(mission)
  const ownerLive = missionHolds && (processAlive || productionProcesses || runtimeServing || sameProcessGhost)
  const terminal = mission != null && (mission.status === 'COMPLETE' || mission.status === 'FAILED' || mission.status === 'CANCELLED')
  const missingDead = !mission && !processAlive
  const terminalDead = terminal && !ownerLive && !processAlive
  const reclaimable = (missingDead || terminalDead) || (!ownerLive && !processAlive && !productionProcesses && !runtimeServing)
  return {
    ownerLive,
    processAlive,
    productionProcesses,
    missionStatus: mission?.status ?? null,
    reclaimable,
    reason: reclaimable
      ? (terminalDead
        ? `Owner ${ownerMissionId} is ${mission?.status} and its lease pid is dead — reclaim stale PRODUCTION_LEASE.`
        : missingDead
          ? `Lease owner ${ownerMissionId} is missing and pid ${lease.pid} is dead — reclaim.`
          : 'Owner is not live and no production-critical process remains.')
      : ownerLive
        ? `Owner ${ownerMissionId} still holds production (status=${mission?.status ?? 'missing-same-process'}).`
        : processAlive || productionProcesses || runtimeServing
          ? 'Owner process or production-critical work may still be running — do not seize production while owner state is ambiguous.'
          : 'Lease holder is gone.',
  }
}

export async function reclaimProductionLeaseIfSafe(pathOverride?: string): Promise<{
  released: boolean
  lease: FoundryProductionLease | null
  reason: string
}> {
  const lease = await readProductionLease(pathOverride)
  if (!lease) return { released: false, lease: null, reason: 'No production lease.' }
  const inspect = await inspectLeaseOwnerLiveness(lease)
  if (!inspect.reclaimable) {
    return { released: false, lease, reason: inspect.reason }
  }
  await rm(pathOverride ?? leasePath(), { force: true })
  await releaseResource('PRODUCTION_LEASE', lease.ownerMissionId).catch(() => undefined)
  await logWarRoomRepoAudit('foundry-ops: production-lease-reclaimed', {
    missionId: lease.ownerMissionId,
    reason: inspect.reason,
  })
  return { released: true, lease, reason: inspect.reason }
}

export async function recoverProductionLease(pathOverride?: string): Promise<ProductionLeaseRecovery> {
  const lease = await readProductionLease(pathOverride)
  if (!lease) return { disposition: 'TERMINATE_AND_RELEASE', lease: null, reason: 'No production lease.' }
  const inspect = await inspectLeaseOwnerLiveness(lease)
  if (inspect.ownerLive) {
    return { disposition: 'RESUME_OWNER', lease, reason: inspect.reason }
  }
  if (inspect.processAlive || inspect.productionProcesses) {
    return { disposition: 'AMBIGUOUS_HOLD', lease, reason: inspect.reason }
  }
  const released = await reclaimProductionLeaseIfSafe(pathOverride)
  return {
    disposition: 'TERMINATE_AND_RELEASE',
    lease: released.lease,
    reason: released.reason,
  }
}

async function currentGeneration(skipLiveMachine: boolean | undefined): Promise<number> {
  if (skipLiveMachine) return 1
  const owner = await readProductionOwner().catch(() => null)
  return owner?.productionGeneration ?? 1
}

function markProductionOwner(mission: FoundryMissionRecord, mode: ProductionActivationMode): void {
  if (mode === 'RELAUNCH_CURRENT') return
  mission.productionRole = 'PRODUCTION_OWNER'
  mission.productionOwner = true
}

export async function acquireProductionLease(input: {
  mission: FoundryMissionRecord
  waitMs?: number
  installTarget?: string | null
  pathOverride?: string
  skipLiveMachine?: boolean
  mode?: ProductionActivationMode
  commanderExplicitRollback?: boolean
}): Promise<
  | { ok: true; lease: FoundryProductionLease }
  | { ok: false; wait: boolean; code: string; error: string; holder?: string }
> {
  const mission = input.mission
  const mode: ProductionActivationMode = input.mode === 'MAINTENANCE_ROLLBACK' || input.mode === 'RELAUNCH_CURRENT'
    ? input.mode
    : 'MISSION'
  if (mode === 'RELAUNCH_CURRENT') {
    return {
      ok: false,
      wait: false,
      code: 'REFUSED_SCRIPT_BYPASS',
      error: 'RELAUNCH_CURRENT cannot acquire PRODUCTION_LEASE or change production owner.',
    }
  }
  if (isHelperNotProductionOwner(mission)) {
    return {
      ok: false,
      wait: false,
      code: REFUSED_HELPER_NOT_PRODUCTION_OWNER,
      error: `${REFUSED_HELPER_NOT_PRODUCTION_OWNER}: Helper ${mission.missionId} (parent=${mission.parentMissionId ?? 'none'}) cannot independently own production.`,
    }
  }
  if (mission.archived === true || mission.superseded === true || mission.resumeEligible === false || !isResumeEligible(mission)) {
    return { ok: false, wait: false, code: 'REFUSED_MISSION_NOT_CURRENT', error: `Mission ${mission.missionId} cannot acquire PRODUCTION_LEASE.` }
  }
  if (isTestMissionClass(classifyFoundryMission(mission).classification) && mission.kind === 'fixture' && mission.testArtifact === true && !input.skipLiveMachine) {
    return { ok: false, wait: false, code: 'REFUSED_MISSION_NOT_CURRENT', error: `Fixture ${mission.missionId} cannot acquire the live PRODUCTION_LEASE.` }
  }

  if (!input.skipLiveMachine && !(input.commanderExplicitRollback === true && mode === 'MAINTENANCE_ROLLBACK')) {
    const owner = await readProductionOwner().catch(() => null)
    if (owner?.productionOwnerMissionId && owner.productionOwnerMissionId !== mission.missionId) {
      const ownerMission = await loadMission(owner.productionOwnerMissionId)
      const ownerMissionLive = isLiveProductionMission(ownerMission) || shouldHoldProductionLease(ownerMission)
      if (ownerMissionLive) {
        const currentLease = await readProductionLease(input.pathOverride)
        if (currentLease && currentLease.ownerMissionId === owner.productionOwnerMissionId) {
          const inspect = await inspectLeaseOwnerLiveness(currentLease)
          if (inspect.ownerLive || !inspect.reclaimable) {
            return {
              ok: false,
              wait: (input.waitMs ?? 0) > 0,
              code: REFUSED_PRODUCTION_LEASE_HELD,
              error: `${REFUSED_PRODUCTION_LEASE_HELD}: live production owner ${owner.productionOwnerMissionId} still owns generation ${owner.productionGeneration}. ${inspect.reason}`,
              holder: owner.productionOwnerMissionId,
            }
          }
        } else if (installedRuntimeServing()) {
          return {
            ok: false,
            wait: (input.waitMs ?? 0) > 0,
            code: REFUSED_PRODUCTION_LEASE_HELD,
            error: `${REFUSED_PRODUCTION_LEASE_HELD}: live production owner ${owner.productionOwnerMissionId} still owns generation ${owner.productionGeneration} and the installed runtime is serving.`,
            holder: owner.productionOwnerMissionId,
          }
        }
      }
    }
  }

  const existing = await readProductionLease(input.pathOverride)
  if (existing && existing.ownerMissionId === mission.missionId) {
    const refreshed = stampLease({
      mission,
      generation: existing.generation,
      mode: existing.mode === 'MISSION' ? mode : existing.mode,
      installTarget: input.installTarget ?? existing.targetInstallId,
      acquiredAt: existing.acquiredAt,
    })
    await writeProductionLease(refreshed, input.pathOverride, false)
    await heartbeatResourceClaim('PRODUCTION_LEASE', mission.missionId).catch(() => undefined)
    markProductionOwner(mission, refreshed.mode)
    return { ok: true, lease: refreshed }
  }

  if (existing && existing.ownerMissionId !== mission.missionId) {
    const rollbackPreempt = input.commanderExplicitRollback === true && mode === 'MAINTENANCE_ROLLBACK'
    if (!rollbackPreempt && input.skipLiveMachine && existing.pid === process.pid) {
      return {
        ok: false,
        wait: (input.waitMs ?? 0) > 0,
        code: REFUSED_PRODUCTION_LEASE_HELD,
        error: `${REFUSED_PRODUCTION_LEASE_HELD}: Mission ${existing.ownerMissionId} holds PRODUCTION_LEASE in this process (status=${existing.phase} mode=${existing.mode}).`,
        holder: existing.ownerMissionId,
      }
    }
    const inspect = await inspectLeaseOwnerLiveness(existing)
    if (!rollbackPreempt && !inspect.reclaimable) {
      const wait = (input.waitMs ?? 0) > 0
      return {
        ok: false,
        wait,
        code: REFUSED_PRODUCTION_LEASE_HELD,
        error: `${REFUSED_PRODUCTION_LEASE_HELD}: Mission ${existing.ownerMissionId} holds PRODUCTION_LEASE (status=${inspect.missionStatus} mode=${existing.mode}). ${inspect.reason}`,
        holder: existing.ownerMissionId,
      }
    }
    await rm(input.pathOverride ?? leasePath(), { force: true })
    await releaseResource('PRODUCTION_LEASE', existing.ownerMissionId).catch(() => undefined)
    if (rollbackPreempt) {
      await logWarRoomRepoAudit('foundry-ops: production-lease-rollback-preempt', {
        from: existing.ownerMissionId,
        to: mission.missionId,
      })
    } else {
      await reclaimProductionLeaseIfSafe(input.pathOverride)
    }
  }

  const generation = await currentGeneration(input.skipLiveMachine)
  const lease = stampLease({ mission, generation, mode, installTarget: input.installTarget })

  if (input.skipLiveMachine) {
    const created = await writeProductionLease(lease, input.pathOverride, true)
    if (!created) {
      const winner = await readProductionLease(input.pathOverride)
      if (winner?.ownerMissionId === mission.missionId) return { ok: true, lease: winner }
      return {
        ok: false,
        wait: (input.waitMs ?? 0) > 0,
        code: REFUSED_PRODUCTION_LEASE_HELD,
        error: `${REFUSED_PRODUCTION_LEASE_HELD}: concurrent acquire lost to ${winner?.ownerMissionId ?? 'another mission'}`,
        holder: winner?.ownerMissionId,
      }
    }
    markProductionOwner(mission, mode)
    return { ok: true, lease }
  }

  const acquired = await acquireResource({
    resource: 'PRODUCTION_LEASE',
    missionId: mission.missionId,
    operation: 'production-lease',
    waitMs: input.waitMs ?? 0,
  })
  if (acquired.state !== 'ACQUIRED') {
    const wait = (input.waitMs ?? 0) > 0 && acquired.state !== 'DEADLOCK_REFUSED'
    const holderId = acquired.state === 'BUSY' || acquired.state === 'TIMEOUT'
      ? acquired.holder?.missionId
      : undefined
    return {
      ok: false,
      wait,
      code: REFUSED_PRODUCTION_LEASE_HELD,
      error: acquired.state === 'DEADLOCK_REFUSED'
        ? acquired.error
        : `${REFUSED_PRODUCTION_LEASE_HELD}: PRODUCTION_LEASE busy` + (holderId ? ` (holder ${holderId})` : ''),
      holder: holderId,
    }
  }
  const created = await writeProductionLease(lease, input.pathOverride, true)
  if (!created) {
    const winner = await readProductionLease(input.pathOverride)
    if (winner?.ownerMissionId !== mission.missionId) {
      await releaseResource('PRODUCTION_LEASE', mission.missionId).catch(() => undefined)
      return {
        ok: false,
        wait: false,
        code: REFUSED_PRODUCTION_LEASE_HELD,
        error: `${REFUSED_PRODUCTION_LEASE_HELD}: lease file won by ${winner?.ownerMissionId ?? 'peer'}`,
        holder: winner?.ownerMissionId,
      }
    }
  }
  mission.lockClaims = [...(mission.lockClaims ?? []).filter(claim => claim.resource !== 'PRODUCTION_LEASE'), acquired.claim]
  markProductionOwner(mission, mode)
  await logWarRoomRepoAudit('foundry-ops: production-lease-acquired', {
    ownerMissionId: mission.missionId,
    phase: lease.phase,
    mode,
    generation: lease.generation,
  })
  return { ok: true, lease }
}

export async function heartbeatProductionLease(mission: FoundryMissionRecord, pathOverride?: string): Promise<void> {
  const lease = await readProductionLease(pathOverride)
  if (!lease || lease.ownerMissionId !== mission.missionId) return
  const refreshed = stampLease({
    mission,
    generation: lease.generation,
    mode: lease.mode,
    installTarget: mission.installState.installId ?? lease.targetInstallId,
    acquiredAt: lease.acquiredAt,
  })
  await writeProductionLease(refreshed, pathOverride, false)
  await heartbeatResourceClaim('PRODUCTION_LEASE', mission.missionId).catch(() => undefined)
}

export async function releaseProductionLease(missionId: string, pathOverride?: string): Promise<void> {
  const lease = await readProductionLease(pathOverride)
  if (lease && lease.ownerMissionId !== missionId) return
  await rm(pathOverride ?? leasePath(), { force: true })
  await releaseResource('PRODUCTION_LEASE', missionId).catch(() => undefined)
  await logWarRoomRepoAudit('foundry-ops: production-lease-released', { missionId })
}

export async function assertProductionLeaseHeld(mission: FoundryMissionRecord, pathOverride?: string): Promise<
  | { ok: true; lease: FoundryProductionLease }
  | { ok: false; code: string; error: string }
> {
  if (isHelperNotProductionOwner(mission)) {
    return {
      ok: false,
      code: REFUSED_HELPER_NOT_PRODUCTION_OWNER,
      error: `${REFUSED_HELPER_NOT_PRODUCTION_OWNER}: Helper ${mission.missionId} is not the production owner.`,
    }
  }
  const lease = await readProductionLease(pathOverride)
  if (lease?.ownerMissionId === mission.missionId) return { ok: true, lease }
  const claims = await listResourceClaims()
  if (claims.some(claim => claim.resource === 'PRODUCTION_LEASE' && claim.missionId === mission.missionId)) {
    return { ok: true, lease: lease ?? stampLease({ mission, generation: 1, mode: 'MISSION' }) }
  }
  if (lease && lease.ownerMissionId !== mission.missionId) {
    return {
      ok: false,
      code: REFUSED_PRODUCTION_LEASE_HELD,
      error: `${REFUSED_PRODUCTION_LEASE_HELD}: holder=${lease.ownerMissionId} requester=${mission.missionId}`,
    }
  }
  return { ok: false, code: 'REFUSED_MISSION_NOT_CURRENT', error: `Mission ${mission.missionId} does not own PRODUCTION_LEASE.` }
}
