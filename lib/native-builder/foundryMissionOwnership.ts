/**
 * One executor and one writer per mission.
 *
 * Root cause this module removes (proven in the 05e restart runs): the "already running" guard was a module-level Set in
 * engineerLoop.ts. Next.js bundles instrumentation (startup recovery) and each API route separately, so every bundle got
 * its OWN Set and its own copy of that guard. Startup recovery and a UI-triggered /run for the same mission therefore both
 * started an engineering loop, two MISSION_RESUMED events were written, and two writers raced on one repair file.
 *
 * State here lives on `globalThis` (Symbol.for), so every bundle in the process shares it. It is process-local by design:
 * a restart kills the executor, and the next resume acquires a fresh owner. Nothing here is a second mission store; it only
 * decides WHO may run and write for a mission id.
 *
 *   - acquireMissionOwnership: at most one owner per mission id. A second caller gets `null` and must attach, not execute.
 *   - executor context (AsyncLocalStorage): the running loop carries its owner token. Every write it makes is fenced: if the
 *     token is no longer the registered owner, or the record is terminal, the write throws instead of appending events.
 *   - withRecordLock: serializes read-modify-write on one mission record.
 *
 * Pure of the filesystem and of the repair record shape.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

export type MissionOwner = { token: string; repairId: string; startedAt: string; pid: number }

export class MissionSupersededError extends Error {
  readonly code = 'MISSION_SUPERSEDED'
  constructor(readonly repairId: string) {
    super(`Executor for ${repairId} no longer owns the mission.`)
  }
}

export class MissionSealedError extends Error {
  readonly code = 'MISSION_SEALED'
  constructor(readonly repairId: string, readonly reason: string) {
    super(`Mission ${repairId} is sealed (${reason}); no executor may append to it.`)
  }
}

type Registry = {
  owners: Map<string, MissionOwner>
  locks: Map<string, Promise<unknown>>
  context: AsyncLocalStorage<MissionOwner>
  resumeRequests: Map<string, number>
  /** Record ids whose lock the current async context already holds (makes withRecordLock re-entrant instead of self-deadlocking). */
  held: AsyncLocalStorage<ReadonlySet<string>>
}

const KEY = Symbol.for('war-room.foundry.missionOwnership.v1')

function registry(): Registry {
  const holder = globalThis as unknown as Record<symbol, Registry | undefined>
  let value = holder[KEY]
  if (!value) {
    value = { owners: new Map(), locks: new Map(), context: new AsyncLocalStorage<MissionOwner>(), resumeRequests: new Map(), held: new AsyncLocalStorage<ReadonlySet<string>>() }
    holder[KEY] = value
  }
  return value
}

export function acquireMissionOwnership(repairId: string): MissionOwner | null {
  const reg = registry()
  if (reg.owners.has(repairId)) {
    reg.resumeRequests.set(repairId, (reg.resumeRequests.get(repairId) ?? 0) + 1)
    return null
  }
  const owner: MissionOwner = { token: randomUUID(), repairId, startedAt: new Date().toISOString(), pid: process.pid }
  reg.owners.set(repairId, owner)
  return owner
}

export function releaseMissionOwnership(owner: MissionOwner): void {
  const reg = registry()
  if (reg.owners.get(owner.repairId)?.token === owner.token) reg.owners.delete(owner.repairId)
}

export function isMissionOwned(repairId: string): boolean {
  return registry().owners.has(repairId)
}

export function missionOwner(repairId: string): MissionOwner | null {
  return registry().owners.get(repairId) ?? null
}

/** Resume/run requests that arrived while an executor already owned the mission (attached, never executed). */
export function attachedRequestCount(repairId: string): number {
  return registry().resumeRequests.get(repairId) ?? 0
}

export function runAsExecutor<T>(owner: MissionOwner, fn: () => Promise<T>): Promise<T> {
  return registry().context.run(owner, fn)
}

export function currentExecutor(): MissionOwner | null {
  return registry().context.getStore() ?? null
}

/**
 * Called by every executor write. Human/API writes (stop, rollback, Commander decisions) run without an executor context and
 * are never fenced. Throws when the caller is a stale executor.
 */
export function assertExecutorMayWrite(repairId: string, isTerminal: boolean, terminalReason: string): void {
  const executor = currentExecutor()
  if (!executor || executor.repairId !== repairId) return
  if (registry().owners.get(repairId)?.token !== executor.token) throw new MissionSupersededError(repairId)
  if (isTerminal) throw new MissionSealedError(repairId, terminalReason)
}

/**
 * Serializes read-modify-write per mission. Re-entrant within one async context: a callback that (through any depth of calls)
 * asks for the same lock again runs inline instead of waiting on itself. Without this, /cancel wrapping stopCodingMission —
 * which takes the same lock — deadlocked forever and froze the executor's own writes behind it.
 */
export async function withRecordLock<T>(repairId: string, fn: () => Promise<T>): Promise<T> {
  const reg = registry()
  const heldNow = reg.held.getStore()
  if (heldNow?.has(repairId)) return fn()
  const previous = reg.locks.get(repairId) ?? Promise.resolve()
  let release: () => void = () => undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  const chained = previous.then(() => gate)
  reg.locks.set(repairId, chained)
  try {
    await previous.catch(() => undefined)
    return await reg.held.run(new Set([...(heldNow ?? []), repairId]), fn)
  } finally {
    release()
    if (reg.locks.get(repairId) === chained) reg.locks.delete(repairId)
  }
}

/** Test seam: forget everything for one mission (used only by deterministic concurrency validation). */
export function resetMissionOwnershipForTests(repairId?: string): void {
  const reg = registry()
  if (repairId) {
    reg.owners.delete(repairId)
    reg.locks.delete(repairId)
    reg.resumeRequests.delete(repairId)
    return
  }
  reg.owners.clear()
  reg.locks.clear()
  reg.resumeRequests.clear()
}
