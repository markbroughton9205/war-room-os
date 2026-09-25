/**
 * Hierarchical mission resource locks. Reuses the build/package lock for BUILD/PACKAGE
 * and adds Foundry-owned locks for repo write, install, runtime, ports, and desktop.
 */
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { acquireBuildLock, type BuildLockPayload } from './buildLock'
import { foundryDataHierarchy } from './foundryPaths'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import {
  FOUNDRY_LOCK_ORDER,
  PRODUCTION_GATED_RESOURCES,
  type FoundryResourceClaim,
  type FoundryResourceId,
} from './foundryOperationsTypes'

const STALE_AFTER_MS: Record<FoundryResourceId, number> = {
  PROVIDER_SLOT: 20 * 60 * 1000,
  REPO_WRITE: 60 * 60 * 1000,
  PRODUCTION_LEASE: 90 * 60 * 1000,
  BUILD_PIPELINE: 30 * 60 * 1000,
  PACKAGE_PIPELINE: 30 * 60 * 1000,
  INSTALL_PIPELINE: 20 * 60 * 1000,
  ACTIVE_RUNTIME: 45 * 60 * 1000,
  PORT_3847: 20 * 60 * 1000,
  PORT_3848: 20 * 60 * 1000,
  PERSISTENT_BROWSER: 45 * 60 * 1000,
  COMPUTER_USE_DESKTOP: 20 * 60 * 1000,
  DEPLOY_TARGET: 20 * 60 * 1000,
}

const SHARED_RESOURCES = new Set<FoundryResourceId>(['PERSISTENT_BROWSER'])

export type ResourceAcquireResult =
  | { state: 'ACQUIRED'; claim: FoundryResourceClaim; release: () => Promise<void> }
  | { state: 'BUSY'; holder: FoundryResourceClaim }
  | { state: 'TIMEOUT'; holder: FoundryResourceClaim | null }
  | { state: 'DEADLOCK_REFUSED'; error: string }

let resourceLockRootOverride: string | null = null

export function setResourceLockRootForTests(root: string | null): void {
  resourceLockRootOverride = root
}

function lockPath(resource: FoundryResourceId): string {
  return path.join(resourceLockRootOverride || foundryDataHierarchy().resourceLocks, `${resource}.json`)
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

function isStale(claim: FoundryResourceClaim): boolean {
  if (!isProcessAlive(claim.pid)) return true
  const age = Date.now() - Date.parse(claim.heartbeatAt || claim.acquiredAt)
  return Number.isFinite(age) && age > STALE_AFTER_MS[claim.resource]
}

async function readClaim(resource: FoundryResourceId): Promise<FoundryResourceClaim | null> {
  try {
    const parsed = JSON.parse(await readFile(lockPath(resource), 'utf8')) as Partial<FoundryResourceClaim>
    if (typeof parsed.missionId !== 'string' || typeof parsed.pid !== 'number') return null
    return parsed as FoundryResourceClaim
  } catch {
    return null
  }
}

async function writeClaimAtomic(claim: FoundryResourceClaim, createOnly: boolean): Promise<boolean> {
  const file = lockPath(claim.resource)
  await mkdir(path.dirname(file), { recursive: true })
  if (createOnly) {
    try {
      const handle = await open(file, 'wx')
      try {
        await handle.writeFile(JSON.stringify(claim, null, 2))
      } finally {
        await handle.close()
      }
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') return false
      throw error
    }
  }
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, JSON.stringify(claim, null, 2), 'utf8')
  await rename(tmp, file)
  return true
}

export function lockOrderIndex(resource: FoundryResourceId): number {
  return FOUNDRY_LOCK_ORDER.indexOf(resource)
}

export function assertLockOrder(held: readonly FoundryResourceId[], next: FoundryResourceId): string | null {
  if (!held.length) return null
  const nextIndex = lockOrderIndex(next)
  const lastHeld = held.reduce((max, id) => Math.max(max, lockOrderIndex(id)), -1)
  if (nextIndex < lastHeld) {
    return `Deadlock prevention: cannot acquire ${next} after ${held.join(',')}. Required order: ${FOUNDRY_LOCK_ORDER.join(' → ')}`
  }
  return null
}

