/**
 * Central limits + in-memory counters for background work, scans, and internet polls.
 * Server-only singleton state.
 */

import { getResourceSnapshot, type ResourceSnapshot } from '@/lib/system/resourceMonitor'

export const MAX_CONCURRENT_BACKGROUND_WORKERS = 4
export const MAX_CONCURRENT_SCANS = 2
export const MAX_INTERNET_POLLS_PER_MINUTE = 30
export const RED_SENTINEL_MIN_INTERVAL_MS = 15_000
export const WORKER_QUEUE_MAX_DEPTH = 8
export const RESOURCE_PAUSE_MEMORY_RATIO = 0.9

const INTERNET_POLL_WINDOW_MS = 60_000
const INTERNET_POLL_RING_MAX = MAX_INTERNET_POLLS_PER_MINUTE + 5

export type WorkerSlotKind = 'background' | 'internet' | 'other'

type AcquireResult =
  | { ok: true }
  | { ok: false; error: string; retryAfterMs: number }

let activeWorkers = 0
let activeScans = 0
const internetPollTimestamps: number[] = []
let lastRedSentinelRunAt = 0
/** Monotonic depth: concurrent workers + scans (bounded gate). */
let workerQueueDepth = 0

function trimInternetPollRing(now: number) {
  const cutoff = now - INTERNET_POLL_WINDOW_MS
  while (internetPollTimestamps.length && internetPollTimestamps[0]! < cutoff) {
    internetPollTimestamps.shift()
  }
}

export function getWorkerLimitCounters() {
  trimInternetPollRing(Date.now())
  return {
    activeWorkers,
    activeScans,
    internetPollsInWindow: internetPollTimestamps.length,
    lastRedSentinelRunAt,
    workerQueueDepth,
  }
}

export function shouldPauseWorkersDueToResources(snapshot: ResourceSnapshot): boolean {
  return snapshot.memoryUsageRatio >= RESOURCE_PAUSE_MEMORY_RATIO
}

export function tryAcquireWorkerSlot(_kind: WorkerSlotKind): AcquireResult {
  void _kind
  const snapshot = getResourceSnapshot()
  if (shouldPauseWorkersDueToResources(snapshot)) {
    return { ok: false, error: 'Server memory pressure high; try again shortly.', retryAfterMs: 5000 }
  }
  if (activeWorkers >= MAX_CONCURRENT_BACKGROUND_WORKERS) {
    return { ok: false, error: 'Too many concurrent workers.', retryAfterMs: 2000 }
  }
  if (workerQueueDepth >= WORKER_QUEUE_MAX_DEPTH) {
    return { ok: false, error: 'Worker queue depth limit reached.', retryAfterMs: 3000 }
  }
  activeWorkers += 1
  workerQueueDepth += 1
  return { ok: true }
}

export function releaseWorkerSlot() {
  activeWorkers = Math.max(0, activeWorkers - 1)
  workerQueueDepth = Math.max(0, workerQueueDepth - 1)
}

export function tryAcquireScanSlot(): AcquireResult {
  const snapshot = getResourceSnapshot()
  if (shouldPauseWorkersDueToResources(snapshot)) {
    return { ok: false, error: 'Server memory pressure high; try again shortly.', retryAfterMs: 5000 }
  }
  if (activeScans >= MAX_CONCURRENT_SCANS) {
    return { ok: false, error: 'Too many concurrent scans.', retryAfterMs: 2500 }
  }
  if (workerQueueDepth >= WORKER_QUEUE_MAX_DEPTH) {
    return { ok: false, error: 'Worker queue depth limit reached.', retryAfterMs: 3000 }
  }
  activeScans += 1
  workerQueueDepth += 1
  return { ok: true }
}

export function releaseScanSlot() {
  activeScans = Math.max(0, activeScans - 1)
  workerQueueDepth = Math.max(0, workerQueueDepth - 1)
}

export function canRunInternetPoll(): boolean {
  const now = Date.now()
  trimInternetPollRing(now)
  return internetPollTimestamps.length < MAX_INTERNET_POLLS_PER_MINUTE
}

export function recordInternetPoll() {
  const now = Date.now()
  trimInternetPollRing(now)
  internetPollTimestamps.push(now)
  while (internetPollTimestamps.length > INTERNET_POLL_RING_MAX) {
    internetPollTimestamps.shift()
  }
}

/**
 * Reserves the minimum-interval gate for Red Sentinel (synchronous; call after `tryAcquireScanSlot`).
 * First run always succeeds when called.
 */
export function tryReserveRedSentinelInterval(): { ok: true } | { ok: false; retryAfterMs: number } {
  const now = Date.now()
  if (lastRedSentinelRunAt !== 0) {
    const elapsed = now - lastRedSentinelRunAt
    if (elapsed < RED_SENTINEL_MIN_INTERVAL_MS) {
      return { ok: false, retryAfterMs: RED_SENTINEL_MIN_INTERVAL_MS - elapsed }
    }
  }
  lastRedSentinelRunAt = now
  return { ok: true }
}

export function getLimitConstants() {
  return {
    MAX_CONCURRENT_BACKGROUND_WORKERS,
    MAX_CONCURRENT_SCANS,
    MAX_INTERNET_POLLS_PER_MINUTE,
    RED_SENTINEL_MIN_INTERVAL_MS,
    WORKER_QUEUE_MAX_DEPTH,
    RESOURCE_PAUSE_MEMORY_RATIO,
  }
}
