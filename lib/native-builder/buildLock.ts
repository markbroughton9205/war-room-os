/**
 * Repository-scoped build/package lock. PASS 002 observed a real collision: two concurrent agents
 * both ran `next build` into the same shared .next/ output tree at once, and one call's result
 * came back with incomplete artifacts. This is the fix: every operation that mutates a shared
 * build/package output (build.run, package.run, prepare_desktop_runtime,
 * package_desktop_linux) acquires this lock first and releases it in a `finally`, so two such
 * operations against the same checkout can never run concurrently again.
 *
 * Atomicity: acquisition uses `open(path, 'wx')` — O_CREAT|O_EXCL — which is atomic at the
 * filesystem level; two processes racing to create the same lock file can never both succeed.
 * Staleness: a lock whose pid is no longer alive is a crash-orphaned lock, not a valid hold — it
 * is safely reclaimed (never silently stolen from a live holder).
 */
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'

const LOCK_DIR_NAME = path.join('.war-room', 'locks')
const LOCK_FILE_NAME = 'build-package.lock.json'
const STALE_AFTER_MS = 15 * 60 * 1000 // a real `pnpm run build` + package run is minutes, not this long

export type BuildLockPayload = {
  missionId: string
  callId: string
  pid: number
  startedAt: string
  operation: string
  repoIdentity: string
}

export type BuildLockAcquireResult =
  | { state: 'ACQUIRED'; lock: BuildLockPayload; release: () => Promise<void> }
  | { state: 'BUSY'; holder: BuildLockPayload }
  | { state: 'TIMEOUT'; holder: BuildLockPayload | null }