export async function listResourceClaims(): Promise<FoundryResourceClaim[]> {
  const claims: FoundryResourceClaim[] = []
  for (const resource of FOUNDRY_LOCK_ORDER) {
    const claim = await readClaim(resource)
    if (claim) claims.push(claim)
  }
  return claims
}

export async function heartbeatResourceClaim(resource: FoundryResourceId, missionId: string): Promise<void> {
  const current = await readClaim(resource)
  if (!current || current.missionId !== missionId) return
  current.heartbeatAt = new Date().toISOString()
  await writeClaimAtomic(current, false)
}

export async function releaseResource(resource: FoundryResourceId, missionId: string, callId?: string): Promise<void> {
  const current = await readClaim(resource)
  if (!current) return
  if (current.missionId !== missionId) return
  if (callId && current.callId !== callId) return
  await rm(lockPath(resource), { force: true })
  await logWarRoomRepoAudit('foundry-ops: resource.released', { resource, missionId, callId: current.callId })
}

export async function releaseMissionResources(missionId: string, resources?: readonly FoundryResourceId[]): Promise<void> {
  const targets = resources ?? FOUNDRY_LOCK_ORDER
  for (const resource of [...targets].reverse()) {
    await releaseResource(resource, missionId)
  }
}

/** Release only stale/dead claims owned by this mission. Live claims stay until the owner process ends. */
export async function releaseMissionResourcesIfStale(missionId: string): Promise<FoundryResourceClaim[]> {
  const released: FoundryResourceClaim[] = []
  for (const resource of [...FOUNDRY_LOCK_ORDER].reverse()) {
    const claim = await readClaim(resource)
    if (!claim || claim.missionId !== missionId) continue
    if (!isStale(claim)) continue
    await rm(lockPath(resource), { force: true })
    released.push(claim)
    await logWarRoomRepoAudit('foundry-ops: resource.stale_test_released', { resource, missionId, callId: claim.callId })
  }
  return released
}

export async function reclaimStaleResources(): Promise<FoundryResourceClaim[]> {
  const reclaimed: FoundryResourceClaim[] = []
  for (const resource of FOUNDRY_LOCK_ORDER) {
    const claim = await readClaim(resource)
    if (!claim || !isStale(claim)) continue
    await rm(lockPath(resource), { force: true })
    reclaimed.push(claim)
    await logWarRoomRepoAudit('foundry-ops: resource.stale_reclaimed', { resource, staleHolder: claim })
  }
  return reclaimed
}

