/**
 * PASS 013 production-lease watchdog.
 *
 * Runs during operations recovery / controller startup (ensureRecovered →
 * recoverOperations). Reclaims a stale PRODUCTION_LEASE only when the owner is
 * terminal, the owner pid is dead, no production-critical child remains, and
 * no ambiguous production transition is in progress.
 *
 * Never increments production generation. Never mutates production-owner.json,
 * ACTIVE_INSTALL_ID, or RUNNING_INSTALL_ID. Heartbeat age is evidence only.
 */
import { loadMission } from './foundryMissionStore'
import { installerActiveStatus } from './installerTool'
import { runtimeVerify } from './runtimeControl'
import { listResourceClaims, releaseResource } from './foundryResourceLocks'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { foundryDataHierarchy } from './foundryPaths'
import {
  productionCriticalProcessesRunning,
  readProductionLease,
  releaseProductionLease,
  type FoundryProductionLease,
} from './foundryProductionLease'
import { readProductionOwner, type FoundryProductionOwner } from './foundryProductionOwnership'
import type { FoundryMissionRecord, FoundryMissionState } from './foundryMissionTypes'
import type { FoundryResourceId } from './foundryOperationsTypes'
import { PRODUCTION_GATED_RESOURCES } from './foundryOperationsTypes'

export const LEASE_RECOVERY_SCAN = 'LEASE_RECOVERY_SCAN'
export const LEASE_RECOVERY_RELEASED = 'LEASE_RECOVERY_RELEASED'
export const LEASE_RECOVERY_DEFERRED_LIVE_OWNER = 'LEASE_RECOVERY_DEFERRED_LIVE_OWNER'
export const LEASE_RECOVERY_DEFERRED_AMBIGUOUS = 'LEASE_RECOVERY_DEFERRED_AMBIGUOUS'
export const LEASE_RECOVERY_DEFERRED_ORPHAN = 'LEASE_RECOVERY_DEFERRED_ORPHAN'

export const WATCHDOG_TERMINAL_STATES = new Set<FoundryMissionState>([
  'COMPLETE',
  'FAILED',
  'BLOCKED',
  'CANCELLED',
])

export const WATCHDOG_LIVE_OWNER_STATES = new Set<FoundryMissionState>([
  'QUEUED',
  'UNDERSTANDING',
  'INSPECTING',
  'PLANNING',
  'EXECUTING',
  'VALIDATING',
  'BUILDING',
  'PACKAGING',
  'INSTALLING',
  'VERIFYING',
  'REPLANNING',
  'PAUSED',
  'WAITING_AUTHORIZATION',
  'WAITING_RESOURCE',
  'ACTIVATION_PENDING',
  'RECOVERING',
])

export const WATCHDOG_STALE_CLAIM_RESOURCES: readonly FoundryResourceId[] = [
  'PRODUCTION_LEASE',
  ...PRODUCTION_GATED_RESOURCES,
]

export type LeaseWatchdogCode =
  | typeof LEASE_RECOVERY_SCAN
  | typeof LEASE_RECOVERY_RELEASED
  | typeof LEASE_RECOVERY_DEFERRED_LIVE_OWNER
  | typeof LEASE_RECOVERY_DEFERRED_AMBIGUOUS
  | typeof LEASE_RECOVERY_DEFERRED_ORPHAN

export type ProductionLeaseWatchdogOptions = {
  pathOverride?: string
  ownerPathOverride?: string
  skipLiveMachine?: boolean
  missionOverride?: FoundryMissionRecord | null
  processAliveOverride?: boolean
  productionProcessesOverride?: boolean
  runtimeIdentityOverride?: { activeInstallId: string | null; runningInstallId: string | null }
  nowMs?: number
}

export type ProductionLeaseWatchdogResult = {
  code: LeaseWatchdogCode
  released: boolean
  lease: FoundryProductionLease | null
  missionStatus: FoundryMissionState | null
  processAlive: boolean
  productionProcesses: boolean
  heartbeatAgeMs: number | null
  generationBefore: number | null
  generationAfter: number | null
  ownerRecordBefore: FoundryProductionOwner | null
  ownerRecordAfter: FoundryProductionOwner | null
  activeInstallId: string | null
  runningInstallId: string | null
  identityMatch: boolean | null
  claimsReleased: FoundryResourceId[]
  reason: string
  scannedAt?: string
}

export type FoundryLastWatchdogScan = {
  scannedAt: string
  code: LeaseWatchdogCode
  reason: string
  released: boolean
  generationBefore: number | null
  generationAfter: number | null
  activeInstallId: string | null
  runningInstallId: string | null
  identityMatch: boolean | null
  missionStatus: FoundryMissionState | null
}

function lastWatchdogScanPath(): string {
  return path.join(foundryDataHierarchy().operations, 'production-watchdog-scan.json')
}

