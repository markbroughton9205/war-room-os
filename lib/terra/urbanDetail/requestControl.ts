/**
 * Deterministic Overpass request control for Terra urban geography.
 * Pure coordination — no I/O. Server and browser both use these rules so camera
 * motion cannot fan out duplicate provider calls.
 */
import type { TerraUrbanDiagnosticState, TerraUrbanLod, TerraUrbanTilePayload } from './types'
import { TERRA_URBAN_INCLUDE_LABELS } from './lod'

/** Extra wait after Cesium `camera.moveEnd` so a zoom gesture is one fetch, not many. */
export const TERRA_URBAN_CAMERA_DEBOUNCE_MS = 450

/** Successful tiles stay FRESH this long. */
export const TERRA_URBAN_FRESH_TTL_MS = 6 * 60 * 60 * 1000

/** After fresh TTL, geometry may still be served during 429/503 until this bound. */
export const TERRA_URBAN_STALE_WINDOW_MS = 24 * 60 * 60 * 1000

/** Short suppression so a stationary camera cannot immediately re-hit Overpass after 429/503. */
export const TERRA_URBAN_RETRY_SUPPRESS_MIN_MS = 8_000
export const TERRA_URBAN_RETRY_SUPPRESS_MAX_MS = 60_000

/** One Overpass POST at a time. Newest viewport replaces a queued obsolete one. */
export const TERRA_URBAN_OVERPASS_CONCURRENCY = 1

/** Urban Overpass must not internally retry 429 while the camera is idle. */
export const TERRA_URBAN_OVERPASS_MAX_RETRIES = 0

export const URBAN_REQUEST_SUPERSEDED = 'URBAN_REQUEST_SUPERSEDED'

export type UrbanCacheFreshness = 'FRESH' | 'STALE' | 'EXPIRED'

export function parseRetryAfterMs(header: string | null | undefined, now = Date.now()): number | null {
  if (!header) return null
  const trimmed = header.trim()
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, TERRA_URBAN_RETRY_SUPPRESS_MAX_MS)
  }
  const asDate = Date.parse(trimmed)
  if (Number.isFinite(asDate)) return Math.max(0, Math.min(asDate - now, TERRA_URBAN_RETRY_SUPPRESS_MAX_MS))
  return null
}

export function computeOverpassBackoffMs(consecutiveRateLimits: number, retryAfterMs: number | null): number {
  const fromHeader = retryAfterMs != null
    ? Math.min(Math.max(retryAfterMs, TERRA_URBAN_RETRY_SUPPRESS_MIN_MS), TERRA_URBAN_RETRY_SUPPRESS_MAX_MS)
    : null
  const exp = Math.min(
    TERRA_URBAN_RETRY_SUPPRESS_MIN_MS * 2 ** Math.max(0, consecutiveRateLimits - 1),
    TERRA_URBAN_RETRY_SUPPRESS_MAX_MS,
  )
  return fromHeader ?? exp
}

export function classifyUrbanCacheFreshness(freshUntil: number, staleUntil: number, now = Date.now()): UrbanCacheFreshness {
  if (now <= freshUntil) return 'FRESH'
  if (now <= staleUntil) return 'STALE'
  return 'EXPIRED'
}

export function isRateLimitedStatus(status: number | null | undefined): boolean {
  return status === 429 || status === 503
}

function mapDiagnosticForStale(state: TerraUrbanDiagnosticState): TerraUrbanDiagnosticState {
  if (state === 'UNAVAILABLE' || state === 'RATE_LIMITED') return state
  return 'STALE'
}

export function asCachedUrbanPayload(payload: TerraUrbanTilePayload): TerraUrbanTilePayload {
  const cached = (state: TerraUrbanDiagnosticState): TerraUrbanDiagnosticState => (
    state === 'UNAVAILABLE' || state === 'RATE_LIMITED' ? state : 'CACHED'
  )
  return {
    ...payload,
    fromCache: true,
    rateLimited: false,
    retryAfterMs: null,
    diagnostics: {
      roads: cached(payload.diagnostics.roads),
      buildings: cached(payload.diagnostics.buildings),
      signals: cached(payload.diagnostics.signals ?? 'UNAVAILABLE'),
      labels: cached(payload.diagnostics.labels),
    },
  }
}