export async function acquireResource(input: {
  resource: FoundryResourceId
  missionId: string
  operation: string
  paths?: string[]
  exclusive?: boolean
  waitMs?: number
  alreadyHeld?: readonly FoundryResourceId[]
}): Promise<ResourceAcquireResult> {
  const orderError = assertLockOrder(input.alreadyHeld ?? [], input.resource)
  if (orderError) return { state: 'DEADLOCK_REFUSED', error: orderError }

  if (PRODUCTION_GATED_RESOURCES.includes(input.resource)) {
    const held = input.alreadyHeld ?? []
    if (!held.includes('PRODUCTION_LEASE')) {
      const leaseHolder = await readClaim('PRODUCTION_LEASE')
      if (!leaseHolder || leaseHolder.missionId !== input.missionId) {
        return {
          state: 'DEADLOCK_REFUSED',
          error: `PRODUCTION_LEASE must be acquired before ${input.resource}. Required production order: PRODUCTION_LEASE → BUILD_PIPELINE → PACKAGE_PIPELINE → INSTALL_PIPELINE → ACTIVE_RUNTIME. Full order: ${FOUNDRY_LOCK_ORDER.join(' → ')}`,
        }
      }
    }
  }

  if (input.resource === 'BUILD_PIPELINE' || input.resource === 'PACKAGE_PIPELINE') {
    const build = await acquireBuildLock({
      missionId: input.missionId,
      operation: input.operation,
      waitMs: input.waitMs,
    })
    if (build.state !== 'ACQUIRED') {
      const holder = build.holder ? toClaimFromBuild(input.resource, build.holder) : null
      return build.state === 'BUSY'
        ? { state: 'BUSY', holder: holder! }
        : { state: 'TIMEOUT', holder }
    }
    const claim = toClaimFromBuild(input.resource, build.lock)
    await writeClaimAtomic(claim, false)
    return {
      state: 'ACQUIRED',
      claim,
      release: async () => {
        await build.release()
        await releaseResource(input.resource, input.missionId, claim.callId)
      },
    }
  }

  const exclusive = input.exclusive ?? !SHARED_RESOURCES.has(input.resource)
  const deadline = Date.now() + (input.waitMs ?? 0)
  const callId = randomUUID()
  const claim: FoundryResourceClaim = {
    resource: input.resource,
    missionId: input.missionId,
    callId,
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    exclusive,
    paths: input.paths,
    operation: input.operation,
  }

  let waited = false
  for (;;) {
    let holder = await readClaim(input.resource)
    if (holder && !isStale(holder) && holder.missionId !== input.missionId) {
      try {
        const { loadMission } = await import('./foundryMissionStore')
        const owner = await loadMission(holder.missionId)
        if (owner && ['COMPLETE', 'FAILED', 'CANCELLED'].includes(owner.status)) {
          await rm(lockPath(input.resource), { force: true })
          holder = null
        } else if (owner && owner.status === 'BLOCKED' && input.resource !== 'PRODUCTION_LEASE') {
          const { shouldHoldProductionLease } = await import('./foundryProductionLease')
          if (!shouldHoldProductionLease(owner)) {
            await rm(lockPath(input.resource), { force: true })
            holder = null
          }
        }
      } catch {
        /* keep current holder if owner lookup fails */
      }
    }
    if (holder && isStale(holder)) {
      await rm(lockPath(input.resource), { force: true })
      holder = null
    }
    if (holder) {
      if (holder.missionId === input.missionId) {
        holder.heartbeatAt = new Date().toISOString()
        await writeClaimAtomic(holder, false)
        return { state: 'ACQUIRED', claim: holder, release: async () => releaseResource(input.resource, input.missionId, holder.callId) }
      }
      if (!exclusive && !holder.exclusive && SHARED_RESOURCES.has(input.resource)) {
        return { state: 'ACQUIRED', claim: holder, release: async () => undefined }
      }
      if (Date.now() >= deadline) {
        await logWarRoomRepoAudit('foundry-ops: resource.busy', { requested: claim, holder })
        return waited && (input.waitMs ?? 0) > 0 ? { state: 'TIMEOUT', holder } : { state: 'BUSY', holder }
      }
      waited = true
      await new Promise(resolve => setTimeout(resolve, 200))
      continue
    }

    const created = await writeClaimAtomic(claim, true)
    if (created) {
      await logWarRoomRepoAudit('foundry-ops: resource.acquired', { ...claim })
      return {
        state: 'ACQUIRED',
        claim,
        release: async () => releaseResource(input.resource, input.missionId, callId),
      }
    }
    if (Date.now() >= deadline) {
      const current = await readClaim(input.resource)
      return { state: 'BUSY', holder: current! }
    }
    waited = true
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

function toClaimFromBuild(resource: FoundryResourceId, lock: BuildLockPayload): FoundryResourceClaim {
  return {
    resource,
    missionId: lock.missionId,
    callId: lock.callId,
    pid: lock.pid,
    acquiredAt: lock.startedAt,
    heartbeatAt: lock.startedAt,
    exclusive: true,
    operation: lock.operation,
  }
}

export function overlappingWritePaths(a: readonly string[] | undefined, b: readonly string[] | undefined): string[] {
  if (!a?.length || !b?.length) return a?.length && b === undefined ? [...a] : []
  const other = new Set(b)
  return a.filter(pathName => other.has(pathName) || [...other].some(item => pathName.startsWith(`${item}/`) || item.startsWith(`${pathName}/`)))
}

export function resourceLockFileExists(resource: FoundryResourceId): boolean {
  return existsSync(lockPath(resource))
}