function lockPath(): string {
  return path.join(resolveBaseRepoRoot(), LOCK_DIR_NAME, LOCK_FILE_NAME)
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

async function readLock(): Promise<BuildLockPayload | null> {
  try {
    const raw = await readFile(lockPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<BuildLockPayload>
    if (typeof parsed.pid !== 'number' || typeof parsed.startedAt !== 'string') return null
    return parsed as BuildLockPayload
  } catch {
    return null
  }
}

function isStale(lock: BuildLockPayload): boolean {
  if (!isProcessAlive(lock.pid)) return true
  const ageMs = Date.now() - Date.parse(lock.startedAt)
  return Number.isFinite(ageMs) && ageMs > STALE_AFTER_MS
}

async function tryCreate(payload: BuildLockPayload): Promise<boolean> {
  const dir = path.dirname(lockPath())
  await mkdir(dir, { recursive: true })
  try {
    const handle = await open(lockPath(), 'wx')
    try {
      await handle.writeFile(JSON.stringify(payload, null, 2))
    } finally {
      await handle.close()
    }
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') return false
    throw error
  }
}

async function forceReplaceStale(payload: BuildLockPayload): Promise<void> {
  // Not "stealing a valid lock" — only ever called after isStale() confirmed the holder's pid is
  // dead or the lock badly outlived any real build. Write-then-rename keeps the replacement itself
  // atomic even though the prior file already existed.
  const tmp = `${lockPath()}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
  await rename(tmp, lockPath())
}

export type AcquireBuildLockInput = { missionId: string; operation: string; waitMs?: number }

/**
 * In-process nesting for the same mission. Foundry operations acquire BUILD_PIPELINE via
 * acquireBuildLock, then build.run / package.run call withBuildLock against the same file.
 * Without nesting, that second acquire is a self-BUSY and production missions cannot build.
 * Different missions in the same process still contend — only identical missionId may nest.
 */
type NestState = { callId: string; missionId: string; depth: number }
const nests = new Map<string, NestState>()

function nestKey(): string {
  return lockPath()
}

function makeNestedRelease(lock: BuildLockPayload, operation: string): () => Promise<void> {
  const key = nestKey()
  const existing = nests.get(key)
  if (existing && existing.missionId === lock.missionId) {
    existing.depth += 1
  } else {
    nests.set(key, { callId: lock.callId, missionId: lock.missionId, depth: 1 })
  }
  let released = false
  return async () => {
    if (released) return
    released = true
    const state = nests.get(key)
    if (!state || state.missionId !== lock.missionId) return
    state.depth -= 1
    if (state.depth > 0) return
    nests.delete(key)
    // Only ever remove OUR OWN lock — re-read and compare callId first, never blind-delete.
    const current = await readLock()
    if (current?.callId === state.callId) {
      await rm(lockPath(), { force: true })
      await logWarRoomRepoAudit('engineer: build_lock.released', { callId: state.callId, missionId: lock.missionId, operation })
    }
  }
}

/** Attempts to acquire the lock, waiting up to waitMs (default 0 — fail fast with BUSY) if
 * currently held by a live process. A stale (crash-orphaned or absurdly long-lived) lock is
 * reclaimed immediately rather than waited out. */
export async function acquireBuildLock(input: AcquireBuildLockInput): Promise<BuildLockAcquireResult> {
  const deadline = Date.now() + (input.waitMs ?? 0)
  const repoIdentity = resolveBaseRepoRoot()
  const callId = randomUUID()
  const payload: BuildLockPayload = {
    missionId: input.missionId,
    callId,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    operation: input.operation,
    repoIdentity,
  }

  const waitMs = input.waitMs ?? 0
  let hasWaited = false

  for (;;) {
    const existing = await readLock()
    if (
      existing
      && !isStale(existing)
      && existing.pid === process.pid
      && existing.missionId === input.missionId
    ) {
      await logWarRoomRepoAudit('engineer: build_lock.nested', {
        state: 'ACQUIRED',
        outer: existing,
        nestedOperation: input.operation,
      })
      return { state: 'ACQUIRED', lock: existing, release: makeNestedRelease(existing, input.operation) }
    }

    const created = await tryCreate(payload)
    if (created) {
      await logWarRoomRepoAudit('engineer: build_lock.acquired', { state: 'ACQUIRED', ...payload })
      return { state: 'ACQUIRED', lock: payload, release: makeNestedRelease(payload, input.operation) }
    }

    const holder = await readLock()
    if (holder && isStale(holder)) {
      await logWarRoomRepoAudit('engineer: build_lock.stale_recovered', { staleHolder: holder, newHolder: payload })
      nests.delete(nestKey())
      await forceReplaceStale(payload)
      return { state: 'ACQUIRED', lock: payload, release: makeNestedRelease(payload, input.operation) }
    }

    if (!holder) continue // lock existed for tryCreate but vanished (holder released) — retry create

    if (Date.now() >= deadline) {
      await logWarRoomRepoAudit('engineer: build_lock.busy', { requested: payload, holder })
      return waitMs > 0 && hasWaited ? { state: 'TIMEOUT', holder } : { state: 'BUSY', holder }
    }
    hasWaited = true
    await new Promise(resolve => setTimeout(resolve, 300))
  }
}

/** Read-only: never mutates, never blocks. */
export async function buildLockStatus(): Promise<{ locked: boolean; holder: BuildLockPayload | null; stale: boolean }> {
  const holder = await readLock()
  if (!holder) return { locked: false, holder: null, stale: false }
  return { locked: true, holder, stale: isStale(holder) }
}

/** Runs fn while holding the lock; always releases, even if fn throws. BUSY/TIMEOUT are returned
 * as a structured result rather than running fn at all. */
export async function withBuildLock<T>(input: AcquireBuildLockInput, fn: () => Promise<T>): Promise<{ ok: true; lockState: 'ACQUIRED' | 'STALE_RECOVERED'; value: T } | { ok: false; lockState: 'BUSY' | 'TIMEOUT'; holder: BuildLockPayload | null }> {
  const before = await readLock()
  const nested = Boolean(
    before
    && before.pid === process.pid
    && before.missionId === input.missionId
    && !isStale(before),
  )
  const acquired = await acquireBuildLock(input)
  if (acquired.state === 'BUSY' || acquired.state === 'TIMEOUT') {
    return { ok: false, lockState: acquired.state, holder: acquired.holder }
  }
  const wasStale = before !== null && !nested
  try {
    const value = await fn()
    return { ok: true, lockState: wasStale ? 'STALE_RECOVERED' : 'ACQUIRED', value }
  } finally {
    await acquired.release()
  }
}