export function asStaleUrbanPayload(payload: TerraUrbanTilePayload, error: string | null, retryAfterMs: number | null = null): TerraUrbanTilePayload {
  return {
    ...payload,
    fromCache: true,
    rateLimited: retryAfterMs != null || Boolean(payload.rateLimited),
    retryAfterMs,
    error,
    diagnostics: {
      roads: mapDiagnosticForStale(payload.diagnostics.roads),
      buildings: mapDiagnosticForStale(payload.diagnostics.buildings),
      signals: mapDiagnosticForStale(payload.diagnostics.signals ?? 'UNAVAILABLE'),
      labels: mapDiagnosticForStale(payload.diagnostics.labels),
    },
  }
}

export function rateLimitedDiagnostics(lod: TerraUrbanLod): TerraUrbanTilePayload['diagnostics'] {
  return {
    roads: 'RATE_LIMITED',
    buildings: lod === 'city' ? 'UNAVAILABLE' : 'RATE_LIMITED',
    signals: lod === 'city' ? 'UNAVAILABLE' : 'RATE_LIMITED',
    labels: TERRA_URBAN_INCLUDE_LABELS[lod] ? 'RATE_LIMITED' : 'UNAVAILABLE',
  }
}

export function hasUsableUrbanGeometry(payload: TerraUrbanTilePayload | null | undefined): boolean {
  if (!payload) return false
  return payload.roads.length > 0 || payload.buildings.length > 0 || (payload.signals?.length ?? 0) > 0
}

export function sameUrbanViewportKey(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a) && a === b
}

type Waiter<T> = { resolve: (value: T) => void; reject: (reason: unknown) => void }

/**
 * In-flight dedupe by key + concurrency 1 + newest-viewport priority.
 * A later different key replaces a queued obsolete key instead of stacking a queue.
 */
export function createUrbanFetchCoordinator<T>() {
  const inflight = new Map<string, Promise<T>>()
  let runningKey: string | null = null
  let queued: { key: string; start: () => Promise<T>; waiters: Waiter<T>[] } | null = null

  function rejectQueued(reason: unknown) {
    if (!queued) return
    const waiters = queued.waiters
    queued = null
    queueMicrotask(() => {
      for (const waiter of waiters) waiter.reject(reason)
    })
  }

  function pumpQueued() {
    const next = queued
    queued = null
    if (!next) return
    const promise = runStart(next.key, next.start)
    for (const waiter of next.waiters) promise.then(waiter.resolve, waiter.reject)
  }

  function runStart(key: string, start: () => Promise<T>): Promise<T> {
    runningKey = key
    const promise = start().finally(() => {
      inflight.delete(key)
      if (runningKey === key) runningKey = null
      pumpQueued()
    })
    inflight.set(key, promise)
    return promise
  }

  function run(key: string, start: () => Promise<T>): Promise<T> {
    const existing = inflight.get(key)
    if (existing) return existing
    if (runningKey === null) return runStart(key, start)
    return new Promise<T>((resolve, reject) => {
      if (queued && queued.key !== key) {
        rejectQueued(new Error(URBAN_REQUEST_SUPERSEDED))
      }
      if (queued && queued.key === key) {
        queued.waiters.push({ resolve, reject })
        queued.start = start
        return
      }
      queued = { key, start, waiters: [{ resolve, reject }] }
    })
  }

  return {
    run,
    inflightCount(): number { return inflight.size },
    hasInflight(key: string): boolean { return inflight.has(key) },
    queuedKey(): string | null { return queued?.key ?? null },
    runningKey(): string | null { return runningKey },
  }
}

export function isUrbanRequestSuperseded(error: unknown): boolean {
  return error instanceof Error && error.message === URBAN_REQUEST_SUPERSEDED
}
