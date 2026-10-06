/**
 * Heavy-model runtime: lifecycle state machine + one-heavy-job lock.
 * The model never lives in the Next.js process; lifecycle mirrors the supervised worker.
 * Lock = in-process owner + O_EXCL lockfile under media-command/jobs/_generative (cross-process safe,
 * stale lock reclaimed only when its pid is dead).
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from '../paths'
import type { HvsModelLifecycleState } from './types'

const ALLOWED: Record<HvsModelLifecycleState, HvsModelLifecycleState[]> = {
  UNLOADED: ['LOADING'],
  LOADING: ['READY', 'ERROR', 'UNLOADING'],
  READY: ['GENERATING', 'UNLOADING'],
  GENERATING: ['READY', 'ERROR', 'UNLOADING'],
  UNLOADING: ['UNLOADED', 'ERROR'],
  ERROR: ['UNLOADING', 'UNLOADED'],
}

export function canTransition(from: HvsModelLifecycleState, to: HvsModelLifecycleState): boolean {
  return ALLOWED[from].includes(to)
}

type RuntimeState = {
  lifecycle: HvsModelLifecycleState
  lifecycleChangedAt: string
  lastError: string | null
  owner: string | null
}

const state: RuntimeState = { lifecycle: 'UNLOADED', lifecycleChangedAt: new Date().toISOString(), lastError: null, owner: null }

export function modelLifecycle(): Readonly<RuntimeState> {
  return { ...state }
}

export function transitionLifecycle(to: HvsModelLifecycleState, error?: string | null): HvsModelLifecycleState {
  if (state.lifecycle === to) return to
  if (!canTransition(state.lifecycle, to)) {
    throw new Error(`Illegal model lifecycle transition ${state.lifecycle} -> ${to}.`)
  }
  state.lifecycle = to
  state.lifecycleChangedAt = new Date().toISOString()
  if (to === 'ERROR') state.lastError = (error ?? 'unknown').slice(0, 500)
  return to
}

/** Return to UNLOADED through legal transitions (used after a worker exits for any reason). */
export function settleLifecycleUnloaded(): void {
  const s = state.lifecycle
  if (s === 'UNLOADED') return
  if (s === 'LOADING' || s === 'READY' || s === 'GENERATING' || s === 'ERROR') transitionLifecycle('UNLOADING')
  transitionLifecycle('UNLOADED')
}

export function resetLifecycleForTests(): void {
  state.lifecycle = 'UNLOADED'
  state.lastError = null
  state.owner = null
}

export function heavyLockPath(): string {
  const dir = path.join(mediaCommandDataHierarchy().jobs, '_generative')
  mkdirSync(dir, { recursive: true })
  return path.join(dir, 'wan22.heavy.lock')
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export type HeavyLockInfo = { pid: number; generationId: string; acquiredAt: string }

export function readHeavyLock(): HeavyLockInfo | null {
  const file = heavyLockPath()
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as HeavyLockInfo
  } catch {
    return null
  }
}

export function heavyLockHeld(): boolean {
  if (state.owner) return true
  const info = readHeavyLock()
  return Boolean(info && pidAlive(info.pid))
}

export type HeavyLease = { generationId: string; release: () => void }

export function tryAcquireHeavyLock(generationId: string): HeavyLease | null {
  if (state.owner) return null
  const file = heavyLockPath()
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx')
      const info: HeavyLockInfo = { pid: process.pid, generationId, acquiredAt: new Date().toISOString() }
      writeSync(fd, JSON.stringify(info))
      closeSync(fd)
      state.owner = generationId
      let released = false
      return {
        generationId,
        release: () => {
          if (released) return
          released = true
          state.owner = null
          try {
            const current = readHeavyLock()
            if (!current || (current.pid === process.pid && current.generationId === generationId)) unlinkSync(file)
          } catch {
            // already gone
          }
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return null
      const info = readHeavyLock()
      if (info && pidAlive(info.pid)) return null
      try { unlinkSync(file) } catch { /* raced */ }
    }
  }
  return null
}