export async function persistLastWatchdogScan(result: ProductionLeaseWatchdogResult): Promise<FoundryLastWatchdogScan> {
  const scan: FoundryLastWatchdogScan = {
    scannedAt: result.scannedAt ?? new Date().toISOString(),
    code: result.code,
    reason: result.reason,
    released: result.released,
    generationBefore: result.generationBefore,
    generationAfter: result.generationAfter,
    activeInstallId: result.activeInstallId,
    runningInstallId: result.runningInstallId,
    identityMatch: result.identityMatch,
    missionStatus: result.missionStatus,
  }
  await mkdir(path.dirname(lastWatchdogScanPath()), { recursive: true })
  await writeFile(lastWatchdogScanPath(), JSON.stringify(scan, null, 2), 'utf8')
  return scan
}

export async function readLastWatchdogScan(): Promise<FoundryLastWatchdogScan | null> {
  const file = lastWatchdogScanPath()
  if (!existsSync(file)) return null
  try {
    return JSON.parse(await readFile(file, 'utf8')) as FoundryLastWatchdogScan
  } catch {
    return null
  }
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

function heartbeatAgeMs(lease: FoundryProductionLease, nowMs: number): number | null {
  const stamp = Date.parse(lease.heartbeatAt || lease.leaseUpdatedAt || lease.updatedAt)
  if (!Number.isFinite(stamp)) return null
  return Math.max(0, nowMs - stamp)
}

function identityStable(active: string | null, running: string | null): boolean {
  return Boolean(active && running && active === running)
}

async function snapshotRuntime(options: ProductionLeaseWatchdogOptions): Promise<{
  activeInstallId: string | null
  runningInstallId: string | null
  known: boolean
}> {
  if (options.runtimeIdentityOverride) {
    return { ...options.runtimeIdentityOverride, known: true }
  }
  if (options.skipLiveMachine) {
    return { activeInstallId: null, runningInstallId: null, known: false }
  }
  try {
    const active = await installerActiveStatus()
    const verify = await runtimeVerify()
    return {
      activeInstallId: active.activeInstallId ?? null,
      runningInstallId: verify.runningInstallId ?? null,
      known: true,
    }
  } catch {
    return { activeInstallId: null, runningInstallId: null, known: false }
  }
}

function auditPayload(input: {
  code: LeaseWatchdogCode
  lease: FoundryProductionLease | null
  missionStatus: string | null
  processAlive: boolean
  productionProcesses: boolean
  heartbeatAgeMs: number | null
  identityMatch: boolean | null
  released: boolean
  reason: string
}): Record<string, unknown> {
  return {
    code: input.code,
    ownerMissionId: input.lease?.ownerMissionId ?? null,
    pid: input.lease?.pid ?? null,
    phase: input.lease?.phase ?? null,
    missionStatus: input.missionStatus,
    processAlive: input.processAlive,
    productionProcesses: input.productionProcesses,
    heartbeatAgeMs: input.heartbeatAgeMs,
    identityMatch: input.identityMatch,
    released: input.released,
    reason: input.reason,
  }
}

async function releaseStaleOwnerClaims(missionId: string): Promise<FoundryResourceId[]> {
  const released: FoundryResourceId[] = []
  const claims = await listResourceClaims()
  for (const resource of WATCHDOG_STALE_CLAIM_RESOURCES) {
    const held = claims.find(claim => claim.resource === resource && claim.missionId === missionId)
    if (!held) {
      await releaseResource(resource, missionId).catch(() => undefined)
      continue
    }
    await releaseResource(resource, missionId)
    released.push(resource)
  }
  return released
}

function decide(input: {
  mission: FoundryMissionRecord | null
  processAlive: boolean
  productionProcesses: boolean
  runtimeKnown: boolean
  runtimeStable: boolean
}): { code: Exclude<LeaseWatchdogCode, typeof LEASE_RECOVERY_SCAN>; reason: string } {
  const { mission, processAlive, productionProcesses, runtimeKnown, runtimeStable } = input
  if (mission) {
    const terminal = WATCHDOG_TERMINAL_STATES.has(mission.status)
    if (terminal) {
      if (processAlive) {
        return {
          code: LEASE_RECOVERY_DEFERRED_LIVE_OWNER,
          reason: `Terminal owner ${mission.missionId} pid is still live — do not reclaim.`,
        }
      }
      if (productionProcesses) {
        return {
          code: LEASE_RECOVERY_DEFERRED_AMBIGUOUS,
          reason: `Terminal owner ${mission.missionId} still has a production-critical child — do not reclaim or kill.`,
        }
      }
      return {
        code: LEASE_RECOVERY_RELEASED,
        reason: `Terminal owner ${mission.missionId} is ${mission.status}, pid is dead, and no production-critical child remains.`,
      }
    }
    if (processAlive) {
      return {
        code: LEASE_RECOVERY_DEFERRED_LIVE_OWNER,
        reason: `Live owner ${mission.missionId} is ${mission.status} with a live pid — heartbeat age is not sufficient to reclaim.`,
      }
    }
    return {
      code: LEASE_RECOVERY_DEFERRED_AMBIGUOUS,
      reason: `Nonterminal owner ${mission.missionId} pid is dead; production state is ambiguous — fail safe.`,
    }
  }

  if (processAlive) {
    return {
      code: LEASE_RECOVERY_DEFERRED_ORPHAN,
      reason: 'Lease owner mission is missing and pid is still live — retain.',
    }
  }
  if (productionProcesses) {
    return {
      code: LEASE_RECOVERY_DEFERRED_ORPHAN,
      reason: 'Lease owner mission is missing and production-critical work remains — retain.',
    }
  }
  if (!runtimeKnown || !runtimeStable) {
    return {
      code: LEASE_RECOVERY_DEFERRED_ORPHAN,
      reason: 'Lease owner mission is missing and runtime identity is not safely proven — fail safe.',
    }
  }
  return {
    code: LEASE_RECOVERY_RELEASED,
    reason: 'Orphan lease: missing mission, dead pid, no production-critical child, and stable runtime identity.',
  }
}

export async function runProductionLeaseWatchdog(
  options: ProductionLeaseWatchdogOptions = {},
): Promise<ProductionLeaseWatchdogResult> {
  const nowMs = options.nowMs ?? Date.now()
  const lease = await readProductionLease(options.pathOverride)
  const ownerRecordBefore = await readProductionOwner(options.ownerPathOverride).catch(() => null)
  const runtime = await snapshotRuntime(options)
  const empty: ProductionLeaseWatchdogResult = {
    code: LEASE_RECOVERY_SCAN,
    released: false,
    lease: null,
    missionStatus: null,
    processAlive: false,
    productionProcesses: false,
    heartbeatAgeMs: null,
    generationBefore: ownerRecordBefore?.productionGeneration ?? null,
    generationAfter: ownerRecordBefore?.productionGeneration ?? null,
    ownerRecordBefore,
    ownerRecordAfter: ownerRecordBefore,
    activeInstallId: runtime.activeInstallId,
    runningInstallId: runtime.runningInstallId,
    identityMatch: runtime.known ? identityStable(runtime.activeInstallId, runtime.runningInstallId) : null,
    claimsReleased: [],
    reason: 'No production lease.',
  }

  const scanBase = auditPayload({
    code: LEASE_RECOVERY_SCAN,
    lease,
    missionStatus: null,
    processAlive: false,
    productionProcesses: false,
    heartbeatAgeMs: lease ? heartbeatAgeMs(lease, nowMs) : null,
    identityMatch: empty.identityMatch,
    released: false,
    reason: lease ? 'Scanning production lease.' : empty.reason,
  })
  await logWarRoomRepoAudit(`foundry-ops: ${LEASE_RECOVERY_SCAN}`, scanBase)

  if (!lease) {
    empty.scannedAt = new Date().toISOString()
    if (!options.pathOverride) await persistLastWatchdogScan(empty)
    return empty
  }

  const processAlive = options.processAliveOverride ?? isProcessAlive(lease.pid)
  const productionProcesses = options.productionProcessesOverride ?? (
    options.skipLiveMachine ? false : productionCriticalProcessesRunning()
  )
  const mission = options.missionOverride !== undefined
    ? options.missionOverride
    : (lease.ownerMissionId ? await loadMission(lease.ownerMissionId) : null)
  const age = heartbeatAgeMs(lease, nowMs)
  const runtimeStable = identityStable(runtime.activeInstallId, runtime.runningInstallId)
  const decision = decide({
    mission,
    processAlive,
    productionProcesses,
    runtimeKnown: runtime.known,
    runtimeStable,
  })

  let claimsReleased: FoundryResourceId[] = []
  let released = false
  if (decision.code === LEASE_RECOVERY_RELEASED) {
    const ownerId = lease.ownerMissionId
    await releaseProductionLease(ownerId, options.pathOverride)
    claimsReleased = await releaseStaleOwnerClaims(ownerId)
    released = true
  }

  const ownerRecordAfter = await readProductionOwner(options.ownerPathOverride).catch(() => null)
  const result: ProductionLeaseWatchdogResult = {
    code: decision.code,
    released,
    lease,
    missionStatus: mission?.status ?? null,
    processAlive,
    productionProcesses,
    heartbeatAgeMs: age,
    generationBefore: ownerRecordBefore?.productionGeneration ?? lease.productionGeneration ?? lease.generation ?? null,
    generationAfter: ownerRecordAfter?.productionGeneration ?? ownerRecordBefore?.productionGeneration ?? lease.productionGeneration ?? lease.generation ?? null,
    ownerRecordBefore,
    ownerRecordAfter,
    activeInstallId: runtime.activeInstallId,
    runningInstallId: runtime.runningInstallId,
    identityMatch: runtime.known ? runtimeStable : null,
    claimsReleased,
    reason: decision.reason,
  }

  await logWarRoomRepoAudit(`foundry-ops: ${decision.code}`, auditPayload({
    code: decision.code,
    lease,
    missionStatus: mission?.status ?? null,
    processAlive,
    productionProcesses,
    heartbeatAgeMs: age,
    identityMatch: result.identityMatch,
    released,
    reason: decision.reason,
  }))
  result.scannedAt = new Date().toISOString()
  if (!options.pathOverride) {
    await persistLastWatchdogScan(result)
  }
  return result
}
